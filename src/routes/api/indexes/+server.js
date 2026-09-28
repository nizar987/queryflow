import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { fetchIndexes } from '$lib/server/runner.js';
import { describeError } from '$lib/server/errors.js';

// GET /api/indexes?connectionId=…&tables=orders,customers
//   → the indexes those tables actually have, so the advisor can say
//     "sudah ada" instead of recommending something that exists.

export async function GET({ url }) {
  const conn = findConnection(url.searchParams.get('connectionId'));
  if (!conn) {
    return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });
  }

  const tables = (url.searchParams.get('tables') || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20); // one query's worth of tables; anything more is a mistake

  if (tables.length === 0) {
    return json({ ok: false, error: 'Parameter tables diperlukan.' }, { status: 400 });
  }

  try {
    const data = await fetchIndexes(conn, tables);
    return json({ ok: true, dialect: conn.dialect, tables, ...data });
  } catch (e) {
    return json({ ok: false, dialect: conn.dialect, error: describeError(e) });
  }
}
