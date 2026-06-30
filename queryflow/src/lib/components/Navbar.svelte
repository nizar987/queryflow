<script>
  let { active = 'visualizer' } = $props();
</script>

<nav class="navbar">
  <div class="left">
    <i class="ti ti-binary-tree brand-icon"></i>
    <span class="brand">QueryFlow</span>
    <div class="nav-tabs">
      <a href="/" class="tab" class:active={active === 'visualizer'}>Visualizer</a>
      <a href="/docs" class="tab" class:active={active === 'docs'}>Dokumentasi</a>
    </div>
  </div>
  <div class="right">
    <button class="icon-btn" title="Pengaturan"><i class="ti ti-settings"></i></button>
    <div class="avatar">NZ</div>
  </div>
</nav>

<style>
  .navbar {
    height: 46px; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 12px; background: var(--surface-1);
    border-bottom: 0.5px solid var(--border);
  }
  .left { display: flex; align-items: center; gap: 14px; }
  .brand-icon { color: var(--accent); font-size: 18px; }
  .brand { font-size: var(--fs-label); font-weight: 500; }
  .nav-tabs { display: flex; gap: 2px; margin-left: 6px; }
  .tab {
    font-size: 13px; color: var(--text-secondary); text-decoration: none;
    padding: 5px 10px; border-radius: var(--radius-sm); border: 0.5px solid transparent;
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active { color: var(--text-primary); border-color: var(--border-strong); background: var(--surface-2); }
  .right { display: flex; align-items: center; gap: 10px; }
  .icon-btn { background: transparent; border: 0; color: var(--text-secondary); font-size: 16px; width: 28px; height: 28px; border-radius: var(--radius-sm); }
  .icon-btn:hover { background: var(--surface-3); color: var(--text-primary); }
  .avatar {
    width: 26px; height: 26px; border-radius: 50%;
    background: var(--accent-soft); color: var(--accent);
    font-size: var(--fs-meta); font-weight: 600;
    display: flex; align-items: center; justify-content: center;
  }
</style>
