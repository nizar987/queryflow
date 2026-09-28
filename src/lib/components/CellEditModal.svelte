<script>
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';

  let {
    open = false,
    table = '',
    dialect = 'MariaDB',
    column = '',
    meta = null,
    oldValue = null,
    keyValues = {},
    saving = false,
    error = '',
    onconfirm = () => {},
    oncancel = () => {}
  } = $props();

  let draft = $state('');
  let draftNull = $state(false);
  /** Snapshot of what the modal opened with, so "changed?" is honest. */
  let opened = $state(null);

  // Re-seed only when a *different* cell is opened; typing must not be clobbered.
  $effect(() => {
    if (!open) {
      opened = null;
      return;
    }
    const id = `${table}|${column}|${JSON.stringify(keyValues)}`;
    if (opened === id) return;
    opened = id;
    draftNull = oldValue === null;
    draft = oldValue === null ? '' : String(oldValue);
  });

  $effect(() => {
    if (!open) return;
    return lockScroll();
  });

  const nextValue = $derived(draftNull ? null : draft);
  const unchanged = $derived(
    (oldValue === null && draftNull) || (!draftNull && String(oldValue ?? '') === draft)
  );
  const nullable = $derived(meta ? meta.nullable : true);

  const quoteIdent = (n) => (/postgre/i.test(dialect) ? `"${n}"` : `\`${n}\``);
  const literal = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

  /**
   * The statement that will run, with values shown inline for reading only —
   * the request itself sends them as bound parameters, never as text.
   */
  const previewSQL = $derived.by(() => {
    const where = Object.entries(keyValues)
      .map(([k, v]) => `${quoteIdent(k)} = ${literal(v)}`)
      .join(' AND ');
    return `UPDATE ${quoteIdent(table)}\n   SET ${quoteIdent(column)} = ${literal(nextValue)}\n WHERE ${where};`;
  });

  function submit(e) {
    e?.preventDefault();
    if (unchanged || saving) return;
    onconfirm({ value: nextValue, isNull: draftNull });
  }
</script>

