import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { fetchQueueJobs } from '$lib/server/runner.js';
import { statesOf } from '$lib/server/redis/index.js';
import { describeError } from '$lib/server/errors.js';

export async function GET({ url }) {
  const q = url.searchParams;
  const conn = findConnection(q.get('connectionId'));
  if (!conn) {
    return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });
  }

  const system = q.get('system') || '';
  const queue = q.get('queue') || '';
  if (!queue) return json({ ok: false, error: 'Nama antrian wajib diisi.' }, { status: 400 });

  try {
    const data = await fetchQueueJobs(conn, {
      system,
      queue,
      state: q.get('state') || 'waiting',
      offset: Number(q.get('offset') || 0),
      limit: Number(q.get('limit') || 50)
    });
    return json({ ok: true, system, queue, states: statesOf(system), ...data });
  } catch (e) {
    return json({ ok: false, error: describeError(e) });
  }
}
