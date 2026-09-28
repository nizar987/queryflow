// Optimization advisor — the "what should I actually change?" view.
//
// The Analisa tab answers "what is wrong with this query?". This answers
// "what would make it faster?", which is a different question: it groups the
// performance-relevant findings by impact and, more usefully, works out which
// indexes the query is asking for.
//
// Hard limit worth stating plainly: this reads query text only. It does not
// know which indexes already exist, how big any table is, or how selective a
// predicate is. Every suggestion is "check this", never "this is the problem".
import { collectColumnRefs, columnName, exprToSQL, walk, funcName } from '../parser/ast-utils.js';
import { aliasMapForBlock, resolveTableForColumnRef, sanitizeIdent } from './table-resolve.js';

const IMPACT_ORDER = { high: 0, medium: 1, low: 2 };

/** Rules whose findings are about speed rather than correctness or style. */
const PERF_RULES = {
  'index-busting': 'high',
  'leading-wildcard': 'high',
  'subquery-in-select': 'high',
  'cartesian-join': 'high',
  'correlated-subquery': 'medium',
  'select-star': 'medium',
  'orderby-no-limit': 'low',
  'mongo-no-match': 'high',
  'mongo-match-late': 'high',
  'mongo-where': 'high',
  'mongo-regex': 'high',
  'mongo-unwind-blowup': 'medium',
  'mongo-lookup-unwind-group': 'medium',
  'mongo-sort-no-limit': 'low',
  'mongo-deep-skip': 'medium',
  'mongo-project-before-match': 'low'
};

/**
 * @returns {{ verdict, score, suggestions, indexes, checks, disclaimer }}
 */
export function optimize(result, opts = {}) {
  const engine = opts.engine === 'mongo' ? 'mongo' : 'sql';
  const flow = result.flow;
  const findings = result.analysis.findings || [];

  const suggestions = findingSuggestions(findings);
  const indexes = engine === 'mongo' ? mongoIndexes(flow) : sqlIndexes(flow);
  const checks = engine === 'mongo' ? mongoChecks(flow) : sqlChecks(flow);

  // Score is a readable summary of the suggestion list, not a benchmark.
  let score = 100;
  for (const s of suggestions) score -= { high: 25, medium: 12, low: 5 }[s.impact] || 0;
  score = Math.max(0, score);

  const verdict =
    suggestions.some((s) => s.impact === 'high')
      ? 'perlu-perhatian'
      : suggestions.length
        ? 'bisa-dioptimalkan'
        : 'rapi';

  return {
    verdict,
    score,
    suggestions: suggestions.sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]),
    indexes,
    checks
  };
}

