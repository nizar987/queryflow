<script>
  import { layoutFlow } from '$lib/ast-to-flow/layout.js';

  let {
    flow,
    badges = {},
    selectedNodeId = null,
    highlightNodeId = null,
    onnodeselect = () => {},
    bindSvg = () => {}
  } = $props();

  let collapsed = $state(new Set());
  let zoom = $state(1);

  const layout = $derived(flow ? layoutFlow(flow, collapsed) : null);

  const CAT = {
    gray: 'var(--c-gray)', blue: 'var(--c-blue)', coral: 'var(--c-coral)',
    purple: 'var(--c-purple)', teal: 'var(--c-teal)'
  };
  const SEV = { critical: 'var(--sev-critical)', warning: 'var(--sev-warning)', info: 'var(--sev-info)' };

  const nodeList = $derived(flow ? flow.blocks.flatMap((b) => b.nodes.map((n) => ({ n, block: b }))) : []);

  function toggleCollapse(blockId, e) {
    e.stopPropagation();
    const next = new Set(collapsed);
    next.has(blockId) ? next.delete(blockId) : next.add(blockId);
    collapsed = next;
  }
  function svgRef(el) { if (el) bindSvg(el); }
  const zoomIn = () => (zoom = Math.min(2, +(zoom + 0.15).toFixed(2)));
  const zoomOut = () => (zoom = Math.max(0.4, +(zoom - 0.15).toFixed(2)));
  const zoomReset = () => (zoom = 1);

  function truncate(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }
  function hasChildren(nodeId) {
    return flow ? flow.blocks.some((b) => b.parentNodeId === nodeId || b.parentBlockId === nodeId) : false;
  }
  function childBlockId(nodeId) {
    if (!flow) return '';
    const b = flow.blocks.find((b) => b.parentNodeId === nodeId || b.parentBlockId === nodeId);
    return b ? b.id : '';
  }
</script>

