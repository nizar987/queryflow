<script>
    import * as api from '$lib/api.js';
  import { normalizeExplain } from '$lib/explain/normalize.js';
  import { matchExplainToFlow } from '$lib/explain/match.js';

  let {
    flow,
    sql = '',
    dialect = 'MariaDB',
    stale = false,
    // Connection state is owned by OptimizePanel: the index check in that panel
    // must run against the same database EXPLAIN does, and two independent
    // pickers on one tab would silently disagree.
    connections = [],
    connectionId = '',
    loadError = '',
    ready = false,
    onconnection = () => {},
    onbadges = () => {},
    onfocusnode = () => {},
    oncopy = () => {}
  } = $props();

  let analyzeChecked = $state(false);
  let running = $state(false);
  let runError = $state('');
  let normalized = $state(null); // output of normalizeExplain
  let matched = $state(null); // output of matchExplainToFlow
  let ranFor = $state(''); // the sql text this result belongs to
  let showRaw = $state(false);

  const active = $derived(connections.find((c) => c.id === connectionId) || null);
  const resultIsStale = $derived(!!normalized && ranFor !== sql);

  async function run(analyze) {
    // Node ids are assigned per pipeline run, starting from n-0 each time —
    // an unrelated query can easily reuse the same ids as the one currently
    // on screen. Requiring a fresh analysis first guarantees `flow` here is
    // the same flow the diagram is showing, so a badge can never land on a
    // node that no longer means what it meant when EXPLAIN ran.
    if (!connectionId || !sql.trim() || running || stale) return;
    running = true;
    runError = '';
    const r = await api.explainQuery(connectionId, sql, analyze);
    running = false;

    if (!r.ok) {
      runError = r.error || 'EXPLAIN gagal.';
      normalized = null;
      matched = null;
      onbadges({});
      return;
    }

    const norm = normalizeExplain(dialect, r.raw);
    const m = matchExplainToFlow(flow, norm);
    normalized = { ...norm, durationMs: r.durationMs };
    matched = m;
    ranFor = sql;
    onbadges(m.badges);
  }

  function focusRow(row) {
    if (row.nodeId) onfocusnode(row.nodeId);
  }

  const ACCESS_LABEL = { full: 'Full scan', index: 'Pakai index', other: 'Lainnya' };
  const ACCESS_CLS = { full: 'bad', index: 'good', other: 'warn' };
</script>

