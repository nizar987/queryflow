// Normalize EXPLAIN output from PostgreSQL, MySQL/MariaDB, and MongoDB into one
// shape the UI can render without knowing which engine produced it.
//
// Every field-name guess below was checked against real EXPLAIN JSON captured
// from a live PostgreSQL 14 and MariaDB 11.7 instance, not written from memory —
// the formats are under-documented and vary between engine versions (MariaDB
// wraps even a single table in `nested_loop`; MySQL 8 tends not to). The
// extractors below walk the whole tree rather than assuming one shape, so an
// unfamiliar nesting still yields the table-access facts instead of nothing.
//
// @typedef {Object} RelationFact
// @property {string} table        - table name or alias as EXPLAIN reported it
// @property {string} access       - 'full' | 'index' | 'other'
// @property {string} accessLabel  - engine's own label, e.g. "Seq Scan", "ALL"
// @property {string|null} index   - index name used, if any
// @property {number|null} estRows
// @property {number|null} actualRows   - only present when the plan was executed
// @property {number|null} actualTimeMs
// @property {string|null} filter  - the raw filter/condition text, if any
// @property {number|null} rowsRemovedByFilter

const FULL_SCAN_ROWS_WARN = 5000;
const FILTER_WASTE_RATIO = 0.9; // fraction of scanned rows a filter throws away

/** @returns {{engine, analyzed, totalCost, totalTimeMs, planningTimeMs, relations: RelationFact[], warnings: string[], raw}} */
export function normalizeExplain(dialect, raw) {
  const engine = /postgre/i.test(dialect) ? 'postgres' : /mongo/i.test(dialect) ? 'mongo' : 'mysql';
  if (engine === 'postgres') return normalizePostgres(raw);
  if (engine === 'mongo') return normalizeMongo(raw);
  return normalizeMysql(raw);
}

// ---------------------------------------------------------------------------
// PostgreSQL — EXPLAIN (FORMAT JSON[, ANALYZE]) returns [{ Plan, Planning Time,
// Execution Time }]. Every node with a "Relation Name" is a scan; everything
// else (Nested Loop, Hash, Sort, Aggregate…) is glue between scans.
// ---------------------------------------------------------------------------
const PG_ACCESS = {
  'Seq Scan': 'full',
  'Index Scan': 'index',
  'Index Only Scan': 'index',
  'Bitmap Heap Scan': 'index', // paired with a Bitmap Index Scan child below it
  'Bitmap Index Scan': 'index',
  'Tid Scan': 'other',
  'CTE Scan': 'other',
  'Function Scan': 'other',
  'Subquery Scan': 'other'
};

function normalizePostgres(raw) {
  const root = Array.isArray(raw) ? raw[0] : raw;
  const plan = root && root.Plan;
  const relations = [];
  const warnings = [];
  let sawExternalSort = false;

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (node['Relation Name']) {
      const access = PG_ACCESS[node['Node Type']] || 'other';
      const removed = node['Rows Removed by Filter'];
      // A Bitmap Heap Scan's own node carries no Index Name — the index lives
      // on its Bitmap Index Scan child. Without this it would misreport a
      // bitmap-indexed lookup as having used no index at all.
      const bitmapChild = node['Node Type'] === 'Bitmap Heap Scan'
        ? (node['Plans'] || []).find((p) => p['Index Name'])
        : null;
      relations.push({
        table: node['Relation Name'],
        alias: node['Alias'] || node['Relation Name'],
        access,
        accessLabel: node['Node Type'],
        index: node['Index Name'] || (bitmapChild && bitmapChild['Index Name']) || null,
        estRows: numOr(node['Plan Rows']),
        actualRows: numOr(node['Actual Rows']),
        actualTimeMs: numOr(node['Actual Total Time']),
        filter: node['Filter'] || node['Index Cond'] || node['Recheck Cond'] || null,
        rowsRemovedByFilter: numOr(removed)
      });

      if (access === 'full' && numOr(node['Plan Rows']) >= FULL_SCAN_ROWS_WARN) {
        warnings.push(`Seq Scan pada "${node['Relation Name']}" (~${fmt(node['Plan Rows'])} baris diperkirakan) — tidak ada index yang dipakai di sini.`);
      }
      if (removed && node['Actual Rows'] != null) {
        const scanned = removed + node['Actual Rows'];
        if (scanned > 0 && removed / scanned >= FILTER_WASTE_RATIO && removed > 1000) {
          warnings.push(`${node['Rows Removed by Filter'].toLocaleString('id-ID')} dari ${scanned.toLocaleString('id-ID')} baris yang dibaca di "${node['Relation Name']}" dibuang oleh filter — index pada kolom filter akan menghindari pembacaan baris yang tidak perlu.`);
        }
      }
    }

    if (node['Sort Method'] && /external/i.test(node['Sort Method'])) sawExternalSort = true;

    for (const p of node['Plans'] || []) walk(p);
  }
  walk(plan);

  if (sawExternalSort) {
    warnings.push('Sort meluap ke disk (Sort Method: external merge) — hasil terlalu besar untuk work_mem, atau ORDER BY tidak dibantu index.');
  }

  return {
    engine: 'postgres',
    analyzed: plan ? 'Actual Total Time' in plan || relations.some((r) => r.actualTimeMs != null) : false,
    totalCost: plan ? numOr(plan['Total Cost']) : null,
    totalTimeMs: root ? numOr(root['Execution Time']) : null,
    planningTimeMs: root ? numOr(root['Planning Time']) : null,
    relations,
    warnings,
    raw
  };
}

