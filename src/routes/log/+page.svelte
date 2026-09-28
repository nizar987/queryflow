<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import Navbar from '$lib/components/Navbar.svelte';
  import ConnectionsModal from '$lib/components/ConnectionsModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import KillSessionModal from '$lib/components/KillSessionModal.svelte';
  import * as api from '$lib/api.js';
  import { queryable } from '$lib/dialects.js';
  import { readPreference, applyTheme, watchSystem } from '$lib/theme.js';
  import { stash } from '$lib/handoff.js';

  let theme = $state('system');
  let shortcutsOpen = $state(false);
  let connectionsOpen = $state(false);

  let connections = $state([]);
  let connectionId = $state('');
  let ready = $state(false);

  let data = $state(null);
  let error = $state('');
  let loading = $state(false);
  let lastAt = $state(null);

  /** Auto-refresh interval in seconds; 0 = off. */
  let every = $state(0);
  let timer = null;

  /** The session waiting for confirmation, or null. */
  let killTarget = $state(null);
  let killing = $state(false);
  let killError = $state('');
  let killNote = $state('');

  let onlyActive = $state(false);
  let hideInternal = $state(true);
  let filter = $state('');
  let sortKey = $state('seconds');
  let sortDir = $state(-1);

  const active = $derived(connections.find((c) => c.id === connectionId) || null);

  const shown = $derived.by(() => {
    let list = data ? data.processes : [];
    if (hideInternal) list = list.filter((p) => !p.internal);
    if (onlyActive) list = list.filter((p) => p.busy);
    const q = filter.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.user, p.client, p.db, p.command, p.state, p.query].join(' ').toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'seconds') return ((av ?? -1) - (bv ?? -1)) * sortDir;
      return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }) * sortDir;
    });
  });

  const internalCount = $derived(data ? data.processes.filter((p) => p.internal).length : 0);

  onMount(() => {
    theme = readPreference();
    applyTheme(theme);
    const unwatch = watchSystem(() => theme);
    load().then(() => (ready = true));
    return () => {
      unwatch();
      stopTimer();
    };
  });

  async function load() {
    const r = await api.listConnections();
    if (!r.ok) {
      error = r.error || 'Gagal memuat koneksi.';
      return;
    }
    connections = queryable(r.connections);
    if (connections.length === 0) return;
    if (!connections.some((c) => c.id === connectionId)) {
      let remembered = null;
      try { remembered = localStorage.getItem('qf_last_connection'); } catch (e) { /* ignore */ }
      connectionId = (connections.find((c) => c.id === remembered) || connections[0]).id;
    }
    await refresh();
  }

  async function refresh() {
    if (!connectionId || loading) return;
    loading = true;
    const r = await api.fetchProcessList(connectionId);
    loading = false;
    if (r.ok) {
      data = r;
      error = '';
      lastAt = new Date();
    } else {
      error = r.error || 'Gagal membaca processlist.';
      data = null;
    }
  }

  // Fetching is triggered explicitly, never from a tracking $effect: an effect
  // that calls refresh() ends up tracking the very state refresh() writes
  // (loading/data/lastAt), so every response re-invalidates it and the tab
  // hammers the database in a tight loop.
  function switchConnection(id) {
    connectionId = id;
    try { localStorage.setItem('qf_last_connection', id); } catch (e) { /* ignore */ }
    data = null;
    error = '';
    refresh();
  }

  // Only the interval is derived — setInterval's callback is outside tracking.
  $effect(() => {
    const seconds = every;
    stopTimer();
    if (seconds > 0) timer = setInterval(refresh, seconds * 1000);
    return stopTimer;
  });
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function setSort(k) {
    if (sortKey === k) sortDir = -sortDir;
    else { sortKey = k; sortDir = k === 'seconds' ? -1 : 1; }
  }

  function askKill(p) {
    killTarget = p;
    killError = '';
  }

  async function doKill(mode) {
    if (!killTarget || killing) return;
    killing = true;
    killError = '';
    const r = await api.killSession(connectionId, killTarget.id, mode);
    killing = false;
    if (!r.ok) {
      killError = r.error || 'Gagal menghentikan sesi.';
      return;
    }
    killNote =
      mode === 'connection'
        ? `Koneksi sesi ${r.id} diputus.`
        : `Query pada sesi ${r.id} dibatalkan.`;
    killTarget = null;
    // The list is now stale by definition — show the result, not the old row.
    refresh();
    setTimeout(() => (killNote = ''), 6000);
  }

  function inspect(p) {
    if (!p.query) return;
    stash(p.query, active ? active.dialect : 'MariaDB');
    goto('/');
  }

  function setTheme(next) {
    theme = next;
    applyTheme(next, true);
  }

  function duration(s) {
    if (s == null) return '—';
    if (s < 60) return `${Math.round(s)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
    return `${Math.floor(s / 3600)}j ${Math.floor((s % 3600) / 60)}m`;
  }
  /** Long-running sessions are the ones worth looking at first. */
  function ageClass(p) {
    if (!p.busy || p.seconds == null) return '';
    if (p.seconds >= 60) return 'crit';
    if (p.seconds >= 10) return 'warn';
    return '';
  }

  const usage = $derived(
    data && data.summary.max ? Math.round((data.summary.total / data.summary.max) * 100) : null
  );

  function onWindowKeydown(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
    if (e.key === '?' && !inField && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      shortcutsOpen = !shortcutsOpen;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r' && !e.shiftKey) {
      e.preventDefault();
      refresh();
    }
  }
</script>

<svelte:head>
  <title>Log — QueryFlow</title>
  <meta name="description" content="Processlist dan jumlah koneksi aktif dari database yang terhubung." />
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

<div class="app">
  <Navbar active="log" {theme} onthemechange={setTheme}
    onshortcuts={() => (shortcutsOpen = true)} onconnections={() => (connectionsOpen = true)} />

  <div class="bar">
    <div class="left">
      {#if connections.length}
        <label class="pick" title="Server yang dipantau">
          <i class="ti ti-plug"></i>
          <span class="sr-only">Koneksi</span>
          <select value={connectionId} onchange={(e) => switchConnection(e.currentTarget.value)}>
            {#each connections as c (c.id)}<option value={c.id}>{c.name} · {c.dialect}</option>{/each}
          </select>
          <i class="ti ti-chevron-down sm"></i>
        </label>
      {:else}
        <span class="none"><i class="ti ti-plug-connected-x"></i> Belum ada koneksi</span>
      {/if}
      <button class="tb-btn" onclick={refresh} disabled={!connectionId || loading} title="Muat ulang (⌘/Ctrl+R)">
        <i class="ti {loading ? 'ti-loader-2 spin' : 'ti-refresh'}"></i> <span class="lbl">Muat ulang</span>
      </button>
      <label class="pick" title="Muat ulang otomatis">
        <span class="sr-only">Interval refresh</span>
        <select bind:value={every}>
          <option value={0}>Manual</option>
          <option value={2}>tiap 2 detik</option>
          <option value={5}>tiap 5 detik</option>
          <option value={15}>tiap 15 detik</option>
        </select>
      </label>
      {#if lastAt}
        <span class="stamp">Terakhir {lastAt.toLocaleTimeString('id-ID')}{data ? ` · ${data.durationMs}ms` : ''}</span>
      {/if}
    </div>
    <div class="right">
      <button class="tb-btn" onclick={() => (connectionsOpen = true)}>
        <i class="ti ti-settings"></i> <span class="lbl">Kelola koneksi</span>
      </button>
    </div>
  </div>

  <div class="body">
    {#if ready && connections.length === 0}
      <div class="state">
        <i class="ti ti-plug"></i>
        <p>Belum ada database yang terhubung.</p>
        <button class="primary" onclick={() => (connectionsOpen = true)}><i class="ti ti-plus"></i> Tambah koneksi</button>
      </div>
    {:else if error}
      <div class="state error" role="alert">
        <i class="ti ti-alert-octagon"></i>
        <div>
          <strong>Tidak bisa membaca processlist</strong>
          <pre>{error}</pre>
          <p class="hint">
            Membaca sesi lain butuh hak khusus:
            <code>PROCESS</code> di MySQL/MariaDB, <code>pg_read_all_stats</code> di PostgreSQL,
            atau role <code>clusterMonitor</code> di MongoDB.
          </p>
        </div>
      </div>
    {:else if data}
      <div class="cards">
        <div class="card big">
          <span class="c-label">Koneksi terbuka</span>
          <span class="c-value">{data.summary.total}{#if data.summary.max}<em>/ {data.summary.max}</em>{/if}</span>
          {#if usage != null}
            <div class="meter" class:warn={usage >= 70} class:crit={usage >= 90}>
              <div class="fill" style:width={Math.min(100, usage) + '%'}></div>
            </div>
            <span class="c-sub">{usage}% dari kapasitas</span>
          {/if}
        </div>
        <div class="card">
          <span class="c-label">Aktif</span>
          <span class="c-value ok">{data.summary.active}</span>
          <span class="c-sub">sedang mengerjakan query</span>
        </div>
        <div class="card">
          <span class="c-label">{data.summary.idleLabel || 'Idle'}</span>
          <span class="c-value muted">{data.summary.idle}</span>
          <span class="c-sub">terbuka tapi menganggur</span>
        </div>
        {#each data.summary.extra || [] as x (x.label)}
          <div class="card">
            <span class="c-label">{x.label}</span>
            <span class="c-value small" class:warnv={x.warn}>{x.value}</span>
          </div>
        {/each}
      </div>

      {#if data.summary.partial}
        <div class="notice">
          <i class="ti ti-eye-off"></i>
          Sebagian sesi tidak terlihat atau teks query-nya disembunyikan — user database ini tidak punya hak
          untuk melihat sesi milik user lain. Angka ringkasan di atas tetap berasal dari server.
        </div>
      {/if}
      {#if killNote}
        <div class="notice done"><i class="ti ti-circle-check"></i> {killNote}</div>
      {/if}
      {#if data.summary.note}
        <div class="notice"><i class="ti ti-info-circle"></i> {data.summary.note}</div>
      {/if}

      <div class="list-head">
        <span class="lh-title">
          Processlist <strong>{shown.length}</strong>
          {#if shown.length !== data.processes.length}<span class="of">dari {data.processes.length}</span>{/if}
        </span>
        <span class="lh-tools">
          <label class="check">
            <input type="checkbox" bind:checked={onlyActive} />
            <span>Hanya yang aktif</span>
          </label>
          {#if internalCount}
            <label class="check" title="Checkpointer, autovacuum, dan worker bawaan server">
              <input type="checkbox" bind:checked={hideInternal} />
              <span>Sembunyikan {internalCount} proses internal</span>
            </label>
          {/if}
          <label class="search">
            <i class="ti ti-search"></i>
            <input bind:value={filter} placeholder="Saring user, db, query…" aria-label="Saring processlist" />
            {#if filter}<button onclick={() => (filter = '')} aria-label="Hapus filter"><i class="ti ti-x"></i></button>{/if}
          </label>
        </span>
      </div>

      <div class="scroll">
        {#if shown.length === 0}
          <p class="empty">Tidak ada sesi yang cocok.</p>
        {:else}
          <table>
            <thead>
              <tr>
                {#each [['id','ID'],['user','User'],['client','Client'],['db','Database'],['command','Command'],['state','State'],['seconds','Durasi']] as [k, label] (k)}
                  <th scope="col" class:num={k === 'seconds'}>
                    <button onclick={() => setSort(k)}>
                      {label}{#if sortKey === k}<i class="ti {sortDir === 1 ? 'ti-arrow-up' : 'ti-arrow-down'}"></i>{/if}
                    </button>
                  </th>
                {/each}
                <th scope="col">Query</th>
                <th scope="col" class="act"><span class="sr-only">Aksi</span></th>
              </tr>
            </thead>
            <tbody>
              {#each shown as p (p.id + p.client)}
                <tr class={ageClass(p)} class:idle={!p.busy}>
                  <td class="mono">{p.id}</td>
                  <td>{p.user || '—'}</td>
                  <td class="mono dim">{p.client || '—'}</td>
                  <td>{p.db || '—'}</td>
                  <td>{p.command || '—'}</td>
                  <td class="dim">{p.state || '—'}</td>
                  <td class="num">{duration(p.seconds)}</td>
                  <td class="q">
                    {#if p.query}
                      <button class="q-btn" onclick={() => inspect(p)} title="Buka query ini di Visualizer">
                        <span class="q-text">{p.query.replace(/\s+/g, ' ')}</span>
                        <i class="ti ti-binary-tree"></i>
                      </button>
                    {:else}
                      <span class="dim">—</span>
                    {/if}
                  </td>
                  <td class="act">
                    <button class="kill-btn" onclick={() => askKill(p)}
                      title={active && active.readOnly
                        ? 'Koneksi ini read-only — penghentian sesi ditolak server'
                        : 'Hentikan sesi ini'}>
                      <i class="ti ti-hand-stop"></i>
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    {:else}
      <div class="state"><i class="ti ti-loader-2 spin"></i><p>Membaca processlist…</p></div>
    {/if}
  </div>

  {#if killTarget && active}
    <KillSessionModal
      session={killTarget}
      connection={active}
      canDropConnection={active.dialect !== 'MongoDB'}
      busy={killing}
      error={killError}
      onconfirm={doKill}
      oncancel={() => (killTarget = null)} />
  {/if}

  <ConnectionsModal open={connectionsOpen} onclose={() => (connectionsOpen = false)} onchange={load} />
  <ShortcutsModal open={shortcutsOpen} onclose={() => (shortcutsOpen = false)} />
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
  .pick {
    display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
    font-size: var(--fs-meta); color: var(--text-secondary);
    border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 3px 7px;
  }
  .pick:hover { border-color: var(--border-strong); }
  .pick select {
    background: transparent; border: 0; color: var(--text-primary);
    font-size: var(--fs-meta); outline: none; cursor: pointer; appearance: none; max-width: 220px;
  }
  .pick select option { background: var(--surface-1); color: var(--text-primary); }
  .sm { font-size: 10px; color: var(--text-muted); }
  .none { color: var(--sev-warning); font-size: var(--fs-meta); display: inline-flex; gap: 5px; align-items: center; }
  .stamp { font-size: var(--fs-meta); color: var(--text-muted); }
  .tb-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 4px 9px; border-radius: var(--radius-sm);
  }
  .tb-btn:not(:disabled):hover { background: var(--surface-3); color: var(--text-primary); }
  .tb-btn:disabled { opacity: 0.4; cursor: default; }

  .body { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; background: var(--surface-0); }

  .cards {
    display: flex; gap: 8px; padding: 12px; flex-wrap: wrap; flex: 0 0 auto;
  }
  .card {
    flex: 1 1 130px; min-width: 130px;
    background: var(--surface-1); border: 0.5px solid var(--border);
    border-radius: var(--radius); padding: 10px 12px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .card.big { flex: 1 1 210px; }
  .c-label { font-size: var(--fs-meta); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .c-value { font-size: 22px; font-weight: 600; color: var(--text-primary); line-height: 1.2; }
  .c-value em { font-style: normal; font-size: 13px; font-weight: 400; color: var(--text-muted); margin-left: 4px; }
  .c-value.small { font-size: 14px; font-weight: 500; word-break: break-word; }
  .c-value.ok { color: var(--success); }
  .c-value.muted { color: var(--text-muted); }
  .c-value.warnv { color: var(--sev-warning); }
  .c-sub { font-size: var(--fs-meta); color: var(--text-muted); }
  .meter { height: 4px; background: var(--surface-3); border-radius: 3px; margin: 6px 0 3px; overflow: hidden; }
  .meter .fill { height: 100%; background: var(--success); }
  .meter.warn .fill { background: var(--sev-warning); }
  .meter.crit .fill { background: var(--sev-critical); }

  .notice {
    margin: 0 12px 10px; padding: 8px 11px; font-size: var(--fs-meta); line-height: 1.6;
    color: var(--text-secondary); background: var(--wash-warning);
    border: 0.5px solid var(--wash-warning-line); border-radius: var(--radius-sm);
    display: flex; gap: 7px; align-items: flex-start;
  }

  .list-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    padding: 8px 12px; border-top: 0.5px solid var(--border); border-bottom: 0.5px solid var(--border);
    background: var(--surface-1); flex: 0 0 auto;
  }
  .lh-title { font-size: var(--fs-sub); color: var(--text-secondary); }
  .lh-title strong { color: var(--text-primary); }
  .lh-title .of { color: var(--text-muted); }
  .lh-tools { display: flex; align-items: center; gap: 10px; }
  .check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-meta); color: var(--text-secondary); cursor: pointer; }
  .search {
    display: flex; align-items: center; gap: 6px;
    background: var(--surface-2); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); padding: 4px 8px; color: var(--text-muted);
  }
  .search:focus-within { border-color: var(--border-strong); }
  .search input {
    background: transparent; border: 0; outline: none; color: var(--text-primary);
    font-size: var(--fs-meta); font-family: var(--sans); width: 190px;
  }
  .search button { background: transparent; border: 0; color: var(--text-muted); font-size: 12px; padding: 0; }

  .scroll { flex: 1 1 auto; overflow: auto; min-height: 0; background: var(--surface-1); }
  table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: var(--fs-sub); }
  thead th {
    position: sticky; top: 0; z-index: 2; background: var(--surface-2);
    border-bottom: 0.5px solid var(--border-strong); text-align: left;
    font-weight: 500; padding: 0; white-space: nowrap;
  }
  thead th button {
    display: flex; align-items: center; gap: 4px; width: 100%;
    background: transparent; border: 0; color: var(--text-secondary);
    font: inherit; padding: 7px 10px; text-align: left;
  }
  thead th button:hover { color: var(--text-primary); background: var(--surface-3); }
  thead th.num button { justify-content: flex-end; }
  td {
    padding: 6px 10px; border-bottom: 0.5px solid var(--border);
    color: var(--text-primary); white-space: nowrap; vertical-align: top;
  }
  td.num { text-align: right; font-family: var(--mono); }
  td.mono { font-family: var(--mono); }
  td.dim { color: var(--text-muted); }
  tbody tr:hover td { background: var(--surface-2); }
  /* Idle sessions recede; long-running ones are what you came here to find. */
  tbody tr.idle td { color: var(--text-muted); }
  tbody tr.warn td.num { color: var(--sev-warning); font-weight: 600; }
  tbody tr.crit td.num { color: var(--sev-critical); font-weight: 600; }
  tbody tr.crit { background: var(--wash-critical); }

  td.q { width: 45%; max-width: 0; white-space: normal; }
  .q-btn {
    display: flex; align-items: flex-start; gap: 6px; width: 100%; text-align: left;
    background: transparent; border: 0; padding: 0; color: var(--text-secondary);
    font-family: var(--mono); font-size: var(--fs-code); line-height: 1.5;
  }
  .q-btn:hover { color: var(--accent); }
  .q-text {
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden; flex: 1 1 auto;
  }
  .q-btn i { flex: 0 0 auto; opacity: 0; font-size: 13px; }
  .q-btn:hover i { opacity: 1; }

  td.act, thead th.act { width: 34px; text-align: center; padding-left: 0; padding-right: 6px; }
  .kill-btn {
    background: transparent; border: 0; color: var(--text-muted);
    width: 26px; height: 24px; border-radius: var(--radius-sm); font-size: 14px;
    display: inline-flex; align-items: center; justify-content: center; opacity: 0;
  }
  tbody tr:hover .kill-btn { opacity: 1; }
  .kill-btn:hover { background: var(--wash-critical); color: var(--sev-critical); }
  .kill-btn:focus-visible { opacity: 1; }
  .notice.done {
    background: var(--wash-success, var(--surface-2)); border-color: var(--border);
    color: var(--text-secondary);
  }
  .notice.done i { color: var(--success); }

  .state {
    flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; color: var(--text-muted); font-size: var(--fs-sub); padding: 24px;
  }
  .state > i { font-size: 28px; opacity: 0.5; }
  .state.error { flex-direction: row; align-items: flex-start; justify-content: flex-start; padding: 16px; }
  .state.error > i { color: var(--sev-critical); font-size: 18px; opacity: 1; }
  .state.error strong { display: block; color: var(--sev-critical); margin-bottom: 5px; }
  .state.error pre {
    margin: 0; font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6;
    white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
    background: var(--wash-critical); border: 0.5px solid var(--wash-critical-line);
    border-radius: var(--radius-sm); padding: 10px 12px;
  }
  .state .hint { margin: 8px 0 0; font-size: var(--fs-meta); line-height: 1.6; }
  .state .hint code { font-family: var(--mono); color: var(--text-secondary); }
  .empty { color: var(--text-muted); font-size: var(--fs-sub); text-align: center; padding: 30px; }
  .primary {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--accent); color: var(--accent-ink); border: 0;
    font-size: var(--fs-sub); padding: 7px 13px; border-radius: var(--radius-sm);
  }
  .primary:hover { filter: brightness(1.08); }

  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 860px) {
    .tb-btn .lbl { display: none; }
    .search input { width: 120px; }
    td.q { width: auto; }
  }
  @media (max-width: 560px) {
    .stamp { display: none; }
    .card, .card.big { flex: 1 1 100%; }
    .lh-tools { width: 100%; }
    .search { flex: 1 1 auto; }
    .search input { width: 100%; }
  }
</style>
