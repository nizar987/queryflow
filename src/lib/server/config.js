// Connection profiles live in a file on the machine running the server, never
// in the browser: passwords must not sit in localStorage or travel in a URL.
// The client only ever sees the redacted shape returned by `publicView()`.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SSL_MODES, sslModeOf, isInlinePem, readCa } from './tls.js';
import { DEFAULT_QUERY_TIMEOUT_SEC, MAX_QUERY_TIMEOUT_SEC } from './run-control.js';

const DEFAULT_PATH = '.queryflow/connections.json';

export function configPath() {
  return resolve(process.env.QUERYFLOW_CONFIG || DEFAULT_PATH);
}

export const DIALECTS = ['MariaDB', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis'];

/** Redis holds queues, not tables — the Query/Tables tabs skip these. */
export const QUEUE_DIALECTS = ['Redis'];

/** How a Redis deployment is reached. Standalone covers a plain host:port. */
export const REDIS_MODES = ['standalone', 'sentinel', 'cluster'];

/**
 * "host:port, host2:port2" → [{host, port}]. Sentinel and Cluster are lists of
 * entry points, not a single address, and a typo here reads as "connection
 * refused" much later.
 */
export function parseNodes(text, defaultPort = 6379) {
  return String(text || '')
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(part);
      if (!m) return null;
      const port = m[2] ? Number(m[2]) : defaultPort;
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      return { host: m[1], port };
    })
    .filter(Boolean);
}

const DEFAULT_PORT = { MariaDB: 3306, MySQL: 3306, PostgreSQL: 5432, MongoDB: 27017, Redis: 6379 };

/** @returns {{connections: any[]}} */
export function readConfig() {
  const path = configPath();
  if (!existsSync(path)) return { connections: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    const list = Array.isArray(parsed && parsed.connections) ? parsed.connections : [];
    return { connections: list.filter((c) => c && c.id) };
  } catch (e) {
    // A corrupt file must not take the whole app down — surface it as empty and
    // let the caller report the parse error.
    const err = new Error(`Gagal membaca ${path}: ${e.message}`);
    err.code = 'CONFIG_UNREADABLE';
    throw err;
  }
}

function writeConfig(cfg) {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });

  // Write beside the file and rename over it. Writing in place truncates first,
  // so a crash mid-write would leave a half-written file — and this file holds
  // every stored password. rename() is atomic on POSIX: readers see either the
  // old file or the new one, never a fragment.
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  try {
    chmodSync(tmp, 0o600); // owner-only, set before it becomes the real file
  } catch (e) {
    /* best effort — some filesystems (e.g. mounted volumes) reject chmod */
  }
  renameSync(tmp, path);
}

/** Strip secrets before anything crosses the network boundary to the browser. */
export function publicView(c) {
  return {
    id: c.id,
    name: c.name,
    dialect: c.dialect,
    host: c.host || '',
    port: c.port || DEFAULT_PORT[c.dialect] || null,
    database: c.database || '',
    user: c.user || '',
    ssl: sslModeOf(c) !== 'disable',
    sslMode: sslModeOf(c),
    // The CA is not a secret, but a pasted PEM is noise in the UI — the browser
    // only needs to know whether one is set, and the path when it is a path.
    sslCa: isInlinePem(c.sslCa) ? '' : String(c.sslCa || ''),
    hasInlineCa: isInlinePem(c.sslCa),
    readOnly: !!c.readOnly,
    queryTimeoutSec: Number.isInteger(c.queryTimeoutSec) ? c.queryTimeoutSec : DEFAULT_QUERY_TIMEOUT_SEC,
    redisMode: c.redisMode || 'standalone',
    redisNodes: c.redisNodes || '',
    sentinelMaster: c.sentinelMaster || '',
    hasPassword: !!c.password,
    uri: c.uri ? maskUri(c.uri) : ''
  };
}

/** mongodb://user:secret@host/db → mongodb://user:***@host/db */
function maskUri(uri) {
  return String(uri).replace(/(\/\/[^:/@]+:)[^@]*(@)/, '$1***$2');
}

export function findConnection(id) {
  return readConfig().connections.find((c) => c.id === id) || null;
}

