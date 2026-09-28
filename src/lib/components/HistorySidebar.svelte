<script>
  let {
    history = [],
    activeId = null,
    collapsed = false,
    ontoggle = () => {},
    onnew = () => {},
    onselect = () => {},
    ondelete = () => {},
    onclear = () => {}
  } = $props();

  let confirmClear = $state(false);

  function relTime(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + 'm lalu';
    if (s < 86400) return Math.floor(s / 3600) + 'j lalu';
    return Math.floor(s / 86400) + 'h lalu';
  }
  function firstLine(sql) {
    const l = sql.trim().split('\n').find((x) => x.trim()) || sql;
    return l.length > 30 ? l.slice(0, 29) + '…' : l;
  }
</script>

<aside class="sidebar" class:collapsed>
  <div class="top">
    <button class="new-btn" onclick={onnew} title="Query baru (⌘/Ctrl+K)">
      <i class="ti ti-plus"></i>{#if !collapsed}<span>Query baru</span>{/if}
    </button>
    <button
      class="collapse"
      onclick={ontoggle}
      title={collapsed ? 'Tampilkan riwayat' : 'Sembunyikan riwayat'}
      aria-label={collapsed ? 'Tampilkan riwayat' : 'Sembunyikan riwayat'}
    >
      <i class="ti {collapsed ? 'ti-layout-sidebar-left-expand' : 'ti-layout-sidebar-left-collapse'}"></i>
    </button>
  </div>

  {#if !collapsed}
    <div class="hist-head">
      <span>Riwayat</span>
      {#if history.length}
        {#if confirmClear}
          <span class="confirm">
            <button class="link danger" onclick={() => { onclear(); confirmClear = false; }}>Hapus</button>
            <button class="link" onclick={() => (confirmClear = false)}>Batal</button>
          </span>
        {:else}
          <button class="link" onclick={() => (confirmClear = true)}>Bersihkan</button>
        {/if}
      {/if}
    </div>

    <div class="hist-list">
      {#if history.length === 0}
        <p class="empty">
          <i class="ti ti-history"></i>
          Query yang kamu analisa muncul di sini — tersimpan lokal di browser.
        </p>
      {:else}
        {#each history as h (h.id)}
          <div class="hist-row" class:active={activeId === h.id}>
            <button class="hist-item" onclick={() => onselect(h.id)} title={h.sql}>
              <span class="hi-q">{firstLine(h.sql)}</span>
              <span class="hi-meta">
                <span class="hi-dialect">{h.dialect}</span>
                {#if h.findingCount > 0}
                  <span class="hi-find">{h.findingCount} temuan</span>
                {:else}
                  <span class="hi-clean">bersih</span>
                {/if}
                <span class="hi-time">{relTime(h.ts)}</span>
              </span>
            </button>
            <button class="del" onclick={() => ondelete(h.id)} title="Hapus dari riwayat" aria-label="Hapus dari riwayat">
              <i class="ti ti-x"></i>
            </button>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    width: 190px; flex: 0 0 190px;
    background: var(--surface-1); border-right: 0.5px solid var(--border);
    display: flex; flex-direction: column; padding: 10px 8px; min-height: 0;
    transition: width var(--dur-med) var(--ease), flex-basis var(--dur-med) var(--ease);
  }
  .sidebar.collapsed { width: 48px; flex-basis: 48px; padding: 10px 7px; }

  .top { display: flex; gap: 4px; align-items: center; }
  .new-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    flex: 1 1 auto; min-width: 0; padding: 7px; background: var(--surface-2); color: var(--text-primary);
    border: 0.5px solid var(--border-strong); border-radius: var(--radius-sm); font-size: var(--fs-sub);
    transition: background var(--dur-fast) var(--ease);
  }
  .new-btn:hover { background: var(--surface-3); }
  .collapse {
    flex: 0 0 auto; width: 26px; height: 28px; background: transparent; border: 0;
    color: var(--text-muted); border-radius: var(--radius-sm); font-size: 15px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .collapse:hover { background: var(--surface-2); color: var(--text-primary); }
  .sidebar.collapsed .top { flex-direction: column; gap: 6px; }
  .sidebar.collapsed .new-btn { width: 100%; padding: 7px 0; }

  .hist-head {
    display: flex; align-items: center; justify-content: space-between;
    margin: 14px 4px 6px; font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .confirm { display: flex; gap: 6px; }
  .link {
    background: transparent; border: 0; padding: 0; color: var(--text-muted);
    font-size: var(--fs-meta); text-transform: none; letter-spacing: 0;
  }
  .link:hover { color: var(--text-primary); text-decoration: underline; }
  .link.danger { color: var(--sev-critical); }

  .hist-list { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; }
  .empty {
    font-size: var(--fs-meta); color: var(--text-muted); padding: 14px 6px;
    line-height: 1.6; text-align: center;
  }
  .empty i { display: block; font-size: 18px; margin-bottom: 6px; opacity: 0.6; }

  .hist-row {
    position: relative; display: flex; align-items: stretch;
    border: 0.5px solid transparent; border-radius: var(--radius-sm);
  }
  .hist-row:hover { background: var(--surface-2); }
  .hist-row.active { background: var(--surface-2); border-color: var(--border-strong); }
  .hist-item {
    display: flex; flex-direction: column; gap: 3px; align-items: flex-start;
    flex: 1 1 auto; min-width: 0; text-align: left;
    background: transparent; border: 0; padding: 7px 8px;
  }
  .hi-q {
    font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-secondary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
  }
  .hist-row.active .hi-q { color: var(--text-primary); }
  .hi-meta { display: flex; gap: 6px; font-size: 10px; color: var(--text-muted); flex-wrap: wrap; }
  .hi-dialect { opacity: 0.75; }
  .hi-find { color: var(--sev-warning); }
  .hi-clean { color: var(--success); }

  /* Delete stays hidden until hover/focus so the list reads as content, not controls. */
  .del {
    flex: 0 0 auto; width: 22px; background: transparent; border: 0;
    color: var(--text-muted); font-size: 12px; opacity: 0;
    transition: opacity var(--dur-fast) var(--ease);
  }
  .hist-row:hover .del, .del:focus-visible { opacity: 1; }
  .del:hover { color: var(--sev-critical); }

  /* On narrow screens the sidebar can't afford a permanent column, so an
     expanded sidebar floats over the workspace instead of squeezing it. */
  @media (max-width: 860px) {
    .sidebar:not(.collapsed) {
      position: absolute; top: 0; bottom: 0; left: 0; z-index: 30;
      box-shadow: var(--shadow-pop);
    }
  }
</style>
