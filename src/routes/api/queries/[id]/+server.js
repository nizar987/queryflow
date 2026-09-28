import { json } from '@sveltejs/kit';
import { updateQuery, deleteQuery } from '$lib/server/queries.js';

export async function PUT({ params, request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }
  const r = updateQuery(params.id, body);
  return json(r, { status: r.ok ? 200 : 400 });
}

export async function DELETE({ params }) {
  const r = deleteQuery(params.id);
  return json(r, { status: r.ok ? 200 : 404 });
}
