import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { explainQuery } from '$lib/server/runner.js';

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }

  const text = String(body.query || '').trim();
  if (!text) return json({ ok: false, error: 'Query kosong.' }, { status: 400 });

  const conn = findConnection(body.connectionId);
  if (!conn) return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });

  try {
    const { raw, durationMs } = await explainQuery(conn, text, { analyze: !!body.analyze });
    return json({ ok: true, dialect: conn.dialect, raw, durationMs });
  } catch (e) {
    return json({ ok: false, dialect: conn.dialect, error: describe(e) }, { status: e.expected ? 400 : 500 });
  }
}

function describe(e) {
  if (!e) return 'Kesalahan tidak diketahui.';
  const parts = [e.message || String(e)];
  if (e.sqlState) parts.push(`SQLSTATE ${e.sqlState}`);
  else if (e.code) parts.push(String(e.code));
  if (e.hint) parts.push(`Petunjuk: ${e.hint}`);
  return parts.join(' · ');
}
