// Identifier handling for the table browser.
//
// Table and column names arrive from the browser, and they cannot be sent as
// bound parameters — SQL only binds *values*, never identifiers. So every name
// is validated against a strict allowlist and then quoted for its engine.
// Values always go through real parameter binding.

const IDENT = /^[A-Za-z_][\w$]*$/;
// Some schemas genuinely use spaces, dashes or dots in table names.
const LOOSE_IDENT = /^[\w$\-. ]+$/;

/** @throws when the name could not be safely embedded in SQL. */
export function assertIdent(name, what = 'Nama tabel') {
  const s = String(name || '');
  if (!s || s.length > 128 || !LOOSE_IDENT.test(s)) {
    throw Object.assign(new Error(`${what} tidak valid: ${JSON.stringify(s)}`), { expected: true });
  }
  return s;
}

/** Column names are stricter — they also appear in SET/ORDER BY clauses. */
export function assertColumn(name) {
  const s = String(name || '');
  if (!s || s.length > 128 || !(IDENT.test(s) || LOOSE_IDENT.test(s))) {
    throw Object.assign(new Error(`Nama kolom tidak valid: ${JSON.stringify(s)}`), { expected: true });
  }
  return s;
}

/** Backtick quoting (MySQL / MariaDB). */
export const qMy = (name) => '`' + String(name).replace(/`/g, '``') + '`';

/** Double-quote quoting (PostgreSQL). */
export const qPg = (name) => '"' + String(name).replace(/"/g, '""') + '"';

/**
 * A row is addressable only if the caller supplied a value for every primary
 * key column. Editing without that could rewrite more rows than intended.
 */
export function assertKeyComplete(primaryKey, keyValues) {
  if (!Array.isArray(primaryKey) || primaryKey.length === 0) {
    throw Object.assign(
      new Error('Tabel ini tidak punya primary key, jadi baris tidak bisa dialamatkan dengan aman.'),
      { expected: true }
    );
  }
  const missing = primaryKey.filter((c) => !(c in (keyValues || {})));
  if (missing.length) {
    throw Object.assign(
      new Error(`Nilai primary key belum lengkap: ${missing.join(', ')}.`),
      { expected: true }
    );
  }
}

/** Guard against a write that would touch anything other than one row. */
export function assertSingleRow(affected) {
  if (affected === 1) return;
  const err = new Error(
    affected === 0
      ? 'Tidak ada baris yang cocok — mungkin sudah diubah atau dihapus orang lain. Muat ulang dulu.'
      : `Perintah ini akan mengenai ${affected} baris, bukan 1. Dibatalkan.`
  );
  err.expected = true;
  throw err;
}
