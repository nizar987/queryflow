<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Navbar from '$lib/components/Navbar.svelte';
  import QueryEditor from '$lib/components/QueryEditor.svelte';
  import ResultGrid from '$lib/components/ResultGrid.svelte';
  import BatchResults from '$lib/components/BatchResults.svelte';
  import QueryFailure from '$lib/components/QueryFailure.svelte';
  import ConnectionsModal from '$lib/components/ConnectionsModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import ConfirmWriteModal from '$lib/components/ConfirmWriteModal.svelte';
  import QueryLibrary from '$lib/components/QueryLibrary.svelte';
  import * as api from '$lib/api.js';
  import { queryable } from '$lib/dialects.js';
  import { engineForDialect } from '$lib/pipeline.js';
  import { readPreference, applyTheme, watchSystem } from '$lib/theme.js';
  import { stash, take } from '$lib/handoff.js';
  import { classifyStatement } from '$lib/statement.js';
  import { loadHistory, remember as rememberRun } from '$lib/history.js';
  import { formatElapsed } from '$lib/duration.js';
  import { newRunId } from '$lib/run-id.js';
  import { readPaging, withOffset } from '$lib/paging.js';
  import {
    referencedTables, getColumns, putColumns, claimFetch, releaseFetch, columnsKey
  } from '$lib/schema.js';

  let theme = $state('system');
  let shortcutsOpen = $state(false);
  let connectionsOpen = $state(false);

  let connections = $state([]);
  let connectionId = $state('');
  let loadError = $state('');
  let ready = $state(false);

  let query = $state('');
  let maxRows = $state(500);
  let running = $state(false);
  let result = $state(null);
  let error = $state('');
  /** @type {Date | null} */
  let ranAt = $state(null);
  let toasts = $state([]);
  let toastSeq = 0;
  /**
   * Snapshot of what actually produced `result` — the editor may keep changing after.
   * @type {{ query: string, selection: boolean, connectionId: string, dialect: string, page?: number } | null}
   */
  let lastRun = $state(null);
  let exportingAll = $state(false);

  /** Wall-clock timer for the run in flight, as the user experiences it (network included). */
  const TIMER_TICK_MS = 100;
  let startedAt = $state(0);
  let now = $state(0);
  /**
   * How long the last run took end to end; shown next to an error, where there is no grid.
   * @type {number | null}
   */
  let lastElapsed = $state(null);
  const elapsed = $derived(running ? Math.max(0, now - startedAt) : 0);

  /**
   * Id of the run in flight, so Batalkan can name it to the server.
   * @type {string | null}
   */
  let currentRunId = $state(null);
  let cancelling = $state(false);
  /**
   * A script's outcome, one entry per statement: { index, statement, status, result | error, code }.
   * @type {any[] | null}
   */
  let batch = $state(null);
  let batchTab = $state(0);
  /**
   * 'QUERY_CANCELLED' | 'QUERY_TIMEOUT' | null — a stop is not a failure and is shown differently.
   * @type {string | null}
   */
  let errorCode = $state(null);

  $effect(() => {
    if (!running) return;
    const id = setInterval(() => (now = Date.now()), TIMER_TICK_MS);
    return () => clearInterval(id);
  });

  /** Runs from every session in this browser, newest first. */
  let recent = $state([]);
  let libraryOpen = $state(false);

  /** Names the editor can complete: tables from the connection, columns per table. */
  let schemaTables = $state([]);
  let schemaColumns = $state(new Map());
  const schema = $derived({ tables: schemaTables, columnsByTable: schemaColumns });

  /** Set while a write is waiting for confirmation: { info, statement }. */
  /** @type {{ info: import('$lib/statement.js').Classification, statement: string, selection: boolean } | null} */
  let pendingWrite = $state(null);
  /** Connection ids the user chose to stop being asked about, this session only. */
  let trusted = $state(new Set());

  const active = $derived(connections.find((c) => c.id === connectionId) || null);
  const engine = $derived(active ? engineForDialect(active.dialect) : 'sql');
  const timeoutSec = $derived(active && Number.isInteger(active.queryTimeoutSec) ? active.queryTimeoutSec : null);
  /**
   * Paging re-runs on the connection that produced the result; after switching
   * connections the pager would page a different database, so it hides.
   */
  const canPage = $derived(ranOn(lastRun, connectionId));
  const paging = $derived(canPage ? pagingOf(lastRun, result) : null);

  /** @param {typeof lastRun} run @param {string} id */
  function ranOn(run, id) {
    return !!run && run.connectionId === id;
  }

  /** @param {typeof lastRun} run @param {any} res */
  function pagingOf(run, res) {
    return run && res && res.kind === 'rows' ? readPaging(run.dialect, run.query) : null;
  }
  const canRun = $derived(!!active && !!query.trim() && !running);
  /** What the statement in the editor would do, recomputed as it is typed. */
  const intent = $derived(active && query.trim() ? classifyStatement(active.dialect, query) : null);
  const blockedByReadOnly = $derived(
    !!active && !!active.readOnly && !!intent && (intent.write || intent.locking)
  );

  onMount(() => {
    theme = readPreference();
    applyTheme(theme);
    const unwatch = watchSystem(() => theme);

    const handed = take();
    if (handed) {
      query = handed.query;
    } else {
      // Restore query draft from previous visit to this tab
      try {
        const saved = sessionStorage.getItem('qf_query_draft');
        if (saved) query = saved;
      } catch (e) { /* ignore */ }
    }

    loadConnections(handed && handed.dialect).then(() => (ready = true));

    try {
      recent = loadHistory();
    } catch (e) { /* ignore */ }

    // Restore last result / error so switching tabs doesn't wipe the screen
    try {
      const savedMax = sessionStorage.getItem('qf_query_max_rows');
      if (savedMax !== null) maxRows = parseInt(savedMax, 10);
      const savedRanAt = sessionStorage.getItem('qf_query_ran_at');
      if (savedRanAt) ranAt = new Date(savedRanAt);
      const savedElapsed = sessionStorage.getItem('qf_query_elapsed');
      if (savedElapsed !== null) lastElapsed = Number(savedElapsed);
      const savedError = sessionStorage.getItem('qf_query_error');
      if (savedError) error = savedError;
      errorCode = sessionStorage.getItem('qf_query_error_code') || null;
      const savedResult = sessionStorage.getItem('qf_query_result');
      if (savedResult) result = JSON.parse(savedResult);
      const savedBatch = sessionStorage.getItem('qf_query_batch');
      if (savedBatch) {
        batch = JSON.parse(savedBatch);
        batchTab = initialTab(batch);
      }
    } catch (e) { /* ignore */ }

    return unwatch;
  });

  async function loadConnections(preferDialect) {
    const r = await api.listConnections();
    if (!r.ok) {
      loadError = r.error || 'Gagal memuat koneksi.';
      return;
    }
    loadError = '';
    connections = queryable(r.connections);

    if (connections.length === 0) {
      connectionId = '';
      return;
    }
    // Keep the current pick if it still exists; otherwise prefer one matching
    // the dialect handed over from the Visualizer, then the last used, then first.
    if (connections.some((c) => c.id === connectionId)) return;
    const remembered = safeGet('qf_last_connection');
    const byDialect = preferDialect ? connections.find((c) => c.dialect === preferDialect) : null;
    const byMemory = remembered ? connections.find((c) => c.id === remembered) : null;
    connectionId = (byDialect || byMemory || connections[0]).id;
  }

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  $effect(() => {
    if (connectionId) { try { localStorage.setItem('qf_last_connection', connectionId); } catch (e) { /* ignore */ } }
  });

  // Table names for autocomplete. Reads only the catalog, and only when the
  // chosen connection changes — not on every keystroke.
  $effect(() => {
    const id = connectionId;
    schemaTables = [];
    schemaColumns = new Map();
    if (!id) return;
    let cancelled = false;
    api.listTables(id).then((r) => {
      if (cancelled || !r.ok) return;
      schemaTables = (r.tables || []).map((t) => (typeof t === 'string' ? t : t.name)).filter(Boolean);
    });
    return () => (cancelled = true);
  });

  /**
   * Columns are fetched lazily, for the tables the query actually names. A
   * schema with hundreds of tables would otherwise mean hundreds of requests
   * for suggestions nobody asked for.
   */
  $effect(() => {
    const id = connectionId;
    const wanted = referencedTables(query, engine);
    if (!id || wanted.length === 0) return;
    for (const table of wanted.slice(0, 8)) {
      if (getColumns(id, table)) continue;
      const key = columnsKey(id, table);
      if (!claimFetch(key)) continue;
      api
        .readTableRows(id, table, { limit: 1 })
        .then((r) => {
          // A failed read must not be cached: a permission error or a blip would
          // otherwise kill completion for that table until the page is reloaded,
          // with no way to ask again.
          if (!r.ok || !r.info || !Array.isArray(r.info.columns)) return;
          const cols = r.info.columns.map((c) => (typeof c === 'string' ? c : c.name)).filter(Boolean);
          putColumns(id, table, cols);
          // The connection may have been switched while this was in flight —
          // columns from the old database must not surface under the new one.
          if (connectionId !== id) return;
          // A new Map instance is what tells Svelte the schema changed.
          schemaColumns = new Map([...schemaColumns, [table.toLowerCase(), cols]]);
        })
        .finally(() => releaseFetch(key));
    }
  });
  $effect(() => {
    try { sessionStorage.setItem('qf_query_draft', query); } catch (e) { /* ignore */ }
  });
  $effect(() => {
    try { sessionStorage.setItem('qf_query_max_rows', String(maxRows)); } catch (e) { /* ignore */ }
  });

  /**
   * Writes get one deliberate stop before they happen. The server refuses them
   * on a read-only connection regardless; this is about the connections where
   * the write *is* allowed but was not intended.
   */
  /** @param {{ text: string, selection: boolean }} [target] from the editor: a selection, or everything */
  function run(target) {
    if (!canRun || !active) return;
    const text = target && target.text && target.text.trim() ? target.text : query;
    const selection = !!(target && target.selection);
    // Judge what will actually run — with a selection, that is not the editor.
    const c = classifyStatement(active.dialect, text);
    if (active.readOnly && (c.write || c.locking)) {
      error = `Koneksi "${active.name}" ditandai read-only — ${c.command} tidak dijalankan.`;
      errorCode = null;
      result = null;
      batch = null;
      return;
    }
    // "Don't ask again" covers ordinary writes only. An unfiltered or
    // destructive statement asks every single time, no matter what was ticked
    // earlier — that is the whole point of the exemption.
    if (c.write && !(trusted.has(connectionId) && !c.unfiltered && !c.destructive)) {
      pendingWrite = { info: c, statement: text, selection };
      return;
    }
    execute(text, selection);
  }

  function confirmWrite({ remember }) {
    // "Don't ask again" is never offered for unfiltered or destructive writes,
    // but guard here too so the flag can't be set by a stale dialog.
    if (remember && pendingWrite && !pendingWrite.info.unfiltered && !pendingWrite.info.destructive) {
      trusted = new Set([...trusted, connectionId]);
    }
    if (!pendingWrite) return;
    const { statement, selection } = pendingWrite;
    pendingWrite = null;
    execute(statement, selection);
  }

  /**
   * @param {string} text what to send — the selection or the whole editor
   * @param {boolean} selection
   * @param {{ tab?: number | null, page?: number, record?: boolean }} [opts]
   *   `tab` puts a single result back into that tab of the current script;
   *   `record: false` keeps page flips out of the history.
   */
  async function execute(text, selection = false, { tab = null, page = undefined, record = true } = {}) {
    running = true;
    error = '';
    errorCode = null;
    const dialect = active ? active.dialect : '';
    if (tab == null) lastRun = { query: text, selection, connectionId, dialect, page };
    else if (lastRun) lastRun = { ...lastRun, page };
    const runId = newRunId();
    currentRunId = runId;
    const started = Date.now();
    startedAt = started;
    now = started;
    const r = await api.runQuery(connectionId, text, maxRows, runId);
    const took = Date.now() - started;
    currentRunId = null;
    cancelling = false;
    running = false;
    ranAt = new Date();
    lastElapsed = took;

    if (tab != null && batch) {
      batch = batch.map((x, j) =>
        j !== tab ? x
          : r.ok && r.result ? { ...x, statement: text, status: 'ok', result: r.result, error: undefined, code: null }
          : { ...x, statement: text, status: 'error', result: undefined, error: r.error || 'Query gagal.', code: r.code || null }
      );
    } else if (r.ok && Array.isArray(r.results)) {
      result = null;
      batch = r.results;
      batchTab = initialTab(r.results);
      if (record) remember(r.results.every((x) => x.status === 'ok'), took, text, null);
    } else if (r.ok) {
      result = r.result;
      batch = null;
      if (record) remember(true, took, text, r.result && typeof r.result.rowCount === 'number' ? r.result.rowCount : null);
    } else {
      result = null;
      batch = null;
      error = r.error || 'Query gagal.';
      errorCode = r.code || null;
      if (record) remember(false, took, text, null);
    }
    persistOutcome(took);
  }

  /**
   * Next or previous page of a statement, stepping by its own LIMIT. The
   * editor is left alone: the rewritten OFFSET is only what gets sent.
   * @param {string} statement
   * @param {1 | -1} direction
   * @param {number | null} [tab] a script's tab, or null for a single result
   */
  function goPage(statement, direction, tab = null) {
    if (running || !lastRun || !canPage) return;
    const p = readPaging(lastRun.dialect, statement);
    if (!p) return;
    const offset = direction > 0 ? p.offset + p.limit : Math.max(0, p.offset - p.limit);
    const paged = withOffset(lastRun.dialect, statement, offset);
    if (!paged) return;
    execute(paged, false, { tab, page: Math.floor(offset / p.limit) + 1, record: false });
  }

  /** Open the tab that needs attention: the failure, else the last result with rows. */
  function initialTab(results) {
    const failed = results.findIndex((x) => x.status === 'error');
    if (failed >= 0) return failed;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].status === 'ok' && results[i].result.kind === 'rows') return i;
    }
    return results.length - 1;
  }

  /** Keep the outcome across tab switches — sessionStorage, this browser tab only. */
  function persistOutcome(took) {
    try {
      const put = (k, v) => (v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v));
      put('qf_query_elapsed', String(took));
      put('qf_query_ran_at', ranAt ? ranAt.toISOString() : null);
      put('qf_query_result', result ? JSON.stringify(result) : null);
      put('qf_query_batch', batch ? JSON.stringify(batch) : null);
      put('qf_query_error', error || null);
      put('qf_query_error_code', errorCode);
    } catch (e) {
      // Quota or privacy mode: the result is still on screen, only not restorable.
    }
  }

  /** Ask the server to stop the statement; the run's own response reports how it ended. */
  async function cancelRunning() {
    if (!currentRunId || cancelling) return;
    cancelling = true;
    const r = await api.cancelQuery(currentRunId);
    // If the query finished in the meantime there is nothing to report.
    if (!r.ok && running) {
      cancelling = false;
      showToast(r.error || 'Gagal membatalkan query.', 'err');
    }
  }

  function remember(ok, ms, text, rows) {
    recent = rememberRun({
      q: text,
      ok,
      ms,
      connId: connectionId,
      conn: active ? active.name : '',
      dialect: active ? active.dialect : '',
      rows
    });
  }

  function setTheme(next) {
    theme = next;
    applyTheme(next, true);
  }

  function toVisualizer() {
    if (!query.trim()) return;
    stash(query, active ? active.dialect : 'MariaDB');
    goto('/');
  }

  async function copyText(text, label = 'Disalin ke clipboard') {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); showToast(label); }
    catch (e) { showToast('Tidak bisa menyalin — cek izin clipboard', 'err'); }
  }
  function showToast(msg, kind = 'ok') {
    const id = ++toastSeq;
    toasts = [...toasts, { id, msg, kind }];
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 2600);
  }

  /**
   * The grid's CSV button can only save what "Maks baris" already loaded into
   * the browser. This re-runs the statement on the server with no cap and
   * downloads the full result instead.
   */
  /** @param {string} [statement] one statement of a script; defaults to what last ran */
  async function exportAllRows(format = 'csv', name = '', statement = '') {
    if (!lastRun || exportingAll) return;
    const text = statement || lastRun.query;
    exportingAll = true;
    try {
      const res = await fetch('/api/query/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connectionId: lastRun.connectionId, query: text, format })
      });
      if (!res.ok) {
        let msg = `Ekspor gagal (HTTP ${res.status}).`;
        try {
          const body = await res.json();
          if (body && body.error) msg = body.error;
        } catch (e) { /* respons bukan JSON, pakai pesan default */ }
        showToast(msg, 'err');
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name || (m ? m[1] : `queryflow-hasil.${format}`);
      a.click();
      URL.revokeObjectURL(a.href);
      showToast('Semua baris diunduh.');
    } catch (e) {
      showToast('Server QueryFlow tidak merespons.', 'err');
    } finally {
      exportingAll = false;
    }
  }

  function onWindowKeydown(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
    if (e.key === '?' && !inField && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      shortcutsOpen = !shortcutsOpen;
    }
  }
