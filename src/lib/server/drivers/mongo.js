// MongoDB driver — executes the parsed db.<coll>.<method>() command.
import { MongoClient, ObjectId } from 'mongodb';
import { toGrid, encodeCell } from './cells.js';
import { parseCommand, WRITE_METHODS } from './mongo-command.js';
import { assertIdent, assertColumn, assertKeyComplete, assertSingleRow } from './identifiers.js';
import { tlsOptions, sslModeOf } from '../tls.js';

const clients = new Map(); // profileKey -> { client, dbName }

function uriFor(conn) {
  if (conn.uri) return conn.uri;
  const auth = conn.user ? `${encodeURIComponent(conn.user)}:${encodeURIComponent(conn.password || '')}@` : '';
  const opts = sslModeOf(conn) === 'disable' ? '' : '?tls=true';
  return `mongodb://${auth}${conn.host}:${conn.port}/${opts}`;
}

/**
 * The Mongo driver spells TLS verification with its own flags rather than the
 * Node TLS ones, so the shared options are translated here instead of being
 * passed through.
 */
function mongoTls(conn) {
  const tls = tlsOptions(conn);
  if (!tls) return {};
  const mode = sslModeOf(conn);
  const opts = { tls: true };
  if (tls.ca) opts.ca = tls.ca;
  if (mode === 'require') {
    opts.tlsAllowInvalidCertificates = true;
    opts.tlsAllowInvalidHostnames = true;
  } else if (mode === 'verify-ca') {
    opts.tlsAllowInvalidHostnames = true;
  }
  return opts;
}

async function clientFor(conn, key) {
  let entry = clients.get(key);
  if (entry) return entry;
  const client = new MongoClient(uriFor(conn), { serverSelectionTimeoutMS: 8000, ...mongoTls(conn) });
  await client.connect();
  entry = { client, dbName: conn.database || undefined };
  clients.set(key, entry);
  return entry;
}

export async function ping(conn, key) {
  const { client, dbName } = await clientFor(conn, key);
  const info = await client.db(dbName || 'admin').command({ buildInfo: 1 });
  return { version: info.version ? `MongoDB ${info.version}` : 'MongoDB' };
}

/**
 * Find this run's operations by the comment they were tagged with and kill
 * them. Without allUsers, $currentOp lists only this user's own operations,
 * which needs no extra privilege and is exactly the set that can be ours.
 */
/** @param {import('mongodb').MongoClient} client @param {string} tag */
async function killTagged(client, tag) {
  // An empty tag would match every untagged operation of this user.
  if (!tag) throw new Error('Operasi tanpa penanda tidak bisa dihentikan.');
  const admin = client.db('admin');
  const ops = await admin
    .aggregate([{ $currentOp: { allUsers: false } }, { $match: { 'command.comment': tag } }])
    .toArray();
  if (ops.length === 0) {
    throw new Error('Operasi ini tidak bisa dihentikan dari QueryFlow (hanya find, aggregate, count, dan distinct).');
  }
  for (const op of ops) await admin.command({ killOp: 1, op: op.opid });
}

/**
 * The Mongo client is shared, so a "session" here only carries the cancel
 * wiring: every read in the run is tagged, and a cancel kills what has the tag.
 * @param {any} conn
 * @param {string} key
 * @param {import('../run-control.js').RunControl | null} [control]
 */
export async function openSession(conn, key, control = null) {
  const { client, dbName } = await clientFor(conn, key);
  const tag = control ? control.tag : null;
  if (control && tag) control.onCancel(() => killTagged(client, tag));
  return {
    /** @param {string} text @param {{ maxRows: number }} opts */
    async run(text, { maxRows }) {
      control?.throwIfCancelled();
      return execute(client, dbName, text, maxRows, tag);
    },
    async close() {
      await control?.settled();
    }
  };
}

/**
 * @param {any} conn
 * @param {string} key
 * @param {string} text
 * @param {{ maxRows: number, control?: import('../run-control.js').RunControl | null }} opts
 */
