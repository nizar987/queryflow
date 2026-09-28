// MongoDB query parser — supports aggregation pipelines and find().
// Accepts:
//   db.collection.aggregate([ {stage}, ... ])
//   db.collection.find({ filter }, { projection })
//   a bare pipeline array: [ {stage}, ... ]
// Output: { ok, collection, kind, pipeline:[{stage, spec, raw}], error, location }
import { parseRelaxed, stringifyRelaxed } from './relaxed-json.js';

export function parseMongo(text) {
  const src = (text || '').trim().replace(/;\s*$/, '');
  if (!src) return { ok: false, error: 'Query kosong — tempel pipeline MongoDB.' };

  try {
    // db.<coll>.aggregate(...) / find(...)
    const m = /\bdb\s*\.\s*([A-Za-z0-9_$.]+)\s*\.\s*(aggregate|find)\s*\(/.exec(src);
    if (m) {
      const collection = m[1];
      const method = m[2];
      const argsRaw = extractBalanced(src, src.indexOf('(', m.index));
      if (method === 'aggregate') {
        const arr = parseRelaxed(argsRaw.replace(/^\(/, '[').replace(/\)$/, ']'));
        // arr is [pipelineArray] or [pipelineArray, options]
        const pipeline = Array.isArray(arr[0]) ? arr[0] : arr;
        return buildPipeline(collection, 'aggregate', pipeline);
      } else {
        // find(filter, projection)
        const arr = parseRelaxed('[' + argsRaw.slice(1, -1) + ']');
        return buildFind(collection, arr[0] || {}, arr[1] || null);
      }
    }
    // bare array pipeline
    if (src.startsWith('[')) {
      const pipeline = parseRelaxed(src);
      return buildPipeline('(collection)', 'aggregate', pipeline);
    }
    // bare find filter object → treat as a single $match
    if (src.startsWith('{')) {
      const filter = parseRelaxed(src);
      return buildFind('(collection)', filter, null);
    }
    return { ok: false, error: 'Format tak dikenali. Gunakan db.coll.aggregate([...]) atau db.coll.find({...}).' };
  } catch (err) {
    return { ok: false, error: humanize(err) };
  }
}

function buildPipeline(collection, kind, pipelineArr) {
  if (!Array.isArray(pipelineArr)) return { ok: false, error: 'Pipeline harus berupa array stage.' };
  const pipeline = pipelineArr.map((st) => {
    const keys = st && typeof st === 'object' ? Object.keys(st) : [];
    const stage = keys.find((k) => k.startsWith('$')) || keys[0] || '?';
    return { stage, spec: st ? st[stage] : null, raw: stringifyRelaxed(st) };
  });
  return { ok: true, collection, kind, pipeline };
}

function buildFind(collection, filter, projection) {
  const pipeline = [];
  if (filter && Object.keys(filter).length) {
    pipeline.push({ stage: '$match', spec: filter, raw: stringifyRelaxed({ $match: filter }) });
  } else {
    pipeline.push({ stage: '$match', spec: {}, raw: '{ $match: {} }  // semua dokumen' });
  }
  if (projection && Object.keys(projection).length) {
    pipeline.push({ stage: '$project', spec: projection, raw: stringifyRelaxed({ $project: projection }) });
  }
  return { ok: true, collection, kind: 'find', pipeline };
}

// extract balanced (...) starting at index of '('
function extractBalanced(s, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const q = c; i++;
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return s.slice(openIdx, i + 1); }
  }
  throw new Error('Tanda kurung () tidak seimbang.');
}

function humanize(err) {
  const m = (err && err.message) || 'Parsing pipeline gagal.';
  return m.length > 200 ? m.slice(0, 197) + '…' : m;
}
