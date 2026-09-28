// python-rq adapter (what Frappe/ERPNext uses for its background workers).
//
// Layout on Redis:
//   rq:queues              set of "rq:queue:<name>"
//   rq:queue:<name>        list of job ids waiting
//   rq:wip:<name>          zset of jobs a worker has picked up
//   rq:finished|failed|deferred|scheduled|canceled:<name>   zsets of job ids
//   rq:workers             set of "rq:worker:<name>"
//   rq:worker:<name>       hash describing one worker process
//   rq:job:<id>            hash describing one job
import { scanKeys, pipe, num, parseTime, iso, truncate, pageRange } from './util.js';

export const id = 'rq';
export const label = 'python-rq';

const REGISTRY = {
  active: (q) => `rq:wip:${q}`,
  deferred: (q) => `rq:deferred:${q}`,
  scheduled: (q) => `rq:scheduled:${q}`,
  failed: (q) => `rq:failed:${q}`,
  finished: (q) => `rq:finished:${q}`,
  canceled: (q) => `rq:canceled:${q}`
};

export async function listQueues(client) {
  const names = await queueNames(client);
  if (names.length === 0) return [];

  const cmds = [];
  for (const q of names) {
    cmds.push(['llen', `rq:queue:${q}`]);
    for (const key of Object.values(REGISTRY)) cmds.push(['zcard', key(q)]);
  }
  const res = await pipe(client, cmds);

  const per = 1 + Object.keys(REGISTRY).length;
  return names.map((name, i) => {
    const base = i * per;
    const counts = { waiting: num(res[base]) };
    Object.keys(REGISTRY).forEach((state, j) => {
      counts[state] = num(res[base + 1 + j]);
    });
    return {
      system: id,
      name,
      counts,
      // Backlog is what an operator acts on; finished/canceled are history.
      backlog: counts.waiting + counts.active + counts.deferred + counts.scheduled,
      failed: counts.failed
    };
  });
}

