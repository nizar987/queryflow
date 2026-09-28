// Match normalized EXPLAIN relation facts back to the flow's FROM/JOIN nodes,
// so the diagram can show real numbers next to the static analysis.
import { buildNodeLookup } from '../analyzer/table-resolve.js';

/**
 * @param {object} flow          - result.flow from the pipeline
 * @param {object} normalized    - output of normalizeExplain()
 * @returns {{ rows: object[], badges: Record<string, object>, unmatched: object[] }}
 */
export function matchExplainToFlow(flow, normalized) {
  const lookup = buildNodeLookup(flow);
  const rows = [];
  const unmatched = [];

  for (const fact of normalized.relations) {
    const nodeId = lookup.get(String(fact.alias || fact.table).toLowerCase()) || lookup.get(String(fact.table).toLowerCase());
    const row = { ...fact, nodeId: nodeId || null };
    rows.push(row);
    if (!nodeId) unmatched.push(row);
  }

  const badges = {};
  for (const r of rows) {
    if (!r.nodeId) continue;
    // A table can appear more than once in the plan (self-join); keep the
    // one with the worse access type so the badge never hides a full scan
    // behind an earlier index hit on the same node.
    const existing = badges[r.nodeId];
    if (existing && rank(existing.access) <= rank(r.access)) continue;
    badges[r.nodeId] = {
      access: r.access,
      label: r.accessLabel,
      index: r.index,
      tooltip: tooltipFor(r)
    };
  }

  return { rows, badges, unmatched };
}

const RANK = { full: 0, other: 1, index: 2 };
const rank = (a) => (a in RANK ? RANK[a] : 1);

function tooltipFor(r) {
  const bits = [r.accessLabel];
  if (r.index) bits.push(`index: ${r.index}`);
  if (r.actualRows != null) bits.push(`${fmt(r.actualRows)} baris aktual`);
  else if (r.estRows != null) bits.push(`~${fmt(r.estRows)} baris (perkiraan)`);
  if (r.actualTimeMs != null) bits.push(`${r.actualTimeMs.toFixed(2)}ms`);
  return bits.join(' · ');
}
function fmt(n) {
  return Number(n).toLocaleString('id-ID');
}
