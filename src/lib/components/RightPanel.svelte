<script>
  import IssueCard from './IssueCard.svelte';
  import NodeDetail from './NodeDetail.svelte';
  import GlossaryPanel from './GlossaryPanel.svelte';
  import OptimizePanel from './OptimizePanel.svelte';

  let {
    result,
    selectedNode = null,
    activeFindingId = null,
    onfindingselect = () => {},
    oncopy = () => {},
    tab = $bindable('analysis'),
    // EXPLAIN wiring, threaded down to OptimizePanel/ExplainPanel.
    sql = '',
    dialect = 'MariaDB',
    stale = false,
    onexplainbadges = () => {},
    onfocusnode = () => {}
  } = $props();

  /** null = show everything; otherwise a single severity. */
  let sevFilter = $state(null);

  const findings = $derived(result ? result.analysis.findings : []);
  const counts = $derived(result ? result.analysis.counts : { critical: 0, warning: 0, info: 0 });
  const glossaryEntries = $derived(result ? result.glossary.entries : []);
  const optimization = $derived(result ? result.optimization : null);
  /** Count shown on the tab: things the user could actually act on. */
  const optCount = $derived(optimization ? optimization.suggestions.length + optimization.indexes.length : 0);
  const shown = $derived(sevFilter ? findings.filter((f) => f.severity === sevFilter) : findings);

  const SEVS = [
    { key: 'critical', label: 'Critical', cls: 'c-crit' },
    { key: 'warning', label: 'Warning', cls: 'c-warn' },
    { key: 'info', label: 'Info', cls: 'c-info' }
  ];

  // name->text map for NodeDetail inline first-definition
  const glossaryByName = $derived.by(() => {
    const m = {};
    for (const e of glossaryEntries) m[e.signature] = e.text;
    return m;
  });

  const nodeUsages = $derived(
    result && selectedNode ? (result.glossary.byNode[selectedNode.id] || []) : []
  );
  const nodeFindings = $derived(
    result && selectedNode ? (result.analysis.byNode[selectedNode.id] || []) : []
  );

  // auto-switch to detail tab when a node is selected
  $effect(() => {
    if (selectedNode) tab = 'detail';
  });
  // a filter that hides everything is a dead end — drop it when the result changes
  $effect(() => {
    result;
    sevFilter = null;
  });
</script>