export async function run(conn, key, text, { maxRows, control = null }) {
  // A parse problem needs no connection — report it before opening one.
  const cmd = parseCommand(text);
  if (!cmd.ok) throw Object.assign(new Error(cmd.error), { expected: true });
  const session = await openSession(conn, key, control);
  try {
    return await session.run(text, { maxRows });
  } finally {
    await session.close();
  }
}

/**
 * @param {import('mongodb').MongoClient} client
 * @param {string} dbName
 * @param {string} text
 * @param {number} maxRows
 * @param {string | null} tag
 */
async function execute(client, dbName, text, maxRows, tag) {
  const cmd = parseCommand(text);
  if (!cmd.ok) {
    const err = new Error(cmd.error);
    err.expected = true; // a parse problem, not an infrastructure failure
    throw err;
  }
  if (!dbName) {
    const err = new Error('Koneksi ini belum punya nama database. Isi di pengaturan koneksi.');
    err.expected = true;
    throw err;
  }
  const coll = client.db(dbName).collection(cmd.collection);
  const { method, args, modifiers } = cmd;

  // Reads carry a tag so a cancel can find them among the server's operations.
  const tagged = (opts) => (tag ? { ...(opts || {}), comment: tag } : opts);
  const started = Date.now();

  const done = (payload) => ({
    columns: [],
    rows: [],
    rowCount: 0,
    truncated: false,
    affectedRows: null,
    command: `${cmd.collection}.${method}`,
    durationMs: Date.now() - started,
    ...payload
  });

  const docsResult = async (docs, total) => {
    const capped = docs.slice(0, maxRows);
    return done({
      kind: 'rows',
      ...toGrid(capped),
      rowCount: total != null ? total : docs.length,
      truncated: docs.length > capped.length
    });
  };

  switch (method) {
    case 'find': {
      let cursor = coll.find(args[0] || {}, tagged(args[1] ? { projection: args[1] } : undefined));
      if (modifiers.project) cursor = cursor.project(modifiers.project);
      if (modifiers.sort) cursor = cursor.sort(modifiers.sort);
      if (modifiers.skip) cursor = cursor.skip(Number(modifiers.skip));
      if (modifiers.count) return done({ kind: 'rows', ...toGrid([{ count: await coll.countDocuments(args[0] || {}, tagged()) }]), rowCount: 1 });
      // Fetch one past the cap so "truncated" is accurate without reading it all.
      // MongoDB limit(0) means no limit; Infinity is not a valid argument.
      const mongoLimit = modifiers.limit ? Number(modifiers.limit) : (Number.isFinite(maxRows) ? maxRows + 1 : 0);
      cursor = cursor.limit(mongoLimit);
      return docsResult(await cursor.toArray());
    }
    case 'findOne': {
      const doc = await coll.findOne(args[0] || {}, tagged(args[1] ? { projection: args[1] } : undefined));
      return docsResult(doc ? [doc] : []);
    }
    case 'aggregate': {
      const pipeline = Array.isArray(args[0]) ? args[0] : [];
      const docs = await coll.aggregate(pipeline, tagged(args[1] || undefined)).toArray();
      return docsResult(docs);
    }
    case 'countDocuments':
      return done({ kind: 'rows', ...toGrid([{ count: await coll.countDocuments(args[0] || {}, tagged()) }]), rowCount: 1 });
    case 'estimatedDocumentCount':
      return done({ kind: 'rows', ...toGrid([{ count: await coll.estimatedDocumentCount(tagged()) }]), rowCount: 1 });
    case 'distinct': {
      const values = await coll.distinct(String(args[0] || ''), args[1] || {}, tagged());
      return docsResult(values.map((v) => ({ value: v })));
    }
    case 'listIndexes':
      return docsResult(await coll.listIndexes().toArray());
    default:
      return done(await runWrite(coll, method, args, done));
  }
}

async function runWrite(coll, method, args) {
  const r = await callWrite(coll, method, args);
  if (r && typeof r === 'object' && 'acknowledged' in r) {
    const affected =
      r.modifiedCount ?? r.deletedCount ?? r.insertedCount ?? (r.insertedId ? 1 : null) ?? r.upsertedCount ?? null;
    return {
      kind: 'ack',
      affectedRows: affected,
      info: summarize(r)
    };
  }
  // findOneAndUpdate & friends return the document itself
  if (r && typeof r === 'object') {
    const doc = r.value !== undefined ? r.value : r;
    return { kind: 'rows', ...toGrid(doc ? [doc] : []), rowCount: doc ? 1 : 0 };
  }
  return { kind: 'ack', affectedRows: null, info: String(r) };
}

