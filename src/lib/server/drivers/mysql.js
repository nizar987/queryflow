// MariaDB / MySQL driver. Pools are cached per connection profile so repeated
// runs from the Query tab don't pay a TCP + auth handshake each time.
import mysql from 'mysql2/promise';
import { toGrid, encodeCell } from './cells.js';
import { tlsOptions } from '../tls.js';
import { assertIdent, assertColumn, qMy, assertKeyComplete, assertSingleRow } from './identifiers.js';
import { parseConditions, buildWhere } from './where.js';

// mysql2 column type codes that are numeric. BIGINT and DECIMAL arrive as
// strings (exact precision), but the grid should still align them as numbers.
const NUMERIC_TYPES = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);

const pools = new Map(); // profileKey -> pool

function connectOptions(conn) {
  return conn.uri
    ? { uri: conn.uri, dateStrings: false, multipleStatements: false }
    : {
        host: conn.host,
        port: conn.port,
        user: conn.user || undefined,
        password: conn.password || undefined,
        database: conn.database || undefined,
        ssl: tlsOptions(conn) || undefined,
        multipleStatements: false,
        // Keep large integers exact — JS numbers silently lose precision past 2^53.
        supportBigNumbers: true,
        bigNumberStrings: true
      };
}

function poolFor(conn, key) {
  let pool = pools.get(key);
  if (pool) return pool;
  pool = mysql.createPool({ ...connectOptions(conn), connectionLimit: 4 });
  pools.set(key, pool);
  return pool;
}

/**
 * KILL QUERY from a connection of its own, outside the pool: when all four
 * pooled connections are busy — the usual reason someone reaches for Cancel —
 * waiting for one of them would wait for the very query being cancelled.
 */
async function killQuery(conn, threadId) {
  const c = await mysql.createConnection(connectOptions(conn));
  try {
    await c.query(`KILL QUERY ${assertThreadId(threadId)}`);
  } finally {
    await c.end().catch(() => c.destroy());
  }
}

export async function ping(conn, key) {
  const c = await poolFor(conn, key).getConnection();
  try {
    const [rows] = await c.query('SELECT VERSION() AS v');
    return { version: rows && rows[0] ? String(rows[0].v) : 'unknown' };
  } finally {
    c.release();
  }
}

/**
 * One pooled connection held for a run or a whole batch, so session state
 * (SET @var, temporary tables, BEGIN … COMMIT) carries from one statement to
 * the next, and the thread id a kill targets is always this run's.
 * @param {any} conn
 * @param {string} key
 * @param {import('../run-control.js').RunControl | null} [control]
 */
export async function openSession(conn, key, control = null) {
  const c = await poolFor(conn, key).getConnection();
  control?.onCancel(() => killQuery(conn, c.threadId));
  return {
    /** @param {string} sql @param {{ maxRows: number }} opts */
    async run(sql, { maxRows }) {
      control?.throwIfCancelled();
      const started = Date.now();
      const [result, fields] = await c.query({ sql, rowsAsArray: false });
      return shapeResult(sql, result, fields, maxRows, Date.now() - started);
    },
    /**
     * `discard` closes the connection instead of pooling it — which also rolls
     * back a transaction the script left open. A connection that received
     * KILL QUERY is always discarded: a kill landing just after the statement
     * finished would otherwise interrupt whatever runs on it next.
     * @param {{ discard?: boolean }} [opts]
     */
    async close({ discard = false } = {}) {
      await control?.settled();
      if (discard || control?.reason) c.destroy();
      else c.release();
    }
  };
}

/**
 * @param {any} conn
 * @param {string} key
 * @param {string} sql
 * @param {{ maxRows: number, control?: import('../run-control.js').RunControl | null }} opts
 */
export async function run(conn, key, sql, { maxRows, control = null }) {
  const session = await openSession(conn, key, control);
  try {
    return await session.run(sql, { maxRows });
  } finally {
    await session.close();
  }
}

