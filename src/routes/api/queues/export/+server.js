// Download endpoint. Returns a file, not JSON — the browser saves it straight
// to disk, so a 200 000-job registry never has to pass through page state.
import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { collectQueueJobs, fetchQueueOverview } from '$lib/server/runner.js';
import { jobsToCsv, queuesToCsv, workersToCsv, filename, MAX_EXPORT_ROWS } from '$lib/server/redis/export.js';
import { describeError } from '$lib/server/errors.js';

export async function GET({ url }) {
  const q = url.searchParams;
  const conn = findConnection(q.get('connectionId'));
  if (!conn) {
    return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });
  }

  const kind = q.get('kind') || 'jobs';
  const format = q.get('format') === 'json' ? 'json' : 'csv';

  try {
    const { body, parts } = await build(conn, kind, q);
    const name = filename([conn.name, ...parts], format);
    const text = format === 'json' ? JSON.stringify(body.json, null, 2) : body.csv;
    return new Response(text, {
      headers: {
        'content-type':
          format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store'
      }
    });
  } catch (e) {
    return json({ ok: false, error: describeError(e) }, { status: 400 });
  }
}

async function build(conn, kind, q) {
  if (kind === 'queues' || kind === 'workers') {
    const data = await fetchQueueOverview(conn);
    if (kind === 'queues') {
      return {
        parts: ['antrian'],
        body: { csv: queuesToCsv(data.queues), json: { exportedAt: new Date().toISOString(), queues: data.queues, totals: data.totals } }
      };
    }
    return {
      parts: ['worker'],
      body: { csv: workersToCsv(data.workers), json: { exportedAt: new Date().toISOString(), workers: data.workers, totals: data.totals } }
    };
  }

  const queue = q.get('queue');
  if (!queue) {
    const err = new Error('Nama antrian wajib diisi.');
    err.expected = true;
    throw err;
  }
  const system = q.get('system') || '';
  const state = q.get('state') || 'waiting';
  const result = await collectQueueJobs(conn, {
    system,
    queue,
    state,
    limit: Number(q.get('limit') || MAX_EXPORT_ROWS)
  });

  return {
    parts: [queue, state],
    body: {
      csv: jobsToCsv(result.jobs),
      json: {
        exportedAt: new Date().toISOString(),
        connection: conn.name,
        system,
        queue,
        state,
        total: result.total,
        // Say so in the file itself when the cap cut the list short, rather
        // than handing over a silently partial export.
        truncated: result.truncated,
        maxRows: MAX_EXPORT_ROWS,
        jobs: result.jobs
      }
    }
  };
}
