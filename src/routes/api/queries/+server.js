import { json } from '@sveltejs/kit';
import { listQueries, createQuery, queriesPath } from '$lib/server/queries.js';

export async function GET() {
  try {
    return json({ ok: true, queries: listQueries(), path: queriesPath() });
  } catch (e) {
    return json({ ok: false, error: e.message, path: queriesPath() }, { status: 500 });
  }
}

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }
  const r = createQuery(body);
  return json(r, { status: r.ok ? 200 : 400 });
}
