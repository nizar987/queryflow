// MongoDB rule-based problem detection (parity with SQL analyzer).
// Static analysis only — not a replacement for explain('executionStats').
//
// As in rules.js: `before` is always the user's own stage text, `after` is a
// rewrite of that same stage. Generic illustrations hide whether the analyzer
// actually understood the pipeline.
import { collectOperators } from '../glossary/mongo-index.js';
import { stringifyRelaxed } from '../parser/relaxed-json.js';

const SEV = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };

function mk(node, ruleId, severity, title, why, before, after) {
  return { ruleId, severity, nodeId: node ? node.id : null, title, why, before: before || '', after: after || '' };
}

/** The stage exactly as the user wrote it, e.g. `{ $match: { status: "active" } }`. */
function stageText(node) {
  if (!node) return '';
  if (node.sql) return node.sql;
  return node.spec !== undefined ? `{ ${node.stage}: ${stringifyRelaxed(node.spec)} }` : node.stage || '';
}

/** Top-level field names a $match filters on (skipping $and/$or/$expr wrappers). */
function matchFields(spec, out = new Set()) {
  if (!spec || typeof spec !== 'object') return out;
  for (const [k, v] of Object.entries(spec)) {
    if (k === '$and' || k === '$or' || k === '$nor') {
      for (const sub of Array.isArray(v) ? v : []) matchFields(sub, out);
    } else if (k === '$expr') {
      collectFieldPaths(v, out);
    } else if (!k.startsWith('$')) {
      out.add(k.split('.')[0]);
    }
  }
  return out;
}

/** Field paths referenced as "$field" inside an $expr tree. */
function collectFieldPaths(v, out) {
  if (typeof v === 'string' && v.startsWith('$') && !v.startsWith('$$')) {
    out.add(v.slice(1).split('.')[0]);
  } else if (Array.isArray(v)) {
    for (const x of v) collectFieldPaths(x, out);
  } else if (v && typeof v === 'object') {
    for (const x of Object.values(v)) collectFieldPaths(x, out);
  }
}

/**
 * Fields that only exist *because* of an earlier stage. A $match on any of
 * these cannot be hoisted above that stage — the field wouldn't exist yet.
 */
function producedFields(stages) {
  const made = new Set();
  for (const st of stages) {
    const spec = st.spec;
    if (st.stage === '$group' && spec && typeof spec === 'object') {
      // after $group only _id and the accumulators survive
      made.add('_id');
      for (const k of Object.keys(spec)) if (k !== '_id') made.add(k);
    } else if (['$addFields', '$set', '$project'].includes(st.stage) && spec && typeof spec === 'object') {
      for (const k of Object.keys(spec)) made.add(k.split('.')[0]);
    } else if (st.stage === '$lookup' && spec && spec.as) {
      made.add(String(spec.as).split('.')[0]);
    }
  }
  return made;
}

/** True when every field this $match touches already exists at the pipeline start. */
function isHoistable(matchStage, upstream) {
  const made = producedFields(upstream);
  const fields = matchFields(matchStage.spec);
  if (!fields.size) return false; // can't tell — don't promise a safe move
  for (const f of fields) if (made.has(f)) return false;
  return true;
}

/** Render the main pipeline as `[ a, b, c ]`, marking one stage if asked. */
function pipelineText(stages, { move = null, insert = null } = {}) {
  const parts = [];
  if (insert) parts.push(insert);
  for (const s of stages) {
    if (move && s === move) continue;
    parts.push(stageText(s));
  }
  if (move) parts.unshift(stageText(move));
  return `[ ${parts.join(', ')} ]`;
}

// main-pipeline stage nodes in order (skip SOURCE + sub-blocks)
function mainStages(flow) {
  const main = flow.blocks.find((b) => b.kind === 'main');
  if (!main) return [];
  return main.nodes.filter((n) => n.stage !== 'SOURCE');
}

// 1. No $match at all → full collection scan.
const ruleNoMatch = {
  id: 'mongo-no-match',
  detect(flow) {
    const stages = mainStages(flow);
    if (!stages.length) return [];
    const hasMatch = stages.some((n) => n.stage === '$match');
    if (!hasMatch) {
      const src = flow.blocks[0].nodes[0];
      return [mk(src, 'mongo-no-match', SEV.WARNING,
        'Tidak ada $match — scan seluruh koleksi',
        'Pipeline tanpa $match memindai semua dokumen koleksi sebelum diproses. Pada koleksi besar ini mahal. Tambahkan $match sedini mungkin untuk memanfaatkan index dan mengurangi volume.',
        pipelineText(stages),
        pipelineText(stages, { insert: '{ $match: { <field>: <nilai> } }' }))];
    }
    return [];
  }
};

