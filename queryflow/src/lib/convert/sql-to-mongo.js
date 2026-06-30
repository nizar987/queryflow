// Transpile a SQL SELECT AST → MongoDB aggregation pipeline (best-effort, common shapes).
// Supported: FROM, WHERE (=,!=,<,>,<=,>=,AND,OR,IN,NOT IN,LIKE,IS NULL), single/multi equi-JOIN
// ($lookup+$unwind), GROUP BY + aggregates ($group), HAVING ($match), projection ($project),
// ORDER BY ($sort), LIMIT/OFFSET. Unsupported constructs are reported via `notes`.

export function sqlAstToMongo(ast) {
  const notes = [];
  if (!ast || ast.type !== 'select') {
    return { ok: false, error: 'Hanya SELECT yang bisa dikonversi ke MongoDB.' };
  }
  if (ast._next) notes.push('UNION tidak diterjemahkan — hanya query pertama yang dikonversi.');
  if (Array.isArray(ast.with) && ast.with.length) notes.push('CTE (WITH) tidak diterjemahkan ke pipeline.');

  const from = Array.isArray(ast.from) ? ast.from : [];
  if (!from.length) return { ok: false, error: 'Query tanpa FROM tidak bisa dikonversi.' };
  const base = from[0];
  if (base.expr && base.expr.ast) notes.push('Derived table (subquery di FROM) tidak diterjemahkan.');
  const collection = base.table || 'collection';
  const baseAlias = base.as || base.table;

  const pipeline = [];

  // WHERE → $match (before joins when it only references base table)
  if (ast.where) {
    const m = whereToMatch(ast.where, notes);
    if (m) pipeline.push({ $match: m });
  }

  // JOINs → $lookup + $unwind (equi-join only)
  for (let i = 1; i < from.length; i++) {
    const j = from[i];
    if (!j.on) { notes.push(`JOIN ke ${j.table || '?'} tanpa ON tidak diterjemahkan.`); continue; }
    const eq = extractEquiJoin(j.on);
    if (!eq) { notes.push(`Kondisi JOIN ke ${j.table || '?'} terlalu kompleks untuk $lookup.`); continue; }
    const foreignAlias = j.as || j.table;
    // determine which side is local (base/earlier) vs foreign (this table)
    const localField = eq.left.table === foreignAlias ? eq.right.column : eq.left.column;
    const foreignField = eq.left.table === foreignAlias ? eq.left.column : eq.right.column;
    pipeline.push({ $lookup: { from: j.table, localField, foreignField, as: foreignAlias } });
    pipeline.push({ $unwind: '$' + foreignAlias });
  }

  // GROUP BY + aggregates → $group
  const aggInfo = analyzeAggregates(ast);
  if (ast.groupby || aggInfo.hasAgg) {
    const groupId = buildGroupId(ast.groupby);
    const group = { _id: groupId };
    for (const a of aggInfo.aggs) group[a.outName] = a.mongo;
    pipeline.push({ $group: group });

    // HAVING → $match after group (map aggregates to their $group output alias)
    if (ast.having) {
      const hm = havingToMongo(ast.having, aggInfo, notes);
      if (hm) pipeline.push({ $match: hm });
    }
    // projection to surface grouped fields nicely
    const proj = buildGroupProjection(ast, aggInfo, groupId);
    if (proj) pipeline.push({ $project: proj });
  } else {
    // simple projection
    const proj = buildSimpleProjection(ast.columns, notes);
    if (proj) pipeline.push({ $project: proj });
  }

  // ORDER BY → $sort
  if (ast.orderby) {
    const sort = {};
    for (const o of ast.orderby) {
      const key = o.expr && o.expr.column ? o.expr.column : exprField(o.expr);
      if (key) sort[key] = /desc/i.test(o.type || '') ? -1 : 1;
    }
    if (Object.keys(sort).length) pipeline.push({ $sort: sort });
  }

  // LIMIT / OFFSET
  if (ast.limit && ast.limit.value && ast.limit.value.length) {
    const vals = ast.limit.value.map((v) => (v && 'value' in v ? v.value : v));
    if (ast.limit.seperator === 'offset') {
      if (vals[1]) pipeline.push({ $skip: vals[1] });
      if (vals[0] != null) pipeline.push({ $limit: vals[0] });
    } else if (vals.length === 2) {
      if (vals[0]) pipeline.push({ $skip: vals[0] });
      pipeline.push({ $limit: vals[1] });
    } else {
      pipeline.push({ $limit: vals[0] });
    }
  }

  const text = `db.${collection}.aggregate([\n${pipeline.map((s) => '  ' + mongoStringify(s)).join(',\n')}\n])`;
  return { ok: true, text, pipeline, collection, notes };
}

