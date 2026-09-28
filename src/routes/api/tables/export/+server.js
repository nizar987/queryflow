// GET /api/tables/export?connectionId&table&format=csv|json|sql
//     [&orderBy&dir&limit][&where=<json>][&filterColumn&filterValue][&schema=1]
//   → the whole table, or the slice the filter describes, as a downloaded file.
//
// Streamed: a 200 000-row export costs one page of memory, not the file.
import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { filename } from '$lib/server/csv.js';
import { csvStream, jsonStream, resolveOrder, clampRows, assertColumnsExist } from '$lib/server/export/table.js';
import { sqlStream, prepareDump, assertDumpable } from '$lib/server/export/sql-dump.js';
import { parseConditions, filterSlug } from '$lib/server/drivers/where.js';
import { fetchTableInfo } from '$lib/server/runner.js';
import { describeError } from '$lib/server/errors.js';

const FORMATS = {
  csv: { type: 'text/csv; charset=utf-8', ext: 'csv' },
  json: { type: 'application/json; charset=utf-8', ext: 'json' },
  sql: { type: 'application/sql; charset=utf-8', ext: 'sql' }
};

export async function GET({ url }) {
  const q = url.searchParams;
  const conn = findConnection(q.get('connectionId'));
  if (!conn) {
    return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });
  }

  const table = q.get('table') || '';
  if (!table) return json({ ok: false, error: 'Parameter table diperlukan.' }, { status: 400 });

  const format = FORMATS[q.get('format')] ? q.get('format') : 'csv';

  try {
    // `where` is the filter builder; `filterColumn`/`filterValue` is the single
    // equality a foreign-key click produces. Both normalise to the same list.
    const conditions = q.get('where')
      ? parseConditions(q.get('where'))
      : parseConditions(q.get('filterColumn') ? { column: q.get('filterColumn'), value: q.get('filterValue') } : null);

    if (conditions.length && !supportsFilter(conn.dialect)) {
      // Better to refuse than to hand someone a file that quietly ignored the
      // filter they set and looks like a complete export of the wrong rows.
      throw Object.assign(
        new Error(`Filter ekspor belum didukung untuk ${conn.dialect}. Hapus filternya untuk mengekspor seluruh koleksi.`),
        { expected: true }
      );
    }
    if (format === 'sql') assertDumpable(conn.dialect);

    // Everything that can fail has to fail *here*, before a byte of the file is
    // written: once the response starts it is a 200 with an attachment header,
    // and a failure after that is a truncated download with no error in it.
    // A dump needs the column types anyway, and a filter needs the column
    // names, so the metadata is read once and shared.
    const info = format === 'sql' || conditions.length ? await fetchTableInfo(conn, table) : null;
    const orderBy = await resolveOrder(conn, table, q.get('orderBy'), info);
    if (info) assertColumnsExist(info, conditions, orderBy);

    const opts = {
      orderBy,
      dir: q.get('dir') === 'desc' ? 'desc' : 'asc',
      conditions,
      limit: clampRows(q.get('limit'))
    };

    let body;
    if (format === 'sql') {
      // Schema is opt-out: a dump you can restore into an empty database is the
      // more useful default, and `schema=0` gives the data-only version.
      const includeSchema = q.get('schema') !== '0';
      const { columnTypes, preamble, epilogue } = await prepareDump(conn, table, { ...opts, includeSchema, info });
      body = sqlStream(conn, table, { ...opts, columnTypes, preamble, epilogue });
    } else {
      body = format === 'json' ? jsonStream(conn, table, opts) : csvStream(conn, table, opts);
    }

    const name = filename([conn.name, table, filterSlug(conditions)], FORMATS[format].ext);
    return new Response(body, {
      headers: {
        'content-type': FORMATS[format].type,
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (e) {
    return json({ ok: false, error: describeError(e) }, { status: e.expected ? 400 : 500 });
  }
}

/** Only the SQL drivers push the filter down into the query. */
const supportsFilter = (dialect) =>
  dialect === 'MySQL' || dialect === 'MariaDB' || dialect === 'PostgreSQL';
