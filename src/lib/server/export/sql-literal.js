// Values → SQL literals.
//
// This is the one place in QueryFlow where a value is written into SQL instead
// of bound as a parameter, because that is what a dump *is*: a file of
// statements. So every rule here is a correctness or a safety rule, and the
// tests pin them.
//
// Cells arrive in the grid's `{v, t}` shape — the value has already been
// through `encodeCell`, so Dates are ISO strings, Buffers are `0x…` hex, and
// BigInts are digit strings. The column's declared type is used where the type
// hint alone is not enough to round-trip (timestamps, most of all).

/** Quoted, escaped, and safe to paste into a MySQL/MariaDB script. */
export function myString(s) {
  // MySQL treats backslash as an escape character inside string literals by
  // default (NO_BACKSLASH_ESCAPES off), so a value containing `\` must double
  // it or the next character is silently swallowed.
  const body = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\0/g, '\\0')
    .replace(/\x1a/g, '\\Z');
  return `'${body}'`;
}

/** Quoted, escaped, and safe to paste into a PostgreSQL script. */
export function pgString(s) {
  const str = String(s).replace(/\0/g, '');
  const body = str.replace(/'/g, "''");
  // With standard_conforming_strings on (the default since 9.1) a backslash is
  // an ordinary character and `'a\b'` is correct. It can be turned off, and
  // then the same literal would eat the backslash — so anything containing one
  // is written as an explicit E'' literal, which means the same thing either way.
  if (!/\\/.test(str)) return `'${body}'`;
  return `E'${body.replace(/\\/g, '\\\\')}'`;
}

const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * One cell as a SQL literal.
 *
 * @param cell  {{v: any, t: string}} from `encodeCell`
 * @param opts.dialect     'MySQL' | 'MariaDB' | 'PostgreSQL'
 * @param opts.columnType  the column's declared type, when known
 * @param opts.onLoss      called with a reason when a value could not be
 *                         represented faithfully, so the dump can say so
 *                         instead of writing something wrong in silence
 */
export function sqlLiteral(cell, { dialect = 'MySQL', columnType = '', onLoss = null } = {}) {
  const pg = dialect === 'PostgreSQL';
  const str = pg ? pgString : myString;

  const value = cell && typeof cell === 'object' && 'v' in cell ? cell.v : cell;
  const hint = cell && typeof cell === 'object' ? cell.t : typeof value === 'number' ? 'number' : 'string';
  if (value === null || value === undefined) return 'NULL';

  switch (hint) {
    case 'number': {
      const s = String(value);
      if (NUMERIC.test(s)) return s;
      // Anything else is quoted rather than pasted in raw: the type hint is a
      // hint, and a value that does not look like a number must never reach the
      // file as bare SQL text.
      if (pg) return str(s);
      // …except NaN and Infinity, which arrive from float columns and simply
      // have no MySQL literal. Writing them as strings would fail on load.
      if (/^-?(Infinity|NaN)$/.test(s)) {
        if (onLoss) onLoss(`nilai numerik "${s}" tidak punya padanan di MySQL — ditulis NULL`);
        return 'NULL';
      }
      return str(s);
    }

    case 'boolean':
      // MySQL's BOOLEAN is TINYINT(1); TRUE/FALSE are accepted there too, but
      // 1/0 also loads into an integer column, which is what it really is.
      return pg ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';

    case 'binary':
      return binaryLiteral(String(value), pg, str, onLoss);

    case 'date':
      return str(timestampText(String(value), columnType, pg));

    // JSON and driver objects (ObjectId, Decimal128) are already text by here.
    default:
      return str(value);
  }
}

function binaryLiteral(v, pg, str, onLoss) {
  if (!/^0x[0-9a-f]*$/i.test(v)) {
    // `<4096 bytes>` — the grid's summary. The dump asks for full blobs, so
    // this only happens if something upstream forgot to; never write it as data.
    if (onLoss) onLoss(`nilai biner "${v}" tidak lengkap — ditulis NULL`);
    return 'NULL';
  }
  const hex = v.slice(2);
  return pg ? `${str('\\x' + hex)}::bytea` : `0x${hex || '00'}`;
}

/**
 * An ISO instant back into the text a database will parse as the same moment.
 *
 * Both drivers build JS Dates from timestamp columns using the *local* zone,
 * so a `2024-01-02` DATE becomes midnight local — printing its UTC face would
 * shift the day for anyone east or west of Greenwich. Local components are
 * therefore what round-trips, except for Postgres `timestamptz`, which really
 * does carry a zone and is written as the ISO instant.
 */
export function timestampText(iso, columnType = '', pg = false) {
  const type = String(columnType || '').toLowerCase();
  if (pg && /with time zone|timestamptz/.test(type)) return iso;

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // not a date after all; keep the text

  const p = (n, w = 2) => String(n).padStart(w, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const ms = d.getMilliseconds();

  if (/^date$/.test(type)) return date;
  if (/^time(?!stamp)/.test(type)) return ms ? `${time}.${p(ms, 3)}` : time;
  return ms ? `${date} ${time}.${p(ms, 3)}` : `${date} ${time}`;
}
