import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { runScript } from '$lib/server/runner.js';
import { describeQueryError, stopCodeOf } from '$lib/server/errors.js';
import { isRunId } from '$lib/run-id.js';

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

  const runId = body.runId == null ? null : String(body.runId);
  if (runId !== null && !isRunId(runId)) {
    return json({ ok: false, error: 'runId tidak valid.' }, { status: 400 });
  }

  try {
    const out = await runScript(conn, text, { maxRows: body.maxRows, runId });
    return json({ ok: true, dialect: conn.dialect, ...out });
  } catch (e) {
    // A rejected query is a normal outcome of this feature, not a server fault.
    // `code` lets the page tell a cancel or a time-out apart from a failure.
    return json({ ok: false, dialect: conn.dialect, error: describeQueryError(e), code: stopCodeOf(e) });
  }
}
