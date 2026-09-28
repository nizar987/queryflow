// Does this statement write? One implementation, shared by the server (which
// enforces read-only connections) and the browser (which asks for confirmation
// before a write). Two copies of this rule would eventually disagree, and the
// disagreement would show up as "the UI promised it was safe".
//
// The bias is deliberate: anything this file cannot prove is a read counts as a
// write. A false "are you sure?" costs a click; a false "safe" costs data.

/** Leading comments and whitespace hide the real first keyword. */
function stripLead(text) {
  let s = String(text || '');
  let prev;
  do {
    prev = s;
    s = s.replace(/^\s+/, '').replace(/^--[^\n]*\n?/, '').replace(/^#[^\n]*\n?/, '').replace(/^\/\*[\s\S]*?\*\//, '');
  } while (s !== prev);
  return s;
}

/** Comments are also where a `WHERE` can hide, so strip them everywhere. */
function stripComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/(^|\s)#[^\n]*/g, ' ');
}

const READ_COMMANDS = new Set([
  'SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'TABLE', 'VALUES', 'USE'
]);

// Statements whose damage cannot be undone by fixing a WHERE clause afterwards.
const DESTRUCTIVE = new Set(['DROP', 'TRUNCATE', 'ALTER', 'RENAME', 'GRANT', 'REVOKE', 'CREATE']);

/** A CTE (or a MySQL multi-table form) can carry a write inside a SELECT-looking statement. */
const WRITE_INSIDE = /\b(insert\s+into|insert\s+ignore|update\s+[^\s;]+\s+set|delete\s+from|merge\s+into|replace\s+into)\b/i;

/** SELECT that takes row locks. A read, but not one to run against production by accident. */
const LOCKING = /\bfor\s+(update|share|no\s+key\s+update|key\s+share)\b|\block\s+in\s+share\s+mode\b/i;

