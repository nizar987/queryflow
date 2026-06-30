// Golden test set — realistic MariaDB/Frappe-style queries (PLAN §1.3, §3).
// Each: { name, sql, notes } — a mix of clean and intentionally problematic queries
// so the analyzer can be calibrated for both detection and low false-positives.
export const GOLDEN = [
  {
    name: 'simple-join-group',
    sql: `SELECT u.name, COUNT(o.name) AS jml
FROM tabUser u
JOIN tabOrder o ON o.owner = u.name
WHERE o.docstatus = 1
GROUP BY u.name
HAVING COUNT(o.name) > 5
ORDER BY jml DESC
LIMIT 20`,
    notes: 'clean baseline'
  },
  {
    name: 'select-star-bigtable',
    sql: `SELECT * FROM \`tabImport Tool Document\` WHERE creation > '2026-01-01'`,
    notes: 'SELECT * on big table'
  },
  {
    name: 'index-busting-where',
    sql: `SELECT name, status FROM tabComment WHERE DATE(creation) = '2026-06-01' AND LOWER(comment_type) = 'info'`,
    notes: 'DATE()/LOWER() wrapping indexed cols'
  },
  {
    name: 'leading-wildcard',
    sql: `SELECT name FROM tabUser WHERE full_name LIKE '%nizar%'`,
    notes: 'leading wildcard LIKE'
  },
  {
    name: 'cartesian-join',
    sql: `SELECT a.name, b.name FROM tabUser a JOIN tabRole b`,
    notes: 'JOIN without ON'
  },
  {
    name: 'correlated-subquery',
    sql: `SELECT v.name,
  (SELECT COUNT(*) FROM tabComment c WHERE c.reference_name = v.docname) AS comments
FROM tabVersion v
WHERE v.ref_doctype = 'Sales Order'`,
    notes: 'correlated scalar subquery in SELECT (N+1)'
  },
  {
    name: 'aggregate-in-where',
    sql: `SELECT customer, SUM(grand_total) AS total
FROM tabSalesInvoice
WHERE COUNT(name) > 3
GROUP BY customer`,
    notes: 'aggregate function in WHERE'
  },
  {
    name: 'count-column-vs-star',
    sql: `SELECT COUNT(status) FROM tabOrder WHERE docstatus = 1`,
    notes: 'COUNT(col) where COUNT(*) likely intended'
  },
  {
    name: 'cte-window',
    sql: `WITH ranked AS (
  SELECT name, owner, creation,
    ROW_NUMBER() OVER (PARTITION BY owner ORDER BY creation DESC) AS rn
  FROM tabVersion
)
SELECT name, owner FROM ranked WHERE rn = 1`,
    notes: 'CTE + window function'
  },
  {
    name: 'union-all',
    sql: `SELECT name, 'order' AS src FROM tabOrder WHERE docstatus = 1
UNION ALL
SELECT name, 'invoice' AS src FROM tabSalesInvoice WHERE docstatus = 1`,
    notes: 'UNION ALL'
  },
  {
    name: 'order-by-ordinal-no-limit',
    sql: `SELECT customer, grand_total FROM tabSalesInvoice ORDER BY 2 DESC`,
    notes: 'ORDER BY ordinal + no LIMIT'
  },
  {
    name: 'nested-subquery-in',
    sql: `SELECT name FROM tabUser
WHERE name IN (
  SELECT owner FROM tabOrder WHERE grand_total > (
    SELECT AVG(grand_total) FROM tabOrder
  )
)`,
    notes: 'nested subqueries'
  },
  {
    name: 'derived-table',
    sql: `SELECT t.owner, t.c FROM (
  SELECT owner, COUNT(*) AS c FROM tabComment GROUP BY owner
) t WHERE t.c > 10`,
    notes: 'derived table in FROM'
  },
  {
    name: 'clean-indexed',
    sql: `SELECT name, status FROM tabOrder WHERE owner = 'nizar@example.com' AND docstatus = 1 ORDER BY creation DESC LIMIT 50`,
    notes: 'intentionally clean — should produce few/no warnings'
  }
];