function callWrite(coll, method, args) {
  switch (method) {
    case 'insertOne': return coll.insertOne(args[0]);
    case 'insertMany': return coll.insertMany(args[0] || []);
    case 'updateOne': return coll.updateOne(args[0] || {}, args[1] || {}, args[2]);
    case 'updateMany': return coll.updateMany(args[0] || {}, args[1] || {}, args[2]);
    case 'replaceOne': return coll.replaceOne(args[0] || {}, args[1] || {}, args[2]);
    case 'deleteOne': return coll.deleteOne(args[0] || {});
    case 'deleteMany': return coll.deleteMany(args[0] || {});
    case 'findOneAndUpdate': return coll.findOneAndUpdate(args[0] || {}, args[1] || {}, args[2]);
    case 'findOneAndReplace': return coll.findOneAndReplace(args[0] || {}, args[1] || {}, args[2]);
    case 'findOneAndDelete': return coll.findOneAndDelete(args[0] || {}, args[1]);
    case 'bulkWrite': return coll.bulkWrite(args[0] || []);
    case 'createIndex': return coll.createIndex(args[0] || {}, args[1]);
    case 'dropIndex': return coll.dropIndex(String(args[0] || ''));
    case 'drop': return coll.drop();
    default: throw new Error(`Method "${method}" tidak diimplementasi.`);
  }
}

function summarize(r) {
  const bits = [];
  for (const k of ['insertedCount', 'matchedCount', 'modifiedCount', 'upsertedCount', 'deletedCount']) {
    if (typeof r[k] === 'number') bits.push(`${k}: ${r[k]}`);
  }
  if (r.insertedId) bits.push(`insertedId: ${encodeCell(r.insertedId).v}`);
  return bits.join(', ');
}

/**
 * Live operations + connection counters.
 * Both currentOp and serverStatus need cluster-level privileges; when they are
 * refused we still return the half that worked rather than failing the tab.
 */
export async function processList(conn, key) {
  const { client, dbName } = await clientFor(conn, key);
  const admin = client.db('admin');

  let processes = [];
  let opsError = null;
  try {
    // $all:false skips idle connections and internal system threads.
    const res = await admin.command({ currentOp: 1, $all: false });
    processes = (res.inprog || []).map((op) => ({
      id: String(op.opid ?? ''),
      // currentOp with $all:false already excludes idle connections.
      busy: op.active !== false,
      internal: typeof op.desc === 'string' && !op.desc.startsWith('conn'),
      user: (op.effectiveUsers && op.effectiveUsers[0] && op.effectiveUsers[0].user) || op.desc || '',
      client: op.client || op.client_s || '',
      db: op.ns || '',
      command: op.op || '',
      state: [op.waitingForLock ? 'waiting for lock' : '', op.planSummary || ''].filter(Boolean).join(' · '),
      seconds: typeof op.secs_running === 'number' ? op.secs_running : null,
      query: op.command ? JSON.stringify(op.command) : ''
    }));
  } catch (e) {
    opsError = e.message;
  }

  let counts = null;
  let statusError = null;
  try {
    const st = await admin.command({ serverStatus: 1 });
    counts = st.connections || null;
  } catch (e) {
    statusError = e.message;
  }

  const extra = [];
  if (counts) {
    extra.push({ label: 'Total dibuat', value: counts.totalCreated ?? '—' });
    if (counts.threaded != null) extra.push({ label: 'Threaded', value: counts.threaded });
  }
  if (opsError) extra.push({ label: 'currentOp ditolak', value: opsError, warn: true });
  if (statusError) extra.push({ label: 'serverStatus ditolak', value: statusError, warn: true });

  const total = counts ? counts.current ?? 0 : processes.length;
  const active = counts && counts.active != null ? counts.active : processes.length;

  return {
    processes,
    summary: {
      total,
      active,
      idle: Math.max(0, total - active),
      // `available` is remaining, so the ceiling is current + available.
      max: counts && counts.available != null ? total + counts.available : null,
      idleLabel: 'idle',
      extra,
      partial: !!opsError,
      note: dbName ? '' : 'Koneksi ini belum punya nama database, tapi processlist tetap dibaca dari admin.'
    }
  };
}

