// Parser wrapper over node-sql-parser, tuned for MySQL/MariaDB (PRD §4.2).
// Deterministic AST production — no LLM (PLAN §1.2).
import pkg from 'node-sql-parser';

const { Parser } = pkg;
const parser = new Parser();

const DEFAULT_OPT = { database: 'MariaDB' };

/**
 * Parse a raw SQL string into an AST.
 * @param {string} sql
 * @param {{dialect?: string}} [opts]
 * @returns {{ ok: boolean, ast?: object, statements?: object[], error?: string, location?: {line:number,column:number} }}
 */
export function parseSQL(sql, opts = {}) {
  const text = (sql || '').trim();
  if (!text) return { ok: false, error: 'Query kosong — tempel atau ketik SQL terlebih dahulu.' };

  const database = mapDialect(opts.dialect) || DEFAULT_OPT.database;
  const isMysqlFamily = database === 'MariaDB';
  try {
    const ast = parser.astify(text, { database });
    const statements = Array.isArray(ast) ? ast : [ast];
    return { ok: true, ast: statements[0], statements };
  } catch (err) {
    // Recovery pass: node-sql-parser over-reserves a few words that are common
    // Frappe/MariaDB column names (e.g. `status`). Auto-quote a curated, SAFE
    // allowlist (never structural keywords like GROUP/ORDER/LEFT) and retry.
    // Backtick quoting is MySQL/MariaDB-only — never apply it to Postgres.
    const relaxed = isMysqlFamily ? relaxReservedIdentifiers(text) : text;
    if (relaxed !== text) {
      try {
        const ast = parser.astify(relaxed, { database });
        const statements = Array.isArray(ast) ? ast : [ast];
        return { ok: true, ast: statements[0], statements, relaxed: true };
      } catch (_) {
        /* fall through to original error */
      }
    }
    const loc = err && err.location && err.location.start
      ? { line: err.location.start.line, column: err.location.start.column }
      : undefined;
    return { ok: false, error: humanizeError(err), location: loc };
  }
}

// Words node-sql-parser wrongly reserves that ARE common plain column identifiers.
// Deliberately excludes genuine SQL keywords (group, order, key, left, right, full, natural, end).
const OVER_RESERVED = ['status', 'show'];

function relaxReservedIdentifiers(sql) {
  let out = sql;
  for (const w of OVER_RESERVED) {
    // bare word, not already backticked, not a function call (not followed by "(")
    const re = new RegExp('(^|[^`\\w.])(' + w + ')(?![\\w`(])', 'gi');
    out = out.replace(re, (m, pre, word) => `${pre}\`${word}\``);
  }
  return out;
}

function mapDialect(d) {
  if (!d) return null;
  const k = String(d).toLowerCase();
  if (k === 'mariadb' || k === 'mysql') return 'MariaDB';
  if (k === 'postgres' || k === 'postgresql') return 'Postgresql';
  return 'MariaDB';
}

function humanizeError(err) {
  const msg = (err && err.message) || 'Parsing gagal.';
  // node-sql-parser messages are verbose; keep the first useful line.
  const firstLine = String(msg).split('\n')[0];
  return firstLine.length > 220 ? firstLine.slice(0, 217) + '…' : firstLine;
}

export const SUPPORTED_DIALECTS = ['MariaDB', 'MySQL', 'PostgreSQL'];
