// What the editor knows about the connected database: table names, and the
// columns of the tables the query actually mentions.
//
// The cache lives here, in module scope, because the editor is re-created
// whenever the Query tab re-renders — a cache inside the component would be
// thrown away between keystrokes and re-fetch the same columns forever.

const COLUMNS = new Map(); // `${connectionId}|${table}` -> string[]
const PENDING = new Set();

export function columnsKey(connectionId, table) {
  return `${connectionId}|${String(table).toLowerCase()}`;
}

export function getColumns(connectionId, table) {
  return COLUMNS.get(columnsKey(connectionId, table)) || null;
}

export function putColumns(connectionId, table, columns) {
  COLUMNS.set(columnsKey(connectionId, table), columns);
  return columns;
}

/** Guards against firing the same column request twice while one is in flight. */
export function claimFetch(key) {
  if (PENDING.has(key)) return false;
  PENDING.add(key);
  return true;
}
export function releaseFetch(key) {
  PENDING.delete(key);
}

export function forgetConnection(connectionId) {
  for (const key of [...COLUMNS.keys()]) {
    if (key.startsWith(`${connectionId}|`)) COLUMNS.delete(key);
  }
}

/** Test seam. */
export function clearSchemaCache() {
  COLUMNS.clear();
  PENDING.clear();
}

const SQL_TABLE_REFS = /\b(?:from|join|update|into|table)\s+([`"\[]?[A-Za-z_][\w$]*[`"\]]?(?:\s*\.\s*[`"\[]?[A-Za-z_][\w$]*[`"\]]?)?)/gi;
const MONGO_COLLECTION_REF = /\bdb\s*\.\s*(?:getCollection\(\s*['"]([^'"]+)['"]\s*\)|([A-Za-z_][\w$]*))/g;

/**
 * The tables a query text refers to. Used to decide whose columns are worth
 * fetching — pulling every column of every table would be a lot of round trips
 * for suggestions nobody asked for.
 */
export function referencedTables(text, engine = 'sql') {
  const out = new Set();
  const src = String(text || '');
  if (engine === 'mongo') {
    for (const m of src.matchAll(MONGO_COLLECTION_REF)) {
      const name = m[1] || m[2];
      if (name) out.add(name);
    }
    return [...out];
  }
  for (const m of src.matchAll(SQL_TABLE_REFS)) {
    const raw = m[1].replace(/[`"\[\]]/g, '').trim();
    // `shop.orders` → the catalog lookups all key on the bare name.
    const bare = raw.split('.').pop().trim();
    if (bare) out.add(bare);
  }
  return [...out];
}

/**
 * Is the caret inside a string literal or a comment? Completing there is worse
 * than useless: accepting a suggestion rewrites the contents of a literal, so
 * `WHERE nama = 'kolom` would silently become a different query.
 */
export function isInsideLiteral(text, caret) {
  const src = String(text || '').slice(0, caret);
  let state = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (state === 'line') {
      if (c === '\n') state = null;
    } else if (state === 'block') {
      if (c === '*' && next === '/') { state = null; i++; }
    } else if (state === 'single') {
      if (c === '\\') i++;
      else if (c === "'") { if (next === "'") i++; else state = null; }
    } else if (state === 'double') {
      if (c === '"') { if (next === '"') i++; else state = null; }
    } else if (state === 'backtick') {
      if (c === '`') state = null;
    } else if (c === '-' && next === '-') { state = 'line'; i++; }
    else if (c === '#') state = 'line';
    else if (c === '/' && next === '*') { state = 'block'; i++; }
    else if (c === "'") state = 'single';
    else if (c === '"') state = 'double';
    else if (c === '`') state = 'backtick';
  }
  // A quoted identifier is a name, so completing inside `` ` `` or `"` is fine;
  // strings and comments are not.
  return state === 'single' || state === 'line' || state === 'block';
}

