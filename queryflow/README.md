# QueryFlow — SQL & NoSQL Query Visualizer & Debugger

QueryFlow turns a complex query into a **visual execution-flow diagram**, explains every function/operator it uses, runs a **static problem analysis**, and can **convert queries between engines** — all locally in your browser. No database connection, nothing uploaded.

It supports **SQL** (MariaDB, MySQL, PostgreSQL) and **NoSQL** (MongoDB aggregation pipelines).

---

## Why this exists

When you debug a non-trivial query, three things are hard:

1. **Execution order.** SQL is *written* `SELECT … FROM … WHERE … GROUP BY …` but *executed* `FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY`. Tracing that by hand wastes time. A MongoDB pipeline is closer to its execution order, but long pipelines are still hard to read.
2. **What each part does.** Functions like `ROW_NUMBER() OVER (…)`, `COALESCE()`, `$lookup`, or `$group` need explaining — without re-reading docs every time.
3. **What's wrong with it.** Index-busting filters, accidental cartesian joins, N+1 subqueries, `$match` placed too late — these are easy to miss in raw text.

QueryFlow makes the query's **data flow visible**, annotates it, and flags likely problems with concrete fixes — so understanding and debugging drops from tens of minutes to a couple of minutes.

It's a **static analyzer**: it reads the query text only. It never connects to a database, so it's safe to paste internal/sensitive queries. (That also means it's a complement to `EXPLAIN`, not a replacement.)

---

## Supported engines

| Engine | Notes |
|---|---|
| **MariaDB / MySQL** | Default. Identifiers that the parser over-reserves but are common columns (e.g. `status`) are auto-quoted. |
| **PostgreSQL** | `ILIKE`, `DATE_TRUNC()`, `STRING_AGG()`, double-quoted identifiers, etc. |
| **MongoDB** | Aggregation pipelines `db.coll.aggregate([ … ])` and `db.coll.find({ … })`. A custom lenient parser handles shell syntax: unquoted keys, single quotes, `ISODate()` / `ObjectId()`, and `/regex/` literals. |

Pick the engine from the dialect dropdown in the toolbar. The starter sample swaps automatically when you switch between SQL and MongoDB.

---

## What you can do

- **Visualize execution flow** — each stage becomes a node, top-to-bottom in logical execution order. CTEs and subqueries (SQL) and `$lookup` sub-pipelines / `$facet` (MongoDB) appear as collapsible sub-blocks. Correlated subqueries are highlighted.
- **Understand every function** — a non-redundant glossary explains each function/clause/operator once; repeat uses just reference it plus their local context (partition key, join condition, etc.).
- **Find problems** — a rule engine flags issues with a severity, an explanation of the risk, and a before/after fix. Findings are linked to diagram nodes (click a finding → the node highlights, and vice versa).
- **Convert between engines** — translate the current query to another dialect (see below).
- **Export & share** — diagram as PNG/SVG, full analysis as Markdown (for tickets/postmortems), or a share link that encodes the query in the URL (still local-only — nothing is uploaded).
- **Session history** — recent queries are kept in your browser for quick switching.

---

## Tutorial: using QueryFlow

### 1. Paste a query

Open the app. In the editor, paste a query, upload a `.sql` file, or drag-and-drop one. The editor highlights keywords and pre-flags risky bits (e.g. `SELECT *`, leading-wildcard `LIKE`) in coral before you even run analysis.

### 2. Pick the engine

Use the dropdown in the toolbar (top-right of the input area): **MariaDB, MySQL, PostgreSQL** (SQL) or **MongoDB** (NoSQL).

### 3. Analyze

Click **Analisa** (or press ⌘/Ctrl+Enter). QueryFlow will:

- parse the query,
- render the execution-flow diagram on the left,
- build the glossary, and
- run the problem analysis on the right.

### 4. Explore the diagram

- **Click a node** to see its SQL snippet, a contextual explanation, and any findings attached to it.
- **Collapse/expand** subqueries, CTEs, or `$lookup` sub-pipelines with the `+ / –` toggle on a node.
- **Zoom** with the controls in the top-right of the diagram.
- Node colors carry meaning (see *Reading the diagram* below).

### 5. Read the analysis

The right panel has three tabs:

- **Analisa** — problem cards, sorted by severity, each with *what's wrong*, *why it's risky*, and a *before/after* fix. Click a card to highlight the related node.
- **Detail node** — opens when you click a node.
- **Glosarium** — every function/operator used, explained once.

### 6. Convert (optional)

Click **Convert** in the toolbar and choose a target dialect. A dialog shows the converted query with any translation notes. From there you can **Copy** it or **Load into editor** (which also switches the active dialect).

### 7. Export / share

Use **Export** for a PNG/SVG of the diagram or a Markdown report of the analysis, or **Share** to copy a link that reopens the same query.

---

## Reading the diagram (color = meaning)

**Node category (kind of operation):**

| Color | SQL | MongoDB |
|---|---|---|
| Gray | FROM, ORDER BY, LIMIT | source, $sort, $limit, $skip, $unwind |
| Blue | JOIN | $lookup, $graphLookup |
| Coral | WHERE, HAVING | $match |
| Purple | GROUP BY | $group, $bucket, $facet |
| Teal | SELECT | $project, $addFields, $set |

**Finding severity (badge on a node / left border on a card):**

- 🔴 **Critical** — likely wrong results, locks, or a cartesian blow-up.
- 🟡 **Warning** — performance risk (index, N+1, wildcards).
- ⚪ **Info** — style / best-practice.

---

## Problem analysis — what it detects

**SQL rules:** `SELECT *` on wide tables, `COUNT(col)` vs `COUNT(*)`, aggregate function in `WHERE` (should be `HAVING`), index-busting functions wrapping a column (`DATE()`, `LOWER()`, `DATE_TRUNC()`, …), `JOIN` without `ON` (cartesian product), leading-wildcard `LIKE '%…'`, correlated subquery in `SELECT` (N+1), `ORDER BY` without `LIMIT`, `ORDER BY` by ordinal number, and any correlated subquery (flagged for review).

**MongoDB rules:** no `$match` (full collection scan), `$match` placed after heavy stages (can't use an index), `$where` / `$function` (runs JavaScript per document), unanchored `$regex` (no `^`), `$unwind` without a preceding filter, `$lookup → $unwind → $group` patterns, `$sort` without `$limit`, deep `$skip` (slow pagination), and field transforms before `$match`.

The analyzer is calibrated to stay quiet on clean queries, so warnings stay meaningful.

> ⚠️ Static analysis is based on common patterns. It is **not** a substitute for `EXPLAIN` / `explain('executionStats')` on a real database.

---

## Convert between engines

The **Convert** button translates the current query to another dialect:

- **SQL ↔ SQL** (MariaDB / MySQL / PostgreSQL) — re-emitted through the parser, adjusting identifier quoting (backtick ↔ double-quote) and basic syntax.
- **SQL → MongoDB** — `WHERE` → `$match`, `JOIN` → `$lookup` + `$unwind`, `GROUP BY` + aggregates → `$group`, `HAVING` → `$match`, `ORDER BY` → `$sort`, `LIMIT`/`OFFSET` → `$limit`/`$skip`.
- **MongoDB → SQL** — the reverse for common stages.

Conversion is **best-effort**: constructs with no direct equivalent (subqueries, window functions, `$expr`, `$where`, …) are skipped and reported as notes rather than silently mistranslated. Always review the result before using it in production.

---

## Running it

QueryFlow is a SvelteKit 5 app that runs entirely client-side.

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # static build → ./build
npm run preview    # preview the production build
npm test           # run the golden test set (parse + flow + analysis + conversion)
```

> `node_modules/` is gitignored. If a stray `node_modules` symlink is present in this folder, delete it before running `npm install`.

No backend, no API keys, no database connection required.

---

## Project structure

```
src/
  lib/
    parser/          # node-sql-parser wrapper (MariaDB/MySQL/PostgreSQL) + AST utils
                     # mongo.js + relaxed-json.js (custom MongoDB shell parser)
    ast-to-flow/     # SQL AST → execution-order flow blocks; mongo-flow.js for pipelines; layout.js
    glossary/        # function/operator dictionaries + non-redundant dedup (SQL + Mongo)
    analyzer/        # rule engines (rules.js for SQL, mongo-rules.js for MongoDB)
    convert/         # cross-dialect transpilers (sql↔sql, sql↔mongo)
    export/          # markdown / png-svg / share-link
    components/      # Navbar, HistorySidebar, ContextToolbar, QueryEditor, DiagramView,
                     # RightPanel, IssueCard, NodeDetail, GlossaryPanel, ConvertModal
  routes/            # / (visualizer) · /docs
tests/
  fixtures/          # golden query sets (SQL, PostgreSQL, MongoDB)
  run.js             # assertions: detection + low false-positives + conversion round-trips
```

---

## Limitations (v1)

- Static analysis only — no database connection, no `EXPLAIN` integration.
- SQL visualization covers `SELECT` statements.
- Conversion and analysis are best-effort for common shapes; exotic constructs are reported, not guessed.
- Designed for personal/team debugging use; no auth or multi-user editing.

Roadmap ideas: AI-generated explanations for uncovered functions, `EXPLAIN` integration, and more dialects.

---

## Privacy

Everything runs in your browser. Queries are never sent to a server. Share links encode the query in the URL fragment (`#…`), which the recipient's browser decodes locally — still nothing is uploaded.
