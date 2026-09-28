// Thin client for the query-runner API. Every call resolves to a plain
// `{ ok, ... }` object — the UI never has to distinguish "database said no"
// from "fetch threw", it just renders `error`.

async function call(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (e) {
    return { ok: false, error: 'Server QueryFlow tidak merespons. Pastikan `npm run dev` masih berjalan.' };
  }
  let body;
  try {
    body = await res.json();
  } catch (e) {
    return { ok: false, error: `Respons tidak valid dari server (HTTP ${res.status}).` };
  }
  return body;
}

const asJSON = (method, body) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

export const listConnections = () => call('/api/connections');

export const createConnection = (data) => call('/api/connections', asJSON('POST', data));

export const updateConnection = (id, data) =>
  call(`/api/connections/${encodeURIComponent(id)}`, asJSON('PUT', data));

export const deleteConnection = (id) =>
  call(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const testConnection = (id) =>
  call(`/api/connections/${encodeURIComponent(id)}/test`, { method: 'POST' });

/** Named queries, stored server-side next to the connection profiles. */
export const listSavedQueries = () => call('/api/queries');

export const saveQuery = (data) => call('/api/queries', asJSON('POST', data));

export const updateSavedQuery = (id, data) =>
  call(`/api/queries/${encodeURIComponent(id)}`, asJSON('PUT', data));

export const deleteSavedQuery = (id) =>
  call(`/api/queries/${encodeURIComponent(id)}`, { method: 'DELETE' });

/**
 * `runId` makes the run cancellable with cancelQuery() while it is in flight.
 * A script of several statements comes back as `results`, one per statement.
 * @param {string} connectionId
 * @param {string} query
 * @param {number} maxRows
 * @param {string} [runId]
 */
export const runQuery = (connectionId, query, maxRows, runId) =>
  call('/api/query', asJSON('POST', { connectionId, query, maxRows, runId }));

export const cancelQuery = (runId) => call('/api/query/cancel', asJSON('POST', { runId }));

export const fetchProcessList = (connectionId) =>
  call('/api/processlist', asJSON('POST', { connectionId }));

/** Stop one live session: `mode: 'query'` aborts the statement, 'connection' drops the session. */
export const killSession = (connectionId, id, mode = 'query') =>
  call('/api/processlist/kill', asJSON('POST', { connectionId, id, mode }));

export const fetchQueues = (connectionId) =>
  call(`/api/queues?connectionId=${encodeURIComponent(connectionId)}`);

export const fetchQueueJobs = (connectionId, { system, queue, state, offset = 0, limit = 50 }) =>
  call(`/api/queues/jobs?${new URLSearchParams({
    connectionId, system, queue, state, offset: String(offset), limit: String(limit)
  })}`);

/**
 * Export is a plain navigation, not a fetch: the response is a file with a
 * Content-Disposition header, so the browser's own download machinery handles
 * it and multi-megabyte exports never sit in JS memory.
 */
export const queueExportUrl = (
  connectionId,
  { kind = 'jobs', system = '', queue = '', state = '', format = 'csv' } = {}
) => {
  const q = new URLSearchParams({ connectionId, kind, format });
  if (system) q.set('system', system);
  if (queue) q.set('queue', queue);
  if (state) q.set('state', state);
  return `/api/queues/export?${q}`;
};

export const explainQuery = (connectionId, query, analyze = false) =>
  call('/api/explain', asJSON('POST', { connectionId, query, analyze }));

/** Indexes already installed on the tables a query touches. */
export const listIndexes = (connectionId, tables) =>
  call(`/api/indexes?connectionId=${encodeURIComponent(connectionId)}&tables=${encodeURIComponent(tables.join(','))}`);

export const listTables = (connectionId) =>
  call(`/api/tables?connectionId=${encodeURIComponent(connectionId)}`);

export const previewTable = (connectionId, table) =>
  call(`/api/tables?connectionId=${encodeURIComponent(connectionId)}&table=${encodeURIComponent(table)}`);

/** Metadata (columns, primary key, privileges, exact count) + one page of rows. */
export const readTableRows = (
  connectionId,
  table,
  { offset = 0, limit = 200, orderBy = null, dir = 'asc', exactCount = false, filter = null } = {}
) => {
  const q = new URLSearchParams({ connectionId, table, offset: String(offset), limit: String(limit), dir });
  if (orderBy) q.set('orderBy', orderBy);
  // Opt-in: COUNT(*) is a full scan and must never fire just from opening a table.
  if (exactCount) q.set('count', 'exact');
  if (filter && filter.column != null) {
    q.set('filterColumn', filter.column);
    q.set('filterValue', filter.value == null ? '' : String(filter.value));
  }
  return call(`/api/tables/rows?${q}`);
};

/**
 * Whole-table export — CSV, JSON, or a runnable SQL dump. A plain navigation,
 * not a fetch: the server streams the file and the browser saves it, so a
 * 200 000-row export never sits in memory.
 *
 * `conditions` is the filter builder's list; `filter` is the single equality a
 * foreign-key click produces. When both are present the builder wins, since it
 * is the one the user just edited.
 */
/**
 * @param {string} connectionId
 * @param {string} table
 * @param {{format?: string, orderBy?: string|null, dir?: string,
 *          filter?: {column: string, value: any}|null,
 *          conditions?: Array<{column: string, op: string, value?: any, values?: any[]}>|null,
 *          includeSchema?: boolean, limit?: number|null}} [opts]
 */
export const tableExportUrl = (
  connectionId,
  table,
  { format = 'csv', orderBy = null, dir = 'asc', filter = null, conditions = null, includeSchema = true, limit = null } = {}
) => {
  const q = new URLSearchParams({ connectionId, table, format, dir });
  if (orderBy) q.set('orderBy', orderBy);

  if (conditions && conditions.length) {
    q.set('where', JSON.stringify(conditions));
  } else if (filter && filter.column != null) {
    q.set('filterColumn', filter.column);
    q.set('filterValue', filter.value == null ? '' : String(filter.value));
  }

  // Schema is the default for a dump, so only the data-only choice is sent.
  if (format === 'sql' && !includeSchema) q.set('schema', '0');
  if (limit) q.set('limit', String(limit));
  return `/api/tables/export?${q}`;
};

const rowWrite = (body) => call('/api/tables/rows', asJSON('POST', body));

export const updateCell = (connectionId, table, keyValues, column, value, isNull = false) =>
  rowWrite({ action: 'update', connectionId, table, keyValues, column, value, isNull });

export const insertRow = (connectionId, table, values) =>
  rowWrite({ action: 'insert', connectionId, table, values });

export const deleteRow = (connectionId, table, keyValues) =>
  rowWrite({ action: 'delete', connectionId, table, keyValues });
