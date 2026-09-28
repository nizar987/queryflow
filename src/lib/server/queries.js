// Saved queries live in a file next to the connection profiles, not in the
// browser: a named query is something you come back to weeks later, and
// localStorage disappears the moment someone clears site data or switches
// browser. History stays client-side (see $lib/history.js) — that is noise;
// this is the library.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_PATH = '.queryflow/queries.json';

export function queriesPath() {
  return resolve(process.env.QUERYFLOW_QUERIES || DEFAULT_PATH);
}

export const MAX_QUERY_CHARS = 200000;

/** @returns {{queries: any[]}} */
export function readQueries() {
  const path = queriesPath();
  if (!existsSync(path)) return { queries: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const list = Array.isArray(parsed && parsed.queries) ? parsed.queries : [];
    return { queries: list.filter((q) => q && q.id && typeof q.query === 'string') };
  } catch (e) {
    const err = new Error(`Gagal membaca ${path}: ${e.message}`);
    err.code = 'QUERIES_UNREADABLE';
    throw err;
  }
}

function writeQueries(data) {
  const path = queriesPath();
  mkdirSync(dirname(path), { recursive: true });
  // Same reason as the connection file: rename over the old one so a crash
  // cannot leave a truncated library behind.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  try {
    // A saved query is not a password, but it can name internal tables and
    // embed identifiers — owner-only costs nothing.
    chmodSync(tmp, 0o600);
  } catch (e) {
    /* best effort */
  }
  renameSync(tmp, path);
}

/**
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validateQuery(input, { existing = null } = {}) {
  const name = String(input.name || '').trim();
  if (!name) return { ok: false, error: 'Nama query wajib diisi.' };
  if (name.length > 120) return { ok: false, error: 'Nama query maksimal 120 karakter.' };

  const query = String(input.query || '');
  if (!query.trim()) return { ok: false, error: 'Query kosong.' };
  // A saved query is text, not a payload dump — this only stops a runaway paste
  // from bloating the file.
  if (query.length > MAX_QUERY_CHARS) {
    return { ok: false, error: `Query terlalu panjang (maksimal ${MAX_QUERY_CHARS} karakter).` };
  }

  const now = new Date().toISOString();
  return {
    ok: true,
    value: {
      id: existing ? existing.id : randomUUID(),
      name,
      query,
      // Remembering which dialect and connection a query was written for is
      // what makes it runnable later without guessing.
      dialect: String(input.dialect || existing?.dialect || '').trim(),
      connectionId: String(input.connectionId || existing?.connectionId || '').trim(),
      note: String(input.note || '').trim().slice(0, 500),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    }
  };
}

export function listQueries() {
  // Newest edit first: the one you were just working on is the one you want.
  return readQueries().queries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function createQuery(input) {
  const v = validateQuery(input);
  if (!v.ok) return v;
  const data = readQueries();
  data.queries.push(v.value);
  writeQueries(data);
  return { ok: true, value: v.value };
}

export function updateQuery(id, input) {
  const data = readQueries();
  const i = data.queries.findIndex((q) => q.id === id);
  if (i === -1) return { ok: false, error: 'Query tersimpan tidak ditemukan.' };
  const v = validateQuery(input, { existing: data.queries[i] });
  if (!v.ok) return v;
  data.queries[i] = v.value;
  writeQueries(data);
  return { ok: true, value: v.value };
}

export function deleteQuery(id) {
  const data = readQueries();
  const next = data.queries.filter((q) => q.id !== id);
  if (next.length === data.queries.length) return { ok: false, error: 'Query tersimpan tidak ditemukan.' };
  writeQueries({ ...data, queries: next });
  return { ok: true };
}
