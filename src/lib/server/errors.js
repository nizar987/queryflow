/**
 * Turn a driver error into one line an operator can act on. Redis and the SQL
 * drivers all attach their detail to different fields, so the message alone is
 * frequently useless ("connect ECONNREFUSED" without the address).
 */
export function describeError(e) {
  if (!e) return 'Kesalahan tidak diketahui.';
  // A cancel or time-out already explains itself; its code is for the page.
  if (e.code === 'QUERY_TIMEOUT' || e.code === 'QUERY_CANCELLED') return e.message;
  const parts = [e.message || String(e)];
  if (e.sqlState) parts.push(`SQLSTATE ${e.sqlState}`);
  else if (e.code && !String(e.message || '').includes(e.code)) parts.push(String(e.code));
  return parts.join(' · ');
}

/**
 * A failed statement from the Query tab, with whatever position, detail and
 * hint the engine attached — the parts that say *where* it went wrong.
 * @param {any} e
 * @returns {string}
 */
export function describeQueryError(e) {
  if (!e) return 'Kesalahan tidak diketahui.';
  // A cancel or time-out already explains itself; its code is for the page.
  if (e.code === 'QUERY_TIMEOUT' || e.code === 'QUERY_CANCELLED') return e.message;
  const parts = [e.message || String(e)];
  // Engines put the useful detail in different places.
  if (e.sqlState) parts.push(`SQLSTATE ${e.sqlState}`);
  else if (e.code) parts.push(String(e.code));
  if (e.position) parts.push(`posisi ${e.position}`);
  if (e.detail) parts.push(e.detail);
  if (e.hint) parts.push(`Petunjuk: ${e.hint}`);
  return parts.join(' · ');
}

/** 'QUERY_CANCELLED' | 'QUERY_TIMEOUT' | null — lets the page tell a stop from a failure. */
export function stopCodeOf(e) {
  return e && (e.code === 'QUERY_CANCELLED' || e.code === 'QUERY_TIMEOUT') ? e.code : null;
}
