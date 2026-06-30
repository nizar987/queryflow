<script>
  let { open = false, from = '', to = '', result = null, onclose = () => {}, onload = () => {}, oncopy = () => {} } = $props();
</script>

{#if open}
  <div class="overlay" onclick={onclose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Hasil konversi">
      <div class="m-head">
        <span class="m-title">
          <i class="ti ti-transform"></i>
          Konversi <span class="chip">{from}</span> <i class="ti ti-arrow-right xs"></i> <span class="chip accent">{to}</span>
        </span>
        <button class="x" onclick={onclose} aria-label="Tutup"><i class="ti ti-x"></i></button>
      </div>

      <div class="m-body">
        {#if !result}
          <div class="loading"><i class="ti ti-loader-2 spin"></i> Mengonversi…</div>
        {:else if result.error}
          <div class="err"><i class="ti ti-alert-octagon"></i> {result.error}</div>
        {:else}
          <pre class="code">{result.text}</pre>
          {#if result.notes && result.notes.length}
            <div class="notes">
              <div class="notes-head"><i class="ti ti-info-circle"></i> Catatan konversi</div>
              <ul>
                {#each result.notes as n, i (i)}<li>{n}</li>{/each}
              </ul>
            </div>
          {/if}
          <p class="disclaimer">Konversi otomatis bersifat best-effort — selalu verifikasi hasil sebelum dipakai di produksi.</p>
        {/if}
      </div>

      {#if result && !result.error}
        <div class="m-foot">
          <button class="ghost" onclick={() => oncopy(result.text)}><i class="ti ti-copy"></i> Salin</button>
          <button class="primary" onclick={() => onload(result.text, to)}><i class="ti ti-arrow-bar-to-down"></i> Muat ke editor ({to})</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 200;
    background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 24px;
  }
  .modal {
    width: min(720px, 100%); max-height: 84vh; display: flex; flex-direction: column;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius); box-shadow: 0 20px 60px rgba(0,0,0,0.5); overflow: hidden;
  }
  .m-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 0.5px solid var(--border); }
  .m-title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); font-weight: 500; }
  .chip { font-family: var(--mono); font-size: var(--fs-sub); background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 1px 7px; }
  .chip.accent { color: var(--accent); border-color: rgba(91,141,239,0.35); }
  .xs { font-size: 11px; color: var(--text-muted); }
  .x { background: transparent; border: 0; color: var(--text-secondary); font-size: 16px; }
  .x:hover { color: var(--text-primary); }
  .m-body { padding: 14px; overflow-y: auto; }
  .code {
    margin: 0; font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6;
    background: var(--surface-0); border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    padding: 12px; white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
  }
  .notes { margin-top: 12px; border: 0.5px solid rgba(217,164,65,0.3); background: rgba(217,164,65,0.06); border-radius: var(--radius-sm); padding: 9px 11px; }
  .notes-head { font-size: var(--fs-sub); color: var(--sev-warning); display: flex; gap: 5px; align-items: center; margin-bottom: 5px; }
  .notes ul { margin: 0; padding-left: 18px; }
  .notes li { font-size: var(--fs-sub); color: var(--text-secondary); line-height: 1.6; }
  .disclaimer { margin: 10px 0 0; font-size: var(--fs-meta); color: var(--text-muted); }
  .err { color: var(--sev-critical); font-size: var(--fs-sub); display: flex; gap: 6px; align-items: center; }
  .loading { color: var(--text-secondary); font-size: var(--fs-sub); display: flex; gap: 6px; align-items: center; padding: 20px; }
  .m-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 14px; border-top: 0.5px solid var(--border); }
  .ghost, .primary { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sub); padding: 6px 12px; border-radius: var(--radius-sm); border: 0.5px solid var(--border); }
  .ghost { background: transparent; color: var(--text-secondary); }
  .ghost:hover { background: var(--surface-3); color: var(--text-primary); }
  .primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .primary:hover { filter: brightness(1.08); }
  .spin { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
