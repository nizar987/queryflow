// Sidekiq adapter (Ruby workers).
//
// Layout on Redis:
//   queues            set of queue names
//   queue:<name>      list of job payloads (JSON, not ids)
//   retry|schedule|dead   global zsets of payloads
//   processes         set of process keys; <process> hash describes one worker
import { pipe, num, parseTime, iso, truncate, maybeJson, pageRange } from './util.js';

export const id = 'sidekiq';
export const label = 'Sidekiq';

export async function listQueues(client) {
  const names = await client.smembers('queues').catch(() => []);
  if (!names || names.length === 0) return [];

  const sorted = [...names].sort();
  const res = await pipe(client, [
    ...sorted.map((n) => ['llen', `queue:${n}`]),
    ...sorted.map((n) => ['exists', `queue:${n}:paused`])
  ]);

  return sorted.map((name, i) => {
    const waiting = num(res[i]);
    return {
      system: id,
      name,
      counts: { waiting },
      backlog: waiting,
      failed: 0,
      paused: num(res[sorted.length + i]) === 1
    };
  });
}

/**
 * retry/schedule/dead are process-wide in Sidekiq, not per queue — reporting
 * them on every row would repeat the same number across the whole table.
 */
export async function globals(client) {
  const [retry, scheduled, dead] = await pipe(client, [
    ['zcard', 'retry'],
    ['zcard', 'schedule'],
    ['zcard', 'dead']
  ]);
  return { retry: num(retry), scheduled: num(scheduled), dead: num(dead) };
}

export async function listWorkers(client) {
  const keys = await client.smembers('processes').catch(() => []);
  if (!keys || keys.length === 0) return [];

  const res = await pipe(client, keys.map((k) => ['hmget', k, 'info', 'busy', 'beat', 'quiet']));
  const now = Date.now();

  return keys.map((key, i) => {
    const [info, busy, beat, quiet] = res[i] || [];
    const parsed = maybeJson(info) || {};
    const beatMs = parseTime(beat);
    return {
      system: id,
      name: parsed.identity || key,
      state: String(quiet) === 'true' ? 'quiet' : num(busy) > 0 ? 'busy' : 'idle',
      busy: num(busy) > 0,
      queues: Array.isArray(parsed.queues) ? parsed.queues : [],
      currentJob: num(busy) > 0 ? `${num(busy)} job berjalan` : '',
      jobRuntimeSec: null,
      heartbeatAgoSec: beatMs == null ? null : Math.round((now - beatMs) / 1000),
      birthAt: iso(parseTime(parsed.started_at)),
      succeeded: null,
      failed: null,
      host: parsed.hostname || '',
      pid: parsed.pid == null ? '' : String(parsed.pid),
      version: parsed.version || ''
    };
  });
}

export const STATES = ['waiting', 'retry', 'scheduled', 'dead'];

export async function listJobs(client, { queue, state = 'waiting', offset = 0, limit = 50 }) {
  const { start, stop } = pageRange(offset, limit);

  let payloads = [];
  let total = 0;
  if (state === 'waiting') {
    const key = `queue:${queue}`;
    [payloads, total] = await Promise.all([client.lrange(key, start, stop), client.llen(key)]);
  } else if (STATES.includes(state)) {
    const key = state === 'scheduled' ? 'schedule' : state;
    [payloads, total] = await Promise.all([client.zrange(key, start, stop), client.zcard(key)]);
  } else {
    const err = new Error(`State "${state}" tidak dikenal untuk Sidekiq.`);
    err.expected = true;
    throw err;
  }

  const jobs = payloads.map((raw, i) => {
    const j = maybeJson(raw) || {};
    const created = parseTime(j.created_at);
    const enqueued = parseTime(j.enqueued_at);
    return {
      id: j.jid || `${queue}#${start + i}`,
      queue: j.queue || queue,
      state,
      name: j.class || j.wrapped || '',
      description: truncate(j.args, 400),
      createdAt: iso(created),
      enqueuedAt: iso(enqueued),
      startedAt: null,
      endedAt: null,
      durationSec: null,
      waitSec: enqueued != null ? Math.round((Date.now() - enqueued) / 1000) : null,
      attempts: j.retry_count == null ? null : num(j.retry_count, null),
      timeoutSec: null,
      worker: '',
      error: j.error_message ? truncate(`${j.error_class || ''} ${j.error_message}`.trim(), 500) : '',
      missing: !j.class
    };
  });

  return { jobs, total: num(total) };
}
