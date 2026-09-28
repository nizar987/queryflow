import { json } from '@sveltejs/kit';
import { findConnection } from '$lib/server/config.js';
import {
  fetchTableInfo,
  readTablePage,
  writeCell,
  insertTableRow,
  deleteTableRow
} from '$lib/server/runner.js';

// GET  /api/tables/rows?connectionId&table[&offset&limit&orderBy&dir]
//      → metadata (always) + one page of rows
// POST /api/tables/rows   { action: 'update' | 'insert' | 'delete', … }
//      → single-row write, gated on the database's own privilege answer

export async function GET({ url }) {
  const conn = resolve(url.searchParams.get('connectionId'));
  if (conn.error) return conn.error;

  const table = url.searchParams.get('table') || '';
  if (!table) return json({ ok: false, error: 'Parameter table diperlukan.' }, { status: 400 });

  try {
    const info = await fetchTableInfo(conn.value, table, {
      exactCount: url.searchParams.get('count') === 'exact'
    });
    // Paging without ORDER BY is not stable: engines may return rows in any
    // order, and an updated row can move, so pages would skip or repeat rows.
    // Default to the primary key so "every row" really means every row.
    const requested = url.searchParams.get('orderBy') || null;
    const orderBy = requested || info.primaryKey[0] || null;
    const dir = url.searchParams.get('dir') === 'desc' ? 'desc' : 'asc';

    // FK navigation: ?filterColumn=customer_id&filterValue=42 — scopes the
    // page to rows where that column equals that value.
    const filterColumn = url.searchParams.get('filterColumn');
    const filter = filterColumn ? { column: filterColumn, value: url.searchParams.get('filterValue') } : null;

    const page = await readTablePage(conn.value, table, {
      offset: Number(url.searchParams.get('offset') || 0),
      limit: Number(url.searchParams.get('limit') || 200),
      orderBy,
      dir,
      filter
    });

    return json({
      ok: true,
      dialect: conn.value.dialect,
      info,
      page: { ...page, orderBy, dir, orderImplicit: !requested && !!orderBy, filter }
    });
  } catch (e) {
    return json({ ok: false, error: describe(e) }, { status: e.expected ? 400 : 500 });
  }
}

export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: 'Body harus JSON.' }, { status: 400 });
  }

  const conn = resolve(body.connectionId);
  if (conn.error) return conn.error;

  const table = String(body.table || '');
  if (!table) return json({ ok: false, error: 'Parameter table diperlukan.' }, { status: 400 });

  try {
    // Re-check privileges on every write. The client's view of them can be
    // stale, and a GRANT can be revoked between loading the page and saving.
    const info = await fetchTableInfo(conn.value, table);
    const denial = denialReason(info, body.action);
    if (denial === UNKNOWN_ACTION) {
      return json({ ok: false, error: `Aksi "${body.action}" tidak dikenal.` }, { status: 400 });
    }
    if (denial) return json({ ok: false, error: `Tidak diizinkan: ${denial}.` }, { status: 403 });

    let result;
    if (body.action === 'update') {
      result = await writeCell(conn.value, table, {
        keyValues: body.keyValues || {},
        column: body.column,
        value: body.value,
        isNull: !!body.isNull
      });
    } else if (body.action === 'insert') {
      result = await insertTableRow(conn.value, table, body.values || {});
    } else {
      result = await deleteTableRow(conn.value, table, body.keyValues || {});
    }

    return json({ ok: true, ...result, rowCount: info.rowCount });
  } catch (e) {
    return json({ ok: false, error: describe(e) }, { status: clientFault(e) ? 400 : 500 });
  }
}

/**
 * A constraint violation is the user's input being wrong, not the server
 * breaking — those belong in 4xx so they don't read as an app crash.
 */
function clientFault(e) {
  if (!e) return false;
  if (e.expected) return true;
  // Every engine reports constraint/permission problems with a code.
  return !!(e.sqlState || (typeof e.code === 'string' && /^[0-9A-Z_]+$/.test(e.code)));
}

const UNKNOWN_ACTION = Symbol('unknown-action');

/**
 * Why an action is refused, or '' when it is allowed. Each action has its own
 * requirements — reporting the UPDATE reason for a refused INSERT would send
 * the user looking at the wrong grant.
 */
function denialReason(info, action) {
  const needsKey = info.primaryKey.length > 0 ? '' : 'tabel ini tidak punya primary key';
  if (action === 'update') {
    return [needsKey, info.privileges.update ? '' : 'user database tidak punya privilege UPDATE']
      .filter(Boolean).join(' · ');
  }
  if (action === 'insert') {
    // INSERT needs no primary key — the database assigns one.
    return info.privileges.insert ? '' : 'user database tidak punya privilege INSERT';
  }
  if (action === 'delete') {
    return [needsKey, info.privileges.delete ? '' : 'user database tidak punya privilege DELETE']
      .filter(Boolean).join(' · ');
  }
  return UNKNOWN_ACTION;
}

function resolve(connectionId) {
  if (!connectionId) {
    return { error: json({ ok: false, error: 'connectionId diperlukan.' }, { status: 400 }) };
  }
  const conn = findConnection(connectionId);
  if (!conn) {
    return { error: json({ ok: false, error: 'Koneksi tidak ditemukan atau sudah dihapus.' }, { status: 404 }) };
  }
  return { value: conn };
}

function describe(e) {
  if (!e) return 'Kesalahan tidak diketahui.';
  const parts = [e.message || String(e)];
  if (e.sqlState) parts.push(`SQLSTATE ${e.sqlState}`);
  else if (e.code) parts.push(String(e.code));
  if (e.detail) parts.push(e.detail);
  if (e.hint) parts.push(`Petunjuk: ${e.hint}`);
  return parts.join(' · ');
}