{#if open}
  <div class="overlay" role="presentation">
    <div class="modal" use:dismissable={oncancel} use:focusTrap role="dialog" aria-modal="true"
      aria-label={`Ubah ${column}`} tabindex="-1">
      <div class="m-head">
        <span class="m-title"><i class="ti ti-pencil"></i> Ubah nilai</span>
        <button class="x" onclick={oncancel} aria-label="Tutup (Esc)"><i class="ti ti-x"></i></button>
      </div>

      <form class="m-body" onsubmit={submit}>
        <div class="where">
          <span class="lbl">Baris</span>
          <code>{table}</code>
          <span class="sep">·</span>
          {#each Object.entries(keyValues) as [k, v] (k)}
            <code class="kv">{k} = {v === null ? 'NULL' : v}</code>
          {/each}
        </div>

        <div class="field">
          <span class="lbl">
            Kolom <code>{column}</code>
            {#if meta}
              <span class="type">{meta.type}{meta.nullable ? ' · nullable' : ' · NOT NULL'}</span>
            {/if}
          </span>
        </div>

        <div class="diff">
          <div class="side">
            <span class="lbl">Sebelum</span>
            <div class="val old">{#if oldValue === null}<span class="null">NULL</span>{:else}{oldValue}{/if}</div>
          </div>
          <i class="ti ti-arrow-right arrow"></i>
          <div class="side">
            <span class="lbl">Sesudah</span>
            <div class="val new" class:same={unchanged}>
              {#if draftNull}<span class="null">NULL</span>{:else if draft === ''}<span class="empty">(string kosong)</span>{:else}{draft}{/if}
            </div>
          </div>
        </div>

        <label class="input-row">
          <span class="sr-only">Nilai baru untuk {column}</span>
          <!-- svelte-ignore a11y_autofocus -->
          <textarea
            bind:value={draft}
            oninput={() => (draftNull = false)}
            disabled={draftNull || saving}
            rows="3"
            autofocus
            spellcheck="false"
          ></textarea>
        </label>

        <div class="controls">
          {#if nullable}
            <button type="button" class="null-btn" class:on={draftNull}
              onclick={() => (draftNull = !draftNull)}>
              <i class="ti {draftNull ? 'ti-check' : 'ti-circle'}"></i> Set NULL
            </button>
          {:else}
            <span class="hint"><i class="ti ti-info-circle"></i> Kolom ini NOT NULL</span>
          {/if}
          <span class="spacer"></span>
          <button type="button" class="link" onclick={() => { draft = oldValue === null ? '' : String(oldValue); draftNull = oldValue === null; }}>
            Kembalikan nilai awal
          </button>
        </div>

        <details class="sql">
          <summary>Perintah yang akan dijalankan</summary>
          <pre>{previewSQL}</pre>
          <p class="note">
            <i class="ti ti-lock"></i>
            Ditampilkan untuk dibaca saja — nilai dikirim sebagai parameter terikat, bukan disisipkan ke teks SQL.
          </p>
        </details>

        {#if error}
          <p class="err"><i class="ti ti-alert-circle"></i> {error}</p>
        {/if}

        <p class="warn">
          <i class="ti ti-alert-triangle"></i>
          Perubahan langsung tersimpan ke database dan tidak bisa dibatalkan.
        </p>

        <div class="m-foot">
          <button type="button" class="ghost" onclick={oncancel} disabled={saving}>Batal</button>
          <button type="submit" class="primary" disabled={unchanged || saving}>
            {#if saving}<i class="ti ti-loader-2 spin"></i>{:else}<i class="ti ti-device-floppy"></i>{/if}
            {unchanged ? 'Tidak ada perubahan' : 'Simpan perubahan'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 250;
    background: var(--scrim); display: flex; align-items: center; justify-content: center; padding: 24px;
    animation: fade var(--dur-med) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } }
  .modal {
    width: min(560px, 100%); max-height: 88vh; display: flex; flex-direction: column;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius); box-shadow: var(--shadow-modal); overflow: hidden;
    animation: rise var(--dur-med) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
  .modal:focus { outline: none; }

  .m-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; border-bottom: 0.5px solid var(--border);
  }
  .m-title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); font-weight: 500; }
  .x { background: transparent; border: 0; color: var(--text-secondary); font-size: 16px; }
  .x:hover { color: var(--text-primary); }
  .m-body { padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }

  .lbl {
    font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .where { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .where code, .field code {
    font-family: var(--mono); font-size: var(--fs-code); color: var(--text-primary);
    background: var(--surface-2); border-radius: 3px; padding: 1px 6px;
  }
  .where .sep { color: var(--text-muted); }
  .where .kv { color: var(--sev-warning); }
  .field .lbl { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; text-transform: none; letter-spacing: 0; }
  .type { font-family: var(--mono); color: var(--text-muted); font-size: var(--fs-meta); }

  /* Before → after is the whole point of confirming; show it plainly. */
  .diff { display: flex; align-items: stretch; gap: 8px; }
  .side { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .arrow { align-self: center; color: var(--text-muted); font-size: 15px; }
  .val {
    font-family: var(--mono); font-size: var(--fs-code); line-height: 1.5;
    border-radius: var(--radius-sm); padding: 7px 9px; min-height: 34px;
    word-break: break-word; white-space: pre-wrap; max-height: 110px; overflow: auto;
  }
  .val.old { background: var(--wash-critical); color: var(--text-secondary); }
  .val.new { background: var(--wash-success); color: var(--success); }
  .val.new.same { background: var(--surface-2); color: var(--text-muted); }
  .null { font-style: italic; opacity: 0.8; }
  .empty { font-style: italic; opacity: 0.7; }

  .input-row { display: block; }
  textarea {
    width: 100%; background: var(--surface-0); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text-primary);
    font-family: var(--mono); font-size: var(--fs-code); line-height: 1.55;
    padding: 8px 10px; outline: none; resize: vertical;
  }
  textarea:focus { border-color: var(--accent); }
  textarea:disabled { opacity: 0.45; }

  .controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .spacer { flex: 1 1 auto; }
  .null-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-secondary); font-size: var(--fs-meta); padding: 4px 9px;
  }
  .null-btn.on { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); }
  .hint { font-size: var(--fs-meta); color: var(--text-muted); display: inline-flex; gap: 5px; align-items: center; }
  .link {
    background: transparent; border: 0; padding: 0;
    color: var(--text-muted); font-size: var(--fs-meta); text-decoration: underline;
  }
  .link:hover { color: var(--text-primary); }

  .sql { border: 0.5px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
  .sql summary {
    cursor: pointer; padding: 7px 10px; font-size: var(--fs-meta); color: var(--text-secondary);
  }
  .sql pre {
    margin: 0; padding: 0 10px 8px; font-family: var(--mono); font-size: var(--fs-code);
    line-height: 1.55; color: var(--text-primary); white-space: pre-wrap; word-break: break-word;
  }
  .sql .note {
    margin: 0; padding: 0 10px 9px; font-size: var(--fs-meta); color: var(--text-muted);
    display: flex; gap: 5px; align-items: flex-start; line-height: 1.5;
  }

  .warn {
    margin: 0; font-size: var(--fs-meta); color: var(--sev-warning);
    background: var(--wash-warning); border: 0.5px solid var(--wash-warning-line);
    border-radius: var(--radius-sm); padding: 7px 10px;
    display: flex; gap: 6px; align-items: flex-start; line-height: 1.5;
  }
  .err {
    margin: 0; font-size: var(--fs-sub); color: var(--sev-critical);
    display: flex; gap: 6px; align-items: flex-start; line-height: 1.5;
  }

  .m-foot { display: flex; justify-content: flex-end; gap: 8px; }
  .ghost, .primary {
    display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sub);
    padding: 7px 14px; border-radius: var(--radius-sm); border: 0.5px solid var(--border);
  }
  .ghost { background: transparent; color: var(--text-secondary); }
  .ghost:hover:not(:disabled) { background: var(--surface-3); color: var(--text-primary); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .primary:hover:not(:disabled) { filter: brightness(1.08); }
  .primary:disabled, .ghost:disabled { opacity: 0.5; cursor: default; }

  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  @media (max-width: 520px) {
    .diff { flex-direction: column; }
    .arrow { transform: rotate(90deg); }
  }
</style>
