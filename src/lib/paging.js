// Next / previous page, driven by the query's own LIMIT.
//
// The page size is whatever the user wrote; only the offset moves. The
// rewrite touches the outermost trailing LIMIT clause and nothing else — a
// `LIMIT 1` inside a subquery is part of the query's meaning, not its paging,
// and text inside strings or comments is not SQL at all.
//
// Only plain reads are paged: re-running a write to "see the next page" would
// write again, and a locking read would take new locks on every click.
import { classifyStatement, splitBatch } from './statement.js';

const MYSQL_FAMILY = new Set(['MySQL', 'MariaDB']);

/**
 * Words outside strings, quoted identifiers and comments, with their paren depth.
 * @param {string} text
 * @param {string} dialect
 * @returns {{ word: string, pos: number, depth: number }[]}
 */
function sqlWords(text, dialect) {
  const postgres = dialect === 'PostgreSQL';
  const mysqlFamily = MYSQL_FAMILY.has(dialect);
  const words = [];
  const n = text.length;
  let depth = 0;
  let i = 0;

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if ((c === '-' && next === '-') || (c === '#' && !postgres)) {
      const end = text.indexOf('\n', i);
      i = end < 0 ? n : end + 1;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const escapes = c === "'" && (!postgres || (i > 0 && (text[i - 1] === 'e' || text[i - 1] === 'E')));
      i = skipQuoted(text, i, c, escapes);
    } else if (c === '$' && !mysqlFamily && /^\$[A-Za-z_0-9]*\$/.test(text.slice(i, i + 64))) {
      const tag = /** @type {RegExpExecArray} */ (/^\$[A-Za-z_0-9]*\$/.exec(text.slice(i, i + 64)))[0];
      const end = text.indexOf(tag, i + tag.length);
      i = end < 0 ? n : end + tag.length;
    } else if (c === '(') {
      depth++;
      i++;
    } else if (c === ')') {
      depth--;
      i++;
    } else if (/[A-Za-z_]/.test(c) && (i === 0 || !/[A-Za-z0-9_$]/.test(text[i - 1]))) {
      const word = /** @type {RegExpExecArray} */ (/^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(i, i + 128)))[0];
      words.push({ word: word.toUpperCase(), pos: i, depth });
      i += word.length;
    } else {
      i++;
    }
  }
  return words;
}

/**
 * Index just past the closing quote (a doubled quote stays inside).
 * @param {string} text @param {number} start @param {string} quote @param {boolean} escapes
 */
function skipQuoted(text, start, quote, escapes) {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (escapes && c === '\\') i += 2;
    else if (c === quote && text[i + 1] === quote) i += 2;
    else if (c === quote) return i + 1;
    else i++;
  }
  return text.length;
}

/**
 * What may follow the paging clause: whitespace, comments, one semicolon.
 * @param {string} rest @param {string} dialect
 */
function trailingOk(rest, dialect) {
  const comment = dialect === 'PostgreSQL' ? String.raw`--[^\n]*|\/\*[\s\S]*?\*\/` : String.raw`--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/`;
  return new RegExp(String.raw`^\s*(?:(?:${comment})\s*)*;?\s*(?:(?:${comment})\s*)*$`).test(rest);
}

/**
 * @typedef {{ limit: number, offset: number, start: number, end: number, form: 'limit'|'comma'|'offset-first'|'mongo', lower: boolean, skip?: {start: number, end: number} | null }} Located
 */

/** @param {string} dialect @param {string} text @returns {Located | null} */
function locateSql(dialect, text) {
  const top = sqlWords(text, dialect).filter((w) => w.depth === 0);
  let li = -1;
  for (let k = top.length - 1; k >= 0; k--) if (top[k].word === 'LIMIT') { li = k; break; }
  if (li < 0) return null;

  let start = top[li].pos;
  const prev = top[li - 1];
  const offsetFirst =
    dialect === 'PostgreSQL' && prev && prev.word === 'OFFSET' && /^OFFSET\s+\d+\s+$/i.test(text.slice(prev.pos, start));
  if (offsetFirst) start = prev.pos;

  const tail = text.slice(start);
  /** @type {RegExpExecArray | null} */
  let m = null;
  /** @type {Located['form']} */
  let form = 'limit';
  let limit = 0;
  let offset = 0;
  if (offsetFirst && (m = /^OFFSET\s+(\d+)\s+LIMIT\s+(\d+)/i.exec(tail))) {
    form = 'offset-first';
    offset = Number(m[1]);
    limit = Number(m[2]);
  } else if (MYSQL_FAMILY.has(dialect) && (m = /^LIMIT\s+(\d+)\s*,\s*(\d+)/i.exec(tail))) {
    form = 'comma';
    offset = Number(m[1]);
    limit = Number(m[2]);
  } else if ((m = /^LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?/i.exec(tail))) {
    form = 'limit';
    limit = Number(m[1]);
    offset = m[2] ? Number(m[2]) : 0;
  }
  if (!m || !(limit > 0) || !trailingOk(tail.slice(m[0].length), dialect)) return null;
  return { limit, offset, start, end: start + m[0].length, form, lower: text[start] === text[start].toLowerCase() };
}

