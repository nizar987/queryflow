<script>
  let { entries = [] } = $props();

  let q = $state('');
  const filtered = $derived(
    q.trim()
      ? entries.filter((e) => (e.label + ' ' + (e.text || '')).toLowerCase().includes(q.trim().toLowerCase()))
      : entries
  );
</script>

<div class="gloss">
  {#if entries.length === 0}
    <p class="empty"><i class="ti ti-book-2"></i>Belum ada fungsi/klausa terdeteksi pada query ini.</p>
  {:else}
    <!-- Long queries produce long glossaries; search keeps it usable. -->
    <label class="search">
      <i class="ti ti-search"></i>
      <input bind:value={q} placeholder="Cari fungsi atau klausa…" aria-label="Cari di glosarium" />
      {#if q}
        <button onclick={() => (q = '')} aria-label="Hapus pencarian"><i class="ti ti-x"></i></button>
      {/if}
    </label>

    {#if filtered.length === 0}
      <p class="empty">Tidak ada yang cocok dengan “{q}”.</p>
    {/if}

    {#each filtered as e (e.signature)}
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
  .search {
    display: flex; align-items: center; gap: 6px;
    background: var(--surface-2); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); padding: 5px 8px; color: var(--text-muted);
  }
  .search:focus-within { border-color: var(--border-strong); }
  .search input {
    flex: 1; background: transparent; border: 0; outline: none;
    color: var(--text-primary); font-family: var(--sans); font-size: var(--fs-sub);
  }
  .search input::placeholder { color: var(--text-muted); }
  .search button { background: transparent; border: 0; color: var(--text-muted); font-size: 13px; padding: 0; }
  .search button:hover { color: var(--text-primary); }

  .entry { border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--surface-1); }
  .e-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .e-label { font-family: var(--mono); font-size: var(--fs-sub); color: var(--c-teal); }
  .e-count { font-size: var(--fs-meta); color: var(--text-muted); }
  .e-text { margin: 5px 0 0; font-size: var(--fs-sub); line-height: 1.6; color: var(--text-secondary); }
  .e-missing { margin: 5px 0 0; font-size: var(--fs-sub); color: var(--text-muted); font-style: italic; }
  .empty { color: var(--text-muted); font-size: var(--fs-sub); padding: 20px; text-align: center; line-height: 1.6; }
  .empty i { display: block; font-size: 22px; margin-bottom: 8px; opacity: 0.6; }
</style>