<div class="right-panel">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'analysis'} class:active={tab === 'analysis'} onclick={() => (tab = 'analysis')}>
      Analisa
      {#if findings.length}<span class="tab-badge" class:alert={counts.critical > 0}>{findings.length}</span>{/if}
    </button>
    <button role="tab" aria-selected={tab === 'optimize'} class:active={tab === 'optimize'} onclick={() => (tab = 'optimize')}>
      Optimize
      {#if optCount}<span class="tab-badge" class:warnb={optimization?.verdict === 'perlu-perhatian'}>{optCount}</span>{/if}
    </button>
    <button role="tab" aria-selected={tab === 'detail'} class:active={tab === 'detail'} onclick={() => (tab = 'detail')}>
      Detail node
      {#if selectedNode}<span class="dot-mark"></span>{/if}
    </button>
    <button role="tab" aria-selected={tab === 'glossary'} class:active={tab === 'glossary'} onclick={() => (tab = 'glossary')}>
      Glosarium
      {#if glossaryEntries.length}<span class="tab-badge">{glossaryEntries.length}</span>{/if}
    </button>
  </div>

  <div class="panel-body">
    {#if !result}
      <div class="empty">
        <i class="ti ti-wand"></i>
        <p>Tempel query lalu klik <strong>Analisa</strong> untuk melihat diagram alur & temuan.</p>
      </div>
    {:else if tab === 'analysis'}
      {#if findings.length === 0}
        <div class="clean">
          <i class="ti ti-circle-check"></i>
          <strong>Tidak ada temuan.</strong>
          <span>Query lolos semua rule statis yang aktif untuk dialek ini.</span>
        </div>
      {:else}
        <div class="analysis-head">
          <span class="ah-title">{findings.length} temuan</span>
          <div class="filters" role="group" aria-label="Saring berdasarkan severity">
            {#each SEVS as s (s.key)}
              {#if counts[s.key]}
                <button
                  class="chip {s.cls}"
                  class:on={sevFilter === s.key}
                  aria-pressed={sevFilter === s.key}
                  onclick={() => (sevFilter = sevFilter === s.key ? null : s.key)}
                  title={`Tampilkan hanya ${s.label}`}
                >
                  <span class="bullet"></span>{counts[s.key]} {s.label}
                </button>
              {/if}
            {/each}
          </div>
        </div>

        <div class="cards">
          {#each shown as f (f.id)}
            <IssueCard finding={f} active={activeFindingId === f.id} onselect={onfindingselect} {oncopy} />
          {/each}
        </div>

        {#if sevFilter}
          <button class="clear-filter" onclick={() => (sevFilter = null)}>
            <i class="ti ti-x"></i> Tampilkan semua {findings.length} temuan
          </button>
        {/if}
      {/if}

      <p class="disclaimer">
        <i class="ti ti-info-circle"></i>
        <span>Analisa statis berbasis pola umum — bukan pengganti <code>EXPLAIN</code>/profiling pada database aktual.</span>
      </p>
    {:else if tab === 'optimize'}
      <OptimizePanel {optimization} engine={result.engine} {oncopy} {findings} onfindingselect={onfindingselect}
        flow={result.flow} {sql} {dialect} {stale} onbadges={onexplainbadges} {onfocusnode} />
    {:else if tab === 'detail'}
      <NodeDetail node={selectedNode} usages={nodeUsages} findings={nodeFindings}
        {glossaryByName} {oncopy} onfindingselect={onfindingselect} />
    {:else}
      <GlossaryPanel entries={glossaryEntries} />
    {/if}
  </div>
</div>

<style>
  .right-panel { display: flex; flex-direction: column; height: 100%; background: var(--surface-1); min-width: 0; }
  .tabs { display: flex; border-bottom: 0.5px solid var(--border); flex: 0 0 auto; }
  .tabs { overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .tabs button {
    background: transparent; border: 0; border-bottom: 2px solid transparent;
    color: var(--text-secondary); padding: 9px 10px; font-size: var(--fs-sub);
    display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
    transition: color var(--dur-fast) var(--ease);
  }
  .tabs button:hover { color: var(--text-primary); }
  .tabs button.active { color: var(--text-primary); border-bottom-color: var(--accent); }
  .tab-badge { background: var(--surface-3); color: var(--text-secondary); font-size: var(--fs-meta); border-radius: 8px; padding: 0 5px; }
  .tab-badge.alert { background: var(--sev-critical); color: #fff; }
  .tab-badge.warnb { background: var(--sev-warning); color: #1a1400; }
  .dot-mark { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); }

  .panel-body { flex: 1 1 auto; overflow-y: auto; padding: 12px; }

  .analysis-head {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    flex-wrap: wrap; margin-bottom: 10px;
  }
  .ah-title { font-size: var(--fs-sub); color: var(--text-secondary); }
  .filters { display: flex; gap: 4px; flex-wrap: wrap; }
  /* Counts used to be bare "2●" glyphs; now they say what they are and filter. */
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: var(--fs-meta); color: var(--text-secondary);
    background: transparent; border: 0.5px solid var(--border);
    border-radius: 20px; padding: 2px 8px;
    transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease);
  }
  .chip:hover { border-color: var(--border-strong); color: var(--text-primary); }
  .chip .bullet { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .chip.c-crit .bullet { background: var(--sev-critical); }
  .chip.c-warn .bullet { background: var(--sev-warning); }
  .chip.c-info .bullet { background: var(--sev-info); }
  .chip.on { background: var(--surface-3); border-color: var(--border-strong); color: var(--text-primary); }

  .cards { display: flex; flex-direction: column; gap: 8px; }
  .clear-filter {
    margin-top: 8px; width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    background: transparent; border: 0.5px dashed var(--border-strong); border-radius: var(--radius-sm);
    color: var(--text-muted); font-size: var(--fs-meta); padding: 6px;
  }
  .clear-filter:hover { color: var(--text-primary); background: var(--surface-2); }

  .clean {
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    color: var(--success); font-size: var(--fs-sub); padding: 22px 16px; text-align: center;
    border: 0.5px solid var(--border); background: var(--wash-success);
    border-radius: var(--radius-sm); line-height: 1.6;
  }
  .clean i { font-size: 22px; }
  .clean span { color: var(--text-secondary); }

  .disclaimer { margin-top: 14px; font-size: var(--fs-meta); color: var(--text-muted); line-height: 1.6; display: flex; gap: 5px; }
  .disclaimer code { font-family: var(--mono); color: var(--text-secondary); }
  .empty { color: var(--text-muted); text-align: center; padding: 50px 24px; font-size: var(--fs-sub); line-height: 1.6; }
  .empty i { font-size: 24px; display: block; margin-bottom: 10px; }
</style>
