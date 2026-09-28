import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { testConnection } from '$lib/server/runner.js';

export async function POST({ params }) {
  const conn = findConnection(params.id);
  if (!conn) return json({ ok: false, error: 'Koneksi tidak ditemukan.' }, { status: 404 });

  try {
    const info = await testConnection(conn);
    return json({ ok: true, ...info });
  } catch (e) {
    // Driver errors are expected input (wrong host, bad password) — 200 with
    // ok:false keeps them out of the browser's network error console.
    return json({ ok: false, error: describe(e) });
  }
}

function describe(e) {
  const msg = e && e.message ? e.message : String(e);
  const code = e && e.code ? ` (${e.code})` : '';
  return msg + code;
}