function shapeResult(sql, raw, rawFields, maxRows, durationMs) {
  // CALL answers with its result sets followed by a status header; show the first set.
  const nested = Array.isArray(raw) && Array.isArray(raw[0]);
  const result = nested ? raw[0] : raw;
  const fields = nested && Array.isArray(rawFields) ? rawFields[0] : rawFields;

  // SELECT/SHOW/DESCRIBE return an array of row objects; DML returns a header.
  if (Array.isArray(result)) {
    const capped = result.slice(0, maxRows);
    const cols = Array.isArray(fields) && fields.length ? fields.map((f) => f.name) : null;
    const grid = toGrid(capped, cols);
    if (Array.isArray(fields)) {
      for (let i = 0; i < fields.length; i++) {
        if (!NUMERIC_TYPES.has(fields[i].columnType)) continue;
        for (const row of grid.rows) if (row[i] && row[i].v !== null) row[i].t = 'number';
      }
    }
    return {
      kind: 'rows',
      ...grid,
      rowCount: result.length,
      truncated: result.length > capped.length,
      affectedRows: null,
      command: firstKeyword(sql),
      durationMs
    };
  }

  return {
    kind: 'ack',
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    affectedRows: typeof result.affectedRows === 'number' ? result.affectedRows : null,
    insertId: result.insertId ? encodeCell(result.insertId).v : null,
    info: result.info || '',
    command: firstKeyword(sql),
    durationMs
  };
}

/**
 * Live sessions + connection budget.
 * information_schema.PROCESSLIST needs the PROCESS privilege to see other
 * users' threads; without it the server silently returns only our own, which
 * is why the summary reports what the *server* counts, not rows.length.
 */
export async function processList(conn, key) {
  const pool = poolFor(conn, key);

  const [rows] = await pool.query(
    `SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO
       FROM information_schema.PROCESSLIST
      ORDER BY TIME DESC`
  );

  const status = await statusVars(pool, ['Threads_connected', 'Threads_running', 'Max_used_connections', 'Aborted_connects']);
  const vars = await systemVars(pool, ['max_connections', 'wait_timeout']);

  const processes = rows.map((r) => ({
    id: String(r.ID),
    busy: !!r.COMMAND && r.COMMAND !== 'Sleep',
    internal: r.COMMAND === 'Daemon',
    user: r.USER || '',
    client: r.HOST || '',
    db: r.DB || '',
    command: r.COMMAND || '',
    state: r.STATE || '',
    seconds: r.TIME == null ? null : Number(r.TIME),
    query: r.INFO || ''
  }));

  const total = num(status.Threads_connected, processes.length);
  const active = num(status.Threads_running, processes.filter((p) => p.busy).length);

  return {
    processes,
    summary: {
      total,
      active,
      idle: Math.max(0, total - active),
      max: num(vars.max_connections, null),
      idleLabel: 'Sleep',
      extra: [
        { label: 'Puncak sesi', value: status.Max_used_connections ?? '—' },
        { label: 'Koneksi gagal', value: status.Aborted_connects ?? '—' },
        { label: 'wait_timeout', value: vars.wait_timeout ? vars.wait_timeout + 's' : '—' }
      ],
      // PROCESS privilege missing → we only ever see ourselves.
      partial: total > processes.length + 1
    }
  };
}

async function statusVars(pool, names) {
  const [rows] = await pool.query(
    `SHOW GLOBAL STATUS WHERE Variable_name IN (${names.map(() => '?').join(',')})`,
    names
  );
  return Object.fromEntries(rows.map((r) => [r.Variable_name, r.Value]));
}

async function systemVars(pool, names) {
  const [rows] = await pool.query(
    `SHOW VARIABLES WHERE Variable_name IN (${names.map(() => '?').join(',')})`,
    names
  );
  return Object.fromEntries(rows.map((r) => [r.Variable_name, r.Value]));
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function dispose(key) {
  const pool = pools.get(key);
  if (!pool) return;
  pools.delete(key);
  pool.end().catch(() => {});
}

function firstKeyword(sql) {
  const m = /^\s*(\w+)/.exec(String(sql).replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/)\s*/g, ''));
  return m ? m[1].toUpperCase() : '';
}

/** List all base tables in the current database. */
export async function listTables(conn, key) {
  const pool = poolFor(conn, key);
  const [rows] = await pool.query(`
    SELECT TABLE_NAME AS name,
           TABLE_ROWS  AS approx_rows,
           TABLE_COMMENT AS comment
    FROM   information_schema.TABLES
    WHERE  TABLE_SCHEMA = DATABASE()
      AND  TABLE_TYPE   = 'BASE TABLE'
    ORDER  BY TABLE_NAME
  `);
  return rows.map((r) => ({
    name:       String(r.name),
    approxRows: r.approx_rows != null ? Number(r.approx_rows) : null,
    comment:    r.comment || ''
  }));
}

