// Query converter — translate between engines/dialects.
// SQL↔SQL via node-sql-parser re-emit; SQL↔Mongo via custom transpilers.
import pkg from 'node-sql-parser';
import { parseSQL } from '../parser/index.js';
import { parseMongo } from '../parser/mongo.js';
import { engineForDialect } from '../pipeline.js';
import { sqlAstToMongo, mongoStringify } from './sql-to-mongo.js';
import { mongoToSql } from './mongo-to-sql.js';

const { Parser } = pkg;
const parser = new Parser();

const SQL_DB = { mariadb: 'MariaDB', mysql: 'MariaDB', postgresql: 'Postgresql', postgres: 'Postgresql' };

/**
 * @param {string} text source query
 * @param {string} from source dialect (MariaDB|MySQL|PostgreSQL|MongoDB)
 * @param {string} to   target dialect
 * @returns {{ ok, text?, notes?:string[], error?:string }}
 */
export function convertQuery(text, from, to) {
  const fromEngine = engineForDialect(from);
  const toEngine = engineForDialect(to);

  if (fromEngine === 'sql' && toEngine === 'sql') return sqlToSql(text, from, to);
  if (fromEngine === 'sql' && toEngine === 'mongo') return sqlToMongo(text, from);
  if (fromEngine === 'mongo' && toEngine === 'sql') return mongoToSqlText(text, to);
  if (fromEngine === 'mongo' && toEngine === 'mongo') return mongoReformat(text);
  return { ok: false, error: 'Kombinasi konversi tidak didukung.' };
}

function sqlToSql(text, from, to) {
  const parsed = parseSQL(text, { dialect: from });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const target = SQL_DB[String(to).toLowerCase()] || 'MariaDB';
  try {
    const out = parser.sqlify(parsed.ast, { database: target });
    const notes = [];
    if (parsed.relaxed) notes.push('Beberapa identifier di-quote otomatis saat parsing.');
    if (target === 'Postgresql') notes.push('Postgres memakai kutip ganda " untuk identifier; cek fungsi spesifik dialek (mis. tanggal/string).');
    return { ok: true, text: out, notes };
  } catch (e) {
    return { ok: false, error: 'Gagal meng-emit ke dialek target: ' + (e.message || '').split('\n')[0] };
  }
}

function sqlToMongo(text, from) {
  const parsed = parseSQL(text, { dialect: from });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const r = sqlAstToMongo(parsed.ast);
  if (!r.ok) return r;
  return { ok: true, text: r.text, notes: dedupe(r.notes) };
}

function mongoToSqlText(text, to) {
  const parsed = parseMongo(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const r = mongoToSql(parsed, to);
  if (!r.ok) return r;
  return { ok: true, text: r.text, notes: dedupe(r.notes) };
}

function mongoReformat(text) {
  const parsed = parseMongo(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const stages = parsed.pipeline.map((st) => {
    const obj = {};
    obj[st.stage] = st.spec;
    return '  ' + mongoStringify(obj);
  });
  const coll = parsed.collection && parsed.collection !== '(collection)' ? parsed.collection : 'collection';
  return { ok: true, text: `db.${coll}.aggregate([\n${stages.join(',\n')}\n])`, notes: [] };
}

function dedupe(arr) {
  return arr && arr.length ? [...new Set(arr)] : [];
}
