import { json } from '@sveltejs/kit';
import { readConfig, publicView, createConnection, configPath } from '$lib/server/config.js';

export async function GET() {
  try {
    const cfg = readConfig();
    return json({ ok: true, connections: cfg.connections.map(publicView), configPath: configPath() });
  } catch (e) {
    return json({ ok: false, error: e.message, configPath: configPath() }, { status: 500 });
  }
}

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }

  const r = createConnection(body);
  if (!r.ok) return json(r, { status: 400 });
  return json({ ok: true, connection: publicView(r.value) }, { status: 201 });
}
