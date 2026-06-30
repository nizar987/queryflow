// Rule-based problem detection (PRD §4.1.E, PLAN §6).
// Each rule: { id, severity, title, detect(flow, ctx) -> Finding[] }.
// Finding: { ruleId, severity, nodeId, title, why, before, after }
// Static analysis only — NOT a replacement for EXPLAIN (disclaimer shown in UI).
import {
  funcName,
  collectFunctions,
  collectColumnRefs,
  walk,
  exprToSQL
} from '../parser/ast-utils.js';

const SEV = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };

const AGGREGATES = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'STD', 'STDDEV', 'VARIANCE']);
const INDEX_BUSTERS = new Set(['DATE', 'DATE_FORMAT', 'DATE_TRUNC', 'YEAR', 'MONTH', 'DAY', 'LOWER', 'UPPER', 'SUBSTRING', 'SUBSTR', 'CAST', 'CONVERT', 'TRIM', 'CONCAT']);

function mk(node, ruleId, severity, title, why, before, after) {
  return { ruleId, severity, nodeId: node ? node.id : null, title, why, before: before || '', after: after || '' };
}

// 1. SELECT * — wide reads, breaks covering indexes, brittle to schema changes.
const ruleSelectStar = {
  id: 'select-star',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      const sel = block.nodes.find((n) => n.stage === 'SELECT');
      if (!sel || !Array.isArray(sel.columns)) continue;
      const isStar = sel.columns.some((c) => c === '*' || (c.expr && (c.expr.column === '*' || c.expr.type === 'star')));
      if (isStar) {
        const where = block.kind === 'subquery' || block.kind === 'cte';
        out.push(mk(sel, 'select-star', where ? SEV.WARNING : SEV.WARNING,
          'SELECT * — ambil semua kolom',
          'Mengambil semua kolom memindahkan data lebih banyak dari perlu, membatalkan kemungkinan covering index, dan membuat query rapuh terhadap perubahan skema. Pada tabel besar (mis. `tabImport Tool Document`) dampaknya ke I/O dan jaringan terasa.',
          'SELECT * FROM tabImport_Tool_Document',
          'SELECT name, status, creation FROM tabImport_Tool_Document'));
      }
    }
    return out;
  }
};

// 2. COUNT(column) where COUNT(*) likely intended.
const ruleCountColumn = {
  id: 'count-column',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      const sel = block.nodes.find((n) => n.stage === 'SELECT');
      if (!sel || !Array.isArray(sel.columns)) continue;
      for (const c of sel.columns) {
        for (const fn of collectFunctions(c.expr)) {
          if (funcName(fn) === 'COUNT') {
            const arg = fn.args && fn.args.expr;
            const isStar = arg && (arg.type === 'star' || arg.column === '*');
            const isDistinct = fn.args && fn.args.distinct;
            if (arg && !isStar && !isDistinct && arg.type === 'column_ref') {
              out.push(mk(sel, 'count-column', SEV.INFO,
                `COUNT(${arg.column}) — bukan COUNT(*)?`,
                `COUNT(${arg.column}) hanya menghitung baris di mana kolom itu TIDAK NULL. Bila maksudnya menghitung seluruh baris, gunakan COUNT(*) — lebih jelas dan tidak terpengaruh NULL. Bila memang sengaja mengabaikan NULL, ini benar.`,
                `COUNT(${arg.column})`,
                'COUNT(*)'));
            }
          }
        }
      }
    }
    return out;
  }
};

// 3. Aggregate function used in WHERE (should be HAVING) — usually a real error.
const ruleAggregateInWhere = {
  id: 'aggregate-in-where',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      const where = block.nodes.find((n) => n.stage === 'WHERE');
      if (!where || !where.whereExpr) continue;
      for (const fn of collectFunctions(where.whereExpr)) {
        const name = funcName(fn);
        if (name && AGGREGATES.has(name) && !fn.over) {
          out.push(mk(where, 'aggregate-in-where', SEV.CRITICAL,
            `Fungsi agregat ${name}() di WHERE`,
            `WHERE dievaluasi SEBELUM agregasi GROUP BY, jadi fungsi agregat seperti ${name}() tidak valid di sana dan akan ditolak engine atau salah maksud. Filter atas hasil agregat harus diletakkan di HAVING.`,
            `WHERE ${name}(name) > 3`,
            `GROUP BY ... HAVING ${name}(name) > 3`));
          break;
        }
      }
    }
    return out;
  }
};

