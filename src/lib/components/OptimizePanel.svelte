<script>
  import { onMount } from 'svelte';
  import ExplainPanel from './ExplainPanel.svelte';
  import * as api from '$lib/api.js';
  import { queryable } from '$lib/dialects.js';
  import { annotateSuggestions, findRedundant, tablesOf } from '$lib/analyzer/index-match.js';
  // The panel is re-created on every Analisa run, so the last check is kept in
  // a module outside the component — see index-cache.js.
  import { cacheKey as indexCacheKey, getCached, putCached, dropCached } from '$lib/analyzer/index-cache.js';

  let {
    optimization,
    engine = 'sql',
    oncopy = () => {},
    onfindingselect = null,
    findings = [],
    // EXPLAIN wiring — only meaningful for the SQL engine (see the guard below).
    flow = null,
    sql = '',
    dialect = 'MariaDB',
    stale = false,
    onbadges = () => {},
    onfocusnode = () => {}
  } = $props();

  const VERDICT = {
    rapi: {
      icon: 'ti-circle-check',
      cls: 'good',
      title: 'Tidak ada yang menonjol',
      text: 'Tidak ditemukan pola yang biasanya memperlambat query ini. Tetap ukur dengan EXPLAIN pada data sebenarnya.'
    },
    'bisa-dioptimalkan': {
      icon: 'ti-progress-check',
      cls: 'ok',
      title: 'Ada ruang perbaikan',
      text: 'Tidak ada masalah berat, tapi beberapa hal bisa dirapikan agar lebih murah dijalankan.'
    },
    'perlu-perhatian': {
      icon: 'ti-alert-triangle',
      cls: 'bad',
      title: 'Belum optimal',
      text: 'Ada pola yang berdampak besar pada kecepatan. Mulai dari yang ditandai tinggi.'
    }
  };

  const IMPACT = {
    high: { label: 'Dampak besar', cls: 'high' },
    medium: { label: 'Dampak sedang', cls: 'med' },
    low: { label: 'Dampak kecil', cls: 'low' }
  };

  const v = $derived(VERDICT[optimization?.verdict] || VERDICT['bisa-dioptimalkan']);
  const suggestions = $derived(optimization?.suggestions || []);
  // Connections live here, not in ExplainPanel: the index check and EXPLAIN
  // must talk to the same database, and one picker is one source of truth.
  let connections = $state([]);
  let connectionId = $state('');
  let loadError = $state('');
  let ready = $state(false);

  /** Result of the last index check: { indexes, forTables, dialect, at }. */
  let installed = $state(null);
  let checking = $state(false);
  let checkError = $state('');

  onMount(async () => {
    const r = await api.listConnections();
    ready = true;
    if (!r.ok) {
      loadError = r.error || 'Gagal memuat koneksi.';
      return;
    }
    connections = queryable(r.connections);
    if (!connections.length) return;
    let remembered = null;
    try { remembered = localStorage.getItem('qf_last_connection'); } catch (e) { /* ignore */ }
    const byDialect = connections.find((c) => c.dialect === dialect);
    const byMemory = remembered ? connections.find((c) => c.id === remembered) : null;
    connectionId = (byDialect || byMemory || connections[0]).id;
  });

  function pickConnection(id) {
    connectionId = id;
    checkError = '';
  }

  const rawIndexes = $derived(optimization?.indexes || []);

  /**
   * The suggestions, annotated with what the database already has. Until the
   * check runs this is the plain list, so nothing claims to know more than it
   * does.
   */
  const indexes = $derived.by(() => {
    if (!installed) return rawIndexes.map((s) => ({ ...s, status: 'unknown', matches: [] }));
    return annotateSuggestions(rawIndexes, installed.indexes);
  });

  const redundant = $derived(installed ? findRedundant(installed.indexes) : []);
  const coveredCount = $derived(indexes.filter((i) => i.status === 'covered').length);
  const checkedTables = $derived(installed ? installed.forTables : []);

  const cacheKey = $derived(indexCacheKey(connectionId, tablesOf(rawIndexes)));

  // Adopt a cached answer whenever the connection or the tables change. This
  // reads cacheKey and writes `installed`, which nothing here reads back, so it
  // settles after one pass.
  $effect(() => {
    installed = getCached(cacheKey);
  });

  async function checkIndexes() {
    const tables = tablesOf(rawIndexes);
    if (!connectionId || tables.length === 0 || checking) return;
    const key = indexCacheKey(connectionId, tables);
    checking = true;
    checkError = '';
    const r = await api.listIndexes(connectionId, tables);
    checking = false;
    if (r.ok) {
      installed = putCached(key, { indexes: r.indexes, forTables: tables, dialect: r.dialect, at: Date.now() });
    } else {
      dropCached(key);
      installed = null;
      checkError = r.error || 'Gagal membaca index.';
    }
  }

  /** "baru saja" / "3 menit lalu" — how current the status on screen is. */
  function readAge(at) {
    const mins = Math.floor((Date.now() - at) / 60000);
    return mins < 1 ? 'baru saja' : `${mins} menit lalu`;
  }

  const STATUS = {
    covered: { cls: 'good', icon: 'ti-circle-check', label: 'Sudah ada' },
    partial: { cls: 'warn', icon: 'ti-circle-half-2', label: 'Ada sebagian' },
    missing: { cls: 'bad', icon: 'ti-circle-plus', label: 'Belum ada' }
  };
  const checks = $derived(optimization?.checks || []);
  const passed = $derived(checks.filter((c) => c.ok).length);

  let copied = $state('');
  function copy(text, id) {
    oncopy(text);
    copied = id;
    setTimeout(() => (copied = ''), 1400);
  }

  /** Jump to the diagram node this suggestion came from. */
  function focusFinding(s) {
    if (!onfindingselect || !s.findingId) return;
    const f = findings.find((x) => x.id === s.findingId);
    if (f) onfindingselect(f);
  }
