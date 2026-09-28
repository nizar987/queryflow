// Rule-based problem detection (PRD §4.1.E, PLAN §6).
// Each rule: { id, severity, title, detect(flow, ctx) -> Finding[] }.
// Finding: { ruleId, severity, nodeId, title, why, before, after }
// Static analysis only — NOT a replacement for EXPLAIN (disclaimer shown in UI).
//
// Every `before` MUST be rendered from the user's own query, and every `after`
// MUST be a rewrite of that same fragment. Canned illustrations naming tables
// the user never wrote read as if the analyzer misread the query.
import {
  funcName,
  collectFunctions,
  collectColumnRefs,
  columnName,
  isStarRef,
  walk,
  exprToSQL
} from '../parser/ast-utils.js';

const SEV = { CRITICAL: 'critical', WARNING: 'warning', INFO: 'info' };

const AGGREGATES = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'STD', 'STDDEV', 'VARIANCE']);
const INDEX_BUSTERS = new Set(['DATE', 'DATE_FORMAT', 'DATE_TRUNC', 'YEAR', 'MONTH', 'DAY', 'LOWER', 'UPPER', 'SUBSTRING', 'SUBSTR', 'CAST', 'CONVERT', 'TRIM', 'CONCAT']);
/** Index-busters whose equality form has a clean half-open range rewrite. */
const DATE_TRUNCATORS = new Set(['DATE', 'DATE_TRUNC', 'YEAR', 'MONTH', 'DAY', 'DATE_FORMAT']);

function mk(node, ruleId, severity, title, why, before, after) {
  return { ruleId, severity, nodeId: node ? node.id : null, title, why, before: before || '', after: after || '' };
}

// ---------- shared helpers over the flow ----------

/** Engine name to use in prose ("MariaDB tidak bisa memakai index…"). */
function engineName(ctx) {
  return ctx && ctx.dialect ? ctx.dialect : 'Database';
}

/** The block's driving relation, e.g. "tabVersion v" — for realistic examples. */
function baseTable(block) {
  const from = block.nodes.find((n) => n.stage === 'FROM');
  if (!from) return null;
  return from.title.replace(/^FROM\s+/i, '').trim() || null;
}

/** Alias to prefix columns with, e.g. "v" from "tabVersion v". */
function baseAlias(block) {
  const t = baseTable(block);
  if (!t || t.startsWith('(')) return null;
  const parts = t.split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : parts[0];
}

/** Innermost binary comparison whose subtree contains `target`. */
function enclosingPredicate(root, target) {
  let best = null;
  walk(root, (n) => {
    if (n.type !== 'binary_expr') return;
    if (/^(AND|OR)$/i.test(n.operator || '')) return;
    if (!subtreeContains(n, target)) return;
    best = n; // walk is top-down, so the last match is the innermost
  });
  return best;
}

function subtreeContains(root, target) {
  let hit = false;
  walk(root, (n) => {
    if (n === target) hit = true;
  });
  return hit;
}

/** The keyword a node's predicate actually sits under. */
function clauseKeyword(node) {
  if (node.stage === 'JOIN') return 'ON';
  return node.stage;
}

// Flow nodes are ordered by *execution* (FROM → WHERE → SELECT); quoting them
// in that order produces "FROM t WHERE x SELECT c", which is not SQL.
const WRITTEN_ORDER = [
  'SELECT', 'DISTINCT', 'FROM', 'JOIN', 'WHERE',
  'GROUP BY', 'HAVING', 'WINDOW', 'ORDER BY', 'LIMIT'
];

/** Reassemble a block's nodes back into readable SQL (for subquery quotes). */
function blockSQL(flow, block) {
  if (!block) return '';
  const rank = (n) => {
    const i = WRITTEN_ORDER.indexOf(n.stage);
    return i === -1 ? WRITTEN_ORDER.length : i;
  };
  return block.nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i)
    .map(({ n }) => n.sql)
    .filter(Boolean)
    .join(' ')
    .trim();
}

function childBlockOf(flow, nodeId) {
  return flow.blocks.find((b) => b.parentNodeId === nodeId) || null;
}

