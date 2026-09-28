// Parse `db.<collection>.<method>(args…)` into something executable.
//
// Deliberately NOT eval(): the server holds live database credentials, so
// evaluating text from the browser as JavaScript would be arbitrary code
// execution on the host, not a query feature. Everything here is parsed.
import { parseRelaxed } from '../../parser/relaxed-json.js';
import { ObjectId, Decimal128, Long, Timestamp, Binary } from 'mongodb';

/** Methods the runner knows how to execute, and how many docs they read/write. */
export const METHODS = new Set([
  'find', 'findOne', 'aggregate', 'countDocuments', 'estimatedDocumentCount', 'distinct',
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'bulkWrite', 'createIndex', 'dropIndex', 'listIndexes', 'drop'
]);

export const WRITE_METHODS = new Set([
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'bulkWrite', 'createIndex', 'dropIndex', 'drop'
]);

/**
 * @returns {{ok:true, collection:string, method:string, args:any[]} | {ok:false, error:string}}
 */
export function parseCommand(text) {
  const src = String(text || '').trim().replace(/;\s*$/, '');
  if (!src) return { ok: false, error: 'Query kosong.' };

  const m = /^db\s*\.\s*(?:getCollection\(\s*['"]([^'"]+)['"]\s*\)|([A-Za-z0-9_$][A-Za-z0-9_$.]*))\s*\.\s*([A-Za-z0-9_$]+)\s*\(/.exec(src);
  if (!m) {
    return {
      ok: false,
      error: 'Format tak dikenali. Gunakan db.<koleksi>.<method>(…), mis. db.orders.find({ status: "active" }).'
    };
  }

  const collection = m[1] || m[2];
  const method = m[3];
  if (!METHODS.has(method)) {
    return { ok: false, error: `Method "${method}" belum didukung. Yang didukung: ${[...METHODS].join(', ')}.` };
  }

  const open = src.indexOf('(', m.index + m[0].length - 1);
  const argsRaw = extractBalanced(src, open);
  if (argsRaw == null) return { ok: false, error: 'Tanda kurung tidak seimbang.' };

  // Trailing calls like .sort({…}).limit(10) — collect them as cursor modifiers.
  const rest = src.slice(open + argsRaw.length).trim();
  const modifiers = parseModifiers(rest);
  if (!modifiers.ok) return modifiers;

  let args;
  try {
    const inner = argsRaw.slice(1, -1).trim();
    const parsed = inner === '' ? [] : parseRelaxed('[' + inner + ']');
    // revive() rejects things it cannot faithfully turn into BSON (bare
    // variables, unknown helpers) — that is a parse failure, not a crash.
    args = parsed.map(revive);
  } catch (e) {
    return { ok: false, error: `Argumen tidak bisa diparse: ${e.message}` };
  }

  return { ok: true, collection, method, args, modifiers: modifiers.value };
}

function parseModifiers(rest) {
  const out = {};
  let s = rest;
  while (s.startsWith('.')) {
    const m = /^\.\s*([A-Za-z0-9_$]+)\s*\(/.exec(s);
    if (!m) return { ok: false, error: `Tidak paham bagian "${s.slice(0, 20)}…".` };
    const open = s.indexOf('(', m[0].length - 1);
    const raw = extractBalanced(s, open);
    if (raw == null) return { ok: false, error: 'Tanda kurung tidak seimbang pada modifier.' };
    const name = m[1];
    if (!['sort', 'limit', 'skip', 'project', 'projection', 'count'].includes(name)) {
      return { ok: false, error: `Modifier "${name}()" belum didukung.` };
    }
    const inner = raw.slice(1, -1).trim();
    try {
      out[name === 'projection' ? 'project' : name] = inner === '' ? true : revive(parseRelaxed(inner));
    } catch (e) {
      return { ok: false, error: `Argumen ${name}() tidak bisa diparse: ${e.message}` };
    }

    s = s.slice(open + raw.length).trim();
  }
  if (s) return { ok: false, error: `Ada sisa teks yang tidak dikenali: "${s.slice(0, 30)}…".` };
  return { ok: true, value: out };
}

function extractBalanced(s, openIdx) {
  if (openIdx < 0 || s[openIdx] !== '(') return null;
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") inStr = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return s.slice(openIdx, i + 1);
    }
  }
  return null;
}

/** Turn the parser's placeholder wrappers into real BSON/JS values. */
function revive(v) {
  if (v == null) return v;
  if (Array.isArray(v)) return v.map(revive);
  if (typeof v !== 'object') return v;

  if (typeof v.__regex === 'string') return new RegExp(v.__regex, v.__flags || '');

  if (typeof v.__ident === 'string') {
    const id = v.__ident;
    if (id === 'null') return null;
    if (id === 'true') return true;
    if (id === 'false') return false;
    if (id === 'undefined') return undefined;
    // A bare identifier is a variable the server cannot resolve — surface it
    // rather than silently sending the literal string to the database.
    throw new Error(`nilai "${id}" tidak dikenal (variabel JavaScript tidak tersedia di sini)`);
  }

  if (typeof v.__call === 'string') return reviveCall(v);

  const out = {};
  for (const [k, val] of Object.entries(v)) out[k] = revive(val);
  return out;
}

function reviveCall(v) {
  const name = v.__call;
  const raw = String(v.__raw || '');
  const inner = raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')')).trim();
  const unquoted = inner.replace(/^['"]|['"]$/g, '');

  switch (name) {
    case 'ObjectId':
      if (!unquoted) return new ObjectId();
      if (!ObjectId.isValid(unquoted)) throw new Error(`ObjectId("${unquoted}") tidak valid`);
      return new ObjectId(unquoted);
    case 'ISODate':
    case 'Date': {
      const d = unquoted ? new Date(unquoted) : new Date();
      if (Number.isNaN(d.getTime())) throw new Error(`${name}("${unquoted}") bukan tanggal valid`);
      return d;
    }
    case 'NumberInt':
      return parseInt(unquoted, 10);
    case 'NumberLong':
      return Long.fromString(unquoted || '0');
    case 'NumberDecimal':
      return Decimal128.fromString(unquoted || '0');
    case 'Timestamp':
      return new Timestamp({ t: 0, i: 0 });
    case 'BinData':
      return new Binary(Buffer.from(unquoted, 'base64'));
    default:
      throw new Error(`fungsi "${name}()" tidak didukung`);
  }
}
