<script>
  import { onMount } from 'svelte';
  import Navbar from '$lib/components/Navbar.svelte';
  import HistorySidebar from '$lib/components/HistorySidebar.svelte';
  import ContextToolbar from '$lib/components/ContextToolbar.svelte';
  import QueryEditor from '$lib/components/QueryEditor.svelte';
  import DiagramView from '$lib/components/DiagramView.svelte';
  import RightPanel from '$lib/components/RightPanel.svelte';
  import ConvertModal from '$lib/components/ConvertModal.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import ConnectionsModal from '$lib/components/ConnectionsModal.svelte';
  import { runPipeline, engineForDialect } from '$lib/pipeline.js';
  import { convertQuery } from '$lib/convert/index.js';
  import { toMarkdown } from '$lib/export/markdown.js';
  import { exportPNG, exportSVG, downloadText } from '$lib/export/image.js';
  import { buildShareUrl, parseShareHash } from '$lib/export/share.js';
  import { readPreference, applyTheme, watchSystem } from '$lib/theme.js';
  import { stash, take } from '$lib/handoff.js';
  import { goto } from '$app/navigation';

  const SAMPLE_SQL = `SELECT v.name, v.owner,
  (SELECT COUNT(*) FROM tabComment c WHERE c.reference_name = v.docname) AS comments
FROM tabVersion v
JOIN tabUser u ON u.name = v.owner
WHERE v.ref_doctype = 'Sales Order'
  AND DATE(v.creation) = '2026-06-01'
ORDER BY v.creation DESC;`;

  const SAMPLE_MONGO = `db.orders.aggregate([
  { $lookup: { from: "users", localField: "owner", foreignField: "_id", as: "user" } },
  { $unwind: "$user" },
  { $match: { status: "active" } },
  { $group: { _id: "$owner", total: { $sum: "$amount" } } },
  { $sort: { total: -1 } }
])`;

  const SAMPLES = { sql: SAMPLE_SQL, mongo: SAMPLE_MONGO };

  let sql = $state(SAMPLE_SQL);
  let dialect = $state('MariaDB');
  const engine = $derived(engineForDialect(dialect));
  let result = $state(null);
  let error = $state(null);
  let errorLoc = $state(null);
  let relaxed = $state(false);
  let loading = $state(false);

  let selectedNodeId = $state(null);
  let highlightNodeId = $state(null);
  /** nodeId -> real EXPLAIN facts from ExplainPanel, overlaid on the diagram. */
  let explainBadges = $state({});
  let activeFindingId = $state(null);
  let rightTab = $state('analysis');

  let history = $state([]);
  let activeHistId = $state(null);
  let svgEl = null;
  let toasts = $state([]);
  let toastSeq = 0;

  // chrome / layout
  let theme = $state('system');
  let shortcutsOpen = $state(false);
  let connectionsOpen = $state(false);
  let splitPct = $state(55); // diagram share of the results row
  let narrow = $state(false); // < 900px — panes stack behind a switcher
  let mobilePane = $state('diagram');

  // Two independent states: a persisted desktop preference, and a transient
  // mobile drawer. Folding them into one meant a window resize could strand the
  // sidebar closed with no way back.
  let sidebarPref = $state(false); // collapsed on desktop?
  let drawerOpen = $state(false); // open over the workspace on narrow screens?
  const sidebarCollapsed = $derived(narrow ? !drawerOpen : sidebarPref);
  let editorRef = $state(null);

  // convert
  let convertOpen = $state(false);
  let convertFrom = $state('');
  let convertTo = $state('');
  let convertResult = $state(null);

  const selectedNode = $derived(result && selectedNodeId ? result.flow.nodesById[selectedNodeId] : null);

  // The query text that produced `result`. When the editor drifts from it, the
  // diagram on screen is stale — previously nothing said so.
  let analyzedSql = $state(null);
  let analyzedDialect = $state(null);
  const stale = $derived(!!result && (sql !== analyzedSql || dialect !== analyzedDialect));

  // When switching SQL <-> Mongo, swap the starter sample if the editor is empty
  // or still holds the other engine's untouched sample (don't clobber user edits).
  let lastEngine = 'sql'; // matches default dialect MariaDB
  $effect(() => {
    const e = engine;
    if (e !== lastEngine) {
      const trimmed = sql.trim();
      const isUntouched = trimmed === '' || trimmed === SAMPLE_SQL.trim() || trimmed === SAMPLE_MONGO.trim();
      if (isUntouched) {
        sql = SAMPLES[e];
        result = null; error = null; selectedNodeId = null;
      }
      lastEngine = e;
    }
  });

  onMount(() => {
    theme = readPreference();
    applyTheme(theme);
    const unwatch = watchSystem(() => theme);

    const mq = matchMedia('(max-width: 900px)');
    const syncNarrow = () => {
      narrow = mq.matches;
      if (!narrow) drawerOpen = false;
    };
    syncNarrow();
    mq.addEventListener('change', syncNarrow);

    // a query sent over from the Query tab wins over the starter sample
    const handed = take();
    if (handed) {
      sql = handed.query;
      if (handed.dialect) dialect = handed.dialect;
      lastEngine = engineForDialect(dialect);
      analyze();
    }

    // load shared query from URL hash (local-only share — nothing was uploaded)
    const shared = parseShareHash(location.hash);
    if (shared) {
      sql = shared.sql;
      dialect = shared.dialect;
      lastEngine = engineForDialect(shared.dialect);
      analyze();
    }
    try {
      const raw = localStorage.getItem('qf_history');
      if (raw) history = JSON.parse(raw);
    } catch (e) { /* ignore */ }
    try {
      sidebarPref = localStorage.getItem('qf_sidebar') === '1';
    } catch (e) { /* ignore */ }

    return () => {
      unwatch();
      mq.removeEventListener('change', syncNarrow);
    };
  });

  function setTheme(next) {
    theme = next;
    applyTheme(next, true);
  }
  function toggleSidebar() {
    if (narrow) {
      drawerOpen = !drawerOpen;
      return;
    }
    sidebarPref = !sidebarPref;
    try { localStorage.setItem('qf_sidebar', sidebarPref ? '1' : '0'); } catch (e) { /* ignore */ }
  }

  /** App-level shortcuts. Typing inside the editor must not trigger them. */
  function onWindowKeydown(e) {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      newQuery();
      editorRef?.focus();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleSidebar();
      return;
    }
    if (e.key === '?' && !inField && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      shortcutsOpen = !shortcutsOpen;
    }
  }

  function persistHistory() {
    try { localStorage.setItem('qf_history', JSON.stringify(history.slice(0, 12))); } catch (e) { /* ignore */ }
  }

  function analyze() {
    if (loading || !sql.trim()) return;
    loading = true;
    error = null; errorLoc = null; relaxed = false;
    selectedNodeId = null; highlightNodeId = null; activeFindingId = null;
    // A new flow means every previous node id is meaningless — an EXPLAIN
    // overlay computed against the old diagram must not linger on the new one.
    explainBadges = {};

    const r = runPipeline(sql, { dialect });
    if (!r.ok) {
      error = r.error; errorLoc = r.location || null; result = null; loading = false;
      analyzedSql = null; analyzedDialect = null;
      return;
    }

    result = r;
    relaxed = r.relaxed;
    rightTab = 'analysis';
    analyzedSql = sql;
    analyzedDialect = dialect;
    loading = false;
    if (narrow) mobilePane = 'diagram';
    addHistory(r);
  }

  function addHistory(r) {
    const entry = {
      id: 'h' + Date.now(),
      sql,
      dialect,
      ts: Date.now(),
      findingCount: r.analysis.findings.length
    };
    history = [entry, ...history.filter((h) => h.sql !== sql)].slice(0, 12);
    activeHistId = entry.id;
    persistHistory();
  }

  function newQuery() {
    sql = ''; result = null; error = null; selectedNodeId = null;
    highlightNodeId = null; activeFindingId = null; activeHistId = null;
    analyzedSql = null; analyzedDialect = null;
  }

  function loadHistory(id) {
    const h = history.find((x) => x.id === id);
    if (!h) return;
    sql = h.sql; dialect = h.dialect; activeHistId = id;
    lastEngine = engineForDialect(h.dialect);
    analyze();
    drawerOpen = false;
  }
  function deleteHistory(id) {
    history = history.filter((h) => h.id !== id);
    if (activeHistId === id) activeHistId = null;
    persistHistory();
    showToast('Dihapus dari riwayat');
  }
  function clearHistory() {
    history = [];
    activeHistId = null;
    persistHistory();
    showToast('Riwayat dibersihkan');
  }

  function loadSample(which) {
    sql = SAMPLES[which];
    dialect = which === 'mongo' ? 'MongoDB' : 'MariaDB';
    lastEngine = which;
    analyze();
  }

  // node ↔ finding linking (DESIGN §4.6, §7)
  function selectNode(id) {
    selectedNodeId = id;
    rightTab = 'detail';
    if (narrow) mobilePane = 'panel';
    const fs = result && result.analysis.byNode[id];
    activeFindingId = fs && fs.length ? fs[0].id : null;
  }
  /** Flash a node without switching tabs — for jumping from an EXPLAIN row. */
  function focusNode(id) {
    highlightNodeId = id;
    if (narrow) mobilePane = 'diagram';
    setTimeout(() => (highlightNodeId = null), 1200);
  }
  function selectFinding(f) {
    activeFindingId = f.id;
    if (f.nodeId) {
      selectedNodeId = f.nodeId;
      highlightNodeId = f.nodeId;
      if (narrow) mobilePane = 'diagram';
      setTimeout(() => (highlightNodeId = null), 1200);
    }
  }

  /** Drag the divider between diagram and panel. */
  function startSplit(e) {
    e.preventDefault();
    const row = e.currentTarget.parentElement;
    const rect = row.getBoundingClientRect();
    const move = (ev) => {
      splitPct = Math.min(80, Math.max(25, ((ev.clientX - rect.left) / rect.width) * 100));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function splitKeys(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); splitPct = Math.max(25, splitPct - 4); }
    if (e.key === 'ArrowRight') { e.preventDefault(); splitPct = Math.min(80, splitPct + 4); }
  }

  // exports
  async function doPNG() { if (svgEl) try { await exportPNG(svgEl); showToast('PNG diunduh', 'ok'); } catch (e) { showToast('Export PNG gagal', 'err'); } }
  function doSVG() { if (svgEl) { exportSVG(svgEl); showToast('SVG diunduh', 'ok'); } }
  function doMD() {
    if (!result) return;
    downloadText(toMarkdown(sql, result, { dialect, engine }), 'queryflow-analisa.md', 'text/markdown');
    showToast('Markdown diunduh', 'ok');
  }
  async function doShare() {
    const url = buildShareUrl(sql, dialect);
    try { await navigator.clipboard.writeText(url); showToast('Link share disalin ke clipboard', 'ok'); }
    catch (e) { showToast('Tidak bisa menyalin — cek izin clipboard', 'err'); }
  }
  async function copyText(text, label = 'Disalin ke clipboard') {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); showToast(label, 'ok'); }
    catch (e) { showToast('Tidak bisa menyalin — cek izin clipboard', 'err'); }
  }

  /** Hand the editor's query to the Query tab so it can be run for real. */
  function toQueryTab() {
    if (!sql.trim()) { showToast('Editor kosong', 'err'); return; }
    stash(sql, dialect);
    goto('/query');
  }

  function showToast(msg, kind = 'ok') {
    const id = ++toastSeq;
    toasts = [...toasts, { id, msg, kind }];
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 2600);
  }

  // convert flow
  function doConvert(target) {
    if (!sql.trim()) { showToast('Editor kosong — tidak ada yang dikonversi', 'err'); return; }
    convertFrom = dialect;
    convertTo = target;
    convertResult = null;
    convertOpen = true;
    // run after paint so the modal shows its loading state
    setTimeout(() => { convertResult = convertQuery(sql, dialect, target); }, 30);
  }
  function loadConverted(text, target) {
    sql = text;
    dialect = target;
    lastEngine = engineForDialect(target); // prevent the sample-swap effect from clobbering
    convertOpen = false;
    result = null; error = null; selectedNodeId = null;
    analyzedSql = null; analyzedDialect = null;
    showToast(`Dimuat sebagai ${target}`);
  }
