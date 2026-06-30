// Share link — local-only: encode the query into the URL hash (no server, privacy-safe per PLAN §9).
// The recipient re-parses locally; nothing sensitive is uploaded.

function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64)));
}

export function buildShareUrl(sql, dialect = 'MariaDB') {
  const payload = JSON.stringify({ v: 1, d: dialect, q: sql });
  const hash = toBase64Url(payload);
  const base = typeof location !== 'undefined' ? location.origin + location.pathname : '';
  return `${base}#q=${hash}`;
}

export function parseShareHash(hash) {
  if (!hash) return null;
  const m = /[#&]q=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    const obj = JSON.parse(fromBase64Url(m[1]));
    if (obj && typeof obj.q === 'string') return { sql: obj.q, dialect: obj.d || 'MariaDB' };
  } catch {
    return null;
  }
  return null;
}
