import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { fetchQueueOverview } from '$lib/server/runner.js';
import { STATE_ORDER, STATE_LABELS, SYSTEM_LABELS } from '$lib/server/redis/index.js';
import { describeError } from '$lib/server/errors.js';

export async function GET({ url }) {
  const conn = findConnection(url.searchParams.get('connectionId'));
  if (!conn) {
    return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });
  }

  try {
    const data = await fetchQueueOverview(conn);
    return json({
      ok: true,
      dialect: conn.dialect,
      // The label maps travel with the payload so the browser never has to keep
      // its own copy of the state vocabulary in sync with the server's.
      stateOrder: STATE_ORDER,
      stateLabels: STATE_LABELS,
      systemLabels: SYSTEM_LABELS,
      ...data
    });
  } catch (e) {
    return json({ ok: false, dialect: conn.dialect, error: describeError(e) });
  }
}
