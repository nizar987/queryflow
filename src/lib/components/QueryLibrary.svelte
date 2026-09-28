<script>
  // Two kinds of memory, deliberately kept apart:
  //   Riwayat  — everything you ran, in this browser, newest first (localStorage)
  //   Tersimpan — queries you named on purpose, in a file on the server
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';
  import * as api from '$lib/api.js';
  import { loadHistory, removeEntry, clearHistory, searchHistory } from '$lib/history.js';

  let {
    open = false,
    /** The editor's current text, so it can be saved under a name. */
    current = '',
    dialect = 'MariaDB',
    connectionId = '',
    onload = () => {},
    onclose = () => {},
    ontoast = () => {}
  } = $props();

  let tab = $state('history');
  let history = $state([]);
  let saved = $state([]);
  let path = $state('');
  let loadError = $state('');
  let loading = $state(false);
  let filter = $state('');

  /** null = not saving; otherwise the draft being named. */
  let draft = $state(null);
  let formError = $state('');
  let confirmDelete = $state(null);

  $effect(() => {
    if (!open) return;
    history = loadHistory();
    refreshSaved();
    return lockScroll();
  });

  async function refreshSaved() {
    loading = true;
    const r = await api.listSavedQueries();
    loading = false;
    if (r.ok) {
      saved = r.queries;
      path = r.path || '';
      loadError = '';
    } else {
      loadError = r.error || 'Gagal memuat query tersimpan.';
    }
  }

  const shownHistory = $derived(searchHistory(history, filter));
  const shownSaved = $derived.by(() => {
    const t = filter.trim().toLowerCase();
    if (!t) return saved;
    return saved.filter((q) => `${q.name} ${q.query} ${q.note}`.toLowerCase().includes(t));
  });

  function startSave() {
    if (!current.trim()) {
      ontoast('Editor masih kosong — tidak ada yang bisa disimpan.', 'err');
      return;
    }
    draft = { id: null, name: '', note: '', query: current, dialect, connectionId };
    formError = '';
  }

  function startEdit(q) {
    draft = { ...q };
    formError = '';
  }

  async function submit() {
    if (!draft) return;
    formError = '';
    const payload = {
      name: draft.name,
      query: draft.query,
      note: draft.note,
      dialect: draft.dialect,
      connectionId: draft.connectionId
    };
    const r = draft.id ? await api.updateSavedQuery(draft.id, payload) : await api.saveQuery(payload);
    if (!r.ok) {
      formError = r.error || 'Gagal menyimpan.';
      return;
    }
    draft = null;
    await refreshSaved();
    tab = 'saved';
    ontoast('Query tersimpan');
  }

  async function remove(id) {
    const r = await api.deleteSavedQuery(id);
    confirmDelete = null;
    if (r.ok) await refreshSaved();
    else loadError = r.error || 'Gagal menghapus.';
  }

  function use(text) {
    onload(text);
    onclose();
  }

  function dropHistory(ts) {
    history = removeEntry(ts);
  }
  function wipeHistory() {
    history = clearHistory();
    confirmDelete = null;
  }

  function when(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins}m lalu`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}j lalu`;
    return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  }
  const oneLine = (q) => q.replace(/\s+/g, ' ').trim();
</script>

