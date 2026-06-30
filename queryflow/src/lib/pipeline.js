// Full analysis pipeline: parse → flow → glossary → analyze (PRD §4.1.F, DESIGN §7.5).
// Runs entirely client-side (local-only privacy default — PLAN §9).
// Routes by engine: SQL (MariaDB/MySQL/PostgreSQL) vs MongoDB aggregation pipeline.
import { parseSQL } from './parser/index.js';
import { parseMongo } from './parser/mongo.js';
import { astToFlow } from './ast-to-flow/index.js';
import { mongoToFlow } from './ast-to-flow/mongo-flow.js';
import { buildGlossary } from './glossary/index.js';
import { buildMongoGlossary } from './glossary/mongo-index.js';
import { analyze, analyzeMongo, nodeBadgeSeverity } from './analyzer/index.js';

// Map a UI dialect string to an engine family.
export function engineForDialect(dialect) {
  return String(dialect).toLowerCase() === 'mongodb' ? 'mongo' : 'sql';
}

/**
 * @param {string} text
 * @param {{dialect?:string}} [opts]
 * @returns {{ ok:boolean, engine:string, error?:string, location?:object, relaxed?:boolean,
 *   flow?:object, glossary?:object, analysis?:object, badges?:Record<string,string> }}
 */
export function runPipeline(text, opts = {}) {
  const engine = engineForDialect(opts.dialect || 'MariaDB');
  return engine === 'mongo' ? runMongo(text) : runSQL(text, opts);
}

function runSQL(sql, opts) {
  const parsed = parseSQL(sql, opts);
  if (!parsed.ok) return { ok: false, engine: 'sql', error: parsed.error, location: parsed.location };

  const flow = astToFlow(parsed.ast);
  if (flow.error) return { ok: false, engine: 'sql', error: flow.error };

  const glossary = buildGlossary(parsed.ast, flow);
  const analysis = analyze(parsed.ast, flow);
  return finalize('sql', { ast: parsed.ast, flow, glossary, analysis, relaxed: parsed.relaxed || false });
}

function runMongo(text) {
  const parsed = parseMongo(text);
  if (!parsed.ok) return { ok: false, engine: 'mongo', error: parsed.error };

  const flow = mongoToFlow(parsed);
  if (flow.error) return { ok: false, engine: 'mongo', error: flow.error };

  const glossary = buildMongoGlossary(flow);
  const analysis = analyzeMongo(flow);
  return finalize('mongo', { mongo: parsed, flow, glossary, analysis, relaxed: false });
}

function finalize(engine, parts) {
  const badges = {};
  for (const id of Object.keys(parts.flow.nodesById)) {
    const sev = nodeBadgeSeverity(parts.analysis.byNode, id);
    if (sev) badges[id] = sev;
  }
  return { ok: true, engine, badges, ...parts };
}
