# QueryFlow — SQL & NoSQL Query Visualizer & Debugger

QueryFlow turns a complex query into a **visual execution-flow diagram**, explains every function/operator it uses, runs a **static problem analysis**, and can **convert queries between engines**. It can also **run the query against a real database** and show you the rows.

All of it runs on your own machine — nothing is sent to a third party.

It supports **SQL** (MariaDB, MySQL, PostgreSQL) and **NoSQL** (MongoDB aggregation pipelines).

---

## Why this exists

When you debug a non-trivial query, three things are hard:

1. **Execution order.** SQL is *written* `SELECT … FROM … WHERE … GROUP BY …` but *executed* `FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY`. Tracing that by hand wastes time. A MongoDB pipeline is closer to its execution order, but long pipelines are still hard to read.
2. **What each part does.** Functions like `ROW_NUMBER() OVER (…)`, `COALESCE()`, `$lookup`, or `$group` need explaining — without re-reading docs every time.
3. **What's wrong with it.** Index-busting filters, accidental cartesian joins, N+1 subqueries, `$match` placed too late — these are easy to miss in raw text.

QueryFlow makes the query's **data flow visible**, annotates it, and flags likely problems with concrete fixes — so understanding and debugging drops from tens of minutes to a couple of minutes.

The **Visualizer** is a static analyzer: it reads the query text only, entirely in your browser, so it's safe to paste internal/sensitive queries. It's a complement to `EXPLAIN`, not a replacement.