{#if open}
  <div class="overlay" role="presentation">
    <div class="modal" use:dismissable={onclose} use:focusTrap role="dialog" aria-modal="true"
      aria-label="Riwayat dan query tersimpan" tabindex="-1">
      <div class="m-head">
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'history'} class:active={tab === 'history'}
            onclick={() => (tab = 'history')}>
            <i class="ti ti-history"></i> Riwayat <span class="count">{history.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'saved'} class:active={tab === 'saved'}
            onclick={() => (tab = 'saved')}>
            <i class="ti ti-bookmark"></i> Tersimpan <span class="count">{saved.length}</span>
          </button>
        </div>
        <div class="head-tools">
          <label class="search">
            <i class="ti ti-search"></i>
            <input bind:value={filter} placeholder="Cari query…" aria-label="Cari query" />
            {#if filter}<button class="x-sm" onclick={() => (filter = '')} aria-label="Hapus filter"><i class="ti ti-x"></i></button>{/if}
          </label>
          <button class="x" onclick={onclose} aria-label="Tutup (Esc)"><i class="ti ti-x"></i></button>
        </div>
      </div>

      <div class="m-body">
        {#if draft}
          <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
            <label class="f">
              <span>Nama</span>
              <input bind:value={draft.name} placeholder="mis. Cek stok gudang malatex" required />
            </label>
            <label class="f">
              <span>Catatan <em>(opsional)</em></span>
              <input bind:value={draft.note} placeholder="kapan dipakai, apa yang dicari" />
            </label>
            <label class="f">
              <span>Query</span>
              <textarea bind:value={draft.query} rows="7" spellcheck="false"></textarea>
            </label>
            {#if formError}<p class="err"><i class="ti ti-alert-circle"></i> {formError}</p>{/if}
            <p class="note">
              <i class="ti ti-file-text"></i>
              Disimpan di <code>{path || '.queryflow/queries.json'}</code> pada mesin ini — bukan di browser,
              jadi tetap ada walau data situs dibersihkan.
            </p>
            <div class="form-actions">
              <button type="button" class="ghost" onclick={() => (draft = null)}>Batal</button>
              <button type="submit" class="primary">{draft.id ? 'Simpan perubahan' : 'Simpan query'}</button>
            </div>
          </form>
        {:else if tab === 'history'}
          {#if history.length === 0}
            <div class="empty">
              <i class="ti ti-history"></i>
              <p>Belum ada query yang dijalankan. Riwayat tersimpan di browser ini dan bertahan setelah tab ditutup.</p>
            </div>
          {:else if shownHistory.length === 0}
            <p class="muted">Tidak ada riwayat yang cocok dengan “{filter}”.</p>
          {:else}
            <ul class="list">
              {#each shownHistory as h (h.id ?? h.ts)}
                <li class="row" class:failed={!h.ok}>
                  <button class="pick" onclick={() => use(h.q)} title="Muat ke editor">
                    <span class="q">{oneLine(h.q)}</span>
                    <span class="meta">
                      <i class="ti {h.ok ? 'ti-circle-check ok' : 'ti-circle-x bad'}"></i>
                      {h.conn || 'tanpa koneksi'}
                      {#if h.dialect}· {h.dialect}{/if}
                      · {h.ms}ms
                      {#if h.rows != null}· {h.rows} baris{/if}
                      · {when(h.ts)}
                    </span>
                  </button>
                  <button class="act" onclick={() => dropHistory(h.id ?? h.ts)} title="Hapus dari riwayat">
                    <i class="ti ti-x"></i>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          {#if loading}
            <p class="muted"><i class="ti ti-loader-2 spin"></i> Memuat…</p>
          {:else if loadError}
            <p class="err"><i class="ti ti-alert-octagon"></i> {loadError}</p>
          {:else if saved.length === 0}
            <div class="empty">
              <i class="ti ti-bookmark"></i>
              <p>Belum ada query tersimpan. Simpan query yang sering dipakai supaya tidak perlu ditulis ulang.</p>
            </div>
          {:else if shownSaved.length === 0}
            <p class="muted">Tidak ada query tersimpan yang cocok dengan “{filter}”.</p>
          {:else}
            <ul class="list">
              {#each shownSaved as q (q.id)}
                <li class="row saved">
                  <button class="pick" onclick={() => use(q.query)} title="Muat ke editor">
                    <span class="name">{q.name}</span>
                    <span class="q">{oneLine(q.query).slice(0, 120)}</span>
                    <span class="meta">
                      {#if q.dialect}{q.dialect}{/if}
                      {#if q.note} · {q.note}{/if}
                      · diubah {when(Date.parse(q.updatedAt))}
                    </span>
                  </button>
                  <span class="acts">
                    <button class="act" onclick={() => startEdit(q)} title="Ubah"><i class="ti ti-pencil"></i></button>
                    {#if confirmDelete === q.id}
                      <button class="act danger" onclick={() => remove(q.id)}>Hapus?</button>
                      <button class="act" onclick={() => (confirmDelete = null)}><i class="ti ti-x"></i></button>
                    {:else}
                      <button class="act" onclick={() => (confirmDelete = q.id)} title="Hapus"><i class="ti ti-trash"></i></button>
                    {/if}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        {/if}
      </div>

      {#if !draft}
        <div class="m-foot">
          {#if tab === 'history' && history.length}
            {#if confirmDelete === 'all'}
              <button class="ghost danger" onclick={wipeHistory}>Hapus semua riwayat?</button>
              <button class="ghost" onclick={() => (confirmDelete = null)}>Batal</button>
            {:else}
              <button class="ghost" onclick={() => (confirmDelete = 'all')}>
                <i class="ti ti-trash"></i> Bersihkan riwayat
              </button>
            {/if}
          {/if}
          <span class="spacer"></span>
          <button class="primary" onclick={startSave}>
            <i class="ti ti-bookmark-plus"></i> Simpan query di editor
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 210; background: var(--scrim);
    display: flex; align-items: center; justify-content: center; padding: 24px;
    animation: fade var(--dur-med) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } }
  .modal {
    width: min(760px, 100%); max-height: 84vh; display: flex; flex-direction: column;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius); box-shadow: var(--shadow-modal); overflow: hidden;
    animation: rise var(--dur-med) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
  .modal:focus { outline: none; }

  .m-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 9px 12px; border-bottom: 0.5px solid var(--border); flex-wrap: wrap;
  }
  .tabs { display: flex; gap: 2px; }
  .tabs button {
    display: inline-flex; align-items: center; gap: 6px;
    background: transparent; border: 0.5px solid transparent; color: var(--text-muted);
    font-size: var(--fs-sub); padding: 5px 11px; border-radius: 20px;
  }
  .tabs button:hover { color: var(--text-primary); background: var(--surface-3); }
  .tabs button.active { color: var(--accent); border-color: var(--accent-line); background: var(--surface-2); }
  .count { font-family: var(--mono); font-size: var(--fs-meta); opacity: 0.8; }
  .head-tools { display: flex; align-items: center; gap: 8px; }
  .search {
    display: flex; align-items: center; gap: 6px;
    background: var(--surface-2); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); padding: 4px 8px; color: var(--text-muted);
  }
  .search:focus-within { border-color: var(--accent); }
  .search input {
    background: transparent; border: 0; outline: none; color: var(--text-primary);
    font-size: var(--fs-meta); font-family: var(--sans); width: 180px;
  }
  .x, .x-sm { background: transparent; border: 0; color: var(--text-secondary); font-size: 16px; }
  .x-sm { font-size: 12px; padding: 0; }
  .x:hover { color: var(--text-primary); }

  .m-body { padding: 12px; overflow-y: auto; }
  .m-foot {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; border-top: 0.5px solid var(--border);
  }
  .spacer { flex: 1 1 auto; }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .row {
    display: flex; align-items: stretch; gap: 4px;
    border: 0.5px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2);
  }
  .row:hover { border-color: var(--border-strong); }
  .row.failed { border-left: 2px solid var(--sev-critical); }
  .pick {
    flex: 1 1 auto; min-width: 0; text-align: left; background: transparent; border: 0;
    padding: 8px 10px; display: flex; flex-direction: column; gap: 3px;
  }
  .name { font-size: var(--fs-body); color: var(--text-primary); }
  .q {
    font-family: var(--mono); font-size: var(--fs-code); color: var(--text-secondary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row.saved .q { color: var(--text-muted); }
  .meta { font-size: var(--fs-meta); color: var(--text-muted); display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
  .meta .ok { color: var(--success); }
  .meta .bad { color: var(--sev-critical); }
  .acts { display: flex; align-items: center; gap: 2px; padding-right: 4px; }
  .act {
    background: transparent; border: 0; color: var(--text-muted);
    width: 28px; height: 28px; border-radius: var(--radius-sm); font-size: 14px;
    display: inline-flex; align-items: center; justify-content: center; align-self: center;
  }
  .act:hover { background: var(--surface-3); color: var(--text-primary); }
  .act.danger { width: auto; padding: 0 8px; font-size: var(--fs-meta); color: var(--sev-critical); }

  .f { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .f > span { font-size: var(--fs-meta); color: var(--text-muted); }
  .f em { font-style: normal; opacity: 0.75; }
  .f input, .f textarea {
    background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-primary); font-size: var(--fs-sub); padding: 7px 9px; outline: none;
    font-family: var(--sans); resize: vertical;
  }
  .f textarea { font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6; }
  .f input:focus, .f textarea:focus { border-color: var(--accent); }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }

  .ghost, .primary {
    display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sub);
    padding: 6px 12px; border-radius: var(--radius-sm); border: 0.5px solid var(--border);
  }
  .ghost { background: transparent; color: var(--text-secondary); }
  .ghost:hover { background: var(--surface-3); color: var(--text-primary); }
  .ghost.danger { color: var(--sev-critical); border-color: var(--sev-critical); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .primary:hover { filter: brightness(1.08); }

  .note {
    margin: 10px 0 0; font-size: var(--fs-meta); color: var(--text-muted);
    line-height: 1.6; display: flex; gap: 6px; align-items: flex-start;
  }
  .note code { font-family: var(--mono); color: var(--text-secondary); word-break: break-all; }
  .err { color: var(--sev-critical); font-size: var(--fs-sub); display: flex; gap: 6px; margin: 8px 0 0; }
  .muted { color: var(--text-muted); font-size: var(--fs-sub); display: flex; gap: 6px; align-items: center; padding: 20px; justify-content: center; }
  .empty { text-align: center; color: var(--text-muted); font-size: var(--fs-sub); padding: 32px 16px; line-height: 1.6; }
  .empty i { font-size: 26px; display: block; margin-bottom: 10px; opacity: 0.6; }
  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 560px) {
    .search input { width: 110px; }
  }
</style>