</script>

<svelte:head>
  <title>Query — QueryFlow</title>
  <meta name="description" content="Jalankan query langsung ke database yang terhubung, lalu kirim ke visualizer untuk dianalisa." />
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

<div class="app">
  <Navbar active="query" {theme} onthemechange={setTheme}
    onshortcuts={() => (shortcutsOpen = true)} onconnections={() => (connectionsOpen = true)} />

  <div class="bar">
    <div class="left">
      {#if connections.length}
        <label class="conn-pick" title="Koneksi tujuan">
          <i class="ti ti-plug"></i>
          <span class="sr-only">Koneksi</span>
          <select bind:value={connectionId}>
            {#each connections as c (c.id)}
              <option value={c.id}>{c.name} · {c.dialect}</option>
            {/each}
          </select>
          <i class="ti ti-chevron-down sm"></i>
        </label>
        {#if active}
          <span class="target">{active.uri || `${active.host}:${active.port}${active.database ? '/' + active.database : ''}`}</span>
          {#if active.readOnly}
            <span class="ro" title="Semua penulisan ke koneksi ini ditolak server">
              <i class="ti ti-lock"></i> read-only
            </span>
          {/if}
        {/if}
      {:else}
        <span class="target none"><i class="ti ti-plug-connected-x"></i> Belum ada koneksi</span>
      {/if}
      <button class="tb-btn" onclick={() => (connectionsOpen = true)}>
        <i class="ti ti-settings"></i> <span class="lbl">Kelola koneksi</span>
      </button>
    </div>

    <div class="right">
      <label class="rows-pick" title="Batas baris yang diambil ke browser">
        <span>Maks baris</span>
        <select value={maxRows} onchange={(e) => (maxRows = Number(e.currentTarget.value))}>
          {#each [100, 500, 1000, 5000] as n (n)}<option value={n}>{n}</option>{/each}
          <option value={0}>Semua</option>
        </select>
      </label>
      <button class="tb-btn" onclick={() => (libraryOpen = true)} title="Riwayat & query tersimpan (⌘/Ctrl+K)">
        <i class="ti ti-history"></i> <span class="lbl">Riwayat</span>
      </button>
      <button class="tb-btn" disabled={!query.trim()} onclick={toVisualizer} title="Buka query ini di Visualizer">
        <i class="ti ti-binary-tree"></i> <span class="lbl">Visualisasikan</span>
      </button>
    </div>
  </div>

  {#if loadError}
    <div class="banner err"><i class="ti ti-alert-octagon"></i> {loadError}</div>
  {/if}

  {#if blockedByReadOnly}
    <div class="banner warn">
      <i class="ti ti-lock"></i>
      <span><strong>{intent.command}</strong> tidak akan dijalankan — koneksi <strong>{active.name}</strong> ditandai read-only.</span>
    </div>
  {:else if intent && intent.write}
    <div class="banner warn">
      <i class="ti ti-pencil"></i>
      <span>{intent.label}. QueryFlow akan meminta konfirmasi sebelum menjalankannya.</span>
    </div>
  {:else if intent && intent.locking}
    <div class="banner warn">
      <i class="ti ti-lock-open"></i>
      <span>{intent.label} — baris tetap terkunci sampai transaksinya selesai.</span>
    </div>
  {/if}

  <div class="input-zone">
    <QueryEditor bind:value={query} onanalyze={run} loading={running} {engine} {schema}
      dialect={active ? active.dialect : 'MariaDB'}
      runLabel="Jalankan" runningLabel="Menjalankan…" runIcon="ti-bolt" selectionLabel="Jalankan seleksi"
      oncopy={(t) => copyText(t, 'Query disalin')}
      onformat={() => showToast('Query dirapikan')}
      placeholder={engine === 'mongo'
        ? '// db.orders.find({ status: "active" }).limit(20)'
        : '-- SELECT * FROM … lalu ⌘/Ctrl+Enter untuk menjalankan'} />

    {#if ready && connections.length === 0 && !loadError}
      <div class="setup">
        <i class="ti ti-plug"></i>
        <div>
          <strong>Belum ada database yang terhubung.</strong>
          <span>Tambahkan koneksi untuk mulai menjalankan query. Kredensial disimpan di file lokal pada mesin ini, bukan di browser.</span>
        </div>
        <button class="primary" onclick={() => (connectionsOpen = true)}><i class="ti ti-plus"></i> Tambah koneksi</button>
      </div>
    {/if}
  </div>

  <div class="results">
    {#if running}
      <div class="state running" role="status">
        <i class="ti ti-loader-2 spin"></i>
        <span>
          {cancelling ? 'Membatalkan' : 'Menjalankan'}
          {#if lastRun && lastRun.page}<strong class="sel">halaman {lastRun.page}</strong>
          {:else if lastRun && lastRun.selection}<strong class="sel">seleksi</strong>{/if}
          di {active ? active.name : 'database'}…
        </span>
        <span class="timer" aria-live="off" title="Waktu sejak query dikirim">
          <i class="ti ti-clock"></i> {formatElapsed(elapsed)}
          {#if timeoutSec}<span class="limit">/ batas {timeoutSec} dtk</span>{/if}
        </span>
        <button class="cancel-btn" onclick={cancelRunning} disabled={cancelling || !currentRunId}
          title="Hentikan statement ini di database">
          <i class="ti {cancelling ? 'ti-loader-2 spin' : 'ti-player-stop'}"></i>
          {cancelling ? 'Membatalkan…' : 'Batalkan'}
        </button>
      </div>
    {:else if error}
      <QueryFailure message={error} code={errorCode} took={errorCode ? null : lastElapsed}
        oncopy={copyText} onconnections={() => (connectionsOpen = true)} />
    {:else if batch}
      <BatchResults results={batch} bind:tab={batchTab} oncopy={copyText} {exportingAll}
        onexportall={exportAllRows} exportNameParts={[active ? active.name : '', 'query']}
        onconnections={() => (connectionsOpen = true)}
        dialect={lastRun ? lastRun.dialect : ''}
        onpage={canPage ? (i, dir) => goPage(batch[i].statement, dir, i) : null} />
    {:else if result}
      <ResultGrid {result} oncopy={copyText} {exportingAll} onexportall={exportAllRows}
        exportNameParts={[active ? active.name : '', 'query']}
        pager={paging} onpage={(dir) => lastRun && goPage(lastRun.query, dir)} />
    {:else}
      <div class="state idle">
        <i class="ti ti-table"></i>
        <p>Hasil query akan muncul di sini.</p>
        {#if recent.length}
          <div class="recent">
            <span class="r-label">
              Query terakhir
              <button class="r-more" onclick={() => (libraryOpen = true)}>
                lihat semua {recent.length} <i class="ti ti-arrow-right"></i>
              </button>
            </span>
            {#each recent.slice(0, 6) as r (r.ts)}
              <button class="r-item" onclick={() => (query = r.q)}>
                <i class="ti {r.ok ? 'ti-circle-check ok' : 'ti-circle-x bad'}"></i>
                <span class="r-q">{r.q.replace(/\s+/g, ' ').slice(0, 70)}</span>
                <span class="r-meta">{r.conn} · {formatElapsed(r.ms)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if pendingWrite && active}
    <ConfirmWriteModal
      info={pendingWrite.info}
      connection={active}
      statement={pendingWrite.statement}
      canRemember={!pendingWrite.info.unfiltered && !pendingWrite.info.destructive}
      onconfirm={confirmWrite}
      oncancel={() => (pendingWrite = null)} />
  {/if}

  <QueryLibrary
    open={libraryOpen}
    current={query}
    dialect={active ? active.dialect : 'MariaDB'}
    {connectionId}
    onload={(text) => (query = text)}
    onclose={() => (libraryOpen = false)}
    ontoast={(msg, kind) => showToast(msg, kind)} />

  <ConnectionsModal open={connectionsOpen} onclose={() => (connectionsOpen = false)} onchange={() => loadConnections()} />
  <ShortcutsModal open={shortcutsOpen} onclose={() => (shortcutsOpen = false)} />

  <div class="toasts" role="status" aria-live="polite">
    {#each toasts as t (t.id)}
      <div class="toast" class:err={t.kind === 'err'}>
        <i class="ti {t.kind === 'err' ? 'ti-alert-circle' : 'ti-circle-check'}"></i>{t.msg}
      </div>
    {/each}
  </div>
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100dvh; overflow: hidden; }

  .bar {
    min-height: 38px; flex: 0 0 auto; display: flex; align-items: center;
    justify-content: space-between; gap: 10px; padding: 4px 12px;
    background: var(--surface-1); border-bottom: 0.5px solid var(--border); flex-wrap: wrap;
  }
  .left, .right { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  .conn-pick, .rows-pick {
    display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
    font-size: var(--fs-meta); color: var(--text-secondary);
    border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 3px 7px;
  }
  .conn-pick:hover, .rows-pick:hover { border-color: var(--border-strong); }
  .conn-pick select, .rows-pick select {
    background: transparent; border: 0; color: var(--text-primary);
    font-size: var(--fs-meta); outline: none; cursor: pointer; appearance: none; max-width: 220px;
  }
  .conn-pick select option, .rows-pick select option { background: var(--surface-1); color: var(--text-primary); }
  .sm { font-size: 10px; color: var(--text-muted); }
  .target {
    font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;
  }
  .target.none { color: var(--sev-warning); display: inline-flex; align-items: center; gap: 5px; font-family: var(--sans); }
  .tb-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 4px 9px; border-radius: var(--radius-sm);
  }
  .tb-btn:not(:disabled):hover { background: var(--surface-3); color: var(--text-primary); }
  .tb-btn:disabled { opacity: 0.4; cursor: default; }

  .banner {
    flex: 0 0 auto; padding: 8px 12px; font-size: var(--fs-sub);
    display: flex; gap: 7px; align-items: center;
  }
  .banner.err { background: var(--wash-critical); color: var(--sev-critical); border-bottom: 0.5px solid var(--wash-critical-line); }
  .banner.warn {
    background: var(--wash-warning); color: var(--text-secondary);
    border-bottom: 0.5px solid var(--wash-warning-line);
  }
  .banner.warn strong { color: var(--text-primary); }
  .ro {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--success); border: 0.5px solid var(--success); border-radius: 20px;
    padding: 1px 6px; display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto;
  }

  .input-zone { padding: 10px 12px; background: var(--surface-0); border-bottom: 0.5px solid var(--border); flex: 0 0 auto; }
  .setup {
    margin-top: 10px; display: flex; align-items: center; gap: 12px;
    background: var(--surface-1); border: 0.5px dashed var(--border-strong);
    border-radius: var(--radius); padding: 12px 14px; font-size: var(--fs-sub);
  }
  .setup > i { font-size: 22px; color: var(--accent); }
  .setup div { flex: 1 1 auto; }
  .setup strong { display: block; color: var(--text-primary); }
  .setup span { color: var(--text-secondary); line-height: 1.6; }
  .primary {
    display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto;
    background: var(--accent); color: var(--accent-ink); border: 0;
    font-size: var(--fs-sub); padding: 7px 13px; border-radius: var(--radius-sm);
  }
  .primary:hover { filter: brightness(1.08); }

  .results { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; background: var(--surface-1); }

  .state {
    flex: 1 1 auto; display: flex; align-items: center; justify-content: center;
    gap: 8px; color: var(--text-muted); font-size: var(--fs-sub); padding: 24px;
  }
  .state.idle { flex-direction: column; }
  .state.idle > i { font-size: 30px; opacity: 0.45; }
  .state.idle p { margin: 10px 0 0; }

  .recent { margin-top: 22px; width: min(560px, 100%); display: flex; flex-direction: column; gap: 3px; }
  .r-label {
    font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
  }
  .r-more {
    background: transparent; border: 0; padding: 0; color: var(--accent);
    font-size: var(--fs-meta); font-family: inherit; letter-spacing: inherit;
    display: inline-flex; align-items: center; gap: 3px;
  }
  .r-more:hover { text-decoration: underline; }
  .r-item {
    display: flex; align-items: center; gap: 8px; text-align: left; width: 100%;
    background: transparent; border: 0.5px solid transparent; border-radius: var(--radius-sm);
    padding: 6px 8px; color: var(--text-secondary); font-size: var(--fs-meta);
  }
  .r-item:hover { background: var(--surface-2); border-color: var(--border); }
  .r-item .ok { color: var(--success); }
  .r-item .bad { color: var(--sev-critical); }
  .r-q { font-family: var(--mono); flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .r-meta { flex: 0 0 auto; color: var(--text-muted); }

  .toasts {
    position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
    display: flex; flex-direction: column; gap: 6px; align-items: center; z-index: 300; pointer-events: none;
  }
  .toast {
    display: flex; align-items: center; gap: 7px;
    background: var(--surface-2); color: var(--text-primary);
    border: 0.5px solid var(--border-strong); border-radius: var(--radius);
    padding: 8px 16px; font-size: var(--fs-sub); box-shadow: var(--shadow-pop);
  }
  .toast i { color: var(--success); font-size: 14px; }
  .toast.err i { color: var(--sev-critical); }

  .state.running { gap: 10px; }
  .timer {
    display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
    font-family: var(--mono); font-size: var(--fs-meta); font-variant-numeric: tabular-nums;
    color: var(--text-primary); background: var(--surface-2);
    border: 0.5px solid var(--border); border-radius: var(--radius-sm);
  }
  .limit { color: var(--text-muted); }
  .sel { color: var(--accent); font-weight: 500; }
  .cancel-btn {
    display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-meta);
    padding: 3px 10px; border-radius: var(--radius-sm); cursor: pointer;
    background: transparent; color: var(--sev-critical); border: 0.5px solid var(--sev-critical);
  }
  .cancel-btn:hover:not(:disabled) { background: var(--wash-critical); }
  .cancel-btn:disabled { opacity: 0.6; cursor: default; }
  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 720px) {
    .tb-btn .lbl { display: none; }
    .target { display: none; }
  }
</style>
