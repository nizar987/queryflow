// Query history that survives closing the tab.
//
// It used to live in sessionStorage, which meant "what did I run this morning?"
// was unanswerable by lunch. localStorage is the right store for it: history is
// per-browser working memory, unlike saved queries, which are a project artifact
// and live in a file on the server.

const KEY = 'qf_query_history';
export const MAX_ENTRIES = 100;
/** Long queries are kept whole — truncating them would defeat the point. */
const MAX_CHARS_PER_ENTRY = 20000;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.q === 'string') : [];
  } catch (e) {
    return []; // corrupt or unavailable storage must not break the page
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return list;
  } catch (e) {
    // Quota exceeded: keep the newest half rather than losing everything.
    const trimmed = list.slice(0, Math.floor(MAX_ENTRIES / 2));
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed));
      // Return what was actually stored — returning the full list would show
      // entries in the UI that vanish on the next reload.
      return trimmed;
    } catch (e2) {
      /* storage is unusable — history is a convenience, not a requirement */
      return list;
    }
  }
}

export function loadHistory() {
  return read();
}

/**
 * Record one run. Re-running the same text moves the existing entry to the top
 * instead of filling the list with duplicates, but keeps the newest outcome.
 * @param {{q: string, ok: boolean, ms: number, connId?: string, conn?: string, dialect?: string, rows?: number|null}} entry
 */
export function remember(entry) {
  const q = String(entry.q || '');
  if (!q.trim() || q.length > MAX_CHARS_PER_ENTRY) return read();
  const record = {
    // Two runs can land in the same millisecond, so the timestamp alone is not
    // an identity — deleting one entry would take its twin with it.
    id: nextId(),
    q,
    ok: !!entry.ok,
    ms: Number(entry.ms) || 0,
    connId: entry.connId || '',
    conn: entry.conn || '',
    dialect: entry.dialect || '',
    rows: entry.rows == null ? null : Number(entry.rows),
    ts: Date.now()
  };
  const next = [record, ...read().filter((e) => e.q !== q)].slice(0, MAX_ENTRIES);
  return write(next);
}

export function removeEntry(id) {
  return write(read().filter((e) => (e.id ?? e.ts) !== id));
}

let seq = 0;
function nextId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${seq++}`;
}

export function clearHistory() {
  return write([]);
}

/** Free-text filter over the query, the connection name, and the dialect. */
export function searchHistory(list, term) {
  const t = String(term || '').trim().toLowerCase();
  if (!t) return list;
  return list.filter((e) => `${e.q} ${e.conn} ${e.dialect}`.toLowerCase().includes(t));
}
