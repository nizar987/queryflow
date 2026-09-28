<script>
  import { onMount } from 'svelte';
  import Navbar from '$lib/components/Navbar.svelte';
  import TableGrid from '$lib/components/TableGrid.svelte';
  import ConnectionsModal from '$lib/components/ConnectionsModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import * as api from '$lib/api.js';
  import { queryable } from '$lib/dialects.js';
  import { readPreference, applyTheme, watchSystem } from '$lib/theme.js';

  let theme = $state('system');
  let shortcutsOpen = $state(false);
  let connectionsOpen = $state(false);

  let connections = $state([]);
  let connectionId = $state('');
  let loadError = $state('');
  let ready = $state(false);

  let tables = $state([]);
  let tablesLoading = $state(false);
  let tablesError = $state('');

  /** The table whose rows are shown on the right. */
  let activeTable = $state('');
  let info = $state(null);
  let pageData = $state(null);
  let rowsLoading = $state(false);
  let rowsError = $state('');

  /** Paging / sorting state for the active table. */
  let offset = $state(0);
  let limit = $state(200);
  let orderBy = $state(null);
  let dir = $state('asc');
  /** Sticky once requested, so paging doesn't silently drop back to an estimate. */
  let exactCount = $state(false);
  /** {column, value} when viewing a table scoped by a foreign key click, else null. */
  let filter = $state(null);

  let filterText = $state('');
  let toasts = $state([]);
  let toastSeq = 0;

  const active = $derived(connections.find((c) => c.id === connectionId) || null);
  const filteredTables = $derived(
    filterText.trim()
      ? tables.filter((t) => t.name.toLowerCase().includes(filterText.toLowerCase()))
      : tables
  );

  onMount(() => {
    theme = readPreference();
    applyTheme(theme);
    const unwatch = watchSystem(() => theme);
    init().then(() => (ready = true));
    return unwatch;
  });

  async function init() {
    await loadConnections();
    if (connectionId) await loadTableList();
  }

  async function loadConnections() {
    const r = await api.listConnections();
    if (!r.ok) {
      loadError = r.error || 'Gagal memuat koneksi.';
      return;
    }
    loadError = '';
    connections = queryable(r.connections);
    if (!connections.length) {
      connectionId = '';
      return;
    }
    if (connections.some((c) => c.id === connectionId)) return;
    const remembered = safeGet('qf_last_connection');
    const byMemory = remembered ? connections.find((c) => c.id === remembered) : null;
    connectionId = (byMemory || connections[0]).id;
  }

  function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  // Loading is triggered explicitly rather than from a tracking $effect: an
  // effect that calls a loader ends up tracking the state that loader writes,
  // which turns every response into another request.
  function switchConnection(id) {
    connectionId = id;
    try { localStorage.setItem('qf_last_connection', id); } catch (e) { /* ignore */ }
    loadTableList();
  }

  async function loadTableList() {
    if (!connectionId) return;
    tablesLoading = true;
    tablesError = '';
    tables = [];
    resetTableView();

    const r = await api.listTables(connectionId);
    tablesLoading = false;
    if (!r.ok) {
      tablesError = r.error || 'Gagal memuat daftar tabel.';
      return;
    }
    tables = r.tables || [];
  }

  function resetTableView() {
    activeTable = '';
    info = null;
    pageData = null;
    rowsError = '';
    offset = 0;
    orderBy = null;
    dir = 'asc';
    exactCount = false;
    filter = null;
  }

  /** Switching tables from the sidebar always starts from an unfiltered view. */
  async function selectTable(name) {
    if (activeTable === name && pageData && !filter) return;
    activeTable = name;
    info = null;
    pageData = null;
    rowsError = '';
    offset = 0;
    orderBy = null;
    dir = 'asc';
    exactCount = false;
    filter = null;
    await fetchRows();
  }

  /** A cell click on a foreign key jumps to the referenced table, scoped to that row. */
  async function navigateFk(fk, value) {
    activeTable = fk.refTable;
    info = null;
    pageData = null;
    rowsError = '';
    offset = 0;
    orderBy = null;
    dir = 'asc';
    exactCount = false;
    filter = { column: fk.refColumn, value };
    await fetchRows();
  }

  async function fetchRows() {
    if (!activeTable) return;
    rowsLoading = true;
    const r = await api.readTableRows(connectionId, activeTable, { offset, limit, orderBy, dir, exactCount, filter });
    rowsLoading = false;
    if (!r.ok) {
      rowsError = r.error || 'Gagal memuat isi tabel.';
      info = null;
      pageData = null;
      return;
    }
    rowsError = '';
    info = r.info;
    pageData = r.page;
    // Adopt the order the server actually used, so the header reflects reality.
    orderBy = r.page.orderBy ?? null;
    dir = r.page.dir ?? 'asc';
  }

  /**
   * Paging, sorting, and post-write refresh all funnel through here.
   * `toEnd` jumps to the last page — where a freshly inserted row lands.
   */
  async function reload(opts = {}) {
    if (opts.clearFilter) filter = null;
    if (opts.exactCount) exactCount = true;
    if (opts.limit != null) limit = opts.limit;
    if (opts.orderBy !== undefined) orderBy = opts.orderBy;
    if (opts.dir) dir = opts.dir;
    if (opts.offset != null) offset = opts.offset;
    else if (!opts.keepPage && !opts.toEnd) offset = 0;

    if (opts.toEnd) {
      // Jumping to where a new row landed needs a real count, not an estimate.
      const probe = await api.readTableRows(connectionId, activeTable, {
        offset: 0, limit: 1, orderBy, dir, exactCount: true, filter
      });
      const total = probe.ok ? probe.info.rowCount : 0;
      offset = Math.max(0, (Math.ceil(total / limit) - 1) * limit);
    }
    await fetchRows();
  }

  function setTheme(next) {
    theme = next;
    applyTheme(next, true);
  }

  function showToast(msg, kind = 'ok') {
    const id = ++toastSeq;
    toasts = [...toasts, { id, msg, kind }];
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 2600);
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
  <title>Tables — QueryFlow</title>
  <meta name="description" content="Jelajahi seluruh isi tabel database yang terhubung, dan edit langsung bila punya izinnya." />
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

