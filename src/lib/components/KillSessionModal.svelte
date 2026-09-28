<script>
  // Stopping someone else's session is not undoable: an aborted statement rolls
  // back whatever it had done. So the dialog names who is affected, on which
  // server, and what they were running — before offering the two very different
  // outcomes.
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';

  let {
    session,
    connection,
    /** Which modes the engine supports; MongoDB can only abort the operation. */
    canDropConnection = true,
    busy = false,
    error = '',
    onconfirm = () => {},
    oncancel = () => {}
  } = $props();

  let mode = $state('query');

  $effect(() => lockScroll());

  const duration = $derived.by(() => {
    const s = session.seconds;
    if (s == null) return '—';
    if (s < 60) return `${Math.round(s)} detik`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
    return `${Math.floor(s / 3600)}j ${Math.floor((s % 3600) / 60)}m`;
  });
</script>

<div class="overlay" role="presentation">
  <div class="modal" use:dismissable={oncancel} use:focusTrap role="alertdialog" aria-modal="true"
    aria-label="Konfirmasi penghentian sesi" tabindex="-1">
    <div class="m-head">
      <span class="m-title"><i class="ti ti-hand-stop"></i> Hentikan sesi {session.id}?</span>
    </div>

    <div class="m-body">
      <dl class="facts">
        <div><dt>Server</dt><dd>{connection.name} <span class="dim">· {connection.dialect}</span></dd></div>
        <div><dt>User</dt><dd>{session.user || '—'} <span class="dim">{session.client || ''}</span></dd></div>
        {#if session.db}<div><dt>Database</dt><dd>{session.db}</dd></div>{/if}
        <div><dt>Berjalan</dt><dd class="num">{duration}</dd></div>
      </dl>

      {#if session.query}
        <pre class="stmt">{session.query.replace(/\s+/g, ' ').slice(0, 600)}</pre>
      {:else}
        <p class="muted">Teks query tidak terlihat — user database ini tidak punya hak untuk membacanya.</p>
      {/if}

      <fieldset class="modes">
        <legend class="sr-only">Cara menghentikan</legend>
        <label class="mode" class:active={mode === 'query'}>
          <input type="radio" name="killmode" value="query" bind:group={mode} />
          <span>
            <strong>Batalkan query saja</strong>
            <em>Statement-nya dibatalkan, koneksinya tetap hidup. Transaksi yang sedang berjalan di-rollback.</em>
          </span>
        </label>
        {#if canDropConnection}
          <label class="mode" class:active={mode === 'connection'}>
            <input type="radio" name="killmode" value="connection" bind:group={mode} />
            <span>
              <strong>Putus koneksinya</strong>
              <em>Seluruh sesi ditutup. Aplikasi pemiliknya akan melihat koneksi terputus.</em>
            </span>
          </label>
        {/if}
      </fieldset>

      {#if error}<p class="err"><i class="ti ti-alert-circle"></i> {error}</p>{/if}
    </div>

    <div class="m-foot">
      <button class="ghost" onclick={() => oncancel()} disabled={busy}>Batal</button>
      <button class="danger" onclick={() => onconfirm(mode)} disabled={busy}>
        {#if busy}<i class="ti ti-loader-2 spin"></i>{:else}<i class="ti ti-hand-stop"></i>{/if}
        {mode === 'connection' ? 'Putus koneksi' : 'Batalkan query'}
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
    background: var(--surface-1); border: 0.5px solid var(--sev-critical);
    border-radius: var(--radius); box-shadow: var(--shadow-modal); overflow: hidden;
    animation: rise var(--dur-med) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
  .modal:focus { outline: none; }

  .m-head { padding: 12px 14px; border-bottom: 0.5px solid var(--border); }
  .m-title {
    display: flex; align-items: center; gap: 8px;
    font-size: var(--fs-label); font-weight: 500; color: var(--sev-critical);
  }
  .m-body { padding: 14px; overflow-y: auto; }
  .m-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 14px; border-top: 0.5px solid var(--border); }

  .facts { margin: 0 0 12px; display: flex; flex-direction: column; gap: 6px; }
  .facts > div { display: flex; gap: 10px; font-size: var(--fs-sub); }
  dt { flex: 0 0 78px; color: var(--text-muted); font-size: var(--fs-meta); padding-top: 1px; }
  dd { margin: 0; color: var(--text-primary); min-width: 0; word-break: break-word; }
  dd.num { font-family: var(--mono); }
  .dim { color: var(--text-muted); }

  .stmt {
    margin: 0 0 12px; padding: 10px 12px; max-height: 160px; overflow: auto;
    font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6;
    white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
    background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius-sm);
  }

  .modes { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .mode {
    display: flex; gap: 9px; align-items: flex-start; cursor: pointer;
    border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    padding: 9px 11px; background: var(--surface-2);
  }
  .mode.active { border-color: var(--sev-critical); }
  .mode strong { display: block; font-size: var(--fs-sub); font-weight: 500; color: var(--text-primary); }
  .mode em {
    display: block; font-style: normal; font-size: var(--fs-meta);
    color: var(--text-muted); line-height: 1.5; margin-top: 2px;
  }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  .ghost, .danger {
    display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sub);
    padding: 6px 12px; border-radius: var(--radius-sm); border: 0.5px solid var(--border);
  }
  .ghost { background: transparent; color: var(--text-secondary); }
  .ghost:hover { background: var(--surface-3); color: var(--text-primary); }
  .danger { background: var(--sev-critical); color: #fff; border-color: var(--sev-critical); }
  .danger:hover { filter: brightness(1.08); }
  .danger:disabled, .ghost:disabled { opacity: 0.6; cursor: default; }

  .err { color: var(--sev-critical); font-size: var(--fs-sub); display: flex; gap: 6px; margin: 10px 0 0; }
  .muted { color: var(--text-muted); font-size: var(--fs-sub); margin: 0 0 12px; }
  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