// ---- WHERE/HAVING translation ----
function whereToMatch(expr, notes, isHaving = false) {
  const m = condToMongo(expr, notes, isHaving);
  return m;
}

function condToMongo(e, notes, isHaving) {
  if (!e) return null;
  if (e.type === 'binary_expr') {
    const op = e.operator;
    if (op === 'AND') {
      const l = condToMongo(e.left, notes, isHaving);
      const r = condToMongo(e.right, notes, isHaving);
      return mergeAnd(l, r);
    }
    if (op === 'OR') {
      return { $or: [condToMongo(e.left, notes, isHaving), condToMongo(e.right, notes, isHaving)] };
    }
    const field = exprField(e.left);
    if (!field) { notes.push('Sebagian kondisi WHERE tidak bisa diterjemahkan.'); return null; }
    switch (op) {
      case '=': return { [field]: literal(e.right) };
      case '!=':
      case '<>': return { [field]: { $ne: literal(e.right) } };
      case '>': return { [field]: { $gt: literal(e.right) } };
      case '>=': return { [field]: { $gte: literal(e.right) } };
      case '<': return { [field]: { $lt: literal(e.right) } };
      case '<=': return { [field]: { $lte: literal(e.right) } };
      case 'IN': return { [field]: { $in: listLiterals(e.right) } };
      case 'NOT IN': return { [field]: { $nin: listLiterals(e.right) } };
      case 'IS': return { [field]: null };
      case 'LIKE': return { [field]: likeToRegex(e.right) };
      case 'NOT LIKE': return { [field]: { $not: likeToRegex(e.right) } };
      default:
        notes.push(`Operator '${op}' di WHERE tidak diterjemahkan.`);
        return null;
    }
  }
  notes.push('Sebagian kondisi WHERE tidak bisa diterjemahkan.');
  return null;
}

function mergeAnd(l, r) {
  if (!l) return r;
  if (!r) return l;
  // if keys overlap, fall back to $and
  const keys = new Set([...Object.keys(l), ...Object.keys(r)]);
  if (keys.size < Object.keys(l).length + Object.keys(r).length) return { $and: [l, r] };
  return { ...l, ...r };
}

