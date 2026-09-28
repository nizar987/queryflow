// Compare the indexes a query *asks for* with the ones a database actually
// has. Without this, the advisor keeps recommending an index that has existed
// for two years, and every real suggestion drowns in that noise.

/** Names come from three places (parser, catalog, user) — compare them fairly. */
function norm(name) {
  return String(name || '')
    .replace(/[`"']/g, '')
    .trim()
    .toLowerCase();
}

const tableKey = (t) => norm(String(t).split('.').pop());

/**
 * Suggestions describe a column as `{ column, role }` and the catalog as
 * `{ name, dir }` — one accessor so a mismatch cannot make every index look
 * missing.
 */
const colName = (c) => (c && (c.column ?? c.name)) || '';

/** An index serves a query only if it matches from its *first* column onward. */
function prefixLength(existingCols, wantedCols) {
  let n = 0;
  while (n < existingCols.length && n < wantedCols.length && norm(colName(existingCols[n])) === norm(colName(wantedCols[n]))) {
    n++;
  }
  return n;
}

/**
 * @param {Array} suggestions from optimize().indexes
 * @param {Array} existing from the listIndexes driver call
 * @returns {Array} the same suggestions, each with `status` and `matches`
 */
export function annotateSuggestions(suggestions, existing) {
  const byTable = new Map();
  for (const idx of existing) {
    const k = tableKey(idx.table);
    if (!byTable.has(k)) byTable.set(k, []);
    byTable.get(k).push(idx);
  }

  return suggestions.map((s) => {
    const candidates = byTable.get(tableKey(s.table)) || [];
    const wanted = s.columns || [];

    const scored = candidates
      .map((idx) => ({ index: idx, prefix: prefixLength(idx.columns || [], wanted) }))
      .filter((m) => m.prefix > 0)
      .sort((a, b) => b.prefix - a.prefix);

    const best = scored[0] || null;

    let status = 'missing';
    if (best && best.prefix >= wanted.length) {
      // Every column the query wants is already covered, in order. Extra
      // trailing columns on the existing index do not hurt.
      status = 'covered';
    } else if (best) {
      status = 'partial';
    }

    return {
      ...s,
      status,
      // The leading column is what decides whether an index is usable at all,
      // so "partial" is worth showing rather than reporting a flat "missing".
      matches: scored.slice(0, 3).map((m) => ({
        name: m.index.name,
        table: m.index.table,
        unique: !!m.index.unique,
        primary: !!m.index.primary,
        columns: (m.index.columns || []).map((c) => c.name),
        covers: m.prefix,
        of: wanted.length
      }))
    };
  });
}

/**
 * Indexes that earn nothing: one whose columns are a leading prefix of another
 * is already served by that other index, and still costs writes and disk.
 * Only exact-prefix pairs are reported — anything cleverer would need to know
 * selectivity, which this cannot see.
 */
export function findRedundant(existing) {
  const out = [];
  const seen = new Set();
  const byTable = new Map();
  for (const idx of existing) {
    const k = tableKey(idx.table);
    if (!byTable.has(k)) byTable.set(k, []);
    byTable.get(k).push(idx);
  }

  for (const list of byTable.values()) {
    // Exact duplicates shadow each other in both directions. Reporting both
    // would read as "drop both" and leave the table with no index at all, so
    // one survivor is chosen and only the others are listed.
    for (const group of duplicateGroups(list)) {
      const survivor = group[0];
      for (const dup of group.slice(1)) {
        seen.add(`${dup.table}.${dup.name}`);
        out.push(entry(dup, survivor, true));
      }
    }

    for (const a of list) {
      // A primary key is never redundant: it enforces a constraint, not just
      // lookup speed, and dropping it would change what the table allows.
      if (a.primary) continue;
      if (seen.has(`${a.table}.${a.name}`)) continue;
      const acols = a.columns || [];
      if (acols.length === 0) continue;

      for (const b of list) {
        if (b === a || b.name === a.name) continue;
        const bcols = b.columns || [];
        // Strictly shorter only — equal length was already handled above.
        if (acols.length >= bcols.length) continue;
        if (!acols.every((c, i) => norm(colName(c)) === norm(colName(bcols[i])))) continue;
        // A unique index constrains data; a wider index does not replace it.
        if (a.unique) continue;
        seen.add(`${a.table}.${a.name}`);
        out.push(entry(a, b, false));
        break;
      }
    }
  }
  return out;
}

/** Indexes on identical column lists, grouped, survivor first. */
function duplicateGroups(list) {
  const groups = new Map();
  for (const idx of list) {
    const cols = idx.columns || [];
    if (cols.length === 0) continue;
    const key = cols.map((c) => norm(colName(c))).join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(idx);
  }

  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) =>
      // Keep the one that carries a constraint, then the oldest-looking name,
      // so the same list is produced no matter what order the catalog returned.
      [...g].sort((x, y) => {
        const weight = (i) => (i.primary ? 0 : i.unique ? 1 : 2);
        return weight(x) - weight(y) || String(x.name).localeCompare(String(y.name));
      })
    );
}

function entry(index, coveredBy, duplicate) {
  return {
    table: index.table,
    name: index.name,
    columns: (index.columns || []).map((c) => colName(c)),
    coveredBy: coveredBy.name,
    coveredByColumns: (coveredBy.columns || []).map((c) => colName(c)),
    duplicate
  };
}

/** Which tables to ask the database about, given a set of suggestions. */
export function tablesOf(suggestions) {
  return [...new Set((suggestions || []).map((s) => String(s.table || '').trim()).filter(Boolean))];
}
