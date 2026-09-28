// Validating a filter and turning it into SQL.
//
// The Tables tab used to have exactly one kind of filter: the equality that a
// foreign-key click produces. A dump needs more than that ("pesanan bulan ini
// yang statusnya paid"), and the moment a user can compose conditions the
// question of how they reach SQL stops being cosmetic.
//
// Three rules make that safe, and they are the reason this is one module rather
// than a snippet in each driver:
//   * the column is an identifier, so it cannot be bound — it is validated
//     against the same allowlist as everywhere else and then quoted;
//   * the operator is chosen from a fixed table, never taken from the request;
//   * the value is *always* a bound parameter, never interpolated.
// Nothing a user types can become SQL syntax.
//
// The operator table itself lives in `$lib/filter.js` because the UI needs it
// too — see the note there.
import { assertColumn } from './identifiers.js';
import { OPERATORS, MAX_CONDITIONS, MAX_IN_VALUES, splitList } from '../../filter.js';

export { OPERATORS, MAX_CONDITIONS, MAX_IN_VALUES };
export { describeConditions, filterSlug } from '../../filter.js';

const fail = (/** @type {string} */ msg) => {
  throw Object.assign(new Error(msg), { expected: true });
};

/**
 * Accepts what the browser sends and returns conditions this module trusts:
 * a JSON string, an array, the legacy `{column, value}` equality that
 * foreign-key navigation still produces, or nothing at all.
 *
 * @returns {Array<{column: string, op: string, values: any[]}>}
 */
export function parseConditions(raw) {
  if (raw == null || raw === '') return [];

  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch (e) {
      fail('Filter tidak bisa dibaca — format JSON-nya tidak valid.');
    }
  }
  // The old shape: one column, one value, always equality.
  if (list && !Array.isArray(list) && list.column != null) {
    list = [{ column: list.column, op: '=', value: list.value }];
  }
  if (!Array.isArray(list)) fail('Filter harus berupa daftar kondisi.');
  if (list.length > MAX_CONDITIONS) {
    fail(`Maksimal ${MAX_CONDITIONS} kondisi filter, diterima ${list.length}.`);
  }
  return list.map(normalizeCondition);
}

function normalizeCondition(raw, i) {
  const at = `Kondisi filter #${i + 1}`;
  if (!raw || typeof raw !== 'object') fail(`${at} tidak valid.`);

  const op = String(raw.op || '=').toLowerCase();
  const spec = OPERATORS[op];
  if (!spec) fail(`${at}: operator "${raw.op}" tidak dikenal.`);

  // Throws with its own message when the name could not be embedded safely.
  const column = assertColumn(raw.column);

  if (spec.arity === 0) return { column, op, values: [] };

  if (spec.arity === 1) {
    // `undefined` means the field was never filled in; `null` and '' are real
    // choices a user can make and are passed through as-is.
    const v = Array.isArray(raw.values) ? raw.values[0] : raw.value;
    if (v === undefined) fail(`${at}: operator "${spec.label}" butuh sebuah nilai.`);
    return { column, op, values: [v] };
  }

  const values = Array.isArray(raw.values) ? raw.values : splitList(raw.value);
  if (!values.length) fail(`${at}: operator "${spec.label}" butuh minimal satu nilai.`);
  if (values.length > MAX_IN_VALUES) {
    fail(`${at}: maksimal ${MAX_IN_VALUES} nilai dalam daftar, diterima ${values.length}.`);
  }
  return { column, op, values };
}

/**
 * Conditions → a WHERE clause for one engine, joined with AND.
 *
 * @param conditions from `parseConditions`
 * @param quote      identifier quoting for the engine (qMy / qPg)
 * @param placeholder `(n) => string` — n is 1-based across the whole clause,
 *        which is what Postgres's `$1` numbering needs and MySQL ignores.
 * @returns {{sql: string, params: any[]}} `sql` is '' or starts with ' WHERE '.
 */
export function buildWhere(conditions, quote, placeholder = (_n) => '?') {
  const list = conditions || [];
  if (!list.length) return { sql: '', params: [] };

  /** @type {any[]} */
  const params = [];
  const parts = list.map(({ column, op, values }) => {
    const spec = OPERATORS[op];
    const col = quote(column);
    if (spec.arity === 0) return `${col} ${spec.sql}`;
    if (spec.arity === 1) {
      params.push(values[0] === undefined ? null : values[0]);
      return `${col} ${spec.sql} ${placeholder(params.length)}`;
    }
    const slots = values.map((v) => {
      params.push(v);
      return placeholder(params.length);
    });
    return `${col} ${spec.sql} (${slots.join(', ')})`;
  });

  return { sql: ` WHERE ${parts.join(' AND ')}`, params };
}
