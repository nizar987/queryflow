// Dispatch a query to the right driver, and keep pooled connections keyed by
// the *content* of the profile — editing a host or password must not keep
// reusing a pool that was opened against the old values.
import { createHash } from 'node:crypto';
import * as mysql from './drivers/mysql.js';
import * as postgres from './drivers/postgres.js';
import * as mongo from './drivers/mongo.js';
import * as redis from './drivers/redis.js';
import { classifyStatement, readOnlyViolation, splitBatch } from '../statement.js';
import { assertKillable } from './kill-guard.js';
import { createRunControl, timeoutMsFor } from './run-control.js';
import { describeQueryError, stopCodeOf } from './errors.js';

/** More than this in one click is a migration, not a query session. */
export const MAX_BATCH_STATEMENTS = 100;

const DRIVERS = {
  MariaDB: mysql,
  MySQL: mysql,
  PostgreSQL: postgres,
  MongoDB: mongo,
  Redis: redis
};

export const MAX_ROWS_LIMIT = 5000;
export const DEFAULT_MAX_ROWS = 500;

function driverFor(conn) {
  const d = DRIVERS[conn.dialect];
  if (!d) {
    const err = new Error(`Dialek "${conn.dialect}" tidak didukung.`);
    err.expected = true;
    throw err;
  }
  return d;
}

function cacheKey(conn) {
  const h = createHash('sha1')
    .update(JSON.stringify([conn.dialect, conn.host, conn.port, conn.user, conn.password, conn.database, conn.ssl, conn.sslMode, conn.sslCa, conn.uri]))
    .digest('hex')
    .slice(0, 12);
  return `${conn.id}:${h}`;
}

export async function testConnection(conn) {
  const driver = driverFor(conn);
  const started = Date.now();
  const info = await driver.ping(conn, cacheKey(conn));
  return { ...info, durationMs: Date.now() - started };
}

function assertReadAllowed(conn, text) {
  if (!conn.readOnly) return;
  const violation = readOnlyViolation(conn.dialect, text);
  if (violation) {
    const err = new Error(`${violation} Statement tidak dijalankan.`);
    err.expected = true;
    throw err;
  }
}

/**
 * @typedef {{ maxRows?: number, runId?: string | null }} RunOptions
 */

/**
 * Whatever the Query tab sends: one statement, or a script of several.
 * @param {any} conn
 * @param {string} text
 * @param {RunOptions} [opts]
 * @returns {Promise<{ result: object } | { results: object[], durationMs: number }>}
 */
export async function runScript(conn, text, opts = {}) {
  driverFor(conn);
  // Judged as a whole before anything runs: a read-only profile refuses the
  // script, not just the statement that would write.
  assertReadAllowed(conn, text);
  const statements = splitBatch(conn.dialect, text);
  if (statements.length === 0) {
    throw Object.assign(new Error('Tidak ada statement untuk dijalankan — isinya hanya komentar.'), { expected: true });
  }
  if (statements.length === 1) return { result: await runQuery(conn, statements[0], opts) };
  if (statements.length > MAX_BATCH_STATEMENTS) {
    throw Object.assign(
      new Error(`${statements.length} statement sekaligus — maksimal ${MAX_BATCH_STATEMENTS}. Jalankan per bagian.`),
      { expected: true }
    );
  }
  return runBatch(conn, statements, opts);
}

/**
 * Run statements in order on one connection, stopping at the first failure.
 * Each statement gets the profile's full time limit. The connection is closed
 * afterwards rather than pooled, so a transaction the script opened and did
 * not commit is rolled back instead of leaking into the next query.
 */
/**
 * @param {any} conn
 * @param {string[]} statements
 * @param {RunOptions} opts
 */
