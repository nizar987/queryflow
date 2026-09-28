// PostgreSQL driver.
import pg from 'pg';
import { toGrid } from './cells.js';
import { tlsOptions } from '../tls.js';
import { assertIdent, assertColumn, qPg, assertKeyComplete, assertSingleRow } from './identifiers.js';
import { parseConditions, buildWhere } from './where.js';

// Numeric OIDs pg hands back as strings (int8 by our parser above, numeric and
// friends by default, to keep exact precision). The value must stay a string,
// but the grid should still treat it as a number for alignment.
const NUMERIC_OIDS = new Set([20, 21, 23, 26, 700, 701, 790, 1700]);

const pools = new Map(); // profileKey -> pool

// pg parses int8 into a JS number by default, which silently loses precision
// above 2^53. Hand it back as a string and let the grid show it verbatim.
pg.types.setTypeParser(20, (v) => v);

function connectOptions(conn) {
  return conn.uri
    ? { connectionString: conn.uri, ssl: tlsOptions(conn) || undefined }
    : {
        host: conn.host,
        port: conn.port,
        user: conn.user || undefined,
        password: conn.password || undefined,
        database: conn.database || undefined,
        ssl: tlsOptions(conn) || undefined
      };
}

/**
 * pg_cancel_backend from a client of its own, outside the pool — with every
 * pooled client busy, waiting for one would wait on the query being cancelled.
 */
async function cancelBackend(conn, pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('PID backend tidak diketahui.');
  const c = new pg.Client(connectOptions(conn));
  c.on('error', () => {});
  await c.connect();
  try {
    await c.query('SELECT pg_cancel_backend($1)', [pid]);
  } finally {
    await c.end().catch(() => {});
  }
}

function poolFor(conn, key) {
  let pool = pools.get(key);
  if (pool) return pool;
  pool = new pg.Pool({ ...connectOptions(conn), max: 4 });
  // Without a listener, an idle-client error crashes the whole Node process.
  pool.on('error', () => {});
  pools.set(key, pool);
  return pool;
}

export async function ping(conn, key) {
  const r = await poolFor(conn, key).query('SELECT version() AS v');
  return { version: r.rows[0] ? String(r.rows[0].v) : 'unknown' };
}

/**
 * One pooled client held for a run or a whole batch, so session state (SET,
 * temporary tables, BEGIN … COMMIT) carries from one statement to the next,
 * and the backend pid a cancel targets is always this run's.
 * @param {any} conn
 * @param {string} key
 * @param {import('../run-control.js').RunControl | null} [control]
 */
export async function openSession(conn, key, control = null) {
  const client = await poolFor(conn, key).connect();
  /** @type {string[]} */
  let notices = [];
  const onNotice = (n) => notices.push(String(n.message || n));
  client.on('notice', onNotice);
  control?.onCancel(() => cancelBackend(conn, client.processID));

  return {
    /** @param {string} sql @param {{ maxRows: number }} opts */
    async run(sql, { maxRows }) {
      control?.throwIfCancelled();
      notices = [];
      const started = Date.now();
      // The extended protocol runs exactly one statement. Text reaching here
      // has already been split and judged statement by statement; if a split
      // were ever wrong, this fails loudly instead of running a second
      // statement nobody classified.
      const res = await client.query({ text: sql, rowMode: 'array', queryMode: 'extended' });
      return shapeResult(res, maxRows, notices, Date.now() - started);
    },
    /**
     * `discard` destroys the client instead of pooling it — which also rolls
     * back a transaction the script left open. A cancelled client is always
     * discarded: a cancel landing as the statement finished must not interrupt
     * the next query to borrow it.
     * @param {{ discard?: boolean }} [opts]
     */
    async close({ discard = false } = {}) {
      client.off('notice', onNotice);
      await control?.settled();
      client.release(discard || !!control?.reason);
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

function shapeResult(res, maxRows, notices, durationMs) {
  const fields = res.fields || [];
  if (fields.length) {
    const cols = fields.map((f) => f.name);
    const all = res.rows || [];
    const capped = all.slice(0, maxRows);
    // rowMode 'array' already gives positional rows — map them into cells.
    const grid = toGrid(capped.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))), cols);
    for (let i = 0; i < fields.length; i++) {
      if (!NUMERIC_OIDS.has(fields[i].dataTypeID)) continue;
      for (const row of grid.rows) if (row[i] && row[i].v !== null) row[i].t = 'number';
    }
    return {
      kind: 'rows',
      ...grid,
      rowCount: all.length,
      truncated: all.length > capped.length,
      affectedRows: null,
      command: res.command || '',
      notices,
      durationMs
    };
  }

  return {
    kind: 'ack',
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    affectedRows: typeof res.rowCount === 'number' ? res.rowCount : null,
    command: res.command || '',
    notices,
    durationMs
  };
}