/** SELECT … INTO OUTFILE / INTO a new table writes despite starting with SELECT. */
const SELECT_INTO = /\binto\s+(outfile|dumpfile)\b|\binto\s+(?!\s)(?:strict\s+)?[a-z_"`][\w".`]*\s+from\b/i;

const MONGO_WRITE_METHODS = new Set([
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'replaceOne',
  'deleteOne', 'deleteMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'bulkWrite', 'createIndex', 'dropIndex', 'drop', 'renameCollection', 'insert', 'update', 'remove', 'save'
]);

const MONGO_DESTRUCTIVE = new Set(['drop', 'dropIndex', 'renameCollection']);

/**
 * @typedef {object} Classification
 * @property {'sql'|'mongo'} engine
 * @property {string} command      What it is, in the user's terms ("UPDATE", "db.orders.deleteMany")
 * @property {boolean} write       Modifies data or schema — blocked on read-only connections
 * @property {boolean} locking     Read that takes locks (SELECT … FOR UPDATE)
 * @property {boolean} unfiltered  Write with no WHERE / an empty filter — hits every row
 * @property {boolean} destructive DDL or an irreversible drop
 * @property {string} label        One line describing the risk, ready to show
 */

/** @returns {Classification} */
export function classifyStatement(dialect, text) {
  return dialect === 'MongoDB' ? classifyMongo(text) : classifySql(text, dialect);
}

/**
 * Split on statement boundaries, ignoring semicolons inside strings, quoted
 * identifiers, comments, and PostgreSQL dollar-quoted bodies.
 *
 * This is not decoration. node-postgres sends a parameterless query over the
 * simple query protocol, which happily runs `SELECT 1; DROP TABLE x` as two
 * statements — so judging a query by its first keyword alone let a write
 * through on a connection marked read-only.
 */
const MYSQL_FAMILY = new Set(['MySQL', 'MariaDB']);

/**
 * @param {string} text
 * @param {string} [dialect] Without one, every quoting rule applies at once —
 *   the most conservative reading, and what callers got before this knew dialects.
 * @returns {string[]} raw chunks, delimiters removed; comment-only chunks dropped
 */
export function splitStatements(text, dialect) {
  const src = String(text || '');
  const mysqlFamily = MYSQL_FAMILY.has(dialect || '');
  const postgres = dialect === 'PostgreSQL';
  // `#` starts a comment in MySQL but is an operator in PostgreSQL (`#>`, XOR).
  const hashComments = !postgres;
  // `$$ … $$` quotes a body in PostgreSQL; in MySQL it is just two characters.
  const dollarQuotes = !mysqlFamily;

  /** @type {string[]} */
  const out = [];
  let start = 0;
  let i = 0;
  /** @type {null | {kind: string, tag?: string, escapes?: boolean}} */
  let inside = null;
  // Whether the current chunk has anything besides whitespace and comments.
  let hasCode = false;
  let delimiter = ';';

  const push = (end) => {
    if (hasCode) out.push(src.slice(start, end));
    hasCode = false;
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (inside) {
      if (inside.kind === 'line' && c === '\n') inside = null;
      else if (inside.kind === 'block' && c === '*' && next === '/') { inside = null; i++; }
      else if (inside.kind === 'single' && c === '\\' && inside.escapes) i++;
      else if (inside.kind === 'single' && c === "'") { if (next === "'") i++; else inside = null; }
      else if (inside.kind === 'double' && c === '"') { if (next === '"') i++; else inside = null; }
      else if (inside.kind === 'backtick' && c === '`') inside = null;
      else if (inside.kind === 'dollar' && c === '$' && inside.tag && src.startsWith(inside.tag, i)) {
        i += inside.tag.length - 1;
        inside = null;
      }
      i++;
      continue;
    }

    // The mysql client's DELIMITER directive, so a procedure body full of
    // semicolons can be sent whole. It is client syntax: never sent to the server.
    if (mysqlFamily && !hasCode && (c === 'd' || c === 'D')) {
      const m = /^delimiter[ \t]+(\S+)[^\n]*/i.exec(src.slice(i, i + 200));
      if (m) {
        delimiter = m[1];
        i += m[0].length;
        start = i;
        continue;
      }
    }

    if (src.startsWith(delimiter, i)) {
      push(i);
      i += delimiter.length;
      start = i;
      continue;
    }

    if (c === '-' && next === '-') inside = { kind: 'line' };
    else if (c === '#' && hashComments) inside = { kind: 'line' };
    else if (c === '/' && next === '*') { inside = { kind: 'block' }; i++; }
    else if (c === "'") {
      // MySQL escapes with a backslash everywhere; PostgreSQL only in E'…'.
      const escapes = postgres ? /(^|[^A-Za-z0-9_])[eE]$/.test(src.slice(Math.max(0, i - 2), i)) : true;
      inside = { kind: 'single', escapes };
      hasCode = true;
    } else if (c === '"') { inside = { kind: 'double' }; hasCode = true; }
    else if (c === '`') { inside = { kind: 'backtick' }; hasCode = true; }
    else if (c === '$' && dollarQuotes && /^\$[A-Za-z_0-9]*\$/.test(src.slice(i, i + 64))) {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(src.slice(i, i + 64));
      inside = { kind: 'dollar', tag: tag ? tag[0] : '$$' };
      i += (tag ? tag[0].length : 2) - 1;
      hasCode = true;
    } else if (!/\s/.test(c)) hasCode = true;
    i++;
  }

  push(src.length);
  return out;
}

/**
 * Split a MongoDB shell script into commands: at `;`, or at a new line that
 * starts another `db.` command, but never inside brackets, strings or comments
 * — so a multi-line find(…).sort(…) stays one command.
 * @param {string} text
 * @returns {string[]}
 */
