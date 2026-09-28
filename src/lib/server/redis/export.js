// Serialize queue data for download. Kept apart from the adapters so the shape
// the UI shows and the shape the file carries can never drift.
import { listJobs, STATE_ORDER, STATE_LABELS } from './index.js';
// The CSV rules live in one place — see csv.js for why.
import { toCsv, filename } from '../csv.js';

export { toCsv, filename };

/** Hard ceiling per export — a failed registry can hold millions of ids. */
export const MAX_EXPORT_ROWS = 20000;
const PAGE = 500;

const JOB_COLUMNS = [
  ['id', 'Job ID'],
  ['queue', 'Antrian'],
  ['state', 'Status'],
  ['name', 'Nama'],
  ['description', 'Deskripsi'],
  ['createdAt', 'Dibuat'],
  ['enqueuedAt', 'Masuk antrian'],
  ['startedAt', 'Mulai'],
  ['endedAt', 'Selesai'],
  ['waitSec', 'Tunggu (detik)'],
  ['durationSec', 'Durasi (detik)'],
  ['attempts', 'Percobaan'],
  ['worker', 'Worker'],
  ['error', 'Error']
];

/**
 * Every job in one queue+state, paged so a big registry never becomes one
 * enormous Redis reply.
 */
export async function collectJobs(client, { system, queue, state, limit = MAX_EXPORT_ROWS }) {
  const cap = Math.min(MAX_EXPORT_ROWS, Math.max(1, Number(limit) || MAX_EXPORT_ROWS));
  const rows = [];
  let total = 0;
  for (let offset = 0; offset < cap; offset += PAGE) {
    const size = Math.min(PAGE, cap - offset);
    const page = await listJobs(client, { system, queue, state, offset, limit: size });
    total = page.total;
    rows.push(...page.jobs);
    if (page.jobs.length < size || rows.length >= total) break;
  }
  return { jobs: rows, total, truncated: total > rows.length };
}

export function jobsToCsv(jobs) {
  return toCsv(
    JOB_COLUMNS.map(([, label]) => label),
    jobs.map((j) => JOB_COLUMNS.map(([key]) => j[key]))
  );
}

/** One row per queue, with every state this Redis actually reports. */
export function queuesToCsv(queues) {
  const states = STATE_ORDER.filter((s) => queues.some((q) => q.counts && q.counts[s] != null));
  const header = ['Sistem', 'Antrian', 'Status jeda', ...states.map((s) => STATE_LABELS[s] || s), 'Backlog'];
  const rows = queues.map((q) => [
    q.system,
    q.name,
    q.paused ? 'ya' : 'tidak',
    ...states.map((s) => (q.counts && q.counts[s] != null ? q.counts[s] : '')),
    q.backlog
  ]);
  return toCsv(header, rows);
}

export function workersToCsv(workers) {
  const header = [
    'Sistem', 'Worker', 'Status', 'Antrian', 'Job berjalan', 'Durasi job (detik)',
    'Heartbeat (detik lalu)', 'Sukses', 'Gagal', 'Host', 'PID', 'Mulai'
  ];
  const rows = workers.map((w) => [
    w.system, w.name, w.state, (w.queues || []).join(' '), w.currentJob, w.jobRuntimeSec,
    w.heartbeatAgoSec, w.succeeded, w.failed, w.host, w.pid, w.birthAt
  ]);
  return toCsv(header, rows);
}