// 1. SELECT * — wide reads, breaks covering indexes, brittle to schema changes.
const ruleSelectStar = {
  id: 'select-star',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      const sel = block.nodes.find((n) => n.stage === 'SELECT');
      if (!sel || !Array.isArray(sel.columns)) continue;
      const isStar = sel.columns.some((c) => isStarRef(c));
      if (!isStar) continue;

      // `SELECT *` inside EXISTS/IN subqueries is idiomatic and costs nothing —
      // the old code computed this distinction then threw it away.
      const inSubquery = block.kind === 'subquery' || block.kind === 'cte';
      const table = baseTable(block);
      const alias = baseAlias(block);
      const col = alias ? `${alias}.name` : 'name';

      out.push(mk(sel, 'select-star', inSubquery ? SEV.INFO : SEV.WARNING,
        table ? `SELECT * pada ${table}` : 'SELECT * — ambil semua kolom',
        inSubquery
          ? 'Di dalam subquery EXISTS/IN, SELECT * tidak benar-benar mengambil kolom sehingga dampaknya kecil. Tetap disebutkan agar konsisten; ganti jadi SELECT 1 bila ingin eksplisit.'
          : `Mengambil semua kolom memindahkan data lebih banyak dari perlu, membatalkan kemungkinan covering index, dan membuat query rapuh terhadap perubahan skema (kolom baru ikut terbawa). Sebutkan kolom yang benar-benar dipakai.`,
        table ? `SELECT * FROM ${table}` : 'SELECT *',
        table ? `SELECT ${col}, … FROM ${table}` : 'SELECT kolom_yang_dipakai, …'));
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
          if (funcName(fn) !== 'COUNT') continue;
          const arg = fn.args && fn.args.expr;
          const isStar = isStarRef(arg);
          const isDistinct = fn.args && fn.args.distinct;
          if (arg && !isStar && !isDistinct && arg.type === 'column_ref') {
            const colSQL = exprToSQL(arg);
            out.push(mk(sel, 'count-column', SEV.INFO,
              `COUNT(${colSQL}) — bukan COUNT(*)?`,
              `COUNT(${colSQL}) hanya menghitung baris di mana kolom itu TIDAK NULL. Bila maksudnya menghitung seluruh baris, gunakan COUNT(*) — lebih jelas dan tidak terpengaruh NULL. Bila memang sengaja mengabaikan NULL, ini sudah benar.`,
              c.as ? `COUNT(${colSQL}) AS ${c.as}` : `COUNT(${colSQL})`,
              c.as ? `COUNT(*) AS ${c.as}` : 'COUNT(*)'));
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
        if (!name || !AGGREGATES.has(name) || fn.over) continue;

        // Quote the exact predicate that carries the aggregate, not the whole WHERE.
        const pred = enclosingPredicate(where.whereExpr, fn);
        const predSQL = pred ? exprToSQL(pred) : exprToSQL(fn);
        const hasGroup = !!block.nodes.find((n) => n.stage === 'GROUP BY');

        out.push(mk(where, 'aggregate-in-where', SEV.CRITICAL,
          `Fungsi agregat ${name}() di WHERE`,
          `WHERE dievaluasi SEBELUM agregasi GROUP BY, jadi ${name}() tidak valid di sana — engine akan menolak query ini. Filter atas hasil agregat harus diletakkan di HAVING${hasGroup ? '' : ', dan query ini belum punya GROUP BY sehingga perlu ditambahkan juga'}.`,
          `WHERE ${predSQL}`,
          hasGroup ? `HAVING ${predSQL}` : `GROUP BY …\nHAVING ${predSQL}`));
        break; // one finding per WHERE is enough
      }
    }
    return out;
  }
};

// 4. Index-busting function wrapping a column in WHERE/JOIN.
const ruleIndexBusting = {
  id: 'index-busting',
  detect(flow, ctx) {
    const out = [];
    for (const block of flow.blocks) {
      for (const node of block.nodes) {
        const expr = node.whereExpr || node.onExpr;
        if (!expr) continue;

        // One finding per wrapped column — a WHERE touching two columns through
        // functions has two separate index problems, not one.
        const seen = new Set();
        for (const fn of collectFunctions(expr)) {
          const name = funcName(fn);
          if (!name || !INDEX_BUSTERS.has(name)) continue;
          const col = collectColumnRefs(fn)[0];
          if (!col) continue; // wrapping a literal costs nothing
          const colSQL = exprToSQL(col);
          if (seen.has(colSQL)) continue;
          seen.add(colSQL);

          const pred = enclosingPredicate(expr, fn);
          const beforeSQL = pred ? exprToSQL(pred) : exprToSQL(fn);
          out.push(mk(node, 'index-busting', SEV.WARNING,
            `${name}(${colSQL}) membatalkan index`,
            `Membungkus kolom dengan ${name}() di ${clauseKeyword(node)} membuat ${engineName(ctx)} tidak bisa memakai index pada kolom tersebut (nilai fungsi harus dihitung per baris → full scan). Biarkan sisi kolom "telanjang" dan pindahkan transformasi ke sisi literal.`,
            `${clauseKeyword(node)} ${beforeSQL}`,
            `${clauseKeyword(node)} ${rewriteIndexBuster(name, colSQL, pred, ctx && ctx.dialect)}`));
        }
      }
    }
    return out;
  }
};

