// BullMQ / Bull adapter (the queue most Node.js workers use).
//
// Layout on Redis, with the default `bull` prefix:
//   bull:<name>:meta       hash (BullMQ) — presence marks a queue
//   bull:<name>:id         counter (Bull v3 + BullMQ) — same role
//   bull:<name>:wait|active|paused        lists of job ids
//   bull:<name>:delayed|completed|failed|prioritized|waiting-children   zsets
//   bull:<name>:<jobId>    hash describing one job
import { scanKeys, pipe, num, parseTime, iso, truncate, maybeJson, pageRange } from './util.js';

export const id = 'bullmq';
export const label = 'BullMQ / Bull';

const PREFIX = 'bull:';
const LIST_STATES = { waiting: 'wait', active: 'active', paused: 'paused' };
const ZSET_STATES = {
  prioritized: 'prioritized',
  delayed: 'delayed',
  waitingChildren: 'waiting-children',
  failed: 'failed',
  // Keyed as `finished` so BullMQ's "completed" and rq's "finished" land in one
  // column instead of two that mean the same thing.
  finished: 'completed'
};

export async function listQueues(client) {
  const names = await queueNames(client);
  if (names.length === 0) return [];

  const cmds = [];
  for (const q of names) {
    for (const suffix of Object.values(LIST_STATES)) cmds.push(['llen', `${PREFIX}${q}:${suffix}`]);
    for (const suffix of Object.values(ZSET_STATES)) cmds.push(['zcard', `${PREFIX}${q}:${suffix}`]);
    cmds.push(['hget', `${PREFIX}${q}:meta`, 'paused']);
  }
  const res = await pipe(client, cmds);

  const per = Object.keys(LIST_STATES).length + Object.keys(ZSET_STATES).length + 1;
  return names.map((name, i) => {
    const base = i * per;
    const counts = {};
    Object.keys(LIST_STATES).forEach((state, j) => (counts[state] = num(res[base + j])));
    Object.keys(ZSET_STATES).forEach(
      (state, j) => (counts[state] = num(res[base + Object.keys(LIST_STATES).length + j]))
    );
    const pausedFlag = res[base + per - 1];
    return {
      system: id,
      name,
      counts,
      backlog: counts.waiting + counts.active + counts.delayed + counts.prioritized + counts.paused,
      failed: counts.failed,
      // BullMQ moves waiting jobs into `paused` and flips meta.paused; either
      // signal alone is enough to warn that nothing is being consumed.
      paused: String(pausedFlag) === '1' || counts.paused > 0
    };
  });
}

async function queueNames(client) {
  const names = new Set();
  for (const pattern of [`${PREFIX}*:meta`, `${PREFIX}*:id`]) {
    const { keys } = await scanKeys(client, pattern);
    for (const k of keys) {
      const name = k.slice(PREFIX.length, k.lastIndexOf(':'));
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * BullMQ keeps no worker registry, so the honest answer is the client list:
 * every connected worker shows up as a Redis client, and the ones blocked on
 * BRPOPLPUSH/BLMOVE are the ones actually waiting for a job.
 */
export async function listWorkers(client) {
  let raw = '';
  try {
    raw = await client.client('LIST');
  } catch (e) {
    return []; // CLIENT LIST is restricted on managed Redis (e.g. some ACLs)
  }
  return String(raw)
    .split('\n')
    .filter(Boolean)
    .map((line) => Object.fromEntries(line.trim().split(' ').map((kv) => kv.split('='))))
    .filter((c) => c.name && /bull/i.test(c.name))
    .map((c) => ({
      system: id,
      name: c.name || c.addr,
      state: c.cmd && /^b(rpoplpush|lmove|zpopmin)/i.test(c.cmd) ? 'idle' : 'busy',
      busy: !(c.cmd && /^b(rpoplpush|lmove|zpopmin)/i.test(c.cmd)),
      queues: queuesFromClientName(c.name),
      currentJob: '',
      jobRuntimeSec: null,
      heartbeatAgoSec: c.idle == null ? null : num(c.idle, null),
      birthAt: c.age ? iso(Date.now() - num(c.age) * 1000) : null,
      succeeded: null,
      failed: null,
      host: c.addr || '',
      pid: '',
      version: ''
    }));
}

// BullMQ names its connections "bull:<queue>:<uuid>".
function queuesFromClientName(name) {
  const m = /^bull:(.+):[0-9a-f-]{8,}$/i.exec(String(name || ''));
  return m ? [m[1]] : [];
}

export const STATES = [
  'waiting',
  'active',
  'paused',
  'prioritized',
  'delayed',
  'waitingChildren',
  'failed',
  'finished'
];

async function jobIds(client, queue, state, { start, stop }) {
  const listSuffix = LIST_STATES[state];
  if (listSuffix) {
    const key = `${PREFIX}${queue}:${listSuffix}`;
    const [ids, total] = await Promise.all([client.lrange(key, start, stop), client.llen(key)]);
    return { ids: ids.map(String), total: num(total) };
  }
  const zSuffix = ZSET_STATES[state];
  if (!zSuffix) {
    const err = new Error(`State "${state}" tidak dikenal untuk BullMQ.`);
    err.expected = true;
    throw err;
  }
  const key = `${PREFIX}${queue}:${zSuffix}`;
  const [ids, total] = await Promise.all([client.zrange(key, start, stop), client.zcard(key)]);
  return { ids: ids.map(String), total: num(total) };
}

export async function listJobs(client, { queue, state = 'waiting', offset = 0, limit = 50 }) {
  const range = pageRange(offset, limit);
  const { ids, total } = await jobIds(client, queue, state, range);
  if (ids.length === 0) return { jobs: [], total };

  const hashes = await pipe(
    client,
    ids.map((jid) => [
      'hmget',
      `${PREFIX}${queue}:${jid}`,
      'name',
      'timestamp',
      'processedOn',
      'finishedOn',
      'attemptsMade',
      'failedReason',
      'data',
      'opts',
      'delay'
    ])
  );

  const jobs = ids.map((jid, i) => {
    const [name, timestamp, processedOn, finishedOn, attemptsMade, failedReason, data, opts, delay] =
      hashes[i] || [];
    const created = parseTime(timestamp);
    const started = parseTime(processedOn);
    const ended = parseTime(finishedOn);
    const parsedOpts = maybeJson(opts) || {};
    return {
      id: jid,
      queue,
      state,
      name: name || '',
      description: truncate(data, 400),
      createdAt: iso(created),
      enqueuedAt: iso(created),
      startedAt: iso(started),
      endedAt: iso(ended),
      durationSec: started != null ? Math.round(((ended ?? Date.now()) - started) / 1000) : null,
      waitSec: created != null && started != null ? Math.round((started - created) / 1000) : null,
      attempts: attemptsMade == null ? null : num(attemptsMade, null),
      timeoutSec: parsedOpts.timeout ? Math.round(num(parsedOpts.timeout) / 1000) : null,
      worker: '',
      error: failedReason ? truncate(failedReason, 500) : '',
      delaySec: delay ? Math.round(num(delay) / 1000) : null,
      missing: !name && !timestamp
    };
  });

  return { jobs, total };
}
