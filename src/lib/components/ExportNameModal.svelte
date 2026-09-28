<script>
  // Asks what to call a download before it starts. The field arrives filled
  // with a name the system picked, so Enter alone is the fast path; typing
  // replaces it, and clearing it falls back to the default instead of failing.
  import { untrack } from 'svelte';
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';
  import { sanitizeExportName } from '$lib/export-name.js';

  let {
    /** Suggested name without extension. */
    defaultName,
    ext = 'csv',
    title = 'Ekspor ke CSV',
    /** One line on what will be saved, e.g. how many rows. */
    detail = '',
    confirmLabel = 'Unduh',
    onconfirm = () => {},
    oncancel = () => {}
  } = $props();

  // Seeded once: a later change to the suggestion must not wipe what was typed.
  let name = $state(untrack(() => defaultName));
  /** @type {HTMLInputElement | null} */
  let input = $state(null);

  $effect(() => lockScroll());

  // Select the suggestion so typing overwrites it rather than appending.
  $effect(() => {
    const el = input;
    if (el) queueMicrotask(() => { el.focus(); el.select(); });
  });

  const finalName = $derived(sanitizeExportName(name, ext) || `${defaultName}.${ext}`);
  const usingDefault = $derived(!sanitizeExportName(name, ext));

  /** @param {SubmitEvent} e */
  function submit(e) {
    e.preventDefault();
    onconfirm(finalName);
  }
</script>

<div class="overlay" role="presentation">
  <div class="modal" use:dismissable={oncancel} use:focusTrap
    role="dialog" aria-modal="true" aria-labelledby="export-name-title" tabindex="-1">
    <form onsubmit={submit}>
      <div class="m-head">
        <span class="m-title" id="export-name-title"><i class="ti ti-file-download"></i> {title}</span>
      </div>

      <div class="m-body">
        <label class="field">
          <span class="lbl">Nama file</span>
          <span class="input-wrap">
            <input bind:this={input} bind:value={name} spellcheck="false" autocomplete="off"
              maxlength="200" aria-describedby="export-name-hint" />
            <span class="ext">.{ext}</span>
            {#if name !== defaultName}
              <button type="button" class="reset" title="Kembalikan nama bawaan"
                onclick={() => { name = defaultName; input?.focus(); input?.select(); }}>
                <i class="ti ti-arrow-back-up"></i>
              </button>
            {/if}
          </span>
        </label>
        <p class="hint" id="export-name-hint">
          {#if usingDefault}Kosong — akan memakai nama bawaan.{:else}Disimpan sebagai{/if}
          <code>{finalName}</code>
        </p>
        {#if detail}<p class="detail">{detail}</p>{/if}
      </div>

      <div class="m-foot">
        <button type="button" class="ghost" onclick={() => oncancel()}>Batal</button>
        <button type="submit" class="primary"><i class="ti ti-download"></i> {confirmLabel}</button>
      </div>
    </form>
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
    width: min(460px, 100%); display: flex; flex-direction: column; margin: 0;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius); box-shadow: var(--shadow-modal); overflow: hidden;
    animation: rise var(--dur-med) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
  .modal:focus { outline: none; }
  form { display: contents; }

  .m-head { padding: 12px 14px; border-bottom: 0.5px solid var(--border); }
  .m-title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); font-weight: 500; }
  .m-body { padding: 14px; }
  .m-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 14px; border-top: 0.5px solid var(--border); }

  .field { display: flex; flex-direction: column; gap: 6px; }
  .lbl { font-size: var(--fs-meta); color: var(--text-muted); }
  .input-wrap {
    display: flex; align-items: center; min-width: 0;
    background: var(--surface-2); border: 0.5px solid var(--border-strong); border-radius: var(--radius-sm);
  }
  .input-wrap:focus-within { border-color: var(--accent); }
  input {
    flex: 1 1 auto; min-width: 0; background: transparent; border: 0; outline: none;
    padding: 7px 10px; font-family: var(--mono); font-size: var(--fs-code); color: var(--text-primary);
  }
  .ext { flex: 0 0 auto; padding-right: 8px; font-family: var(--mono); font-size: var(--fs-code); color: var(--text-muted); }
  .reset {
    flex: 0 0 auto; display: inline-flex; align-items: center; margin-right: 4px;
    background: transparent; border: 0; border-radius: var(--radius-sm);
    color: var(--text-muted); padding: 3px 5px; cursor: pointer;
  }
  .reset:hover { background: var(--surface-3); color: var(--text-primary); }

  .hint, .detail { margin: 8px 0 0; font-size: var(--fs-meta); color: var(--text-muted); line-height: 1.5; word-break: break-all; }
  .hint code { font-family: var(--mono); color: var(--text-secondary); }
  .detail { color: var(--text-secondary); word-break: normal; }

  .ghost, .primary {
    display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sub);
    padding: 6px 12px; border-radius: var(--radius-sm); border: 0.5px solid var(--border);
  }
  .ghost { background: transparent; color: var(--text-secondary); }
  .ghost:hover { background: var(--surface-3); color: var(--text-primary); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .primary:hover { filter: brightness(1.08); }
</style>
