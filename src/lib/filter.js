// The filter vocabulary, shared by the browser and the server.
//
// The UI needs the operator list to build its dropdowns and to show a person
// what their filter says before they download 200 000 rows; the server needs
// the same list to know which operators exist at all. Two copies would drift,
// and a drifting operator table means a filter that reads one way on screen and
// runs another way against the database.
//
// Everything here is pure and free of server-only imports on purpose, so a
// Svelte component can import it. Validation and SQL building live next to the
// drivers, in `server/drivers/where.js`.

/**
 * `arity` is how many values the operator consumes: 0 for the null tests, 1 for
 * a comparison, 'n' for a list. `sql` is the token that reaches the database —
 * chosen from this table, never taken from the request.
 */
export const OPERATORS = {
  '=':     { label: 'sama dengan',       arity: 1,   sql: '=' },
  '!=':    { label: 'tidak sama dengan', arity: 1,   sql: '<>' },
  '>':     { label: 'lebih dari',        arity: 1,   sql: '>' },
  '>=':    { label: 'minimal',           arity: 1,   sql: '>=' },
  '<':     { label: 'kurang dari',       arity: 1,   sql: '<' },
  '<=':    { label: 'maksimal',          arity: 1,   sql: '<=' },
  like:    { label: 'cocok pola',        arity: 1,   sql: 'LIKE',     hint: 'Pakai % sebagai wildcard, misal %gmail.com' },
  notlike: { label: 'tidak cocok pola',  arity: 1,   sql: 'NOT LIKE', hint: 'Pakai % sebagai wildcard' },
  in:      { label: 'salah satu dari',   arity: 'n', sql: 'IN',       hint: 'Pisahkan dengan koma' },
  notin:   { label: 'bukan salah satu',  arity: 'n', sql: 'NOT IN',   hint: 'Pisahkan dengan koma' },
  isnull:  { label: 'kosong (NULL)',     arity: 0,   sql: 'IS NULL' },
  notnull: { label: 'tidak kosong',      arity: 0,   sql: 'IS NOT NULL' }
};

/** In UI order, so the dropdown reads sensibly rather than by object key. */
export const OPERATOR_LIST = Object.entries(OPERATORS).map(([id, spec]) => ({ id, ...spec }));

/**
 * A filter with fifty conditions is a query, not a filter — and each one costs
 * a bound parameter on a live database. Well past anything the UI offers.
 */
export const MAX_CONDITIONS = 12;
/** Same idea for `IN (…)`: long enough to paste a list of ids, short enough to stay a filter. */
export const MAX_IN_VALUES = 200;

/** `a, b , c` → ['a','b','c']. What a single text field can express as a list. */
export function splitList(v) {
  if (v == null) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/**
 * The filter as a person would read it — for the comment header of a dump, and
 * for the line the UI shows before anyone clicks download. Never executed, so
 * values are shown plainly rather than escaped for SQL.
 */
export function describeConditions(conditions) {
  return (conditions || [])
    .map(({ column, op, values, value }) => {
      const spec = OPERATORS[op] || OPERATORS['='];
      const vals = values != null ? values : splitList(value);
      if (spec.arity === 0) return `${column} ${spec.sql}`;
      if (spec.arity === 1) return `${column} ${spec.sql} ${show(values ? values[0] : value)}`;
      return `${column} ${spec.sql} (${vals.map(show).join(', ')})`;
    })
    .join(' AND ');
}

const show = (v) => (v === null || v === undefined ? 'NULL' : JSON.stringify(String(v)));

/** A short, filename-safe tag for the filter, so two exports don't collide. */
export function filterSlug(conditions) {
  if (!conditions || !conditions.length) return '';
  const first = conditions[0];
  const firstValue = (first.values ? first.values[0] : first.value) ?? '';
  const head = `${first.column}-${first.op}-${String(firstValue).slice(0, 20)}`;
  return conditions.length > 1 ? `${head}-plus${conditions.length - 1}` : head;
}

/** Does this condition still need a value typed into it before it can run? */
export function isIncomplete({ op, value }) {
  const spec = OPERATORS[op];
  if (!spec || spec.arity === 0) return false;
  return value == null || String(value).trim() === '';
}