/** Return up to 1 000 rows from the named table. */
export async function previewTable(conn, key, table) {
  // Only allow identifiers that consist of word chars, spaces, dashes, or dots.
  if (!/^[\w\-. ]+$/.test(table)) {
    throw Object.assign(new Error('Nama tabel tidak valid.'), { expected: true });
  }
  const pool    = poolFor(conn, key);
  const safe    = '`' + table.replace(/`/g, '``') + '`';
  const started = Date.now();
  const [result, fields] = await pool.query({ sql: `SELECT * FROM ${safe} LIMIT 1000`, rowsAsArray: false });
  const durationMs = Date.now() - started;
  const capped = Array.isArray(result) ? result.slice(0, 1000) : [];
  const cols   = Array.isArray(fields) && fields.length ? fields.map((f) => f.name) : null;
  const grid   = toGrid(capped, cols);
  if (Array.isArray(fields)) {
    for (let i = 0; i < fields.length; i++) {
      if (!NUMERIC_TYPES.has(fields[i].columnType)) continue;
      for (const row of grid.rows) if (row[i] && row[i].v !== null) row[i].t = 'number';
    }
  }
  return {
    kind: 'rows', ...grid,
    rowCount:     Array.isArray(result) ? result.length : 0,
    truncated:    Array.isArray(result) && result.length >= 1000,
    affectedRows: null,
    command:      'SELECT',
    durationMs
  };
}

// ---------------------------------------------------------------------------
// Table browser: metadata, paged reads, and single-row writes.
// ---------------------------------------------------------------------------

/**
 * Effective privileges for the current user on one table.
 * SHOW GRANTS is the only portable answer here — information_schema's
 * *_PRIVILEGES views need the GRANTEE string rebuilt from CURRENT_USER(),
 * which differs between MySQL and MariaDB.
 */
async function privilegesFor(pool, table) {
  const wanted = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  const granted = new Set();
  let dbName = '';

  const [[dbRow]] = await pool.query('SELECT DATABASE() AS db');
  dbName = dbRow && dbRow.db ? String(dbRow.db) : '';

  const [rows] = await pool.query('SHOW GRANTS FOR CURRENT_USER()');
  for (const row of rows) {
    const line = String(Object.values(row)[0] || '');
    const m = /^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s/i.exec(line);
    if (!m) continue;

    const privs = m[1].toUpperCase();
    const scope = m[2].replace(/`/g, '');
    if (privs.startsWith('PROXY')) continue;

    // `*.*` is global, `db.*` covers the schema, `db.tbl` only that table.
    const [scopeDb, scopeTbl] = scope.split('.');
    const dbOk = scopeDb === '*' || scopeDb.toLowerCase() === dbName.toLowerCase();
    const tblOk = scopeTbl === '*' || scopeTbl.toLowerCase() === String(table).toLowerCase();
    if (!dbOk || !tblOk) continue;

    if (/\bALL PRIVILEGES\b/.test(privs)) {
      for (const p of wanted) granted.add(p);
      continue;
    }
    for (const p of wanted) if (new RegExp(`\\b${p}\\b`).test(privs)) granted.add(p);
  }

  return {
    select: granted.has('SELECT'),
    insert: granted.has('INSERT'),
    update: granted.has('UPDATE'),
    delete: granted.has('DELETE')
  };
}

export async function tableInfo(conn, key, table, { exactCount = false } = {}) {
  assertIdent(table);
  const pool = poolFor(conn, key);

  const [cols] = await pool.query(
    `SELECT COLUMN_NAME              AS name,
            DATA_TYPE                AS dataType,
            COLUMN_TYPE              AS columnType,
            IS_NULLABLE              AS nullable,
            COLUMN_DEFAULT           AS colDefault,
            COLUMN_KEY               AS colKey,
            EXTRA                    AS extra,
            CHARACTER_MAXIMUM_LENGTH AS maxLen
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [table]
  );
  if (!cols.length) {
    // information_schema hides tables the user holds no privilege on, so an
    // empty result means "not there OR not visible to you" — say both.
    throw Object.assign(
      new Error(`Tabel "${table}" tidak ada di database ini, atau user database tidak punya privilege apa pun atasnya.`),
      { expected: true }
    );
  }

  const columns = cols.map((c) => ({
    name: String(c.name),
    type: String(c.columnType || c.dataType),
    nullable: c.nullable === 'YES',
    default: c.colDefault == null ? null : String(c.colDefault),
    isPk: c.colKey === 'PRI',
    // Auto-increment and generated columns must not be written by hand.
    isGenerated: /auto_increment|GENERATED/i.test(String(c.extra || '')),
    maxLength: c.maxLen == null ? null : Number(c.maxLen)
  }));

  const primaryKey = columns.filter((c) => c.isPk).map((c) => c.name);
  const privileges = await privilegesFor(pool, table);

  const [fkRows] = await pool.query(
    `SELECT COLUMN_NAME AS col, REFERENCED_TABLE_NAME AS refTable, REFERENCED_COLUMN_NAME AS refCol
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [table]
  );
  const foreignKeys = fkRows.map((r) => ({
    column: String(r.col),
    refTable: String(r.refTable),
    refColumn: String(r.refCol)
  }));

  // COUNT(*) scans the whole table. On a 100M-row table that is minutes of
  // load on someone's live database just to open a browser tab, so the free
  // engine estimate is the default and the exact count is opt-in.
  const [[approxRow]] = await pool.query(
    `SELECT TABLE_ROWS AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  const approxRows = approxRow && approxRow.n != null ? Number(approxRow.n) : null;

  let totalRows = null;
  if (exactCount) {
    const [[countRow]] = await pool.query(`SELECT COUNT(*) AS n FROM ${qMy(table)}`);
    totalRows = Number(countRow.n);
  }

  return { columns, primaryKey, foreignKeys, privileges, totalRows, approxRows };
}

/** One page of rows, plus the primary-key values that address each row. */
export async function readTable(conn, key, table, { offset = 0, limit = 200, orderBy = null, dir = 'asc', filter = null, conditions = null, fullBinary = false } = {}) {
  assertIdent(table);
  const pool = poolFor(conn, key);
  const safe = qMy(table);

  let order = '';
  if (orderBy) {
    assertColumn(orderBy);
    order = ` ORDER BY ${qMy(orderBy)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  }

  // FK navigation arrives as `filter` (one equality); the export's filter
  // builder arrives as `conditions`. Both end up in the same builder, where
  // columns are validated identifiers and every value is a bound parameter.
  const conds = Array.isArray(conditions) ? conditions : parseConditions(filter);
  const { sql: where, params: whereParams } = buildWhere(conds, qMy);

  const started = Date.now();
  // LIMIT/OFFSET cannot be bound as parameters in a prepared statement here,
  // so they are coerced to integers rather than interpolated as-is.
  const lim = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 200)));
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const [result, fields] = await pool.query({
    sql: `SELECT * FROM ${safe}${where}${order} LIMIT ${lim} OFFSET ${off}`,
    values: whereParams,
    rowsAsArray: false
  });
  const durationMs = Date.now() - started;

  const cols = Array.isArray(fields) && fields.length ? fields.map((f) => f.name) : null;
  const grid = toGrid(result, cols, { fullBinary });
  if (Array.isArray(fields)) {
    for (let i = 0; i < fields.length; i++) {
      if (!NUMERIC_TYPES.has(fields[i].columnType)) continue;
      for (const row of grid.rows) if (row[i] && row[i].v !== null) row[i].t = 'number';
    }
  }

  // A filtered view needs its own count for correct paging — cheap here since
  // FK columns are normally indexed.
  let matchedCount = null;
  if (where) {
    const [[c]] = await pool.query({ sql: `SELECT COUNT(*) AS n FROM ${safe}${where}`, values: whereParams });
    matchedCount = Number(c.n);
  }

  return { kind: 'rows', ...grid, offset: off, limit: lim, matchedCount, durationMs };
}

/**
 * The engine's own CREATE TABLE — exact, and it includes what a reconstruction
 * from information_schema would miss: secondary indexes, foreign keys, engine
 * and charset. Used for the schema half of a SQL dump.
 */
export async function tableDDL(conn, key, table) {
  assertIdent(table);
  const pool = poolFor(conn, key);
  const [rows] = await pool.query(`SHOW CREATE TABLE ${qMy(table)}`);
  const row = rows && rows[0];
  if (!row) return null;
  // The column is 'Create Table' for a table and 'Create View' for a view.
  return row['Create Table'] || row['Create View'] || null;
}

export async function updateCell(conn, key, table, { keyValues, column, value, isNull }) {
  assertIdent(table);
  assertColumn(column);
  const pool = poolFor(conn, key);
  const info = await tableInfo(conn, key, table);
  assertKeyComplete(info.primaryKey, keyValues);

  const where = info.primaryKey.map((c) => `${qMy(c)} <=> ?`).join(' AND ');
  const params = [isNull ? null : value, ...info.primaryKey.map((c) => keyValues[c])];

  const [res] = await pool.query(
    `UPDATE ${qMy(table)} SET ${qMy(column)} = ? WHERE ${where} LIMIT 2`,
    params
  );
  assertSingleRow(res.affectedRows);
  return { affectedRows: res.affectedRows };
}

export async function insertRow(conn, key, table, values) {
  assertIdent(table);
  const pool = poolFor(conn, key);
  const entries = Object.entries(values || {});
  for (const [c] of entries) assertColumn(c);

  const sql = entries.length
    ? `INSERT INTO ${qMy(table)} (${entries.map(([c]) => qMy(c)).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`
    : `INSERT INTO ${qMy(table)} () VALUES ()`;

  const [res] = await pool.query(sql, entries.map(([, v]) => v));
  return { affectedRows: res.affectedRows, insertId: res.insertId ? encodeCell(res.insertId).v : null };
}

export async function deleteRow(conn, key, table, keyValues) {
  assertIdent(table);
  const pool = poolFor(conn, key);
  const info = await tableInfo(conn, key, table);
  assertKeyComplete(info.primaryKey, keyValues);

  const where = info.primaryKey.map((c) => `${qMy(c)} <=> ?`).join(' AND ');
  const [res] = await pool.query(
    `DELETE FROM ${qMy(table)} WHERE ${where} LIMIT 2`,
    info.primaryKey.map((c) => keyValues[c])
  );
  assertSingleRow(res.affectedRows);
  return { affectedRows: res.affectedRows };
}

/**
 * EXPLAIN FORMAT=JSON — plan-only, never executes the query. MySQL/MariaDB
 * has no reliable cross-version JSON "ANALYZE" format (MySQL 8's ANALYZE
 * output is tree-text, not JSON; MariaDB's differs again), so this always
 * returns estimates, never actual timings. The caller is told as much via
 * `analyzed:false` in the normalized result.
 */
export async function explainQuery(conn, key, sql) {
  const pool = poolFor(conn, key);
  const [rows] = await pool.query(`EXPLAIN FORMAT=JSON ${sql}`);
  const text = rows && rows[0] && rows[0].EXPLAIN;
  if (!text) throw Object.assign(new Error('Server tidak mengembalikan rencana EXPLAIN.'), { expected: true });
  return JSON.parse(text);
}

/**
 * Indexes that actually exist on the given tables. The optimizer advisor is
 * only as good as this: without it, every suggestion is "consider adding…"
 * even when the index has been there for years.
 */
export async function listIndexes(conn, key, tables) {
  const names = [...new Set(tables.map(bareName).filter(Boolean))];
  if (names.length === 0) return [];
  const pool = poolFor(conn, key);

  const [rows] = await pool.query(
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, COLLATION, INDEX_TYPE, CARDINALITY
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    [names]
  );

  const byIndex = new Map();
  for (const r of rows) {
    const id = `${r.TABLE_NAME}.${r.INDEX_NAME}`;
    if (!byIndex.has(id)) {
      byIndex.set(id, {
        table: r.TABLE_NAME,
        name: r.INDEX_NAME,
        unique: Number(r.NON_UNIQUE) === 0,
        primary: r.INDEX_NAME === 'PRIMARY',
        type: r.INDEX_TYPE || '',
        // Cardinality is the engine's own estimate of distinct values — a
        // one-value index looks fine on paper and helps nothing in practice.
        cardinality: r.CARDINALITY == null ? null : Number(r.CARDINALITY),
        columns: []
      });
    }
    // COLLATION is 'A' ascending, 'D' descending, NULL for unordered (HASH).
    byIndex.get(id).columns.push({ name: r.COLUMN_NAME, dir: r.COLLATION === 'D' ? 'DESC' : 'ASC' });
  }
  return [...byIndex.values()];
}

/** `db.orders` / `` `orders` `` → `orders`; information_schema stores bare names. */
function bareName(table) {
  const parts = String(table || '').split('.');
  return parts[parts.length - 1].replace(/[`"']/g, '').trim();
}

/**
 * Stop a session. `mode: 'query'` sends KILL QUERY — the running statement is
 * aborted but the connection survives, which is what you want for a stuck
 * report; `mode: 'connection'` drops the whole session.
 *
 * The id is coerced to an integer rather than quoted: KILL takes no bound
 * parameters in MySQL/MariaDB, so nothing else may reach the statement.
 */
export async function killSession(conn, key, id, { mode = 'query' } = {}) {
  const threadId = assertThreadId(id);
  const pool = poolFor(conn, key);
  const c = await pool.getConnection();
  try {
    const [[me]] = await c.query('SELECT CONNECTION_ID() AS id');
    if (Number(me.id) === threadId) {
      throw Object.assign(new Error('Itu sesi QueryFlow sendiri — tidak dihentikan.'), { expected: true });
    }
    await c.query(mode === 'connection' ? `KILL ${threadId}` : `KILL QUERY ${threadId}`);
    return { id: String(threadId), mode };
  } finally {
    c.release();
  }
}

function assertThreadId(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error(`ID sesi tidak valid: ${id}`), { expected: true });
  }
  return n;
}
