<script>
  import { dismissable } from '$lib/actions/popover.js';

  let {
    dialect = $bindable('MariaDB'),
    canExport = false,
    canConvert = false,
    canRun = false,
    stale = false,
    onexportPNG = () => {},
    onexportSVG = () => {},
    onexportMD = () => {},
    onshare = () => {},
    onconvert = () => {},
    onrun = () => {}
  } = $props();

  /** Only one menu can be open at a time; `null` means closed. */
  let openMenu = $state(null);
  const toggle = (name) => (openMenu = openMenu === name ? null : name);
  const close = () => (openMenu = null);

  const ALL_TARGETS = ['MariaDB', 'MySQL', 'PostgreSQL', 'MongoDB'];
  const targets = $derived(ALL_TARGETS.filter((t) => t !== dialect));
  const isMongo = $derived(dialect === 'MongoDB');
</script>

<div class="toolbar">
  <div class="left">
    <label class="dialect-badge" title="Dialek yang dipakai untuk parsing & aturan analisa">
      <i class="ti ti-database"></i>
      <span class="sr-only">Dialek database</span>
      <select bind:value={dialect}>
        <optgroup label="SQL">
          <option value="MariaDB">MariaDB</option>
          <option value="MySQL">MySQL</option>
          <option value="PostgreSQL">PostgreSQL</option>
        </optgroup>
        <optgroup label="NoSQL">
          <option value="MongoDB">MongoDB</option>
        </optgroup>
      </select>
      <i class="ti ti-chevron-down sm caret"></i>
    </label>
    <span class="engine-tag" class:mongo={isMongo}>{isMongo ? 'NoSQL' : 'SQL'}</span>

    {#if stale}
      <span class="stale" role="status">
        <i class="ti ti-refresh-alert"></i>
        <span>Query berubah — hasil di bawah belum diperbarui</span>
      </span>
    {/if}
  </div>

  <div class="right">
    <button class="tb-btn run" disabled={!canRun} onclick={onrun}
      title="Buka query ini di tab Query untuk dijalankan ke database">
      <i class="ti ti-player-play"></i> <span class="lbl">Jalankan</span>
    </button>

    <div class="menu-wrap" use:dismissable={close}>
      <button
        class="tb-btn convert"
        disabled={!canConvert}
        aria-haspopup="menu"
        aria-expanded={openMenu === 'convert'}
        aria-label="Konversi ke dialek lain"
        onclick={() => toggle('convert')}
      >
        <i class="ti ti-transform"></i> <span class="lbl">Convert</span> <i class="ti ti-chevron-down sm"></i>
      </button>
      {#if openMenu === 'convert' && canConvert}
        <div class="menu" role="menu">
          <div class="menu-label">Konversi ke…</div>
          {#each targets as t (t)}
            <button role="menuitem" onclick={() => { close(); onconvert(t); }}>
              <i class="ti ti-arrow-right"></i> {t}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="menu-wrap" use:dismissable={close}>
      <button
        class="tb-btn"
        disabled={!canExport}
        aria-haspopup="menu"
        aria-expanded={openMenu === 'export'}
        aria-label="Export diagram atau analisa"
        onclick={() => toggle('export')}
      >
        <i class="ti ti-download"></i> <span class="lbl">Export</span> <i class="ti ti-chevron-down sm"></i>
      </button>
      {#if openMenu === 'export' && canExport}
        <div class="menu" role="menu">
          <button role="menuitem" onclick={() => { close(); onexportPNG(); }}><i class="ti ti-photo"></i> Diagram PNG</button>
          <button role="menuitem" onclick={() => { close(); onexportSVG(); }}><i class="ti ti-vector"></i> Diagram SVG</button>
          <button role="menuitem" onclick={() => { close(); onexportMD(); }}><i class="ti ti-markdown"></i> Analisa Markdown</button>
        </div>
      {/if}
    </div>

    <button class="tb-btn" disabled={!canExport} onclick={onshare} title="Salin link berisi query (tersimpan di URL, bukan di server)">
      <i class="ti ti-share-2"></i> <span class="lbl">Share</span>
    </button>
  </div>
</div>

<style>
  .toolbar {
    min-height: 38px; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 0 12px; background: var(--surface-1); border-bottom: 0.5px solid var(--border);
  }
  .left { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  .dialect-badge {
    display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
    font-size: var(--fs-meta); color: var(--text-secondary);
    border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 3px 6px;
    transition: border-color var(--dur-fast) var(--ease);
  }
  .dialect-badge:hover { border-color: var(--border-strong); }
  .dialect-badge select {
    background: transparent; border: 0; color: var(--text-primary); font-size: var(--fs-meta);
    outline: none; cursor: pointer; appearance: none; padding-right: 2px;
  }
  .dialect-badge select option { background: var(--surface-1); color: var(--text-primary); }
  .caret { color: var(--text-muted); pointer-events: none; }
  .engine-tag {
    font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase;
    color: var(--c-teal); border: 0.5px solid currentColor; opacity: 0.8;
    border-radius: 20px; padding: 1px 6px;
  }
  .engine-tag.mongo { color: var(--c-purple); }

  /* The single most confusing state before: editing the query left a stale
     diagram on screen with no signal. Now it says so, right where you look. */
  .stale {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: var(--fs-meta); color: var(--sev-warning);
    background: var(--wash-warning); border: 0.5px solid var(--wash-warning-line);
    border-radius: 20px; padding: 2px 9px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis;
  }

  .right { display: flex; gap: 6px; flex: 0 0 auto; }
  .menu-wrap { position: relative; }
  .tb-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 4px 9px; border-radius: var(--radius-sm);
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  }
  .tb-btn:not(:disabled):hover { background: var(--surface-3); color: var(--text-primary); }
  .tb-btn:disabled { opacity: 0.4; cursor: default; }
  .sm { font-size: 10px; }
  .menu {
    position: absolute; top: calc(100% + 4px); right: 0; z-index: 20;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius); padding: 4px; min-width: 180px;
    display: flex; flex-direction: column; gap: 2px; box-shadow: var(--shadow-pop);
    animation: pop var(--dur-fast) var(--ease);
  }
  @keyframes pop { from { opacity: 0; transform: translateY(-3px); } }
  .menu button {
    display: flex; align-items: center; gap: 8px; text-align: left;
    background: transparent; border: 0; color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 6px 8px; border-radius: 3px;
  }
  .menu button:hover { background: var(--surface-3); color: var(--text-primary); }
  .menu-label { font-size: var(--fs-meta); color: var(--text-muted); padding: 4px 8px 2px; text-transform: uppercase; letter-spacing: 0.04em; }
  .tb-btn.run { color: var(--success); border-color: color-mix(in srgb, var(--success) 40%, transparent); }
  .tb-btn.run:not(:disabled):hover { background: var(--wash-success); color: var(--success); }
  .tb-btn.convert { color: var(--accent); border-color: var(--accent-line); }
  .tb-btn.convert:not(:disabled):hover { background: var(--accent-soft); color: var(--accent); }

  @media (max-width: 860px) {
    .stale span, .engine-tag { display: none; }
    .tb-btn .lbl { display: none; }
  }
</style>
