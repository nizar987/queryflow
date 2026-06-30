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

console.log(`\nQueryFlow golden tests: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('✓ all assertions passed');
}
