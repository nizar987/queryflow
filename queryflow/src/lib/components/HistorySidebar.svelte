<script>
  let { history = [], activeId = null, onnew = () => {}, onselect = () => {} } = $props();

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

<aside class="sidebar">
  <button class="new-btn" onclick={onnew}><i class="ti ti-plus"></i> Query baru</button>
  <div class="hist-list">
    {#if history.length === 0}
      <p class="empty">Belum ada riwayat sesi.</p>
    {:else}
      {#each history as h (h.id)}
        <button class="hist-item" class:active={activeId === h.id} onclick={() => onselect(h.id)}>
          <span class="hi-q">{firstLine(h.sql)}</span>
          <span class="hi-meta">
            {#if h.findingCount > 0}<span class="hi-find">{h.findingCount} temuan</span>{:else}<span class="hi-clean">bersih</span>{/if}
            <span class="hi-time">{relTime(h.ts)}</span>
          </span>
        </button>
      {/each}
    {/if}
  </div>
</aside>

<style>
  .sidebar { width: 180px; flex: 0 0 180px; background: var(--surface-1); border-right: 0.5px solid var(--border); display: flex; flex-direction: column; padding: 10px 8px; }
  .new-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; padding: 7px; background: var(--surface-2); color: var(--text-primary);
    border: 0.5px solid var(--border-strong); border-radius: var(--radius-sm); font-size: var(--fs-sub);
  }
  .new-btn:hover { background: var(--surface-3); }
  .hist-list { margin-top: 10px; display: flex; flex-direction: column; gap: 3px; overflow-y: auto; }
  .empty { font-size: var(--fs-meta); color: var(--text-muted); padding: 10px 4px; }
  .hist-item {
    display: flex; flex-direction: column; gap: 3px; align-items: flex-start;
    width: 100%; text-align: left; background: transparent; border: 0.5px solid transparent;
    border-radius: var(--radius-sm); padding: 7px 8px;
  }
  .hist-item:hover { background: var(--surface-2); }
  .hist-item.active { background: var(--surface-2); border-color: var(--border-strong); }
  .hi-q { font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .hist-item.active .hi-q { color: var(--text-primary); }
  .hi-meta { display: flex; gap: 6px; font-size: 10px; color: var(--text-muted); }
  .hi-find { color: var(--sev-warning); }
  .hi-clean { color: var(--success); }
</style>