// 2. $match not first → can't use index, processes more docs than needed.
const ruleMatchLate = {
  id: 'mongo-match-late',
  detect(flow) {
    const stages = mainStages(flow);
    const out = [];
    const HEAVY = new Set(['$group', '$unwind', '$lookup', '$project', '$addFields', '$set', '$sort', '$unionWith']);
    let sawHeavy = false;
    for (let i = 0; i < stages.length; i++) {
      const n = stages[i];
      if (n.stage === '$match' && sawHeavy) {
        // Only propose the move when the filtered fields exist before the heavy
        // stages. Hoisting a $match over the $group that CREATED its field is a
        // broken query, not an optimisation.
        const hoistable = isHoistable(n, stages.slice(0, i));
        out.push(mk(n, 'mongo-match-late', hoistable ? SEV.WARNING : SEV.INFO,
          hoistable ? '$match bisa dipindah ke awal pipeline' : '$match setelah tahap berat (tidak bisa dipindah)',
          hoistable
            ? 'Karena $match ini berada setelah tahap seperti $group/$unwind/$lookup, ia tidak bisa memakai index koleksi dan baru menyaring dokumen yang sudah terlanjur diproses. Semua field yang difilter sudah ada sejak awal, jadi $match ini aman dipindah ke depan.'
            : 'Ini menyaring field yang baru dibuat oleh tahap sebelumnya ($group/$addFields/$lookup), jadi TIDAK bisa dipindah ke awal — field-nya belum ada di sana. Untuk mengurangi volume, tambahkan $match terpisah di awal atas field aslinya.',
          pipelineText(stages),
          hoistable ? pipelineText(stages, { move: n })
                    : pipelineText(stages, { insert: '{ $match: { <field_asli>: <nilai> } }' })));
        break;
      }
      if (HEAVY.has(n.stage)) sawHeavy = true;
    }
    return out;
  }
};

// 3. $where / $function — runs JS per document.
const ruleWhere = {
  id: 'mongo-where',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      for (const n of block.nodes) {
        const ops = collectOperators(n.spec);
        if (ops.has('$where') || ops.has('$function')) {
          out.push(mk(n, 'mongo-where', SEV.CRITICAL,
            '$where/$function menjalankan JavaScript per dokumen',
            'Operator $where/$function mengeksekusi JavaScript untuk setiap dokumen — sangat lambat, tidak bisa memakai index, dan berisiko keamanan. Ganti dengan operator query biasa ($gt, $expr, dll).',
            stageText(n),
            '{ $match: { $expr: { <operator>: ["$fieldA", "$fieldB"] } } }'));
        }
      }
    }
    return out;
  }
};

// 4. Unanchored $regex → cannot use index (like leading wildcard).
const ruleRegex = {
  id: 'mongo-regex',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      for (const n of block.nodes) {
        const unanchored = hasUnanchoredRegex(n.spec);
        if (unanchored.v) {
          out.push(mk(n, 'mongo-regex', SEV.WARNING,
            `Regex tanpa anchor ^${unanchored.pattern ? ` (${unanchored.pattern})` : ''} — tidak memakai index`,
            'Pola regex yang tidak diawali `^` memaksa pemindaian semua dokumen karena index tidak bisa dipakai. Anchor ke awal string, atau gunakan text index untuk pencarian teks bebas.',
            stageText(n),
            unanchored.pattern
              ? `pakai /^${unanchored.pattern.replace(/^\/+|\/[a-z]*$/g, '')}/ (anchored), atau $text index untuk pencarian bebas`
              : 'anchor pola ke awal string dengan ^, atau pakai $text index'));
        }
      }
    }
    return out;
  }
};

// 5. $lookup followed by $unwind then $group — denormalize-then-reaggregate (often avoidable).
const ruleLookupUnwindGroup = {
  id: 'mongo-lookup-unwind-group',
  detect(flow) {
    const stages = mainStages(flow);
    const out = [];
    for (let i = 0; i < stages.length - 1; i++) {
      if (stages[i].stage === '$lookup') {
        const next = stages.slice(i + 1, i + 4).map((s) => s.stage);
        if (next.includes('$unwind') && next.includes('$group')) {
          out.push(mk(stages[i], 'mongo-lookup-unwind-group', SEV.INFO,
            'Pola $lookup → $unwind → $group',
            'Menggabungkan ($lookup), memecah ($unwind), lalu mengelompokkan ($group) sering bisa diringkas. Pertimbangkan $lookup dengan sub-pipeline yang sudah mengagregasi di dalamnya, atau pastikan foreignField ter-index agar join tidak jadi bottleneck.',
            stageText(stages[i]),
            '{ $lookup: { from: …, let: {…}, pipeline: [ { $match: … }, { $group: … } ], as: … } }'));
          break;
        }
      }
    }
    return out;
  }
};