async function runBatch(conn, statements, opts) {
  const driver = driverFor(conn);
  const open = need(driver, 'openSession', conn.dialect);
  const maxRows = clampMaxRows(opts.maxRows);
  const control = createRunControl({ runId: opts.runId || null, timeoutMs: timeoutMsFor(conn) });
  const started = Date.now();
  /** @type {object[]} */
  const results = [];
  let session = null;
  try {
    session = await open(conn, cacheKey(conn), control);
    let stopped = false;
    for (const [index, statement] of statements.entries()) {
      if (stopped) {
        results.push({ index, statement, status: 'skipped' });
        continue;
      }
      control.startStatement();
      try {
        const result = await session.run(statement, { maxRows });
        results.push({ index, statement, status: 'ok', result });
      } catch (e) {
        const err = control.translate(e);
        results.push({ index, statement, status: 'error', error: describeQueryError(err), code: stopCodeOf(err) });
        stopped = true;
      }
    }
  } catch (e) {
    // Could not even get a connection: nothing ran.
    throw control.translate(e);
  } finally {
    control.done();
    if (session) await session.close({ discard: true });
  }
  return { results, durationMs: Date.now() - started };
}

export async function runQuery(conn, text, opts = {}) {
  const driver = driverFor(conn);
  assertReadAllowed(conn, text);
  const maxRows = clampMaxRows(opts.maxRows);
  const run = need(driver, 'run', conn.dialect);

  // Every run is time-limited by its profile; a runId also makes it
  // cancellable from the browser.
  const control = createRunControl({ runId: opts.runId || null, timeoutMs: timeoutMsFor(conn) });
  try {
    return await run(conn, cacheKey(conn), text, { maxRows, control });
  } catch (e) {
    throw control.translate(e);
  } finally {
    control.done();
  }
}

export function clampMaxRows(n) {
  const v = Number(n);
  // 0 is the "no limit" sentinel — slice(0, Infinity) returns every row
  if (v === 0) return Infinity;
  if (!Number.isFinite(v) || v < 1) return DEFAULT_MAX_ROWS;
  return Math.min(MAX_ROWS_LIMIT, Math.floor(v));
}

/** Live sessions + connection budget for the Log tab. */
export async function fetchProcessList(conn) {
  const driver = driverFor(conn);
  if (!driver.processList) {
    const err = new Error(`Processlist belum didukung untuk ${conn.dialect}.`);
    err.expected = true;
    throw err;
  }
  const started = Date.now();
  const data = await driver.processList(conn, cacheKey(conn));
  return { ...data, durationMs: Date.now() - started, at: Date.now() };
}

// What each driver entry point means to a user, so a missing capability reads
// as an explanation instead of an internal function name.
const FEATURE = {
  run: 'Menjalankan query',
  listTables: 'Daftar tabel',
  previewTable: 'Pratinjau tabel',
  tableInfo: 'Info tabel',
  readTable: 'Membaca baris tabel',
  updateCell: 'Mengubah sel',
  insertRow: 'Menambah baris',
  deleteRow: 'Menghapus baris',
  processList: 'Processlist',
  explainQuery: 'EXPLAIN',
  listIndexes: 'Daftar index',
  killSession: 'Menghentikan sesi',
  queueOverview: 'Pemantauan antrian',
  queueJobs: 'Daftar job antrian',
  queueJobsForExport: 'Ekspor job antrian'
};

const QUEUE_ONLY = new Set(['Redis']);

/**
 * The read-only gate. Every path that can change data goes through here, on the
 * server: the flag lives in the profile file, and the browser only ever gets a
 * copy it cannot use to grant itself permission.
 */
function assertWritable(conn, what) {
  if (!conn.readOnly) return;
  const err = new Error(
    `Koneksi "${conn.name}" ditandai read-only — ${what} ditolak. Lepas tanda read-only di Kelola koneksi kalau memang ingin menulis.`
  );
  err.expected = true;
  throw err;
}

function need(driver, fn, dialect) {
  if (!driver[fn]) {
    const what = FEATURE[fn] || fn;
    const hint = QUEUE_ONLY.has(dialect)
      ? ` Koneksi ${dialect} hanya dipakai di tab Antrian.`
      : fn.startsWith('queue')
        ? ' Tab Antrian membutuhkan koneksi Redis.'
        : '';
    const err = new Error(`${what} belum didukung untuk ${dialect}.${hint}`);
    err.expected = true;
    throw err;
  }
  return driver[fn];
}

