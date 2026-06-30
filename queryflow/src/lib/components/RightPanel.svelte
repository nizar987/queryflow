<script>
  import IssueCard from './IssueCard.svelte';
  import NodeDetail from './NodeDetail.svelte';
  import GlossaryPanel from './GlossaryPanel.svelte';

  let {
    result,
    selectedNode = null,
    activeFindingId = null,
    onfindingselect = () => {},
    tab = $bindable('analysis')
  } = $props();

  const findings = $derived(result ? result.analysis.findings : []);
  const counts = $derived(result ? result.analysis.counts : { critical: 0, warning: 0, info: 0 });
  const glossaryEntries = $derived(result ? result.glossary.entries : []);

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
</script>

<div class="right-panel">
  <div class="tabs">
    <button class:active={tab === 'analysis'} onclick={() => (tab = 'analysis')}>
      Analisa
      {#if findings.length}<span class="tab-badge">{findings.length}</span>{/if}
    </button>
    <button class:active={tab === 'detail'} onclick={() => (tab = 'detail')}>Detail node</button>
    <button class:active={tab === 'glossary'} onclick={() => (tab = 'glossary')}>
      Glosarium
      {#if glossaryEntries.length}<span class="tab-badge">{glossaryEntries.length}</span>{/if}
    </button>
  </div>

  <div class="panel-body">
    {#if !result}
      <div class="empty"><i class="ti ti-wand"></i><p>Tempel query lalu klik <strong>Analisa</strong> untuk melihat diagram alur & temuan.</p></div>
    {:else if tab === 'analysis'}
      <div class="analysis-head">
        <span>Analisa masalah ({findings.length} temuan)</span>
        <span class="sev-counts">
          {#if counts.critical}<span class="c-crit">{counts.critical}●</span>{/if}
          {#if counts.warning}<span class="c-warn">{counts.warning}●</span>{/if}
          {#if counts.info}<span class="c-info">{counts.info}●</span>{/if}
        </span>
      </div>
      {#if findings.length === 0}
        <div class="clean"><i class="ti ti-circle-check"></i> Tidak ada temuan dari rule statis. Query terlihat rapi.</div>
      {:else}
        <div class="cards">
          {#each findings as f (f.id)}
            <IssueCard finding={f} active={activeFindingId === f.id} onselect={onfindingselect} />
          {/each}
        </div>
      {/if}
      <p class="disclaimer">
        <i class="ti ti-info-circle"></i>
        Analisa statis berbasis pola umum — bukan pengganti <code>EXPLAIN</code>/profiling pada database aktual.
      </p>
    {:else if tab === 'detail'}
      <NodeDetail node={selectedNode} usages={nodeUsages} findings={nodeFindings}
        {glossaryByName} onfindingselect={onfindingselect} />
    {:else}
      <GlossaryPanel entries={glossaryEntries} />
    {/if}
  </div>
</div>

<style>
  .right-panel { display: flex; flex-direction: column; height: 100%; background: var(--surface-1); }
  .tabs { display: flex; border-bottom: 0.5px solid var(--border); flex: 0 0 auto; }
  .tabs button {
    background: transparent; border: 0; border-bottom: 2px solid transparent;
    color: var(--text-secondary); padding: 9px 12px; font-size: var(--fs-sub);
    display: inline-flex; align-items: center; gap: 5px;
  }
  .tabs button.active { color: var(--text-primary); border-bottom-color: var(--accent); }
  .tab-badge { background: var(--surface-3); color: var(--text-secondary); font-size: var(--fs-meta); border-radius: 8px; padding: 0 5px; }
  .panel-body { flex: 1 1 auto; overflow-y: auto; padding: 12px; }
  .analysis-head { display: flex; align-items: center; justify-content: space-between; font-size: var(--fs-sub); color: var(--text-secondary); margin-bottom: 10px; }
  .sev-counts { display: flex; gap: 8px; font-size: var(--fs-meta); }
  .c-crit { color: var(--sev-critical); }
  .c-warn { color: var(--sev-warning); }
  .c-info { color: var(--sev-info); }
  .cards { display: flex; flex-direction: column; gap: 8px; }
  .clean { color: var(--success); font-size: var(--fs-sub); padding: 16px; text-align: center; border: 0.5px dashed var(--border); border-radius: var(--radius-sm); }
  .disclaimer { margin-top: 14px; font-size: var(--fs-meta); color: var(--text-muted); line-height: 1.6; display: flex; gap: 5px; }
  .disclaimer code { font-family: var(--mono); color: var(--text-secondary); }
  .empty { color: var(--text-muted); text-align: center; padding: 50px 24px; font-size: var(--fs-sub); line-height: 1.6; }
  .empty i { font-size: 24px; display: block; margin-bottom: 10px; }
</style>