</script>

<svelte:head>
  <title>QueryFlow — SQL & NoSQL Query Visualizer & Debugger</title>
  <meta name="description" content="Visualisasi alur eksekusi & debugger statis untuk query SQL (MariaDB/MySQL/PostgreSQL) dan MongoDB. Lokal di browser, dengan konversi antar-dialek." />
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

<div class="app">
  <Navbar active="visualizer" {theme} onthemechange={setTheme}
    onshortcuts={() => (shortcutsOpen = true)} onconnections={() => (connectionsOpen = true)} />
  <div class="body">
    <HistorySidebar
      {history}
      activeId={activeHistId}
      collapsed={sidebarCollapsed}
      ontoggle={toggleSidebar}
      onnew={() => { newQuery(); editorRef?.focus(); }}
      onselect={loadHistory}
      ondelete={deleteHistory}
      onclear={clearHistory}
    />
    <div class="work">
      <ContextToolbar bind:dialect canExport={!!result} canConvert={!!sql.trim()} {stale}
        canRun={!!sql.trim()} onrun={toQueryTab}
        onexportPNG={doPNG} onexportSVG={doSVG} onexportMD={doMD} onshare={doShare} onconvert={doConvert} />

      <div class="input-zone">
        <QueryEditor bind:this={editorRef} bind:value={sql} onanalyze={analyze} {loading} {engine} {stale}
          {dialect}
          errorLine={errorLoc?.line ?? null}
          oncopy={(t) => copyText(t, 'Query disalin')}
          placeholder={engine === 'mongo'
            ? '// Tempel pipeline MongoDB: db.coll.aggregate([ … ])'
            : '-- Tempel query SQL di sini lalu klik Analisa'} />
        {#if error}
          <div class="error" role="alert">
            <i class="ti ti-alert-octagon"></i>
            <div>
              <strong>Parsing gagal{errorLoc ? ` (baris ${errorLoc.line})` : ''}.</strong>
              <span>{error}</span>
            </div>
          </div>
        {:else if relaxed}
          <div class="note"><i class="ti ti-info-circle"></i> Beberapa identifier (mis. <code>status</code>) di-quote otomatis agar bisa diparse.</div>
        {/if}
      </div>

      {#if narrow && result}
        <div class="pane-switch" role="tablist" aria-label="Tampilan hasil">
          <button role="tab" aria-selected={mobilePane === 'diagram'} class:on={mobilePane === 'diagram'}
            onclick={() => (mobilePane = 'diagram')}><i class="ti ti-binary-tree"></i> Diagram</button>
          <button role="tab" aria-selected={mobilePane === 'panel'} class:on={mobilePane === 'panel'}
            onclick={() => (mobilePane = 'panel')}>
            <i class="ti ti-list-search"></i> Analisa
            {#if result.analysis.findings.length}<span class="mini">{result.analysis.findings.length}</span>{/if}
          </button>
        </div>
      {/if}

      <div class="results" style:--split="{splitPct}%">
        {#if !narrow || mobilePane === 'diagram'}
          <div class="diagram-pane">
            {#if result}
              <DiagramView flow={result.flow} badges={result.badges}
                {selectedNodeId} {highlightNodeId} {explainBadges}
                onnodeselect={selectNode} bindSvg={(el) => (svgEl = el)} />
            {:else}
              <div class="placeholder">
                <i class="ti ti-binary-tree"></i>
                <p class="ph-title">Diagram alur eksekusi akan muncul di sini</p>
                <p class="ph-sub">Tempel query lalu tekan <kbd>⌘</kbd><kbd>↵</kbd>, atau mulai dari contoh:</p>
                <div class="ph-actions">
                  <button onclick={() => loadSample('sql')}><i class="ti ti-database"></i> Contoh SQL</button>
                  <button onclick={() => loadSample('mongo')}><i class="ti ti-leaf"></i> Contoh MongoDB</button>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        {#if !narrow}
          <!-- Focusable window splitter (WAI-ARIA separator) — the a11y linter
               treats every separator as decorative, hence the suppressions. -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
          <div
            class="splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ubah lebar panel"
            aria-valuenow={Math.round(splitPct)}
            aria-valuemin={25}
            aria-valuemax={80}
            tabindex="0"
            onpointerdown={startSplit}
            onkeydown={splitKeys}
          ><span class="grip"></span></div>
        {/if}

        {#if !narrow || mobilePane === 'panel'}
          <div class="panel-pane">
            <RightPanel {result} {selectedNode} {activeFindingId} bind:tab={rightTab}
              {sql} {dialect} {stale}
              onexplainbadges={(b) => (explainBadges = b)} onfocusnode={focusNode}
              onfindingselect={selectFinding} oncopy={(t) => copyText(t)} />
          </div>
        {/if}
      </div>
    </div>
  </div>

  <ConvertModal open={convertOpen} from={convertFrom} to={convertTo} result={convertResult}
    onclose={() => (convertOpen = false)} onload={loadConverted} oncopy={(t) => copyText(t, 'Hasil konversi disalin')} />
  <ShortcutsModal open={shortcutsOpen} onclose={() => (shortcutsOpen = false)} />
  <ConnectionsModal open={connectionsOpen} onclose={() => (connectionsOpen = false)} />

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
  .body { flex: 1 1 auto; display: flex; min-height: 0; position: relative; }
  .work { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
  .input-zone { padding: 10px 12px; background: var(--surface-0); border-bottom: 0.5px solid var(--border); flex: 0 0 auto; }
  .error {
    margin-top: 8px; display: flex; gap: 8px; align-items: flex-start;
    background: var(--wash-critical); border: 0.5px solid var(--wash-critical-line);
    border-radius: var(--radius-sm); padding: 8px 10px; font-size: var(--fs-sub);
  }
  .error i { color: var(--sev-critical); font-size: 15px; margin-top: 1px; }
  .error strong { display: block; color: var(--text-primary); }
  .error span { color: var(--text-secondary); }
  .note { margin-top: 8px; font-size: var(--fs-meta); color: var(--text-muted); display: flex; gap: 5px; align-items: center; }
  .note code { font-family: var(--mono); color: var(--text-secondary); }

  .results { flex: 1 1 auto; display: flex; min-height: 0; }
  .diagram-pane { flex: 0 0 var(--split); min-width: 0; overflow: hidden; }
  .panel-pane { flex: 1 1 auto; min-width: 0; overflow: hidden; border-left: 0.5px solid var(--border); }

  /* Fixed 1.1fr/1fr before — the panel could never be widened to read a long fix. */
  .splitter {
    flex: 0 0 7px; cursor: col-resize; background: var(--surface-0);
    display: flex; align-items: center; justify-content: center;
  }
  .splitter .grip { width: 2px; height: 28px; border-radius: 2px; background: var(--border-strong); }
  .splitter:hover .grip { background: var(--accent); }

  .placeholder {
    height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: var(--text-muted); font-size: var(--fs-sub); text-align: center; padding: 24px;
  }
  .placeholder > i { font-size: 32px; margin-bottom: 12px; opacity: 0.45; }
  .ph-title { margin: 0; color: var(--text-secondary); font-size: var(--fs-body); }
  .ph-sub { margin: 6px 0 14px; }
  .ph-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .ph-actions button {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    color: var(--text-secondary); font-size: var(--fs-sub);
    padding: 6px 12px; border-radius: var(--radius-sm);
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  }
  .ph-actions button:hover { background: var(--surface-2); color: var(--text-primary); border-color: var(--accent-line); }
  kbd {
    font-family: var(--sans); font-size: 10px; border: 0.5px solid var(--border-strong);
    border-bottom-width: 1.5px; border-radius: 3px; padding: 2px 4px; margin: 0 1px;
    color: var(--text-secondary); background: var(--surface-1);
  }

  .pane-switch { display: flex; gap: 4px; padding: 8px 12px 0; background: var(--surface-0); }
  .pane-switch button {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    background: var(--surface-1); border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 7px; border-radius: var(--radius-sm);
  }
  .pane-switch button.on { background: var(--surface-2); color: var(--text-primary); border-color: var(--border-strong); }
  .pane-switch .mini { background: var(--surface-3); border-radius: 8px; padding: 0 5px; font-size: var(--fs-meta); }

  .toasts {
    position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
    display: flex; flex-direction: column; gap: 6px; align-items: center; z-index: 300;
    pointer-events: none;
  }
  .toast {
    display: flex; align-items: center; gap: 7px;
    background: var(--surface-2); color: var(--text-primary);
    border: 0.5px solid var(--border-strong); border-radius: var(--radius);
    padding: 8px 16px; font-size: var(--fs-sub); box-shadow: var(--shadow-pop);
    animation: toast-in var(--dur-med) var(--ease);
  }
  .toast i { color: var(--success); font-size: 14px; }
  .toast.err i { color: var(--sev-critical); }
  @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } }

  @media (max-width: 900px) {
    .diagram-pane { flex: 1 1 auto; }
    .panel-pane { border-left: 0; }
    .input-zone { padding: 8px; }
    .pane-switch { padding: 8px 8px 0; }
  }
</style>
