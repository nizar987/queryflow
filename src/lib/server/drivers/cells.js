// Driver results have to survive JSON transport to the browser. Dates, Buffers,
// BigInts and Mongo ObjectIds all either throw or turn into "{}" if passed
// through JSON.stringify untouched, so every cell goes through here first.

/**
 * @param value raw driver value
 * @param opts.fullBinary keep the whole blob as hex instead of summarising it.
 *        The grid never wants this — megabytes of hex in a table cell help
 *        nobody — but a SQL dump does: a dump that silently replaces a blob
 *        with "<4096 bytes>" is not a backup, it is data loss with a receipt.
 * @returns {{v: any, t: string}} value plus a display type hint for the grid.
 */
export function encodeCell(value, opts = {}) {
  if (value === null || value === undefined) return { v: null, t: 'null' };

  const type = typeof value;
  if (type === 'bigint') return { v: value.toString(), t: 'number' };
  if (type === 'number') return { v: Number.isFinite(value) ? value : String(value), t: 'number' };
  if (type === 'boolean') return { v: value, t: 'boolean' };
  if (type === 'string') return { v: value, t: 'string' };

  if (value instanceof Date) return { v: value.toISOString(), t: 'date' };

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    // Show short blobs as hex; long ones only as a size, not megabytes of noise.
    return opts.fullBinary || value.length <= 32
      ? { v: '0x' + value.toString('hex'), t: 'binary' }
      : { v: `<${value.length} bytes>`, t: 'binary' };
  }

  if (type === 'object') {
    // ObjectId, Decimal128, Long… all implement a useful toString.
    const ctor = value.constructor && value.constructor.name;
    if (ctor === 'ObjectId' || ctor === 'Decimal128' || ctor === 'Long' || ctor === 'Binary') {
      return { v: String(value), t: 'id' };
    }
    try {
      return { v: JSON.stringify(value, jsonSafe), t: 'json' };
    } catch (e) {
      return { v: String(value), t: 'string' };
    }
  }

  return { v: String(value), t: 'string' };
}

function jsonSafe(_key, v) {
  if (typeof v === 'bigint') return v.toString();
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return `<${v.length} bytes>`;
  return v;
}

/**
 * Turn driver row objects into a column list + positional rows.
 * `columns` fixes the order; without it, column order follows first-seen keys
 * (Mongo documents are heterogeneous, so later rows can introduce new fields).
 * `opts` is passed through to `encodeCell` — see `fullBinary` there.
 */
export function toGrid(objects, columns = null, opts = {}) {
  const cols = columns ? [...columns] : [];
  if (!columns) {
    for (const o of objects) {
      for (const k of Object.keys(o || {})) if (!cols.includes(k)) cols.push(k);
    }
  }
  const rows = objects.map((o) => cols.map((c) => encodeCell(o ? o[c] : null, opts)));
  return { columns: cols, rows };
}