/**
 * Top-level `.name(` calls of a mongo shell command, outside strings and comments.
 * @param {string} text
 * @returns {{ name: string, pos: number, end: number, num: number | null }[]}
 */
function mongoCalls(text) {
  const calls = [];
  const n = text.length;
  let depth = 0;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? n : end + 1;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      i = skipQuoted(text, i, c, true);
    } else if (c === '(' || c === '[' || c === '{') {
      depth++;
      i++;
    } else if (c === ')' || c === ']' || c === '}') {
      depth--;
      i++;
    } else if (c === '.' && depth === 0) {
      const call = /^\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(text.slice(i, i + 64));
      if (call) {
        const num = /^\.\s*[A-Za-z_$][\w$]*\s*\(\s*(\d+)\s*\)/.exec(text.slice(i, i + 64));
        calls.push({ name: call[1], pos: i, end: num ? i + num[0].length : -1, num: num ? Number(num[1]) : null });
      }
      i++;
    } else {
      i++;
    }
  }
  return calls;
}

/** @param {string} text @returns {Located | null} */
function locateMongo(text) {
  const calls = mongoCalls(text);
  if (!calls.length || calls[0].name !== 'find') return null;
  const limit = calls.find((c) => c.name === 'limit');
  const skip = calls.find((c) => c.name === 'skip');
  if (!limit || !(limit.num && limit.num > 0)) return null;
  if (skip && skip.num == null) return null;
  return {
    limit: limit.num,
    offset: skip && skip.num != null ? skip.num : 0,
    start: limit.pos,
    end: limit.end,
    form: 'mongo',
    lower: true,
    skip: skip ? { start: skip.pos, end: skip.end } : null
  };
}

/** @param {string} dialect @param {string} text @returns {Located | null} */
function locate(dialect, text) {
  const src = String(text || '');
  // A script pages per statement, from its own result tab.
  if (splitBatch(dialect, src).length !== 1) return null;
  const c = classifyStatement(dialect, src);
  if (c.write || c.locking) return null;
  return dialect === 'MongoDB' ? locateMongo(src) : locateSql(dialect, src);
}

/**
 * The page this statement asks for, or null when it cannot be paged.
 * @param {string} dialect
 * @param {string} text
 * @returns {{ limit: number, offset: number } | null}
 */
export function readPaging(dialect, text) {
  const loc = locate(dialect, text);
  return loc ? { limit: loc.limit, offset: loc.offset } : null;
}

/**
 * The same statement asking for rows from `offset`. Null when it cannot be paged.
 * @param {string} dialect
 * @param {string} text
 * @param {number} offset
 * @returns {string | null}
 */
export function withOffset(dialect, text, offset) {
  const loc = locate(dialect, text);
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  if (!loc) return null;

  if (loc.form === 'mongo') {
    if (loc.skip) return text.slice(0, loc.skip.start) + `.skip(${off})` + text.slice(loc.skip.end);
    return text.slice(0, loc.end) + `.skip(${off})` + text.slice(loc.end);
  }

  const k = (/** @type {string} */ w) => (loc.lower ? w.toLowerCase() : w);
  const clause =
    loc.form === 'comma'
      ? `${k('LIMIT')} ${off}, ${loc.limit}`
      : loc.form === 'offset-first'
        ? `${k('OFFSET')} ${off} ${k('LIMIT')} ${loc.limit}`
        : `${k('LIMIT')} ${loc.limit} ${k('OFFSET')} ${off}`;
  return text.slice(0, loc.start) + clause + text.slice(loc.end);
}