/**
 * Live sessions from pg_stat_activity.
 * Without pg_read_all_stats (or superuser), Postgres blanks out `query` for
 * other users' backends rather than hiding the row — so a list full of empty
 * queries means missing privileges, not idle sessions.
 */
export async function processList(conn, key) {
  const pool = poolFor(conn, key);

  const { rows } = await pool.query(`
    SELECT pid, usename, application_name, client_addr, client_port, datname,
           state, wait_event_type, wait_event, backend_type, query,
           EXTRACT(EPOCH FROM (now() - COALESCE(query_start, backend_start)))::float AS seconds
      FROM pg_stat_activity
     ORDER BY seconds DESC NULLS LAST
  `);

  const settings = await pool.query(`
    SELECT name, setting FROM pg_settings
     WHERE name IN ('max_connections', 'superuser_reserved_connections', 'idle_in_transaction_session_timeout')
  `);
  const cfg = Object.fromEntries(settings.rows.map((r) => [r.name, r.setting]));

  const processes = rows.map((r) => ({
    id: String(r.pid),
    // Engine semantics belong here, not in the UI: only 'active' is really
    // running, and non-client backends are server internals (checkpointer,
    // autovacuum…) that shouldn't be counted as sessions at all.
    busy: r.state === 'active',
    internal: r.backend_type !== 'client backend',
    user: r.usename || r.backend_type || '',
    client: r.client_addr ? `${r.client_addr}:${r.client_port ?? ''}` : 'local',
    db: r.datname || '',
    // `state` is the useful field here; backend_type distinguishes autovacuum
    // and other internal workers from real client sessions.
    command: r.backend_type === 'client backend' ? (r.application_name || 'client') : r.backend_type || '',
    // Background workers have a null `state`; interpolating it straight into a
    // template literal printed the string "null" in the grid.
    state: [r.state, r.wait_event ? `${r.wait_event_type}:${r.wait_event}` : '']
      .filter(Boolean)
      .join(' · '),
    seconds: r.seconds == null ? null : Math.max(0, Math.round(Number(r.seconds))),
    query: r.query || ''
  }));

  const clients = processes.filter((p) => !p.internal);
  const active = clients.filter((p) => p.busy).length;
  const idleTx = rows.filter((r) => r.state && r.state.startsWith('idle in transaction')).length;

  return {
    processes,
    summary: {
      total: clients.length,
      active,
      idle: Math.max(0, clients.length - active),
      max: cfg.max_connections ? Number(cfg.max_connections) : null,
      idleLabel: 'idle',
      extra: [
        { label: 'Idle in transaction', value: idleTx, warn: idleTx > 0 },
        { label: 'Slot cadangan superuser', value: cfg.superuser_reserved_connections ?? '—' },
        { label: 'Proses internal', value: processes.length - clients.length }
      ],
      partial: rows.some((r) => r.state && !r.query)
    }
  };
}

export function dispose(key) {
  const pool = pools.get(key);
  if (!pool) return;
  pools.delete(key);
  pool.end().catch(() => {});
}

/** List all base tables visible to the current user. */
export async function listTables(conn, key) {
  const pool = poolFor(conn, key);
  const { rows } = await pool.query(`
    SELECT t.table_name                            AS name,
           obj_description(c.oid, 'pg_class')     AS comment
    FROM   information_schema.tables t
    JOIN   pg_class c ON c.relname = t.table_name
    WHERE  t.table_schema = 'public'
      AND  t.table_type   = 'BASE TABLE'
    ORDER  BY t.table_name
  `);
  return rows.map((r) => ({
    name:       String(r.name),
    approxRows: null,
    comment:    r.comment || ''
  }));
}