/**
 * Validate a profile coming from the client.
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function validate(input, { existing = null } = {}) {
  const name = String(input.name || '').trim();
  if (!name) return { ok: false, error: 'Nama koneksi wajib diisi.' };

  const dialect = String(input.dialect || '');
  if (!DIALECTS.includes(dialect)) {
    return { ok: false, error: `Dialek tidak dikenal: ${dialect || '(kosong)'}.` };
  }

  const uri = String(input.uri || '').trim();
  const host = String(input.host || '').trim();
  if (!uri && !host) return { ok: false, error: 'Isi host, atau connection URI.' };

  let port = input.port === '' || input.port == null ? DEFAULT_PORT[dialect] : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Port harus bilangan 1–65535.' };
  }

  const database = String(input.database || '').trim();
  if (dialect === 'PostgreSQL' && !uri && !database) {
    return { ok: false, error: 'PostgreSQL membutuhkan nama database.' };
  }
  // Redis addresses databases by number, so a typo here silently points the
  // whole queue view at an empty db rather than failing to connect.
  if (dialect === 'Redis' && database && !/^\d+$/.test(database)) {
    return { ok: false, error: 'Database Redis berupa angka indeks (0–15), mis. 0.' };
  }

  const redisMode = String(input.redisMode || existing?.redisMode || 'standalone');
  const redisNodes = String(input.redisNodes ?? existing?.redisNodes ?? '').trim();
  const sentinelMaster = String(input.sentinelMaster ?? existing?.sentinelMaster ?? '').trim();
  if (dialect === 'Redis') {
    if (!REDIS_MODES.includes(redisMode)) {
      return { ok: false, error: `Mode Redis tidak dikenal: ${redisMode}.` };
    }
    if (redisMode !== 'standalone') {
      const nodes = parseNodes(redisNodes, redisMode === 'sentinel' ? 26379 : 6379);
      if (nodes.length === 0) {
        return {
          ok: false,
          error: `Mode ${redisMode} membutuhkan daftar node, mis. "host-a:${redisMode === 'sentinel' ? 26379 : 6379}, host-b:${redisMode === 'sentinel' ? 26379 : 6379}".`
        };
      }
      if (redisMode === 'sentinel' && !sentinelMaster) {
        return { ok: false, error: 'Sentinel membutuhkan nama master (mis. mymaster).' };
      }
    }
  }

  // A statement left running on production is the failure this limit exists
  // for, so a missing value means the default, never "unlimited".
  const rawTimeout = input.queryTimeoutSec ?? existing?.queryTimeoutSec;
  const queryTimeoutSec =
    rawTimeout === '' || rawTimeout == null ? DEFAULT_QUERY_TIMEOUT_SEC : Number(rawTimeout);
  if (!Number.isInteger(queryTimeoutSec) || queryTimeoutSec < 0 || queryTimeoutSec > MAX_QUERY_TIMEOUT_SEC) {
    return { ok: false, error: `Batas waktu query harus bilangan bulat 0–${MAX_QUERY_TIMEOUT_SEC} detik (0 = tanpa batas).` };
  }

  const sslMode = String(input.sslMode || (input.ssl ? 'require' : 'disable'));
  if (!SSL_MODES.includes(sslMode)) {
    return { ok: false, error: `Mode TLS tidak dikenal: ${sslMode}.` };
  }
  // "Empty means keep" applies only to an inline PEM, because that is the one
  // value the browser never receives and therefore cannot echo back. A CA
  // *path* is sent to the browser, so clearing that field has to mean clearing
  // it — otherwise a CA can be added but never removed.
  const storedCa = existing ? existing.sslCa || '' : '';
  const sslCaInput =
    input.sslCa == null || input.sslCa === ''
      ? isInlinePem(storedCa)
        ? storedCa
        : ''
      : String(input.sslCa);
  if (sslMode.startsWith('verify') && sslCaInput) {
    // Catch a wrong path now, while the user is looking at the field, instead
    // of as a handshake failure later.
    try {
      readCa(sslCaInput);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // An empty password field on edit means "keep the stored one", not "clear it" —
  // the client never receives the existing password, so it cannot echo it back.
  const password =
    input.password === '' || input.password == null
      ? existing
        ? existing.password || ''
        : ''
      : String(input.password);

  return {
    ok: true,
    value: {
      id: existing ? existing.id : randomUUID(),
      name,
      dialect,
      host,
      port,
      database,
      user: String(input.user || '').trim(),
      password,
      ssl: sslMode !== 'disable',
      sslMode,
      sslCa: sslCaInput,
      // Enforced on the server for every write path — a flag the browser could
      // flip on its own would protect nothing.
      readOnly: !!input.readOnly,
      queryTimeoutSec,
      redisMode,
      redisNodes,
      sentinelMaster,
      uri
    }
  };
}

export function createConnection(input) {
  const v = validate(input);
  if (!v.ok) return v;
  const cfg = readConfig();
  cfg.connections.push(v.value);
  writeConfig(cfg);
  return { ok: true, value: v.value };
}

export function updateConnection(id, input) {
  const cfg = readConfig();
  const i = cfg.connections.findIndex((c) => c.id === id);
  if (i === -1) return { ok: false, error: 'Koneksi tidak ditemukan.' };
  const v = validate(input, { existing: cfg.connections[i] });
  if (!v.ok) return v;
  cfg.connections[i] = v.value;
  writeConfig(cfg);
  return { ok: true, value: v.value };
}

export function deleteConnection(id) {
  const cfg = readConfig();
  const next = cfg.connections.filter((c) => c.id !== id);
  if (next.length === cfg.connections.length) return { ok: false, error: 'Koneksi tidak ditemukan.' };
  writeConfig({ ...cfg, connections: next });
  return { ok: true };
}
