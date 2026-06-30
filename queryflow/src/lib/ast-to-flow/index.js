// ast-to-flow — transform a parsed SELECT AST into logical execution-order flow blocks.
// Logical order (PRD §4.1.A): FROM → JOIN → WHERE → GROUP BY → HAVING → WINDOW → SELECT → DISTINCT → ORDER BY → LIMIT.
// CTEs and subqueries become nested collapsible sub-flows (PRD §4.1.B).
import {
  exprToSQL,
  columnsToSQL,
  fromEntryLabel,
  fromAliases,
  collectColumnRefs,
  collectSubqueries
} from '../parser/ast-utils.js';

// Node category per DESIGN.md §6 (semantic colors).
const CATEGORY = {
  FROM: 'gray',
  JOIN: 'blue',
  WHERE: 'coral',
  'GROUP BY': 'purple',
  HAVING: 'coral',
  WINDOW: 'teal',
  SELECT: 'teal',
  DISTINCT: 'teal',
  'ORDER BY': 'gray',
  LIMIT: 'gray',
  UNION: 'gray',
  CTE: 'gray'
};

let _seq = 0;
function uid(prefix) {
  return `${prefix}-${_seq++}`;
}

/**
 * @param {object} ast primary SELECT statement
 * @returns {{ blocks: Block[], nodesById: Record<string,FlowNode>, error?: string }}
 */
export function astToFlow(ast) {
  _seq = 0;
  if (!ast || ast.type !== 'select') {
    return { blocks: [], nodesById: {}, error: 'Hanya statement SELECT yang divisualisasikan di v1.' };
  }
  const blocks = [];
  const nodesById = {};

  // outerAliases: aliases visible from enclosing scope (for correlation detection)
  buildBlocksForSelect(ast, { blocks, nodesById, outerAliases: new Set(), depth: 0, kind: 'main', label: 'Query utama' });

  return { blocks, nodesById };
}

/**
 * @typedef {Object} FlowNode
 * @property {string} id
 * @property {string} blockId
 * @property {string} stage
 * @property {string} category
 * @property {string} title
 * @property {string} subtitle
 * @property {string} sql
 * @property {boolean} correlated
 * @property {string[]} correlatedCols
 */

/** @typedef {Object} Block */

function buildBlocksForSelect(select, ctx, parentNodeId = null) {
  const { blocks, nodesById, outerAliases, depth } = ctx;
  const blockId = uid('b');
  const myAliases = fromAliases(select.from);
  const visibleAliases = new Set([...outerAliases, ...myAliases]);

  const block = {
    id: blockId,
    kind: ctx.kind,
    label: ctx.label,
    depth,
    parentNodeId: ctx.kind === 'cte' ? null : parentNodeId,
    parentBlockId: ctx.kind === 'cte' ? parentNodeId : null,
    nodes: [],
    correlated: false,
    correlatedCols: []
  };
  blocks.push(block);

  const push = (stage, title, subtitle, sql, extra = {}) => {
    const node = {
      id: uid('n'),
      blockId,
      stage,
      category: CATEGORY[stage] || 'gray',
      title,
      subtitle: subtitle || '',
      sql: sql || '',
      correlated: false,
      correlatedCols: [],
      ...extra
    };
    block.nodes.push(node);
    nodesById[node.id] = node;
    return node;
  };

  // --- CTEs (WITH) execute first; each becomes its own block, linked to this one. ---
  if (Array.isArray(select.with)) {
    for (const cte of select.with) {
      const name = cte.name && cte.name.value ? cte.name.value : '(cte)';
      const recursive = !!select.with.recursive || /recursive/i.test(name);
      buildBlocksForSelect(cte.stmt.ast, {
        blocks, nodesById, outerAliases: visibleAliases, depth: depth + 1,
        kind: 'cte', label: `CTE: ${name}${recursive ? ' (recursive)' : ''}`
      }, blockId);
    }
  }

  // --- FROM (base relation) ---
  const from = Array.isArray(select.from) ? select.from : [];
  if (from.length) {
    const base = from[0];
    push('FROM', `FROM ${fromEntryLabel(base)}`, base.expr ? 'derived table (subquery)' : tableMeta(base), `FROM ${fromEntryLabel(base)}`);
    // derived table in FROM → subflow
    if (base.expr && base.expr.ast) {
      attachSubquery(base.expr.ast, block.nodes[block.nodes.length - 1], ctx, visibleAliases, depth);
    }

    // --- JOINs ---
    for (let i = 1; i < from.length; i++) {
      const j = from[i];
      if (!j.join && !j.on && !j.using) {
        // comma-join (implicit cross join)
        push('JOIN', `CROSS JOIN ${fromEntryLabel(j)}`, 'tanpa kondisi ON — cartesian product', `, ${fromEntryLabel(j)}`, { joinType: 'CROSS' });
        continue;
      }
      const jt = (j.join || 'INNER JOIN').toUpperCase();
      const onSQL = j.on ? exprToSQL(j.on) : j.using ? `USING (${(j.using || []).join(', ')})` : '';
      push('JOIN', `${jt} ${fromEntryLabel(j)}`, onSQL ? `ON ${onSQL}` : 'tanpa kondisi ON', `${jt} ${fromEntryLabel(j)}${onSQL ? ' ON ' + onSQL : ''}`, {
        joinType: jt,
        hasOn: !!(j.on || j.using),
        onExpr: j.on || null
      });
      if (j.expr && j.expr.ast) {
        attachSubquery(j.expr.ast, block.nodes[block.nodes.length - 1], ctx, visibleAliases, depth);
      }
    }
  }

  // --- WHERE ---
  if (select.where) {
    const n = push('WHERE', 'WHERE', exprToSQL(select.where), `WHERE ${exprToSQL(select.where)}`, { whereExpr: select.where });
    detectAndAttachSubqueries(select.where, n, ctx, visibleAliases, depth, block);
  }

  // --- GROUP BY ---
  if (select.groupby) {
    const gcols = normalizeList(select.groupby).map(exprToSQL).join(', ');
    push('GROUP BY', 'GROUP BY', gcols, `GROUP BY ${gcols}`, { groupCols: gcols });
  }

  // --- HAVING ---
  if (select.having) {
    const n = push('HAVING', 'HAVING', exprToSQL(select.having), `HAVING ${exprToSQL(select.having)}`, { havingExpr: select.having });
    detectAndAttachSubqueries(select.having, n, ctx, visibleAliases, depth, block);
  }

  // --- WINDOW (if any window function present in SELECT) ---
  const hasWindow = Array.isArray(select.columns) && select.columns.some((c) => c.expr && c.expr.over);
  if (hasWindow) {
    push('WINDOW', 'WINDOW', 'evaluasi window function (OVER …)', 'OVER (…)');
  }

  // --- SELECT ---
  const colSQL = columnsToSQL(select.columns);
  const selNode = push('SELECT', 'SELECT', truncate(colSQL, 60), `SELECT ${select.distinct ? 'DISTINCT ' : ''}${colSQL}`, { columns: select.columns });
  // subqueries in SELECT list (scalar / N+1 candidates)
  if (Array.isArray(select.columns)) {
    for (const c of select.columns) detectAndAttachSubqueries(c.expr, selNode, ctx, visibleAliases, depth, block, true);
  }

  // --- DISTINCT (folded as marker on SELECT, but shown as its own light node if present) ---
  if (select.distinct) {
    push('DISTINCT', 'DISTINCT', 'hapus baris duplikat', 'DISTINCT');
  }

  // --- ORDER BY ---
  if (select.orderby) {
    const obParts = normalizeList(select.orderby).map((o) => `${exprToSQL(o.expr)}${o.type ? ' ' + o.type : ''}`);
    const ordinal = normalizeList(select.orderby).some((o) => o.expr && o.expr.type === 'number');
    push('ORDER BY', 'ORDER BY', obParts.join(', '), `ORDER BY ${obParts.join(', ')}`, { orderby: select.orderby, ordinal });
  }

  // --- LIMIT ---
  if (select.limit && (select.limit.value || (Array.isArray(select.limit.value) && select.limit.value.length))) {
    const lim = limitToSQL(select.limit);
    push('LIMIT', 'LIMIT', lim, `LIMIT ${lim}`);
  }

  // --- UNION chain (_next) ---
  if (select._next) {
    const op = (select.set_op || select.union || 'union').toString().toUpperCase().replace('_', ' ');
    const unionNode = push('UNION', op.includes('UNION') ? op : `UNION (${op})`, 'gabungkan hasil set query berikutnya', op);
    buildBlocksForSelect(select._next, {
      blocks, nodesById, outerAliases, depth, kind: 'union-branch', label: 'Cabang UNION'
    }, unionNode.id);
  }

  return block;
}

