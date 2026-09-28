// Analyzer engine — runs all rules over the flow, returns findings sorted by severity.
// Findings anchor to flow nodes (bidirectional linking in UI — DESIGN.md §4.6, §7).
import { RULES } from './rules.js';
import { MONGO_RULES } from './mongo-rules.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

/** Run SQL rules. `opts.dialect` lets rules name the actual engine in their prose. */
export function analyze(ast, flow, opts = {}) {
  return runRules(RULES, flow, { ast, dialect: opts.dialect });
}

/** Run MongoDB rules (same finding shape). */
export function analyzeMongo(flow) {
  return runRules(MONGO_RULES, flow, { dialect: 'MongoDB' });
}

/**
 * Position of every node in reading order, so findings on the same severity
 * appear in the order the reader meets them in the diagram.
 */
function documentOrder(flow) {
  const pos = {};
  let i = 0;
  for (const block of flow.blocks) {
    for (const node of block.nodes) pos[node.id] = i++;
  }
  return pos;
}

function runRules(rules, flow, ctx) {
  const raw = [];
  for (const rule of rules) {
    try {
      const r = rule.detect(flow, ctx);
      if (Array.isArray(r)) raw.push(...r);
    } catch (e) {
      // a single buggy rule must never crash the whole analysis
      // eslint-disable-next-line no-console
      console.warn(`rule ${rule.id} failed:`, e && e.message);
    }
  }

  // Two rules can legitimately reach the same conclusion on the same node
  // (e.g. a correlated subquery matched from both sides). Show it once.
  const seen = new Set();
  const findings = [];
  for (const f of raw) {
    const key = `${f.ruleId}|${f.nodeId}|${f.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(f);
  }

  findings.forEach((f, i) => {
    f.id = `f${i}`;
  });

  const order = documentOrder(flow);
  findings.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (s !== 0) return s;
    const pa = a.nodeId in order ? order[a.nodeId] : Infinity;
    const pb = b.nodeId in order ? order[b.nodeId] : Infinity;
    return pa - pb;
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