<div class="explain">
  <div class="head">
    <span class="title"><i class="ti ti-report-analytics"></i> EXPLAIN — rencana eksekusi sungguhan</span>
    <span class="sub">Jalankan ke database yang terhubung untuk melihat angka nyata, bukan perkiraan dari teks query.</span>
  </div>

  {#if !ready}
    <p class="muted"><i class="ti ti-loader-2 spin"></i> Memuat koneksi…</p>
  {:else if loadError}
    <p class="err"><i class="ti ti-alert-circle"></i> {loadError}</p>
  {:else if connections.length === 0}
    <p class="muted">
      <i class="ti ti-plug-connected-x"></i>
      Belum ada koneksi database. Tambahkan lewat ikon colokan di navbar untuk memakai EXPLAIN.
    </p>
  {:else}
    <div class="controls">
      <label class="pick">
        <span class="sr-only">Koneksi</span>
        <select value={connectionId} onchange={(e) => onconnection(e.currentTarget.value)}>
          {#each connections as c (c.id)}<option value={c.id}>{c.name} · {c.dialect}</option>{/each}
        </select>
      </label>

      <button class="run" onclick={() => run(false)} disabled={running || !sql.trim() || stale}
        title={stale ? 'Klik Analisa dulu — EXPLAIN butuh diagram yang cocok dengan query ini' : ''}>
        {#if running}<i class="ti ti-loader-2 spin"></i>{:else}<i class="ti ti-report-analytics"></i>{/if}
        Jalankan EXPLAIN
      </button>

      {#if /postgre/i.test(active?.dialect || '')}
        <label class="analyze-toggle" title="Menjalankan query sungguhan untuk mengukur waktu nyata — hanya untuk SELECT.">
          <input type="checkbox" bind:checked={analyzeChecked} disabled={stale} />
          <span>Sertakan ANALYZE (eksekusi nyata, hanya SELECT)</span>
        </label>
        {#if analyzeChecked}
          <button class="run warn" onclick={() => run(true)} disabled={running || !sql.trim() || stale}>
            <i class="ti ti-player-play"></i> Jalankan EXPLAIN ANALYZE
          </button>
        {/if}
      {/if}
    </div>

    {#if stale}
      <p class="notice"><i class="ti ti-refresh-alert"></i> Query di editor sudah berubah — klik <strong>Analisa</strong> dulu supaya EXPLAIN punya diagram yang cocok untuk ditandai.</p>
    {/if}
    {#if resultIsStale}
      <p class="notice"><i class="ti ti-alert-triangle"></i> Hasil di bawah ini untuk versi query sebelumnya. Jalankan ulang EXPLAIN untuk memperbarui.</p>
    {/if}

    {#if runError}
      <p class="err"><i class="ti ti-alert-octagon"></i> {runError}</p>
    {/if}

    {#if normalized}
      <div class="summary">
        <span class="s-item">
          <span class="s-lbl">{normalized.analyzed ? 'Waktu eksekusi' : 'Estimasi biaya'}</span>
          <span class="s-val">
            {#if normalized.analyzed}
              {normalized.totalTimeMs != null ? normalized.totalTimeMs.toFixed(2) + 'ms' : '—'}
            {:else}
              {normalized.totalCost != null ? normalized.totalCost.toLocaleString('id-ID') : '—'}
            {/if}
          </span>
        </span>
        {#if normalized.planningTimeMs != null}
          <span class="s-item"><span class="s-lbl">Planning</span><span class="s-val">{normalized.planningTimeMs.toFixed(2)}ms</span></span>
        {/if}
        <span class="s-item">
          <span class="s-lbl">Sumber</span>
          <span class="s-val tag" class:tag-live={normalized.analyzed}>{normalized.analyzed ? 'Eksekusi nyata' : 'Estimasi planner'}</span>
        </span>
        <span class="s-item"><span class="s-lbl">Waktu panggilan</span><span class="s-val">{normalized.durationMs}ms</span></span>
      </div>

      {#if normalized.warnings.length}
        <ul class="warnings">
          {#each normalized.warnings as w, i (i)}
            <li><i class="ti ti-alert-triangle"></i> {w}</li>
          {/each}
        </ul>
      {/if}

      {#if matched.rows.length}
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>Tabel</th><th>Akses</th><th>Index</th>
                <th class="num">Baris</th><th class="num">Waktu</th><th></th>
              </tr>
            </thead>
            <tbody>
              {#each matched.rows as row, i (row.table + i)}
                <tr class:clickable={!!row.nodeId} onclick={() => focusRow(row)}>
                  <td class="mono">{row.table}{#if row.alias && row.alias !== row.table} <span class="dim">({row.alias})</span>{/if}</td>
                  <td><span class="chip {ACCESS_CLS[row.access]}">{row.accessLabel}</span></td>
                  <td class="mono dim">{row.index || '—'}</td>
                  <td class="num">
                    {#if row.actualRows != null}{row.actualRows.toLocaleString('id-ID')}
                    {:else if row.estRows != null}<span class="dim">~{row.estRows.toLocaleString('id-ID')}</span>
                    {:else}—{/if}
                  </td>
                  <td class="num">{row.actualTimeMs != null ? row.actualTimeMs.toFixed(2) + 'ms' : '—'}</td>
                  <td class="jump">{#if row.nodeId}<i class="ti ti-target-arrow"></i>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if matched.unmatched.length}
          <p class="hint"><i class="ti ti-info-circle"></i> {matched.unmatched.length} baris rencana tidak bisa dicocokkan ke node diagram (biasanya tabel yang tidak muncul langsung di FROM/JOIN).</p>
        {/if}
      {/if}

      <details class="raw" bind:open={showRaw}>
        <summary>Rencana mentah (JSON)</summary>
        <div class="raw-actions">
          <button onclick={() => oncopy(JSON.stringify(normalized.raw, null, 2))}><i class="ti ti-copy"></i> Salin JSON</button>
        </div>
        <pre>{JSON.stringify(normalized.raw, null, 2)}</pre>
      </details>
    {:else if !running}
      <p class="muted">Klik <strong>Jalankan EXPLAIN</strong> untuk melihat rencana eksekusi sungguhan dari database ini.</p>
    {/if}
  {/if}
</div>

<style>
  .explain { display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; padding-bottom: 14px; border-bottom: 0.5px solid var(--border); }
  .head { display: flex; flex-direction: column; gap: 2px; }
  .title { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sub); color: var(--text-primary); font-weight: 500; }
  .sub { font-size: var(--fs-meta); color: var(--text-muted); }

  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  .muted { font-size: var(--fs-sub); color: var(--text-muted); display: flex; gap: 6px; align-items: flex-start; margin: 0; }
  .err { font-size: var(--fs-sub); color: var(--sev-critical); display: flex; gap: 6px; align-items: flex-start; margin: 0; }
  .notice {
    margin: 0; font-size: var(--fs-meta); color: var(--sev-warning);
    background: var(--wash-warning); border: 0.5px solid var(--wash-warning-line);
    border-radius: var(--radius-sm); padding: 6px 9px; display: flex; gap: 6px; align-items: flex-start;
  }

  .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .pick {
    border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    background: var(--surface-2); padding: 4px 8px;
  }
  .pick select { background: transparent; border: 0; color: var(--text-primary); font-size: var(--fs-sub); outline: none; max-width: 180px; }
  .pick select option { background: var(--surface-1); }
  .run {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--accent); color: var(--accent-ink); border: 0;
    font-size: var(--fs-sub); padding: 6px 12px; border-radius: var(--radius-sm);
  }
  .run:hover:not(:disabled) { filter: brightness(1.08); }
  .run:disabled { opacity: 0.5; }
  .run.warn { background: var(--sev-warning); color: #1a1400; }
  .analyze-toggle {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: var(--fs-meta); color: var(--text-muted); cursor: pointer;
  }

  .summary { display: flex; gap: 14px; flex-wrap: wrap; padding: 8px 0; }
  .s-item { display: flex; flex-direction: column; gap: 1px; }
  .s-lbl { font-size: var(--fs-meta); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .s-val { font-size: var(--fs-sub); color: var(--text-primary); font-family: var(--mono); }
  .s-val.tag {
    font-family: var(--sans); border-radius: 20px; padding: 1px 8px; font-size: var(--fs-meta);
    background: var(--surface-2); color: var(--text-muted); display: inline-block; width: fit-content;
  }
  .s-val.tag-live { background: var(--wash-success); color: var(--success); }

  .warnings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .warnings li {
    display: flex; gap: 6px; align-items: flex-start; font-size: var(--fs-sub); color: var(--text-secondary);
    background: var(--wash-warning); border: 0.5px solid var(--wash-warning-line);
    border-radius: var(--radius-sm); padding: 6px 9px; line-height: 1.5;
  }
  .warnings li i { color: var(--sev-warning); margin-top: 1px; flex: 0 0 auto; }

  .scroll { overflow-x: auto; border: 0.5px solid var(--border); border-radius: var(--radius-sm); }
  table { border-collapse: collapse; width: 100%; font-size: var(--fs-meta); }
  thead th {
    text-align: left; padding: 6px 8px; background: var(--surface-2);
    color: var(--text-muted); font-weight: 500; white-space: nowrap;
  }
  th.num, td.num { text-align: right; }
  td { padding: 6px 8px; border-top: 0.5px solid var(--border); color: var(--text-primary); white-space: nowrap; }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover td { background: var(--surface-2); }
  .mono { font-family: var(--mono); }
  .dim { color: var(--text-muted); }
  .jump { color: var(--text-muted); width: 14px; }
  .chip {
    font-size: 10px; border-radius: 20px; padding: 1px 7px; display: inline-block;
    border: 0.5px solid currentColor;
  }
  .chip.good { color: var(--success); }
  .chip.bad { color: var(--sev-critical); }
  .chip.warn { color: var(--sev-warning); }

  .hint { margin: 0; font-size: var(--fs-meta); color: var(--text-muted); display: flex; gap: 5px; align-items: flex-start; }

  .raw summary { cursor: pointer; font-size: var(--fs-meta); color: var(--text-muted); padding: 4px 0; }
  .raw-actions { display: flex; justify-content: flex-end; margin: 4px 0; }
  .raw-actions button {
    display: inline-flex; align-items: center; gap: 4px; background: transparent;
    border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-muted); font-size: var(--fs-meta); padding: 3px 8px;
  }
  .raw-actions button:hover { color: var(--text-primary); background: var(--surface-2); }
  .raw pre {
    margin: 0; max-height: 260px; overflow: auto; font-family: var(--mono); font-size: 11px;
    line-height: 1.5; color: var(--text-secondary); background: var(--surface-0);
    border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px;
  }

  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
