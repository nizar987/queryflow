// Transpile a parsed MongoDB pipeline → SQL SELECT (best-effort, common stages).
// Supported: $match→WHERE, $group→GROUP BY+aggregates, $project→SELECT, $sort→ORDER BY,
// $limit→LIMIT, $skip→OFFSET, $lookup(+$unwind)→JOIN. Unsupported stages → notes.
import { isCall } from '../parser/relaxed-json.js';

export function mongoToSql(parsed, dialect = 'MariaDB') {
  const notes = [];
  if (!parsed || !Array.isArray(parsed.pipeline)) return { ok: false, error: 'Pipeline tidak valid.' };
  const q = quoter(dialect);
  const table = parsed.collection && parsed.collection !== '(collection)' ? parsed.collection : 'collection';

  let selectCols = null;     // array of {expr, as}
  let whereParts = [];
  let groupKeys = [];
  let havingParts = [];
  let aggCols = [];          // {expr, as}
  let orderParts = [];
  let limit = null, offset = null;
  const joins = [];
  let afterGroup = false;

  for (const st of parsed.pipeline) {
    switch (st.stage) {
      case '$match': {
        const conds = matchToSql(st.spec, q, notes);
        if (afterGroup) havingParts.push(...conds);
        else whereParts.push(...conds);
        break;
      }
      case '$group': {
        afterGroup = true;
        const g = st.spec || {};
        groupKeys = groupIdToSql(g._id, q);
        for (const [k, v] of Object.entries(g)) {
          if (k === '_id') continue;
          aggCols.push({ expr: accToSql(v, q, notes), as: k });
        }
        break;
      }
      case '$project':
      case '$addFields':
      case '$set': {
        selectCols = projectToSql(st.spec, q, notes);
        break;
      }
      case '$sort': {
        for (const [k, dir] of Object.entries(st.spec || {})) {
          orderParts.push(`${q(k)} ${Number(dir) < 0 ? 'DESC' : 'ASC'}`);
        }
        break;
      }
      case '$limit':
        limit = typeof st.spec === 'number' ? st.spec : limit;
        break;
      case '$skip':
        offset = typeof st.spec === 'number' ? st.spec : offset;
        break;
      case '$lookup': {
        const s = st.spec || {};
        if (s.from && s.localField && s.foreignField) {
          joins.push(`LEFT JOIN ${q(s.from)} ON ${q(s.from)}.${q(s.foreignField)} = ${q(table)}.${q(s.localField)}`);
        } else {
          notes.push('$lookup dengan sub-pipeline/let tidak diterjemahkan ke JOIN sederhana.');
        }
        break;
      }
      case '$unwind':
        // usually paired with $lookup; no direct SQL — note only if standalone
        break;
      case '$count':
        aggCols.push({ expr: 'COUNT(*)', as: typeof st.spec === 'string' ? st.spec : 'count' });
        afterGroup = true;
        break;
      default:
        notes.push(`Stage ${st.stage} tidak diterjemahkan ke SQL.`);
    }
  }

  // assemble SELECT list
  let cols;
  if (afterGroup) {
    cols = [...groupKeys.map((k) => k.sql), ...aggCols.map((a) => `${a.expr} AS ${q(a.as)}`)];
    if (!cols.length) cols = ['*'];
  } else if (selectCols && selectCols.length) {
    cols = selectCols;
  } else {
    cols = ['*'];
  }

  let sql = `SELECT ${cols.join(', ')}\nFROM ${q(table)}`;
  for (const j of joins) sql += `\n${j}`;
  if (whereParts.length) sql += `\nWHERE ${whereParts.join(' AND ')}`;
  if (groupKeys.length) sql += `\nGROUP BY ${groupKeys.map((k) => k.ref).join(', ')}`;
  if (havingParts.length) sql += `\nHAVING ${havingParts.join(' AND ')}`;
  if (orderParts.length) sql += `\nORDER BY ${orderParts.join(', ')}`;
  if (limit != null) sql += `\nLIMIT ${limit}`;
  if (offset != null) sql += `\nOFFSET ${offset}`;
  sql += ';';

  return { ok: true, text: sql, notes };
}

// ---- $match → SQL conditions ----
function matchToSql(spec, q, notes, prefix = '') {
  const out = [];
  if (!spec || typeof spec !== 'object') return out;
  for (const [key, val] of Object.entries(spec)) {
    if (key === '$and') { for (const sub of val) out.push(...matchToSql(sub, q, notes)); continue; }
    if (key === '$or') {
      const parts = val.map((sub) => matchToSql(sub, q, notes).join(' AND ')).filter(Boolean);
      if (parts.length) out.push('(' + parts.join(' OR ') + ')');
      continue;
    }
    if (key === '$expr') { notes.push('$expr tidak diterjemahkan ke SQL.'); continue; }
    if (key === '$where') { notes.push('$where (JavaScript) tidak diterjemahkan ke SQL.'); continue; }
    const field = q(key.replace(/^\$/, ''));
    out.push(condToSql(field, val, q, notes));
  }
  return out.filter(Boolean);
}

