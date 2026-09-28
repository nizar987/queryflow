// Golden test runner (PLAN §1.3, §11). Run: `npm test`
// Exercises the full pipeline on realistic queries and asserts expected detections
// plus low false-positives on intentionally-clean queries.
import { runPipeline } from '../src/lib/pipeline.js';
import { layoutFlow } from '../src/lib/ast-to-flow/layout.js';
import { GOLDEN } from './fixtures/queries.js';
import { MONGO_GOLDEN, PG_GOLDEN } from './fixtures/mongo-queries.js';

let pass = 0, fail = 0;
const failures = [];
function check(cond, label) {
  if (cond) pass++;
  else { fail++; failures.push(label); }
}

/** True when `fn` refused the input — the assertion most rejection tests want. */
function threw(fn) {
  try { fn(); return false; } catch (e) { return true; }
}

// Expected rule hits per fixture (by ruleId). [] means "expect zero findings".
const EXPECT = {
  'simple-join-group': ['count-column'],
  'select-star-bigtable': ['select-star'],
  'index-busting-where': ['index-busting'],
  'leading-wildcard': ['leading-wildcard'],
  'cartesian-join': ['cartesian-join'],
  'correlated-subquery': ['subquery-in-select'],
  'aggregate-in-where': ['aggregate-in-where'],
  'count-column-vs-star': ['count-column'],
  'cte-window': [],
  'union-all': [],
  'order-by-ordinal-no-limit': ['orderby-no-limit', 'orderby-ordinal'],
  'nested-subquery-in': [],
  'derived-table': [],
  'clean-indexed': []
};

for (const q of GOLDEN) {
  const r = runPipeline(q.sql, { dialect: 'MariaDB' });
  check(r.ok, `${q.name}: parse+flow ok`);
  if (!r.ok) continue;

  // every flow node must be placeable by layout
  const L = layoutFlow(r.flow);
  const totalNodes = r.flow.blocks.reduce((a, b) => a + b.nodes.length, 0);
  check(Object.keys(L.positions).length === totalNodes, `${q.name}: layout places all nodes`);

  // glossary dedup: no duplicate signatures
  const sigs = r.glossary.entries.map((e) => e.signature);
  check(new Set(sigs).size === sigs.length, `${q.name}: glossary has no duplicate entries`);

  // expected findings
  const got = new Set(r.analysis.findings.map((f) => f.ruleId));
  const exp = EXPECT[q.name] || [];
  for (const ruleId of exp) check(got.has(ruleId), `${q.name}: expected rule '${ruleId}'`);

  // calibration: clean queries should produce no WARNING/CRITICAL noise
  if (exp.length === 0) {
    const noisy = r.analysis.findings.filter((f) => f.severity !== 'info');
    check(noisy.length === 0, `${q.name}: clean query has no warning/critical noise (got ${noisy.map(f=>f.ruleId).join(',')})`);
  }
}

// ---- MongoDB + PostgreSQL fixtures (parity coverage) ----
function runEngineFixtures(fixtures, dialect, label) {
  for (const q of fixtures) {
    const r = runPipeline(q.sql, { dialect });
    check(r.ok, `${label}/${q.name}: parse+flow ok${r.ok ? '' : ' — ' + r.error}`);
    if (!r.ok) continue;
    const L = layoutFlow(r.flow);
    const total = r.flow.blocks.reduce((a, b) => a + b.nodes.length, 0);
    check(Object.keys(L.positions).length === total, `${label}/${q.name}: layout places all nodes`);
    const sigs = r.glossary.entries.map((e) => e.signature);
    check(new Set(sigs).size === sigs.length, `${label}/${q.name}: glossary no duplicates`);
    const got = new Set(r.analysis.findings.map((f) => f.ruleId));
    for (const ruleId of q.expect) check(got.has(ruleId), `${label}/${q.name}: expected '${ruleId}'`);
    if (q.expect.length === 0) {
      const noisy = r.analysis.findings.filter((f) => f.severity !== 'info');
      check(noisy.length === 0, `${label}/${q.name}: clean has no warn/crit (got ${noisy.map((f) => f.ruleId).join(',')})`);
    }
  }
}
runEngineFixtures(MONGO_GOLDEN, 'MongoDB', 'mongo');
runEngineFixtures(PG_GOLDEN, 'PostgreSQL', 'pg');

// ---- converter ----
import { convertQuery } from '../src/lib/convert/index.js';
const cSQL = `SELECT name, COUNT(*) AS c FROM orders WHERE status='active' GROUP BY name HAVING COUNT(*)>5 ORDER BY c DESC LIMIT 10`;
const cMongo = `db.orders.aggregate([ { $match: { status: "active" } }, { $group: { _id: "$owner", total: { $sum: "$amount" } } }, { $sort: { total: -1 } }, { $limit: 20 } ])`;