export function dispose(key) {
  const entry = clients.get(key);
  if (!entry) return;
  clients.delete(key);
  entry.client.close().catch(() => {});
}

export { WRITE_METHODS };

/** List all collections in the database (MongoDB equivalent of tables). */
export async function listTables(conn, key) {
  const { client, dbName } = await clientFor(conn, key);
  if (!dbName) {
    throw Object.assign(new Error('Koneksi ini belum punya nama database.'), { expected: true });
  }
  const db   = client.db(dbName);
  const cols = await db.listCollections({}, { nameOnly: false }).toArray();
  return cols
    .filter((c) => c.type === 'collection' || !c.type)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ name: c.name, approxRows: null, comment: '' }));
}

/** Return up to 1 000 documents from the named collection. */
export async function previewTable(conn, key, table) {
  if (!/^[\w\-. ]+$/.test(table)) {
    throw Object.assign(new Error('Nama koleksi tidak valid.'), { expected: true });
  }
  const { client, dbName } = await clientFor(conn, key);
  if (!dbName) {
    throw Object.assign(new Error('Koneksi ini belum punya nama database.'), { expected: true });
  }
  const started = Date.now();
  const docs    = await client.db(dbName).collection(table).find({}).limit(1000).toArray();
  const durationMs = Date.now() - started;
  const grid    = toGrid(docs);
  return {
    kind: 'rows', ...grid,
    rowCount:     docs.length,
    truncated:    docs.length >= 1000,
    affectedRows: null,
    command:      'find',
    durationMs
  };
}

// ---------------------------------------------------------------------------
// Collection browser: metadata, paged reads, and single-document writes.
// ---------------------------------------------------------------------------

/** Documents have no fixed schema, so columns are derived from a sample. */
async function sampleFields(coll, limit = 200) {
  const docs = await coll.find({}).limit(limit).toArray();
  const names = [];
  const types = new Map();
  for (const d of docs) {
    for (const [k, v] of Object.entries(d || {})) {
      if (!names.includes(k)) names.push(k);
      if (!types.has(k)) types.set(k, v === null ? 'null' : (v?.constructor?.name || typeof v));
    }
  }
  return names.map((n) => ({ name: n, type: types.get(n) || 'mixed' }));
}

/**
 * What the authenticated user may do to this collection.
 * With auth disabled there is no user at all — everything is permitted, and
 * reporting "no privileges" would wrongly lock the editor for local dev.
 */
async function privilegesFor(client, dbName, table) {
  const all = { select: true, insert: true, update: true, delete: true };
  let status;
  try {
    status = await client.db('admin').command({ connectionStatus: 1, showPrivileges: true });
  } catch (e) {
    return all; // cannot introspect — let the write itself be the authority
  }
  const info = status.authInfo || {};
  if (!Array.isArray(info.authenticatedUsers) || info.authenticatedUsers.length === 0) {
    return all; // unauthenticated connection to an auth-less server
  }

  const ACTION = { find: 'select', insert: 'insert', update: 'update', remove: 'delete' };
  const out = { select: false, insert: false, update: false, delete: false };
  for (const p of info.authenticatedUserPrivileges || []) {
    const r = p.resource || {};
    const matches =
      r.anyResource ||
      (r.db === '' && r.collection === '') ||
      (r.db === dbName && (r.collection === '' || r.collection === table));
    if (!matches) continue;
    for (const a of p.actions || []) if (ACTION[a]) out[ACTION[a]] = true;
  }
  return out;
}