/** Turn `DATE(col) = '2026-06-01'` into a half-open range on the bare column. */
function rewriteIndexBuster(name, colSQL, pred, dialect) {
  const isEquality = pred && pred.operator === '=';
  const literal = isEquality ? exprToSQL(pred.right) : null;

  if (literal && /^'.*'$/.test(literal)) {
    if (name === 'DATE' || name === 'DATE_TRUNC') {
      // PostgreSQL spells the interval as a quoted literal; MySQL/MariaDB don't.
      const oneDay = /postgre/i.test(dialect || '') ? "INTERVAL '1 day'" : 'INTERVAL 1 DAY';
      return `${colSQL} >= ${literal} AND ${colSQL} < ${literal} + ${oneDay}`;
    }
    if (DATE_TRUNCATORS.has(name)) {
      // YEAR/MONTH/DATE_FORMAT truncate to a period whose length varies —
      // give the shape of the fix rather than an interval that may be wrong.
      return `${colSQL} >= <awal_periode> AND ${colSQL} < <awal_periode_berikutnya>`;
    }
  }
  if ((name === 'LOWER' || name === 'UPPER') && literal) {
    return `${colSQL} = ${literal}   -- kolom dengan collation case-insensitive, atau index pada ${name}(${colSQL})`;
  }
  // No safe mechanical rewrite — say so instead of inventing one.
  return `${colSQL} <perbandingan langsung>   -- atau buat functional index pada ${name}(${colSQL})`;
}

// 5. JOIN without ON / cartesian product.
const ruleCartesian = {
  id: 'cartesian-join',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      const left = baseAlias(block);
      for (const node of block.nodes) {
        if (node.stage !== 'JOIN') continue;
        if (node.joinType !== 'CROSS' && node.hasOn !== false) continue;

        const joined = node.title.replace(/^(CROSS |INNER |LEFT |RIGHT |FULL )?(OUTER )?JOIN\s+/i, '').trim();
        const rightAlias = joined ? joined.split(/\s+/).pop() : 'b';
        out.push(mk(node, 'cartesian-join', SEV.CRITICAL,
          `JOIN tanpa ON — cartesian product${joined ? ` dengan ${joined}` : ''}`,
          'JOIN tanpa ON memasangkan setiap baris kiri dengan setiap baris kanan (N×M baris). Pada tabel besar ini meledak jadi jutaan baris, memakan memori/CPU, dan hampir selalu bukan yang diinginkan. Bila cross join memang disengaja, tulis CROSS JOIN eksplisit agar niatnya terbaca.',
          node.sql,
          `${node.sql} ON ${rightAlias}.<kolom> = ${left || '<tabel_kiri>'}.<kolom>`));
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
          if (n.type !== 'binary_expr' || !/LIKE/i.test(n.operator || '')) return;
          const r = n.right;
          const val = r && r.value != null ? r.value : '';
          if (typeof val !== 'string' || !val.startsWith('%')) return;

          // exprToSQL keeps table qualifiers and handles function/expr left sides,
          // which the old `n.left.column` lookup silently dropped as "col".
          const colSQL = exprToSQL(n.left);
          const trimmed = val.replace(/^%+/, '');
          const op = n.operator.toUpperCase();
          out.push(mk(node, 'leading-wildcard', SEV.WARNING,
            `${op} '%…' pada ${colSQL} — index tidak terpakai`,
            'Pola yang diawali % membuat index B-tree tidak bisa dipakai karena awal string tidak diketahui — engine harus memindai seluruh baris. Untuk pencarian teks bebas, pakai FULLTEXT index atau mesin pencarian terpisah.',
            `${colSQL} ${op} '${val}'`,
            trimmed
              ? `${colSQL} ${op} '${trimmed}'   -- atau MATCH(${colSQL}) AGAINST ('${trimmed.replace(/%/g, '')}')`
              : `MATCH(${colSQL}) AGAINST ('…')   -- pola '%' menyaring apa pun`));
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
      if (!sel || !sel.correlated || !sel.correlatedCols || !sel.correlatedCols.length) continue;

      const child = childBlockOf(flow, sel.id);
      const sub = blockSQL(flow, child);
      const cols = sel.correlatedCols.join(', ');
      const outerCol = sel.correlatedCols[0] || '<kolom_luar>';
      out.push(mk(sel, 'subquery-in-select', SEV.WARNING,
        'Subquery korelasi di SELECT (potensi N+1)',
        `Subquery di daftar SELECT ini mereferensikan kolom luar (${cols}), sehingga dieksekusi ulang untuk SETIAP baris hasil — pola N+1 yang lambat pada hasil besar. Umumnya bisa ditulis ulang jadi LEFT JOIN ke hasil agregat yang dihitung sekali untuk semua baris.`,
        sub || 'subquery korelasi di daftar SELECT',
        `-- hitung sekali, lalu join:\nLEFT JOIN (\n  SELECT <kunci>, COUNT(*) AS n\n  FROM <tabel_subquery>\n  GROUP BY <kunci>\n) agg ON agg.<kunci> = ${outerCol}`));
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
      if (!ob || limit) continue;
      out.push(mk(ob, 'orderby-no-limit', SEV.INFO,
        'ORDER BY tanpa LIMIT',
        'Mengurutkan seluruh hasil tanpa membatasi jumlah baris bisa mahal pada result set besar (sort di memori, lalu tumpah ke disk). Bila hanya butuh sebagian (mis. N teratas), tambahkan LIMIT agar engine bisa memakai top-N sort.',
        ob.sql,
        `${ob.sql} LIMIT 50`));
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
      if (!ob) continue;
      const sel = block.nodes.find((n) => n.stage === 'SELECT');
      // Resolve each ordinal against the actual SELECT list so the suggestion
      // names the real column instead of a placeholder.
      const resolved = resolveOrdinals(ob, sel);
      const starSelect = sel && Array.isArray(sel.columns) && sel.columns.some((c) => isStarRef(c));
      const why = starSelect
        ? 'Nomor di ORDER BY mengacu ke posisi kolom di SELECT, tapi SELECT di sini memakai `*` — posisi kolom ditentukan oleh urutan kolom di tabel, jadi ALTER TABLE saja sudah cukup untuk mengubah hasil sortir tanpa error. Sebut nama kolom secara eksplisit.'
        : `Nomor di ORDER BY mengacu ke posisi kolom di SELECT${resolved.names.length ? ` (${resolved.names.join(', ')})` : ''}. Bila daftar kolom diubah urutannya, sortir jadi salah secara diam-diam tanpa error. Sebut nama kolom atau alias secara eksplisit.`;
      out.push(mk(ob, 'orderby-ordinal', SEV.INFO,
        'ORDER BY pakai nomor ordinal',
        why,
        ob.sql,
        // Echoing the input back as "the fix" is worse than saying nothing.
        resolved.sql && resolved.sql !== ob.sql ? resolved.sql : ''));
    }
    return out;
  }
};

