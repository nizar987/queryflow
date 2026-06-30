// Analyzer engine — runs all rules over the flow, returns findings sorted by severity.
// Findings anchor to flow nodes (bidirectional linking in UI — DESIGN.md §4.6, §7).
import { RULES } from './rules.js';
import { MONGO_RULES } from './mongo-rules.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/** Run SQL rules. */
export function analyze(ast, flow) {
  return runRules(RULES, flow, { ast });
}

/** Run MongoDB rules (same finding shape). */
export function analyzeMongo(flow) {
  return runRules(MONGO_RULES, flow, {});
}

function runRules(rules, flow, ctx) {
  const findings = [];
  for (const rule of rules) {
    try {
      const r = rule.detect(flow, ctx);
      if (Array.isArray(r)) findings.push(...r);
    } catch (e) {
      // a single buggy rule must never crash the whole analysis
      // eslint-disable-next-line no-console
      console.warn(`rule ${rule.id} failed:`, e && e.message);
    }
  }

  // stable id + sort by severity then by document order of the anchored node
  findings.forEach((f, i) => {
    f.id = `f${i}`;
  });
  findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return s;
  });

  const byNode = {};
  for (const f of findings) {
    if (f.nodeId) (byNode[f.nodeId] ||= []).push(f);
  }

  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  return { findings, byNode, counts };
}

/** Highest severity among a node's findings (for the node's `!` badge color). */
export function nodeBadgeSeverity(byNode, nodeId) {
  const fs = byNode[nodeId];
  if (!fs || !fs.length) return null;
  if (fs.some((f) => f.severity === 'critical')) return 'critical';
  if (fs.some((f) => f.severity === 'warning')) return 'warning';
  return 'info';
}
