// MongoDB glossary builder — non-redundant per session (parity with SQL glossary).
// Collects pipeline stages + $-operators used in each stage spec, dedup by name.
import { MONGO_STAGES, lookupMongo } from './mongo-dictionary.js';

export function buildMongoGlossary(flow) {
  const seen = new Map();
  const order = [];
  const byNode = {};

  const register = (name, def, nodeId, context) => {
    let entry = seen.get(name);
    if (!entry) {
      entry = {
        signature: name,
        name,
        kind: name in MONGO_STAGES ? 'stage' : 'operator',
        label: def ? def.label : name,
        text: def ? def.text : null,
        hasDefinition: !!def,
        firstNodeId: nodeId,
        usageCount: 0
      };
      seen.set(name, entry);
      order.push(entry);
    }
    entry.usageCount++;
    (byNode[nodeId] ||= []).push({
      signature: name,
      name: entry.label,
      isFirst: entry.firstNodeId === nodeId,
      context: context || ''
    });
  };

  for (const block of flow.blocks) {
    for (const node of block.nodes) {
      // the stage itself
      const stageDef = lookupMongo(node.stage);
      register(node.stage, stageDef, node.id, node.subtitle);
      // operators inside the stage spec
      const ops = collectOperators(node.spec);
      for (const op of ops) register(op, lookupMongo(op), node.id, '');
    }
  }

  return { entries: order, byNode };
}

// Recursively gather $-prefixed operator keys (and $-prefixed string values for $unwind/$group ids).
function collectOperators(spec, found = new Set()) {
  if (spec == null) return found;
  if (Array.isArray(spec)) {
    for (const v of spec) collectOperators(v, found);
    return found;
  }
  if (typeof spec === 'object') {
    if (spec.__call || spec.__regex || spec.__ident) return found; // tagged literals
    for (const [k, v] of Object.entries(spec)) {
      if (k.startsWith('$')) found.add(k);
      collectOperators(v, found);
    }
  }
  return found;
}

export { collectOperators };