export function splitMongo(text) {
  const src = String(text || '');
  /** @type {string[]} */
  const out = [];
  let start = 0;
  let i = 0;
  let depth = 0;
  /** @type {null | string} */
  let inside = null;
  let hasCode = false;

  const push = (end) => {
    if (hasCode) out.push(src.slice(start, end).trim());
    hasCode = false;
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    if (inside) {
      if (inside === 'line') {
        // Hand the newline back to the main loop — it may start a new command.
        if (c === '\n') { inside = null; continue; }
      } else if (inside === 'block') {
        if (c === '*' && next === '/') { inside = null; i++; }
      } else if (c === '\\') i++;
      else if (c === inside) inside = null;
      i++;
      continue;
    }

    if (c === '/' && next === '/') { inside = 'line'; i += 2; continue; }
    if (c === '/' && next === '*') { inside = 'block'; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inside = c; hasCode = true; i++; continue; }

    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === ';' || (c === '\n' && hasCode && /^\s*db\s*\./.test(src.slice(i + 1, i + 64))))) {
      push(i);
      i++;
      start = i;
      continue;
    }

    if (!/\s/.test(c)) hasCode = true;
    i++;
  }

  push(src.length);
  return out;
}

/**
 * The statements a script will run as, in order and trimmed. The executor and
 * the classifier both use this, so what is judged is exactly what is run.
 * @param {string} dialect
 * @param {string} text
 * @returns {string[]}
 */
export function splitBatch(dialect, text) {
  if (dialect === 'MongoDB') return splitMongo(text);
  return splitStatements(text, dialect).map((s) => s.trim());
}

/**
 * @param {string} text
 * @param {string} [dialect]
 * @returns {Classification}
 */
function classifySql(text, dialect) {
  const parts = splitStatements(text, dialect);
  if (parts.length <= 1) return classifyOneSql(parts[0] ?? text, dialect);
  return classifyBatch(parts.map((p) => classifyOneSql(p, dialect)));
}

function classifyMongo(text) {
  const parts = splitMongo(text);
  if (parts.length <= 1) return classifyOneMongo(parts[0] ?? text);
  return classifyBatch(parts.map(classifyOneMongo));
}

/** A batch is exactly as dangerous as its worst statement. */
function classifyBatch(all) {
  const worst = pickWorst(all);
  const writes = all.filter((c) => c.write);
  return {
    ...worst,
    statements: all.length,
    label:
      writes.length > 0
        ? `${all.length} statement sekaligus, ${writes.length} di antaranya menulis (${writes.map((c) => c.command).join(', ')})`
        : `${all.length} statement sekaligus`
  };
}

/** Destructive beats unfiltered beats any write beats a lock beats a read. */
function pickWorst(list) {
  const rank = (c) => (c.destructive ? 4 : c.unfiltered ? 3 : c.write ? 2 : c.locking ? 1 : 0);
  return list.reduce((best, c) => (rank(c) > rank(best) ? c : best), list[0]);
}

/**
 * @param {string} text
 * @param {string} [dialect]
 * @returns {Classification}
 */
function classifyOneSql(text, dialect) {
  const body = stripComments(text);
  const head = stripLead(body);
  const first = (/^([a-zA-Z]+)/.exec(head) || [, ''])[1].toUpperCase();

  // EXPLAIN only plans — unless it is EXPLAIN ANALYZE, which really runs the
  // statement, writes included.
  if (first === 'EXPLAIN' || first === 'DESCRIBE' || first === 'DESC') {
    const rest = head.replace(/^(explain|describe|desc)\b/i, '').trim();
    if (/^analyze\b/i.test(rest)) {
      const inner = classifySql(rest.replace(/^analyze\b/i, ''), dialect);
      return { ...inner, command: `EXPLAIN ANALYZE ${inner.command}`, label: `EXPLAIN ANALYZE menjalankan ${inner.command} sungguhan` };
    }
    return read('EXPLAIN');
  }

  if (!first) return write('(kosong)', { label: 'Statement kosong' });

  if (READ_COMMANDS.has(first)) {
    // A CTE may end in INSERT/UPDATE/DELETE, and MySQL's SELECT … INTO writes.
    if (WRITE_INSIDE.test(head) || SELECT_INTO.test(head)) {
      const inner = (WRITE_INSIDE.exec(head) || [''])[0].split(/\s+/)[0].toUpperCase() || first;
      return write(inner, {
        unfiltered: isUnfilteredSql(head, inner),
        label: `${first} yang berisi ${inner} — tetap menulis ke database`
      });
    }
    if (LOCKING.test(head)) {
      return { engine: 'sql', command: first, write: false, locking: true, unfiltered: false, destructive: false,
        label: `${first} … FOR UPDATE mengunci baris yang dibacanya` };
    }
    return read(first);
  }

  const destructive = DESTRUCTIVE.has(first);
  const unfiltered = isUnfilteredSql(head, first);
  return write(first, {
    destructive,
    unfiltered,
    label: destructive
      ? `${first} mengubah struktur database dan tidak bisa dibatalkan`
      : unfiltered
        ? `${first} tanpa WHERE — mengenai seluruh baris di tabel`
        : `${first} menulis ke database`
  });
}

