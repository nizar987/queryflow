// One view over every queue system that happens to live in the same Redis.
// A Frappe box runs python-rq, a Node box runs BullMQ, and plenty of servers
// host both — so detection is additive, never an either/or guess.
import * as rq from './rq.js';
import * as bullmq from './bullmq.js';
import * as sidekiq from './sidekiq.js';
import { num } from './util.js';

const SYSTEMS = [rq, bullmq, sidekiq];

export const SYSTEM_LABELS = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.label]));

/** Canonical column order for the UI; each system fills in the subset it has. */
export const STATE_ORDER = [
  'waiting',
  'active',
  'paused',
  'prioritized',
  'delayed',
  'scheduled',
  'deferred',
  'waitingChildren',
  'retry',
  'failed',
  'dead',
  'finished',
  'canceled'
];

export const STATE_LABELS = {
  waiting: 'Menunggu',
  active: 'Berjalan',
  paused: 'Antre (jeda)',
  prioritized: 'Prioritas',
  delayed: 'Tertunda',
  scheduled: 'Terjadwal',
  deferred: 'Ditangguhkan',
  waitingChildren: 'Menunggu anak',
  retry: 'Retry',
  failed: 'Gagal',
  dead: 'Mati',
  finished: 'Selesai',
  canceled: 'Dibatalkan'
};

function systemFor(id) {
  const s = SYSTEMS.find((x) => x.id === id);
  if (!s) {
    const err = new Error(`Sistem antrian "${id}" tidak dikenal.`);
    err.expected = true;
    throw err;
  }
  return s;
}

export function statesOf(systemId) {
  return systemFor(systemId).STATES;
}

/**
 * Queues, workers, and the server headline in one pass.
 * A system that throws (permissions, odd key layout) must not blank the whole
 * page — its failure is reported next to the systems that did work.
 */
export async function overview(client) {
  const queues = [];
  const workers = [];
  const systems = [];
  const warnings = [];

  for (const s of SYSTEMS) {
    try {
      const [qs, ws] = await Promise.all([s.listQueues(client), s.listWorkers(client)]);
      if (qs.length === 0 && ws.length === 0) continue;
      queues.push(...qs);
      workers.push(...ws);
      const entry = { id: s.id, label: s.label, queues: qs.length, workers: ws.length };
      if (s.globals) entry.globals = await s.globals(client).catch(() => null);
      if (s.scheduler) entry.scheduler = await s.scheduler(client).catch(() => null);
      systems.push(entry);
    } catch (e) {
      warnings.push(`${s.label}: ${e.message}`);
    }
  }

  queues.sort((a, b) => b.backlog - a.backlog || a.name.localeCompare(b.name));

  return {
    systems,
    queues,
    workers: workers.sort((a, b) => Number(b.busy) - Number(a.busy) || a.name.localeCompare(b.name)),
    totals: {
      queues: queues.length,
      workers: workers.length,
      workersBusy: workers.filter((w) => w.busy).length,
      // Stale heartbeats are the usual reason a queue stops draining while the
      // pods still look "Running" to Kubernetes.
      workersStale: workers.filter((w) => w.heartbeatAgoSec != null && w.heartbeatAgoSec > 120).length,
      backlog: queues.reduce((a, q) => a + num(q.backlog), 0),
      failed: queues.reduce((a, q) => a + num(q.failed), 0),
      paused: queues.filter((q) => q.paused).length
    },
    warnings
  };
}

export function listJobs(client, { system, queue, state, offset, limit }) {
  return systemFor(system).listJobs(client, { queue, state, offset, limit });
}
