// CSV primitives, shared by the queue export, the table export, the query
// export on the server, and the result grid's download in the browser.
//
// One implementation on purpose: the quoting rules here are not cosmetic. A
// cell that starts with `=` is a formula to Excel, and job payloads and table
// contents are both untrusted text. Two copies of this would eventually differ,
// and the difference would be an injection.

/** Excel needs a BOM to read UTF-8; without it Indonesian text arrives mangled. */
export const BOM = '﻿';

/**
 * RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would
 * execute.
 */
export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV record, CRLF-terminated. */
export function csvRow(values) {
  return values.map(csvCell).join(',') + '\r\n';
}

export function toCsv(header, rows) {
  let out = BOM + csvRow(header);
  for (const row of rows) out += csvRow(row);
  return out;
}

/** `name-parts-2026-08-21-10-30-00.csv` — sortable, and safe as a filename. */
export function filename(parts, ext) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const slug = parts
    .filter(Boolean)
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  return `${slug}-${stamp}.${ext}`;
}

/** The result grid's rows are cells ({ v, t }); write their values. */
export function cellsToCsv(columns, rows) {
  return toCsv(columns, rows.map((row) => row.map((cell) => (cell ? cell.v : null))));
}