function attachSubquery(subAst, parentNode, ctx, visibleAliases, depth) {
  const sub = buildBlocksForSelect(subAst, {
    blocks: ctx.blocks, nodesById: ctx.nodesById, outerAliases: visibleAliases,
    depth: depth + 1, kind: 'subquery', label: 'Subquery'
  }, parentNode.id);
  markCorrelation(subAst, sub, visibleAliases, parentNode);
  return sub;
}

// Find subquery wrappers directly within an expression and attach each as a subflow.
function detectAndAttachSubqueries(expr, parentNode, ctx, visibleAliases, depth, block, inSelect = false) {
  const subs = collectSubqueries(expr);
  for (const subAst of subs) {
    const sub = buildBlocksForSelect(subAst, {
      blocks: ctx.blocks, nodesById: ctx.nodesById, outerAliases: visibleAliases,
      depth: depth + 1, kind: 'subquery', label: inSelect ? 'Subquery di SELECT' : 'Subquery'
    }, parentNode.id);
    markCorrelation(subAst, sub, visibleAliases, parentNode);
  }
}

// Mark a subquery block correlated if it references an alias from the outer scope
// that it does NOT itself declare.
function markCorrelation(subAst, subBlock, outerAliases, parentNode) {
  const innerAliases = fromAliases(subAst.from);
  const refs = collectColumnRefs(subAst);
  const correlatedCols = [];
  for (const r of refs) {
    if (!r.table) continue;
    const t = String(r.table).toLowerCase();
    if (outerAliases.has(t) && !innerAliases.has(t)) {
      correlatedCols.push(`${r.table}.${r.column}`);
    }
  }
  if (correlatedCols.length) {
    subBlock.correlated = true;
    subBlock.correlatedCols = [...new Set(correlatedCols)];
    parentNode.correlated = true;
    parentNode.correlatedCols = [...new Set([...(parentNode.correlatedCols || []), ...correlatedCols])];
  }
}

// ---------- helpers ----------
function normalizeList(x) {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.value)) return x.value;
  return x ? [x] : [];
}
function tableMeta(base) {
  return base.db ? `${base.db}.${base.table}` : '';
}
function limitToSQL(limit) {
  if (!limit) return '';
  const vals = Array.isArray(limit.value) ? limit.value : [limit.value];
  const nums = vals.map((v) => (v && 'value' in v ? v.value : v));
  if (limit.seperator === 'offset' && nums.length === 2) return `${nums[0]} OFFSET ${nums[1]}`;
  return nums.join(', ');
}
function truncate(s, n) {
  s = s || '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function exprToSQLSafe(e) {
  try { return exprToSQL(e); } catch { return ''; }
}