export async function tableInfo(conn, key, table, { exactCount = false } = {}) {
  assertIdent(table, 'Nama koleksi');
  const { client, dbName } = await clientFor(conn, key);
  if (!dbName) {
    throw Object.assign(new Error('Koneksi ini belum punya nama database.'), { expected: true });
  }
  const coll = client.db(dbName).collection(table);

  const fields = await sampleFields(coll);
  const names = fields.map((f) => f.name);
  if (!names.includes('_id')) names.unshift('_id');

  return {
    columns: names.map((n) => ({
      name: n,
      type: (fields.find((f) => f.name === n) || {}).type || 'mixed',
      nullable: n !== '_id',
      default: null,
      isPk: n === '_id',
      // _id is assigned by the server when omitted, like an auto-increment key.
      isGenerated: n === '_id',
      maxLength: null
    })),
    primaryKey: ['_id'],
    foreignKeys: [], // no enforced references in MongoDB — nothing to detect
    privileges: await privilegesFor(client, dbName, table),
    // countDocuments() runs a full scan; estimatedDocumentCount() reads metadata.
    totalRows: exactCount ? await coll.countDocuments({}) : null,
    approxRows: await coll.estimatedDocumentCount().catch(() => null),
    // Column set comes from a sample, so late fields may be missing.
    columnsFromSample: true
  };
}

export async function readTable(conn, key, table, { offset = 0, limit = 200, orderBy = null, dir = 'asc' } = {}) {
  assertIdent(table, 'Nama koleksi');
  const { client, dbName } = await clientFor(conn, key);
  const coll = client.db(dbName).collection(table);

  const lim = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 200)));
  const off = Math.max(0, Math.floor(Number(offset) || 0));

  const started = Date.now();
  let cursor = coll.find({});
  if (orderBy) cursor = cursor.sort({ [assertColumn(orderBy)]: dir === 'desc' ? -1 : 1 });
  const docs = await cursor.skip(off).limit(lim).toArray();
  const durationMs = Date.now() - started;

  return { kind: 'rows', ...toGrid(docs), offset: off, limit: lim, durationMs };
}

/** `_id` arrives as a string from the browser; restore the real BSON type. */
function reviveId(v) {
  if (typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v)) {
    try {
      return new ObjectId(v);
    } catch (e) {
      return v;
    }
  }
  return v;
}

export async function updateCell(conn, key, table, { keyValues, column, value, isNull }) {
  assertIdent(table, 'Nama koleksi');
  assertColumn(column);
  if (column === '_id') {
    throw Object.assign(new Error('_id tidak bisa diubah — hapus lalu buat ulang dokumennya.'), { expected: true });
  }
  const { client, dbName } = await clientFor(conn, key);
  assertKeyComplete(['_id'], keyValues);

  const res = await client
    .db(dbName)
    .collection(table)
    .updateOne({ _id: reviveId(keyValues._id) }, { $set: { [column]: isNull ? null : value } });
  assertSingleRow(res.matchedCount);
  return { affectedRows: res.modifiedCount };
}

export async function insertRow(conn, key, table, values) {
  assertIdent(table, 'Nama koleksi');
  const { client, dbName } = await clientFor(conn, key);
  const doc = { ...(values || {}) };
  if (doc._id !== undefined) doc._id = reviveId(doc._id);
  const res = await client.db(dbName).collection(table).insertOne(doc);
  return { affectedRows: 1, insertId: res.insertedId ? String(res.insertedId) : null };
}

export async function deleteRow(conn, key, table, keyValues) {
  assertIdent(table, 'Nama koleksi');
  const { client, dbName } = await clientFor(conn, key);
  assertKeyComplete(['_id'], keyValues);
  const res = await client
    .db(dbName)
    .collection(table)
    .deleteOne({ _id: reviveId(keyValues._id) });
  assertSingleRow(res.deletedCount);
  return { affectedRows: res.deletedCount };
}

/**
 * db.<coll>.find(...).explain('executionStats') / aggregate(...).explain(...).
 * Mongo's explain always executes the read stages to gather stats — there is
 * no plan-only mode that also reports actual doc counts, unlike SQL's
 * EXPLAIN. It never writes, so this is still read-only regardless of method;
 * write methods (insertOne, updateMany, …) are rejected before reaching here.
 *
 * NOTE: built from MongoDB's documented explain() API — this environment has
 * no running mongod to verify against, unlike the MySQL/Postgres paths above.
 */
