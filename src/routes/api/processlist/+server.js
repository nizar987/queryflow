import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { fetchProcessList } from '$lib/server/runner.js';

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }

  const conn = findConnection(body.connectionId);
  if (!conn) return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });

  try {
    const data = await fetchProcessList(conn);
    return json({ ok: true, dialect: conn.dialect, ...data });
  } catch (e) {
    // Missing PROCESS / pg_read_all_stats / clusterMonitor privileges land here.
    return json({ ok: false, dialect: conn.dialect, error: describe(e) });
  }
}

function describe(e) {
  if (!e) return 'Kesalahan tidak diketahui.';
  const parts = [e.message || String(e)];
  if (e.sqlState) parts.push(`SQLSTATE ${e.sqlState}`);
  else if (e.code) parts.push(String(e.code));
  return parts.join(' \u00b7 ');
}
