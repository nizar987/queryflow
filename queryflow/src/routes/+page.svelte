<script>
  import { onMount } from 'svelte';
  import Navbar from '$lib/components/Navbar.svelte';
  import HistorySidebar from '$lib/components/HistorySidebar.svelte';
  import ContextToolbar from '$lib/components/ContextToolbar.svelte';
  import QueryEditor from '$lib/components/QueryEditor.svelte';
  import DiagramView from '$lib/components/DiagramView.svelte';
  import RightPanel from '$lib/components/RightPanel.svelte';
  import ConvertModal from '$lib/components/ConvertModal.svelte';
  import { runPipeline, engineForDialect } from '$lib/pipeline.js';
  import { convertQuery } from '$lib/convert/index.js';
  import { toMarkdown } from '$lib/export/markdown.js';
  import { exportPNG, exportSVG, downloadText } from '$lib/export/image.js';
  import { buildShareUrl, parseShareHash } from '$lib/export/share.js';

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
  let loadingStage = $state('');

  let selectedNodeId = $state(null);
  let highlightNodeId = $state(null);
  let activeFindingId = $state(null);
  let rightTab = $state('analysis');

  let history = $state([]);
  let activeHistId = $state(null);
  let svgEl = null;
  let toast = $state('');

  // convert
  let convertOpen = $state(false);
  let convertFrom = $state('');
  let convertTo = $state('');
  let convertResult = $state(null);

  const selectedNode = $derived(result && selectedNodeId ? result.flow.nodesById[selectedNodeId] : null);

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
    // load shared query from URL hash (local-only share — nothing was uploaded)
    const shared = parseShareHash(location.hash);
    if (shared) {
      sql = shared.sql;
      dialect = shared.dialect;
      analyze();
    }
    try {
      const raw = localStorage.getItem('qf_history');
      if (raw) history = JSON.parse(raw);
    } catch (e) { /* ignore */ }
  });

  function persistHistory() {
    try { localStorage.setItem('qf_history', JSON.stringify(history.slice(0, 12))); } catch (e) { /* ignore */ }
  }

  async function analyze() {
    if (loading) return;
    loading = true;
    error = null; errorLoc = null; relaxed = false;
    selectedNodeId = null; highlightNodeId = null; activeFindingId = null;

    // staged loading for clear feedback (DESIGN §7.5)
    loadingStage = 'Parsing query…';
    await tick(60);
    const r = runPipeline(sql, { dialect });
    if (!r.ok) {
      error = r.error; errorLoc = r.location || null; result = null; loading = false; loadingStage = '';
      return;
    }
    loadingStage = 'Membangun diagram…';
    await tick(50);
    loadingStage = 'Menjalankan analisa…';
    await tick(50);

    result = r;
    relaxed = r.relaxed;
    rightTab = 'analysis';
    loading = false; loadingStage = '';
    addHistory(r);
  }

  function tick(ms) { return new Promise((res) => setTimeout(res, ms)); }

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
  }

  function loadHistory(id) {
    const h = history.find((x) => x.id === id);
    if (!h) return;
    sql = h.sql; dialect = h.dialect; activeHistId = id;
    analyze();
  }

  // node ↔ finding linking (DESIGN §4.6, §7)
  function selectNode(id) {
    selectedNodeId = id;
    rightTab = 'detail';
    const fs = result && result.analysis.byNode[id];
    activeFindingId = fs && fs.length ? fs[0].id : null;
  }
  function selectFinding(f) {
    activeFindingId = f.id;
    if (f.nodeId) {
      selectedNodeId = f.nodeId;
      highlightNodeId = f.nodeId;
      setTimeout(() => (highlightNodeId = null), 1200);
    }
  }

  // exports
  async function doPNG() { if (svgEl) try { await exportPNG(svgEl); showToast('PNG diunduh'); } catch (e) { showToast('Export PNG gagal'); } }
  function doSVG() { if (svgEl) { exportSVG(svgEl); showToast('SVG diunduh'); } }
  function doMD() {
    if (!result) return;
    downloadText(toMarkdown(sql, result, { dialect, engine }), 'queryflow-analisa.md', 'text/markdown');
    showToast('Markdown diunduh');
  }
  async function doShare() {
    const url = buildShareUrl(sql, dialect);
    try { await navigator.clipboard.writeText(url); showToast('Link share disalin ke clipboard'); }
    catch (e) { history.length; showToast('Tidak bisa menyalin — cek izin clipboard'); }
  }
  function showToast(msg) { toast = msg; setTimeout(() => (toast = ''), 2200); }

  // convert flow
  function doConvert(target) {
    if (!sql.trim()) { showToast('Editor kosong — tidak ada yang dikonversi'); return; }
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
    showToast(`Dimuat sebagai ${target}`);
  }
  async function copyConverted(text) {
    try { await navigator.clipboard.writeText(text); showToast('Hasil konversi disalin'); }
    catch (e) { showToast('Tidak bisa menyalin'); }
  }
