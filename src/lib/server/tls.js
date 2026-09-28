// TLS options, decided once and handed to every driver.
//
// Before this, "Pakai TLS/SSL" meant `rejectUnauthorized: false` — encryption
// with nobody checking who is on the other end, which is exactly what a
// man-in-the-middle needs. The mode now says what is actually verified.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const SSL_MODES = ['disable', 'require', 'verify-ca', 'verify-full'];

export const SSL_MODE_LABELS = {
  disable: 'Nonaktif — koneksi polos',
  require: 'Aktif, tanpa verifikasi — terenkripsi tapi identitas server tidak dicek',
  'verify-ca': 'Verifikasi CA — sertifikat server harus ditandatangani CA yang dipercaya',
  'verify-full': 'Verifikasi CA + hostname — paling aman'
};

/**
 * Old profiles only had `ssl: true|false`. That meant "encrypt, verify nothing",
 * so it maps to `require` — silently upgrading them to verify-full would break
 * every connection using a private CA the moment this shipped.
 */
export function sslModeOf(conn) {
  if (conn.sslMode && SSL_MODES.includes(conn.sslMode)) return conn.sslMode;
  return conn.ssl ? 'require' : 'disable';
}

/** A CA is either a path to a PEM file, or the PEM itself pasted in. */
export function isInlinePem(value) {
  return /-----BEGIN CERTIFICATE-----/.test(String(value || ''));
}

/**
 * @returns {string} PEM text
 * @throws when the file is missing — failing loudly beats silently falling back
 *         to the system CA store and reporting a confusing handshake error.
 */
export function readCa(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isInlinePem(raw)) return raw;
  const path = resolve(raw);
  if (!existsSync(path)) {
    const err = new Error(`File CA tidak ditemukan: ${path}`);
    err.expected = true;
    throw err;
  }
  const text = readFileSync(path, 'utf8');
  if (!isInlinePem(text)) {
    const err = new Error(`File CA ${path} bukan sertifikat PEM (tidak ada -----BEGIN CERTIFICATE-----).`);
    err.expected = true;
    throw err;
  }
  return text;
}

/**
 * Node TLS options for a profile, or null when TLS is off.
 * @returns {{rejectUnauthorized: boolean, ca?: string, checkServerIdentity?: Function, servername?: string} | null}
 */
export function tlsOptions(conn) {
  const mode = sslModeOf(conn);
  if (mode === 'disable') return null;

  if (mode === 'require') {
    return { rejectUnauthorized: false };
  }

  const opts = { rejectUnauthorized: true };
  const ca = readCa(conn.sslCa);
  if (ca) opts.ca = ca;

  if (mode === 'verify-ca') {
    // The chain must be valid; the name on the certificate is allowed not to
    // match. This is the mode for a database reached through a port-forward or
    // an IP, where the hostname can never match whatever the cert says.
    opts.checkServerIdentity = () => undefined;
  } else {
    // pg and ioredis hand these straight to tls.connect, which checks the name
    // itself. mysql2 ignores checkServerIdentity and looks for `verifyIdentity`
    // instead — and skips the check entirely when the host is a bare IP.
    if (conn.host) opts.servername = conn.host;
    opts.verifyIdentity = true;
  }
  return opts;
}

/** One line for the UI: what this profile actually verifies. */
export function describeTls(conn) {
  const mode = sslModeOf(conn);
  return SSL_MODE_LABELS[mode] || mode;
}