</script>

<div class="opt">
  {#if flow}
    <ExplainPanel {flow} {sql} {dialect} {stale} {onbadges} {onfocusnode} {oncopy}
      {connections} {connectionId} {loadError} {ready} onconnection={pickConnection} />
  {/if}

  <div class="verdict {v.cls}">
    <div class="v-top">
      <i class="ti {v.icon}"></i>
      <div>
        <strong>{v.title}</strong>
        <p>{v.text}</p>
      </div>
      <div class="score" title="Ringkasan dari jumlah & bobot saran di bawah — bukan hasil pengukuran">
        <span class="s-num">{optimization?.score ?? 0}</span>
        <span class="s-lbl">/100</span>
      </div>
    </div>
  </div>

  {#if suggestions.length}
    <div class="section-label">Yang bisa diperbaiki ({suggestions.length})</div>
    <div class="cards">
      {#each suggestions as s (s.id)}
        <div class="card {IMPACT[s.impact].cls}">
          <div class="c-head">
            <span class="impact {IMPACT[s.impact].cls}">{IMPACT[s.impact].label}</span>
            <span class="c-title">{s.title}</span>
            {#if onfindingselect && s.nodeId}
              <button class="jump" onclick={() => focusFinding(s)} title="Sorot di diagram">
                <i class="ti ti-target-arrow"></i>
              </button>
            {/if}
          </div>
          <p class="why">{s.why}</p>
          {#if s.after}
            <div class="fix">
              <span class="tag">
                Perbaikan
                <button class="copy" onclick={() => copy(s.after, s.id)}>
                  <i class="ti {copied === s.id ? 'ti-check' : 'ti-copy'}"></i>{copied === s.id ? 'Tersalin' : 'Salin'}
                </button>
              </span>
              <code>{s.after}</code>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if indexes.length}
    <div class="section-label">
      Index yang diminta query ini ({indexes.length})
    </div>
    <p class="idx-note">
      Disusun dari kolom yang difilter, di-join, dan diurutkan. Urutan kolom penting:
      kolom <em>equality</em> dulu, baru rentang dan sorting.
    </p>

    <div class="idx-check">
      {#if !ready}
        <span class="muted"><i class="ti ti-loader-2 spin"></i> Memuat koneksi…</span>
      {:else if loadError}
        <span class="err"><i class="ti ti-alert-circle"></i> {loadError}</span>
      {:else if connections.length === 0}
        <span class="muted">
          <i class="ti ti-plug-connected-x"></i>
          Hubungkan database untuk memeriksa index mana yang sebenarnya sudah terpasang.
        </span>
      {:else}
        <label class="pick">
          <span class="sr-only">Koneksi</span>
          <select value={connectionId} onchange={(e) => pickConnection(e.currentTarget.value)}>
            {#each connections as c (c.id)}<option value={c.id}>{c.name} · {c.dialect}</option>{/each}
          </select>
        </label>
        <button class="check-btn" onclick={checkIndexes} disabled={checking || !connectionId}>
          {#if checking}<i class="ti ti-loader-2 spin"></i>{:else}<i class="ti ti-database-search"></i>{/if}
          {installed ? 'Periksa ulang' : 'Cek index terpasang'}
        </button>
        {#if installed}
          <span class="check-sum">
            {coveredCount}/{indexes.length} sudah ada · {installed.indexes.length} index terbaca
            dari {checkedTables.length} tabel · {readAge(installed.at)}
          </span>
        {/if}
      {/if}
    </div>

    {#if checkError}
      <p class="idx-alert bad"><i class="ti ti-alert-circle"></i> {checkError}</p>
    {:else if !installed && !checking && connections.length > 0}
      <p class="idx-alert">
        <i class="ti ti-info-circle"></i>
        Status di bawah belum diperiksa ke database. Klik <strong>Cek index terpasang</strong> supaya
        saran yang index-nya sudah ada tidak ikut dianjurkan lagi.
      </p>
    {/if}
    <div class="cards">
      {#each indexes as idx, i (idx.table + i)}
        <div class="card idx" class:covered={idx.status === 'covered'}>
          <div class="c-head">
            <i class="ti ti-key idx-ic"></i>
            <span class="c-title">{idx.table}</span>
            <span class="cols">
              {#each idx.columns as c (c.column)}
                <span class="col {c.role}" title={c.role}>{c.column}{#if c.dir === 'DESC'} ↓{/if}</span>
              {/each}
            </span>
            {#if STATUS[idx.status]}
              <span class="status {STATUS[idx.status].cls}">
                <i class="ti {STATUS[idx.status].icon}"></i> {STATUS[idx.status].label}
              </span>
            {/if}
          </div>
          <p class="why">{idx.reason}</p>

          {#if idx.matches.length}
            <ul class="matches">
              {#each idx.matches as m (m.name)}
                <li>
                  <code>{m.name}</code>
                  <span class="m-cols">({m.columns.join(', ')})</span>
                  <!-- MySQL literally names the primary key "PRIMARY"; the tag
                       would just repeat it. -->
                  {#if m.primary && !/^primary$/i.test(m.name)}<span class="m-tag">primary</span>
                  {:else if m.unique && !m.primary}<span class="m-tag">unique</span>{/if}
                  <span class="m-cover">
                    {m.covers >= m.of ? 'menutup semua kolom yang diminta' : `cocok ${m.covers} dari ${m.of} kolom pertama`}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}

          <div class="fix">
            <span class="tag">
              {engine === 'mongo' ? 'Perintah' : 'DDL'}
              <button class="copy" onclick={() => copy(idx.sql, 'idx' + i)}>
                <i class="ti {copied === 'idx' + i ? 'ti-check' : 'ti-copy'}"></i>{copied === 'idx' + i ? 'Tersalin' : 'Salin'}
              </button>
            </span>
            <code>{idx.sql}</code>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if redundant.length}
    <div class="section-label">Index yang mungkin mubazir ({redundant.length})</div>
    <p class="idx-note">
      Kolom-kolomnya sudah menjadi awalan dari index lain, jadi query yang bisa dilayani index ini
      juga bisa dilayani index yang lebih panjang itu — sementara biaya tulis dan ruangnya tetap dibayar.
      Pastikan dulu tidak ada query yang bergantung padanya sebelum menghapus.
    </p>
    <ul class="redundant">
      {#each redundant as r (r.table + r.name)}
        <li>
          <i class="ti ti-copy-off"></i>
          <div>
            <code>{r.name}</code> <span class="m-cols">({r.columns.join(', ')})</span>
            <span class="m-tag">{r.table}</span>
            <p class="hint">
              {r.duplicate ? 'Duplikat persis dari' : 'Sudah tercakup oleh'}
              <code>{r.coveredBy}</code> <span class="m-cols">({r.coveredByColumns.join(', ')})</span>
            </p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if checks.length}
    <div class="section-label">Pemeriksaan ({passed}/{checks.length} lolos)</div>
    <ul class="checks">
      {#each checks as c (c.label)}
        <li class:ok={c.ok}>
          <i class="ti {c.ok ? 'ti-circle-check' : 'ti-circle-x'}"></i>
          <div>
            <span>{c.label}</span>
            {#if !c.ok && c.hint}<p class="hint">{c.hint}</p>{/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  <p class="disclaimer">
    <i class="ti ti-info-circle"></i>
    <span>
      {#if installed}
        Status <em>sudah ada / belum ada</em> dibaca langsung dari katalog database lewat koneksi
        <strong>{connections.find((c) => c.id === connectionId)?.name}</strong>. Yang tetap tidak diketahui:
        seberapa besar tabelnya dan seberapa selektif filternya — jadi ukur dengan
        <code>{engine === 'mongo' ? 'explain("executionStats")' : 'EXPLAIN'}</code> sebelum dan sesudah mengubah.
      {:else}
        Saran ini dibaca dari teks query saja. Selama belum diperiksa, QueryFlow
        <strong>tidak tahu index apa yang sudah ada</strong>, seberapa besar tabelnya, atau seberapa
        selektif filternya — jadi ukur dengan
        <code>{engine === 'mongo' ? 'explain("executionStats")' : 'EXPLAIN'}</code> sebelum dan sesudah mengubah.
      {/if}
      Setiap index mempercepat baca tapi memperlambat tulis.
    </span>
  </p>
</div>

<style>
  .opt { display: flex; flex-direction: column; gap: 10px; }

  .verdict { border: 0.5px solid var(--border); border-radius: var(--radius); padding: 12px; }
  .verdict.good { background: var(--wash-success); border-color: transparent; }
  .verdict.ok { background: var(--surface-2); }
  .verdict.bad { background: var(--wash-warning); border-color: var(--wash-warning-line); }
  .v-top { display: flex; align-items: flex-start; gap: 10px; }
  .v-top > i { font-size: 20px; flex: 0 0 auto; margin-top: 1px; }
  .verdict.good > .v-top > i { color: var(--success); }
  .verdict.ok > .v-top > i { color: var(--text-secondary); }
  .verdict.bad > .v-top > i { color: var(--sev-warning); }
  .v-top > div { flex: 1 1 auto; min-width: 0; }
  .v-top strong { display: block; font-size: var(--fs-body); color: var(--text-primary); }
  .v-top p { margin: 3px 0 0; font-size: var(--fs-sub); color: var(--text-secondary); line-height: 1.55; }
  .score { flex: 0 0 auto; text-align: right; }
  .s-num { font-size: 22px; font-weight: 600; color: var(--text-primary); }
  .s-lbl { font-size: var(--fs-meta); color: var(--text-muted); }

  .section-label {
    font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.05em; margin-top: 6px;
  }
  .idx-check {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 8px;
    font-size: var(--fs-meta); color: var(--text-muted);
  }
  .idx-check .pick {
    border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 3px 7px;
  }
  .idx-check select {
    background: transparent; border: 0; color: var(--text-primary);
    font-size: var(--fs-meta); outline: none; cursor: pointer; max-width: 200px;
  }
  .idx-check select option { background: var(--surface-1); color: var(--text-primary); }
  .check-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-meta); padding: 4px 9px; border-radius: var(--radius-sm);
  }
  .check-btn:not(:disabled):hover { background: var(--surface-3); color: var(--text-primary); }
  .check-btn:disabled { opacity: 0.5; cursor: default; }
  .check-sum { color: var(--text-muted); }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  .idx-alert {
    margin: 0 0 10px; font-size: var(--fs-meta); line-height: 1.6; color: var(--text-secondary);
    display: flex; gap: 6px; align-items: flex-start;
  }
  .idx-alert.bad { color: var(--sev-critical); }

  .status {
    margin-left: auto; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
    border-radius: 20px; padding: 1px 7px; border: 0.5px solid currentColor;
    display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
  }
  .status.good { color: var(--success); }
  .status.warn { color: var(--sev-warning); }
  .status.bad { color: var(--sev-critical); }
  /* An index that already exists is not a to-do — let it recede. */
  .card.idx.covered { opacity: 0.72; }

  .matches, .redundant { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .matches li, .redundant li {
    font-size: var(--fs-meta); color: var(--text-secondary); line-height: 1.6;
    display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap;
  }
  .redundant li { align-items: flex-start; }
  .redundant { margin: 0 0 12px; }
  .matches code, .redundant code { font-family: var(--mono); color: var(--text-primary); }
  .m-cols { font-family: var(--mono); color: var(--text-muted); }
  .m-tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);
    border: 0.5px solid var(--border); border-radius: 20px; padding: 0 6px;
  }
  .m-cover { color: var(--text-muted); }

  .idx-note { margin: 0; font-size: var(--fs-meta); color: var(--text-muted); line-height: 1.6; }
  .idx-note em { font-style: normal; color: var(--text-secondary); }

  .cards { display: flex; flex-direction: column; gap: 8px; }
  .card {
    border: 0.5px solid var(--border); border-left-width: 2px;
    border-radius: var(--radius-sm); padding: 9px 11px; background: var(--surface-1);
  }
  .card.high { border-left-color: var(--sev-critical); }
  .card.med { border-left-color: var(--sev-warning); }
  .card.low { border-left-color: var(--sev-info); }
  .card.idx { border-left-color: var(--c-teal); }

  .c-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--fs-body); }
  .c-title { color: var(--text-primary); }
  .impact {
    font-size: 9px; letter-spacing: 0.04em; text-transform: uppercase;
    border-radius: 20px; padding: 2px 7px; border: 0.5px solid currentColor;
  }
  .impact.high { color: var(--sev-critical); }
  .impact.med { color: var(--sev-warning); }
  .impact.low { color: var(--text-muted); }
  .idx-ic { color: var(--c-teal); font-size: 14px; }
  .jump {
    margin-left: auto; background: transparent; border: 0;
    color: var(--text-muted); font-size: 13px; padding: 0;
  }
  .jump:hover { color: var(--accent); }

  .cols { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .col {
    font-family: var(--mono); font-size: 10px; padding: 1px 6px; border-radius: 3px;
    background: var(--surface-2); color: var(--text-secondary);
  }
  .col.equality { color: var(--success); }
  .col.join { color: var(--c-blue); }
  .col.range { color: var(--sev-warning); }
  .col.sort { color: var(--c-purple); }

  .why { margin: 7px 0 0; font-size: var(--fs-sub); line-height: 1.6; color: var(--text-secondary); }
  .fix { margin-top: 8px; }
  .tag {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px;
  }
  .copy {
    display: inline-flex; align-items: center; gap: 4px;
    background: transparent; border: 0; padding: 0;
    color: var(--text-muted); font-size: var(--fs-meta); text-transform: none; letter-spacing: 0;
  }
  .copy:hover { color: var(--accent); }
  .fix code {
    display: block; font-family: var(--mono); font-size: var(--fs-code);
    background: var(--wash-success); color: var(--success);
    border-radius: 3px; padding: 6px 8px; white-space: pre-wrap; word-break: break-word;
    line-height: 1.55;
  }

  .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .checks li {
    display: flex; gap: 7px; align-items: flex-start;
    font-size: var(--fs-sub); color: var(--text-secondary);
  }
  .checks li i { color: var(--sev-warning); font-size: 14px; margin-top: 1px; flex: 0 0 auto; }
  .checks li.ok i { color: var(--success); }
  .checks li.ok span { color: var(--text-muted); }
  .checks .hint { margin: 2px 0 0; font-size: var(--fs-meta); color: var(--text-muted); line-height: 1.5; }

  .disclaimer {
    margin-top: 8px; font-size: var(--fs-meta); color: var(--text-muted);
    line-height: 1.6; display: flex; gap: 6px; align-items: flex-start;
  }
  .disclaimer code, .disclaimer strong { font-family: var(--mono); color: var(--text-secondary); font-weight: 400; }
  .disclaimer strong { font-family: var(--sans); color: var(--text-secondary); font-weight: 600; }
</style>
