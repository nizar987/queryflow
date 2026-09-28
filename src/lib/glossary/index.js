// Glossary builder — non-redundant per session (PRD §4.1.C, PLAN §5).
// Each function/clause explained ONCE; repeat usages reference the first entry
// plus their node-specific context (partition key, ON condition, etc).
import { lookupFunction, lookupClause } from './dictionary.js';
import { funcName, funcArgCount, collectFunctions, exprToSQL } from '../parser/ast-utils.js';

/**
 * Build a glossary from the flow blocks (which carry AST refs).
 * @param {object} ast primary select AST
 * @param {object} flow result of astToFlow
 * @returns {{ entries: GlossaryEntry[], byNode: Record<string, NodeUsage[]> }}
 */
export function buildGlossary(ast, flow) {
  // signature = NAME/argCount → dedup key (PRD: hash of function name + arg count)
  const seen = new Map(); // signature -> entry
  const order = [];
  const byNode = {}; // nodeId -> array of usages

  const register = (sig, name, kind, def, nodeId, context) => {
    let entry = seen.get(sig);
    if (!entry) {
      entry = {
        signature: sig,
        name,
        kind, // 'function' | 'clause'
        label: def ? def.label : name,
        text: def ? def.text : null, // null → fallback "belum ada penjelasan"
        hasDefinition: !!def,
        firstNodeId: nodeId,
        usageCount: 0
      };
      seen.set(sig, entry);
      order.push(entry);
    }
    entry.usageCount++;
    (byNode[nodeId] ||= []).push({
      signature: sig,
      name: entry.label,
      isFirst: entry.firstNodeId === nodeId,
      context: context || ''
    });
  };

  // Walk each flow node, pulling functions from its AST refs + clause concepts from its stage.
  for (const block of flow.blocks) {
    for (const node of block.nodes) {
      // Clause-level concept for the stage
      registerClauseForNode(node, register);

      // Functions used inside this node's expression(s)
      const exprs = nodeExprs(node);
      for (const ex of exprs) {
        for (const fn of collectFunctions(ex)) {
          const name = funcName(fn);
          if (!name) continue;
          const sig = `${name}/${funcArgCount(fn)}`;
          const def = lookupFunction(name);
          register(sig, name, 'function', def, node.id, functionContext(fn));
        }
      }
    }
  }

  return { entries: order, byNode };
}

function registerClauseForNode(node, register) {
  let clauseName = null;
  let ctx = '';
  switch (node.stage) {
    case 'JOIN':
      clauseName = node.joinType === 'CROSS' ? 'CROSS JOIN' : (node.joinType || 'INNER JOIN');
      ctx = node.subtitle;
      break;
    case 'GROUP BY':
      clauseName = 'GROUP BY';
      ctx = node.subtitle;
      break;
    case 'HAVING':
      clauseName = 'HAVING';
      break;
    case 'UNION':
      clauseName = node.title.includes('ALL') ? 'UNION ALL' : 'UNION';
      break;
    case 'DISTINCT':
      clauseName = 'DISTINCT';
      break;
    case 'ORDER BY':
      clauseName = 'ORDER BY';
      ctx = node.subtitle;
      break;
    case 'LIMIT':
      clauseName = 'LIMIT';
      break;
    case 'WINDOW':
      clauseName = 'WINDOW';
      break;
    default:
      return;
  }
  const def = lookupClause(clauseName);
  if (def) register(`clause:${clauseName}`, clauseName, 'clause', def, node.id, ctx);
}

function nodeExprs(node) {
  const out = [];
  if (node.whereExpr) out.push(node.whereExpr);
  if (node.havingExpr) out.push(node.havingExpr);
  if (node.onExpr) out.push(node.onExpr);
  if (node.columns) out.push(node.columns);
  if (node.orderby) out.push(node.orderby);
  return out;
}

function functionContext(fn) {
  // Provide node-specific context for repeat usages (partition key, args).
  if (fn.over) {
    const spec = fn.over.as_window_specification && fn.over.as_window_specification.window_specification;
    if (spec) {
      const part = (spec.partitionby || []).map((p) => exprToSQL(p.expr)).join(', ');
      const ord = (spec.orderby || []).map((o) => exprToSQL(o.expr)).join(', ');
      const bits = [];
      if (part) bits.push(`PARTITION BY ${part}`);
      if (ord) bits.push(`ORDER BY ${ord}`);
      return bits.join(' · ');
    }
  }
  if (fn.args) {
    try {
      const a = exprToSQL(fn.args.expr || fn.args);
      return a ? `argumen: ${a}` : '';
    } catch {
      return '';
    }
  }
  return '';
}