// 6. $sort without $limit → potential large in-memory sort.
const ruleSortNoLimit = {
  id: 'mongo-sort-no-limit',
  detect(flow) {
    const stages = mainStages(flow);
    const out = [];
    for (let i = 0; i < stages.length; i++) {
      if (stages[i].stage === '$sort') {
        const after = stages.slice(i + 1).map((s) => s.stage);
        if (!after.includes('$limit')) {
          out.push(mk(stages[i], 'mongo-sort-no-limit', SEV.INFO,
            '$sort tanpa $limit',
            'Mengurutkan tanpa $limit memaksa semua dokumen masuk sort (batas memori 100MB tanpa index pendukung). Bila hanya butuh sebagian, tambahkan $limit tepat setelah $sort agar MongoDB bisa memakai top-N sort.',
            stageText(stages[i]),
            `${stageText(stages[i])}, { $limit: 50 }`));
        }
      }
    }
    return out;
  }
};

// 7. $unwind without a following $match (blow-up not trimmed).
const ruleUnwindBlowup = {
  id: 'mongo-unwind-blowup',
  detect(flow) {
    const stages = mainStages(flow);
    const out = [];
    for (let i = 0; i < stages.length; i++) {
      if (stages[i].stage === '$unwind') {
        const beforeHasMatch = stages.slice(0, i).some((s) => s.stage === '$match');
        if (!beforeHasMatch) {
          out.push(mk(stages[i], 'mongo-unwind-blowup', SEV.INFO,
            '$unwind tanpa filter sebelumnya',
            '$unwind menggandakan dokumen per elemen array. Tanpa $match yang mempersempit dokumen lebih dulu, pipeline memproses jauh lebih banyak dokumen dari perlu. Saring sebelum $unwind bila memungkinkan.',
            stageText(stages[i]),
            `{ $match: { <field>: <nilai> } }, ${stageText(stages[i])}`));
          break;
        }
      }
    }
    return out;
  }
};

// 8. Large $skip (deep pagination).
const ruleDeepSkip = {
  id: 'mongo-deep-skip',
  detect(flow) {
    const out = [];
    for (const n of mainStages(flow)) {
      if (n.stage === '$skip' && typeof n.spec === 'number' && n.spec >= 1000) {
        out.push(mk(n, 'mongo-deep-skip', SEV.INFO,
          `$skip ${n.spec} — deep pagination`,
          '$skip besar tetap memindai dan membuang dokumen yang dilewati, jadi makin dalam halaman makin lambat. Gunakan range query berbasis _id/field terurut (keyset pagination) sebagai ganti.',
          stageText(n),
          '{ $match: { _id: { $gt: <id_terakhir_halaman_sebelumnya> } } }   // keyset pagination'));
      }
    }
    return out;
  }
};

// 9. $project that only adds fields but appears before $match (could filter first). info
const ruleProjectBeforeMatch = {
  id: 'mongo-project-before-match',
  detect(flow) {
    const stages = mainStages(flow);
    const out = [];
    const firstMatch = stages.findIndex((s) => s.stage === '$match');
    if (firstMatch > 0) {
      const before = stages.slice(0, firstMatch);
      const shaper = before.find((s) => ['$project', '$addFields', '$set'].includes(s.stage));
      if (shaper) {
        const matchStage = stages[firstMatch];
        // Swapping is only valid if $match doesn't read what the shaper created.
        if (!isHoistable(matchStage, [shaper])) return out;
        out.push(mk(shaper, 'mongo-project-before-match', SEV.INFO,
          `${shaper.stage} sebelum $match`,
          `${shaper.stage} sebelum $match memproses field untuk dokumen yang nanti dibuang. $match ini tidak memakai field hasil ${shaper.stage}, jadi urutannya bisa ditukar agar transformasi hanya berjalan atas dokumen yang lolos filter.`,
          `${stageText(shaper)}, ${stageText(matchStage)}`,
          `${stageText(matchStage)}, ${stageText(shaper)}`));
      }
    }
    return out;
  }
};

export const MONGO_RULES = [
  ruleWhere,            // critical
  ruleNoMatch,
  ruleMatchLate,
  ruleRegex,
  ruleUnwindBlowup,
  ruleLookupUnwindGroup,
  ruleSortNoLimit,
  ruleDeepSkip,
  ruleProjectBeforeMatch
];

// ---- helpers ----
/** @returns {{v:boolean, pattern:string}} — pattern is kept so the fix can quote it. */
function hasUnanchoredRegex(spec, found = { v: false, pattern: '' }) {
  if (spec == null || found.v) return found;
  if (Array.isArray(spec)) { for (const v of spec) hasUnanchoredRegex(v, found); return found; }
  if (typeof spec === 'object') {
    if (typeof spec.__regex === 'string') {
      if (!spec.__regex.startsWith('^')) { found.v = true; found.pattern = spec.__raw || spec.__regex; }
      return found;
    }
    if (spec.__call || spec.__ident) return found;
    for (const [k, v] of Object.entries(spec)) {
      if (k === '$regex' && typeof v === 'string' && !v.startsWith('^')) {
        found.v = true; found.pattern = v;
        return found;
      }
      hasUnanchoredRegex(v, found);
    }
  }
  return found;
}

export { SEV };
