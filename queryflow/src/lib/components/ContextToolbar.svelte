<script>
  let {
    dialect = $bindable('MariaDB'),
    canExport = false,
    canConvert = false,
    onexportPNG = () => {},
    onexportSVG = () => {},
    onexportMD = () => {},
    onshare = () => {},
    onconvert = () => {}
  } = $props();

  let exportOpen = $state(false);
  let convertOpen = $state(false);

  const ALL_TARGETS = ['MariaDB', 'MySQL', 'PostgreSQL', 'MongoDB'];
  const targets = $derived(ALL_TARGETS.filter((t) => t !== dialect));
</script>

<div class="toolbar">
  <div class="left">
    <span class="dialect-badge">
      <i class="ti ti-database"></i>
      <select bind:value={dialect} aria-label="Dialek database">
        <optgroup label="SQL">
          <option value="MariaDB">MariaDB</option>
          <option value="MySQL">MySQL</option>
          <option value="PostgreSQL">PostgreSQL</option>
        </optgroup>
        <optgroup label="NoSQL">
          <option value="MongoDB">MongoDB</option>
        </optgroup>
      </select>
    </span>
  </div>
  <div class="right">
    <div class="export-wrap">
      <button class="tb-btn convert" disabled={!canConvert} onclick={() => (convertOpen = !convertOpen)}>
        <i class="ti ti-transform"></i> Convert <i class="ti ti-chevron-down sm"></i>
      </button>
      {#if convertOpen && canConvert}
        <div class="menu" role="menu">
          <div class="menu-label">Konversi ke…</div>
          {#each targets as t (t)}
            <button onclick={() => { convertOpen = false; onconvert(t); }}>
              <i class="ti ti-arrow-right"></i> {t}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="export-wrap">
      <button class="tb-btn" disabled={!canExport} onclick={() => (exportOpen = !exportOpen)}>
        <i class="ti ti-download"></i> Export <i class="ti ti-chevron-down sm"></i>
      </button>
      {#if exportOpen && canExport}
        <div class="menu" role="menu">
          <button onclick={() => { exportOpen = false; onexportPNG(); }}><i class="ti ti-photo"></i> Diagram PNG</button>
          <button onclick={() => { exportOpen = false; onexportSVG(); }}><i class="ti ti-vector"></i> Diagram SVG</button>
          <button onclick={() => { exportOpen = false; onexportMD(); }}><i class="ti ti-markdown"></i> Analisa Markdown</button>
        </div>
      {/if}
    </div>
    <button class="tb-btn" disabled={!canExport} onclick={onshare}><i class="ti ti-share-2"></i> Share</button>
  </div>
</div>

<style>
  .toolbar {
    height: 38px; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; background: var(--surface-1); border-bottom: 0.5px solid var(--border);
  }
  .dialect-badge {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: var(--fs-meta); color: var(--text-secondary);
    border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 2px 6px;
  }
  .dialect-badge select { background: transparent; border: 0; color: var(--text-primary); font-size: var(--fs-meta); outline: none; }
  .dialect-badge select option { background: var(--surface-2); }
  .right { display: flex; gap: 6px; }
  .export-wrap { position: relative; }
  .tb-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 4px 9px; border-radius: var(--radius-sm);
  }
  .tb-btn:not(:disabled):hover { background: var(--surface-3); color: var(--text-primary); }
  .tb-btn:disabled { opacity: 0.4; cursor: default; }
  .sm { font-size: 10px; }
  .menu {
    position: absolute; top: 110%; right: 0; z-index: 20;
    background: var(--surface-2); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius-sm); padding: 4px; min-width: 170px;
    display: flex; flex-direction: column; gap: 2px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  }
  .menu button {
    display: flex; align-items: center; gap: 8px; text-align: left;
    background: transparent; border: 0; color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 6px 8px; border-radius: 3px;
  }
  .menu button:hover { background: var(--surface-3); color: var(--text-primary); }
  .menu-label { font-size: var(--fs-meta); color: var(--text-muted); padding: 4px 8px 2px; text-transform: uppercase; letter-spacing: 0.04em; }
  .tb-btn.convert { color: var(--accent); border-color: rgba(91,141,239,0.35); }
  .tb-btn.convert:not(:disabled):hover { background: var(--accent-soft); }
</style>
