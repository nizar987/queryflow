// SQL pretty-printing, via sql-formatter.
//
// Formatting is not cosmetic here: a pasted one-liner from a log is exactly the
// query you most need to read, and re-indenting it by hand is the tax that
// stops people from reading it at all.
import { format } from 'sql-formatter';

/** sql-formatter's dialect names for the dialects QueryFlow speaks. */
const LANGUAGE = {
  MariaDB: 'mariadb',
  MySQL: 'mysql',
  PostgreSQL: 'postgresql'
};

export function canFormat(dialect) {
  return Object.prototype.hasOwnProperty.call(LANGUAGE, dialect);
}

/**
 * @returns {{ok: true, text: string} | {ok: false, error: string}}
 */
export function formatQuery(text, dialect = 'MariaDB') {
  const src = String(text || '');
  if (!src.trim()) return { ok: false, error: 'Editor masih kosong.' };
  if (!canFormat(dialect)) {
    return { ok: false, error: `Format otomatis belum tersedia untuk ${dialect}.` };
  }
  try {
    return {
      ok: true,
      text: format(src, {
        language: LANGUAGE[dialect],
        keywordCase: 'upper',
        // Two spaces matches what the editor inserts on Tab.
        tabWidth: 2,
        linesBetweenQueries: 1
      })
    };
  } catch (e) {
    // A query too broken to parse is common while typing — say so plainly
    // rather than throwing away what the user has written.
    return { ok: false, error: `Tidak bisa diformat: ${e.message.split('\n')[0]}` };
  }
}