function condToSql(field, val, q, notes) {
  if (val === null) return `${field} IS NULL`;
  if (isRegex(val)) {
    const r = val.__regex;
    const anchored = r.startsWith('^');
    const core = r.replace(/^\^/, '').replace(/\$$/, '');
    return `${field} LIKE ${sqlStr((anchored ? '' : '%') + core + (r.endsWith('$') ? '' : '%'))}`;
  }
  if (isCall(val)) return `${field} = ${val.__raw}`;
  if (typeof val === 'object' && !Array.isArray(val)) {
    const parts = [];
    for (const [op, v] of Object.entries(val)) {
      switch (op) {
        case '$eq': parts.push(`${field} = ${sqlVal(v)}`); break;
        case '$ne': parts.push(`${field} <> ${sqlVal(v)}`); break;
        case '$gt': parts.push(`${field} > ${sqlVal(v)}`); break;
        case '$gte': parts.push(`${field} >= ${sqlVal(v)}`); break;
        case '$lt': parts.push(`${field} < ${sqlVal(v)}`); break;
        case '$lte': parts.push(`${field} <= ${sqlVal(v)}`); break;
        case '$in': parts.push(`${field} IN (${(v || []).map(sqlVal).join(', ')})`); break;
        case '$nin': parts.push(`${field} NOT IN (${(v || []).map(sqlVal).join(', ')})`); break;
        case '$regex': {
          const rr = String(v); const anchored = rr.startsWith('^');
          parts.push(`${field} LIKE ${sqlStr((anchored ? '' : '%') + rr.replace(/^\^/, '').replace(/\$$/, '') + (rr.endsWith('$') ? '' : '%'))}`);
          break;
        }
        case '$exists': parts.push(`${field} IS ${v ? 'NOT NULL' : 'NULL'}`); break;
        default: notes.push(`Operator ${op} tidak diterjemahkan.`);
      }
    }
    return parts.join(' AND ');
  }
  return `${field} = ${sqlVal(val)}`;
}

// ---- $group helpers ----
function groupIdToSql(id, q) {
  if (id == null) return [];
  if (typeof id === 'string') {
    const f = id.replace(/^\$/, '');
    return [{ ref: q(f), sql: q(f) }];
  }
  if (typeof id === 'object' && !isRegex(id) && !isCall(id)) {
    return Object.entries(id).map(([k, v]) => {
      const f = String(v).replace(/^\$/, '') || k;
      return { ref: q(f), sql: `${q(f)} AS ${q(k)}` };
    });
  }
  return [];
}
function accToSql(acc, q, notes) {
  if (acc && typeof acc === 'object') {
    const [op, v] = Object.entries(acc)[0] || [];
    const field = typeof v === 'string' ? v.replace(/^\$/, '') : null;
    switch (op) {
      case '$sum': return v === 1 || v === '1' ? 'COUNT(*)' : `SUM(${q(field)})`;
      case '$avg': return `AVG(${q(field)})`;
      case '$min': return `MIN(${q(field)})`;
      case '$max': return `MAX(${q(field)})`;
      case '$first': return `MIN(${q(field)})`;
      case '$push': notes.push('$push tidak punya padanan SQL standar (≈ GROUP_CONCAT/ARRAY_AGG).'); return `GROUP_CONCAT(${q(field)})`;
      default: notes.push(`Akumulator ${op} tidak diterjemahkan.`); return 'NULL';
    }
  }
  return 'NULL';
}
function projectToSql(spec, q, notes) {
  if (!spec || typeof spec !== 'object') return null;
  const cols = [];
  for (const [k, v] of Object.entries(spec)) {
    if (k === '_id' && (v === 0 || v === false)) continue;
    if (v === 1 || v === true) cols.push(q(k));
    else if (typeof v === 'string' && v.startsWith('$')) cols.push(`${q(v.slice(1))} AS ${q(k)}`);
    else notes.push(`Field $project '${k}' (ekspresi) tidak diterjemahkan.`);
  }
  return cols;
}

// ---- value rendering ----
function isRegex(v) { return v && typeof v === 'object' && typeof v.__regex === 'string'; }
function sqlVal(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isCall(v)) return v.__raw;
  return sqlStr(String(v));
}
function sqlStr(s) { return `'${String(s).replace(/'/g, "''")}'`; }

function quoter(dialect) {
  const pg = String(dialect).toLowerCase() === 'postgresql';
  // Use no quoting by default for readability; quote only when needed.
  return (id) => {
    if (id == null) return '';
    if (/^[A-Za-z_][\w]*$/.test(id)) return id;
    return pg ? `"${id}"` : '`' + id + '`';
  };
}