export async function explainQuery(conn, key, text) {
  const cmd = parseCommand(text);
  if (!cmd.ok) throw Object.assign(new Error(cmd.error), { expected: true });
  if (WRITE_METHODS.has(cmd.method)) {
    throw Object.assign(new Error(`explain hanya untuk operasi baca — "${cmd.method}" adalah operasi tulis.`), { expected: true });
  }

  const { client, dbName } = await clientFor(conn, key);
  if (!dbName) throw Object.assign(new Error('Koneksi ini belum punya nama database.'), { expected: true });
  const coll = client.db(dbName).collection(cmd.collection);
  const { method, args, modifiers } = cmd;

  if (method === 'find') {
    let cursor = coll.find(args[0] || {}, args[1] ? { projection: args[1] } : undefined);
    if (modifiers.sort) cursor = cursor.sort(modifiers.sort);
    if (modifiers.skip) cursor = cursor.skip(Number(modifiers.skip));
    if (modifiers.limit) cursor = cursor.limit(Number(modifiers.limit));
    return cursor.explain('executionStats');
  }
  if (method === 'aggregate') {
    const pipeline = Array.isArray(args[0]) ? args[0] : [];
    return coll.aggregate(pipeline).explain('executionStats');
  }
  if (method === 'countDocuments' || method === 'distinct') {
    // Both are find()-backed under the hood; explain the equivalent find.
    return coll.find(args[0] || {}).explain('executionStats');
  }
  throw Object.assign(new Error(`explain belum didukung untuk method "${method}".`), { expected: true });
}

/**
 * Existing indexes per collection. Mongo reports these directly, so unlike the
 * SQL drivers there is no catalog query to get wrong — but a collection that
 * does not exist throws, and one missing collection must not blank the list.
 */
export async function listIndexes(conn, key, collections) {
  const { client, dbName } = await clientFor(conn, key);
  const db = client.db(dbName);
  const names = [...new Set(collections.map((c) => String(c || '').trim()).filter(Boolean))];

  const out = [];
  for (const name of names) {
    let specs;
    try {
      specs = await db.collection(name).indexes();
    } catch (e) {
      continue; // collection gone or unreadable — the others still count
    }
    out.push(...normalizeIndexSpecs(name, specs));
  }
  return out;
}

/**
 * Index specs as Mongo reports them → the shape the advisor compares against.
 * Separated from the driver call so the mapping can be tested without a live
 * server: `key` values are 1/-1 for ordinary indexes but strings ('text',
 * '2dsphere', 'hashed') for the special ones, which have no direction at all.
 * @param {string} collection
 * @param {Array<{name: string, key: object, unique?: boolean}>} specs
 */
export function normalizeIndexSpecs(collection, specs) {
  return (specs || []).map((spec) => {
    const key = spec.key || {};
    const special = Object.values(key).find((v) => typeof v === 'string');
    return {
      table: collection,
      name: spec.name,
      unique: !!spec.unique,
      primary: spec.name === '_id_',
      type: special ? String(special) : 'btree',
      cardinality: null,
      columns: Object.entries(key).map(([field, dir]) => ({
        name: field,
        // A text or geo index is not ordered; calling it ASC would be a lie.
        dir: typeof dir === 'string' ? '' : dir === -1 ? 'DESC' : 'ASC'
      }))
    };
  });
}

/**
 * Stop an operation. Mongo has no equivalent of dropping the connection —
 * killOp aborts the operation only, so 'connection' mode is refused rather
 * than silently doing something narrower than the caller asked for.
 */
export async function killSession(conn, key, id, { mode = 'query' } = {}) {
  if (mode === 'connection') {
    throw Object.assign(
      new Error('MongoDB hanya bisa menghentikan operasi (killOp), bukan memutus koneksinya.'),
      { expected: true }
    );
  }
  const { client } = await clientFor(conn, key);
  // opid is usually a number, but on a sharded cluster it is "shard:12345".
  const opid = /^\d+$/.test(String(id)) ? Number(id) : String(id);
  if (opid === '' || (typeof opid === 'number' && !Number.isInteger(opid))) {
    throw Object.assign(new Error(`opid tidak valid: ${id}`), { expected: true });
  }
  await client.db('admin').command({ killOp: 1, op: opid });
  return { id: String(id), mode: 'query' };
}