// 4. Index-busting function wrapping a column in WHERE/JOIN.
const ruleIndexBusting = {
  id: 'index-busting',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      for (const node of block.nodes) {
        const expr = node.whereExpr || node.onExpr;
        if (!expr) continue;
        for (const fn of collectFunctions(expr)) {
          const name = funcName(fn);
          if (name && INDEX_BUSTERS.has(name)) {
            // only flag when wrapping a column_ref (not a literal)
            const wrapsCol = collectColumnRefs(fn).length > 0;
            if (wrapsCol) {
              const col = collectColumnRefs(fn)[0];
              const colName = col ? (col.table ? col.table + '.' + col.column : col.column) : 'col';
              out.push(mk(node, 'index-busting', SEV.WARNING,
                `${name}(${colName}) membatalkan index`,
                `Membungkus kolom dengan ${name}() di ${node.stage} membuat MariaDB tidak bisa memakai index pada kolom tersebut (harus menghitung fungsi per baris → full scan). Ubah agar sisi kolom tetap "telanjang", pindahkan transformasi ke sisi literal.`,
                `WHERE ${name}(${colName}) = '2026-06-01'`,
                `WHERE ${colName} >= '2026-06-01' AND ${colName} < '2026-06-02'`));
              break;
            }
          }
        }
      }
    }
    return out;
  }
};

// 5. JOIN without ON / cartesian product.
const ruleCartesian = {
  id: 'cartesian-join',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      for (const node of block.nodes) {
        if (node.stage !== 'JOIN') continue;
        if (node.joinType === 'CROSS' || node.hasOn === false) {
          out.push(mk(node, 'cartesian-join', SEV.CRITICAL,
            'JOIN tanpa kondisi ON (cartesian product)',
            'JOIN tanpa ON memasangkan setiap baris kiri dengan setiap baris kanan (N×M baris). Pada tabel besar ini meledak jadi jutaan baris, memakan memori/CPU dan hampir selalu bukan yang diinginkan.',
            'FROM tabUser a JOIN tabRole b',
            'FROM tabUser a JOIN tabRole b ON b.parent = a.name'));
        }
      }
    }
    return out;
  }
};

// 6. Leading-wildcard LIKE '%...' — cannot use index.
const ruleLeadingWildcard = {
  id: 'leading-wildcard',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      for (const node of block.nodes) {
        const expr = node.whereExpr || node.onExpr;
        if (!expr) continue;
        walk(expr, (n) => {
          if (n.type === 'binary_expr' && /LIKE/i.test(n.operator || '')) {
            const r = n.right;
            const val = r && (r.value != null ? r.value : '');
            if (typeof val === 'string' && val.startsWith('%')) {
              const col = n.left && n.left.column ? n.left.column : 'col';
              out.push(mk(node, 'leading-wildcard', SEV.WARNING,
                `LIKE '%…' leading wildcard pada ${col}`,
                'Pola LIKE yang diawali % membuat index B-tree tidak bisa dipakai (harus scan seluruh baris). Untuk pencarian teks bebas, pertimbangkan FULLTEXT index atau mesin pencarian terpisah.',
                `WHERE ${col} LIKE '%nizar%'`,
                `WHERE ${col} LIKE 'nizar%'   -- atau FULLTEXT(${col})`));
            }
          }
        });
      }
    }
    return out;
  }
};

