// mongo-to-flow — transform a parsed MongoDB pipeline into execution-order flow blocks.
// A pipeline is ALREADY in execution order, mapping cleanly to a top-down node column.
// $lookup with a sub-pipeline and $facet become collapsible sub-blocks (parity with SQL subqueries).
import { stringifyRelaxed } from '../parser/relaxed-json.js';

// Stage → semantic category (DESIGN.md §6 color system, reused for Mongo).
const STAGE_CAT = {
  $match: 'coral',        // filter
  $geoNear: 'coral',
  $lookup: 'blue',        // join
  $graphLookup: 'blue',
  $unionWith: 'gray',
  $group: 'purple',       // aggregation
  $bucket: 'purple',
  $bucketAuto: 'purple',
  $sortByCount: 'purple',
  $count: 'purple',
  $project: 'teal',       // output shaping
  $addFields: 'teal',
  $set: 'teal',
  $unset: 'teal',
  $replaceRoot: 'teal',
  $replaceWith: 'teal',
  $unwind: 'gray',
  $sort: 'gray',
  $limit: 'gray',
  $skip: 'gray',
  $facet: 'purple',
  $out: 'gray',
  $merge: 'gray',
  $sample: 'gray'
};

const STAGE_DESC = {
  $match: 'filter dokumen',
  $lookup: 'join ke koleksi lain',
  $graphLookup: 'join rekursif/graph',
  $unwind: 'pecah array jadi banyak dokumen',
  $group: 'kelompokkan + agregasi',
  $project: 'bentuk ulang field output',
  $addFields: 'tambah/ubah field',
  $set: 'tambah/ubah field',
  $sort: 'urutkan dokumen',
  $limit: 'batasi jumlah dokumen',
  $skip: 'lewati N dokumen',
  $count: 'hitung dokumen',
  $facet: 'sub-pipeline paralel',
  $replaceRoot: 'ganti root dokumen',
  $sample: 'ambil sampel acak',
  $out: 'tulis hasil ke koleksi',
  $merge: 'gabung hasil ke koleksi'
};

let _seq = 0;
const uid = (p) => `${p}-${_seq++}`;

export function mongoToFlow(parsed) {
  _seq = 0;
  if (!parsed || !Array.isArray(parsed.pipeline)) {
    return { blocks: [], nodesById: {}, error: 'Pipeline MongoDB tidak valid.' };
  }
  const blocks = [];
  const nodesById = {};
  const blockId = uid('b');
  const block = {
    id: blockId,
    kind: 'main',
    label: `db.${parsed.collection}`,
    depth: 0,
    parentNodeId: null,
    parentBlockId: null,
    nodes: [],
    correlated: false,
    correlatedCols: []
  };
  blocks.push(block);

  const push = (n) => {
    const node = {
      id: uid('n'),
      blockId,
      correlated: false,
      correlatedCols: [],
      ...n
    };
    block.nodes.push(node);
    nodesById[node.id] = node;
    return node;
  };

  // implicit source node (the collection scan)
  push({
    stage: 'SOURCE',
    category: 'gray',
    title: `db.${parsed.collection}`,
    subtitle: parsed.kind === 'find' ? 'find()' : 'aggregate()',
    sql: `db.${parsed.collection}.${parsed.kind}(…)`
  });

  for (const st of parsed.pipeline) {
    const cat = STAGE_CAT[st.stage] || 'gray';
    const node = push({
      stage: st.stage,
      mongoStage: st.stage,
      category: cat,
      title: st.stage,
      subtitle: stageSubtitle(st),
      sql: st.raw,
      spec: st.spec
    });

    // sub-blocks: $lookup with pipeline, $facet branches
    if (st.stage === '$lookup' && st.spec && Array.isArray(st.spec.pipeline)) {
      addSubPipeline(blocks, nodesById, st.spec.pipeline, node.id, `lookup: ${st.spec.from || ''}`, 1);
    }
    if (st.stage === '$facet' && st.spec && typeof st.spec === 'object') {
      for (const [fname, fpipe] of Object.entries(st.spec)) {
        if (Array.isArray(fpipe)) addSubPipeline(blocks, nodesById, fpipe, node.id, `facet: ${fname}`, 1);
      }
    }
  }

  return { blocks, nodesById };
}

function addSubPipeline(blocks, nodesById, pipe, parentNodeId, label, depth) {
  const blockId = uid('b');
  const block = {
    id: blockId, kind: 'subquery', label, depth, parentNodeId, parentBlockId: null,
    nodes: [], correlated: false, correlatedCols: []
  };
  blocks.push(block);
  for (const st of pipe) {
    const keys = st && typeof st === 'object' ? Object.keys(st) : [];
    const stage = keys.find((k) => k.startsWith('$')) || keys[0] || '?';
    const spec = st ? st[stage] : null;
    const node = {
      id: uid('n'), blockId, stage, mongoStage: stage,
      category: STAGE_CAT[stage] || 'gray', title: stage,
      subtitle: stageSubtitle({ stage, spec }), sql: stringifyRelaxed(st), spec,
      correlated: false, correlatedCols: []
    };
    block.nodes.push(node);
    nodesById[node.id] = node;
  }
}

function stageSubtitle(st) {
  const spec = st.spec;
  switch (st.stage) {
    case '$match': {
      const keys = spec && typeof spec === 'object' ? Object.keys(spec) : [];
      return keys.length ? truncate(keys.join(', '), 30) : 'semua dokumen';
    }
    case '$lookup':
      return spec ? `from ${spec.from || '?'}${spec.as ? ' → ' + spec.as : ''}` : '';
    case '$group': {
      const id = spec && spec._id !== undefined ? stringifyRelaxed(spec._id) : '?';
      return `by ${truncate(id, 24)}`;
    }
    case '$unwind':
      return typeof spec === 'string' ? spec : (spec && spec.path) || '';
    case '$sort':
      return spec ? truncate(stringifyRelaxed(spec).replace(/[{}]/g, '').trim(), 28) : '';
    case '$limit':
    case '$skip':
      return String(spec);
    case '$project':
    case '$addFields':
    case '$set': {
      const keys = spec && typeof spec === 'object' ? Object.keys(spec) : [];
      return truncate(keys.join(', '), 30);
    }
    case '$count':
      return typeof spec === 'string' ? spec : '';
    default:
      return spec && typeof spec === 'object' ? truncate(Object.keys(spec).join(', '), 28) : (spec != null ? String(spec) : '');
  }
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export { STAGE_DESC };
