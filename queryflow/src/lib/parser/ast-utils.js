// AST utilities — traversal + lightweight stringification for node-sql-parser MariaDB ASTs.
// Pure, framework-agnostic. Used by ast-to-flow, glossary, and analyzer.

/** Get the function name from a function/aggr_func/window_func node, uppercased. */
export function funcName(node) {
  if (!node) return null;
  if (node.type === 'aggr_func') return String(node.name).toUpperCase();
  if (node.type === 'window_func') return String(node.name).toUpperCase();
  if (node.type === 'function') {
    const n = node.name;
    if (typeof n === 'string') return n.toUpperCase();
    if (n && Array.isArray(n.name) && n.name[0]) return String(n.name[0].value).toUpperCase();
  }
  return null;
}

/** Count positional args of a function node (for dedup signature). */
export function funcArgCount(node) {
  if (!node) return 0;
  const a = node.args;
  if (!a) return 0;
  if (a.type === 'expr_list' && Array.isArray(a.value)) return a.value.length;
  if (a.expr) return 1; // aggr_func style: { expr }
  if (Array.isArray(a.value)) return a.value.length;
  return 0;
}

/** True if a node is a subquery wrapper (has nested .ast that is a select). */
function isSubqueryWrapper(node) {
  return node && typeof node === 'object' && node.ast && node.ast.type === 'select';
}

/**
 * Deep-walk an arbitrary AST value, invoking visit(node) on every object that
 * has a string `type`. Does NOT descend into nested subquery ASTs by default
 * (so callers control subquery boundaries); pass descendSubquery=true to include them.
 */
export function walk(value, visit, descendSubquery = false) {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit, descendSubquery);
    return;
  }
  if (typeof value.type === 'string') visit(value);
  for (const key of Object.keys(value)) {
    if (key === 'ast' && !descendSubquery && isSubqueryWrapper(value)) continue;
    walk(value[key], visit, descendSubquery);
  }
}

/** Collect every function-like node within an expression subtree (not crossing subqueries). */
export function collectFunctions(value) {
  const out = [];
  walk(value, (n) => {
    if (n.type === 'function' || n.type === 'aggr_func' || n.type === 'window_func') out.push(n);
  });
  return out;
}

/** Collect immediate subquery wrappers ({ ast }) found anywhere inside a value (one level). */
export function collectSubqueries(value, found = []) {
  if (value == null || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const v of value) collectSubqueries(v, found);
    return found;
  }
  if (isSubqueryWrapper(value)) {
    found.push(value.ast);
    // do not descend into this subquery's own body here; handled separately
    return found;
  }
  for (const key of Object.keys(value)) collectSubqueries(value[key], found);
  return found;
}

/** Collect all column_ref nodes in a subtree (not crossing subqueries). */
export function collectColumnRefs(value) {
  const out = [];
  walk(value, (n) => {
    if (n.type === 'column_ref') out.push(n);
  });
  return out;
}

/** Table aliases/names declared in a FROM array. */
export function fromAliases(from) {
  const set = new Set();
  if (!Array.isArray(from)) return set;
  for (const f of from) {
    if (f.as) set.add(String(f.as).toLowerCase());
    if (f.table) set.add(String(f.table).toLowerCase());
  }
  return set;
}

// ---------- Minimal SQL stringifier (display only) ----------

export function exprToSQL(e) {
  if (e == null) return '';
  if (typeof e !== 'object') return String(e);
  switch (e.type) {
    case 'column_ref':
      return (e.table ? e.table + '.' : '') + (e.column === '*' ? '*' : e.column);
    case 'star':
      return '*';
    case 'number':
      return String(e.value);
    case 'single_quote_string':
      return `'${e.value}'`;
    case 'double_quote_string':
      return `"${e.value}"`;
    case 'bool':
      return e.value ? 'TRUE' : 'FALSE';
    case 'null':
      return 'NULL';
    case 'param':
      return '?';
    case 'expr_list':
      return (e.value || []).map(exprToSQL).join(', ');
    case 'unary_expr':
      return `${e.operator} ${exprToSQL(e.expr)}`;
    case 'binary_expr': {
      const op = e.operator;
      if (op === 'IN' || op === 'NOT IN') {
        const r = e.right && e.right.value && e.right.value[0] && e.right.value[0].ast
          ? '(subquery)'
          : `(${exprToSQL(e.right)})`;
        return `${exprToSQL(e.left)} ${op} ${r}`;
      }
      if (op === 'BETWEEN' || op === 'NOT BETWEEN') {
        return `${exprToSQL(e.left)} ${op} ${exprToSQL(e.right)}`;
      }
      return `${exprToSQL(e.left)} ${op} ${exprToSQL(e.right)}`;
    }
    case 'aggr_func': {
      const inner = e.args && e.args.expr ? exprToSQL(e.args.expr) : '';
      const distinct = e.args && e.args.distinct ? 'DISTINCT ' : '';
      return `${e.name}(${distinct}${inner})${e.over ? ' OVER (…)' : ''}`;
    }
    case 'window_func':
    case 'function': {
      const name = funcName(e) || 'FN';
      const args = e.args ? exprToSQL(e.args) : '';
      return `${name}(${args})${e.over ? ' OVER (…)' : ''}`;
    }
    case 'case': {
      return 'CASE … END';
    }
    case 'interval':
      return `INTERVAL ${exprToSQL(e.expr)} ${e.unit || ''}`.trim();
    default:
      if (e.ast && e.ast.type === 'select') return '(subquery)';
      if ('value' in e) return String(e.value);
      return '';
  }
}

/** Render a SELECT column list to display SQL. */
export function columnsToSQL(columns) {
  if (!Array.isArray(columns)) return '*';
  return columns
    .map((c) => {
      if (c === '*' || (c.expr && c.expr.column === '*')) return '*';
      const base = exprToSQL(c.expr);
      return c.as ? `${base} AS ${c.as}` : base;
    })
    .join(', ');
}

/** Render a single FROM entry (table or derived subquery) to a label. */
export function fromEntryLabel(f) {
  if (f.expr && f.expr.ast) return `(subquery)${f.as ? ' ' + f.as : ''}`;
  if (f.table) return f.as && f.as !== f.table ? `${f.table} ${f.as}` : f.table;
  return '?';
}
