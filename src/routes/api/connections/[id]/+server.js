import { json } from '@sveltejs/kit';
import { findConnection, updateConnection, deleteConnection, publicView } from '$lib/server/config.js';
import { disposeConnection } from '$lib/server/runner.js';

export async function PUT({ params, request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }

  // Close pools opened against the old settings before they become unreachable.
  disposeConnection(findConnection(params.id));

  const r = updateConnection(params.id, body);
  if (!r.ok) return json(r, { status: r.error === 'Koneksi tidak ditemukan.' ? 404 : 400 });
  return json({ ok: true, connection: publicView(r.value) });
}

export async function DELETE({ params }) {
  disposeConnection(findConnection(params.id));
  const r = deleteConnection(params.id);
  if (!r.ok) return json(r, { status: 404 });
  return json({ ok: true });
}
