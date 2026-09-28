// Shared alias/table resolution for anything that needs to map a flow's
// FROM/JOIN nodes back to real table names — the index advisor (optimize.js)
// and the EXPLAIN-to-diagram matcher both need exactly this.
//
// The flow only stores what the query text said ("FROM tabVersion v"); a
// node_ref/EXPLAIN fact only has a bare name ("v" or "tabVersion" or,
// confusingly, MySQL sometimes reports the *alias* as `table_name`). Both
// directions go through the same map so "v" and "tabVersion" always resolve
// to the same node.

/** alias/table (lowercased) -> real table name, for every FROM/JOIN in one block. */
export function aliasMapForBlock(block) {
  const map = {};
  for (const node of block.nodes) {
    if (node.stage !== 'FROM' && node.stage !== 'JOIN') continue;
    const label = node.title.replace(/^(FROM|(CROSS |INNER |LEFT |RIGHT |FULL )?(OUTER )?JOIN)\s+/i, '').trim();
    if (!label || label.startsWith('(')) continue; // derived table — no real name to key on
    const parts = label.split(/\s+/);
    const tableName = parts[0];
    const alias = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    map[alias.toLowerCase()] = tableName;
    map[tableName.toLowerCase()] = tableName;
  }
  return map;
}

/** Resolve a `column_ref` AST node (has `.table`, maybe null) to a real table name. */
export function resolveTableForColumnRef(col, aliasMap) {
  if (col.table) return aliasMap[String(col.table).toLowerCase()] || col.table;
  // Unqualified column with exactly one table in scope is unambiguous.
  const tables = [...new Set(Object.values(aliasMap))];
  return tables.length === 1 ? tables[0] : null;
}

/**
 * FROM/JOIN nodes across every block in a flow (main query + subqueries/CTEs),
 * each tagged with the alias and real table name it represents. EXPLAIN plans
 * don't respect query nesting, so matching has to search the whole flow, not
 * just the main block.
 * @returns {{nodeId:string, blockId:string, alias:string, table:string}[]}
 */
export function nodeTableRefs(flow) {
  const out = [];
  for (const block of flow.blocks) {
    const map = aliasMapForBlock(block);
    for (const node of block.nodes) {
      if (node.stage !== 'FROM' && node.stage !== 'JOIN') continue;
      const label = node.title.replace(/^(FROM|(CROSS |INNER |LEFT |RIGHT |FULL )?(OUTER )?JOIN)\s+/i, '').trim();
      if (!label || label.startsWith('(')) continue;
      const parts = label.split(/\s+/);
      const tableName = parts[0];
      const alias = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      out.push({ nodeId: node.id, blockId: block.id, alias, table: map[alias.toLowerCase()] || tableName });
    }
  }
  return out;
}

/**
 * Build a lookup from EXPLAIN's own table/alias string to a flow node id.
 * Every alias AND every real table name maps to its node, so a caller can
 * probe with whatever string the engine reported without knowing in advance
 * whether it was an alias or the bare table name.
 */
export function buildNodeLookup(flow) {
  const byKey = new Map();
  for (const ref of nodeTableRefs(flow)) {
    const aliasKey = ref.alias.toLowerCase();
    const tableKey = ref.table.toLowerCase();
    // First occurrence wins: a table joined twice under different aliases is
    // resolved by its alias (unambiguous); the bare table name is a
    // best-effort fallback and intentionally doesn't overwrite a later match.
    if (!byKey.has(aliasKey)) byKey.set(aliasKey, ref.nodeId);
    if (!byKey.has(tableKey)) byKey.set(tableKey, ref.nodeId);
  }
  return byKey;
}

export const sanitizeIdent = (s) => String(s).replace(/[^\w]+/g, '_').toLowerCase();
