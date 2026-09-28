<script>
  // Last stop before a statement changes data. The server decides what is
  // allowed; this dialog exists so a write is never a surprise — it names the
  // connection, the statement, and what it will touch.
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';

  let {
    /** @type {import('$lib/statement.js').Classification} */
    info,
    connection,
    statement = '',
    /** Offering "don't ask again" only makes sense for ordinary, filtered writes. */
    canRemember = true,
    onconfirm = () => {},
    oncancel = () => {}
  } = $props();

  let remember = $state(false);

  $effect(() => lockScroll());

  const severe = $derived(info.destructive || info.unfiltered);
  const preview = $derived(statement.trim().replace(/\s+$/, ''));
</script>

<div class="overlay" role="presentation">
  <div class="modal" class:severe use:dismissable={oncancel} use:focusTrap role="alertdialog" aria-modal="true"
    aria-label="Konfirmasi penulisan ke database" tabindex="-1">
    <div class="m-head">
      <span class="m-title">
        <i class="ti {severe ? 'ti-alert-triangle' : 'ti-pencil'}"></i>
        {severe ? 'Statement ini berisiko' : 'Statement ini menulis ke database'}
      </span>
    </div>

    <div class="m-body">
      <p class="what">{info.label}</p>

      <dl class="facts">
        <div><dt>Koneksi</dt><dd>{connection.name} <span class="dim">· {connection.dialect}{connection.database ? ' / ' + connection.database : ''}</span></dd></div>
        <div><dt>Perintah</dt><dd class="mono">{info.command}</dd></div>
      </dl>

      {#if info.unfiltered}
        <p class="alarm">
          <i class="ti ti-alert-octagon"></i>
          Tidak ada filter — <strong>seluruh baris</strong> pada target akan terkena, bukan sebagian.
        </p>
      {/if}
      {#if info.destructive}
        <p class="alarm">
          <i class="ti ti-alert-octagon"></i>
          Perubahan struktur seperti ini <strong>tidak bisa dibatalkan</strong> dari QueryFlow.
        </p>
      {/if}

      <pre class="stmt">{preview}</pre>

      {#if canRemember}
        <label class="check">
          <input type="checkbox" bind:checked={remember} />
          <span>Jangan tanya lagi untuk koneksi ini selama sesi ini</span>
        </label>
      {/if}
    </div>

    <div class="m-foot">
      <button class="ghost" onclick={() => oncancel()}>Batal</button>
      <button class="danger" onclick={() => onconfirm({ remember })}>
        <i class="ti ti-bolt"></i> Jalankan {info.command}
      </button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 220; background: var(--scrim);
    display: flex; align-items: center; justify-content: center; padding: 24px;
    animation: fade var(--dur-med) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } }
  .modal {
    width: min(560px, 100%); max-height: 86vh; display: flex; flex-direction: column;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius); box-shadow: var(--shadow-modal); overflow: hidden;
    animation: rise var(--dur-med) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
  .modal.severe { border-color: var(--sev-critical); }
  .modal:focus { outline: none; }

  .m-head { padding: 12px 14px; border-bottom: 0.5px solid var(--border); }
  .m-title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); font-weight: 500; }
  .modal.severe .m-title { color: var(--sev-critical); }
  .m-body { padding: 14px; overflow-y: auto; }
  .m-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 14px; border-top: 0.5px solid var(--border); }

  .what { margin: 0 0 12px; font-size: var(--fs-sub); color: var(--text-secondary); line-height: 1.6; }
  .facts { margin: 0 0 12px; display: flex; flex-direction: column; gap: 6px; }
  .facts > div { display: flex; gap: 10px; font-size: var(--fs-sub); }
  dt { flex: 0 0 74px; color: var(--text-muted); font-size: var(--fs-meta); padding-top: 1px; }
  dd { margin: 0; color: var(--text-primary); min-width: 0; word-break: break-word; }
  dd.mono { font-family: var(--mono); }
  .dim { color: var(--text-muted); }

  .alarm {
    margin: 0 0 10px; padding: 8px 11px; font-size: var(--fs-meta); line-height: 1.6;
    color: var(--text-primary); background: var(--wash-critical);
    border: 0.5px solid var(--wash-critical-line); border-radius: var(--radius-sm);
    display: flex; gap: 7px; align-items: flex-start;
  }
  .alarm i { color: var(--sev-critical); }

  .stmt {
    margin: 0; padding: 10px 12px; max-height: 200px; overflow: auto;
    font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6;
    white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
    background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius-sm);
  }
  .check {
    display: flex; align-items: center; gap: 7px; margin-top: 12px;
    font-size: var(--fs-meta); color: var(--text-secondary); cursor: pointer;
  }

  .ghost, .danger {
    display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sub);
    padding: 6px 12px; border-radius: var(--radius-sm); border: 0.5px solid var(--border);
  }
  .ghost { background: transparent; color: var(--text-secondary); }
  .ghost:hover { background: var(--surface-3); color: var(--text-primary); }
  .danger { background: var(--sev-critical); color: #fff; border-color: var(--sev-critical); }
  .danger:hover { filter: brightness(1.08); }
</style>
