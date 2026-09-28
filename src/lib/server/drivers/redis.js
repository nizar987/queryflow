// Redis driver — read-only queue inspection, not a query runner.
//
// Everything here is a read: SCAN, LRANGE, ZRANGE, HGETALL, INFO. Nothing in
// QueryFlow pops a job, requeues, or deletes — looking at a production queue
// must never change it.
import { Redis, Cluster } from 'ioredis';
import { parseNodes } from '../config.js';
import { tlsOptions } from '../tls.js';
import { overview, listJobs, statesOf } from '../redis/index.js';
import { collectJobs } from '../redis/export.js';

const clients = new Map(); // profileKey -> Redis

function clientFor(conn, key) {
  const existing = clients.get(key);
  if (existing) return existing;

  const common = {
    connectTimeout: 6000,
    commandTimeout: 15000,
    // ioredis retries forever by default; a bad host would leave the request
    // hanging instead of showing the operator what went wrong.
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => (times > 2 ? null : 200),
    enableOfflineQueue: true,
    lazyConnect: true,
    keepAlive: 10000
  };

  const auth = {
    username: conn.user || undefined,
    password: conn.password || undefined,
    tls: tlsOptions(conn) || undefined
  };
  const mode = conn.redisMode || 'standalone';

  let client;
  if (mode === 'cluster') {
    // In cluster mode every key lives on one of several masters, so the client
    // has to know the whole topology — a single address only gets you MOVED.
    client = new Cluster(parseNodes(conn.redisNodes, 6379), {
      redisOptions: { ...common, ...auth, lazyConnect: false },
      clusterRetryStrategy: (times) => (times > 2 ? null : 300),
      enableOfflineQueue: true
    });
  } else if (mode === 'sentinel') {
    // Sentinels are asked which node is currently master; failover then moves
    // the connection for us instead of leaving it pointed at a replica.
    client = new Redis({
      ...common,
      ...auth,
      sentinels: parseNodes(conn.redisNodes, 26379),
      name: conn.sentinelMaster || 'mymaster',
      sentinelPassword: conn.password || undefined,
      db: dbIndex(conn)
    });
  } else if (conn.uri) {
    client = new Redis(conn.uri, common);
  } else {
    client = new Redis({
      ...common,
      ...auth,
      host: conn.host || '127.0.0.1',
      port: Number(conn.port) || 6379,
      db: dbIndex(conn)
    });
  }

  // Without a listener, ioredis turns a dropped connection into an unhandled
  // 'error' event, which takes the whole SvelteKit server down.
  client.on('error', (e) => {
    client.lastError = e;
  });
  // Once a connection is healthy the last failure is history — keeping it would
  // let a stale message masquerade as the cause of a later, unrelated error.
  client.on('ready', () => {
    client.lastError = null;
  });

  clients.set(key, client);
  return client;
}

/** Redis has numbered databases, so the "database" field holds an index. */
function dbIndex(conn) {
  const n = Number(String(conn.database ?? '').trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

async function withClient(conn, key, fn) {
  const client = clientFor(conn, key);
  try {
    return await fn(client);
  } catch (e) {
    // ioredis reports a dead server as "Reached the max retries per request
    // limit", which says nothing about *why*. The connection-level error does.
    if (client.lastError && /stream|closed|connection|max retries/i.test(e.message || '')) {
      throw client.lastError;
    }
    throw e;
  }
}

export async function ping(conn, key) {
  return withClient(conn, key, async (client) => {
    const raw = await infoTarget(client).info('server');
    const info = parseInfo(raw);
    const mode = info.redis_mode && info.redis_mode !== 'standalone' ? ` (${info.redis_mode})` : '';
    const nodes = typeof client.nodes === 'function' ? ` · ${client.nodes('master').length} master` : '';
    return { version: `Redis ${info.redis_version || 'unknown'}${mode}${nodes}` };
  });
}

export async function queueOverview(conn, key) {
  return withClient(conn, key, async (client) => {
    const [data, server] = await Promise.all([overview(client), serverStats(client)]);
    return { ...data, server };
  });
}

export async function queueJobs(conn, key, params) {
  return withClient(conn, key, (client) => listJobs(client, params));
}

export async function queueJobsForExport(conn, key, params) {
  return withClient(conn, key, (client) => collectJobs(client, params));
}

export function queueStates(system) {
  return statesOf(system);
}

/**
 * INFO is per node, so on a cluster it has to be asked of a specific master —
 * calling it on the cluster client itself is not routable.
 */
function infoTarget(client) {
  if (typeof client.nodes === 'function') {
    const masters = client.nodes('master');
    if (masters.length) return masters[0];
  }
  return client;
}

/** Headline numbers an operator checks before blaming the workers. */
async function serverStats(client) {
  const raw = await infoTarget(client).info();
  const i = parseInfo(raw);
  const used = Number(i.used_memory);
  const max = Number(i.maxmemory);
  return {
    version: i.redis_version || '',
    mode: i.redis_mode || 'standalone',
    uptimeSec: Number(i.uptime_in_seconds) || null,
    clients: Number(i.connected_clients) || 0,
    blockedClients: Number(i.blocked_clients) || 0,
    usedMemory: Number.isFinite(used) ? used : null,
    usedMemoryHuman: i.used_memory_human || '',
    maxMemory: Number.isFinite(max) && max > 0 ? max : null,
    evictedKeys: Number(i.evicted_keys) || 0,
    // Jobs vanishing from a queue with no worker touching them is almost always
    // eviction under maxmemory — worth showing before anyone reads code.
    evictionPolicy: i.maxmemory_policy || '',
    keyspaceHits: Number(i.keyspace_hits) || 0,
    keyspaceMisses: Number(i.keyspace_misses) || 0,
    opsPerSec: Number(i.instantaneous_ops_per_sec) || 0
  };
}

function parseInfo(raw) {
  const out = {};
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const idx = t.indexOf(':');
    if (idx > 0) out[t.slice(0, idx)] = t.slice(idx + 1);
  }
  return out;
}

export function dispose(key) {
  const client = clients.get(key);
  if (!client) return;
  clients.delete(key);
  try {
    client.disconnect();
  } catch (e) {
    /* already gone */
  }
}