function findingSuggestions(findings) {
  const out = [];
  for (const f of findings) {
    const impact = PERF_RULES[f.ruleId];
    if (!impact) continue; // correctness/style findings belong in the Analisa tab
    out.push({
      id: 'f-' + f.id,
      impact,
      title: f.title,
      why: f.why,
      before: f.before,
      after: f.after,
      nodeId: f.nodeId,
      findingId: f.id
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Index candidates
// ---------------------------------------------------------------------------

/**
 * Columns a query filters, joins, or sorts on are the columns an index would
 * serve. Equality predicates come first in a composite index, then ranges,
 * then the sort — that ordering is what makes an index usable end-to-end.
 */
function sqlIndexes(flow) {
  /** table -> { eq:Set, range:Set, join:Set, sort:[] } */
  const byTable = new Map();
  const need = (t) => {
    if (!byTable.has(t)) byTable.set(t, { eq: new Set(), range: new Set(), join: new Set(), sort: [] });
    return byTable.get(t);
  };

  for (const block of flow.blocks) {
    const alias = aliasMapForBlock(block);

    for (const node of block.nodes) {
      if (node.stage === 'WHERE' && node.whereExpr) {
        collectPredicates(node.whereExpr, (col, kind) => {
          const t = resolveTableForColumnRef(col, alias);
          if (!t) return;
          need(t)[kind].add(columnName(col));
        });
      }

      if (node.stage === 'JOIN' && node.onExpr) {
        // Both sides of a join condition benefit from an index.
        for (const col of collectColumnRefs(node.onExpr)) {
          const t = resolveTableForColumnRef(col, alias);
          if (t) need(t).join.add(columnName(col));
        }
      }

      if (node.stage === 'ORDER BY' && Array.isArray(node.orderby)) {
        for (const o of node.orderby) {
          if (!o.expr || o.expr.type !== 'column_ref') continue;
          const t = resolveTableForColumnRef(o.expr, alias);
          if (!t) continue;
          need(t).sort.push({ column: columnName(o.expr), dir: (o.type || 'ASC').toUpperCase() });
        }
      }
    }
  }

  const out = [];
  for (const [table, parts] of byTable) {
    const cols = [
      ...[...parts.eq].map((c) => ({ column: c, role: 'equality' })),
      ...[...parts.join].filter((c) => !parts.eq.has(c)).map((c) => ({ column: c, role: 'join' })),
      ...[...parts.range].filter((c) => !parts.eq.has(c)).map((c) => ({ column: c, role: 'range' })),
      ...parts.sort
        .filter((s) => !parts.eq.has(s.column) && !parts.range.has(s.column))
        .map((s) => ({ column: s.column, role: 'sort', dir: s.dir }))
    ];
    if (!cols.length) continue;

    // A single index can only serve so much before it stops being selective.
    const picked = cols.slice(0, 4);
    out.push({
      table,
      columns: picked,
      sql: `CREATE INDEX idx_${sanitizeIdent(table)}_${picked.map((c) => sanitizeIdent(c.column)).join('_')}\n  ON ${table} (${picked.map((c) => c.column).join(', ')});`,
      reason: describeIndex(picked)
    });
  }
  return out;
}

function describeIndex(cols) {
  const by = (role) => cols.filter((c) => c.role === role).map((c) => c.column);
  const bits = [];
  if (by('equality').length) bits.push(`disaring dengan = pada ${by('equality').join(', ')}`);
  if (by('join').length) bits.push(`dipakai sebagai kunci join: ${by('join').join(', ')}`);
  if (by('range').length) bits.push(`dibandingkan rentang pada ${by('range').join(', ')}`);
  if (by('sort').length) bits.push(`diurutkan berdasarkan ${by('sort').join(', ')}`);
  return bits.join('; ');
}

/** Split a WHERE tree into equality vs range usage per column. */
function collectPredicates(expr, visit) {
  walk(expr, (n) => {
    if (n.type !== 'binary_expr') return;
    const op = String(n.operator || '').toUpperCase();
    if (op === 'AND' || op === 'OR') return;

    // A column wrapped in a function cannot use a plain index; the
    // index-busting rule already reports that, so don't suggest one here.
    const left = n.left;
    if (!left || left.type !== 'column_ref') return;

    if (op === '=' || op === 'IS' || op === 'IN') visit(left, 'eq');
    else if (['>', '<', '>=', '<=', 'BETWEEN', 'NOT BETWEEN'].includes(op)) visit(left, 'range');
    else if (op === 'LIKE') {
      const val = n.right && n.right.value;
      // Only an anchored LIKE can use a B-tree index.
      if (typeof val === 'string' && !val.startsWith('%')) visit(left, 'range');
    }
  });
}

/** alias/table -> real table name, so `v.creation` maps back to `tabVersion`. */
/** MongoDB: $match fields lead, then $sort, mirroring the ESR rule of thumb. */
function mongoIndexes(flow) {
  const main = flow.blocks.find((b) => b.kind === 'main');
  if (!main) return [];
  const coll = (flow.blocks[0].nodes[0] || {}).subtitle || flow.collection || 'koleksi';

  const eq = [];
  const range = [];
  const sort = [];
  const lookups = [];

  for (const n of main.nodes) {
    if (n.stage === '$match' && n.spec && typeof n.spec === 'object') {
      for (const [k, v] of Object.entries(n.spec)) {
        if (k.startsWith('$')) continue;
        const isRange = v && typeof v === 'object' && Object.keys(v).some((o) => /^\$(gt|gte|lt|lte)$/.test(o));
        (isRange ? range : eq).push(k);
      }
    }
    if (n.stage === '$sort' && n.spec && typeof n.spec === 'object') {
      for (const [k, v] of Object.entries(n.spec)) sort.push({ column: k, dir: v === -1 ? 'DESC' : 'ASC' });
    }
    if (n.stage === '$lookup' && n.spec && n.spec.from && n.spec.foreignField) {
      lookups.push({ from: String(n.spec.from), field: String(n.spec.foreignField) });
    }
  }

  const out = [];
  const cols = [
    ...eq.map((c) => ({ column: c, role: 'equality' })),
    ...sort.filter((s) => !eq.includes(s.column)).map((s) => ({ column: s.column, role: 'sort', dir: s.dir })),
    ...range.filter((c) => !eq.includes(c)).map((c) => ({ column: c, role: 'range' }))
  ];
  if (cols.length) {
    out.push({
      table: coll,
      columns: cols.slice(0, 4),
      sql: `db.${coll}.createIndex({ ${cols.slice(0, 4).map((c) => `${c.column}: ${c.dir === 'DESC' ? -1 : 1}`).join(', ')} })`,
      reason: describeIndex(cols.slice(0, 4)) + ' — urutan Equality → Sort → Range (ESR)'
    });
  }
  for (const l of lookups) {
    out.push({
      table: l.from,
      columns: [{ column: l.field, role: 'join' }],
      sql: `db.${l.from}.createIndex({ ${l.field}: 1 })`,
      reason: `dipakai sebagai foreignField pada $lookup ke ${l.from}`
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checklist — what was inspected, so a clean query still says something
// ---------------------------------------------------------------------------

function sqlChecks(flow) {
  const nodes = flow.blocks.flatMap((b) => b.nodes);
  const has = (stage) => nodes.some((n) => n.stage === stage);
  const findings = new Set();
  for (const n of nodes) {
    const expr = n.whereExpr || n.onExpr;
    if (!expr) continue;
    for (const fn of walkFunctions(expr)) findings.add(fn);
  }

  return [
    {
      label: 'Ada filter WHERE',
      ok: has('WHERE'),
      hint: 'Tanpa WHERE, engine membaca seluruh tabel.'
    },
    {
      label: 'Kolom filter tidak dibungkus fungsi',
      ok: findings.size === 0,
      hint: findings.size ? `Fungsi pada kolom filter: ${[...findings].join(', ')} — index tidak terpakai.` : ''
    },
    {
      label: 'Semua JOIN punya kondisi ON',
      ok: !nodes.some((n) => n.stage === 'JOIN' && n.hasOn === false)
    },
    {
      label: 'Hasil dibatasi LIMIT',
      ok: has('LIMIT'),
      hint: 'Tanpa LIMIT, seluruh hasil dikirim dan diurutkan.'
    },
    {
      label: 'Kolom disebutkan eksplisit (bukan SELECT *)',
      ok: !nodes.some((n) => n.stage === 'SELECT' && /(^|\s)\*/.test(n.subtitle || ''))
    }
  ];
}

function walkFunctions(expr) {
  const names = [];
  walk(expr, (n) => {
    if (n.type === 'function' || n.type === 'aggr_func') {
      // Only functions that actually wrap a column hurt index usage.
      if (collectColumnRefs(n).length) {
        const name = funcName(n);
        if (name) names.push(name + '()');
      }
    }
  });
  return names;
}

function mongoChecks(flow) {
  const main = flow.blocks.find((b) => b.kind === 'main');
  const stages = main ? main.nodes.filter((n) => n.stage !== 'SOURCE') : [];
  const idx = (s) => stages.findIndex((n) => n.stage === s);
  const HEAVY = ['$group', '$unwind', '$lookup'];
  const firstHeavy = Math.min(...HEAVY.map((s) => (idx(s) === -1 ? Infinity : idx(s))));

  return [
    { label: 'Pipeline punya $match', ok: idx('$match') !== -1, hint: 'Tanpa $match, seluruh koleksi dipindai.' },
    {
      label: '$match berada sebelum tahap berat',
      ok: idx('$match') === -1 ? false : idx('$match') < firstHeavy,
      hint: 'Menyaring lebih dulu mengurangi dokumen yang harus diproses $group/$lookup/$unwind.'
    },
    { label: '$sort dibatasi $limit', ok: idx('$sort') === -1 || idx('$limit') > idx('$sort') },
    { label: 'Tidak memakai $where/$function', ok: !stages.some((n) => JSON.stringify(n.spec || '').includes('$where')) }
  ];
}
