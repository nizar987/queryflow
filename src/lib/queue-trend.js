// Backlog over time, and when a queue deserves attention.
//
// A single number tells you a queue has 4 000 jobs. It cannot tell you whether
// that is a spike that is already draining or a worker that died an hour ago —
// which is the only thing worth knowing at 2am. The samples live here in module
// scope so they survive the panel being re-rendered.

const SERIES = new Map(); // `${connectionId}|${system}|${queue}` -> [{ at, backlog, failed }]
export const MAX_POINTS = 60;

export function seriesKey(connectionId, system, queue) {
  return `${connectionId}|${system}|${queue}`;
}

/** Record one poll for every queue in an overview. */
export function recordSamples(connectionId, queues, at = Date.now()) {
  for (const q of queues || []) {
    const key = seriesKey(connectionId, q.system, q.name);
    const list = SERIES.get(key) || [];
    list.push({ at, backlog: Number(q.backlog) || 0, failed: Number(q.failed) || 0 });
    if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
    SERIES.set(key, list);
  }
}

export function getSeries(connectionId, system, queue) {
  return SERIES.get(seriesKey(connectionId, system, queue)) || [];
}

export function clearSeries() {
  SERIES.clear();
}

/**
 * Where a queue is heading, from its own samples.
 * @returns {{points: number[], direction: 'naik'|'turun'|'datar'|'baru', delta: number, spanMs: number, peak: number}}
 */
export function trend(connectionId, system, queue) {
  const list = getSeries(connectionId, system, queue);
  const points = list.map((p) => p.backlog);
  if (list.length < 2) {
    return { points, direction: 'baru', delta: 0, spanMs: 0, peak: points[0] || 0 };
  }
  const first = list[0];
  const last = list[list.length - 1];
  const delta = last.backlog - first.backlog;
  // Ignore jitter: a queue moving by one or two jobs is not "rising".
  const threshold = Math.max(2, Math.round(first.backlog * 0.1));
  return {
    points,
    direction: delta > threshold ? 'naik' : delta < -threshold ? 'turun' : 'datar',
    delta,
    spanMs: last.at - first.at,
    peak: Math.max(...points)
  };
}

/** An SVG path for a sparkline, scaled to the box it is drawn in. */
export function sparklinePath(points, width = 64, height = 16) {
  if (!points || points.length < 2) return '';
  const max = Math.max(...points, 1);
  const step = width / (points.length - 1);
  return points
    .map((v, i) => {
      const x = (i * step).toFixed(1);
      // A flat zero series should sit on the floor, not float mid-box.
      const y = (height - (v / max) * (height - 2) - 1).toFixed(1);
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
}

export const DEFAULT_THRESHOLDS = {
  /** Backlog worth a warning, and worth waking someone. */
  backlogWarn: 100,
  backlogCrit: 1000,
  /** Failed jobs sitting in a registry. */
  failedWarn: 1,
  failedCrit: 50,
  /** Seconds since a worker last reported in. */
  heartbeatWarn: 120,
  heartbeatCrit: 300
};

const STORE_KEY = 'qf_queue_thresholds';

export function loadThresholds() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { ...DEFAULT_THRESHOLDS };
    const parsed = JSON.parse(raw);
    return sanitizeThresholds({ ...DEFAULT_THRESHOLDS, ...parsed });
  } catch (e) {
    return { ...DEFAULT_THRESHOLDS };
  }
}

export function saveThresholds(values) {
  const clean = sanitizeThresholds(values);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(clean));
  } catch (e) {
    /* storage unavailable — thresholds simply fall back to defaults next load */
  }
  return clean;
}

/** A threshold that is not a positive number would silently disable an alarm. */
export function sanitizeThresholds(values) {
  const out = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
    const n = Number(values?.[key]);
    if (Number.isFinite(n) && n >= 0) out[key] = Math.floor(n);
  }
  // A critical level below the warning level would never fire.
  if (out.backlogCrit < out.backlogWarn) out.backlogCrit = out.backlogWarn;
  if (out.failedCrit < out.failedWarn) out.failedCrit = out.failedWarn;
  if (out.heartbeatCrit < out.heartbeatWarn) out.heartbeatCrit = out.heartbeatWarn;
  return out;
}

/** @returns {'crit'|'warn'|''} */
export function queueLevel(queue, thresholds) {
  const t = thresholds || DEFAULT_THRESHOLDS;
  const backlog = Number(queue.backlog) || 0;
  const failed = Number(queue.failed) || 0;
  if (backlog >= t.backlogCrit || failed >= t.failedCrit) return 'crit';
  if (backlog >= t.backlogWarn || failed >= t.failedWarn) return 'warn';
  // A paused queue with work in it is not draining, however small the backlog.
  if (queue.paused && backlog > 0) return 'warn';
  return '';
}

/** @returns {'crit'|'warn'|''} */
export function workerLevel(worker, thresholds) {
  const t = thresholds || DEFAULT_THRESHOLDS;
  const beat = worker.heartbeatAgoSec;
  if (beat == null) return '';
  if (beat >= t.heartbeatCrit) return 'crit';
  if (beat >= t.heartbeatWarn) return 'warn';
  return '';
}

/** One line per problem, ready to show above the tables. */
export function alerts(data, thresholds) {
  const out = [];
  for (const q of data.queues || []) {
    const level = queueLevel(q, thresholds);
    if (!level) continue;
    const reasons = [];
    if (q.backlog >= thresholds.backlogWarn) reasons.push(`backlog ${q.backlog.toLocaleString('id-ID')}`);
    if (q.failed >= thresholds.failedWarn) reasons.push(`${q.failed.toLocaleString('id-ID')} gagal`);
    if (q.paused && q.backlog > 0) reasons.push('dijeda tapi masih ada job');
    out.push({ level, scope: 'queue', name: q.name, system: q.system, text: reasons.join(' · ') });
  }
  for (const w of data.workers || []) {
    const level = workerLevel(w, thresholds);
    if (!level) continue;
    out.push({
      level,
      scope: 'worker',
      name: w.name,
      system: w.system,
      text: `heartbeat terakhir ${w.heartbeatAgoSec} detik lalu`
    });
  }
  // Critical first, then by name, so the list reads the same way every refresh.
  return out.sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'crit' ? -1 : 1));
}