/** Replace `ORDER BY 2 DESC` with `ORDER BY <col#2> DESC` where resolvable. */
function resolveOrdinals(ob, sel) {
  const names = [];
  const list = Array.isArray(ob.orderby) ? ob.orderby : ob.orderby ? [ob.orderby] : [];
  const columns = sel && Array.isArray(sel.columns) ? sel.columns : [];
  if (!list.length) return { sql: '', names };

  const parts = list.map((o) => {
    const dir = o.type ? ' ' + o.type : '';
    if (o.expr && o.expr.type === 'number') {
      const target = columns[Number(o.expr.value) - 1];
      if (target) {
        const label = target.as || exprToSQL(target.expr);
        if (label) {
          names.push(`${o.expr.value} → ${label}`);
          return label + dir;
        }
      }
      return String(o.expr.value) + dir;
    }
    return exprToSQL(o.expr) + dir;
  });
  return { sql: `ORDER BY ${parts.join(', ')}`, names };
}

// 10. Correlated subquery outside the SELECT list — flag for manual review.
const ruleCorrelated = {
  id: 'correlated-subquery',
  detect(flow) {
    const out = [];
    for (const block of flow.blocks) {
      if (!block.correlated) continue;
      const anchorNode = block.parentNodeId ? flow.nodesById[block.parentNodeId] : block.nodes[0];
      // rule 7 already covers the SELECT-list N+1 case with a better rewrite
      if (anchorNode && anchorNode.stage === 'SELECT') continue;

      const cols = (block.correlatedCols || []).join(', ');
      const sub = blockSQL(flow, block);
      out.push(mk(anchorNode || block.nodes[0], 'correlated-subquery', SEV.WARNING,
        `Correlated subquery di ${anchorNode ? anchorNode.stage : 'query'} — dieksekusi per baris`,
        `Subquery ini mereferensikan kolom dari query luar${cols ? ` (${cols})` : ''}, sehingga berpotensi dijalankan sekali per baris luar. Tandai untuk review: pada data besar pertimbangkan menulis ulang sebagai JOIN. Bukan otomatis salah — kadang bentuk ini justru paling jelas.`,
        sub || (anchorNode ? anchorNode.sql : ''),
        sub ? `JOIN (\n  ${sub.replace(/^SELECT/i, 'SELECT DISTINCT')}\n) sub ON sub.<kunci> = ${(block.correlatedCols || [])[0] || '<kolom_luar>'}` : ''));
    }
    return out;
  }
};

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
