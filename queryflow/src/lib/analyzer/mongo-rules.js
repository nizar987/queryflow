// MongoDB rule-based problem detection (parity with SQL analyzer).
// Static analysis only — not a replacement for explain('executionStats').
import { collectOperators } from '../glossary/mongo-index.js';
import { stringifyRelaxed } from '../parser/relaxed-json.js';

const SEV = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };

function mk(node, ruleId, severity, title, why, before, after) {
  return { ruleId, severity, nodeId: node ? node.id : null, title, why, before: before || '', after: after || '' };
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
        '[ { $group: … } ]',
        '[ { $match: { status: "active" } }, { $group: … } ]')];
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
    for (const n of stages) {
      if (n.stage === '$match' && sawHeavy) {
        out.push(mk(n, 'mongo-match-late', SEV.WARNING,
          '$match setelah tahap berat',
          'Karena $match ini berada setelah tahap seperti $group/$unwind/$lookup, ia tidak bisa lagi memakai index koleksi dan menyaring dokumen yang sudah terlanjur diproses. Bila filternya atas field asli, pindahkan ke awal pipeline.',
          '[ { $group: … }, { $match: { status: "active" } } ]',
          '[ { $match: { status: "active" } }, { $group: … } ]'));
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
            'Operator $where/$function mengeksekusi JavaScript untuk setiap dokumen — sangat lambat, tidak bisa memakai index, dan berisiko keamanan. Ganti dengan operator query ($gt, $expr, dll).',
            '{ $match: { $where: "this.a > this.b" } }',
            '{ $match: { $expr: { $gt: ["$a", "$b"] } } }'));
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
        if (unanchored) {
          out.push(mk(n, 'mongo-regex', SEV.WARNING,
            'Regex tanpa anchor ^ — tidak memakai index',
            'Pola regex yang tidak diawali `^` (mis. /nizar/) memaksa pemindaian semua dokumen karena index tidak bisa dipakai. Anchor ke awal string, atau gunakan text index untuk pencarian bebas.',
            '{ name: /nizar/ }',
            '{ name: /^nizar/ }   // atau $text index'));
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
            'Menggabungkan ($lookup), memecah ($unwind), lalu mengelompokkan ($group) sering bisa diringkas. Pertimbangkan $lookup dengan sub-pipeline + agregasi di dalamnya, atau pastikan foreignField ter-index agar join tidak jadi bottleneck.',
            '',
            ''));
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
            'Mengurutkan tanpa $limit memaksa semua dokumen masuk sort (batas memori 100MB tanpa index pendukung). Bila hanya butuh sebagian, tambahkan $limit setelah $sort, idealnya didukung index.',
            '[ { $sort: { created: -1 } } ]',
            '[ { $sort: { created: -1 } }, { $limit: 50 } ]'));
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
            '[ { $unwind: "$items" }, { $match: … } ]',
            '[ { $match: … }, { $unwind: "$items" } ]'));
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
          '{ $skip: 10000 }',
          '{ $match: { _id: { $gt: lastSeenId } } }'));
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
      if (before.some((s) => s.stage === '$project' || s.stage === '$addFields' || s.stage === '$set')) {
        out.push(mk(before.find((s) => ['$project', '$addFields', '$set'].includes(s.stage)),
          'mongo-project-before-match', SEV.INFO,
          'Transformasi field sebelum $match',
          '$project/$addFields sebelum $match memproses field untuk dokumen yang nanti dibuang. Filter dulu dengan $match, baru bentuk field, agar kerja transformasi tidak terbuang.',
          '[ { $addFields: … }, { $match: … } ]',
          '[ { $match: … }, { $addFields: … } ]'));
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
function hasUnanchoredRegex(spec, found = { v: false }) {
  if (spec == null || found.v) return found.v;
  if (Array.isArray(spec)) { for (const v of spec) hasUnanchoredRegex(v, found); return found.v; }
  if (typeof spec === 'object') {
    if (typeof spec.__regex === 'string') {
      if (!spec.__regex.startsWith('^')) found.v = true;
      return found.v;
    }
    if (spec.__call || spec.__ident) return found.v;
    for (const [k, v] of Object.entries(spec)) {
      if (k === '$regex' && typeof v === 'string' && !v.startsWith('^')) { found.v = true; return found.v; }
      hasUnanchoredRegex(v, found);
    }
  }
  return found.v;
}

export { SEV };
