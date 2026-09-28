<script>
  import { onMount } from 'svelte';
  import Navbar from '$lib/components/Navbar.svelte';
  import ConnectionsModal from '$lib/components/ConnectionsModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import QueueJobsPanel from '$lib/components/QueueJobsPanel.svelte';
  import * as api from '$lib/api.js';
  import { queueOnly } from '$lib/dialects.js';
  import { readPreference, applyTheme, watchSystem } from '$lib/theme.js';
  import {
    recordSamples, trend, sparklinePath, alerts,
    queueLevel, workerLevel, loadThresholds, saveThresholds, DEFAULT_THRESHOLDS
  } from '$lib/queue-trend.js';

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

  let filter = $state('');
  let hideEmpty = $state(true);
  /** `{ system, name }` of the queue whose jobs are open, or null. */
  let openQueue = $state(null);

  /** Alert levels, editable and remembered in this browser. */
  let thresholds = $state({ ...DEFAULT_THRESHOLDS });
  let thresholdsOpen = $state(false);
  /** Bumped after each poll so the sparklines recompute from fresh samples. */
  let sampleSeq = $state(0);

  const active = $derived(connections.find((c) => c.id === connectionId) || null);

  /** Only the states this Redis actually reports get a column. */
  const columns = $derived.by(() => {
    if (!data) return [];
    return data.stateOrder.filter((s) => data.queues.some((q) => q.counts && q.counts[s] != null));
  });

  const queues = $derived.by(() => {
    if (!data) return [];
    let list = data.queues;
    if (hideEmpty) list = list.filter((q) => q.backlog > 0 || q.failed > 0 || q.paused);
    const t = filter.trim().toLowerCase();
    if (t) list = list.filter((q) => `${q.name} ${q.system}`.toLowerCase().includes(t));
    return list;
  });

  const hiddenCount = $derived(data ? data.queues.length - queues.length : 0);

  const problems = $derived(data ? alerts(data, thresholds) : []);
  const schedulers = $derived(
    data ? (data.systems || []).filter((s) => s.scheduler).map((s) => ({ label: s.label, ...s.scheduler })) : []
  );

  /** Sparkline + direction for one queue; `sampleSeq` keeps it fresh. */
  function queueTrend(q) {
    sampleSeq; // read so this recomputes after every poll
    return trend(connectionId, q.system, q.name);
  }

  function applyThresholds(next) {
    thresholds = saveThresholds(next);
  }

  const workers = $derived.by(() => {
    if (!data) return [];
    const t = filter.trim().toLowerCase();
    if (!t) return data.workers;
    return data.workers.filter((w) =>
      `${w.name} ${w.queues.join(' ')} ${w.currentJob}`.toLowerCase().includes(t)
    );
  });

  onMount(() => {
    theme = readPreference();
    applyTheme(theme);
    thresholds = loadThresholds();
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
    connections = queueOnly(r.connections);
    if (connections.length === 0) return;
    if (!connections.some((c) => c.id === connectionId)) {
      let remembered = null;
      try { remembered = localStorage.getItem('qf_last_redis'); } catch (e) { /* ignore */ }
      connectionId = (connections.find((c) => c.id === remembered) || connections[0]).id;
    }
    await refresh();
  }

  async function refresh() {
    if (!connectionId || loading) return;
    loading = true;
    const r = await api.fetchQueues(connectionId);
    loading = false;
    if (r.ok) {
      data = r;
      error = '';
      lastAt = new Date();
      // Every poll is a data point; the trend is only as good as its history.
      recordSamples(connectionId, r.queues, Date.now());
      sampleSeq++;
    } else {
      error = r.error || 'Gagal membaca antrian.';
      data = null;
    }
  }

  // Refreshes are triggered explicitly. A tracking $effect would re-run on the
  // very state refresh() writes and hammer Redis in a loop.
  function switchConnection(id) {
    connectionId = id;
    try { localStorage.setItem('qf_last_redis', id); } catch (e) { /* ignore */ }
    data = null;
    error = '';
    openQueue = null;
    refresh();
  }

  $effect(() => {
    const seconds = every;
    stopTimer();
    if (seconds > 0) timer = setInterval(refresh, seconds * 1000);
    return stopTimer;
  });
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function openJobs(q) {
    openQueue = { system: q.system, name: q.name };
  }

  function exportUrl(kind) {
    return api.queueExportUrl(connectionId, { kind, format: 'csv' });
  }

  function setTheme(next) {
    theme = next;
    applyTheme(next, true);
  }

  function heartbeat(w) {
    if (w.heartbeatAgoSec == null) return '—';
    const s = w.heartbeatAgoSec;
    if (s < 60) return `${s}s lalu`;
    if (s < 3600) return `${Math.floor(s / 60)}m lalu`;
    return `${Math.floor(s / 3600)}j lalu`;
  }
  function memoryPct(server) {
    if (!server || !server.maxMemory || !server.usedMemory) return null;
    return Math.round((server.usedMemory / server.maxMemory) * 100);
  }

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
  <title>Antrian — QueryFlow</title>
  <meta name="description" content="Pantau antrian job, worker, dan kesehatan Redis; ekspor data antrian ke CSV/JSON." />
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

<div class="app">
  <Navbar active="queues" {theme} onthemechange={setTheme}
    onshortcuts={() => (shortcutsOpen = true)} onconnections={() => (connectionsOpen = true)} />

  <div class="bar">
    <div class="left">
      {#if connections.length}
        <label class="pick" title="Server Redis yang dipantau">
          <i class="ti ti-brand-redis"></i>
          <span class="sr-only">Koneksi Redis</span>
          <select value={connectionId} onchange={(e) => switchConnection(e.currentTarget.value)}>
            {#each connections as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
          <i class="ti ti-chevron-down sm"></i>
        </label>
      {:else}
        <span class="none"><i class="ti ti-plug-connected-x"></i> Belum ada koneksi Redis</span>
      {/if}
      <button class="tb-btn" onclick={refresh} disabled={!connectionId || loading} title="Muat ulang (⌘/Ctrl+R)">
        <i class="ti {loading ? 'ti-loader-2 spin' : 'ti-refresh'}"></i> <span class="lbl">Muat ulang</span>
      </button>
      <label class="pick" title="Muat ulang otomatis">
        <span class="sr-only">Interval refresh</span>
        <select bind:value={every}>
          <option value={0}>Manual</option>
          <option value={5}>tiap 5 detik</option>
          <option value={15}>tiap 15 detik</option>
          <option value={30}>tiap 30 detik</option>
        </select>
      </label>
      {#if lastAt}
        <span class="stamp">Terakhir {lastAt.toLocaleTimeString('id-ID')}{data ? ` · ${data.durationMs}ms` : ''}</span>
      {/if}
    </div>
    <div class="right">
      {#if data}
        <a class="tb-btn" href={exportUrl('queues')} download title="Unduh ringkasan semua antrian (CSV)">
          <i class="ti ti-download"></i> <span class="lbl">Ekspor antrian</span>
        </a>
        <a class="tb-btn" href={exportUrl('workers')} download title="Unduh daftar worker (CSV)">
          <i class="ti ti-download"></i> <span class="lbl">Ekspor worker</span>
        </a>
      {/if}
      <button class="tb-btn" onclick={() => (connectionsOpen = true)}>
        <i class="ti ti-settings"></i> <span class="lbl">Kelola koneksi</span>
      </button>
    </div>
  </div>

  <div class="body">
    {#if ready && connections.length === 0}
      <div class="state">
        <i class="ti ti-stack-2"></i>
        <p>Belum ada koneksi Redis.</p>
        <p class="hint">Tambahkan koneksi dengan dialek <strong>Redis</strong> untuk memantau antrian job dan worker.</p>
        <button class="primary" onclick={() => (connectionsOpen = true)}><i class="ti ti-plus"></i> Tambah koneksi</button>
      </div>
    {:else if error}
      <div class="state error" role="alert">
        <i class="ti ti-alert-octagon"></i>
        <div>
          <strong>Tidak bisa membaca antrian</strong>
          <pre>{error}</pre>
          <p class="hint">
            QueryFlow hanya membaca (<code>SCAN</code>, <code>LRANGE</code>, <code>HGETALL</code>, <code>INFO</code>).
            Pastikan user Redis punya izin perintah tersebut dan indeks database-nya benar.
          </p>
        </div>
      </div>
    {:else if data}
      <div class="cards">
        <div class="card big">
          <span class="c-label">Backlog</span>
          <span class="c-value" class:warnv={data.totals.backlog > 0}>{data.totals.backlog.toLocaleString('id-ID')}</span>
          <span class="c-sub">job menunggu + berjalan di {data.totals.queues} antrian</span>
        </div>
        <div class="card">
          <span class="c-label">Gagal</span>
          <span class="c-value" class:critv={data.totals.failed > 0}>{data.totals.failed.toLocaleString('id-ID')}</span>
          <span class="c-sub">tersimpan di registry failed</span>
        </div>
        <div class="card">
          <span class="c-label">Worker</span>
          <span class="c-value ok">{data.totals.workersBusy}<em>/ {data.totals.workers}</em></span>
          <span class="c-sub">
            sedang bekerja
            {#if data.totals.workersStale}· <strong class="critv">{data.totals.workersStale} basi</strong>{/if}
          </span>
        </div>
        {#if data.totals.paused}
          <div class="card">
            <span class="c-label">Dijeda</span>
            <span class="c-value warnv">{data.totals.paused}</span>
            <span class="c-sub">antrian tidak dikonsumsi</span>
          </div>
        {/if}
        <div class="card">
          <span class="c-label">Redis</span>
          <span class="c-value small">{data.server.usedMemoryHuman || '—'}</span>
          {#if memoryPct(data.server) != null}
            {@const pct = memoryPct(data.server)}
            <div class="meter" class:warn={pct >= 70} class:crit={pct >= 90}>
              <div class="fill" style:width={Math.min(100, pct) + '%'}></div>
            </div>
            <span class="c-sub">{pct}% dari maxmemory · {data.server.evictionPolicy}</span>
          {:else}
            <span class="c-sub">{data.server.clients} klien · {data.server.opsPerSec} ops/s</span>
          {/if}
        </div>
      </div>

      {#if data.server.evictedKeys > 0}
        <div class="notice">
          <i class="ti ti-alert-triangle"></i>
          Redis sudah mengevakuasi <strong>{data.server.evictedKeys.toLocaleString('id-ID')}</strong> key
          (<code>{data.server.evictionPolicy}</code>). Job bisa hilang dari antrian tanpa pernah diproses —
          periksa <code>maxmemory</code> sebelum menaikkan jumlah worker.
        </div>
      {/if}
      {#each data.warnings as w (w)}
        <div class="notice"><i class="ti ti-info-circle"></i> {w}</div>
      {/each}

      {#each schedulers as sch (sch.system)}
        <div class="notice" class:bad={sch.overdueSec > 60}>
          <i class="ti ti-clock-play"></i>
          <span>
            <strong>{sch.label} scheduler</strong>: {sch.scheduled.toLocaleString('id-ID')} job terjadwal.
            {#if sch.overdueSec > 60}
              Job paling awal sudah lewat <strong>{Math.floor(sch.overdueSec / 60)} menit</strong> —
              scheduler kemungkinan mati, karena job yang jatuh tempo tidak pernah masuk antrian.
            {:else if sch.nextRunAt}
              Berikutnya {new Date(sch.nextRunAt).toLocaleString('id-ID')}.
            {/if}
          </span>
        </div>
      {/each}

      {#if problems.length}
        <div class="alerts">
          <div class="a-head">
            <span><i class="ti ti-bell-ringing"></i> {problems.length} perlu perhatian</span>
            <button class="a-cfg" onclick={() => (thresholdsOpen = !thresholdsOpen)}>
              <i class="ti ti-adjustments"></i> Ambang batas
            </button>
          </div>
          <ul>
            {#each problems.slice(0, 6) as p (p.scope + p.system + p.name)}
              <li class={p.level}>
                <i class="ti {p.level === 'crit' ? 'ti-alert-octagon' : 'ti-alert-triangle'}"></i>
                <strong>{p.name}</strong>
                <span class="a-scope">{p.scope === 'queue' ? 'antrian' : 'worker'}</span>
                <span class="a-text">{p.text}</span>
              </li>
            {/each}
            {#if problems.length > 6}<li class="more">+{problems.length - 6} lainnya</li>{/if}
          </ul>
        </div>
      {/if}

      {#if thresholdsOpen}
        <div class="thresholds">
          <span class="t-title">Ambang peringatan — disimpan di browser ini</span>
          <div class="t-grid">
            {#each [
              ['backlogWarn', 'Backlog kuning'], ['backlogCrit', 'Backlog merah'],
              ['failedWarn', 'Gagal kuning'], ['failedCrit', 'Gagal merah'],
              ['heartbeatWarn', 'Heartbeat kuning (detik)'], ['heartbeatCrit', 'Heartbeat merah (detik)']
            ] as [key, label] (key)}
              <label class="t-f">
                <span>{label}</span>
                <input type="number" min="0" value={thresholds[key]}
                  onchange={(e) => applyThresholds({ ...thresholds, [key]: e.currentTarget.value })} />
              </label>
            {/each}
          </div>
          <button class="t-reset" onclick={() => applyThresholds(DEFAULT_THRESHOLDS)}>Kembalikan ke bawaan</button>
        </div>
      {/if}

      {#if data.queues.length === 0 && data.workers.length === 0}
        <div class="state">
          <i class="ti ti-search-off"></i>
          <p>Tidak menemukan antrian di Redis ini.</p>
          <p class="hint">
            Yang dikenali: python-rq (<code>rq:queue:*</code>), BullMQ/Bull (<code>bull:*</code>),
            dan Sidekiq (<code>queues</code>). Cek apakah indeks database sudah benar.
          </p>
        </div>
      {:else}
        <div class="list-head">
          <span class="lh-title">
            Antrian <strong>{queues.length}</strong>
            {#if hiddenCount > 0}<span class="of">· {hiddenCount} kosong disembunyikan</span>{/if}
          </span>
          <span class="lh-tools">
            <label class="check">
              <input type="checkbox" bind:checked={hideEmpty} />
              <span>Sembunyikan antrian kosong</span>
            </label>
            <label class="search">
              <i class="ti ti-search"></i>
              <input bind:value={filter} placeholder="Saring antrian / worker…" aria-label="Saring antrian" />
              {#if filter}<button onclick={() => (filter = '')} aria-label="Hapus filter"><i class="ti ti-x"></i></button>{/if}
            </label>
          </span>
        </div>

        <div class="scroll">
          {#if queues.length === 0}
            <p class="empty">Tidak ada antrian yang cocok.</p>
          {:else}
            <table>
              <thead>
                <tr>
                  <th scope="col">Antrian</th>
                  <th scope="col">Sistem</th>
                  {#each columns as c (c)}<th scope="col" class="num">{data.stateLabels[c] || c}</th>{/each}
                  <th scope="col" class="num">Backlog</th>
                  <th scope="col">Tren</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {#each queues as q (q.system + q.name)}
                  <!-- {@const} has to be an immediate child of the block, not of a cell -->
                  {@const t = queueTrend(q)}
                  <tr class:paused={q.paused} class={queueLevel(q, thresholds)}>
                    <td class="qname">
                      <button class="link" onclick={() => openJobs(q)} title="Lihat daftar job">
                        {q.name}
                      </button>
                      {#if q.paused}<span class="tag warn">dijeda</span>{/if}
                    </td>
                    <td class="dim">{data.systemLabels[q.system] || q.system}</td>
                    {#each columns as c (c)}
                      <td class="num" class:zero={!q.counts[c]}
                        class:critv={c === 'failed' && q.counts[c] > 0}>
                        {q.counts[c] == null ? '—' : q.counts[c].toLocaleString('id-ID')}
                      </td>
                    {/each}
                    <td class="num strong">{q.backlog.toLocaleString('id-ID')}</td>
                    <td class="trend">
                      {#if t.points.length > 1}
                        <svg viewBox="0 0 64 16" width="64" height="16" aria-hidden="true"
                          class={t.direction === 'naik' ? 'up' : t.direction === 'turun' ? 'down' : 'flat'}>
                          <path d={sparklinePath(t.points)} fill="none" stroke="currentColor" stroke-width="1.2" />
                        </svg>
                        <span class="t-delta {t.direction}">
                          {t.direction === 'naik' ? '+' : ''}{t.delta !== 0 ? t.delta.toLocaleString('id-ID') : 'datar'}
                        </span>
                      {:else}
                        <span class="dim">menunggu sampel</span>
                      {/if}
                    </td>
                    <td class="acts">
                      <button class="icon" onclick={() => openJobs(q)} title="Lihat & ekspor job">
                        <i class="ti ti-list-search"></i>
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}

          <div class="list-head sub">
            <span class="lh-title">Worker <strong>{workers.length}</strong></span>
          </div>
          {#if workers.length === 0}
            <p class="empty">
              Tidak ada worker terdaftar.
              {#if data.queues.some((q) => q.system === 'bullmq')}
                BullMQ tidak menyimpan daftar worker di Redis — QueryFlow membacanya dari <code>CLIENT LIST</code>,
                yang bisa dibatasi oleh ACL.
              {/if}
            </p>
          {:else}
            <table>
              <thead>
                <tr>
                  <th scope="col">Worker</th>
                  <th scope="col">Status</th>
                  <th scope="col">Antrian</th>
                  <th scope="col">Job sekarang</th>
                  <th scope="col" class="num">Heartbeat</th>
                  <th scope="col" class="num">Sukses</th>
                  <th scope="col" class="num">Gagal</th>
                </tr>
              </thead>
              <tbody>
                {#each workers as w (w.system + w.name)}
                  <tr class={workerLevel(w, thresholds)}>
                    <td class="mono">{w.name}{#if w.host}<span class="dim"> · {w.host}</span>{/if}</td>
                    <td>
                      <span class="tag" class:ok={w.busy} class:idle={!w.busy}>{w.state}</span>
                    </td>
                    <td class="dim">{w.queues.join(', ') || '—'}</td>
                    <td class="mono dim">
                      {w.currentJob || '—'}
                      {#if w.jobRuntimeSec != null && w.busy}<span class="dur">{w.jobRuntimeSec}s</span>{/if}
                    </td>
                    <td class="num">{heartbeat(w)}</td>
                    <td class="num">{w.succeeded == null ? '—' : w.succeeded.toLocaleString('id-ID')}</td>
                    <td class="num" class:critv={w.failed > 0}>{w.failed == null ? '—' : w.failed.toLocaleString('id-ID')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    {:else}
      <div class="state"><i class="ti ti-loader-2 spin"></i><p>Membaca antrian…</p></div>
    {/if}
  </div>

  {#if openQueue && data}
    <QueueJobsPanel
      {connectionId}
      system={openQueue.system}
      queue={openQueue.name}
      stateLabels={data.stateLabels}
      onclose={() => (openQueue = null)}
    />
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
    display: inline-flex; align-items: center; gap: 5px; text-decoration: none;
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 4px 9px; border-radius: var(--radius-sm);
  }
  .tb-btn:not(:disabled):hover { background: var(--surface-3); color: var(--text-primary); }
  .tb-btn:disabled { opacity: 0.4; cursor: default; }

  .body { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; background: var(--surface-0); }

  .cards { display: flex; gap: 8px; padding: 12px; flex-wrap: wrap; flex: 0 0 auto; }
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
  .c-value.small { font-size: 15px; font-weight: 500; }
  .c-value.ok { color: var(--success); }
  .c-sub { font-size: var(--fs-meta); color: var(--text-muted); }
  .warnv { color: var(--sev-warning); }
  .critv { color: var(--sev-critical); }
  .meter { height: 4px; background: var(--surface-3); border-radius: 3px; margin: 6px 0 3px; overflow: hidden; }
  .meter .fill { height: 100%; background: var(--success); }
  .meter.warn .fill { background: var(--sev-warning); }
  .meter.crit .fill { background: var(--sev-critical); }

  .alerts {
    margin: 0 12px 10px; border: 0.5px solid var(--wash-warning-line); border-radius: var(--radius-sm);
    background: var(--wash-warning); overflow: hidden;
  }
  .a-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 7px 11px; font-size: var(--fs-meta); color: var(--text-secondary);
    border-bottom: 0.5px solid var(--wash-warning-line);
  }
  .a-head span { display: inline-flex; align-items: center; gap: 6px; }
  .a-cfg {
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-meta); padding: 2px 8px; border-radius: var(--radius-sm);
    display: inline-flex; align-items: center; gap: 4px;
  }
  .a-cfg:hover { background: var(--surface-3); color: var(--text-primary); }
  .alerts ul { list-style: none; margin: 0; padding: 6px 11px; display: flex; flex-direction: column; gap: 4px; }
  .alerts li {
    display: flex; align-items: baseline; gap: 6px; font-size: var(--fs-meta);
    color: var(--text-secondary); flex-wrap: wrap;
  }
  .alerts li.crit i { color: var(--sev-critical); }
  .alerts li.warn i { color: var(--sev-warning); }
  .alerts li strong { color: var(--text-primary); font-family: var(--mono); }
  .a-scope {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);
    border: 0.5px solid var(--border); border-radius: 20px; padding: 0 6px;
  }
  .a-text { color: var(--text-muted); }
  .alerts li.more { color: var(--text-muted); }

  .thresholds {
    margin: 0 12px 10px; padding: 10px 11px; border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); background: var(--surface-1);
  }
  .t-title { font-size: var(--fs-meta); color: var(--text-muted); }
  .t-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin: 8px 0; }
  .t-f { display: flex; flex-direction: column; gap: 3px; font-size: var(--fs-meta); color: var(--text-muted); }
  .t-f input {
    background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-primary); font-size: var(--fs-sub); padding: 5px 8px; outline: none;
  }
  .t-f input:focus { border-color: var(--accent); }
  .t-reset {
    background: transparent; border: 0; color: var(--accent); font-size: var(--fs-meta); padding: 0;
  }
  .t-reset:hover { text-decoration: underline; }

  td.trend { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
  td.trend svg { color: var(--text-muted); flex: 0 0 auto; }
  td.trend svg.up { color: var(--sev-warning); }
  td.trend svg.down { color: var(--success); }
  .t-delta { font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-muted); }
  .t-delta.naik { color: var(--sev-warning); }
  .t-delta.turun { color: var(--success); }

  .notice.bad { background: var(--wash-critical); border-color: var(--wash-critical-line); }
  .notice {
    margin: 0 12px 10px; padding: 8px 11px; font-size: var(--fs-meta); line-height: 1.6;
    color: var(--text-secondary); background: var(--wash-warning);
    border: 0.5px solid var(--wash-warning-line); border-radius: var(--radius-sm);
    display: flex; gap: 7px; align-items: flex-start;
  }
  .notice code { font-family: var(--mono); }

  .list-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    padding: 8px 12px; border-top: 0.5px solid var(--border); border-bottom: 0.5px solid var(--border);
    background: var(--surface-1); flex: 0 0 auto;
  }
  .list-head.sub { position: sticky; left: 0; margin-top: 18px; }
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
    font-weight: 500; padding: 7px 10px; white-space: nowrap; color: var(--text-secondary);
  }
  thead th.num { text-align: right; }
  td {
    padding: 6px 10px; border-bottom: 0.5px solid var(--border);
    color: var(--text-primary); white-space: nowrap; vertical-align: top;
  }
  td.num { text-align: right; font-family: var(--mono); }
  td.num.zero { color: var(--text-muted); }
  td.strong { font-weight: 600; }
  td.mono { font-family: var(--mono); }
  td.dim { color: var(--text-muted); }
  td .dur { font-family: var(--mono); color: var(--sev-warning); margin-left: 6px; }
  tbody tr:hover td { background: var(--surface-2); }
  tbody tr.paused td { background: var(--wash-warning); }
  tbody tr.warn td.strong { color: var(--sev-warning); font-weight: 600; }
  tbody tr.crit td.strong { color: var(--sev-critical); font-weight: 700; }
  tbody tr.crit { background: var(--wash-critical); }
  tbody tr.warn td.num { color: var(--sev-warning); }
  tbody tr.crit td.num { color: var(--sev-critical); font-weight: 600; }

  .link {
    background: transparent; border: 0; padding: 0; color: var(--text-primary);
    font: inherit; text-align: left; border-bottom: 1px dotted var(--border-strong);
  }
  .link:hover { color: var(--accent); border-color: var(--accent); }
  .tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
    border-radius: 20px; padding: 1px 7px; border: 0.5px solid var(--border);
    color: var(--text-muted); margin-left: 6px;
  }
  .tag.ok { color: var(--success); border-color: var(--success); }
  .tag.idle { color: var(--text-muted); }
  .tag.warn { color: var(--sev-warning); border-color: var(--sev-warning); }
  .acts { text-align: right; }
  .acts .icon {
    background: transparent; border: 0; color: var(--text-muted);
    width: 24px; height: 24px; border-radius: var(--radius-sm); font-size: 14px;
  }
  .acts .icon:hover { background: var(--surface-3); color: var(--text-primary); }

  .state {
    flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; color: var(--text-muted); font-size: var(--fs-sub); padding: 24px; text-align: center;
  }
  .state > i { font-size: 28px; opacity: 0.5; }
  .state.error { flex-direction: row; align-items: flex-start; justify-content: flex-start; text-align: left; padding: 16px; }
  .state.error > i { color: var(--sev-critical); font-size: 18px; opacity: 1; }
  .state.error strong { display: block; color: var(--sev-critical); margin-bottom: 5px; }
  .state.error pre {
    margin: 0; font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6;
    white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
    background: var(--wash-critical); border: 0.5px solid var(--wash-critical-line);
    border-radius: var(--radius-sm); padding: 10px 12px;
  }
  .state .hint { margin: 4px 0 0; font-size: var(--fs-meta); line-height: 1.6; max-width: 60ch; }
  .state .hint code, .empty code { font-family: var(--mono); color: var(--text-secondary); }
  .empty { color: var(--text-muted); font-size: var(--fs-sub); text-align: center; padding: 24px; line-height: 1.6; }
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
  }
  @media (max-width: 560px) {
    .stamp { display: none; }
    .card, .card.big { flex: 1 1 100%; }
    .lh-tools { width: 100%; }
    .search { flex: 1 1 auto; }
    .search input { width: 100%; }
  }
</style>