function isUnfilteredSql(head, command) {
  if (command !== 'UPDATE' && command !== 'DELETE') return false;
  return !/\bwhere\b/i.test(head);
}

function classifyOneMongo(text) {
  const src = stripComments(text).trim();
  const m = /db\s*\.\s*(?:getCollection\(\s*['"]([^'"]+)['"]\s*\)|([A-Za-z0-9_$][A-Za-z0-9_$.]*))\s*\.\s*([A-Za-z0-9_$]+)\s*\(/.exec(src);
  if (!m) {
    return write('(tidak dikenali)', { label: 'Perintah tidak dikenali — diperlakukan sebagai penulisan' }, 'mongo');
  }

  const collection = m[1] || m[2];
  const method = m[3];
  const command = `db.${collection}.${method}`;

  // An aggregation is a read right up until its last stage says $out or $merge,
  // which replaces an entire collection.
  if (method === 'aggregate') {
    const stage = /\$(out|merge)\b/.exec(src);
    if (stage) {
      return write(command, { destructive: stage[1] === 'out',
        label: `aggregate dengan $${stage[1]} menulis hasilnya ke koleksi lain` }, 'mongo');
    }
    return read(command, 'mongo');
  }

  if (!MONGO_WRITE_METHODS.has(method)) return read(command, 'mongo');

  const destructive = MONGO_DESTRUCTIVE.has(method);
  const unfiltered = /(updateMany|deleteMany|remove)\s*\(\s*\{\s*\}/.test(src) || method === 'drop';
  return write(command, {
    destructive,
    unfiltered,
    label: destructive
      ? `${method}() menghapus koleksi/index dan tidak bisa dibatalkan`
      : unfiltered
        ? `${method}({}) dengan filter kosong — mengenai seluruh dokumen`
        : `${method}() menulis ke database`
  }, 'mongo');
}

/**
 * @param {string} command
 * @param {'sql'|'mongo'} [engine]
 * @returns {Classification}
 */
function read(command, engine = 'sql') {
  return { engine, command, write: false, locking: false, unfiltered: false, destructive: false, label: '' };
}

/**
 * @param {string} command
 * @param {Partial<Classification>} [extra]
 * @param {'sql'|'mongo'} [engine]
 * @returns {Classification}
 */
function write(command, extra = {}, engine = 'sql') {
  return {
    engine,
    command,
    write: true,
    locking: false,
    unfiltered: false,
    destructive: false,
    label: `${command} menulis ke database`,
    ...extra
  };
}

/** Why a read-only connection refused this statement, or '' when it is allowed. */
export function readOnlyViolation(dialect, text) {
  const c = classifyStatement(dialect, text);
  if (c.write) return `Koneksi ini ditandai read-only, dan ${c.command} menulis ke database.`;
  if (c.locking) return `Koneksi ini ditandai read-only, dan ${c.command} … FOR UPDATE mengunci baris.`;
  return '';
}