/** Return up to 1 000 rows from the named table (public schema only). */
export async function previewTable(conn, key, table) {
  if (!/^[\w\-. ]+$/.test(table)) {
    throw Object.assign(new Error('Nama tabel tidak valid.'), { expected: true });
  }
  const pool    = poolFor(conn, key);
  // Quote identifier properly — double-quotes in PG
  const safe    = '"' + table.replace(/"/g, '""') + '"';
  const client  = await pool.connect();
  const notices = [];
  const onNotice = (n) => notices.push(String(n.message || n));
  client.on('notice', onNotice);
  try {
    const started = Date.now();
    const res     = await client.query({ text: `SELECT * FROM public.${safe} LIMIT 1000`, rowMode: 'array' });
    const durationMs = Date.now() - started;
    const fields  = res.fields || [];
    const cols    = fields.map((f) => f.name);
    const all     = res.rows || [];
    const grid    = toGrid(all.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))), cols);
    for (let i = 0; i < fields.length; i++) {
      if (!NUMERIC_OIDS.has(fields[i].dataTypeID)) continue;
      for (const row of grid.rows) if (row[i] && row[i].v !== null) row[i].t = 'number';
    }
    return {
      kind: 'rows', ...grid,
      rowCount:     all.length,
      truncated:    all.length >= 1000,
      affectedRows: null,
      command:      'SELECT',
      notices,
      durationMs
    };
  } finally {
    client.off('notice', onNotice);
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Table browser: metadata, paged reads, and single-row writes.
// ---------------------------------------------------------------------------

export async function tableInfo(conn, key, table, { exactCount = false } = {}) {
  assertIdent(table);
  const pool = poolFor(conn, key);

  const { rows: cols } = await pool.query(
    `SELECT c.column_name                            AS name,
            COALESCE(c.data_type, '')                AS data_type,
            format_type(a.atttypid, a.atttypmod)     AS full_type,
            c.is_nullable = 'YES'                    AS nullable,
            c.column_default                         AS col_default,
            c.character_maximum_length               AS max_len,
            c.is_generated <> 'NEVER'
              OR c.identity_generation IS NOT NULL
              OR c.column_default LIKE 'nextval(%'   AS is_generated
       FROM information_schema.columns c
       JOIN pg_class     t ON t.relname = c.table_name
       JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
      WHERE c.table_schema = 'public' AND c.table_name = $1
      ORDER BY c.ordinal_position`,
    [table]
  );
  if (!cols.length) {
    throw Object.assign(
      new Error(`Tabel "${table}" tidak ada di schema public, atau user database tidak punya privilege apa pun atasnya.`),
      { expected: true }
    );
  }

  // Primary key straight from the index definition — information_schema's
  // constraint views miss keys created in some ways.
  const { rows: pk } = await pool.query(
    `SELECT a.attname AS name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [`public.${qPg(table)}`]
  );
  const primaryKey = pk.map((r) => String(r.name));

  // Foreign keys straight from pg_constraint — this is what makes a cell
  // clickable in the Tables tab (jump to the row it references).
  const { rows: fkRows } = await pool.query(
    `SELECT a.attname                                   AS column_name,
            confrelid::regclass::text                    AS ref_table,
            af.attname                                   AS ref_column
       FROM pg_constraint c
       JOIN unnest(c.conkey)  WITH ORDINALITY AS ck(attnum, ord) ON true
       JOIN unnest(c.confkey) WITH ORDINALITY AS cf(attnum, ord) ON cf.ord = ck.ord
       JOIN pg_attribute a  ON a.attrelid = c.conrelid  AND a.attnum = ck.attnum
       JOIN pg_attribute af ON af.attrelid = c.confrelid AND af.attnum = cf.attnum
      WHERE c.contype = 'f' AND c.conrelid = $1::regclass`,
    [`public.${qPg(table)}`]
  );
  const foreignKeys = fkRows.map((r) => ({
    column: String(r.column_name),
    refTable: String(r.ref_table).replace(/^public\./, '').replace(/"/g, ''),
    refColumn: String(r.ref_column)
  }));

  // Postgres can answer the permission question exactly, for this exact role.
  const { rows: privRows } = await pool.query(
    `SELECT has_table_privilege($1, 'SELECT') AS s,
            has_table_privilege($1, 'INSERT') AS i,
            has_table_privilege($1, 'UPDATE') AS u,
            has_table_privilege($1, 'DELETE') AS d`,
    [`public.${qPg(table)}`]
  );
  const p = privRows[0] || {};

  // reltuples is the planner's estimate and costs nothing; COUNT(*) walks the
  // whole heap. Opening a table must not put a full scan on a live database.
  const { rows: est } = await pool.query(
    `SELECT reltuples::bigint AS n FROM pg_class WHERE oid = $1::regclass`,
    [`public.${qPg(table)}`]
  );
  const approxRows = est[0] && est[0].n != null && Number(est[0].n) >= 0 ? Number(est[0].n) : null;

  let totalRows = null;
  if (exactCount) {
    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::bigint AS n FROM public.${qPg(table)}`);
    totalRows = Number(countRows[0].n);
  }

  return {
    columns: cols.map((c) => ({
      name: String(c.name),
      type: String(c.full_type || c.data_type),
      nullable: !!c.nullable,
      default: c.col_default == null ? null : String(c.col_default),
      isPk: primaryKey.includes(String(c.name)),
      isGenerated: !!c.is_generated,
      maxLength: c.max_len == null ? null : Number(c.max_len)
    })),
    primaryKey,
    foreignKeys,
    privileges: { select: !!p.s, insert: !!p.i, update: !!p.u, delete: !!p.d },
    totalRows,
    approxRows
  };
}