let r;
r = convertQuery(cSQL, 'MariaDB', 'PostgreSQL');
check(r.ok && /"orders"|orders/.test(r.text) && r.text.includes('GROUP BY'), 'convert MariaDB→PostgreSQL ok');
r = convertQuery(cSQL, 'MariaDB', 'MongoDB');
check(r.ok && r.text.includes('$group') && r.text.includes('$match') && r.text.includes('aggregate('), 'convert MariaDB→MongoDB produces pipeline');
r = convertQuery(cMongo, 'MongoDB', 'MariaDB');
check(r.ok && /SELECT/.test(r.text) && /GROUP BY/.test(r.text) && /SUM\(/.test(r.text), 'convert MongoDB→MariaDB produces SQL');
r = convertQuery(cMongo, 'MongoDB', 'PostgreSQL');
check(r.ok && /SELECT/.test(r.text), 'convert MongoDB→PostgreSQL ok');
r = convertQuery(cSQL, 'MariaDB', 'MySQL');
check(r.ok && /SELECT/.test(r.text), 'convert MariaDB→MySQL ok');
// converted SQL→Mongo should itself parse+flow
const back = runPipeline(convertQuery(cSQL, 'MariaDB', 'MongoDB').text, { dialect: 'MongoDB' });
check(back.ok, 'converted MariaDB→MongoDB re-parses as a valid pipeline');
// converted Mongo→SQL should itself parse+flow
const back2 = runPipeline(convertQuery(cMongo, 'MongoDB', 'MariaDB').text, { dialect: 'MariaDB' });
check(back2.ok, 'converted MongoDB→MariaDB re-parses as valid SQL');

// ---- query runner: Mongo command parsing (no database needed) ----
import { parseCommand } from '../src/lib/server/drivers/mongo-command.js';
import { encodeCell, toGrid } from '../src/lib/server/drivers/cells.js';

const okCmd = (text) => { const r = parseCommand(text); check(r.ok, `mongo-cmd ok: ${text}`); return r; };
const badCmd = (text, label) => check(!parseCommand(text).ok, `mongo-cmd rejects ${label}`);

let cmd = okCmd('db.orders.find({ status: "active" })');
check(cmd.collection === 'orders' && cmd.method === 'find', 'mongo-cmd: collection + method');
check(cmd.args[0] && cmd.args[0].status === 'active', 'mongo-cmd: filter parsed');

cmd = okCmd('db.orders.find({ n: { $gt: 5 } }).sort({ n: -1 }).limit(10)');
check(cmd.modifiers.sort && cmd.modifiers.sort.n === -1, 'mongo-cmd: .sort() modifier');
check(cmd.modifiers.limit === 10, 'mongo-cmd: .limit() modifier');

cmd = okCmd('db.getCollection("my-coll").countDocuments({})');
check(cmd.collection === 'my-coll', 'mongo-cmd: getCollection() form');

cmd = okCmd('db.people.find({ name: /nizar/i })');
check(cmd.args[0].name instanceof RegExp && cmd.args[0].name.flags === 'i', 'mongo-cmd: regex revived with flags');

cmd = okCmd('db.u.deleteOne({ _id: ObjectId("507f1f77bcf86cd799439011") })');
check(cmd.args[0]._id && cmd.args[0]._id.constructor.name === 'ObjectId', 'mongo-cmd: ObjectId revived');

cmd = okCmd('db.u.updateMany({ a: 1 }, { $set: { seen: ISODate("2026-01-02") } })');
check(cmd.args[1].$set.seen instanceof Date, 'mongo-cmd: ISODate revived to Date');

// Failures must come back as {ok:false}, never as a thrown exception.
badCmd('db.x.frobnicate({})', 'unknown method');
badCmd('db.x.find({ a: someVar })', 'bare JS variable');
badCmd('db.u.find({ d: ISODate("nope") })', 'invalid date');
badCmd('db.x.find({', 'unbalanced parens');
badCmd('drop database', 'non-db.* text');
badCmd('db.x.find({}).explain()', 'unsupported modifier');

// ---- query runner: cell encoding survives JSON transport ----
check(encodeCell(null).v === null, 'cell: null');
check(encodeCell(10n).v === '10', 'cell: bigint → string (no precision loss)');
check(encodeCell(new Date('2026-01-02T03:04:05Z')).v === '2026-01-02T03:04:05.000Z', 'cell: date → ISO');
check(encodeCell(Buffer.from('hi')).v === '0x6869', 'cell: small buffer → hex');
check(encodeCell(Buffer.alloc(64)).v === '<64 bytes>', 'cell: large buffer → size only');
check(encodeCell({ a: 1 }).t === 'json', 'cell: object → json');
check(JSON.stringify(encodeCell({ big: 1n })).includes('1'), 'cell: nested bigint is JSON-safe');

const grid = toGrid([{ a: 1 }, { b: 2 }]);
check(grid.columns.join(',') === 'a,b', 'grid: heterogeneous docs union their columns');
check(grid.rows[0][1].v === null && grid.rows[1][0].v === null, 'grid: missing fields become null cells');

// ---- table editor: identifier validation is the SQL-injection boundary ----
import {
  assertIdent, assertColumn, qMy, qPg, assertKeyComplete, assertSingleRow
} from '../src/lib/server/drivers/identifiers.js';

const rejects = (fn, label) => {
  try { fn(); check(false, `identifiers reject ${label}`); }
  catch (e) { check(e.expected === true, `identifiers reject ${label}`); }
};
const accepts = (fn, label) => {
  try { fn(); check(true, `identifiers accept ${label}`); }
  catch (e) { check(false, `identifiers accept ${label} (threw: ${e.message})`); }
};

accepts(() => assertIdent('users'), 'plain name');
accepts(() => assertIdent('tabSales Order'), 'name with a space');
accepts(() => assertIdent('my-table.v2'), 'name with dash and dot');
rejects(() => assertIdent('users; DROP TABLE users'), 'statement terminator');
rejects(() => assertIdent('users`'), 'backtick');
rejects(() => assertIdent('users"'), 'double quote');
rejects(() => assertIdent("users'"), 'single quote');
rejects(() => assertIdent('users(1)'), 'parentheses');
rejects(() => assertIdent(''), 'empty name');
rejects(() => assertIdent('x'.repeat(200)), 'over-long name');
rejects(() => assertColumn('name" = \'x\', "email'), 'injected SET fragment');
rejects(() => assertColumn('a,b'), 'comma in column');

// Quoting must neutralise any quote char that survives validation.
check(qMy('a`b') === '`a``b`', 'qMy doubles backticks');
check(qPg('a"b') === '"a""b"', 'qPg doubles double-quotes');

// A row must be fully addressable before any write is built.
rejects(() => assertKeyComplete([], { id: 1 }), 'write with no primary key');
rejects(() => assertKeyComplete(['a', 'b'], { a: 1 }), 'write with partial composite key');
accepts(() => assertKeyComplete(['a', 'b'], { a: 1, b: 2 }), 'complete composite key');

// Never let a write that hit the wrong number of rows pass silently.
accepts(() => assertSingleRow(1), 'exactly one row affected');
rejects(() => assertSingleRow(0), 'zero rows affected');
rejects(() => assertSingleRow(2), 'multiple rows affected');

// ---- optimize advisor ----------------------------------------------------
const optOf = (sql, dialect = 'MariaDB') => {
  const r = runPipeline(sql, { dialect });
  return r.ok ? r.optimization : null;
};

let opt = optOf(`SELECT a.id FROM orders a JOIN users u ON u.id = a.user_id
  WHERE a.status = 'x' AND a.created > '2026-01-01' ORDER BY a.created DESC`);
check(!!opt, 'optimize: produced for a normal query');
const ordersIdx = opt.indexes.find((i) => i.table === 'orders');
check(!!ordersIdx, 'optimize: suggests an index on the filtered table');
// Equality must lead a composite index, then join/range, then sort.
check(ordersIdx.columns[0].role === 'equality', 'optimize: equality column leads the index');
check(ordersIdx.columns.some((c) => c.column === 'created'), 'optimize: range column included');
check(opt.indexes.some((i) => i.table === 'users'), 'optimize: suggests an index for the join side');
check(/CREATE INDEX/.test(ordersIdx.sql), 'optimize: emits copyable DDL');

// A column wrapped in a function cannot use a plain index — don't suggest one.
opt = optOf(`SELECT id FROM orders WHERE DATE(created) = '2026-01-01'`);
check(
  !opt.indexes.some((i) => i.columns.some((c) => c.column === 'created')),
  'optimize: no index suggested for a function-wrapped column'
);

// Only performance findings reach the Optimize tab.
opt = optOf(`SELECT COUNT(id) AS n FROM orders WHERE status = 'x'`);
check(!opt.suggestions.some((s) => s.id.includes('count-column')), 'optimize: style findings stay out');

// Verdict tracks the worst suggestion present.
opt = optOf(`SELECT * FROM orders a JOIN users b WHERE a.title LIKE '%x%'`);
check(opt.verdict === 'perlu-perhatian', 'optimize: high-impact problems flip the verdict');
check(opt.score < 100, 'optimize: score drops when there are suggestions');

opt = optOf(`SELECT id FROM orders WHERE status = 'x' LIMIT 10`);
check(opt.verdict === 'rapi', 'optimize: clean query reads as tidy');
check(opt.checks.every((c) => typeof c.ok === 'boolean'), 'optimize: checklist is fully evaluated');

opt = optOf('db.orders.aggregate([{ $match: { status: "a" } }, { $sort: { total: -1 } }])', 'MongoDB');
check(!!opt && opt.indexes.length > 0, 'optimize: suggests a Mongo index from $match/$sort');
check(/createIndex/.test(opt.indexes[0].sql), 'optimize: emits a Mongo createIndex command');

// ---- EXPLAIN normalizer + node matching (fixtures captured from real PostgreSQL 14 / MariaDB 11.7) ----
import { readFileSync } from 'fs';
import { classifyStatement, readOnlyViolation, splitStatements } from '../src/lib/statement.js';
import { validate as validateConnection, parseNodes, REDIS_MODES } from '../src/lib/server/config.js';
import { normalizeIndexSpecs } from '../src/lib/server/drivers/mongo.js';
import { validateQuery, MAX_QUERY_CHARS } from '../src/lib/server/queries.js';
import { csvCell, csvRow, toCsv as csvOf, filename, BOM } from '../src/lib/server/csv.js';
import { clampRows, MAX_EXPORT_ROWS } from '../src/lib/server/export/table.js';
import { parseConditions, buildWhere } from '../src/lib/server/drivers/where.js';
import { describeConditions, filterSlug, MAX_CONDITIONS } from '../src/lib/filter.js';
import { sqlLiteral, timestampText } from '../src/lib/server/export/sql-literal.js';
import { insertStatement, dumpHeader, assertDumpable } from '../src/lib/server/export/sql-dump.js';
import { createTableSQL } from '../src/lib/server/export/ddl.js';
import { assertKillable } from '../src/lib/server/kill-guard.js';
import { formatQuery, canFormat } from '../src/lib/format.js';
import {
  recordSamples, trend, sparklinePath, alerts, queueLevel, workerLevel,
  sanitizeThresholds, clearSeries, MAX_POINTS, DEFAULT_THRESHOLDS
} from '../src/lib/queue-trend.js';
import {
  referencedTables, currentWord, aliasMap, suggest,
  getColumns, putColumns, forgetConnection, clearSchemaCache, claimFetch, releaseFetch, columnsKey,
  isInsideLiteral
} from '../src/lib/schema.js';
import { annotateSuggestions, findRedundant, tablesOf } from '../src/lib/analyzer/index-match.js';
import { cacheKey, getCached, putCached, clearCache, TTL_MS } from '../src/lib/analyzer/index-cache.js';
import { tlsOptions, sslModeOf, isInlinePem } from '../src/lib/server/tls.js';
import { toCsv, jobsToCsv, queuesToCsv } from '../src/lib/server/redis/export.js';
import { parseTime, truncate, maybeJson, pageRange } from '../src/lib/server/redis/util.js';
import { normalizeExplain } from '../src/lib/explain/normalize.js';
import { matchExplainToFlow } from '../src/lib/explain/match.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/explain/${name}.json`, import.meta.url)));
const fixtureText = (name) => readFileSync(new URL(`./fixtures/explain/${name}.json`, import.meta.url), 'utf8');

let ex = normalizeExplain('PostgreSQL', fixture('pg_seqscan'));
check(ex.relations.length === 1 && ex.relations[0].access === 'full', 'explain: pg seq scan detected as full');
check(ex.relations[0].estRows === 16787, 'explain: pg seq scan row estimate read correctly');
check(ex.warnings.some((w) => /Seq Scan/.test(w)), 'explain: pg seq scan produces a warning');
check(ex.analyzed === false, 'explain: plan-only pg run is not marked analyzed');

ex = normalizeExplain('PostgreSQL', fixture('pg_indexjoin'));
check(ex.analyzed === true, 'explain: ANALYZE run is marked analyzed');
check(ex.relations.every((r) => r.access === 'index'), 'explain: pg index-join both sides read as index access');
const bitmap = ex.relations.find((r) => r.accessLabel === 'Bitmap Heap Scan');
check(!!bitmap && bitmap.index === 'idx_orders_customer', 'explain: Bitmap Heap Scan inherits its child Bitmap Index Scan\'s index name');
check(ex.totalTimeMs != null, 'explain: pg ANALYZE exposes execution time');

ex = normalizeExplain('PostgreSQL', fixture('pg_filterwaste'));
check(ex.warnings.some((w) => /dibuang oleh filter/.test(w)), 'explain: pg high filter-waste ratio is flagged');

ex = normalizeExplain('MariaDB', fixtureText('my_seqscan'));
check(ex.relations[0].access === 'full' && ex.relations[0].accessLabel === 'ALL', 'explain: mysql ALL access reads as full scan');
check(ex.analyzed === false, 'explain: mysql plan-only never claims analyzed (EXPLAIN never executes)');

ex = normalizeExplain('MariaDB', fixtureText('my_indexjoin'));
check(ex.relations.every((r) => r.access === 'index'), 'explain: mysql ref/const access reads as index');
check(ex.relations.some((r) => r.index === 'idx_orders_customer'), 'explain: mysql index name extracted');

ex = normalizeExplain('MariaDB', fixtureText('my_filesort'));
check(ex.warnings.some((w) => /filesort/.test(w)), 'explain: mariadb nested filesort object is detected');

ex = normalizeExplain('MariaDB', fixtureText('my_grouptemp'));
check(ex.warnings.some((w) => /tabel sementara/.test(w)), 'explain: mariadb nested temporary_table object is detected');
check(ex.warnings.some((w) => /filesort/.test(w)), 'explain: mariadb group-by query also flags its filesort');

// Matching real EXPLAIN facts onto a real flow, by alias — the whole point of
// the feature: the diagram badge has to land on the right node.
{
  const r = runPipeline(
    'SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.customer_id = 42',
    { dialect: 'PostgreSQL' }
  );
  check(r.ok, 'explain-match: fixture query parses');
  const norm = normalizeExplain('PostgreSQL', fixture('pg_indexjoin'));
  const m = matchExplainToFlow(r.flow, norm);
  check(m.unmatched.length === 0, 'explain-match: every relation resolves to a flow node');
  const joinNode = r.flow.blocks[0].nodes.find((n) => n.stage === 'JOIN');
  const fromNode = r.flow.blocks[0].nodes.find((n) => n.stage === 'FROM');
  check(!!m.badges[joinNode.id] && m.badges[joinNode.id].access === 'index', 'explain-match: JOIN node (customers) gets an index badge');
  check(!!m.badges[fromNode.id] && m.badges[fromNode.id].index === 'idx_orders_customer', 'explain-match: FROM node (orders) carries the bitmap index name');
}
{
  // Same query text, MySQL fixture where table_name is reported as the alias —
  // must still resolve through the alias map, not just a literal table match.
  const r = runPipeline(
    'SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.customer_id = 42',
    { dialect: 'MariaDB' }
  );
  const norm = normalizeExplain('MariaDB', fixtureText('my_indexjoin'));
  const m = matchExplainToFlow(r.flow, norm);
  check(m.unmatched.length === 0, 'explain-match: mysql alias-as-table_name still resolves via the alias map');
}

// ---------------------------------------------------------------------------
// Write detection — what the read-only gate and the confirm dialog both rely on
// ---------------------------------------------------------------------------
{
  const reads = [
    ['MariaDB', 'SELECT * FROM orders'],
    ['MariaDB', '  -- catatan\n /* blok */ select 1'],
    ['MariaDB', 'SHOW TABLES'],
    ['PostgreSQL', 'WITH x AS (SELECT 1) SELECT * FROM x'],
    ['PostgreSQL', 'EXPLAIN SELECT * FROM orders'],
    ['MongoDB', 'db.orders.find({ status: "active" })'],
    ['MongoDB', 'db.orders.aggregate([{ $match: {} }])'],
    ['MongoDB', 'db.getCollection("orders").countDocuments({})']
  ];
  for (const [d, q] of reads) {
    check(!classifyStatement(d, q).write, `classify: read stays a read — ${q.slice(0, 40)}`);
    check(readOnlyViolation(d, q) === '', `read-only allows: ${q.slice(0, 40)}`);
  }

  const writes = [
    ['MariaDB', 'UPDATE orders SET s=1 WHERE id=2'],
    ['MariaDB', 'INSERT INTO orders (a) VALUES (1)'],
    ['MariaDB', 'DROP TABLE orders'],
    ['MariaDB', 'TRUNCATE TABLE orders'],
    ['MariaDB', 'CALL rebuild_everything()'],
    // A CTE that ends in DELETE still deletes, however much it looks like a SELECT.
    ['PostgreSQL', 'WITH d AS (DELETE FROM orders RETURNING *) SELECT * FROM d'],
    ['PostgreSQL', 'EXPLAIN ANALYZE UPDATE orders SET s=1'],
    ['MariaDB', 'SELECT a FROM t INTO OUTFILE "/tmp/x"'],
    ['MongoDB', 'db.orders.deleteOne({ _id: 1 })'],
    ['MongoDB', 'db.orders.aggregate([{ $match: {} }, { $out: "copy" }])'],
    ['MongoDB', 'db.orders.drop()']
  ];
  for (const [d, q] of writes) {
    check(classifyStatement(d, q).write, `classify: write detected — ${q.slice(0, 40)}`);
    check(readOnlyViolation(d, q) !== '', `read-only refuses: ${q.slice(0, 40)}`);
  }
}
{
  // Unfiltered writes drive the loud variant of the dialog and can never be
  // waved through by "don't ask again".
  check(classifyStatement('MariaDB', 'UPDATE orders SET s=1').unfiltered, 'classify: UPDATE without WHERE is unfiltered');
  check(!classifyStatement('MariaDB', 'UPDATE orders SET s=1 WHERE id=1').unfiltered, 'classify: UPDATE with WHERE is filtered');
  check(classifyStatement('MariaDB', 'DELETE FROM orders').unfiltered, 'classify: DELETE without WHERE is unfiltered');
  // A WHERE that only exists inside a comment is not a WHERE.
  check(classifyStatement('MariaDB', 'DELETE FROM orders -- WHERE id=1').unfiltered, 'classify: a commented-out WHERE does not count');
  check(classifyStatement('MongoDB', 'db.orders.updateMany({}, { $set: { a: 1 } })').unfiltered, 'classify: updateMany({}) is unfiltered');
  check(!classifyStatement('MongoDB', 'db.orders.updateMany({ a: 1 }, { $set: { b: 2 } })').unfiltered, 'classify: updateMany with a filter is filtered');
  check(classifyStatement('MariaDB', 'DROP TABLE orders').destructive, 'classify: DROP is destructive');
  check(classifyStatement('MongoDB', 'db.orders.drop()').destructive, 'classify: drop() is destructive');
}
{
  // Locking reads do not modify data, but they hold locks — a read-only
  // connection refuses them, and the UI warns on every connection.
  const c = classifyStatement('MariaDB', 'SELECT * FROM orders FOR UPDATE');
  check(!c.write && c.locking, 'classify: SELECT … FOR UPDATE is a locking read');
  check(readOnlyViolation('MariaDB', 'SELECT * FROM orders FOR UPDATE') !== '', 'read-only refuses a locking read');
  check(classifyStatement('MariaDB', 'SELECT * FROM t LOCK IN SHARE MODE').locking, 'classify: LOCK IN SHARE MODE is locking');
}
{
  // Anything unparseable is treated as a write: failing closed is the point.
  check(classifyStatement('MariaDB', 'BEGIN; something weird').write, 'classify: unknown SQL fails closed as a write');
  check(classifyStatement('MongoDB', 'orders.find()').write, 'classify: unknown mongo command fails closed as a write');
  check(classifyStatement('MariaDB', '').write, 'classify: empty input fails closed as a write');
}

// ---------------------------------------------------------------------------
// Index advisor vs. the indexes a database actually has
// ---------------------------------------------------------------------------
{
  // Shapes as they really arrive: suggestions use `column`, the catalog `name`.
  const suggestions = [
    { table: 'orders', columns: [{ column: 'status', role: 'equality' }, { column: 'created_at', role: 'range' }] },
    { table: 'customers', columns: [{ column: 'id', role: 'join' }] },
    { table: 'shipments', columns: [{ column: 'code', role: 'equality' }] }
  ];
  const existing = [
    { table: 'orders', name: 'idx_status_created', unique: false, primary: false, columns: [{ name: 'status' }, { name: 'created_at' }, { name: 'total' }] },
    { table: 'customers', name: 'PRIMARY', unique: true, primary: true, columns: [{ name: 'id' }] },
    { table: 'shipments', name: 'idx_warehouse', unique: false, primary: false, columns: [{ name: 'warehouse_id' }] }
  ];

  const [orders, customers, shipments] = annotateSuggestions(suggestions, existing);
  check(orders.status === 'covered', 'index-match: a wider existing index still covers the wanted columns');
  check(orders.matches[0].covers === 2 && orders.matches[0].of === 2, 'index-match: reports how many wanted columns are covered');
  check(customers.status === 'covered', 'index-match: a primary key counts as an index');
  check(shipments.status === 'missing', 'index-match: an index on another column is not a match');
  check(shipments.matches.length === 0, 'index-match: a non-matching index is not listed as a near miss');
}
{
  // An index only helps if it matches from its first column: a query filtering
  // on `status` cannot use an index that starts with `tenant_id`.
  const suggestions = [{ table: 'orders', columns: [{ column: 'status' }, { column: 'created_at' }] }];
  const wrongOrder = [{ table: 'orders', name: 'idx_created_status', columns: [{ name: 'created_at' }, { name: 'status' }] }];
  check(annotateSuggestions(suggestions, wrongOrder)[0].status === 'missing',
    'index-match: column order matters — a reversed index does not count');

  const partial = [{ table: 'orders', name: 'idx_status', columns: [{ name: 'status' }] }];
  const got = annotateSuggestions(suggestions, partial)[0];
  check(got.status === 'partial', 'index-match: a leading-column match is partial, not missing');
  check(got.matches[0].covers === 1 && got.matches[0].of === 2, 'index-match: partial says how far the match goes');
}
{
  // Table names arrive quoted or schema-qualified from the parser.
  const suggestions = [{ table: 'shop.`Orders`', columns: [{ column: 'Status' }] }];
  const existing = [{ table: 'orders', name: 'idx_status', columns: [{ name: 'status' }] }];
  check(annotateSuggestions(suggestions, existing)[0].status === 'covered',
    'index-match: schema prefixes, quotes, and case do not break matching');
  check(tablesOf(suggestions).length === 1, 'index-match: tablesOf lists each table once');
  check(tablesOf([{ table: 'a' }, { table: 'a' }, { table: 'b' }]).join(',') === 'a,b', 'index-match: tablesOf de-duplicates');
}
{
  const redundant = findRedundant([
    { table: 'orders', name: 'idx_status', unique: false, primary: false, columns: [{ name: 'status' }] },
    { table: 'orders', name: 'idx_status_created', unique: false, primary: false, columns: [{ name: 'status' }, { name: 'created_at' }] },
    { table: 'orders', name: 'PRIMARY', unique: true, primary: true, columns: [{ name: 'id' }] },
    { table: 'orders', name: 'idx_id_status', unique: false, primary: false, columns: [{ name: 'id' }, { name: 'status' }] },
    { table: 'orders', name: 'uq_code', unique: true, primary: false, columns: [{ name: 'code' }] },
    { table: 'orders', name: 'idx_code_created', unique: false, primary: false, columns: [{ name: 'code' }, { name: 'created_at' }] }
  ]);
  const names = redundant.map((r) => r.name);
  check(names.includes('idx_status'), 'redundant: a prefix of a longer index is redundant');
  check(!names.includes('idx_status_created'), 'redundant: the longer index is kept');
  // Dropping a primary key changes what the table allows, not just its speed.
  check(!names.includes('PRIMARY'), 'redundant: a primary key is never called redundant');
  // A unique index enforces uniqueness; a wider non-unique index does not.
  check(!names.includes('uq_code'), 'redundant: a unique index is not replaced by a wider non-unique one');

  const dup = findRedundant([
    { table: 'orders', name: 'idx_a', columns: [{ name: 'a' }] },
    { table: 'orders', name: 'idx_a_copy', columns: [{ name: 'a' }] }
  ]);
  check(dup.length > 0 && dup[0].duplicate, 'redundant: an exact duplicate is flagged as a duplicate');

  check(findRedundant([
    { table: 'orders', name: 'idx_a', columns: [{ name: 'a' }] },
    { table: 'customers', name: 'idx_a2', columns: [{ name: 'a' }] }
  ]).length === 0, 'redundant: indexes on different tables never shadow each other');
}
{
  clearCache();
  const key = cacheKey('conn-1', ['orders', 'customers']);
  check(key !== '', 'index-cache: a key is built from connection and tables');
  check(cacheKey('', ['orders']) === '' && cacheKey('conn-1', []) === '', 'index-cache: an incomplete key is empty, never cached');
  check(cacheKey('conn-1', ['orders']) !== key, 'index-cache: a different table set is a different key');
  check(cacheKey('conn-2', ['orders', 'customers']) !== key, 'index-cache: a different connection is a different key');

  putCached(key, { indexes: [1], at: Date.now() });
  check(getCached(key) !== null, 'index-cache: a fresh entry is returned');
  // The panel is rebuilt on every analysis; that must not lose the answer.
  check(getCached(key).indexes.length === 1, 'index-cache: the entry survives being read repeatedly');
  check(getCached(key, Date.now() + TTL_MS + 1) === null, 'index-cache: an expired entry is dropped, not served as current');
  check(getCached(key) === null, 'index-cache: an expired entry is evicted for good');
  clearCache();
}

// ---------------------------------------------------------------------------
// Query history (browser storage) and saved queries (server file)
// ---------------------------------------------------------------------------
{
  // history.js talks to localStorage, which node does not have. A minimal
  // stand-in is enough to exercise the logic that matters.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  const { loadHistory, remember, removeEntry, clearHistory, searchHistory, MAX_ENTRIES } =
    await import('../src/lib/history.js');

  clearHistory();
  check(loadHistory().length === 0, 'history: starts empty');

  remember({ q: 'SELECT 1', ok: true, ms: 5, conn: 'A', dialect: 'MySQL' });
  remember({ q: 'SELECT 2', ok: false, ms: 9, conn: 'B', dialect: 'PostgreSQL' });
  check(loadHistory()[0].q === 'SELECT 2', 'history: newest run comes first');
  check(loadHistory().length === 2, 'history: both runs are kept');

  // Re-running the same text should move it up, not add a duplicate.
  remember({ q: 'SELECT 1', ok: false, ms: 11, conn: 'A' });
  const afterRepeat = loadHistory();
  check(afterRepeat.length === 2, 'history: re-running a query does not duplicate it');
  check(afterRepeat[0].q === 'SELECT 1' && afterRepeat[0].ok === false, 'history: the repeat keeps the newest outcome');

  check(searchHistory(afterRepeat, 'select 2').length === 1, 'history: search matches query text case-insensitively');
  check(searchHistory(afterRepeat, 'postgre').length === 1, 'history: search also matches the dialect');
  check(searchHistory(afterRepeat, '').length === 2, 'history: an empty search returns everything');

  // Entries recorded in the same millisecond must still be individually
  // removable, so identity is an id of its own, not the timestamp.
  const first = loadHistory()[0];
  removeEntry(first.id);
  const left = loadHistory();
  check(left.length === 1, 'history: removing one entry leaves the other');
  check(left[0].q !== first.q, 'history: the right entry was removed');

  clearHistory();
  for (let i = 0; i < MAX_ENTRIES + 20; i++) remember({ q: `SELECT ${i}`, ok: true, ms: 1 });
  check(loadHistory().length === MAX_ENTRIES, 'history: the list is capped');
  check(loadHistory()[0].q === `SELECT ${MAX_ENTRIES + 19}`, 'history: the cap drops the oldest, not the newest');

  remember({ q: '   ', ok: true, ms: 1 });
  check(loadHistory()[0].q !== '   ', 'history: a blank query is not recorded');

  // Corrupt storage must not take the page down with it.
  store.set('qf_query_history', '{not json');
  check(loadHistory().length === 0, 'history: unreadable storage reads as empty');
  clearHistory();
  delete globalThis.localStorage;
}
{
  const ok = validateQuery({ name: '  Cek stok  ', query: 'SELECT 1', dialect: 'MariaDB', note: ' pagi ' });
  check(ok.ok && ok.value.name === 'Cek stok', 'saved-query: the name is trimmed');
  check(ok.value.note === 'pagi', 'saved-query: the note is trimmed');
  check(ok.value.createdAt === ok.value.updatedAt, 'saved-query: a new query is created and updated at once');

  check(!validateQuery({ name: '', query: 'SELECT 1' }).ok, 'saved-query: a name is required');
  check(!validateQuery({ name: 'x', query: '   ' }).ok, 'saved-query: an empty query is refused');
  check(!validateQuery({ name: 'x'.repeat(200), query: 'SELECT 1' }).ok, 'saved-query: an absurd name is refused');
  check(!validateQuery({ name: 'x', query: 'a'.repeat(MAX_QUERY_CHARS + 1) }).ok, 'saved-query: a runaway paste is refused');

  // Editing keeps identity and creation time; only updatedAt moves.
  const existing = { id: 'abc', createdAt: '2020-01-01T00:00:00.000Z', dialect: 'PostgreSQL', connectionId: 'conn-1' };
  const edited = validateQuery({ name: 'baru', query: 'SELECT 2' }, { existing });
  check(edited.value.id === 'abc', 'saved-query: editing keeps the id');
  check(edited.value.createdAt === existing.createdAt, 'saved-query: editing keeps the creation time');
  check(edited.value.updatedAt !== existing.createdAt, 'saved-query: editing moves the update time');
  check(edited.value.dialect === 'PostgreSQL' && edited.value.connectionId === 'conn-1',
    'saved-query: dialect and connection survive an edit that omits them');
}

// ---------------------------------------------------------------------------
// Editor: formatting and schema-aware completion
// ---------------------------------------------------------------------------
{
  check(canFormat('MariaDB') && canFormat('MySQL') && canFormat('PostgreSQL'), 'format: every SQL dialect is supported');
  check(!canFormat('MongoDB'), 'format: MongoDB is not claimed to be supported');

  const r = formatQuery('select a,b from t where x=1 and y=2', 'MariaDB');
  check(r.ok, 'format: a valid query formats');
  check(/^SELECT/.test(r.text), 'format: keywords are upper-cased');
  check(r.text.split('\n').length > 1, 'format: a one-liner becomes several lines');

  check(!formatQuery('', 'MariaDB').ok, 'format: an empty editor is reported, not formatted');
  const mongo = formatQuery('db.a.find({})', 'MongoDB');
  check(!mongo.ok && /MongoDB/.test(mongo.error), 'format: MongoDB explains why it cannot format');
  // Half-typed SQL is the normal state of an editor — it must not throw.
  const broken = formatQuery('SELECT FROM WHERE ((', 'MariaDB');
  check(typeof broken.ok === 'boolean', 'format: unparseable input returns a result instead of throwing');
}
{
  const sql = 'SELECT o.id FROM orders o JOIN customers AS c ON c.id = o.customer_id WHERE o.stat';
  check(referencedTables(sql).join(',') === 'orders,customers', 'schema: FROM and JOIN tables are found');
  check(referencedTables('UPDATE `shop`.`orders` SET a=1')[0] === 'orders', 'schema: quotes and schema prefixes are stripped');
  check(referencedTables('db.orders.find({}); db.getCollection("stok").find()', 'mongo').join(',') === 'orders,stok',
    'schema: mongo collections are found, including getCollection()');

  const at = currentWord(sql, sql.length);
  check(at.word === 'stat' && at.qualifier === 'o', 'schema: the word being typed and its qualifier are read');
  check(currentWord('SELECT * FROM ', 14) === null, 'schema: no word means no suggestions');

  const aliases = aliasMap(sql);
  check(aliases.get('o') === 'orders' && aliases.get('c') === 'customers', 'schema: aliases map to their tables');
  // `FROM orders WHERE` — "where" is a keyword, not an alias for orders.
  check(aliasMap('SELECT * FROM orders WHERE x = 1').size === 0, 'schema: keywords are never treated as aliases');
}
{
  const schema = {
    tables: ['orders', 'order_items', 'customers'],
    columnsByTable: new Map([
      ['orders', ['id', 'status', 'customer_id', 'created_at']],
      ['customers', ['id', 'name', 'city']]
    ])
  };

  const table = suggest(currentWord('SELECT * FROM ord', 17), schema);
  check(table.length === 2 && table[0].label === 'orders', 'suggest: table names complete, shortest match first');
  check(table.every((s) => s.kind === 'table'), 'suggest: those are labelled as tables');

  const qualified = { word: 'stat', qualifier: 'o', qualifierTable: 'orders' };
  const cols = suggest(qualified, schema);
  check(cols.length === 1 && cols[0].label === 'status' && cols[0].detail === 'orders',
    'suggest: a qualified word completes only that table\'s columns');

  // `c.` must not offer columns of orders.
  const otherTable = suggest({ word: 'ci', qualifier: 'c', qualifierTable: 'customers' }, schema);
  check(otherTable.length === 1 && otherTable[0].label === 'city', 'suggest: the qualifier picks the right table');

  check(suggest({ word: '', qualifier: null }, schema).length === 0, 'suggest: nothing typed means nothing offered');
  check(suggest({ word: 'zzz', qualifier: null }, schema).length === 0, 'suggest: no match means an empty list');
  check(suggest({ word: 'id', qualifier: null }, schema, { limit: 1 }).length === 1, 'suggest: the limit is respected');
}
{
  clearSchemaCache();
  putColumns('conn-1', 'Orders', ['id', 'status']);
  check(getColumns('conn-1', 'orders').length === 2, 'schema-cache: lookups ignore case');
  check(getColumns('conn-2', 'orders') === null, 'schema-cache: another connection has its own columns');

  // Two keystrokes must not fire the same column request twice.
  const key = columnsKey('conn-1', 'customers');
  check(claimFetch(key) === true, 'schema-cache: the first request is claimed');
  check(claimFetch(key) === false, 'schema-cache: a second request while one is in flight is refused');
  releaseFetch(key);
  check(claimFetch(key) === true, 'schema-cache: releasing lets the next request through');
  releaseFetch(key);

  forgetConnection('conn-1');
  check(getColumns('conn-1', 'orders') === null, 'schema-cache: a connection can be forgotten');
  clearSchemaCache();
}

// ---------------------------------------------------------------------------
// Queue trends and alert thresholds
// ---------------------------------------------------------------------------
{
  clearSeries();
  const q = (backlog, failed = 0) => [{ system: 'rq', name: 'default', backlog, failed }];

  check(trend('c1', 'rq', 'default').direction === 'baru', 'trend: no samples yet says so instead of guessing');

  recordSamples('c1', q(100), 1000);
  check(trend('c1', 'rq', 'default').direction === 'baru', 'trend: one sample is still not a trend');

  recordSamples('c1', q(400), 2000);
  const rising = trend('c1', 'rq', 'default');
  check(rising.direction === 'naik' && rising.delta === 300, 'trend: a growing backlog reads as rising');
  check(rising.peak === 400 && rising.spanMs === 1000, 'trend: peak and time span come from the samples');

  clearSeries();
  recordSamples('c1', q(400), 1000);
  recordSamples('c1', q(50), 2000);
  check(trend('c1', 'rq', 'default').direction === 'turun', 'trend: a draining backlog reads as falling');

  // A queue wobbling by a job or two is not a trend.
  clearSeries();
  recordSamples('c1', q(100), 1000);
  recordSamples('c1', q(101), 2000);
  check(trend('c1', 'rq', 'default').direction === 'datar', 'trend: small jitter is flat, not rising');

  // Series are per connection and per queue.
  clearSeries();
  recordSamples('c1', q(10), 1000);
  recordSamples('c2', q(999), 1000);
  check(trend('c1', 'rq', 'default').points[0] === 10, 'trend: another connection has its own samples');
  check(trend('c1', 'rq', 'lain').points.length === 0, 'trend: another queue has its own samples');

  clearSeries();
  for (let i = 0; i < MAX_POINTS + 25; i++) recordSamples('c1', q(i), 1000 + i);
  const capped = trend('c1', 'rq', 'default');
  check(capped.points.length === MAX_POINTS, 'trend: samples are capped');
  check(capped.points[capped.points.length - 1] === MAX_POINTS + 24, 'trend: the cap drops the oldest samples');
  clearSeries();
}
{
  check(sparklinePath([]) === '' && sparklinePath([5]) === '', 'sparkline: fewer than two points draws nothing');
  const path = sparklinePath([0, 10, 5], 64, 16);
  check(path.startsWith('M0.0,') && path.split('L').length === 3, 'sparkline: one move and two lines for three points');
  // A flat series should sit on the floor of the box, not float in the middle.
  const flat = sparklinePath([0, 0, 0]);
  check(/M0\.0,15\.0/.test(flat), 'sparkline: an all-zero series rests on the baseline');
}
{
  const t = sanitizeThresholds({ backlogWarn: 5, backlogCrit: 2, failedWarn: -3, heartbeatWarn: 'abc' });
  check(t.backlogCrit >= t.backlogWarn, 'thresholds: a critical level below the warning level is lifted');
  check(t.failedWarn === DEFAULT_THRESHOLDS.failedWarn, 'thresholds: a negative value falls back to the default');
  check(t.heartbeatWarn === DEFAULT_THRESHOLDS.heartbeatWarn, 'thresholds: a non-number falls back to the default');
  check(sanitizeThresholds({ backlogWarn: 0 }).backlogWarn === 0, 'thresholds: zero is a legitimate setting');
}
{
  const t = { ...DEFAULT_THRESHOLDS, backlogWarn: 100, backlogCrit: 1000, failedWarn: 1, failedCrit: 50 };
  check(queueLevel({ backlog: 5, failed: 0 }, t) === '', 'level: a quiet queue is not flagged');
  check(queueLevel({ backlog: 150, failed: 0 }, t) === 'warn', 'level: backlog past the warning line is amber');
  check(queueLevel({ backlog: 5000, failed: 0 }, t) === 'crit', 'level: a huge backlog is red');
  check(queueLevel({ backlog: 0, failed: 90 }, t) === 'crit', 'level: many failures are red even with no backlog');
  // A paused queue is not draining, however small its backlog.
  check(queueLevel({ backlog: 3, failed: 0, paused: true }, t) === 'warn', 'level: a paused queue holding jobs is flagged');
  check(queueLevel({ backlog: 0, failed: 0, paused: true }, t) === '', 'level: a paused but empty queue is fine');

  check(workerLevel({ heartbeatAgoSec: 10 }, t) === '', 'level: a fresh heartbeat is fine');
  check(workerLevel({ heartbeatAgoSec: 200 }, t) === 'warn', 'level: a late heartbeat is amber');
  check(workerLevel({ heartbeatAgoSec: 600 }, t) === 'crit', 'level: a very late heartbeat is red');
  check(workerLevel({ heartbeatAgoSec: null }, t) === '', 'level: an unknown heartbeat is not an alarm');
}
{
  const t = { ...DEFAULT_THRESHOLDS };
  const list = alerts({
    queues: [
      { system: 'rq', name: 'sepi', backlog: 0, failed: 0 },
      { system: 'rq', name: 'menumpuk', backlog: 5000, failed: 0 },
      { system: 'rq', name: 'gagal', backlog: 0, failed: 3 }
    ],
    workers: [{ system: 'rq', name: 'mati', heartbeatAgoSec: 900 }]
  }, t);
  check(list.length === 3, 'alerts: only the queues and workers that need attention are listed');
  check(list[0].level === 'crit', 'alerts: critical items come first');
  check(list.some((a) => a.scope === 'worker' && a.name === 'mati'), 'alerts: a stale worker is reported');
  check(!list.some((a) => a.name === 'sepi'), 'alerts: a healthy queue is not reported');
  check(/backlog/.test(list.find((a) => a.name === 'menumpuk').text), 'alerts: the reason names the backlog');
}

// ---------------------------------------------------------------------------
// Redis deployment modes (standalone / sentinel / cluster)
// ---------------------------------------------------------------------------
{
  check(parseNodes('a:26379, b:26380').length === 2, 'nodes: a comma-separated list is parsed');
  check(parseNodes('a:26379')[0].port === 26379, 'nodes: an explicit port is kept');
  check(parseNodes('a', 26379)[0].port === 26379, 'nodes: a missing port falls back to the mode default');
  check(parseNodes('[::1]:6380')[0].host === '::1', 'nodes: a bracketed IPv6 host is unwrapped');
  check(parseNodes('a:99999').length === 0, 'nodes: an impossible port is dropped, not passed on');
  check(parseNodes('').length === 0 && parseNodes(null).length === 0, 'nodes: empty input yields no nodes');
  check(parseNodes('a:1\nb:2').length === 2, 'nodes: newlines separate nodes too');

  const base = { name: 'r', dialect: 'Redis', host: '127.0.0.1' };
  check(validateConnection(base).value.redisMode === 'standalone', 'redis-mode: standalone is the default');
  check(!validateConnection({ ...base, redisMode: 'sentinel' }).ok, 'redis-mode: sentinel without nodes is refused');
  check(!validateConnection({ ...base, redisMode: 'sentinel', redisNodes: 's:26379' }).ok,
    'redis-mode: sentinel without a master name is refused');
  check(validateConnection({ ...base, redisMode: 'sentinel', redisNodes: 's:26379', sentinelMaster: 'mymaster' }).ok,
    'redis-mode: a complete sentinel profile saves');
  check(!validateConnection({ ...base, redisMode: 'cluster' }).ok, 'redis-mode: cluster without nodes is refused');
  check(validateConnection({ ...base, redisMode: 'cluster', redisNodes: 'n1:7001, n2:7002' }).ok,
    'redis-mode: a complete cluster profile saves');
  check(!validateConnection({ ...base, redisMode: 'wat' }).ok, 'redis-mode: an unknown mode is refused');
  check(REDIS_MODES.length === 3, 'redis-mode: exactly three modes are offered');

  // The mode only applies to Redis; other dialects are untouched by it.
  check(validateConnection({ name: 'm', dialect: 'MySQL', host: 'h', redisMode: 'cluster' }).ok,
    'redis-mode: a SQL profile is not validated against Redis rules');
}

// ---------------------------------------------------------------------------
// Completion triggers — a dot, and Ctrl+Space
// ---------------------------------------------------------------------------
{
  // Typing the dot is exactly when the column list is wanted. Waiting for one
  // more character is what made the feature feel dead.
  const dot = currentWord('SELECT * FROM orders o WHERE o.', 31);
  check(dot !== null, 'trigger: a trailing dot is a completion point');
  check(dot.word === '' && dot.qualifier === 'o', 'trigger: the dot yields an empty word and the qualifier');
  check(dot.start === 31, 'trigger: the insert position is the caret, so nothing is overwritten');
  // `o . status` is valid SQL, so whitespace around the dot still qualifies.
  check(currentWord('SELECT * FROM orders o WHERE o . ', 33).qualifier === 'o', 'trigger: whitespace around the dot still qualifies');

  const schema = {
    tables: ['orders', 'order_items', 'customers'],
    columnsByTable: new Map([['orders', ['id', 'status', 'customer_id']]])
  };

  const all = suggest({ word: '', qualifier: 'o', qualifierTable: 'orders' }, schema);
  check(all.length === 3, 'trigger: an empty word after a qualifier lists every column of that table');
  check(all.every((s) => s.kind === 'column'), 'trigger: those are columns, not tables');

  // Without a qualifier an empty word must stay silent, or every keystroke
  // would dump the whole schema on screen.
  check(suggest({ word: '', qualifier: null }, schema).length === 0, 'trigger: an empty word alone suggests nothing');
  // …unless asked for explicitly.
  const forced = suggest({ word: '', qualifier: null }, schema, { force: true });
  check(forced.length === 3 && forced.every((s) => s.kind === 'table'),
    'trigger: Ctrl+Space with nothing typed lists tables, not every cached column');
  // Typing a letter brings columns back into the list.
  check(suggest({ word: 'st', qualifier: null }, schema).some((s) => s.kind === 'column'),
    'trigger: once a prefix is typed, columns are offered again');
  check(suggest(null, schema, { force: true }).length === 0, 'trigger: forcing without a position suggests nothing');
}

// ---------------------------------------------------------------------------
// Completion context — where a suggestion would do damage
// ---------------------------------------------------------------------------
{
  const inside = (q) => isInsideLiteral(q, q.length);
  // Accepting a hint inside a literal rewrites the literal, quietly changing
  // which rows the query matches.
  check(inside("SELECT * FROM t WHERE a = 'kolom"), 'context: inside a string literal');
  check(inside('SELECT * FROM t -- catatan kolom'), 'context: inside a line comment');
  check(inside('SELECT * FROM t # catatan kolom'), 'context: inside a MySQL # comment');
  check(inside('SELECT * FROM t /* catatan kolom'), 'context: inside a block comment');

  check(!inside('SELECT * FROM t WHERE kolom'), 'context: ordinary code is not a literal');
  check(!inside("SELECT 'tutup' FROM t WHERE kolom"), 'context: a closed string does not leak');
  check(!inside('SELECT * FROM t /* tutup */ WHERE kolom'), 'context: a closed block comment does not leak');
  check(!inside("SELECT 'it''s' FROM t WHERE kolom"), 'context: a doubled quote inside a string is an escape');
  // MySQL treats \' as an escape, so the string is still open. Erring toward
  // "still inside" costs a missing suggestion; erring the other way rewrites a
  // literal.
  check(inside("SELECT 'a\\' FROM t WHERE kolom"), 'context: a backslash-escaped quote keeps the string open');
  check(!inside('SELECT * FROM t\n-- baris komentar\nWHERE kolom'), 'context: a line comment ends at the newline');
  // Quoted identifiers are names, so completing inside them is the point.
  check(!inside('SELECT `kolom'), 'context: a backtick identifier still completes');
  check(!inside('SELECT "kolom'), 'context: a double-quoted identifier still completes');
}
{
  // A failed column read must not be cached: a permission error or a blip would
  // otherwise disable completion for that table until the page is reloaded.
  clearSchemaCache();
  const key = columnsKey('c1', 'orders');
  check(claimFetch(key), 'schema-cache: the failing request is claimed');
  releaseFetch(key); // the request failed, so nothing is stored
  check(getColumns('c1', 'orders') === null, 'schema-cache: a failed read leaves no empty entry behind');
  check(claimFetch(key), 'schema-cache: the next keystroke can retry');
  releaseFetch(key);
  putColumns('c1', 'orders', ['id', 'status']);
  check(getColumns('c1', 'orders').length === 2, 'schema-cache: a successful read is cached');
  clearSchemaCache();
}

// ---------------------------------------------------------------------------
// Table export and session kill
// ---------------------------------------------------------------------------
{
  // The CSV rules moved into their own module; both exports share them now.
  check(csvCell('biasa') === 'biasa', 'csv: an ordinary value is untouched');
  check(csvCell('ada, koma') === '"ada, koma"', 'csv: a comma forces quoting');
  check(csvCell('kata "dikutip"') === '"kata ""dikutip"""', 'csv: inner quotes are doubled');
  check(csvCell('dua\nbaris') === '"dua\nbaris"', 'csv: a newline stays inside one quoted field');
  check(csvCell(null) === '' && csvCell(undefined) === '', 'csv: null and undefined are empty cells');
  // Table contents are untrusted: a leading = would execute in Excel.
  for (const dangerous of ['=cmd', '+1', '-2', '@SUM(A1)']) {
    check(csvCell(dangerous).startsWith("'"), `csv: ${dangerous} is neutralised with a quote prefix`);
  }
  check(csvRow(['a', 'b']).endsWith('\r\n'), 'csv: rows are CRLF-terminated');
  check(csvOf(['h'], [['v']]).startsWith(BOM), 'csv: the file starts with a BOM for Excel');
  check(filename(['Test EX', 'orders'], 'csv').endsWith('.csv'), 'csv: filename carries the extension');
  check(!/[^a-zA-Z0-9._-]/.test(filename(['a b/c'], 'csv')), 'csv: filename strips anything unsafe for a path');
}
{
  check(clampRows(undefined) === MAX_EXPORT_ROWS, 'export: no limit means the default cap');
  check(clampRows(0) === MAX_EXPORT_ROWS, 'export: zero is not a cap of zero rows');
  check(clampRows(-5) === MAX_EXPORT_ROWS, 'export: a negative limit falls back to the cap');
  check(clampRows('abc') === MAX_EXPORT_ROWS, 'export: rubbish falls back to the cap');
  check(clampRows(10) === 10, 'export: a smaller limit is honoured');
  check(clampRows(MAX_EXPORT_ROWS * 10) === MAX_EXPORT_ROWS, 'export: the cap cannot be raised from a URL');
}
{
  const processes = [
    { id: '10', internal: false, command: 'Query', user: 'root' },
    { id: '11', internal: true, command: 'checkpointer' },
    { id: '12', internal: false, command: 'Sleep' }
  ];
  check(assertKillable(processes, '10').user === 'root', 'kill-guard: a client session is killable');
  check(assertKillable(processes, 10).id === '10', 'kill-guard: the id may arrive as a number');

  // A vanished session must not be "killed" by id — the id may already belong
  // to something else.
  let err = '';
  try { assertKillable(processes, '999'); } catch (e) { err = e.message; }
  check(/sudah tidak ada/.test(err), 'kill-guard: an unknown id is refused, not signalled');

  err = '';
  try { assertKillable(processes, '11'); } catch (e) { err = e.message; }
  check(/internal/.test(err) && /checkpointer/.test(err), 'kill-guard: a server internal is refused by name');

  err = '';
  try { assertKillable([], '10'); } catch (e) { err = e.message; }
  check(/sudah tidak ada/.test(err), 'kill-guard: an empty process list kills nothing');

  let threw = false;
  try { assertKillable(processes, 'abc'); } catch (e) { threw = e.expected === true; }
  check(threw, 'kill-guard: a non-numeric id is a clean refusal, not a crash');
}

// ---------------------------------------------------------------------------
// Regressions — each of these shipped broken once
// ---------------------------------------------------------------------------
{
  // node-postgres runs a parameterless query over the simple query protocol,
  // so `SELECT 1; DROP TABLE x` executes BOTH statements. Judging a batch by
  // its first keyword let a write through on a read-only connection.
  const batches = [
    'SELECT 1; DROP TABLE korban',
    'SELECT 1; TRUNCATE korban',
    'SELECT 1; CREATE TABLE x (i int)',
    'SELECT 1; GRANT ALL ON korban TO postgres',
    'SELECT 1; ALTER TABLE korban ADD COLUMN c int'
  ];
  for (const q of batches) {
    check(classifyStatement('PostgreSQL', q).write, `multi-statement: a trailing write is caught — ${q.slice(10, 40)}`);
    check(readOnlyViolation('PostgreSQL', q) !== '', `multi-statement: read-only refuses — ${q.slice(10, 40)}`);
  }
  check(!classifyStatement('PostgreSQL', 'SELECT 1; SELECT 2').write, 'multi-statement: a batch of reads stays a read');
  check(classifyStatement('PostgreSQL', 'SELECT 1; DROP TABLE x').statements === 2, 'multi-statement: the batch size is reported');
}
{
  // Splitting must respect the places a semicolon is just a character.
  check(splitStatements("SELECT ';' AS x").length === 1, 'split: a semicolon inside a string does not split');
  check(splitStatements('SELECT 1 -- ; DROP TABLE t').length === 1, 'split: a semicolon in a line comment does not split');
  check(splitStatements('SELECT 1 /* ; DROP */ FROM t').length === 1, 'split: a semicolon in a block comment does not split');
  check(splitStatements('SELECT "a;b" FROM t').length === 1, 'split: a semicolon in a quoted identifier does not split');
  check(splitStatements('SELECT `a;b` FROM t').length === 1, 'split: a semicolon in backticks does not split');
  check(splitStatements("CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql").length === 1,
    'split: a dollar-quoted body is one statement');
  check(splitStatements('SELECT 1;').length === 1, 'split: a trailing semicolon does not invent an empty statement');
  check(splitStatements('  ;;  ').length === 0, 'split: empty statements are dropped');
  check(splitStatements('SELECT 1; SELECT 2; SELECT 3').length === 3, 'split: three statements are three');
}
{
  // Two identical indexes shadow each other both ways. Reporting both would
  // read as "drop both" and leave the table with none.
  const twins = [
    { table: 't', name: 'idx_a', columns: [{ name: 'a' }] },
    { table: 't', name: 'idx_a_copy', columns: [{ name: 'a' }] }
  ];
  const dup = findRedundant(twins);
  check(dup.length === 1, 'redundant: an exact duplicate pair reports exactly one index');
  check(dup[0].duplicate === true, 'redundant: the pair is labelled a duplicate');
  check(findRedundant([...twins].reverse()).length === 1, 'redundant: the same pair in either order still reports one');
  check(findRedundant([...twins].reverse())[0].name === dup[0].name, 'redundant: which one survives does not depend on catalog order');

  const triplets = findRedundant([
    { table: 't', name: 'i3', columns: [{ name: 'a' }] },
    { table: 't', name: 'i1', columns: [{ name: 'a' }] },
    { table: 't', name: 'i2', columns: [{ name: 'a' }] }
  ]);
  check(triplets.length === 2, 'redundant: three identical indexes leave one survivor');

  // A duplicate that also enforces uniqueness is the one worth keeping.
  const mixed = findRedundant([
    { table: 't', name: 'idx_a', columns: [{ name: 'a' }] },
    { table: 't', name: 'uq_a', unique: true, columns: [{ name: 'a' }] }
  ]);
  check(mixed.length === 1 && mixed[0].name === 'idx_a', 'redundant: the unique twin survives, the plain one is dropped');
}
{
  // Saving a profile with verification on used to throw: the CA variable was
  // referenced after its declaration had been removed.
  const base = { name: 'x', dialect: 'MySQL', host: 'h' };
  check(validateConnection({ ...base, sslMode: 'verify-full' }).ok, 'config: a verify profile with no CA saves and uses system CAs');
  const bad = validateConnection({ ...base, sslMode: 'verify-ca', sslCa: '/tidak/ada/ca.pem' });
  check(!bad.ok && /tidak ditemukan/.test(bad.error), 'config: a missing CA path is rejected at save time');

  // An inline PEM never reaches the browser, so an empty field means "keep".
  const pem = '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----';
  const keptPem = validateConnection({ ...base, sslMode: 'verify-ca', sslCa: '' }, { existing: { id: '1', sslCa: pem } });
  check(keptPem.value.sslCa === pem, 'config: clearing the field keeps a stored inline PEM');
  // A path *is* sent to the browser, so clearing it has to remove it.
  const clearedPath = validateConnection({ ...base, sslMode: 'require', sslCa: '' }, { existing: { id: '1', sslCa: '/etc/ca.pem' } });
  check(clearedPath.value.sslCa === '', 'config: clearing the field removes a stored CA path');
}
{
  // Mongo reports 1/-1 for ordinary indexes and a string for text/geo ones,
  // which have no direction at all.
  const norm = normalizeIndexSpecs('orders', [
    { key: { _id: 1 }, name: '_id_' },
    { key: { status: 1, created_at: -1 }, name: 'status_1_created_at_-1' },
    { key: { email: 1 }, name: 'email_1', unique: true },
    { key: { deskripsi: 'text' }, name: 'deskripsi_text' }
  ]);
  check(norm[0].primary && norm[0].table === 'orders', 'mongo-index: _id_ is the primary index');
  check(norm[1].columns.map((c) => c.dir).join(',') === 'ASC,DESC', 'mongo-index: 1/-1 become ASC/DESC');
  check(norm[2].unique, 'mongo-index: a unique index is marked unique');
  check(norm[3].type === 'text' && norm[3].columns[0].dir === '', 'mongo-index: a text index has a type and no direction');
}

// ---------------------------------------------------------------------------
// TLS modes — what each one actually verifies
// ---------------------------------------------------------------------------
{
  check(tlsOptions({ sslMode: 'disable' }) === null, 'tls: disable means no TLS at all');

  const require_ = tlsOptions({ sslMode: 'require' });
  check(require_.rejectUnauthorized === false, 'tls: require encrypts without verifying');
  check(require_.ca === undefined, 'tls: require needs no CA');

  const ca = tlsOptions({ sslMode: 'verify-ca', host: 'db.internal' });
  check(ca.rejectUnauthorized === true, 'tls: verify-ca validates the chain');
  check(typeof ca.checkServerIdentity === 'function' && ca.checkServerIdentity() === undefined,
    'tls: verify-ca deliberately skips the hostname check');
  check(!ca.verifyIdentity, 'tls: verify-ca does not ask mysql2 to check the hostname');

  const full = tlsOptions({ sslMode: 'verify-full', host: 'db.internal' });
  check(full.rejectUnauthorized === true && full.servername === 'db.internal',
    'tls: verify-full pins the hostname it expects');
  check(full.checkServerIdentity === undefined, 'tls: verify-full leaves identity checking to Node');
  check(full.verifyIdentity === true, 'tls: verify-full turns on mysql2 hostname verification');
}
{
  // Profiles written before TLS modes existed only had ssl: true|false, which
  // meant "encrypt, verify nothing". They must keep working exactly as before.
  check(sslModeOf({ ssl: true }) === 'require', 'tls: legacy ssl:true maps to require');
  check(sslModeOf({ ssl: false }) === 'disable', 'tls: legacy ssl:false maps to disable');
  check(sslModeOf({}) === 'disable', 'tls: a profile with no TLS fields defaults to disable');
  check(sslModeOf({ ssl: true, sslMode: 'verify-full' }) === 'verify-full', 'tls: an explicit mode wins over the legacy flag');
  check(sslModeOf({ sslMode: 'nonsense' }) === 'disable', 'tls: an unknown mode never silently enables TLS');
}
{
  check(isInlinePem('-----BEGIN CERTIFICATE-----\nMIIB...'), 'tls: a pasted PEM is recognized');
  check(!isInlinePem('/etc/ssl/certs/rds-ca.pem'), 'tls: a path is not mistaken for a PEM');
  let threw = '';
  try {
    tlsOptions({ sslMode: 'verify-ca', sslCa: '/tidak/ada/ca.pem' });
  } catch (e) {
    threw = e.message;
  }
  check(/tidak ditemukan/.test(threw), 'tls: a missing CA file fails loudly instead of falling back to system CAs');
}

// ---------------------------------------------------------------------------
// Redis queue export & timestamp normalization (pure functions, no Redis needed)
// ---------------------------------------------------------------------------
{
  const csv = toCsv(['a', 'b'], [['plain', 'has,comma'], ['say "hi"', 'line\nbreak']]);
  check(csv.startsWith('\ufeff'), 'csv: starts with a UTF-8 BOM so Excel reads it correctly');
  check(csv.includes('"has,comma"'), 'csv: a value containing a comma is quoted');
  check(csv.includes('"say ""hi"""'), 'csv: inner double quotes are doubled');
  check(csv.includes('"line\nbreak"'), 'csv: an embedded newline stays inside one quoted field');
  check(csv.endsWith('\r\n'), 'csv: rows are CRLF-terminated per RFC 4180');

  // Job payloads are untrusted: a leading =/+/-/@ must not become a formula.
  const danger = toCsv(['x'], [['=cmd|\' /c calc\'!A1'], ['+1'], ['@SUM(A1)'], ['-2']]);
  const lines = danger.trim().split('\r\n').slice(1);
  check(lines.every((l) => l.startsWith("'") || l.startsWith('"\'')), 'csv: formula-looking cells are quote-prefixed');
}
{
  const jobs = [
    { id: 'j1', queue: 'default', state: 'failed', name: 'sync', description: 'sync()', error: 'boom', waitSec: 3, durationSec: 9 }
  ];
  const csv = jobsToCsv(jobs);
  const header = csv.split('\r\n')[0];
  check(header.includes('Job ID') && header.includes('Error'), 'jobsToCsv: header covers id through error');
  check(csv.split('\r\n')[1].startsWith('\ufeff') === false, 'jobsToCsv: BOM appears once, on the header only');
  check(csv.includes('j1,default,failed,sync'), 'jobsToCsv: job fields land in column order');
}
{
  const queues = [
    { system: 'rq', name: 'default', counts: { waiting: 2, failed: 1 }, backlog: 2, paused: false },
    { system: 'bullmq', name: 'jobs', counts: { waiting: 0, finished: 5 }, backlog: 0, paused: true }
  ];
  const header = queuesToCsv(queues).split('\r\n')[0];
  check(new Set(header.split(',')).size === header.split(',').length, 'queuesToCsv: no duplicated column labels');
  check(header.includes('Menunggu') && header.includes('Gagal') && header.includes('Selesai'),
    'queuesToCsv: only the states present in the data become columns');
  check(!header.includes('Retry'), 'queuesToCsv: states no system reported are left out');
  check(queuesToCsv(queues).includes('bullmq,jobs,ya'), 'queuesToCsv: a paused queue is marked');
}
{
  // Three timestamp shapes reach the adapters: ISO (rq), epoch ms (BullMQ),
  // epoch seconds (Sidekiq). All must land on the same instant.
  const ms = Date.UTC(2024, 0, 2, 3, 4, 5);
  check(parseTime('2024-01-02T03:04:05.000000Z') === ms, 'parseTime: rq microsecond ISO string');
  check(parseTime(String(ms)) === ms, 'parseTime: epoch milliseconds as a string');
  check(parseTime(ms / 1000) === ms, 'parseTime: epoch seconds are scaled up');
  check(parseTime('') === null && parseTime(null) === null && parseTime('nope') === null,
    'parseTime: empty and unparseable values are null, not NaN');
}
{
  check(truncate('x'.repeat(700), 600).length < 700 + 20, 'truncate: long payloads are cut down');
  check(truncate('x'.repeat(700), 600).includes('+100 char'), 'truncate: says how much was dropped');
  check(truncate({ a: 1 }) === '{"a":1}', 'truncate: objects are JSON-stringified');
  check(maybeJson('{"a":1}').a === 1, 'maybeJson: parses a JSON object');
  check(maybeJson('not json') === null, 'maybeJson: non-JSON text falls back to null');
}
{
  const { start, stop, size } = pageRange(100, 50);
  check(start === 100 && stop === 149 && size === 50, 'pageRange: offset+limit become an inclusive Redis range');
  check(pageRange(-5, 0).start === 0, 'pageRange: a negative offset clamps to 0');
  check(pageRange(0, 99999).size === 1000, 'pageRange: page size is capped');
}

// ---- table filter + SQL dump ------------------------------------------------
{
  // The filter builder is the only place a user composes something that becomes
  // SQL, so what it refuses matters as much as what it produces.
  const one = parseConditions({ column: 'user_id', value: 7 });
  check(one.length === 1 && one[0].op === '=' && one[0].values[0] === 7,
    'parseConditions: the old {column, value} filter becomes one equality condition');
  check(parseConditions(null).length === 0 && parseConditions('').length === 0,
    'parseConditions: no filter is an empty condition list, not an error');

  const list = parseConditions('[{"column":"status","op":"in","value":"paid, sent ,"}]');
  check(list[0].values.length === 2 && list[0].values[1] === 'sent',
    'parseConditions: an IN list is split on commas and trimmed, blanks dropped');

  const nul = parseConditions([{ column: 'deleted_at', op: 'isnull' }]);
  check(nul[0].values.length === 0, 'parseConditions: IS NULL takes no value');

  check(threw(() => parseConditions([{ column: 'id; DROP TABLE users', op: '=', value: 1 }])),
    'parseConditions: a column name that is not an identifier is rejected');
  check(threw(() => parseConditions([{ column: 'id', op: 'OR 1=1 --', value: 1 }])),
    'parseConditions: an operator outside the fixed table is rejected');
  check(threw(() => parseConditions([{ column: 'id', op: '=' }])),
    'parseConditions: a comparison with no value at all is rejected');
  check(threw(() => parseConditions('{not json')),
    'parseConditions: unparseable JSON is an expected error, not a crash');
  check(threw(() => parseConditions(new Array(MAX_CONDITIONS + 1).fill({ column: 'id', op: '=', value: 1 }))),
    'parseConditions: more conditions than the cap is rejected');
  check(parseConditions([{ column: 'note', op: '=', value: '' }])[0].values[0] === '',
    'parseConditions: an empty string is a real value and survives');
}
{
  const conds = parseConditions([
    { column: 'status', op: 'in', value: 'paid,sent' },
    { column: 'total', op: '>=', value: 100 },
    { column: 'deleted_at', op: 'isnull' }
  ]);

  const my = buildWhere(conds, (n) => '`' + n + '`');
  check(my.sql === ' WHERE `status` IN (?, ?) AND `total` >= ? AND `deleted_at` IS NULL',
    'buildWhere: MySQL clause joins conditions with AND and expands IN');
  check(my.params.length === 3 && my.params[2] === 100,
    'buildWhere: only value-taking operators contribute parameters');

  const pg = buildWhere(conds, (n) => '"' + n + '"', (i) => '$' + i);
  check(pg.sql === ' WHERE "status" IN ($1, $2) AND "total" >= $3 AND "deleted_at" IS NULL',
    'buildWhere: Postgres placeholders are numbered across the whole clause');
  check(buildWhere([], (n) => n).sql === '', 'buildWhere: no conditions means no WHERE at all');

  // Nothing a user types may reach the SQL text — values are parameters only.
  const inject = buildWhere(parseConditions([{ column: 'name', op: '=', value: "'; DROP TABLE users; --" }]), (n) => '`' + n + '`');
  check(!inject.sql.includes('DROP') && inject.params[0].includes('DROP'),
    'buildWhere: a value that looks like SQL stays a bound parameter');

  check(describeConditions(conds).includes('status IN ("paid", "sent")'),
    'describeConditions: reads back as the filter a person set');
  check(filterSlug(conds).startsWith('status-in-paid'),
    'filterSlug: the filename says which filter produced the file');
  check(filterSlug([]) === '', 'filterSlug: an unfiltered export gets no filter tag');
}
{
  // Literals are the one place QueryFlow writes a value into SQL instead of
  // binding it, so the escaping is the safety boundary.
  const my = (cell, columnType) => sqlLiteral(cell, { dialect: 'MySQL', columnType });
  const pg = (cell, columnType) => sqlLiteral(cell, { dialect: 'PostgreSQL', columnType });

  check(my({ v: "O'Brien", t: 'string' }) === "'O''Brien'", 'sqlLiteral: MySQL doubles a single quote');
  check(my({ v: 'a\\b', t: 'string' }) === "'a\\\\b'",
    'sqlLiteral: MySQL escapes a backslash, which it would otherwise treat as an escape');
  check(pg({ v: "O'Brien", t: 'string' }) === "'O''Brien'", 'sqlLiteral: Postgres doubles a single quote');
  check(pg({ v: 'a\\b', t: 'string' }) === "E'a\\\\b'",
    'sqlLiteral: Postgres writes a backslash as an E-string, correct either way standard_conforming_strings is set');

  check(my({ v: null, t: 'null' }) === 'NULL' && my({ v: undefined, t: 'string' }) === 'NULL',
    'sqlLiteral: an absent value is NULL, never an empty string');
  check(my({ v: '42', t: 'number' }) === '42' && my({ v: -1.5, t: 'number' }) === '-1.5',
    'sqlLiteral: numbers are written unquoted');
  check(my({ v: '12; DROP TABLE t', t: 'number' }) === "'12; DROP TABLE t'",
    'sqlLiteral: a "number" that is not numeric is quoted rather than pasted in raw');
  check(my({ v: true, t: 'boolean' }) === '1' && pg({ v: true, t: 'boolean' }) === 'TRUE',
    'sqlLiteral: booleans follow the engine');
  check(my({ v: '0xdeadbeef', t: 'binary' }) === '0xdeadbeef',
    'sqlLiteral: MySQL takes a hex literal for binary');
  check(pg({ v: '0xdeadbeef', t: 'binary' }) === "E'\\\\xdeadbeef'::bytea",
    'sqlLiteral: Postgres takes bytea hex format');

  let lost = '';
  sqlLiteral({ v: '<4096 bytes>', t: 'binary' }, { dialect: 'MySQL', onLoss: (w) => (lost = w) });
  check(lost.includes('biner'), 'sqlLiteral: a blob that did not arrive whole is reported, not written as its summary');

  let nanLost = '';
  check(sqlLiteral({ v: 'NaN', t: 'number' }, { dialect: 'MySQL', onLoss: (w) => (nanLost = w) }) === 'NULL' && nanLost !== '',
    'sqlLiteral: MySQL has no NaN literal, so it becomes NULL and says so');
  check(pg({ v: 'Infinity', t: 'number' }) === "'Infinity'",
    'sqlLiteral: Postgres does have a float literal for Infinity');
}
{
  // A DATE column read back as a local-midnight Date must not shift a day on
  // the way into the dump — that is the bug this formatting exists to avoid.
  const localMidnight = new Date(2024, 0, 2, 0, 0, 0).toISOString();
  check(timestampText(localMidnight, 'date') === '2024-01-02',
    'timestampText: a DATE keeps its calendar day regardless of the local zone');
  check(timestampText(new Date(2024, 0, 2, 3, 4, 5).toISOString(), 'datetime') === '2024-01-02 03:04:05',
    'timestampText: a DATETIME round-trips the components the driver produced');
  check(timestampText(new Date(2024, 0, 2, 3, 4, 5, 250).toISOString(), 'timestamp') === '2024-01-02 03:04:05.250',
    'timestampText: milliseconds survive when there are any');
  check(timestampText('2024-01-02T03:04:05.000Z', 'timestamp with time zone', true) === '2024-01-02T03:04:05.000Z',
    'timestampText: Postgres timestamptz keeps the instant, zone and all');
  check(timestampText('bukan tanggal', 'datetime') === 'bukan tanggal',
    'timestampText: text that is not a date is passed through untouched');
}
{
  const rows = [
    [{ v: 1, t: 'number' }, { v: "O'Brien", t: 'string' }, { v: null, t: 'null' }],
    [{ v: 2, t: 'number' }, { v: 'x', t: 'string' }, { v: new Date(2024, 0, 2, 8, 30, 0).toISOString(), t: 'date' }]
  ];
  const stmt = insertStatement('MySQL', 'orders', ['id', 'name', 'at'], rows, { columnTypes: { at: 'datetime' } });
  check(stmt.startsWith('INSERT INTO `orders` (`id`, `name`, `at`) VALUES\n'),
    'insertStatement: identifiers are quoted for the engine');
  check(stmt.includes("(1, 'O''Brien', NULL)") && stmt.includes("(2, 'x', '2024-01-02 08:30:00')"),
    'insertStatement: one tuple per row, each value as its own literal');
  check(stmt.trimEnd().endsWith(';'), 'insertStatement: the statement is terminated');

  const pgStmt = insertStatement('PostgreSQL', 'orders', ['id'], [[{ v: 1, t: 'number' }]], {});
  check(pgStmt.startsWith('INSERT INTO "orders" ("id")'), 'insertStatement: Postgres quoting');
}
{
  const info = {
    columns: [
      { name: 'id', type: 'integer', nullable: false, default: "nextval('orders_id_seq'::regclass)", isPk: true, isGenerated: true },
      { name: 'name', type: 'text', nullable: true, default: null },
      { name: 'total', type: 'numeric(10,2)', nullable: false, default: '0' }
    ],
    primaryKey: ['id']
  };
  const { sql, synthesized } = createTableSQL('PostgreSQL', 'orders', info);
  check(synthesized === true, 'createTableSQL: a rebuilt definition is marked as rebuilt, so the dump can say so');
  check(sql.includes('"id" integer GENERATED BY DEFAULT AS IDENTITY'),
    'createTableSQL: a serial default becomes an identity column, not a nextval on a sequence that will not exist');
  check(sql.includes('"total" numeric(10,2) DEFAULT 0 NOT NULL'), 'createTableSQL: type, default and nullability are kept');
  check(sql.includes('PRIMARY KEY ("id")'), 'createTableSQL: the primary key is restated as a constraint');
  check(createTableSQL('MySQL', 'orders', info).sql.includes('`id`'), 'createTableSQL: MySQL quoting');
  check(threw(() => createTableSQL('MySQL', 'orders', { columns: [], primaryKey: [] })),
    'createTableSQL: no readable columns is an explained error, not an empty CREATE TABLE');
  check(!createTableSQL('MySQL', 'orders', { columns: [{ name: 'id', type: 'int', nullable: false }], primaryKey: ['gone'] }).sql.includes('PRIMARY KEY'),
    'createTableSQL: a primary key column missing from the column list is left out rather than named in a broken constraint');
}
{
  const conn = { name: 'lokal', dialect: 'MySQL', host: '127.0.0.1', port: 3306, database: 'shop' };
  const conds = parseConditions([{ column: 'status', op: '=', value: 'paid' }]);
  const head = dumpHeader({ conn, table: 'orders', conditions: conds, orderBy: 'id', dir: 'asc', includeSchema: true, synthesized: true, limit: 200000 });
  check(head.includes('status = "paid"'), 'dumpHeader: the file states the filter that produced it');
  check(head.includes('index sekunder') || head.includes('Index sekunder'),
    'dumpHeader: a rebuilt CREATE TABLE warns about what it does not contain');
  check(dumpHeader({ conn, table: 'orders', conditions: [], orderBy: null, dir: 'asc', includeSchema: false, synthesized: false, limit: 500 })
    .includes('tanpa filter'), 'dumpHeader: an unfiltered dump says so instead of leaving the line blank');
  check(!dumpHeader({ conn, table: 'orders', conditions: [], orderBy: null, dir: 'asc', includeSchema: true, synthesized: false, limit: 500 })
    .includes('CATATAN'), 'dumpHeader: an engine-authored schema carries no reconstruction warning');
}
{
  check(threw(() => assertDumpable('MongoDB')) && threw(() => assertDumpable('Redis')),
    'assertDumpable: a SQL dump is refused where there is no SQL to dump');
  check(assertDumpable('MariaDB') === 'MariaDB' && assertDumpable('PostgreSQL') === 'PostgreSQL',
    'assertDumpable: the SQL engines are allowed');
}
{
  // Blobs: the grid summarises anything over 32 bytes, a dump must not.
  const big = Buffer.alloc(64, 0xab);
  check(encodeCell(big).v === '<64 bytes>', 'encodeCell: the grid still gets a readable summary');
  check(encodeCell(big, { fullBinary: true }).v === '0x' + big.toString('hex'),
    'encodeCell: a dump gets the whole blob as hex');
  check(toGrid([{ b: big }], ['b'], { fullBinary: true }).rows[0][0].v.length > 100,
    'toGrid: the option reaches every cell');
}

// ── Query timer & export filename ─────────────────────────────────────────────
import { formatElapsed } from '../src/lib/duration.js';
import { defaultExportName, sanitizeExportName } from '../src/lib/export-name.js';
{
  check(formatElapsed(0) === '0 ms', 'formatElapsed: zero');
  check(formatElapsed(842) === '842 ms', 'formatElapsed: under a second stays in ms');
  check(formatElapsed(1234) === '1,2 dtk', 'formatElapsed: seconds with one decimal');
  check(formatElapsed(59_940) === '59,9 dtk', 'formatElapsed: just under a minute');
  check(formatElapsed(65_000) === '1m 05d', 'formatElapsed: minutes and padded seconds');
  check(formatElapsed(3_725_000) === '1j 02m 05d', 'formatElapsed: hours');
  check(formatElapsed(-5) === '0 ms' && formatElapsed(NaN) === '0 ms', 'formatElapsed: junk clamps to zero');

  const at = new Date(2026, 8, 26, 9, 5, 7);
  check(defaultExportName(['Prod DB', 'query'], at) === 'Prod_DB-query-2026-09-26-09-05-07',
    'defaultExportName: slug + local timestamp');
  check(defaultExportName([], at) === 'queryflow-2026-09-26-09-05-07', 'defaultExportName: fallback prefix');

  check(sanitizeExportName('laporan bulanan', 'csv') === 'laporan bulanan.csv', 'sanitizeExportName: adds extension');
  check(sanitizeExportName('laporan.CSV', 'csv') === 'laporan.csv', 'sanitizeExportName: no double extension');
  check(sanitizeExportName('../../etc/passwd', 'csv') === 'etc_passwd.csv', 'sanitizeExportName: no path traversal');
  check(sanitizeExportName('a<b>:c"d|e?f*g', 'csv') === 'a_b_c_d_e_f_g.csv', 'sanitizeExportName: reserved characters replaced');
  check(sanitizeExportName('   ', 'csv') === null && sanitizeExportName('...', 'csv') === null,
    'sanitizeExportName: empty input is rejected');
  check(sanitizeExportName('x'.repeat(300), 'csv').length === 124, 'sanitizeExportName: length capped');
  check(sanitizeExportName('penjualan\u0000\n', 'csv') === 'penjualan.csv', 'sanitizeExportName: control characters stripped');
}

// ── Query cancel & timeout ───────────────────────────────────────────────────
import { createRunControl, cancelRun, activeRunCount, DEFAULT_QUERY_TIMEOUT_SEC, timeoutMsFor } from '../src/lib/server/run-control.js';
import { publicView } from '../src/lib/server/config.js';
{
  const base = { name: 'x', dialect: 'MySQL', host: 'h' };
  check(validateConnection(base).value.queryTimeoutSec === DEFAULT_QUERY_TIMEOUT_SEC, 'timeout: default applied to a new profile');
  check(validateConnection({ ...base, queryTimeoutSec: 0 }).value.queryTimeoutSec === 0, 'timeout: 0 means no limit');
  check(validateConnection({ ...base, queryTimeoutSec: '120' }).value.queryTimeoutSec === 120, 'timeout: numeric string accepted');
  check(!validateConnection({ ...base, queryTimeoutSec: -1 }).ok, 'timeout: negative refused');
  check(!validateConnection({ ...base, queryTimeoutSec: 3601 }).ok, 'timeout: above one hour refused');
  check(!validateConnection({ ...base, queryTimeoutSec: 'abc' }).ok, 'timeout: junk refused');
  check(!validateConnection({ ...base, queryTimeoutSec: 1.5 }).ok, 'timeout: fractions refused');
  check(validateConnection(base, { existing: { id: 'e', queryTimeoutSec: 90 } }).value.queryTimeoutSec === 90,
    'timeout: omitted on edit keeps the stored value');
  check(publicView({ id: 'a', dialect: 'MySQL', queryTimeoutSec: 45 }).queryTimeoutSec === 45, 'timeout: exposed to the browser');
  check(publicView({ id: 'a', dialect: 'MySQL' }).queryTimeoutSec === DEFAULT_QUERY_TIMEOUT_SEC, 'timeout: old profiles read as the default');
  check(timeoutMsFor({ queryTimeoutSec: 0 }) === 0 && timeoutMsFor({}) === DEFAULT_QUERY_TIMEOUT_SEC * 1000,
    'timeout: seconds to ms, 0 stays unlimited');
}

{
  // A handler registered after cancel() must still fire — the driver may not
  // know its backend id yet when the user clicks.
  const calls = [];
  const c = createRunControl({ runId: 'r-late', timeoutMs: 0 });
  check(activeRunCount() === 1, 'run-control: registered while running');
  const res = await cancelRun('r-late');
  check(res.ok && c.reason === 'user', 'run-control: cancel by id marks the reason');
  c.onCancel(async () => { calls.push('kill'); });
  await c.settled();
  check(calls.length === 1, 'run-control: late handler fires immediately');
  await cancelRun('r-late');
  check(calls.length === 1, 'run-control: handler never fires twice');
  c.done();
  check(activeRunCount() === 0, 'run-control: done() unregisters');
  check(!(await cancelRun('r-late')).ok, 'run-control: a finished run cannot be cancelled');
  check(!(await cancelRun('nope')).ok, 'run-control: unknown id is refused');
}

{
  const c = createRunControl({ runId: 'r-timeout', timeoutMs: 20 });
  let killed = false;
  c.onCancel(async () => { killed = true; });
  await new Promise((r) => setTimeout(r, 60));
  check(killed && c.reason === 'timeout', 'run-control: timer cancels with reason timeout');
  const e = c.translate(Object.assign(new Error('Query execution was interrupted'), { errno: 1317 }));
  check(e.expected && e.code === 'QUERY_TIMEOUT' && /batas waktu/.test(e.message), 'run-control: timeout error explained');
  c.done();
}

{
  const c = createRunControl({ runId: 'r-user', timeoutMs: 0 });
  c.onCancel(async () => {});
  await c.cancel('user');
  const e = c.translate(new Error('canceling statement due to user request'));
  check(e.expected && e.code === 'QUERY_CANCELLED' && /dibatalkan/.test(e.message), 'run-control: user cancel explained');
  c.done();

  const plain = createRunControl({ runId: null, timeoutMs: 0 });
  const other = createRunControl({ runId: null, timeoutMs: 0 });
  check(/^queryflow:.{8,}/.test(plain.tag) && plain.tag !== other.tag,
    'run-control: runs without an id still get a unique tag (a Mongo kill must never match other operations)');
  other.done();
  const orig = new Error('syntax');
  check(plain.translate(orig) === orig, 'run-control: unrelated errors pass through');
  check(activeRunCount() === 0, 'run-control: a run without id is never registered');
  plain.done();

  const failing = createRunControl({ runId: 'r-fail', timeoutMs: 0 });
  failing.onCancel(async () => { throw new Error('no privilege'); });
  const r = await cancelRun('r-fail');
  check(!r.ok && /no privilege/.test(r.error), 'run-control: a failed kill is reported, not swallowed');
  failing.done();
}

import { isRunId, newRunId } from '../src/lib/run-id.js';
{
  check(isRunId(newRunId()), 'run-id: generated ids are accepted');
  check(!isRunId('') && !isRunId('short') && !isRunId(42) && !isRunId(null), 'run-id: empty, short and non-strings refused');
  check(!isRunId('abc$where:1-xxxxxxx') && !isRunId('a'.repeat(65)), 'run-id: odd characters and long ids refused');
}

// ── Grid CSV uses the same rules as the server ───────────────────────────────
import { cellsToCsv } from '../src/lib/csv.js';
{
  const out = cellsToCsv(['a', 'b'], [[{ v: '=1+1' }, { v: null }], [{ v: 'x,y' }, { v: 5 }]]);
  check(out.startsWith(BOM), 'grid-csv: BOM so Excel reads UTF-8');
  check(out.includes("'=1+1"), 'grid-csv: formulas neutralised');
  check(out === BOM + 'a,b\r\n' + "'=1+1," + '\r\n"x,y",5\r\n', 'grid-csv: RFC 4180 records, null as empty');
}

// ── Batches: dialect-aware splitting, run selection ─────────────────────────
import { splitBatch, splitMongo } from '../src/lib/statement.js';
import { runTarget } from '../src/lib/run-target.js';
{
  // Default (no dialect) keeps the old, most conservative behaviour.
  check(splitStatements("CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql").length === 1,
    'split: default still honours dollar quotes');

  // PostgreSQL: `#` is an operator, a backslash is a plain character outside E''.
  check(splitBatch('PostgreSQL', "SELECT data #> '{a}' FROM t; SELECT 2").length === 2, 'split-pg: # is an operator, not a comment');
  check(splitBatch('PostgreSQL', "SELECT 'C:\\'; SELECT 2").length === 2, 'split-pg: backslash does not escape in a standard string');
  check(splitBatch('PostgreSQL', "SELECT E'it\\'s;'; SELECT 2").length === 2, 'split-pg: backslash escapes inside E strings');
  check(splitBatch('PostgreSQL', "DO $b$ BEGIN PERFORM 1; END $b$; SELECT 1").length === 2, 'split-pg: tagged dollar body kept whole');

  // MySQL / MariaDB: DELIMITER for procedure bodies, no dollar quoting.
  const proc = 'DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END //\nDELIMITER ;\nCALL p();\nSELECT 3';
  const parts = splitBatch('MySQL', proc);
  check(parts.length === 3, 'split-my: DELIMITER keeps a procedure body whole');
  check(parts[0].startsWith('CREATE PROCEDURE') && parts[0].endsWith('END'), 'split-my: directive and delimiter are not sent to the server');
  check(parts[1] === 'CALL p()' && parts[2] === 'SELECT 3', 'split-my: delimiter restored to ;');
  check(splitBatch('MariaDB', "SELECT '$$'; SELECT 2").length === 2, 'split-my: $$ is not a quote in MySQL');
  check(splitBatch('MariaDB', "SELECT 'a\\';b'; SELECT 2").length === 2, 'split-my: backslash escapes a quote');
  check(splitBatch('MySQL', 'SELECT 1 # c; still comment\n; SELECT 2').length === 2, 'split-my: # comment hides a semicolon');

  // Comment-only chunks are not statements — and must not read as a write.
  check(splitBatch('MySQL', 'SELECT 1; -- selesai').length === 1, 'split: a trailing comment is not a statement');
  check(splitBatch('PostgreSQL', '/* a */ ; SELECT 1 ; -- b').length === 1, 'split: comment-only chunks dropped');
  check(!classifyStatement('MySQL', 'SELECT 1; -- selesai').write, 'classify: a trailing comment no longer looks like a write');
  check(splitBatch('MySQL', '  \n SELECT 1 ;\n\n SELECT 2 \n')[1] === 'SELECT 2', 'split: statements are trimmed');

  // A batch is classified per statement, for every engine.
  check(classifyStatement('PostgreSQL', "SELECT data #> '{a}' FROM t; DELETE FROM t").write,
    'classify-pg: a write after a # operator is still seen');
  check(readOnlyViolation('MySQL', 'DELIMITER //\nSELECT 1 //\nDELETE FROM t WHERE id = 1 //') !== '',
    'classify-my: a write behind a custom delimiter is still seen');
}

{
  check(splitMongo('db.a.find({x: 1}); db.b.find()').length === 2, 'split-mongo: semicolon separates');
  check(splitMongo('db.a.find({x: 1})\ndb.b.countDocuments({})').length === 2, 'split-mongo: a new line starting with db. separates');
  check(splitMongo('db.a.find({\n  x: 1\n})\n  .sort({ x: -1 })').length === 1, 'split-mongo: chained modifiers stay with their command');
  check(splitMongo('db.a.find({ s: "a;b\\"c" })').length === 1, 'split-mongo: semicolon inside a string');
  check(splitMongo('db.a.aggregate([\n  { $match: { t: "x" } },\ndb_like: 1 ])').length === 1, 'split-mongo: nested brackets are one command');
  check(splitMongo('// komentar\ndb.a.find() // lagi\n').length === 1, 'split-mongo: comments are not commands');
  check(splitBatch('MongoDB', 'db.a.find(); db.a.deleteMany({})').length === 2, 'split-mongo: via splitBatch');
  const mc = classifyStatement('MongoDB', 'db.a.find()\ndb.a.deleteMany({})');
  check(mc.write && mc.unfiltered && mc.statements === 2, 'classify-mongo: every command in a batch is judged');
  check(readOnlyViolation('MongoDB', 'db.a.find(); db.b.drop()') !== '', 'classify-mongo: a drop behind a find is refused on read-only');
}

{
  check(runTarget('SELECT 1;\nSELECT 2', 0, 0).text === 'SELECT 1;\nSELECT 2', 'run-target: no selection runs the editor');
  const sel = runTarget('SELECT 1;\nSELECT 2', 10, 18);
  check(sel.selection && sel.text === 'SELECT 2', 'run-target: a selection runs only itself');
  check(runTarget('SELECT 1', 2, 4).text === 'LE', 'run-target: partial selection is taken literally');
  check(!runTarget('SELECT 1\n   \n', 8, 12).selection, 'run-target: a whitespace-only selection falls back to the whole editor');
  check(runTarget('abc', 2, 1).text === 'b', 'run-target: backwards selection is normalised');
}

{
  // One timer per statement in a batch.
  const c = createRunControl({ runId: 'r-batch-timer', timeoutMs: 40 });
  let kills = 0;
  c.onCancel(async () => { kills++; });
  await new Promise((r) => setTimeout(r, 25));
  c.startStatement();
  await new Promise((r) => setTimeout(r, 25));
  check(kills === 0 && c.reason === null, 'run-control: startStatement restarts the limit');
  await new Promise((r) => setTimeout(r, 30));
  check(kills === 1 && c.reason === 'timeout', 'run-control: the restarted limit still fires');
  c.done();
}

// ── Paging: next / previous page from the query's own LIMIT ─────────────────
import { readPaging, withOffset } from '../src/lib/paging.js';
{
  const user = `SELECT b.name FROM \`tabItem Location\` b
JOIN \`tabItem Location Ledger Entry\` sle ON sle.name = (
  SELECT s.name FROM \`tabItem Location Ledger Entry\` s ORDER BY s.creation DESC LIMIT 1
)
ORDER BY ABS(b.qty) DESC, sle.creation DESC limit 10000 offset 4`;
  const p = readPaging('MariaDB', user);
  check(p && p.limit === 10000 && p.offset === 4, 'paging: the outer LIMIT is read, not the one in the subquery');
  const next = withOffset('MariaDB', user, 10004);
  check(next.endsWith('limit 10000 offset 10004') && next.includes('LIMIT 1\n)'), 'paging: only the outer clause changes, in the same case');

  check(JSON.stringify(readPaging('MySQL', 'SELECT * FROM t LIMIT 50')) === '{"limit":50,"offset":0}', 'paging: LIMIT without OFFSET starts at 0');
  check(withOffset('MySQL', 'SELECT * FROM t LIMIT 50', 50) === 'SELECT * FROM t LIMIT 50 OFFSET 50', 'paging: OFFSET is added when missing');
  check(withOffset('MySQL', 'SELECT * FROM t LIMIT 50;', 100) === 'SELECT * FROM t LIMIT 50 OFFSET 100;', 'paging: trailing semicolon kept');
  check(withOffset('MySQL', 'SELECT * FROM t LIMIT 50 -- catatan', 50) === 'SELECT * FROM t LIMIT 50 OFFSET 50 -- catatan', 'paging: trailing comment kept');

  const comma = readPaging('MariaDB', 'SELECT * FROM t LIMIT 20, 10');
  check(comma && comma.limit === 10 && comma.offset === 20, 'paging: MySQL LIMIT offset, count');
  check(withOffset('MariaDB', 'SELECT * FROM t LIMIT 20, 10', 30) === 'SELECT * FROM t LIMIT 30, 10', 'paging: comma form kept');
  check(readPaging('PostgreSQL', 'SELECT * FROM t LIMIT 20, 10') === null, 'paging: comma form is MySQL-only');

  const pg = readPaging('PostgreSQL', 'SELECT * FROM t OFFSET 40 LIMIT 20');
  check(pg && pg.limit === 20 && pg.offset === 40, 'paging-pg: OFFSET before LIMIT');
  check(withOffset('PostgreSQL', 'SELECT * FROM t OFFSET 40 LIMIT 20', 60) === 'SELECT * FROM t OFFSET 60 LIMIT 20', 'paging-pg: order kept');

  check(readPaging('MySQL', 'SELECT * FROM t') === null, 'paging: no LIMIT, no pager');
  check(readPaging('MySQL', 'SELECT * FROM (SELECT * FROM t LIMIT 5) x') === null, 'paging: LIMIT only inside a subquery is not paging');
  check(readPaging('MySQL', "SELECT 'LIMIT 5' AS x") === null, 'paging: LIMIT inside a string is text');
  check(readPaging('MySQL', 'SELECT * FROM t LIMIT 5 -- LIMIT 9') .limit === 5, 'paging: LIMIT in a comment ignored');
  check(readPaging('MySQL', 'SELECT * FROM t LIMIT ?') === null, 'paging: placeholders are not numbers');
  check(readPaging('MySQL', 'SELECT * FROM t LIMIT 0') === null, 'paging: LIMIT 0 cannot page');
  check(readPaging('MySQL', 'SELECT * FROM t LIMIT 10 FOR UPDATE') === null, 'paging: a locking read is not paged');
  check(readPaging('MySQL', 'DELETE FROM t ORDER BY id LIMIT 10') === null, 'paging: writes are never paged');
  check(readPaging('MySQL', 'SELECT 1; SELECT * FROM t LIMIT 5') === null, 'paging: a script is paged per statement, not whole');

  const m = readPaging('MongoDB', 'db.orders.find({ s: "a" }).sort({ t: -1 }).limit(20)');
  check(m && m.limit === 20 && m.offset === 0, 'paging-mongo: limit read');
  check(withOffset('MongoDB', 'db.orders.find({}).limit(20)', 20) === 'db.orders.find({}).limit(20).skip(20)', 'paging-mongo: skip added');
  check(withOffset('MongoDB', 'db.orders.find({}).skip(20).limit(20)', 40) === 'db.orders.find({}).skip(40).limit(20)', 'paging-mongo: skip replaced');
  check(readPaging('MongoDB', 'db.orders.find({ n: { $in: [1] } }).limit(5)').limit === 5, 'paging-mongo: nested brackets');
  check(readPaging('MongoDB', 'db.orders.aggregate([{ $limit: 5 }])') === null, 'paging-mongo: aggregate is not paged');
  check(readPaging('MongoDB', 'db.orders.find({ s: ".limit(9)" })') === null, 'paging-mongo: text inside a string ignored');
}

console.log(`\nQueryFlow golden tests: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('✓ all assertions passed');
}
