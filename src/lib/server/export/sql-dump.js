// A table (or a filtered slice of it) as a runnable .sql file, streamed.
//
// The shape of the file is chosen so that a half-finished download cannot
// half-load: the whole thing is one transaction, so a truncated file fails at
// COMMIT and leaves the target database untouched. Anything the dump could not
// represent faithfully — a blob it could not read back, a float MySQL has no
// literal for — is reported in the header rather than written as data.
import { fetchTableInfo, fetchTableDDL } from '../runner.js';
import { tablePages, clampRows } from './table.js';
import { sqlLiteral } from './sql-literal.js';
import { createTableSQL, sequenceResets } from './ddl.js';
import { describeConditions } from '../drivers/where.js';
import { qMy, qPg } from '../drivers/identifiers.js';

/** Rows per INSERT. Big enough that the file is compact, small enough to read. */
export const ROWS_PER_INSERT = 100;
/**
 * …and a byte ceiling on top of it, because 100 rows of a table with a TEXT
 * column can be tens of megabytes, which is past `max_allowed_packet` on a
 * default MySQL and would make the dump unloadable.
 */
export const MAX_INSERT_BYTES = 512 * 1024;

const isPg = (dialect) => dialect === 'PostgreSQL';

/** SQL dumps only make sense where the target speaks SQL. */
export function assertDumpable(dialect) {
  if (dialect === 'MySQL' || dialect === 'MariaDB' || dialect === 'PostgreSQL') return dialect;
  throw Object.assign(
    new Error(`Dump SQL belum didukung untuk ${dialect} — gunakan format CSV atau JSON.`),
    { expected: true }
  );
}

/**
 * The schema half of the dump. MySQL can state its own definition exactly, so
 * that is preferred; elsewhere it is rebuilt from column metadata and the
 * caller is told (via `synthesized`) to say so in the file.
 */
export async function schemaFor(conn, table, info) {
  try {
    const sql = await fetchTableDDL(conn, table);
    if (sql) return { sql: sql.trim().replace(/;?\s*$/, ';'), synthesized: false };
  } catch (e) {
    // A user without SHOW privileges still deserves a dump; fall through to
    // the reconstruction rather than failing the whole export.
  }
  return createTableSQL(conn.dialect, table, info);
}

/** `INSERT INTO t (a, b) VALUES\n  (…),\n  (…);` for one batch of rows. */
export function insertStatement(dialect, table, columns, rows, opts = {}) {
  const q = isPg(dialect) ? qPg : qMy;
  const types = opts.columnTypes || {};
  const head = `INSERT INTO ${q(table)} (${columns.map(q).join(', ')}) VALUES\n`;
  const tuples = rows.map(
    (row) =>
      '  (' +
      row
        .map((cell, i) =>
          sqlLiteral(cell, { dialect, columnType: types[columns[i]] || '', onLoss: opts.onLoss })
        )
        .join(', ') +
      ')'
  );
  return head + tuples.join(',\n') + ';\n';
}