export async function readTable(conn, key, table, { offset = 0, limit = 200, orderBy = null, dir = 'asc', filter = null, conditions = null, fullBinary = false } = {}) {
  assertIdent(table);
  const pool = poolFor(conn, key);

  let order = '';
  if (orderBy) {
    assertColumn(orderBy);
    order = ` ORDER BY ${qPg(orderBy)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  }
  const lim = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 200)));
  const off = Math.max(0, Math.floor(Number(offset) || 0));

  // FK navigation arrives as `filter` (one equality); the export's filter
  // builder arrives as `conditions`. Both end up in the same builder, where
  // columns are validated identifiers and every value is a bound parameter.
  const conds = Array.isArray(conditions) ? conditions : parseConditions(filter);
  const { sql: where, params: whereParams } = buildWhere(conds, qPg, (n) => `$${n}`);

  // LIMIT/OFFSET continue the same numbering the WHERE clause started.
  const params = [...whereParams, lim, off];
  const limIdx = params.length - 1;
  const offIdx = params.length;

  const started = Date.now();
  const res = await pool.query({
    text: `SELECT * FROM public.${qPg(table)}${where}${order} LIMIT $${limIdx} OFFSET $${offIdx}`,
    values: params,
    rowMode: 'array'
  });
  const durationMs = Date.now() - started;

  const fields = res.fields || [];
  const cols = fields.map((f) => f.name);
  const grid = toGrid((res.rows || []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))), cols, { fullBinary });
  for (let i = 0; i < fields.length; i++) {
    if (!NUMERIC_OIDS.has(fields[i].dataTypeID)) continue;
    for (const row of grid.rows) if (row[i] && row[i].v !== null) row[i].t = 'number';
  }

  // A filtered view needs its own count for correct paging — the table's
  // overall row estimate would show "page 1 of 250" for a filter that only
  // ever matches a handful of rows. Cheap here: FK columns are normally
  // indexed, unlike the unrestricted COUNT(*) the Tables tab avoids.
  let matchedCount = null;
  if (where) {
    const c = await pool.query({
      text: `SELECT COUNT(*)::bigint AS n FROM public.${qPg(table)}${where}`,
      values: whereParams
    });
    matchedCount = Number(c.rows[0].n);
  }

  return { kind: 'rows', ...grid, offset: off, limit: lim, matchedCount, durationMs };
}

export async function updateCell(conn, key, table, { keyValues, column, value, isNull }) {
  assertIdent(table);
  assertColumn(column);
  const pool = poolFor(conn, key);
  const info = await tableInfo(conn, key, table);
  assertKeyComplete(info.primaryKey, keyValues);

  const where = info.primaryKey
    .map((c, i) => `${qPg(c)} IS NOT DISTINCT FROM $${i + 2}`)
    .join(' AND ');
  const params = [isNull ? null : value, ...info.primaryKey.map((c) => keyValues[c])];

  const res = await pool.query(
    `UPDATE public.${qPg(table)} SET ${qPg(column)} = $1 WHERE ${where}`,
    params
  );
  assertSingleRow(res.rowCount);
  return { affectedRows: res.rowCount };
}

export async function insertRow(conn, key, table, values) {
  assertIdent(table);
  const pool = poolFor(conn, key);
  const entries = Object.entries(values || {});
  for (const [c] of entries) assertColumn(c);

  const sql = entries.length
    ? `INSERT INTO public.${qPg(table)} (${entries.map(([c]) => qPg(c)).join(', ')}) ` +
      `VALUES (${entries.map((_, i) => '$' + (i + 1)).join(', ')})`
    : `INSERT INTO public.${qPg(table)} DEFAULT VALUES`;

  const res = await pool.query(sql, entries.map(([, v]) => v));
  return { affectedRows: res.rowCount, insertId: null };
}

export async function deleteRow(conn, key, table, keyValues) {
  assertIdent(table);
  const pool = poolFor(conn, key);
  const info = await tableInfo(conn, key, table);
  assertKeyComplete(info.primaryKey, keyValues);

  const where = info.primaryKey
    .map((c, i) => `${qPg(c)} IS NOT DISTINCT FROM $${i + 1}`)
    .join(' AND ');
  const res = await pool.query(
    `DELETE FROM public.${qPg(table)} WHERE ${where}`,
    info.primaryKey.map((c) => keyValues[c])
  );
  assertSingleRow(res.rowCount);
  return { affectedRows: res.rowCount };
}

/**
 * EXPLAIN (FORMAT JSON[, ANALYZE, BUFFERS]) — ANALYZE actually runs the
 * statement to collect real timings, so it is opt-in and the caller must be
 * explicit about wanting it (see the API route for the confirmation this
 * requires on the client side).
 */
export async function explainQuery(conn, key, sql, { analyze = false } = {}) {
  const pool = poolFor(conn, key);
  const opts = analyze ? 'ANALYZE, BUFFERS, FORMAT JSON' : 'FORMAT JSON';
  const res = await pool.query(`EXPLAIN (${opts}) ${sql}`);
  // pg auto-parses json/jsonb columns, so this is already a JS array: [{Plan:…}]
  const plan = res.rows[0] && res.rows[0]['QUERY PLAN'];
  if (!plan) throw Object.assign(new Error('Server tidak mengembalikan rencana EXPLAIN.'), { expected: true });
  return plan;
}

/**
 * Indexes that actually exist on the given tables, including which column
 * comes first and whether it is stored descending — both decide whether an
 * index can serve an ORDER BY at all.
 */
export async function listIndexes(conn, key, tables) {
  const names = [...new Set(tables.map(bareName).filter(Boolean))];
  if (names.length === 0) return [];
  const pool = poolFor(conn, key);

  const { rows } = await pool.query(
    `SELECT t.relname          AS table_name,
            i.relname          AS index_name,
            ix.indisunique     AS is_unique,
            ix.indisprimary    AS is_primary,
            am.amname          AS index_type,
            k.ord              AS ord,
            a.attname          AS column_name,
            CASE WHEN ix.indoption[k.ord - 1] & 1 = 1 THEN 'DESC' ELSE 'ASC' END AS dir,
            pg_get_indexdef(ix.indexrelid, k.ord::int, true) AS expression
       FROM pg_index ix
       JOIN pg_class t      ON t.oid = ix.indrelid
       JOIN pg_class i      ON i.oid = ix.indexrelid
       JOIN pg_namespace n  ON n.oid = t.relnamespace
       JOIN pg_am am        ON am.oid = i.relam
       JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relname = ANY($1)
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY t.relname, i.relname, k.ord`,
    [names]
  );

  const byIndex = new Map();
  for (const r of rows) {
    const id = `${r.table_name}.${r.index_name}`;
    if (!byIndex.has(id)) {
      byIndex.set(id, {
        table: r.table_name,
        name: r.index_name,
        unique: !!r.is_unique,
        primary: !!r.is_primary,
        type: r.index_type || '',
        cardinality: null,
        columns: []
      });
    }
    // attname is null for an expression index (attnum 0); the rendered
    // expression is the only honest name for that column.
    byIndex.get(id).columns.push({ name: r.column_name || r.expression || '(ekspresi)', dir: r.dir });
  }
  return [...byIndex.values()];
}

/** `public.orders` / `"orders"` → `orders`; pg_class stores bare names. */
function bareName(table) {
  const parts = String(table || '').split('.');
  return parts[parts.length - 1].replace(/["'`]/g, '').trim();
}