</script>

<svelte:head>
  <title>QueryFlow — SQL & NoSQL Query Visualizer & Debugger</title>
  <meta name="description" content="Visualisasi alur eksekusi & debugger statis untuk query SQL (MariaDB/MySQL/PostgreSQL) dan MongoDB. Lokal di browser, dengan konversi antar-dialek." />
</svelte:head>

<div class="app">
  <Navbar active="visualizer" />
  <div class="body">
    <HistorySidebar {history} activeId={activeHistId} onnew={newQuery} onselect={loadHistory} />
    <div class="work">
      <ContextToolbar bind:dialect canExport={!!result} canConvert={!!sql.trim()}
        onexportPNG={doPNG} onexportSVG={doSVG} onexportMD={doMD} onshare={doShare} onconvert={doConvert} />

      <div class="input-zone">
        <QueryEditor bind:value={sql} onanalyze={analyze} {loading} {engine}
          placeholder={engine === 'mongo'
            ? '// Tempel pipeline MongoDB: db.coll.aggregate([ … ])'
            : '-- Tempel query SQL di sini lalu klik Analisa'} />
        {#if error}
          <div class="error">
            <i class="ti ti-alert-octagon"></i>
            <div>
              <strong>Parsing gagal{errorLoc ? ` (baris ${errorLoc.line})` : ''}.</strong>
              <span>{error}</span>
            </div>
          </div>
        {:else if relaxed}
          <div class="note"><i class="ti ti-info-circle"></i> Beberapa identifier (mis. <code>status</code>) di-quote otomatis agar bisa diparse.</div>
        {/if}
        {#if loading && loadingStage}
          <div class="stage"><i class="ti ti-loader-2 spin"></i> {loadingStage}</div>
        {/if}
      </div>

      <div class="results">
        <div class="diagram-pane">
          {#if result}
            <DiagramView flow={result.flow} badges={result.badges}
              {selectedNodeId} {highlightNodeId}
              onnodeselect={selectNode} bindSvg={(el) => (svgEl = el)} />
          {:else}
            <div class="placeholder">
              <i class="ti ti-binary-tree"></i>
              <p>Diagram alur eksekusi akan muncul di sini.</p>
            </div>
          {/if}
        </div>
        <div class="panel-pane">
          <RightPanel {result} {selectedNode} {activeFindingId} bind:tab={rightTab}
            onfindingselect={selectFinding} />
        </div>
      </div>
    </div>
  </div>

  <ConvertModal open={convertOpen} from={convertFrom} to={convertTo} result={convertResult}
    onclose={() => (convertOpen = false)} onload={loadConverted} oncopy={copyConverted} />

  {#if toast}<div class="toast">{toast}</div>{/if}
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .body { flex: 1 1 auto; display: flex; min-height: 0; }
  .work { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; }
  .input-zone { padding: 10px 12px; background: var(--surface-0); border-bottom: 0.5px solid var(--border); flex: 0 0 auto; }
  .error {
    margin-top: 8px; display: flex; gap: 8px; align-items: flex-start;
    background: rgba(229,86,75,0.08); border: 0.5px solid rgba(229,86,75,0.35);
    border-radius: var(--radius-sm); padding: 8px 10px; font-size: var(--fs-sub);
  }
  .error i { color: var(--sev-critical); font-size: 15px; margin-top: 1px; }
  .error strong { display: block; color: var(--text-primary); }
  .error span { color: var(--text-secondary); }
  .note { margin-top: 8px; font-size: var(--fs-meta); color: var(--text-muted); display: flex; gap: 5px; align-items: center; }
  .note code { font-family: var(--mono); color: var(--text-secondary); }
  .stage { margin-top: 8px; font-size: var(--fs-sub); color: var(--text-secondary); display: flex; gap: 6px; align-items: center; }
  .spin { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .results { flex: 1 1 auto; display: grid; grid-template-columns: 1.1fr 1fr; min-height: 0; }
  .diagram-pane { border-right: 0.5px solid var(--border); min-width: 0; overflow: hidden; }
  .panel-pane { min-width: 0; overflow: hidden; }
  .placeholder { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-muted); font-size: var(--fs-sub); }
  .placeholder i { font-size: 30px; margin-bottom: 10px; opacity: 0.5; }
  .toast {
    position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
    background: var(--surface-3); color: var(--text-primary);
    border: 0.5px solid var(--border-strong); border-radius: var(--radius);
    padding: 8px 16px; font-size: var(--fs-sub); z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
</style>