// ---------------------------------------------------------------------------
// MySQL / MariaDB — EXPLAIN FORMAT=JSON. No stable schema across versions:
// MariaDB wraps a lone table in `nested_loop:[{table:{...}}]`; field names for
// cost/rows differ between MariaDB (`cost`, `rows`, `filtered` as a number) and
// MySQL 8 (`cost_info.prefix_cost`, `rows_examined_per_scan`, `filtered` as a
// string percentage). Rather than branch on version, walk the whole tree for
// any object shaped like a table-access node and read every field name variant.
// ---------------------------------------------------------------------------
const MYSQL_FULL = new Set(['ALL', 'index']); // 'index' here means "scans the whole index", not a seek
const MYSQL_SEEK = new Set(['const', 'eq_ref', 'ref', 'range', 'ref_or_null', 'unique_subquery', 'index_subquery', 'fulltext']);

function normalizeMysql(raw) {
  const root = typeof raw === 'string' ? safeParse(raw) : raw;
  const relations = [];
  const warnings = [];
  let sawFilesort = false;
  let sawTemp = false;

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }

    if (node.filesort) sawFilesort = true;
    if (node.using_filesort) sawFilesort = true;
    if (node.temporary_table) sawTemp = true;
    if (node.using_temporary_table) sawTemp = true;

    if (node.table && typeof node.table === 'object' && node.table.table_name) {
      const t = node.table;
      const accessType = t.access_type || '';
      const access = MYSQL_SEEK.has(accessType) ? 'index' : MYSQL_FULL.has(accessType) ? 'full' : 'other';
      const rows = t.rows_examined_per_scan ?? t.rows ?? null;
      relations.push({
        table: t.table_name,
        alias: t.table_name,
        access,
        accessLabel: accessType || '(unknown)',
        index: t.key || null,
        estRows: numOr(rows),
        actualRows: null, // MySQL/MariaDB EXPLAIN FORMAT=JSON never executes — no actuals
        actualTimeMs: null,
        filter: t.attached_condition || null,
        rowsRemovedByFilter: null
      });

      if (access === 'full' && numOr(rows) >= FULL_SCAN_ROWS_WARN) {
        warnings.push(`Full scan (${accessType}) pada "${t.table_name}" (~${fmt(rows)} baris diperkirakan) — tidak ada index yang dipakai.`);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'table') continue; // already handled above
      walk(node[key]);
    }
  }
  walk(root);

  if (sawFilesort) warnings.push('Query memakai filesort — ORDER BY tidak dibantu index, hasil harus diurutkan setelah dibaca.');
  if (sawTemp) warnings.push('Query membuat tabel sementara (temporary table) — biasanya dari GROUP BY/DISTINCT/UNION yang tidak match index apa pun.');

  const topCost = root && root.query_block
    ? numOr(root.query_block.cost) ?? numOr(root.query_block.cost_info && root.query_block.cost_info.query_cost)
    : null;

  return {
    engine: 'mysql',
    analyzed: false, // plan-only: never executes the query, so figures are estimates
    totalCost: topCost,
    totalTimeMs: null,
    planningTimeMs: null,
    relations,
    warnings,
    raw
  };
}

// ---------------------------------------------------------------------------
// MongoDB — collection.find(...).explain('executionStats') /
// aggregate(...).explain('executionStats'). Unlike SQL engines, explain here
// always executes the read (that's inherent to how Mongo computes
// executionStats), so `analyzed` is always true when stats are present.
// NOTE: built from MongoDB's documented explain output shape; not exercised
// against a live mongod in this environment — treat as best-effort.
// ---------------------------------------------------------------------------
function normalizeMongo(raw) {
  const qp = raw && raw.queryPlanner;
  const es = raw && raw.executionStats;
  const winning = qp && qp.winningPlan;
  const relations = [];
  const warnings = [];

  function walk(stage, stats) {
    if (!stage || typeof stage !== 'object') return;
    const name = stage.stage;

    if (name === 'COLLSCAN' || name === 'IXSCAN') {
      relations.push({
        table: qp ? qp.namespace : '(collection)',
        alias: qp ? qp.namespace : '(collection)',
        access: name === 'IXSCAN' ? 'index' : 'full',
        accessLabel: name,
        index: stage.indexName || null,
        estRows: null, // Mongo doesn't estimate ahead of time the way SQL planners do
        actualRows: stats ? numOr(stats.nReturned) : null,
        actualTimeMs: stats ? numOr(stats.executionTimeMillisEstimate) : null,
        filter: stage.filter ? JSON.stringify(stage.filter) : null,
        rowsRemovedByFilter: stats ? numOr(stats.docsExamined) - numOr(stats.nReturned) : null
      });
      if (name === 'COLLSCAN') {
        const n = stats ? stats.docsExamined : null;
        if (n == null || n >= FULL_SCAN_ROWS_WARN) {
          warnings.push(`COLLSCAN pada "${qp ? qp.namespace : 'koleksi'}"${n != null ? ` (${fmt(n)} dokumen dipindai)` : ''} — tidak ada index yang dipakai.`);
        }
      }
    }

    for (const child of stage.inputStages || (stage.inputStage ? [stage.inputStage] : [])) {
      walk(child, stats);
    }
  }
  walk(winning, es);

  return {
    engine: 'mongo',
    analyzed: !!es,
    totalCost: null,
    totalTimeMs: es ? numOr(es.executionTimeMillis) : null,
    planningTimeMs: null,
    relations,
    warnings,
    raw
  };
}

// ---------------------------------------------------------------------------

function numOr(v) {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function fmt(n) {
  const v = numOr(n);
  return v == null ? '?' : v.toLocaleString('id-ID');
}
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}