/**
 * Columns, primary key, exact row count, and what the connected database user
 * is actually allowed to do. The UI gates editing on this, never on a guess.
 */
export async function fetchTableInfo(conn, table, opts = {}) {
  const driver = driverFor(conn);
  const info = await need(driver, 'tableInfo', conn.dialect)(conn, cacheKey(conn), table, opts);

  // A row can only be edited if it can be addressed unambiguously.
  const hasKey = Array.isArray(info.primaryKey) && info.primaryKey.length > 0;
  const writable = !conn.readOnly;
  const reasons = [];
  if (conn.readOnly) reasons.push('koneksi ini ditandai read-only');
  if (!hasKey) reasons.push('tabel ini tidak punya primary key');
  if (!info.privileges.update) reasons.push('user database tidak punya privilege UPDATE');

  return {
    ...info,
    // Whichever number we have; `exactCount` says which one it is.
    rowCount: info.totalRows ?? info.approxRows ?? 0,
    exactCount: info.totalRows != null,
    readOnlyConnection: !!conn.readOnly,
    editable: writable && hasKey && info.privileges.update,
    canInsert: writable && info.privileges.insert,
    canDelete: writable && hasKey && info.privileges.delete,
    readOnlyReason: reasons.join(' · ')
  };
}

/** One page of a table. Paging is what makes every row reachable. */
export async function readTablePage(conn, table, opts) {
  const driver = driverFor(conn);
  return need(driver, 'readTable', conn.dialect)(conn, cacheKey(conn), table, opts);
}

/**
 * The engine's own CREATE TABLE, or null where the engine has no such
 * statement (PostgreSQL). Callers fall back to rebuilding it from metadata.
 */
export async function fetchTableDDL(conn, table) {
  const driver = driverFor(conn);
  if (!driver.tableDDL) return null;
  return driver.tableDDL(conn, cacheKey(conn), table);
}

export async function writeCell(conn, table, payload) {
  const driver = driverFor(conn);
  assertWritable(conn, 'mengubah sel');
  return need(driver, 'updateCell', conn.dialect)(conn, cacheKey(conn), table, payload);
}

export async function insertTableRow(conn, table, values) {
  const driver = driverFor(conn);
  assertWritable(conn, 'menambah baris');
  return need(driver, 'insertRow', conn.dialect)(conn, cacheKey(conn), table, values);
}

export async function deleteTableRow(conn, table, keyValues) {
  const driver = driverFor(conn);
  assertWritable(conn, 'menghapus baris');
  return need(driver, 'deleteRow', conn.dialect)(conn, cacheKey(conn), table, keyValues);
}

/**
 * EXPLAIN for the given statement. `analyze` (Postgres only, currently) opts
 * into actually executing the query for real timings — callers must be
 * explicit, since that has real side effects on a live database (locks,
 * cache churn) even though it's a read.
 */
export async function explainQuery(conn, text, { analyze = false } = {}) {
  const driver = driverFor(conn);
  if (!driver.explainQuery) {
    const err = new Error(`EXPLAIN belum didukung untuk ${conn.dialect}.`);
    err.expected = true;
    throw err;
  }
  // EXPLAIN ANALYZE does not simulate — it runs the statement for real. On
  // PostgreSQL that means an EXPLAIN ANALYZE UPDATE/DELETE genuinely writes,
  // which is exactly the opposite of what "diagnostic" implies. Since callers
  // reasonably assume EXPLAIN is read-only, that assumption is enforced here
  // rather than trusted to the UI.
  if (analyze && classifyStatement(conn.dialect, text).write) {
    const err = new Error(
      'EXPLAIN ANALYZE menjalankan statement sungguhan, termasuk UPDATE/DELETE — hanya diizinkan untuk SELECT. Gunakan EXPLAIN tanpa ANALYZE untuk melihat rencana tanpa mengeksekusi.'
    );
    err.expected = true;
    throw err;
  }
  const started = Date.now();
  const raw = await driver.explainQuery(conn, cacheKey(conn), text, { analyze });
  return { raw, durationMs: Date.now() - started };
}

