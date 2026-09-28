// Which tab a connection belongs to. Redis has no tables and no SQL, so it
// must not appear in the Query/Tables/Log pickers — and the Antrian tab only
// ever talks to Redis.

export const QUEUE_DIALECTS = ['Redis'];

export const isQueueDialect = (dialect) => QUEUE_DIALECTS.includes(dialect);

/** Connections that can run a query / list tables. */
export const queryable = (connections) => connections.filter((c) => !isQueueDialect(c.dialect));

/** Connections that hold job queues. */
export const queueOnly = (connections) => connections.filter((c) => isQueueDialect(c.dialect));
