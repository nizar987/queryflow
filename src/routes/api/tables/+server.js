import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import { fetchTables, previewTable } from '$lib/server/runner.js';

// GET /api/tables?connectionId=xxx          → list all tables
// GET /api/tables?connectionId=xxx&table=yyy → preview up to 1 000 rows
export async function GET({ url }) {
  const connectionId = url.searchParams.get('connectionId') || '';
  const table        = url.searchParams.get('table') || '';

  if (!connectionId) {
    return json({ ok: false, error: 'connectionId diperlukan.' }, { status: 400 });
  }

  const conn = findConnection(connectionId);
  if (!conn) {
    return json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 });
  }

  try {
    if (table) {
      const result = await previewTable(conn, table);
      return json({ ok: true, result });
    }
    const tables = await fetchTables(conn);
    return json({ ok: true, tables });
  } catch (e) {
    return json({ ok: false, error: describe(e) }, { status: e.expected ? 400 : 500 });
  }
}

function describe(e) {
  if (!e) return 'Kesalahan tidak diketahui.';
  const parts = [e.message || String(e)];
  if (e.sqlState) parts.push(`SQLSTATE ${e.sqlState}`);
  else if (e.code) parts.push(String(e.code));
  if (e.detail) parts.push(e.detail);
  return parts.join(' · ');
}