/**
 * Stop a session, after checking it is one worth stopping.
 *
 * The id is re-validated against a fresh processlist rather than trusted from
 * the browser: the target must still exist, and it must be a client session.
 * Server internals (checkpointer, autovacuum, MySQL's Daemon threads) are not
 * something to signal from a query tool, and an id that has since been reused
 * would otherwise kill an unrelated session.
 */
export async function killSession(conn, id, { mode = 'query' } = {}) {
  const driver = driverFor(conn);
  const kill = need(driver, 'killSession', conn.dialect);

  // Aborting a statement rolls back whatever it had done so far, so this is a
  // change to the server — exactly what a read-only profile promises not to do.
  assertWritable(conn, 'menghentikan sesi');

  const { processes } = await fetchProcessList(conn);
  const target = assertKillable(processes, id);

  const started = Date.now();
  const result = await kill(conn, cacheKey(conn), id, { mode });
  return {
    ...result,
    durationMs: Date.now() - started,
    // Echo what was actually stopped, so the UI can say it plainly.
    target: { id: String(target.id), user: target.user, db: target.db, seconds: target.seconds, query: target.query }
  };
}

/**
 * Indexes already installed on the given tables. Read-only, and cheap enough
 * to run against production: it reads the catalog, never the table data.
 */
export async function fetchIndexes(conn, tables) {
  const driver = driverFor(conn);
  const list = Array.isArray(tables) ? tables.filter(Boolean) : [];
  if (list.length === 0) return { indexes: [], durationMs: 0 };
  const started = Date.now();
  const indexes = await need(driver, 'listIndexes', conn.dialect)(conn, cacheKey(conn), list);
  return { indexes, durationMs: Date.now() - started };
}

/** Queues, workers, and Redis health for the Antrian tab. */
export async function fetchQueueOverview(conn) {
  const driver = driverFor(conn);
  const started = Date.now();
  const data = await need(driver, 'queueOverview', conn.dialect)(conn, cacheKey(conn));
  return { ...data, durationMs: Date.now() - started, at: Date.now() };
}

/** One page of jobs from a single queue + state. */
export async function fetchQueueJobs(conn, params) {
  const driver = driverFor(conn);
  const started = Date.now();
  const data = await need(driver, 'queueJobs', conn.dialect)(conn, cacheKey(conn), params);
  return { ...data, durationMs: Date.now() - started };
}

/** Every job in a queue + state, for download. Capped inside the driver. */
export async function collectQueueJobs(conn, params) {
  const driver = driverFor(conn);
  return need(driver, 'queueJobsForExport', conn.dialect)(conn, cacheKey(conn), params);
}

/** Drop any pooled connections for a profile (called on edit/delete). */
export function disposeConnection(conn) {
  if (!conn) return;
  const d = DRIVERS[conn.dialect];
  if (d && d.dispose) d.dispose(cacheKey(conn));
}

/** List all tables/collections for a connection. */
export async function fetchTables(conn) {
  const driver = driverFor(conn);
  if (!driver.listTables) {
    const err = new Error(`listTables belum didukung untuk ${conn.dialect}.`);
    err.expected = true;
    throw err;
  }
  return driver.listTables(conn, cacheKey(conn));
}

/** Preview up to 1 000 rows from a single table/collection. */
export async function previewTable(conn, table) {
  const driver = driverFor(conn);
  if (!driver.previewTable) {
    const err = new Error(`previewTable belum didukung untuk ${conn.dialect}.`);
    err.expected = true;
    throw err;
  }
  const started = Date.now();
  const result  = await driver.previewTable(conn, cacheKey(conn), table);
  return { ...result, durationMs: Date.now() - started };
}