async function queueNames(client) {
  // The `rq:queues` set is authoritative, but a queue whose set entry was
  // evicted still has a live list key — fall back to a scan so nothing hides.
  const members = await client.smembers('rq:queues').catch(() => []);
  const names = new Set(members.map((m) => String(m).replace(/^rq:queue:/, '')).filter(Boolean));
  if (names.size === 0) {
    const { keys } = await scanKeys(client, 'rq:queue:*');
    for (const k of keys) {
      const name = k.slice('rq:queue:'.length);
      if (name && !name.includes(':')) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * rq-scheduler keeps its own zset, separate from every queue: a job waiting
 * there is invisible in the queue counts, so a cron that stopped firing looks
 * exactly like a quiet system.
 */
export async function scheduler(client) {
  const [count, next] = await Promise.all([
    client.zcard('rq:scheduler:scheduled_jobs').catch(() => 0),
    client.zrange('rq:scheduler:scheduled_jobs', 0, 0, 'WITHSCORES').catch(() => [])
  ]);
  if (!num(count)) return null;
  // The score is the unix timestamp of the next run.
  const at = Array.isArray(next) && next.length > 1 ? num(next[1]) * 1000 : null;
  return {
    system: id,
    scheduled: num(count),
    nextJobId: Array.isArray(next) && next.length ? String(next[0]) : '',
    nextRunAt: at ? iso(at) : null,
    // Scheduler down: jobs are due but nothing has picked them up.
    overdueSec: at && at < Date.now() ? Math.round((Date.now() - at) / 1000) : 0
  };
}

export async function listWorkers(client) {
  const members = await client.smembers('rq:workers').catch(() => []);
  let keys = members.map(String).filter((k) => k.startsWith('rq:worker:'));
  if (keys.length === 0) keys = (await scanKeys(client, 'rq:worker:*')).keys;
  if (keys.length === 0) return [];

  const hashes = await pipe(client, keys.map((k) => ['hgetall', k]));
  const now = Date.now();

  return keys
    .map((key, i) => {
      const h = hashes[i] || {};
      // A worker key that died leaves an empty hash behind in the set.
      if (!h.state && !h.birth && !h.last_heartbeat) return null;
      const beat = parseTime(h.last_heartbeat);
      const state = String(h.state || '').toLowerCase();
      return {
        system: id,
        name: key.slice('rq:worker:'.length),
        state: state || 'unknown',
        busy: state === 'busy',
        queues: String(h.queues || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        currentJob: h.current_job || '',
        jobRuntimeSec: h.current_job_working_time ? Math.round(num(h.current_job_working_time)) : null,
        heartbeatAgoSec: beat == null ? null : Math.round((now - beat) / 1000),
        birthAt: iso(parseTime(h.birth)),
        succeeded: num(h.successful_job_count, null),
        failed: num(h.failed_job_count, null),
        host: h.hostname || '',
        pid: h.pid || '',
        version: h.version || ''
      };
    })
    .filter(Boolean);
}

export const STATES = ['waiting', 'active', 'deferred', 'scheduled', 'failed', 'finished', 'canceled'];

/** Job ids for one queue+state, newest-relevant first, plus the total. */
async function jobIds(client, queue, state, { start, stop }) {
  if (state === 'waiting') {
    const key = `rq:queue:${queue}`;
    const [ids, total] = await Promise.all([client.lrange(key, start, stop), client.llen(key)]);
    return { ids: ids.map(String), total: num(total) };
  }
  const build = REGISTRY[state];
  if (!build) {
    const err = new Error(`State "${state}" tidak dikenal untuk python-rq.`);
    err.expected = true;
    throw err;
  }
  const key = build(queue);
  const [ids, total] = await Promise.all([client.zrange(key, start, stop), client.zcard(key)]);
  return { ids: ids.map(String), total: num(total) };
}

export async function listJobs(client, { queue, state = 'waiting', offset = 0, limit = 50 }) {
  const range = pageRange(offset, limit);
  const { ids, total } = await jobIds(client, queue, state, range);
  if (ids.length === 0) return { jobs: [], total };

  const hashes = await pipe(
    client,
    // `data` and `meta` hold pickled Python bytes — unreadable and often huge,
    // so they are never fetched.
    ids.map((jid) => [
      'hmget',
      `rq:job:${jid}`,
      'description',
      'status',
      'origin',
      'created_at',
      'enqueued_at',
      'started_at',
      'ended_at',
      'worker_name',
      'exc_info',
      'timeout',
      'failure_ttl',
      'retries_left'
    ])
  );

  const jobs = ids.map((jid, i) => {
    const [
      description, status, origin, createdAt, enqueuedAt, startedAt, endedAt,
      worker, excInfo, timeout, , retriesLeft
    ] = hashes[i] || [];
    const started = parseTime(startedAt);
    const ended = parseTime(endedAt);
    const enqueued = parseTime(enqueuedAt);
    return {
      id: jid,
      queue: origin || queue,
      state: status || state,
      name: description ? String(description).split('(')[0].trim() : '',
      description: truncate(description, 400),
      createdAt: iso(parseTime(createdAt)),
      enqueuedAt: iso(enqueued),
      startedAt: iso(started),
      endedAt: iso(ended),
      // For a running job the interesting number is how long it has been going.
      durationSec:
        started != null ? Math.round(((ended ?? Date.now()) - started) / 1000) : null,
      waitSec: enqueued != null && started != null ? Math.round((started - enqueued) / 1000) : null,
      attempts: retriesLeft === undefined || retriesLeft === null ? null : num(retriesLeft, null),
      timeoutSec: timeout ? num(timeout, null) : null,
      worker: worker || '',
      error: excInfo ? truncate(lastLines(excInfo, 3), 500) : '',
      // A hash that came back empty means the job expired out of Redis but its
      // id is still parked in the registry — worth showing, not hiding.
      missing: !status && !description
    };
  });

  return { jobs, total };
}

/** Python tracebacks are long; the final lines carry the actual exception. */
function lastLines(text, n) {
  const lines = String(text).trimEnd().split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}
