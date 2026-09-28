// Whole-table export, streamed.
//
// The grid's CSV button can only save what the browser already downloaded — at
// most 5 000 rows. This reads the table page by page on the server and pushes
// each page straight into the response, so exporting a ten-million-row table
// costs one page of memory, not ten million rows of it.
//
// Paging goes through the same `readTablePage` the Tables tab uses, so the
// identifier quoting, the bound filter value, and the primary-key ordering are
// the ones already tested there rather than a second, parallel query builder.
import { fetchTableInfo, readTablePage } from '../runner.js';
import { BOM, csvRow } from '../csv.js';

/** One round trip per page; big enough to be efficient, small enough to stream. */
export const PAGE_SIZE = 1000;

/**
 * Hard ceiling, so a mis-click on a billion-row table cannot run until the disk
 * fills. The file says when it hit the cap.
 */
export const MAX_EXPORT_ROWS = 200000;

export function clampRows(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return MAX_EXPORT_ROWS;
  return Math.min(MAX_EXPORT_ROWS, Math.floor(v));
}

/**
 * Rows for one export, page by page. Shared with the SQL dump, which needs the
 * same paging and the same cap but renders each page differently.
 *
 * `raw: true` keeps the grid's `{v, t}` cells instead of flattening them to
 * plain values — the SQL dump needs the type hint to decide between `1` and
 * `'1'` — and asks the driver for whole blobs rather than the grid's summary.
 *
 * @yields {{columns: string[], rows: any[][], done: boolean, truncated: boolean}}
 */
export async function* tablePages(conn, table, { orderBy, dir, filter, conditions, limit, raw = false }) {
  // The cap travels with each page so the note in the file can name the limit
  // that actually applied — an export the caller limited to 10 rows is not
  // "cut off at 200 000".
  const cap = clampRows(limit);
  let sent = 0;
  let columns = null;

  while (sent < cap) {
    const size = Math.min(PAGE_SIZE, cap - sent);
    const page = await readTablePage(conn, table, {
      offset: sent,
      limit: size,
      orderBy,
      dir,
      filter,
      conditions,
      fullBinary: raw
    });
    columns = columns || page.columns;
    const rows = page.rows || [];
    // Cells arrive as {v, t} for the grid; a CSV or JSON file wants the value.
    const plain = raw
      ? rows
      : rows.map((row) => row.map((cell) => (cell && typeof cell === 'object' ? cell.v : cell)));
    sent += plain.length;

    const done = plain.length < size;
    yield { columns: columns || [], rows: plain, done, truncated: !done && sent >= cap, cap };
    if (done) return;
  }
}

/**
 * A stable order is not a nicety here: without one, paging can skip or repeat
 * rows while the export runs, and nobody would ever notice in a 200 000-row
 * file. Falls back to the primary key, same rule as the Tables tab.
 *
 * `info` may be passed in when the caller already fetched it, so a filtered
 * dump does not read the same metadata twice.
 */
export async function resolveOrder(conn, table, requested, info = null) {
  if (requested) return requested;
  try {
    const meta = info || (await fetchTableInfo(conn, table));
    return (meta.primaryKey && meta.primaryKey[0]) || null;
  } catch (e) {
    return null; // no metadata: export in whatever order the engine gives
  }
}

/**
 * Every column named by the filter (and by the ordering) has to exist *before*
 * the response starts.
 *
 * Once a byte of the file has been written the status code is already 200 and
 * the headers already say "attachment": a failure after that point arrives as a
 * truncated download with no error anywhere, which is exactly how someone ends
 * up trusting an empty file. Checking here keeps a typo a clean 400.
 */
export function assertColumnsExist(info, conditions, orderBy = null) {
  const known = new Set((info?.columns || []).map((c) => c.name));
  if (!known.size) return; // no metadata to check against; let the engine answer

  const wanted = [...(conditions || []).map((c) => c.column), ...(orderBy ? [orderBy] : [])];
  for (const name of wanted) {
    if (known.has(name)) continue;
    throw Object.assign(
      new Error(`Kolom "${name}" tidak ada di tabel ini. Kolom yang tersedia: ${[...known].join(', ')}.`),
      { expected: true }
    );
  }
}

/** @returns {ReadableStream} CSV, header first. */
export function csvStream(conn, table, opts) {
  const encoder = new TextEncoder();
  const iterator = tablePages(conn, table, opts);
  let headerSent = false;

  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done || !value) {
          controller.close();
          return;
        }
        let chunk = '';
        if (!headerSent) {
          chunk += BOM + csvRow(value.columns);
          headerSent = true;
        }
        for (const row of value.rows) chunk += csvRow(row);
        if (value.truncated) {
          // Say it in the file itself; a silently short export is worse than none.
          chunk += csvRow([`# terpotong pada ${value.cap} baris`]);
        }
        controller.enqueue(encoder.encode(chunk));
        if (value.done || value.truncated) controller.close();
      } catch (e) {
        controller.error(e);
      }
    }
  });
}

/** @returns {ReadableStream} JSON: metadata, then every row as an object. */
export function jsonStream(conn, table, opts) {
  const encoder = new TextEncoder();
  const iterator = tablePages(conn, table, opts);
  let started = false;
  let count = 0;
  let truncated = false;
  let cap = MAX_EXPORT_ROWS;

  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done || !value) {
          controller.enqueue(encoder.encode(closing(count, truncated, cap)));
          controller.close();
          return;
        }

        let chunk = '';
        if (!started) {
          chunk += `{\n  "table": ${JSON.stringify(table)},\n`;
          chunk += `  "exportedAt": ${JSON.stringify(new Date().toISOString())},\n`;
          chunk += `  "columns": ${JSON.stringify(value.columns)},\n  "rows": [`;
          started = true;
        }
        for (const row of value.rows) {
          const obj = Object.fromEntries(value.columns.map((c, i) => [c, row[i] ?? null]));
          chunk += (count === 0 ? '\n    ' : ',\n    ') + JSON.stringify(obj);
          count++;
        }
        truncated = truncated || value.truncated;
        cap = value.cap;
        controller.enqueue(encoder.encode(chunk));

        if (value.done || value.truncated) {
          controller.enqueue(encoder.encode(closing(count, truncated, cap)));
          controller.close();
        }
      } catch (e) {
        controller.error(e);
      }
    }
  });
}

function closing(count, truncated, cap = MAX_EXPORT_ROWS) {
  return `\n  ],\n  "rowCount": ${count},\n  "truncated": ${truncated ? 'true' : 'false'},\n  "maxRows": ${cap}\n}\n`;
}