/** Batches that respect both the row count and the byte ceiling. */
function* batches(columns, rows, dialect, opts) {
  let batch = [];
  let bytes = 0;
  for (const row of rows) {
    // Rough but cheap: the literal length is what ends up in the file.
    const size = row.reduce((n, cell) => n + String(cell && cell.v != null ? cell.v : '').length + 4, 0);
    if (batch.length && (batch.length >= ROWS_PER_INSERT || bytes + size > MAX_INSERT_BYTES)) {
      yield insertStatement(dialect, opts.table, columns, batch, opts);
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += size;
  }
  if (batch.length) yield insertStatement(dialect, opts.table, columns, batch, opts);
}

export function dumpHeader({ conn, table, conditions, orderBy, dir, includeSchema, synthesized, limit }) {
  const target = conn.uri || `${conn.host}:${conn.port}${conn.database ? '/' + conn.database : ''}`;
  const lines = [
    '-- Dump SQL dari QueryFlow',
    `-- Sumber   : ${conn.name} (${conn.dialect} · ${target})`,
    `-- Tabel    : ${table}`,
    `-- Filter   : ${conditions && conditions.length ? describeConditions(conditions) : '(tanpa filter — seluruh isi tabel)'}`,
    `-- Urutan   : ${orderBy ? `${orderBy} ${dir === 'desc' ? 'DESC' : 'ASC'}` : '(mengikuti engine)'}`,
    `-- Batas    : maksimal ${limit.toLocaleString('id-ID')} baris`,
    `-- Dibuat   : ${new Date().toISOString()}`,
    '--'
  ];
  if (includeSchema && synthesized) {
    lines.push(
      '-- CATATAN : CREATE TABLE di bawah disusun ulang dari metadata kolom, jadi isinya',
      '--           hanya kolom, default, dan primary key. Index sekunder, foreign key,',
      '--           constraint CHECK, dan trigger TIDAK ikut — buat ulang secara terpisah.',
      '--'
    );
  }
  if (includeSchema) {
    lines.push(
      '-- CREATE TABLE di bawah sengaja gagal kalau tabel dengan nama ini sudah ada',
      '-- di database tujuan — lebih baik berhenti daripada menumpuk data ke tabel',
      '-- lain yang kebetulan senama.',
      '--'
    );
  }
  lines.push(
    '-- Seluruh isi file ini satu transaksi: kalau unduhan terputus di tengah,',
    '-- COMMIT tidak pernah terbaca dan database tujuan tidak berubah sama sekali.',
    ''
  );
  return lines.join('\n');
}

/**
 * @returns {ReadableStream} the dump, header first.
 */
export function sqlStream(conn, table, opts) {
  const dialect = assertDumpable(conn.dialect);
  const encoder = new TextEncoder();
  const cap = clampRows(opts.limit);
  const iterator = tablePages(conn, table, { ...opts, limit: cap, raw: true });

  let started = false;
  let count = 0;
  let closed = false;
  const losses = new Set();
  const onLoss = (why) => losses.add(why);

  const finish = (truncated) => {
    const notes = [`-- ${count.toLocaleString('id-ID')} baris diekspor.`];
    if (truncated) {
      notes.push(`-- TERPOTONG: berhenti di batas ${cap.toLocaleString('id-ID')} baris — sisanya tidak ikut.`);
    }
    for (const w of losses) notes.push(`-- PERINGATAN: ${w}.`);
    // A stream that never produced a row still owes the file its transaction.
    const open = started ? '' : (isPg(dialect) ? 'BEGIN;\n\n' : 'START TRANSACTION;\n\n');
    // Auto-numbering is fixed up inside the same transaction as the data, so a
    // dump either lands complete and usable or not at all.
    const resets = count && opts.epilogue ? `\n${opts.epilogue}\n` : '';
    return `${open}${resets}\nCOMMIT;\n\n${notes.join('\n')}\n`;
  };

  return new ReadableStream({
    async pull(controller) {
      if (closed) return;
      try {
        const { value, done } = await iterator.next();
        if (done || !value) {
          // No rows matched: the header and (if asked) the schema still went
          // out, and the file still has to be a valid, runnable script.
          // `finish` opens the transaction itself when nothing else did, so
          // the file stays a valid script either way.
          if (!started) controller.enqueue(encoder.encode(opts.preamble || ''));
          controller.enqueue(encoder.encode(finish(false)));
          closed = true;
          controller.close();
          return;
        }

        let chunk = '';
        if (!started) {
          chunk += opts.preamble || '';
          chunk += isPg(dialect) ? 'BEGIN;\n\n' : 'START TRANSACTION;\n\n';
          started = true;
        }

        if (value.rows.length) {
          for (const stmt of batches(value.columns, value.rows, dialect, {
            table,
            columnTypes: opts.columnTypes,
            onLoss
          })) {
            chunk += stmt;
          }
          count += value.rows.length;
        }

        controller.enqueue(encoder.encode(chunk));

        if (value.done || value.truncated) {
          controller.enqueue(encoder.encode(finish(!!value.truncated)));
          closed = true;
          controller.close();
        }
      } catch (e) {
        controller.error(e);
      }
    }
  });
}

/**
 * Everything the stream needs that has to be resolved *before* it starts: the
 * column types, the schema statement, the header. Doing it here means a missing
 * table or a permission error is still a clean JSON error instead of a
 * half-written download.
 */
export async function prepareDump(conn, table, { conditions, orderBy, dir, limit, includeSchema, info = null }) {
  const meta = info || (await fetchTableInfo(conn, table));
  const columnTypes = Object.fromEntries((meta.columns || []).map((c) => [c.name, c.type]));

  let schema = null;
  if (includeSchema) schema = await schemaFor(conn, table, meta);

  const resets = sequenceResets(conn.dialect, table, meta);
  const preamble =
    dumpHeader({
      conn,
      table,
      conditions,
      orderBy,
      dir,
      includeSchema,
      synthesized: !!(schema && schema.synthesized),
      limit: clampRows(limit)
    }) + (schema ? `${schema.sql}\n\n` : '');

  return { info: meta, columnTypes, preamble, epilogue: resets.join('\n') };
}
