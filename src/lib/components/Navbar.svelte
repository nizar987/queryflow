<script>
  let {
    active = 'visualizer',
    theme = 'system',
    onthemechange = () => {},
    onshortcuts = () => {},
    onconnections = null
  } = $props();

  // Cycle rather than open a settings panel — one control, one obvious effect.
  const NEXT = { system: 'dark', dark: 'light', light: 'system' };
  const ICON = { system: 'ti-device-desktop', dark: 'ti-moon', light: 'ti-sun' };
  const LABEL = { system: 'Tema: ikut sistem', dark: 'Tema: gelap', light: 'Tema: terang' };

  // Query and Log reach the database through the local server; the rest don't.
  const serverBacked = $derived(
    active === 'query' || active === 'log' || active === 'tables' || active === 'queues'
  );
</script>

<nav class="navbar">
  <div class="left">
    <i class="ti ti-binary-tree brand-icon"></i>
    <span class="brand">QueryFlow</span>
    <div class="nav-tabs">
      <a href="/" class="tab" class:active={active === 'visualizer'}
        aria-current={active === 'visualizer' ? 'page' : undefined}>Visualizer</a>
      <a href="/query" class="tab" class:active={active === 'query'}
        aria-current={active === 'query' ? 'page' : undefined}>Query</a>
      <a href="/log" class="tab" class:active={active === 'log'}
        aria-current={active === 'log' ? 'page' : undefined}>Log</a>
      <a href="/tables" class="tab" class:active={active === 'tables'}
        aria-current={active === 'tables' ? 'page' : undefined}>Tables</a>
      <a href="/queues" class="tab" class:active={active === 'queues'}
        aria-current={active === 'queues' ? 'page' : undefined}>Antrian</a>
      <a href="/docs" class="tab" class:active={active === 'docs'}
        aria-current={active === 'docs' ? 'page' : undefined}>Dokumentasi</a>
    </div>
  </div>
  <div class="right">
    <span class="local-badge" title={serverBacked
      ? 'Tab ini berbicara ke server QueryFlow di mesin ini — kredensial tidak pernah masuk ke browser'
      : 'Visualizer & analisa berjalan sepenuhnya di browser — query tidak dikirim ke mana pun'}>
      <i class="ti {serverBacked ? 'ti-server-bolt' : 'ti-lock'}"></i>
      {serverBacked ? 'Server lokal' : 'Lokal'}
    </span>
    {#if onconnections}
      <button class="icon-btn" onclick={onconnections} title="Koneksi database" aria-label="Koneksi database">
        <i class="ti ti-plug"></i>
      </button>
    {/if}
    <button class="icon-btn" onclick={onshortcuts} title="Pintasan keyboard (?)" aria-label="Pintasan keyboard">
      <i class="ti ti-keyboard"></i>
    </button>
    <button
      class="icon-btn"
      onclick={() => onthemechange(NEXT[theme])}
      title={`${LABEL[theme]} — klik untuk ganti`}
      aria-label={LABEL[theme]}
    >
      <i class="ti {ICON[theme]}"></i>
    </button>
  </div>
</nav>

<style>
  .navbar {
    height: 46px; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; background: var(--surface-1);
    border-bottom: 0.5px solid var(--border);
  }
  .left { display: flex; align-items: center; gap: 14px; min-width: 0; }
  .brand-icon { color: var(--accent); font-size: 18px; }
  .brand { font-size: var(--fs-label); font-weight: 500; letter-spacing: -0.01em; }
  .nav-tabs { display: flex; gap: 2px; margin-left: 6px; min-width: 0; }
  .tab {
    font-size: 13px; color: var(--text-secondary); text-decoration: none;
    padding: 5px 10px; border-radius: var(--radius-sm); border: 0.5px solid transparent;
    transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
  }
  .tab:hover { color: var(--text-primary); background: var(--surface-2); }
  .tab.active { color: var(--text-primary); border-color: var(--border-strong); background: var(--surface-2); }
  .right { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .local-badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: var(--fs-meta); color: var(--text-muted);
    border: 0.5px solid var(--border); border-radius: 20px; padding: 2px 8px;
    margin-right: 4px;
  }
  .icon-btn {
    background: transparent; border: 0; color: var(--text-secondary); font-size: 16px;
    width: 28px; height: 28px; border-radius: var(--radius-sm);
    display: inline-flex; align-items: center; justify-content: center;
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  }
  .icon-btn:hover { background: var(--surface-3); color: var(--text-primary); }

  /* Four tabs no longer fit next to the brand on a phone. Drop the wordmark
     and let the tab strip scroll instead of overlapping the icon buttons. */
  @media (max-width: 720px) {
    .brand { display: none; }
    .local-badge { display: none; }
    .left { gap: 8px; }
    .nav-tabs {
      overflow-x: auto; margin-left: 0; scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }
    .nav-tabs::-webkit-scrollbar { display: none; }
    .tab { padding: 5px 8px; white-space: nowrap; }
  }
  @media (max-width: 420px) {
    .brand-icon { display: none; }
    .navbar { padding: 0 8px; }
  }
</style>