/**
 * Stop a backend. `mode: 'query'` uses pg_cancel_backend — it asks the backend
 * to abort its current statement and keeps the session; `mode: 'connection'`
 * uses pg_terminate_backend, which drops the session entirely (and rolls back
 * whatever transaction it was in).
 */
export async function killSession(conn, key, id, { mode = 'query' } = {}) {
  const pid = assertPid(id);
  const pool = poolFor(conn, key);
  const client = await pool.connect();
  try {
    const { rows: [me] } = await client.query('SELECT pg_backend_pid() AS pid');
    if (Number(me.pid) === pid) {
      throw Object.assign(new Error('Itu sesi QueryFlow sendiri — tidak dihentikan.'), { expected: true });
    }
    const fn = mode === 'connection' ? 'pg_terminate_backend' : 'pg_cancel_backend';
    const { rows } = await client.query(`SELECT ${fn}($1) AS ok`, [pid]);
    // Both functions return false when the pid is already gone or not signalable.
    if (!rows[0] || rows[0].ok !== true) {
      throw Object.assign(
        new Error(`PostgreSQL menolak menghentikan pid ${pid} — sesi sudah selesai, atau user ini tidak punya hak pg_signal_backend.`),
        { expected: true }
      );
    }
    return { id: String(pid), mode };
  } finally {
    client.release();
  }
}

function assertPid(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error(`PID tidak valid: ${id}`), { expected: true });
  }
  return n;
}