The **Query tab** is the opposite side of that coin: it connects to a database you configure and runs the statement for real. See [Running queries](#running-queries-query-tab) for what that implies.

---

## Supported engines

| Engine | Notes |
|---|---|
| **MariaDB / MySQL** | Default. Identifiers that the parser over-reserves but are common columns (e.g. `status`) are auto-quoted. |
| **PostgreSQL** | `ILIKE`, `DATE_TRUNC()`, `STRING_AGG()`, double-quoted identifiers, etc. |
| **MongoDB** | Aggregation pipelines `db.coll.aggregate([ … ])` and `db.coll.find({ … })`. A custom lenient parser handles shell syntax: unquoted keys, single quotes, `ISODate()` / `ObjectId()`, and `/regex/` literals. |
| **Redis** | Job queues only (python-rq, BullMQ/Bull, Sidekiq) — powers the Antrian tab; not a query engine |

Pick the engine from the dialect dropdown in the toolbar. The starter sample swaps automatically when you switch between SQL and MongoDB.

---

## What you can do

- **Visualize execution flow** — each stage becomes a node, top-to-bottom in logical execution order. CTEs and subqueries (SQL) and `$lookup` sub-pipelines / `$facet` (MongoDB) appear as collapsible sub-blocks. Correlated subqueries are highlighted.
- **Understand every function** — a non-redundant glossary explains each function/clause/operator once; repeat uses just reference it plus their local context (partition key, join condition, etc.).
- **Find problems** — a rule engine flags issues with a severity, an explanation of the risk, and a before/after fix. Findings are linked to diagram nodes (click a finding → the node highlights, and vice versa).
- **See what to optimize** — an **Optimize** tab ranks the speed-relevant findings by impact and works out which indexes the query is asking for, with copyable DDL. When a connection is available, it can also run a real `EXPLAIN` and overlay actual access-path/row/timing data onto the same diagram.
- **Convert between engines** — translate the current query to another dialect (see below).
- **Export & share** — diagram as PNG/SVG, full analysis as Markdown (for tickets/postmortems), or a share link that encodes the query in the URL (still local-only — nothing is uploaded).
- **Run queries for real** — the **Query** tab executes the statement against a configured database and shows results in a sortable grid (copy as TSV, download as CSV). Send a query either way between the two tabs with one click.
- **Watch the server** — the **Log** tab shows the live processlist and how many connections are in use out of the server's capacity, with long-running sessions highlighted. Click any running query to open it in the Visualizer.
- **Browse and edit tables** — the **Tables** tab pages through every row of any table and lets you edit cells (through a confirm dialog), add rows, and delete rows *when the connected database user actually holds the privilege*. Foreign key columns are clickable and jump to the referenced row.
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

## Optimize tab (index advice + real EXPLAIN)

The right panel's **Analisa** tab answers "what's wrong with this query?"; **Optimize** answers a different question: "what would make it faster?"

- **Suggestions** — the speed-relevant findings from the analyzer, ranked by impact (high → low). Correctness/style findings stay in Analisa.
- **Index candidates** — built from the columns the query filters, joins, and sorts on, in the order that makes a composite index actually usable: equality columns first, then join keys, then range/sort columns (MongoDB follows the Equality → Sort → Range convention). Comes with copy-ready DDL. A column wrapped in a function (`DATE(created)`) is never suggested, since a plain index wouldn't be used there anyway.
- **Checklist** — what was inspected, so a clean query still says something concrete.

None of the above touches a database — it's the same static reading the Visualizer always does. The **EXPLAIN** panel above it is the live counterpart: pick a connection and run the query's real `EXPLAIN` (PostgreSQL/MySQL/MariaDB; MongoDB via `explain('executionStats')`, unverified in this environment — see Limitations). Results overlay onto the *same diagram* the static analysis uses — a small badge on each `FROM`/`JOIN` node shows whether the engine actually used an index (✓, green) or fell back to a full scan (!, red), matched by table alias so it lands on the right node even across joins and subqueries.

Two safety points worth knowing:

- **EXPLAIN is disabled whenever the editor has unanalyzed changes.** Diagram node ids are assigned per analysis run, so a query edited after the last "Analisa" click could reuse ids from the old diagram — running EXPLAIN then risks a badge landing on a node that no longer means what it meant when EXPLAIN ran. Re-analyze first; the button explains why when it's greyed out.
- **`EXPLAIN ANALYZE` genuinely executes the statement** (that's how PostgreSQL measures real timings) — including `UPDATE`/`DELETE` if you point it at one. QueryFlow refuses to run ANALYZE on anything but a `SELECT`/`WITH` statement, server-side, regardless of what the UI shows. Plain `EXPLAIN` (no ANALYZE) never executes, on any engine.

MySQL/MariaDB `EXPLAIN FORMAT=JSON` never executes and so never reports actual rows/timings — only PostgreSQL's ANALYZE path does, which is why the ANALYZE checkbox only appears for PostgreSQL connections.

---

## Index check (Optimize tab)

Index suggestions are derived from query text, so on their own they cannot tell an index that has existed for two years from one that was never created. **Cek index terpasang** reads the real thing from the connected database's catalog — `information_schema.STATISTICS`, `pg_index`, or `listIndexes()` — all cheap reads that never touch table data.

Each suggestion is then labelled:

- **Sudah ada** — an existing index covers every wanted column, in order, starting from the first. The card dims, because it is not work.
- **Ada sebagian** — an index matches the leading columns only; the name and how far it matches are shown.
- **Belum ada** — nothing can serve it.

Column order counts: an index on `(created_at, status)` is not treated as serving a query that filters `status` first, because it cannot.

Below the suggestions, **index yang mungkin mubazir** lists indexes whose columns are an exact prefix of a longer index — anything they can serve, the longer one serves too, while write and storage costs are still paid. Primary keys are never listed (they enforce a constraint, not just lookup speed), and a unique index is never called redundant just because a wider non-unique index exists.

Results are held for five minutes per connection + table set, so repeatedly hitting **Analisa** does not re-query the catalog. A query touching different tables always starts fresh instead of borrowing the previous answer.

---

## Foreign key navigation (Tables tab)

Columns detected as foreign keys (`information_schema.KEY_COLUMN_USAGE` for MySQL/MariaDB, `pg_constraint` for PostgreSQL) render as a link. Clicking one switches to the referenced table, filtered to that exact row, with a chip showing the active filter and a one-click way to clear it. Pagination on a filtered view counts the filtered set, not the whole table — the count is a plain indexed `COUNT(*) WHERE …`, cheap in the case that matters (FK columns are normally indexed), unlike the unrestricted count the Tables tab otherwise avoids by default.

An FK column that's also editable shows both affordances side by side — the link navigates, a separate pencil button edits — rather than one control trying to mean two different things.

MongoDB has no enforced references, so this is SQL-only; `foreignKeys` is always empty for a MongoDB connection.

---

## Running queries (Query tab)

The Visualizer never touches a database. The **Query** tab does — it runs the statement you type against a database you configure, and shows the rows.

### Why this needs a server

A browser cannot open a TCP connection, so it cannot speak the MySQL, PostgreSQL or MongoDB wire protocol. QueryFlow therefore ships as a small **Node server** (`@sveltejs/adapter-node`) that holds the drivers and the credentials. The UI is still client-rendered; only the query execution crosses to the server.

### Configuring a connection

Open the plug icon in the navbar (any tab) → **Tambah koneksi**. Fill in host/port/user/password/database, or paste a connection URI.

Profiles are stored on the machine running the server, in:

```
.queryflow/connections.json      # override with QUERYFLOW_CONFIG=/path/to/file.json
```

The file is created with mode `0600` and is gitignored. Both this file and `queries.json` are written to a temporary file and renamed over the old one, so a crash mid-write cannot leave a truncated file behind — losing every stored profile with it. **Passwords never reach the browser** — the API returns a redacted view (`hasPassword: true`, URI masked), and leaving the password field empty when editing keeps the stored one.

### What can be run

Anything the connected user is permitted to do — `SELECT`, DML, DDL. There is no read-only guard, so **point it at a database you are willing to change**. The row cap ("Maks baris") only limits how many rows are shipped to the browser; it does not limit what the statement does on the server.

For MongoDB, `db.<collection>.<method>(…)` is **parsed, not `eval`'d** — the server holds live credentials, so evaluating browser text as JavaScript would be arbitrary code execution on the host. Supported: `find`, `findOne`, `aggregate`, `countDocuments`, `distinct`, `listIndexes`, the `insert*`/`update*`/`delete*`/`findOneAnd*` family, `bulkWrite`, `createIndex`, `dropIndex`, `drop`, plus `.sort()` / `.limit()` / `.skip()` / `.projection()` modifiers and `ObjectId()` / `ISODate()` / `NumberDecimal()` helpers.

### Scripts & running a selection

**Select text and press ⌘/Ctrl+↵** (or the button, which then reads *Jalankan seleksi*) to run only the selection. The write confirmation and the read-only check judge the selection, not the whole editor.

**Several statements at once** run as a script and come back as one tab per statement:

- They run **in order, on one connection**, so `SET @x = …`, temporary tables and `BEGIN … COMMIT` carry across statements.
- The script **stops at the first failure**; later tabs say *Tidak dijalankan*.
- The connection is closed afterwards instead of returned to the pool, so a transaction the script opened and **did not `COMMIT` is rolled back**. Statements that ran outside a transaction (autocommit) stay done.
- Each statement gets the profile's full time limit; **Batalkan** stops the statement that is running and skips the rest.
- Up to 100 statements per run. **Unduh semua** exports one statement at a time, from its tab.

Splitting follows each engine's rules: semicolons inside strings, quoted identifiers, comments and PostgreSQL `$$` bodies do not split; `#` is a comment in MySQL but an operator in PostgreSQL; backslash escapes apply in MySQL strings and PostgreSQL `E'…'` strings only. MySQL/MariaDB scripts accept the client's **`DELIMITER`** directive for procedure bodies:

```sql
DELIMITER //
CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END //
DELIMITER ;
CALL p();
```

MongoDB commands split at `;` or at a new line that starts another `db.` command, so a multi-line `find(…).sort(…)` stays one command.

The same split is what the read-only guard and the write confirmation classify, and on PostgreSQL each piece is sent with the extended query protocol, which accepts exactly one statement — so a split that went wrong fails loudly instead of running something that was never checked.

### Paging with the query's own LIMIT

When a read ends in a `LIMIT`, the result header shows **‹ Hal. N · baris a–b ›**. The buttons re-run the statement with the offset moved by exactly the LIMIT; the editor is not changed, and page flips are not added to the history.

- Supported: `LIMIT n`, `LIMIT n OFFSET m`, MySQL's `LIMIT m, n`, PostgreSQL's `OFFSET m LIMIT n`, and MongoDB `find(…).limit(n)` with or without `.skip(m)`.
- Only the **outermost trailing** LIMIT counts — a `LIMIT 1` inside a subquery, or text in strings and comments, is never rewritten.
- **›** is disabled when a page comes back shorter than the LIMIT: that was the last page.
- Writes and locking reads (`FOR UPDATE`) are never paged; a click would write or lock again. The pager hides after switching to another connection.
- In a script, each tab pages its own statement. That re-run happens on a fresh connection, so a statement that depends on session state set earlier in the script (`SET @x`, temporary tables) will not see it.

### Timer, cancel & time limit

While a statement runs, the Query tab shows a live timer next to the connection's limit (e.g. `12,3 dtk / batas 30 dtk`) and a **Batalkan** button.

Cancelling stops the statement **on the database**, not just in the browser: `KILL QUERY` on MySQL/MariaDB, `pg_cancel_backend()` on PostgreSQL, and `killOp` on MongoDB (reads only — `find`, `findOne`, `aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`; writes cannot be stopped midway). The kill is sent over a separate connection, so it works even when every pooled connection is busy.

Every profile has a **Batas waktu query** (seconds, default 30, `0` = no limit, max 3600), editable in *Kelola koneksi*. A statement that passes it is stopped the same way, and the page says so instead of showing a generic error. The limit also applies to **Unduh semua**, which re-runs the query on the server. Profiles saved before this setting existed get the default of 30 seconds.

### Round trip

- Query tab → **Visualisasikan** sends the statement to the Visualizer (dialect follows the connection).
- Visualizer → **Jalankan** sends it to the Query tab.

The handoff uses `sessionStorage`, not the URL, so queries stay out of browser history.

---

## Read-only connections & write confirmation

Two layers so a production connection does not change because of a wrong tab or a stray keystroke.

**Mark a profile read-only** (checkbox in Kelola koneksi). Enforced on the *server*, not in the UI:

- The Query tab refuses every write — `INSERT`, `UPDATE`, `DELETE`, `DROP`, `TRUNCATE`, `CALL`, a CTE that ends in `DELETE`, `SELECT … INTO OUTFILE`, and for MongoDB every write method including `aggregate` with `$out`/`$merge`.
- `SELECT … FOR UPDATE` and `LOCK IN SHARE MODE` are refused too: they read, but they hold locks on production rows.
- The Tables tab disables cell edits, inserts, and deletes, and says why.
- Anything that cannot be *proven* to be a read counts as a write. Unrecognized statements are refused, not waved through.

> This is not a substitute for database privileges. The flag lives in the connection profile on this machine, so it only binds QueryFlow. The real guarantee is still a database user that only holds `SELECT`.

**Writes ask first.** On a connection that is not read-only, a write stops at a confirmation dialog naming the target connection, the command, and the statement. The dialog turns red when the statement is *unfiltered* (`UPDATE`/`DELETE` with no `WHERE`, `updateMany({})`) or *destructive* (`DROP`, `TRUNCATE`, `db.coll.drop()`). Ordinary filtered writes offer "don't ask again for this connection this session" — an exemption that **never** applies to unfiltered or destructive statements.

---

## TLS & certificate verification

The **TLS/SSL** setting on a connection profile says what is actually checked, not just whether encryption is on:

| Mode | Encrypted | Chain verified | Hostname verified |
|---|---|---|---|
| Nonaktif | no | — | — |
| Aktif, tanpa verifikasi | yes | no | no |
| Verifikasi CA | yes | yes | no |
| Verifikasi CA + hostname | yes | yes | yes |

"Aktif, tanpa verifikasi" is what QueryFlow used to do for every TLS connection — a forged certificate was accepted, so the encryption did not protect against a man-in-the-middle. Profiles saved before this change keep that behaviour (nothing breaks) and can be upgraded per connection.

**Verifikasi CA** exists for databases reached through `kubectl port-forward` or a bare IP, where the hostname can never match the certificate. The **CA certificate** field takes a path to a `.pem` (an RDS CA bundle, say) or the PEM pasted inline; empty means the system CA store. A wrong path is rejected when saving, not later as an opaque handshake error.

> **MySQL/MariaDB driver note:** `mysql2` skips hostname checking when the host is an IP address, so verify-full behaves like verify-ca there. Use a DNS name if you want the hostname checked. PostgreSQL, MongoDB, and Redis have no such limitation. Client certificates (mTLS) are not supported yet.

---

## Table export

**Ekspor CSV / JSON** in the Tables tab downloads the *whole* table — not the visible page, and not just the 5 000 rows the browser already holds (which is all the result grid's copy button can reach).

- **Follows what is on screen.** With a filter active (foreign-key navigation, say), only matching rows are exported and the label changes to *Ekspor hasil filter*. Ordering matches too.
- **Read page by page on the server** and streamed straight into the response, so a million-row table costs one page of memory rather than a million rows of it.
- **Ordered by primary key** when nothing else is chosen. Without a stable order, paging mid-export can skip or duplicate rows — and nobody would notice in a 200 000-row file.
- **Capped at 200 000 rows.** CSV says so on its last line; JSON says so in `truncated`.
- Cells starting with `=`, `+`, `-`, or `@` are quote-prefixed, so table contents cannot execute as formulas in Excel.

### Dump… — SQL dump with a filter

The **Dump…** button next to those two opens a dialog that adds the two things a plain CSV button cannot express: a **SQL dump**, and a **filter you compose yourself**. It applies to all three formats — the same dialog exports a filtered CSV.

**The filter** is built from a column picker, a fixed operator list (`=`, `!=`, `>`, `>=`, `<`, `<=`, `LIKE`, `NOT LIKE`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`) and a value field, joined with `AND`. Up to 12 conditions.

- **Nothing typed can become SQL syntax.** The column is validated against the identifier allowlist and quoted; the operator can only be one of the twelve; the value is always a bound parameter. A value of `'; DROP TABLE users; --` is exported as the string it is.
- **What it says is what it runs.** The dialog shows the exact `SELECT … WHERE … ORDER BY … LIMIT` before you download, and the dump repeats the filter in its header comment.
- **A column that does not exist is a clean 400**, checked before the response starts — once a byte of an attachment has been sent, a failure would arrive as a silently truncated file.
- **MongoDB refuses a filtered export** rather than handing back a file that ignored it.

**The dump** is a runnable `.sql` file for MySQL, MariaDB, and PostgreSQL:

- **One transaction.** `START TRANSACTION`/`BEGIN` … `COMMIT`. A download that breaks off mid-file never reaches the `COMMIT`, so the target database is left untouched rather than half-loaded.
- **Schema is included by default** — `SHOW CREATE TABLE` on MySQL/MariaDB (exact, including secondary indexes and charset). PostgreSQL has no such statement, so the definition is rebuilt from column metadata: columns, defaults and primary key only, and the file says so in its header. Turn the checkbox off for `INSERT`-only.
- **`CREATE TABLE`, not `IF NOT EXISTS`** — if a table of that name already exists at the target, failing beats loading every row into whatever schema happens to be there.
- **Values round-trip.** Quotes and backslashes are escaped per engine, blobs are written in full as hex (the grid's `<4096 bytes>` summary is a display convenience, never data), booleans follow the engine, and timestamps keep the components the driver produced — a `DATE` does not shift a day for anyone outside UTC, and a Postgres `timestamptz` keeps its instant.
- **Postgres sequences are restored.** After rows are inserted with explicit ids, `setval` puts the identity sequence past the highest key — without it the next `INSERT` at the target fails on a duplicate key.
- **Anything it could not represent is stated in the file**, as a `-- PERINGATAN:` line, rather than written as something wrong.

---

## Stopping a session

Hover any row in the Log tab for the stop button. The confirmation names the server, user, database, how long it has been running, and the query text — then offers two genuinely different things:

- **Batalkan query saja** — `KILL QUERY` (MySQL/MariaDB), `pg_cancel_backend()` (PostgreSQL), `killOp` (MongoDB). The statement aborts; the connection lives.
- **Putus koneksinya** — `KILL` / `pg_terminate_backend()`. The whole session goes and the owning application sees a dropped connection. MongoDB has no equivalent, so the option is not offered there.

Before any signal is sent:

- **The process list is re-read on the server**, never trusted from the browser. A session that already finished is refused — otherwise a recycled id could hit an unrelated session.
- **Server internals are refused** (checkpointer, walwriter, autovacuum, MySQL Daemon threads).
- **QueryFlow's own session is refused.**
- **Read-only connections refuse outright.** Cancelling a statement rolls back whatever it had done, which is a change to server state — exactly what the read-only flag promises not to do.

> Signalling another user's session needs `PROCESS`/`CONNECTION_ADMIN` (MySQL/MariaDB), `pg_signal_backend` or superuser (PostgreSQL), or `killop` (MongoDB). Without it the server refuses and the refusal is shown verbatim.

---

## Query library (history & saved queries)

**Riwayat** (⌘/Ctrl+K in the Query tab) keeps every run in this browser — connection, duration, row count, success or failure — in `localStorage`, up to 100 entries. It used to live in `sessionStorage`, so "what did I run this morning?" was unanswerable by lunch. Re-running the same text moves its entry up instead of adding a duplicate.

**Tersimpan** holds queries you named on purpose, in `.queryflow/queries.json` beside the connection profiles. Being a file, it survives clearing site data and can be backed up or read like any other file. Both lists are searchable, load into the editor in one click, and can be deleted per entry.

---

## Editor help

- **Table & column autocomplete** — in the **Query** tab only, since it needs a live connection. The Visualizer stays deliberately local (its query is never sent anywhere), so it offers no suggestions. Three ways to trigger it: type at least one letter (tables), type a dot (`o.` lists that table's columns, aliases understood), or press **Ctrl+Space** for the table list with nothing typed (⌘+Space is Spotlight on macOS, so it is not bound). ↑/↓ to move, Tab/Enter to accept, Esc to dismiss. Table names are read once per connection; columns are fetched only for the tables a query actually names.
- **Completion stops inside strings and comments.** Typing `WHERE nama = 'kolom` offers nothing: accepting a suggestion there would rewrite the literal and quietly change which rows match. Quoted identifiers (`` `kolom` ``, `"kolom"`) still complete, because those are names.
- **Format SQL** (⌘/Ctrl+Shift+F) re-indents and upper-cases keywords for MariaDB/MySQL/PostgreSQL. MongoDB is not supported and the button says so rather than doing something surprising.
- **Upload / drag-drop** a `.sql` file straight into the editor.

---

## Log tab (processlist)

Shows what the server is doing right now, for the selected connection.

- **Connection budget** — open sessions vs `max_connections` (MongoDB: `current + available`), with a capacity bar that turns amber at 70% and red at 90%.
- **Active vs idle** — taken from the server's own counters rather than guessed from text: `Threads_running` (MySQL/MariaDB), `state = 'active'` (PostgreSQL), `connections.active` (MongoDB).
- **Processlist** — id, user, client, database, command, state, duration, query text. Sortable and filterable; sessions running ≥10s are amber, ≥60s red.
- **Server internals** (checkpointer, autovacuum, walwriter…) are hidden by default and counted separately.
- Click any query to open it in the Visualizer. Refresh manually (`⌘/Ctrl+R`) or every 2/5/15 seconds.

Sources: `information_schema.PROCESSLIST` + `SHOW GLOBAL STATUS` · `pg_stat_activity` + `pg_settings` · `currentOp` + `serverStatus`.

> Seeing *other users'* sessions needs `PROCESS` (MySQL/MariaDB), `pg_read_all_stats` or superuser (PostgreSQL), or the `clusterMonitor` role (MongoDB). Without it you only see your own sessions — QueryFlow says so explicitly, and the summary numbers still come from server counters, so they stay accurate.

---

## Antrian tab (Redis queues & workers)

Reads job queues out of Redis: what is piling up, what failed, and which workers are still alive. Add a connection with dialect **Redis** (default port 6379; the *DB index* field takes a number, e.g. `0`).

Queue systems are detected automatically — one Redis may host all three at once:

| System | Keys read | Workers |
|---|---|---|
| **python-rq** (Frappe/ERPNext) | `rq:queue:*`, `rq:wip\|failed\|finished\|deferred\|scheduled\|canceled:*` | `rq:workers` → heartbeat, current job, success/fail counters |
| **BullMQ / Bull** | `bull:<queue>:wait\|active\|paused\|delayed\|prioritized\|failed\|completed` | `CLIENT LIST` (BullMQ keeps no worker registry in Redis) |
| **Sidekiq** | `queues`, `queue:<name>`, `retry`, `schedule`, `dead` | `processes` |

- **Stale workers stand out** — heartbeat older than 2 min is amber, 5 min red. A queue that stops draining while the pods still look *Running* usually starts here.
- **Paused queues are flagged** — BullMQ parks jobs in a `paused` list; unflagged, the backlog looks normal while nothing consumes it.
- **Eviction is surfaced** — if `evicted_keys > 0`, jobs can vanish from a queue without ever running. Raise `maxmemory` before adding workers.
- Click a queue name for its jobs per state: payload, failure traceback, wait time, run time.

### Trends, thresholds, and the scheduler

- **Backlog trend.** Every poll is recorded, and the *Tren* column sparklines the recent samples with their delta — so a backlog of 4 000 that is draining reads differently from one that is climbing. Samples live in page memory and reset on reload.
- **Alert thresholds.** Queues and workers past their limits appear in a *perlu perhatian* panel with their rows highlighted. Backlog, failure count, and heartbeat age each have an amber and a red level, editable from **Ambang batas** and remembered in the browser.
- **rq-scheduler.** Scheduled jobs sit in their own zset (`rq:scheduler:scheduled_jobs`) and count toward no queue at all. QueryFlow shows how many there are, when the next one is due, and warns when due jobs are not being picked up — a dead scheduler otherwise looks exactly like a quiet system.

### Sentinel & Cluster

Besides **Standalone**, a Redis connection can be set to:

- **Sentinel** — list the sentinels (`sentinel-0:26379, …`) and the master name. The master is resolved through the sentinels, so a failover moves the connection instead of leaving it on a replica.
- **Cluster** — list a few nodes as entry points. Since the keyspace is split across masters, key discovery runs against *every* master; without that most queues would be invisible. Cluster mode always uses database 0, and reads are issued per key rather than as one pipeline (a cluster refuses a pipeline whose keys span slots).

### Export

**Ekspor antrian** (all queues, CSV) and **Ekspor worker** (CSV) sit in the toolbar; the job panel adds **CSV** / **JSON** for every job in the open queue + state, not just the visible page. Exports are capped at 20 000 jobs — the JSON form records `truncated` when the cap bit. CSV carries a UTF-8 BOM for Excel, and cells starting with `=`, `+`, `-`, or `@` are quote-prefixed so a job payload can't execute as a formula.

> **Read-only.** Every Redis command issued is a read (`SCAN`, `LRANGE`, `ZRANGE`, `HGETALL`, `INFO`). QueryFlow never pops, requeues, or deletes a job. Key discovery uses `SCAN`, never `KEYS`, so a production Redis is never blocked.

---

## Tables tab (browse & edit)

Lists every table on the connection and pages through **all** of its rows.

- **Every row is reachable** — page navigation with 100–5 000 rows per page, plus jump-to-page.
- **Ordered by primary key** — without `ORDER BY` an engine may return rows in any order, and an updated row can move, so pages would skip or repeat rows. Paging defaults to the primary key so "all rows" really means all of them.
- **Row counts are estimates by default** — `COUNT(*)` is a full scan; on a 100M-row table that is minutes of load just to open a tab. The `≈` figure comes from engine statistics (`reltuples` / `TABLE_ROWS` / `estimatedDocumentCount`); an exact count is one click away.

### Editing

Click a cell to open a confirmation dialog. It shows which row is targeted, the column's type and nullability, a **before → after** diff, and the exact statement that will run — nothing is written until you confirm. Nullable columns get a `NULL` toggle. Rows can be inserted and deleted from the same grid.

Editing unlocks only when **both** hold:

1. **The database user has the privilege.** Read straight from the server — `has_table_privilege()` (PostgreSQL), `SHOW GRANTS` covering global/schema/table scope (MySQL/MariaDB), `connectionStatus` (MongoDB). The grid shows `SELECT INSERT UPDATE DELETE` with the ones you lack struck through, and re-checks on every write, so a revoked grant takes effect immediately.
2. **The table has a primary key.** Without one a row cannot be addressed unambiguously and an `UPDATE` could hit the wrong rows. Such tables stay readable and insertable, but not editable or row-deletable.

Auto-increment, identity, and generated columns are marked and never writable.

> **Writes are immediate.** There is no staging or undo — saving a cell runs the `UPDATE`. Every statement is constrained to a single row by primary key and is rejected if it would match a different number of rows, but the previous value is not kept anywhere.

Table and column names can never be bound as SQL parameters, so they are validated against a strict allowlist and quoted per engine; all *values* go through real parameter binding.

---

## Running it

```bash
npm install
npm run dev        # dev server at http://localhost:5173
npm run build      # build → ./build (Node server)
npm start          # production server on 127.0.0.1:4173
npm test           # golden tests: parse + flow + analysis + conversion + query-runner
```

> `node_modules/` is gitignored. If a stray `node_modules` symlink is present in this folder, delete it before running `npm install`.

### Security note on binding

This server stores database credentials and executes arbitrary statements. `npm start` therefore binds it to **loopback only** (`HOST=127.0.0.1`).

`adapter-node` defaults to `0.0.0.0` when `HOST` is unset — exposing QueryFlow on a shared network or the public internet would hand anyone who can reach the port full access to every configured database. There is no authentication layer. If you need it reachable from elsewhere, put it behind an authenticating reverse proxy and a VPN, and use a restricted database user.

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
                     # optimize.js (index advisor) · table-resolve.js (alias↔table, shared
                     # with the EXPLAIN matcher)
    explain/         # normalize.js (per-engine EXPLAIN JSON → one shape) · match.js
                     # (normalized facts → diagram node ids)
    convert/         # cross-dialect transpilers (sql↔sql, sql↔mongo)
    export/          # markdown / png-svg / share-link
    components/      # Navbar, HistorySidebar, ContextToolbar, QueryEditor, DiagramView,
                     # RightPanel, IssueCard, NodeDetail, GlossaryPanel, ConvertModal,
                     # ConnectionsModal, ResultGrid, ShortcutsModal, OptimizePanel,
                     # ExplainPanel, CellEditModal, TableGrid
    server/          # SERVER ONLY — never bundled into the browser
      config.js      #   connection profiles on disk (passwords stay here)
      runner.js      #   dialect dispatch + pooled connections + EXPLAIN ANALYZE guard
      drivers/       #   mysql.js · postgres.js · mongo.js
                     #   mongo-command.js · cells.js · identifiers.js (SQL-injection boundary)
    api.js           # browser-side client for the query API
    theme.js         # light/dark preference
    handoff.js       # Visualizer ↔ Query tab query passing
  routes/            # / (visualizer) · /query · /log · /tables · /docs
                     # api/connections · api/connections/[id] · api/connections/[id]/test
                     # api/query · api/processlist · api/explain
                     # api/tables · api/tables/rows (accepts filterColumn/filterValue)
tests/
  fixtures/          # golden query sets (SQL, PostgreSQL, MongoDB)
                     # explain/ — real EXPLAIN JSON captured from live PostgreSQL 14 /
                     # MariaDB 11.7, used to test the normalizer without a live database
  run.js             # assertions: detection + low false-positives + conversion round-trips
                     # + EXPLAIN normalization/matching + identifier-validation boundary
```

---

## Limitations (v1)

- The analyzer is static by default — it reads query text and never consults the database on its own. The Optimize tab's EXPLAIN panel closes part of that gap when a connection is available, but running a query in the Query tab does not feed the analysis.
- SQL visualization covers `SELECT` statements.
- MySQL/MariaDB EXPLAIN never reports actual rows or timings (the engine has no reliable JSON "analyze" format across versions) — only estimates. Real timings currently require PostgreSQL's `ANALYZE`.
- EXPLAIN-to-diagram matching is by table alias; a table referenced without a `FROM`/`JOIN` node QueryFlow can see (rare) shows up as unmatched instead of being silently dropped.
- The MongoDB EXPLAIN path is implemented against MongoDB's documented `explain()` API but has not been exercised against a live `mongod` in this environment — treat it as best-effort until confirmed.
- Foreign key detection is SQL-only (MySQL/MariaDB/PostgreSQL); MongoDB has no enforced references to detect.
- The query runner executes one statement per run and has no authentication — it is a local developer tool.
- Conversion and analysis are best-effort for common shapes; exotic constructs are reported, not guessed.
- Designed for personal/team debugging use; no auth or multi-user editing.

Roadmap ideas: AI-generated explanations for uncovered functions, MySQL/MariaDB actual-timing EXPLAIN (once a stable cross-version format exists), and more dialects.

---

## Privacy

**Visualizer, analysis, conversion, export:** entirely in your browser. Nothing leaves the page. Share links encode the query in the URL fragment (`#…`), which the recipient's browser decodes locally — still nothing is uploaded.

**Query tab:** the statement is sent to the QueryFlow server process on your machine, which forwards it to the database you configured. Nothing goes to any third party, but the query does leave the browser — and it reaches whatever database that connection points at.

Credentials live only in `.queryflow/connections.json` on the server machine (mode `0600`, gitignored). They are never stored in `localStorage`, never placed in a URL, and never returned to the browser.
