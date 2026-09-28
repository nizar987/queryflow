<script>
  import { layoutFlow } from '$lib/ast-to-flow/layout.js';

  let {
    flow,
    badges = {},
    selectedNodeId = null,
    highlightNodeId = null,
    onnodeselect = () => {},
    bindSvg = () => {},
    /** nodeId -> {access:'full'|'index'|'other', label, index, tooltip} — real EXPLAIN facts. */
    explainBadges = {}
  } = $props();

  let collapsed = $state(new Set());
  let zoom = $state(1);
  let scrollEl = $state(null);
  let panning = $state(false);
  let showLegend = $state(false);

  const layout = $derived(flow ? layoutFlow(flow, collapsed) : null);

  const CAT = {
    gray: 'var(--c-gray)', blue: 'var(--c-blue)', coral: 'var(--c-coral)',
    purple: 'var(--c-purple)', teal: 'var(--c-teal)'
  };
  const CAT_LABEL = {
    gray: 'Sumber & urutan', blue: 'Join', coral: 'Filter',
    purple: 'Agregasi', teal: 'Output'
  };
  const SEV = { critical: 'var(--sev-critical)', warning: 'var(--sev-warning)', info: 'var(--sev-info)' };
  const EXPLAIN_COLOR = { full: 'var(--sev-critical)', index: 'var(--success)', other: 'var(--sev-warning)' };
  const SEV_TITLE = { critical: 'Ada temuan critical di step ini', warning: 'Ada temuan warning di step ini', info: 'Ada catatan di step ini' };

  const nodeList = $derived(flow ? flow.blocks.flatMap((b) => b.nodes.map((n) => ({ n, block: b }))) : []);
  /** Flat, top-down order for arrow-key traversal of the diagram. */
  const nodeOrder = $derived(nodeList.map(({ n }) => n.id).filter((id) => layout?.positions[id]));
  const usedCats = $derived([...new Set(nodeList.map(({ n }) => n.category))]);

  function toggleCollapse(blockId, e) {
    e.stopPropagation();
    const next = new Set(collapsed);
    next.has(blockId) ? next.delete(blockId) : next.add(blockId);
    collapsed = next;
  }
  function svgRef(el) { if (el) bindSvg(el); }

  const clampZoom = (z) => Math.min(2.5, Math.max(0.3, +z.toFixed(2)));
  const zoomIn = () => (zoom = clampZoom(zoom + 0.15));
  const zoomOut = () => (zoom = clampZoom(zoom - 0.15));
  const zoomReset = () => (zoom = 1);

  /** Scale the diagram down (never up) so the whole thing fits the viewport. */
  function fit() {
    if (!layout || !scrollEl) return;
    const pad = 24;
    const zx = (scrollEl.clientWidth - pad) / layout.width;
    const zy = (scrollEl.clientHeight - pad) / layout.height;
    zoom = clampZoom(Math.min(1, zx, zy));
    scrollEl.scrollTo({ top: 0, left: 0 });
  }

  /** ⌘/Ctrl + wheel zooms; plain wheel keeps its normal scroll behaviour. */
  function onWheel(e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoom = clampZoom(zoom - Math.sign(e.deltaY) * 0.1);
  }

  /** Drag on empty canvas to pan — large diagrams were scroll-bar only before. */
  function onPointerDown(e) {
    if (e.button !== 0 || e.target.closest('.node')) return;
    const startX = e.clientX, startY = e.clientY;
    const sl = scrollEl.scrollLeft, st = scrollEl.scrollTop;
    panning = true;
    const move = (ev) => {
      scrollEl.scrollLeft = sl - (ev.clientX - startX);
      scrollEl.scrollTop = st - (ev.clientY - startY);
    };
    const up = () => {
      panning = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** ↑/↓ walk the pipeline once a node has focus. */
  function onNodeKeydown(e, id) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onnodeselect(id); return; }
    const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const i = nodeOrder.indexOf(id);
    const next = nodeOrder[i + dir];
    if (next) onnodeselect(next);
  }

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
    <button onclick={zoomOut} title="Perkecil" aria-label="Perkecil"><i class="ti ti-minus"></i></button>
    <button class="pct" onclick={zoomReset} title="Reset ke 100%">{Math.round(zoom * 100)}%</button>
    <button onclick={zoomIn} title="Perbesar" aria-label="Perbesar"><i class="ti ti-plus"></i></button>
    <span class="sep"></span>
    <button onclick={fit} title="Paskan ke layar" aria-label="Paskan ke layar"><i class="ti ti-arrows-minimize"></i></button>
  </div>

  <div class="hint-bar">
    <span><kbd>drag</kbd> geser</span>
    <span><kbd>⌘</kbd>+<kbd>scroll</kbd> zoom</span>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="scroll"
    class:panning
    bind:this={scrollEl}
    onwheel={onWheel}
    onpointerdown={onPointerDown}
  >
    {#if layout}
      <svg
        use:svgRef
        width={layout.width * zoom}
        height={layout.height * zoom}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        aria-label="Diagram alur eksekusi query"
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
                fill="var(--block-fill)"
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
            {@const eb = explainBadges[n.id]}
            <g class="node" class:selected={selectedNodeId === n.id} class:flash={highlightNodeId === n.id}
              onclick={() => onnodeselect(n.id)} role="button"
              tabindex={selectedNodeId === n.id || (!selectedNodeId && nodeOrder[0] === n.id) ? 0 : -1}
              aria-label={`${n.title}${n.subtitle ? ' — ' + n.subtitle : ''}`}
              aria-pressed={selectedNodeId === n.id}
              onkeydown={(ev) => onNodeKeydown(ev, n.id)}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} rx="7"
                fill="var(--node-fill)"
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
                <g><title>{SEV_TITLE[sev]}</title>
                  <circle cx={p.x + p.w - 7} cy={p.y + 7} r="7" fill={SEV[sev]} />
                  <text x={p.x + p.w - 7} y={p.y + 11} class="badge-mark">!</text>
                </g>
              {/if}
              {#if eb}
                <!-- Real EXPLAIN numbers, distinct in shape (square, bottom-left) from
                     the static-analysis severity dot (circle, top-right) so the two
                     kinds of information — "what the text suggests" vs "what the
                     engine actually did" — never look like the same signal. -->
                <g class="explain-badge">
                  <title>{eb.tooltip}</title>
                  <rect x={p.x + 4} y={p.y + p.h - 15} width="11" height="11" rx="2.5" fill={EXPLAIN_COLOR[eb.access]} />
                  <text x={p.x + 9.5} y={p.y + p.h - 6.5} class="explain-mark">{eb.access === 'index' ? '✓' : eb.access === 'full' ? '!' : '?'}</text>
                </g>
              {/if}
              {#if hasChildren(n.id)}
                <g onclick={(e) => toggleCollapse(childBlockId(n.id), e)} class="collapse-btn" role="button" tabindex="-1"
                   aria-label={collapsed.has(childBlockId(n.id)) ? 'Tampilkan subquery' : 'Sembunyikan subquery'}
                   onkeydown={(ev) => ev.key === 'Enter' && toggleCollapse(childBlockId(n.id), ev)}>
                  <title>{collapsed.has(childBlockId(n.id)) ? 'Tampilkan subquery' : 'Sembunyikan subquery'}</title>
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

  {#if usedCats.length}
    <div class="legend" class:open={showLegend}>
      <button class="legend-toggle" onclick={() => (showLegend = !showLegend)} aria-expanded={showLegend}>
        <i class="ti ti-palette"></i> Legenda
      </button>
      {#if showLegend}
        <div class="legend-items">
          {#each usedCats as c (c)}
            <span class="li"><span class="sw" style:background={CAT[c]}></span>{CAT_LABEL[c] || c}</span>
          {/each}
          <span class="li"><span class="sw dash"></span>subquery / CTE</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .diagram {
    position: relative; height: 100%;
    background:
      radial-gradient(circle at 1px 1px, var(--grid-dot) 1px, transparent 0) 0 0 / 20px 20px,
      var(--surface-0);
  }
  .scroll { height: 100%; overflow: auto; padding: 12px; cursor: grab; }
  .scroll.panning { cursor: grabbing; user-select: none; }

  .zoom-bar {
    position: absolute; top: 8px; right: 8px; z-index: 5;
    display: flex; align-items: center; gap: 2px;
    background: var(--surface-1); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); padding: 2px; box-shadow: var(--shadow-pop);
  }
  .zoom-bar button {
    background: transparent; border: 0; color: var(--text-secondary);
    min-width: 22px; height: 22px; border-radius: 3px; font-size: 12px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .zoom-bar button:hover { background: var(--surface-3); color: var(--text-primary); }
  .zoom-bar .pct { font-size: var(--fs-meta); color: var(--text-muted); padding: 0 5px; min-width: 38px; }
  .zoom-bar .sep { width: 1px; height: 14px; background: var(--border); margin: 0 2px; }

  .hint-bar {
    position: absolute; top: 12px; left: 12px; z-index: 4;
    display: flex; gap: 10px; font-size: 10px; color: var(--text-muted);
    pointer-events: none; opacity: 0; transition: opacity var(--dur-med) var(--ease);
  }
  .diagram:hover .hint-bar { opacity: 1; }
  kbd {
    font-family: var(--sans); font-size: 9px; border: 0.5px solid var(--border-strong);
    border-radius: 3px; padding: 1px 3px; background: var(--surface-1);
  }

  .legend {
    position: absolute; bottom: 8px; left: 8px; z-index: 5;
    background: var(--surface-1); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); font-size: var(--fs-meta);
  }
  .legend-toggle {
    display: flex; align-items: center; gap: 5px; background: transparent; border: 0;
    color: var(--text-muted); font-size: var(--fs-meta); padding: 5px 9px;
  }
  .legend-toggle:hover { color: var(--text-primary); }
  .legend.open { box-shadow: var(--shadow-pop); }
  .legend-items {
    display: flex; flex-direction: column; gap: 5px; padding: 2px 9px 9px;
    color: var(--text-secondary);
  }
  .li { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .sw { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 auto; }
  .sw.dash { border: 1px dashed var(--border-strong); background: transparent; border-radius: 3px; }

  .node { cursor: pointer; }
  .node rect:first-of-type { transition: stroke var(--dur-fast) var(--ease), filter var(--dur-fast) var(--ease); }
  .node:hover rect:first-of-type { stroke: var(--border-strong); filter: brightness(1.12); }
  .node:focus-visible rect:first-of-type { stroke: var(--accent); stroke-width: 2; }
  .node.flash rect:first-of-type { stroke: var(--accent); animation: flash 1.1s ease; }
  @keyframes flash { 0%, 100% { stroke-width: 0.75; } 30% { stroke-width: 2.4; } }
  .node-title { font-size: 13px; font-weight: 500; fill: var(--text-primary); }
  .node-sub { font-size: 11px; fill: var(--text-secondary); font-family: var(--mono); }
  .corr-mark { font-size: 13px; }
  .block-label { font-size: 10px; font-family: var(--mono); }
  .badge-mark { font-size: 9px; font-weight: 700; fill: #fff; text-anchor: middle; }
  .explain-mark { font-size: 8px; font-weight: 700; fill: #fff; text-anchor: middle; pointer-events: none; }
  .collapse-btn { cursor: pointer; }
  .collapse-mark { font-size: 11px; fill: var(--text-secondary); text-anchor: middle; font-weight: 600; }
</style>
