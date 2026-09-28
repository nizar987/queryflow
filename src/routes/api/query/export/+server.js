// POST /api/query/export — re-runs the statement with no row cap and returns
// the full result set as a downloaded file.
//
// The grid's own CSV/copy buttons can only save what "Maks baris" already
// pulled into the browser — capped at 5 000, or fewer if the user picked a
// smaller limit. This re-executes the query with maxRows: 0 (the same "no
// limit" sentinel the "Semua" option uses) so the file always has every row,
// independent of whatever was loaded on screen.
import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { runQuery } from '$lib/server/runner.js';
import { classifyStatement, splitBatch } from '$lib/statement.js';
import { toCsv, filename } from '$lib/server/csv.js';
import { describeError } from '$lib/server/errors.js';

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }

  const raw = String(body.query || '').trim();
  if (!raw) return json({ ok: false, error: 'Query kosong.' }, { status: 400 });

  const conn = findConnection(body.connectionId);
  if (!conn) {
    return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });
  }

  // One file holds one result: a script is exported one statement at a time,
  // from its own tab.
  const statements = splitBatch(conn.dialect, raw);
  if (statements.length !== 1) {
    return json(
      { ok: false, error: 'Ekspor semua baris hanya untuk satu statement — pilih tab hasilnya lalu unduh dari sana.' },
      { status: 400 }
    );
  }
  const text = statements[0];

  // Exporting means running the statement again. Fine for a read; an
  // INSERT/UPDATE/DELETE re-fired by an export click would double-write.
  const intent = classifyStatement(conn.dialect, text);
  if (intent.write || intent.locking) {
    return json(
      { ok: false, error: 'Hanya query baca (SELECT) yang bisa diekspor semua barisnya.' },
      { status: 400 }
    );
  }

  const format = body.format === 'json' ? 'json' : 'csv';

  try {
    const result = await runQuery(conn, text, { maxRows: 0 });
    if (result.kind !== 'rows' || !result.columns || result.columns.length === 0) {
      return json({ ok: false, error: 'Query ini tidak mengembalikan baris untuk diekspor.' }, { status: 400 });
    }

    const rows = result.rows.map((row) => row.map((cell) => (cell && typeof cell === 'object' ? cell.v : cell)));
    const name = filename([conn.name, 'query'], format);

    const content =
      format === 'json'
        ? JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              columns: result.columns,
              rows: rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i] ?? null]))),
              rowCount: rows.length
            },
            null,
            2
          )
        : toCsv(result.columns, rows);

    return new Response(content, {
      headers: {
        'content-type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (e) {
    return json({ ok: false, error: describeError(e) }, { status: e.expected ? 400 : 500 });
  }
}
