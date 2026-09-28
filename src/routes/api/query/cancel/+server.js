// POST /api/query/cancel — stop a statement started from the Query tab.
//
// The run is looked up by the id the page sent with it; the kill itself is
// done by the driver on the database, so the statement really stops instead
// of the page merely giving up on waiting.
import { json } from '@sveltejs/kit';
import { cancelRun } from '$lib/server/run-control.js';
import { isRunId } from '$lib/run-id.js';

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }
  if (!isRunId(body && body.runId)) {
    return json({ ok: false, error: 'runId tidak valid.' }, { status: 400 });
  }
  return json(await cancelRun(body.runId));
}