// 7. Subquery in SELECT list — potential N+1 / per-row execution.
const ruleSubqueryInSelect = {
  id: 'subquery-in-select',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      const sel = block.nodes.find((n) => n.stage === 'SELECT');
      if (!sel) continue;
      if (sel.correlated && sel.correlatedCols && sel.correlatedCols.length) {
        out.push(mk(sel, 'subquery-in-select', SEV.WARNING,
          'Subquery korelasi di SELECT (potensi N+1)',
          `Subquery di daftar SELECT yang mereferensikan kolom luar (${sel.correlatedCols.join(', ')}) dieksekusi ulang untuk SETIAP baris hasil — pola N+1 yang lambat pada hasil besar. Sering bisa ditulis ulang jadi LEFT JOIN + GROUP BY agar dijalankan sekali.`,
          '(SELECT COUNT(*) FROM tabComment c WHERE c.reference_name = v.docname)',
          'LEFT JOIN (SELECT reference_name, COUNT(*) c FROM tabComment GROUP BY reference_name) cc ON cc.reference_name = v.docname'));
      }
    }
    return out;
  }
};

// 8. ORDER BY without LIMIT on a potentially large result.
const ruleOrderByNoLimit = {
  id: 'orderby-no-limit',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      if (block.kind !== 'main' && block.kind !== 'union-branch') continue;
      const ob = block.nodes.find((n) => n.stage === 'ORDER BY');
      const limit = block.nodes.find((n) => n.stage === 'LIMIT');
      if (ob && !limit) {
        out.push(mk(ob, 'orderby-no-limit', SEV.INFO,
          'ORDER BY tanpa LIMIT',
          'Mengurutkan seluruh hasil tanpa membatasi jumlah baris bisa mahal pada result set besar (sort di memori/disk). Bila hanya butuh sebagian (mis. N teratas), tambahkan LIMIT.',
          'ORDER BY creation DESC',
          'ORDER BY creation DESC LIMIT 50'));
      }
    }
    return out;
  }
};

// 9. ORDER BY ordinal number — brittle to column reordering.
const ruleOrderByOrdinal = {
  id: 'orderby-ordinal',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      const ob = block.nodes.find((n) => n.stage === 'ORDER BY' && n.ordinal);
      if (ob) {
        out.push(mk(ob, 'orderby-ordinal', SEV.INFO,
          'ORDER BY pakai nomor ordinal',
          'Mengurutkan dengan ORDER BY 2 mengacu ke posisi kolom di SELECT. Bila daftar kolom diubah urutannya, sortir jadi salah secara diam-diam. Sebut nama kolom/alias eksplisit agar tahan perubahan.',
          'ORDER BY 2 DESC',
          'ORDER BY grand_total DESC'));
      }
    }
    return out;
  }
};

// 10. Correlated subquery (anywhere) — flag for manual review (warning, not auto-wrong).
const ruleCorrelated = {
  id: 'correlated-subquery',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      if (!block.correlated) continue;
      // anchor to the parent node that owns this subquery
      const anchorId = block.parentNodeId ? findNodeOwningBlock(flow, block) : null;
      const anchorNode = anchorId ? flow.nodesById[anchorId] : block.nodes[0];
      // avoid duplicating the SELECT-list N+1 finding (rule 7 already covers SELECT)
      const parentStage = anchorNode && anchorNode.stage;
      if (parentStage === 'SELECT') continue;
      out.push(mk(anchorNode || block.nodes[0], 'correlated-subquery', SEV.WARNING,
        'Correlated subquery — dieksekusi per baris',
        `Subquery ini mereferensikan kolom dari query luar (${(block.correlatedCols || []).join(', ')}), sehingga berpotensi dijalankan sekali per baris luar. Tandai untuk review: pada data besar pertimbangkan menulis ulang sebagai JOIN. (Bukan otomatis salah — kadang ini memang paling jelas.)`,
        'WHERE x IN (SELECT id FROM s WHERE s.a = t.a)',
        'JOIN (SELECT DISTINCT a, id FROM s) s ON s.a = t.a'));
    }
    return out;
  }
};

function findNodeOwningBlock(flow, block) {
  // parentNodeId is set at block creation
  return block.parentNodeId || null;
}

export const RULES = [
  ruleAggregateInWhere, // critical first
  ruleCartesian,
  ruleIndexBusting,
  ruleLeadingWildcard,
  ruleSubqueryInSelect,
  ruleCorrelated,
  ruleSelectStar,
  ruleOrderByNoLimit,
  ruleOrderByOrdinal,
  ruleCountColumn
];

export { SEV };
