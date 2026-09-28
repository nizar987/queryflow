// POST /api/processlist/kill  { connectionId, id, mode: 'query' | 'connection' }
//   → stops one live session on the connected server.
import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { killSession } from '$lib/server/runner.js';
import { describeError } from '$lib/server/errors.js';

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }

  const conn = findConnection(body.connectionId);
  if (!conn) {
    return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });
  }
  if (body.id == null || body.id === '') {
    return json({ ok: false, error: 'ID sesi diperlukan.' }, { status: 400 });
  }

  const mode = body.mode === 'connection' ? 'connection' : 'query';
  try {
    const result = await killSession(conn, body.id, { mode });
    return json({ ok: true, dialect: conn.dialect, ...result });
  } catch (e) {
    // Missing privileges (PROCESS, pg_signal_backend, killop) land here.
    return json({ ok: false, dialect: conn.dialect, error: describeError(e) }, { status: e.expected ? 400 : 500 });
  }
}