<div class="diagram">
  <div class="zoom-bar">
    <button onclick={zoomOut} title="Perkecil"><i class="ti ti-minus"></i></button>
    <span>{Math.round(zoom * 100)}%</span>
    <button onclick={zoomIn} title="Perbesar"><i class="ti ti-plus"></i></button>
    <button onclick={zoomReset} title="Reset"><i class="ti ti-focus-2"></i></button>
  </div>

  <div class="scroll">
    {#if layout}
      <svg
        use:svgRef
        width={layout.width * zoom}
        height={layout.height * zoom}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)" />
          </marker>
          <marker id="arrow-corr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--c-coral)" />
          </marker>
        </defs>

        {#each Object.entries(layout.blockBoxes) as [bid, box] (bid)}
          {#if box.kind !== 'main'}
            <g>
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx="8"
                fill="rgba(255,255,255,0.015)"
                stroke={box.correlated ? 'var(--c-coral)' : 'var(--border-strong)'}
                stroke-dasharray={box.correlated ? '0' : '4 3'} stroke-width="0.75" />
              <text x={box.x + 8} y={box.y - 5} class="block-label" fill={box.correlated ? 'var(--c-coral)' : 'var(--text-muted)'}>
                {box.label}{box.correlated ? ' · correlated' : ''}
              </text>
            </g>
          {/if}
        {/each}

        {#each layout.edges as e, ei (ei)}
          {#if e.kind === 'seq' || e.kind === 'feeder'}
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
              stroke="var(--text-muted)" stroke-width="1.2" marker-end="url(#arrow)" opacity="0.7" />
          {:else}
            <path d={`M ${e.x1} ${e.y1} C ${e.x1 + 30} ${e.y1}, ${e.x2 - 30} ${e.y2}, ${e.x2} ${e.y2}`}
              fill="none"
              stroke={e.kind === 'correlated' ? 'var(--c-coral)' : 'var(--text-muted)'}
              stroke-width="1.2"
              stroke-dasharray={e.kind === 'correlated' ? '5 3' : '0'}
              marker-end={e.kind === 'correlated' ? 'url(#arrow-corr)' : 'url(#arrow)'}
              opacity="0.8" />
          {/if}
        {/each}

        {#each nodeList as { n } (n.id)}
          {@const p = layout.positions[n.id]}
          {#if p}
            {@const sev = badges[n.id]}
            <g class="node" class:selected={selectedNodeId === n.id} class:flash={highlightNodeId === n.id}
              onclick={() => onnodeselect(n.id)} role="button" tabindex="0"
              onkeydown={(ev) => ev.key === 'Enter' && onnodeselect(n.id)}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="7"
                fill="var(--surface-2)"
                stroke={selectedNodeId === n.id ? CAT[n.category] : 'var(--border-strong)'}
                stroke-width={selectedNodeId === n.id ? 1.6 : 0.75} />
              <rect x={p.x} y={p.y} width="4" height={p.h} rx="2" fill={CAT[n.category]} />
              <text x={p.x + 14} y={p.y + (n.subtitle ? 20 : 27)} class="node-title">{n.title}</text>
              {#if n.subtitle}
                <text x={p.x + 14} y={p.y + 38} class="node-sub">{truncate(n.subtitle, 28)}</text>
              {/if}
              {#if n.correlated}
                <text x={p.x + p.w - 16} y={p.y + 16} class="corr-mark" fill="var(--c-coral)">⟲</text>
              {/if}
              {#if sev}
                <circle cx={p.x + p.w - 7} cy={p.y + 7} r="7" fill={SEV[sev]} />
                <text x={p.x + p.w - 7} y={p.y + 11} class="badge-mark">!</text>
              {/if}
              {#if hasChildren(n.id)}
                <g onclick={(e) => toggleCollapse(childBlockId(n.id), e)} class="collapse-btn" role="button" tabindex="0"
                   onkeydown={(ev) => ev.key === 'Enter' && toggleCollapse(childBlockId(n.id), ev)}>
                  <rect x={p.x + p.w - 22} y={p.y + p.h - 16} width="18" height="13" rx="3" fill="var(--surface-3)" />
                  <text x={p.x + p.w - 13} y={p.y + p.h - 6} class="collapse-mark">{collapsed.has(childBlockId(n.id)) ? '+' : '–'}</text>
                </g>
              {/if}
            </g>
          {/if}
        {/each}
      </svg>
    {/if}
  </div>
</div>

<style>
  .diagram { position: relative; height: 100%; background: var(--surface-0); }
  .scroll { height: 100%; overflow: auto; padding: 4px; }
  .zoom-bar {
    position: absolute; top: 8px; right: 8px; z-index: 5;
    display: flex; align-items: center; gap: 2px;
    background: var(--surface-1); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); padding: 2px;
  }
  .zoom-bar button {
    background: transparent; border: 0; color: var(--text-secondary);
    width: 22px; height: 22px; border-radius: 3px; font-size: 12px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .zoom-bar button:hover { background: var(--surface-3); }
  .zoom-bar span { font-size: var(--fs-meta); color: var(--text-muted); padding: 0 4px; min-width: 34px; text-align: center; }
  .node { cursor: pointer; }
  .node rect:first-of-type { transition: stroke 0.12s; }
  .node:hover rect:first-of-type { stroke: var(--border-strong); filter: brightness(1.12); }
  .node.flash rect:first-of-type { stroke: var(--accent); animation: flash 1.1s ease; }
  @keyframes flash { 0%, 100% { stroke-width: 0.75; } 30% { stroke-width: 2.4; } }
  .node-title { font-size: 13px; font-weight: 500; fill: var(--text-primary); }
  .node-sub { font-size: 11px; fill: var(--text-secondary); font-family: var(--mono); }
  .corr-mark { font-size: 13px; }
  .block-label { font-size: 10px; font-family: var(--mono); }
  .badge-mark { font-size: 9px; font-weight: 700; fill: #fff; text-anchor: middle; }
  .collapse-btn { cursor: pointer; }
  .collapse-mark { font-size: 11px; fill: var(--text-secondary); text-anchor: middle; font-weight: 600; }
</style>
