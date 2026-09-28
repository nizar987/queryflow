// Golden test set for MongoDB pipelines — mix of problematic and clean.
export const MONGO_GOLDEN = [
  {
    name: 'm-clean',
    sql: `db.orders.aggregate([
  { $match: { status: "active" } },
  { $sort: { created: -1 } },
  { $limit: 20 }
])`,
    expect: []
  },
  {
    name: 'm-no-match',
    sql: `db.orders.aggregate([
  { $group: { _id: "$owner", total: { $sum: "$amount" } } }
])`,
    expect: ['mongo-no-match']
  },
  {
    name: 'm-match-late',
    sql: `db.orders.aggregate([
  { $group: { _id: "$owner", total: { $sum: "$amount" } } },
  { $match: { total: { $gt: 100 } } }
])`,
    expect: ['mongo-match-late']
  },
  {
    name: 'm-where',
    sql: `db.users.find({ $where: "this.a > this.b" })`,
    expect: ['mongo-where']
  },
  {
    name: 'm-regex',
    sql: `db.users.find({ name: /nizar/ })`,
    expect: ['mongo-regex']
  },
  {
    name: 'm-unwind-blowup',
    sql: `db.orders.aggregate([
  { $unwind: "$items" },
  { $group: { _id: "$items.sku", n: { $sum: 1 } } }
])`,
    expect: ['mongo-unwind-blowup']
  },
  {
    name: 'm-sort-no-limit',
    sql: `db.orders.aggregate([
  { $match: { status: "active" } },
  { $sort: { created: -1 } }
])`,
    expect: ['mongo-sort-no-limit']
  },
  {
    name: 'm-deep-skip',
    sql: `db.orders.aggregate([
  { $match: { status: "active" } },
  { $skip: 10000 },
  { $limit: 20 }
])`,
    expect: ['mongo-deep-skip']
  },
  {
    name: 'm-lookup-pipeline',
    sql: `db.orders.aggregate([
  { $match: { status: "active" } },
  { $lookup: { from: "users", let: { o: "$owner" }, pipeline: [ { $match: { $expr: { $eq: ["$_id", "$$o"] } } } ], as: "user" } },
  { $limit: 10 }
])`,
    expect: []
  }
];

// PostgreSQL fixtures (SQL engine, dialect PostgreSQL)
export const PG_GOLDEN = [
  {
    name: 'pg-ilike-wildcard',
    sql: `SELECT name FROM users WHERE email ILIKE '%nizar%'`,
    expect: ['leading-wildcard']
  },
  {
    name: 'pg-date-trunc',
    sql: `SELECT count(*) FROM events WHERE date_trunc('day', created_at) = '2026-06-01'`,
    expect: ['index-busting']
  },
  {
    name: 'pg-clean',
    sql: `SELECT id, status FROM orders WHERE owner_id = 42 ORDER BY created_at DESC LIMIT 50`,
    expect: []
  }
];