/**
 * The word being typed right before the caret, if any.
 *
 * A bare `o.` counts too, with an empty word: typing the dot is exactly when
 * people expect to see that table's columns, and waiting for one more keystroke
 * makes the whole feature feel broken.
 */
export function currentWord(text, caret) {
  const before = String(text || '').slice(0, caret);

  const m = /([A-Za-z_][\w$]*)$/.exec(before);
  if (!m) {
    const afterDot = /([A-Za-z_][\w$]*)\s*\.\s*$/.exec(before);
    if (afterDot) return { word: '', start: caret, qualifier: afterDot[1] };
    return null;
  }

  // `o.` or `orders.` before the word means "columns of that table only".
  const qualifier = /([A-Za-z_][\w$]*)\s*\.\s*[A-Za-z_][\w$]*$/.exec(before);
  return {
    word: m[1],
    start: caret - m[1].length,
    qualifier: qualifier ? qualifier[1] : null
  };
}

/** alias → table, so `o.` can suggest the columns of `orders`. */
export function aliasMap(text) {
  const out = new Map();
  const re = /\b(?:from|join|update|into)\s+([`"\[]?[A-Za-z_][\w$.]*[`"\]]?)\s+(?:as\s+)?([A-Za-z_][\w$]*)/gi;
  for (const m of String(text || '').matchAll(re)) {
    const table = m[1].replace(/[`"\[\]]/g, '').split('.').pop();
    const alias = m[2];
    // `FROM orders WHERE` — "where" is a keyword, not an alias.
    if (/^(where|join|inner|left|right|full|outer|cross|on|set|values|group|order|limit|having|union|using|select)$/i.test(alias)) continue;
    out.set(alias.toLowerCase(), table);
  }
  return out;
}

/**
 * Ranked completions for what is being typed.
 * @param {{word: string, qualifier: string|null}} at
 * @param {{tables: string[], columnsByTable: Map<string, string[]>|object}} schema
 */
export function suggest(at, schema, { limit = 8, force = false } = {}) {
  if (!at) return [];
  // With no prefix typed, only two things justify a popup: a qualifier (`o.`,
  // where the list is short and obviously wanted) or an explicit request.
  // Otherwise every keystroke would throw the whole schema on screen.
  if (!at.word && !at.qualifier && !force) return [];
  const needle = (at.word || '').toLowerCase();
  const tables = schema.tables || [];
  const byTable = schema.columnsByTable instanceof Map
    ? schema.columnsByTable
    : new Map(Object.entries(schema.columnsByTable || {}));

  const items = [];
  const seen = new Set();
  const push = (label, kind, detail) => {
    const key = `${kind}:${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ label, kind, detail });
  };

  // A qualified word (`o.stat`) can only be a column of that one table.
  if (at.qualifier) {
    const table = at.qualifierTable || at.qualifier;
    for (const col of byTable.get(String(table).toLowerCase()) || []) {
      if (col.toLowerCase().startsWith(needle)) push(col, 'column', table);
    }
    return rank(items, needle, limit);
  }

  // Ctrl+Space with nothing typed means "what can go here?" — at that point a
  // name is almost always a table. Mixing in every cached column would bury
  // them. Type a letter, or qualify with `o.`, to reach columns.
  if (needle) {
    for (const [table, cols] of byTable) {
      for (const col of cols) {
        if (col.toLowerCase().startsWith(needle)) push(col, 'column', table);
      }
    }
  }
  for (const t of tables) {
    if (String(t).toLowerCase().startsWith(needle)) push(t, 'table', '');
  }
  return rank(items, needle, limit);
}

/** Exact prefix first, then shortest — the closest match should be first. */
function rank(items, needle, limit) {
  return items
    .sort((a, b) => {
      const exact = (x) => (x.label.toLowerCase() === needle ? 0 : 1);
      return exact(a) - exact(b) || a.label.length - b.label.length || a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}