function likeToRegex(node) {
  const raw = node && (node.value != null ? String(node.value) : '');
  const lead = raw.startsWith('%');
  const trail = raw.endsWith('%');
  const core = raw.replace(/^%/, '').replace(/%$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pat = core;
  if (!lead) pat = '^' + pat;
  if (!trail) pat = pat + '$';
  return { __regex: pat, __flags: '', __raw: `/${pat}/` };
}

// HAVING translation: comparisons whose left side is an aggregate map to the
// group output alias (e.g. HAVING COUNT(*) > 5 → { c: { $gt: 5 } }).
function havingToMongo(e, aggInfo, notes) {
  if (!e || e.type !== 'binary_expr') { notes.push('HAVING tidak bisa diterjemahkan.'); return null; }
  if (e.operator === 'AND') return mergeAnd(havingToMongo(e.left, aggInfo, notes), havingToMongo(e.right, aggInfo, notes));
  if (e.operator === 'OR') return { $or: [havingToMongo(e.left, aggInfo, notes), havingToMongo(e.right, aggInfo, notes)] };

  const field = aggAlias(e.left, aggInfo) || exprField(e.left);
  if (!field) { notes.push('Sebagian HAVING tidak diterjemahkan.'); return null; }
  const ops = { '>': '$gt', '>=': '$gte', '<': '$lt', '<=': '$lte', '=': '$eq', '!=': '$ne', '<>': '$ne' };
  const mop = ops[e.operator];
  if (!mop) { notes.push(`Operator HAVING '${e.operator}' tidak diterjemahkan.`); return null; }
  return { [field]: { [mop]: literal(e.right) } };
}
function aggAlias(node, aggInfo) {
  if (!node || node.type !== 'aggr_func') return null;
  const name = node.name && node.name.toUpperCase();
  const arg = node.args && node.args.expr;
  const argCol = arg && arg.column ? arg.column : (arg && arg.type === 'star' ? '*' : '');
  // match against the aggregates collected from SELECT
  for (const a of aggInfo.aggs) {
    if (a.src === name) {
      if (name === 'COUNT') return a.outName; // good enough for COUNT(*)
      return a.outName;
    }
  }
  return null;
}

// ---- aggregates ----
function analyzeAggregates(ast) {
  const aggs = [];
  let hasAgg = false;
  const AGG = { COUNT: '$sum', SUM: '$sum', AVG: '$avg', MIN: '$min', MAX: '$max' };
  for (const c of ast.columns || []) {
    const ex = c.expr;
    if (ex && ex.type === 'aggr_func' && AGG[ex.name && ex.name.toUpperCase()]) {
      hasAgg = true;
      const name = ex.name.toUpperCase();
      const outName = c.as || (name.toLowerCase() + '_' + (aggs.length + 1));
      let mongo;
      if (name === 'COUNT') {
        const arg = ex.args && ex.args.expr;
        mongo = arg && arg.type !== 'star' && arg.column !== '*' ? { $sum: { $cond: [{ $ne: ['$' + arg.column, null] }, 1, 0] } } : { $sum: 1 };
      } else {
        const arg = ex.args && ex.args.expr;
        mongo = { [AGG[name]]: '$' + (arg && arg.column ? arg.column : '') };
      }
      aggs.push({ outName, mongo, src: name });
    }
  }
  return { hasAgg, aggs };
}

function groupCols(groupby) {
  if (!groupby) return [];
  if (Array.isArray(groupby)) return groupby;
  if (Array.isArray(groupby.columns)) return groupby.columns;
  if (Array.isArray(groupby.value)) return groupby.value;
  return [];
}
function buildGroupId(groupby) {
  const cols = groupCols(groupby);
  if (!cols.length) return null;
  if (cols.length === 1) return '$' + (cols[0].column || exprField(cols[0]));
  const id = {};
  for (const c of cols) { const f = c.column || exprField(c); if (f) id[f] = '$' + f; }
  return id;
}

function buildGroupProjection(ast, aggInfo, groupId) {
  // expose _id fields under their names + aggregates
  const proj = { _id: 0 };
  if (typeof groupId === 'string') {
    const f = groupId.replace(/^\$/, '');
    proj[f] = '$_id';
  } else if (groupId && typeof groupId === 'object') {
    for (const k of Object.keys(groupId)) proj[k] = '$_id.' + k;
  }
  for (const a of aggInfo.aggs) proj[a.outName] = 1;
  return proj;
}

function buildSimpleProjection(columns, notes) {
  if (!Array.isArray(columns)) return null;
  const star = columns.some((c) => c.expr && (c.expr.column === '*' || c.expr.type === 'star'));
  if (star) return null; // no $project → all fields
  const proj = { _id: 0 };
  for (const c of columns) {
    const ex = c.expr;
    if (ex && ex.type === 'column_ref') {
      const name = c.as || ex.column;
      proj[name] = ex.column === (c.as || ex.column) ? 1 : '$' + ex.column;
    } else {
      notes.push('Sebagian kolom SELECT (ekspresi non-kolom) tidak diterjemahkan ke $project.');
    }
  }
  return Object.keys(proj).length > 1 ? proj : null;
}

// ---- helpers ----
function exprField(e) {
  if (!e) return null;
  if (e.type === 'column_ref') return e.column;
  return null;
}
function literal(e) {
  if (!e) return null;
  if (e.type === 'number') return e.value;
  if (e.type === 'single_quote_string' || e.type === 'double_quote_string') return e.value;
  if (e.type === 'bool') return e.value;
  if (e.type === 'null') return null;
  if (e.type === 'column_ref') return '$' + e.column;
  return e.value != null ? e.value : null;
}
function listLiterals(e) {
  const arr = e && e.value ? e.value : [];
  return (Array.isArray(arr) ? arr : [arr]).map(literal);
}
function extractEquiJoin(on) {
  if (on && on.type === 'binary_expr' && on.operator === '=' &&
      on.left && on.left.type === 'column_ref' && on.right && on.right.type === 'column_ref') {
    return { left: on.left, right: on.right };
  }
  return null;
}

// pretty-print a JS object as Mongo shell syntax (unquoted keys, regex literals)
export function mongoStringify(v) {
  if (v === null) return 'null';
  if (v && typeof v === 'object' && typeof v.__regex === 'string') return v.__raw || `/${v.__regex}/${v.__flags || ''}`;
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return '[ ' + v.map(mongoStringify).join(', ') + ' ]';
  if (typeof v === 'object') {
    const parts = Object.entries(v).map(([k, val]) => `${keyStr(k)}: ${mongoStringify(val)}`);
    return '{ ' + parts.join(', ') + ' }';
  }
  return String(v);
}
function keyStr(k) {
  return /^[$A-Za-z_][\w$.]*$/.test(k) ? k : JSON.stringify(k);
}