<div class="app">
  <Navbar active="tables" {theme} onthemechange={setTheme}
    onshortcuts={() => (shortcutsOpen = true)}
    onconnections={() => (connectionsOpen = true)} />

  <div class="bar">
    <div class="left">
      {#if connections.length}
        <label class="conn-pick" title="Koneksi tujuan">
          <i class="ti ti-plug"></i>
          <span class="sr-only">Koneksi</span>
          <select value={connectionId} onchange={(e) => switchConnection(e.currentTarget.value)}>
            {#each connections as c (c.id)}
              <option value={c.id}>{c.name} · {c.dialect}</option>
            {/each}
          </select>
          <i class="ti ti-chevron-down sm"></i>
        </label>
        {#if active}
          <span class="target">{active.uri || `${active.host}:${active.port}${active.database ? '/' + active.database : ''}`}</span>
        {/if}
      {:else}
        <span class="target none"><i class="ti ti-plug-connected-x"></i> Belum ada koneksi</span>
      {/if}
      <button class="tb-btn" onclick={() => (connectionsOpen = true)}>
        <i class="ti ti-settings"></i> <span class="lbl">Kelola koneksi</span>
      </button>
    </div>
    <div class="right">
      {#if tables.length}
        <span class="count-badge"><i class="ti ti-table"></i> {tables.length} tabel</span>
      {/if}
      <button class="tb-btn" disabled={!connectionId || tablesLoading} onclick={loadTableList}
        title="Muat ulang daftar tabel">
        <i class="ti ti-refresh {tablesLoading ? 'spin' : ''}"></i> <span class="lbl">Muat ulang</span>
      </button>
    </div>
  </div>

  {#if !ready}
    <div class="empty-state"><i class="ti ti-loader-2 spin"></i> Memuat koneksi…</div>
  {:else if loadError}
    <div class="empty-state err"><i class="ti ti-alert-circle"></i> {loadError}</div>
  {:else if !connections.length}
    <div class="empty-state">
      <i class="ti ti-plug-connected-x"></i>
      <p>Belum ada koneksi. <button class="link-btn" onclick={() => (connectionsOpen = true)}>Tambah koneksi</button></p>
    </div>
  {:else}
    <div class="workspace">
      <div class="sidebar">
        <div class="sidebar-search">
          <i class="ti ti-search"></i>
          <input type="search" placeholder="Cari tabel…" bind:value={filterText} aria-label="Cari tabel" />
        </div>

        {#if tablesLoading}
          <div class="sidebar-empty"><i class="ti ti-loader-2 spin"></i> Memuat…</div>
        {:else if tablesError}
          <div class="sidebar-empty err"><i class="ti ti-alert-circle"></i> {tablesError}</div>
        {:else if !tables.length}
          <div class="sidebar-empty"><i class="ti ti-table-off"></i> Tidak ada tabel.</div>
        {:else if !filteredTables.length}
          <div class="sidebar-empty"><i class="ti ti-search-off"></i> Tidak ditemukan.</div>
        {:else}
          <ul class="table-list" role="listbox" aria-label="Daftar tabel">
            {#each filteredTables as t (t.name)}
              <li>
                <button
                  class="table-item"
                  class:active={activeTable === t.name}
                  role="option"
                  aria-selected={activeTable === t.name}
                  onclick={() => selectTable(t.name)}
                  title={t.comment || t.name}
                >
                  <i class="ti ti-table-column"></i>
                  <span class="tname">{t.name}</span>
                  {#if t.approxRows != null}
                    <span class="rows-badge">~{t.approxRows.toLocaleString('id-ID')}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="preview-pane">
        {#if !activeTable}
          <div class="preview-empty">
            <i class="ti ti-table-column big"></i>
            <p>Pilih tabel di sebelah kiri untuk melihat isinya.</p>
            <p class="sub">Seluruh baris bisa ditelusuri lewat halaman, dan bisa diedit bila user database punya izinnya.</p>
          </div>
        {:else if rowsError}
          <div class="preview-empty err">
            <i class="ti ti-alert-circle big"></i>
            <p>{rowsError}</p>
          </div>
        {:else if !pageData && rowsLoading}
          <div class="preview-empty">
            <i class="ti ti-loader-2 spin big"></i>
            <p>Memuat <strong>{activeTable}</strong>…</p>
          </div>
        {:else if pageData}
          <div class="preview-header">
            <span class="preview-title">
              <i class="ti ti-table-column"></i>
              <strong>{activeTable}</strong>
              {#if rowsLoading}<i class="ti ti-loader-2 spin"></i>{/if}
            </span>
          </div>
          <div class="grid-wrap">
            <TableGrid
              {connectionId}
              table={activeTable}
              dialect={active ? active.dialect : 'MariaDB'}
              {info}
              page={pageData}
              loading={rowsLoading}
              {orderBy}
              {dir}
              onreload={reload}
              ontoast={showToast}
              onnavigatefk={navigateFk}
            />
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <ConnectionsModal open={connectionsOpen} onclose={() => (connectionsOpen = false)} onchange={loadConnections} />
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
  .app {
    display: flex; flex-direction: column;
    height: 100dvh; overflow: hidden;
    background: var(--surface-1); color: var(--text-primary);
  }

  .bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; padding: 0 12px; min-height: 42px; flex: 0 0 auto; flex-wrap: wrap;
    background: var(--surface-1); border-bottom: 0.5px solid var(--border);
    font-size: var(--fs-sub);
  }
  .left, .right { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .conn-pick {
    display: inline-flex; align-items: center; gap: 5px;
    border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    padding: 3px 8px; background: var(--surface-2);
    color: var(--text-secondary); cursor: pointer; flex: 0 0 auto;
  }
  .conn-pick select {
    background: transparent; border: 0; color: inherit;
    font: inherit; cursor: pointer; outline: none; max-width: 200px;
  }
  .conn-pick .sm { font-size: 10px; }
  .target {
    font-size: var(--fs-meta); color: var(--text-muted);
    font-family: var(--mono); overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; max-width: 260px;
  }
  .target.none { color: var(--sev-warning); }
  .tb-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text-secondary);
    font-size: var(--fs-meta); padding: 3px 9px; cursor: pointer;
  }
  .tb-btn:hover:not(:disabled) { background: var(--surface-3); color: var(--text-primary); }
  .tb-btn:disabled { opacity: .45; cursor: default; }
  .count-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: var(--fs-meta); color: var(--text-muted);
    border: 0.5px solid var(--border); border-radius: 20px; padding: 2px 8px;
  }

  .empty-state {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px; color: var(--text-muted);
    font-size: var(--fs-sub);
  }
  .empty-state.err { color: var(--sev-critical); }
  .empty-state i { font-size: 28px; }
  .link-btn {
    background: none; border: none; color: var(--accent);
    cursor: pointer; font: inherit; text-decoration: underline; padding: 0;
  }

  .workspace { flex: 1 1 auto; display: flex; overflow: hidden; min-height: 0; }

  .sidebar {
    width: 240px; flex: 0 0 240px;
    display: flex; flex-direction: column;
    border-right: 0.5px solid var(--border);
    background: var(--surface-1); overflow: hidden;
  }
  .sidebar-search {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 10px; border-bottom: 0.5px solid var(--border); flex: 0 0 auto;
  }
  .sidebar-search i { color: var(--text-muted); font-size: 14px; flex: 0 0 auto; }
  .sidebar-search input {
    flex: 1; background: transparent; border: none; outline: none;
    color: var(--text-primary); font: inherit; font-size: var(--fs-sub); min-width: 0;
  }
  .sidebar-search input::placeholder { color: var(--text-muted); }

  .sidebar-empty {
    padding: 20px 12px; color: var(--text-muted);
    font-size: var(--fs-sub); display: flex; align-items: center; gap: 6px;
  }
  .sidebar-empty.err { color: var(--sev-critical); }

  .table-list { list-style: none; margin: 0; padding: 4px 0; overflow-y: auto; flex: 1 1 auto; }
  .table-item {
    width: 100%; display: flex; align-items: center; gap: 7px;
    padding: 6px 12px; background: transparent; border: none;
    color: var(--text-secondary); font-size: var(--fs-sub);
    text-align: left; cursor: pointer;
    transition: background var(--dur-fast), color var(--dur-fast);
  }
  .table-item:hover { background: var(--surface-2); color: var(--text-primary); }
  .table-item.active { background: var(--surface-3); color: var(--text-primary); font-weight: 500; }
  .table-item i { color: var(--text-muted); font-size: 13px; flex: 0 0 auto; }
  .table-item.active i { color: var(--accent); }
  .tname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rows-badge { font-size: var(--fs-meta); color: var(--text-muted); font-family: var(--mono); flex: 0 0 auto; }

  .preview-pane { flex: 1 1 auto; display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
  .preview-empty {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; text-align: center;
    gap: 8px; color: var(--text-muted); font-size: var(--fs-sub); padding: 24px;
  }
  .preview-empty.err { color: var(--sev-critical); }
  .preview-empty p { margin: 0; max-width: 420px; line-height: 1.6; }
  .preview-empty .sub { font-size: var(--fs-meta); }
  .big { font-size: 30px; opacity: 0.5; }

  .preview-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; padding: 7px 12px;
    border-bottom: 0.5px solid var(--border);
    font-size: var(--fs-meta); color: var(--text-muted);
    flex: 0 0 auto; flex-wrap: wrap;
  }
  .preview-title {
    display: flex; align-items: center; gap: 6px;
    color: var(--text-primary); font-size: var(--fs-sub);
  }
  .preview-title i { color: var(--accent); }

  .grid-wrap { flex: 1 1 auto; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }

  .toasts {
    position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
    display: flex; flex-direction: column; gap: 6px; align-items: center;
    z-index: 300; pointer-events: none;
  }
  .toast {
    display: flex; align-items: center; gap: 7px;
    background: var(--surface-2); color: var(--text-primary);
    border: 0.5px solid var(--border-strong); border-radius: var(--radius);
    padding: 8px 16px; font-size: var(--fs-sub); box-shadow: var(--shadow-pop);
  }
  .toast i { color: var(--success); font-size: 14px; }
  .toast.err i { color: var(--sev-critical); }

  @keyframes spin { to { transform: rotate(360deg); } }
  :global(.spin) { display: inline-block; animation: spin .8s linear infinite; }

  @media (max-width: 860px) {
    .sidebar { width: 170px; flex: 0 0 170px; }
    .target, .count-badge { display: none; }
    .lbl { display: none; }
  }

  .sr-only {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0,0,0,0); white-space: nowrap; border-width: 0;
  }
</style>
