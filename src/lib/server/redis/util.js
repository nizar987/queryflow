// Helpers shared by every queue-system adapter (RQ, BullMQ, Sidekiq).

/**
 * Non-blocking key discovery. KEYS would freeze a production Redis for the
 * duration of the sweep, so every lookup goes through SCAN with a hard cap —
 * a keyspace with millions of keys must not turn one page load into an outage.
 * @returns {Promise<{keys: string[], truncated: boolean}>}
 */
export async function scanKeys(client, pattern, { limit = 3000, count = 500 } = {}) {
  // On a cluster the keyspace is split across masters, and SCAN is per node —
  // scanning only the client's default node would silently miss most queues.
  const targets = typeof client.nodes === 'function' ? client.nodes('master') : [client];
  const keys = [];

  for (const node of targets) {
    let cursor = '0';
    do {
      const [next, batch] = await node.scan(cursor, 'MATCH', pattern, 'COUNT', count);
      cursor = next;
      for (const k of batch) {
        keys.push(k);
        if (keys.length >= limit) return { keys: dedupe(keys), truncated: true };
      }
    } while (cursor !== '0');
  }
  return { keys: dedupe(keys), truncated: false };
}

// SCAN may return the same key twice across cursor iterations — that is normal
// and documented, so callers get a de-duplicated list rather than phantom queues.
function dedupe(list) {
  return [...new Set(list)];
}

/** Run many small reads in one round trip. @returns {any[]} results, errors as null. */
export async function pipe(client, commands) {
  if (commands.length === 0) return [];

  // A cluster pipeline is refused unless every key hashes to the same slot, and
  // queue keys deliberately do not. Sending the commands individually costs
  // round trips but is the only thing that works — ioredis routes each one to
  // the node that owns its key.
  if (typeof client.nodes === 'function') {
    const results = await Promise.all(
      commands.map(([name, ...args]) => client[name](...args).catch(() => null))
    );
    return results;
  }

  const res = await client.pipeline(commands).exec();
  return res.map(([err, value]) => (err ? null : value));
}

export function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Timestamps arrive in three shapes: ISO strings (RQ), epoch milliseconds
 * (BullMQ), and epoch seconds with a fraction (Sidekiq).
 * @returns {number|null} epoch milliseconds
 */
export function parseTime(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Anything below ~2001 in milliseconds is really a seconds-based stamp.
    return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
  }
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

export function iso(ms) {
  return ms == null ? null : new Date(ms).toISOString();
}

/** Job payloads can be megabytes; never ship one whole into the browser. */
export function truncate(v, max = 600) {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : safeStringify(v);
  return s.length > max ? s.slice(0, max) + `… (+${s.length - max} char)` : s;
}

export function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

/** Parse a JSON payload, falling back to the raw text when it isn't JSON. */
export function maybeJson(text) {
  if (typeof text !== 'string' || !text) return null;
  const t = text.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}

/** Ordered slice of a list/zset id range, shared by all adapters. */
export function pageRange(offset, limit) {
  const start = Math.max(0, Math.floor(num(offset, 0)));
  const size = Math.min(1000, Math.max(1, Math.floor(num(limit, 50))));
  return { start, stop: start + size - 1, size };
}
