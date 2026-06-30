<script>
  let { entries = [] } = $props();
</script>

<div class="gloss">
  {#if entries.length === 0}
    <p class="empty">Belum ada fungsi/klausa terdeteksi.</p>
  {:else}
    {#each entries as e (e.signature)}
      <div class="entry">
        <div class="e-head">
          <span class="e-label">{e.label}</span>
          {#if e.usageCount > 1}<span class="e-count">{e.usageCount}×</span>{/if}
        </div>
        {#if e.hasDefinition}
          <p class="e-text">{e.text}</p>
        {:else}
          <p class="e-missing">Belum ada penjelasan tersedia untuk fungsi ini.</p>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .gloss { display: flex; flex-direction: column; gap: 9px; }
  .entry { border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--surface-1); }
  .e-head { display: flex; align-items: baseline; justify-content: space-between; }
  .e-label { font-family: var(--mono); font-size: var(--fs-sub); color: var(--c-teal); }
  .e-count { font-size: var(--fs-meta); color: var(--text-muted); }
  .e-text { margin: 5px 0 0; font-size: var(--fs-sub); line-height: 1.6; color: var(--text-secondary); }
  .e-missing { margin: 5px 0 0; font-size: var(--fs-sub); color: var(--text-muted); font-style: italic; }
  .empty { color: var(--text-muted); font-size: var(--fs-sub); padding: 20px; text-align: center; }
</style>
