<script>
  import * as api from '$lib/api.js';
  import CellEditModal from './CellEditModal.svelte';
  import DumpModal from './DumpModal.svelte';

  let {
    connectionId,
    table,
    dialect = 'MariaDB',
    info,
    page,
    loading = false,
    onreload = () => {},
    ontoast = () => {},
    onnavigatefk = () => {},
    orderBy = null,
    dir = 'asc'
  } = $props();

  /** {row, col} whose edit dialog is open, or null. */
  let editing = $state(null);
  let editError = $state('');
  let saving = $state(false);
  /** "r:c" keys that just failed, for a brief red flash. */
  let failed = $state(new Set());

  /** The export dialog: SQL dump, filter builder, row cap. */
  let dumpOpen = $state(false);

  let adding = $state(false);
  let newRow = $state({});
  let confirmDelete = $state(null);

  const cols = $derived(page ? page.columns : []);
  const rows = $derived(page ? page.rows : []);
  const colMeta = $derived.by(() => {
    const m = {};
    for (const c of info?.columns || []) m[c.name] = c;
    return m;
  });

  // A filtered view (FK navigation) paginates against the filtered count, not
  // the whole table — otherwise "page 1 of 13" would show for a filter that
  // only ever matches a handful of rows.
  const filtered = $derived(!!page?.filter);
  const total = $derived(filtered ? (page?.matchedCount ?? 0) : (info?.rowCount ?? 0));
  const isExact = $derived(filtered ? true : !!info?.exactCount);
  const limit = $derived(page?.limit ?? 200);
  const offset = $derived(page?.offset ?? 0);
  const pageNo = $derived(Math.floor(offset / limit) + 1);
  const pageCount = $derived(Math.max(1, Math.ceil(total / limit)));

  /** Index of each primary-key column within the current result columns. */
  const pkIndexes = $derived((info?.primaryKey || []).map((name) => cols.indexOf(name)));
  const pkResolvable = $derived(pkIndexes.length > 0 && pkIndexes.every((i) => i >= 0));

  /** column name -> its foreign key, for the "jump to referenced row" link. */
  const fkByColumn = $derived.by(() => {
    const m = {};
    for (const fk of info?.foreignKeys || []) m[fk.column] = fk;
    return m;
  });

  function keyValuesFor(rowIdx) {
    const row = rows[rowIdx];
    const out = {};
    (info.primaryKey || []).forEach((name, i) => {
      const cell = row[pkIndexes[i]];
      out[name] = cell ? cell.v : null;
    });
    return out;
  }

  /** Generated columns (auto-increment, identity, computed) are never writable. */
  function canEditColumn(name) {
    if (!info?.editable || !pkResolvable) return false;
    const meta = colMeta[name];
    return !(meta && meta.isGenerated);
  }

  // Editing goes through a dialog rather than an inline input: a write hits the
  // database immediately and cannot be undone, so the change is shown as a
  // before/after diff and has to be confirmed explicitly.
  function startEdit(r, c) {
    if (!canEditColumn(cols[c]) || saving) return;
    editError = '';
    editing = { r, c };
  }

  function cancelEdit() {
    if (saving) return;
    editing = null;
    editError = '';
  }

  async function commitEdit({ value, isNull }) {
    if (!editing || saving) return;
    const { r, c } = editing;
    const column = cols[c];
    const before = rows[r][c];

    saving = true;
    editError = '';
    const res = await api.updateCell(connectionId, table, keyValuesFor(r), column, value, isNull);
    saving = false;

    if (!res.ok) {
      // Keep the dialog open with the typed value intact so it isn't lost.
      editError = res.error || 'Gagal menyimpan.';
      markFailed(r, c);
      return;
    }

    // Reflect the saved value locally rather than refetching the whole page.
    rows[r][c] = { v: value, t: value === null ? 'null' : before.t };
    editing = null;
    ontoast(`${column} disimpan`);
  }

  function markFailed(r, c) {
    const k = `${r}:${c}`;
    failed = new Set(failed).add(k);
    setTimeout(() => {
      const next = new Set(failed);
      next.delete(k);
      failed = next;
    }, 1600);
  }

  // ---- insert -------------------------------------------------------------

  const insertableColumns = $derived((info?.columns || []).filter((c) => !c.isGenerated));

  /**
   * The export follows what is on screen: same filter, same ordering. Only the
   * page window is dropped — that is the whole point of exporting.
   */
  function exportUrl(format) {
    return api.tableExportUrl(connectionId, table, {
      format,
      orderBy,
      dir,
      filter: page?.filter || null
    });
  }

  function startAdd() {
    newRow = {};
    for (const c of insertableColumns) newRow[c.name] = { value: '', isNull: c.nullable };
    adding = true;
  }

  async function commitAdd() {
    if (saving) return;
    const values = {};
    for (const [name, field] of Object.entries(newRow)) {
      // A blank, nullable field means "leave it to the database", not "".
      if (field.isNull) continue;
      values[name] = field.value;
    }
    saving = true;
    const res = await api.insertRow(connectionId, table, values);
    saving = false;
    if (!res.ok) {
      ontoast(res.error || 'Gagal menambah baris.', 'err');
      return;
    }
    adding = false;
    ontoast('Baris ditambahkan');
    onreload({ toEnd: true });
  }

  // ---- delete -------------------------------------------------------------

  async function doDelete(r) {
    if (saving) return;
    saving = true;
    const res = await api.deleteRow(connectionId, table, keyValuesFor(r));
    saving = false;
    confirmDelete = null;
    if (!res.ok) {
      ontoast(res.error || 'Gagal menghapus baris.', 'err');
      return;
    }
    ontoast('Baris dihapus');
    onreload({ keepPage: true });
  }

  // ---- paging & sorting ---------------------------------------------------

  const goto = (o) => onreload({ offset: Math.max(0, Math.min(o, (pageCount - 1) * limit)) });
  const setLimit = (n) => onreload({ offset: 0, limit: Number(n) });

  function toggleSort(name) {
    if (orderBy === name) onreload({ offset: 0, orderBy: name, dir: dir === 'asc' ? 'desc' : 'asc' });
    else onreload({ offset: 0, orderBy: name, dir: 'asc' });
  }

  function jumpTo(e) {
    const n = parseInt(e.currentTarget.value, 10);
    if (Number.isFinite(n)) goto((Math.max(1, Math.min(pageCount, n)) - 1) * limit);
  }
</script>

<div class="wrap">
  {#if filtered}
    <div class="filter-bar">
      <i class="ti ti-filter"></i>
      <span>Difilter: <code>{page.filter.column} = {page.filter.value}</code></span>
      <button class="clear-filter" onclick={() => onreload({ clearFilter: true, offset: 0 })}>
        <i class="ti ti-x"></i> Hapus filter
      </button>
    </div>
  {/if}

  <div class="toolbar">
    <div class="left">
      <span class="total">
        {#if !isExact}<span class="approx" title="Perkiraan dari statistik engine — menghitung persis berarti memindai seluruh tabel">≈</span>{/if}
        <strong>{total.toLocaleString('id-ID')}</strong> baris
        {#if !isExact}
          <button class="count-btn" onclick={() => onreload({ keepPage: true, exactCount: true })}>
            hitung persis
          </button>
        {/if}
        {#if page}<span class="dim">· {page.durationMs}ms</span>{/if}
      </span>

      {#if info}
        {#if info.editable}
          <span class="badge ok" title="User database punya privilege UPDATE dan tabel punya primary key">
            <i class="ti ti-pencil"></i> Bisa diedit
          </span>
        {:else}
          <span class="badge ro" title={info.readOnlyReason}>
            <i class="ti ti-lock"></i> Hanya baca
          </span>
        {/if}
        <span class="privs">
          {#each [['select', 'SELECT'], ['insert', 'INSERT'], ['update', 'UPDATE'], ['delete', 'DELETE']] as [k, label] (k)}
            <span class="priv" class:on={info.privileges[k]} title={info.privileges[k] ? `Diizinkan: ${label}` : `Tidak diizinkan: ${label}`}>{label}</span>
          {/each}
        </span>
      {/if}
    </div>

    <div class="right">
      <span class="export">
        <span class="ex-label" title="Diambil langsung dari server, bukan hanya baris yang tampil di halaman ini">
          <i class="ti ti-download"></i> Ekspor{#if filtered} hasil filter{/if}
        </span>
        <a class="tb-btn" href={exportUrl('csv')} download
          title="Unduh seluruh {filtered ? 'baris yang cocok filter' : 'isi tabel'} sebagai CSV">CSV</a>
        <a class="tb-btn" href={exportUrl('json')} download
          title="Unduh seluruh {filtered ? 'baris yang cocok filter' : 'isi tabel'} sebagai JSON">JSON</a>
        <button class="tb-btn" onclick={() => (dumpOpen = true)}
          title="Dump SQL, atau ekspor dengan filter dan batas baris sendiri">
          <i class="ti ti-database-export"></i> Dump…
        </button>
      </span>
      {#if info?.canInsert && !adding}
        <button class="tb-btn" onclick={startAdd}><i class="ti ti-plus"></i> Baris baru</button>
      {/if}
      <label class="pick">
        <span class="sr-only">Baris per halaman</span>
        <select value={limit} onchange={(e) => setLimit(e.currentTarget.value)}>
          {#each [100, 200, 500, 1000, 5000] as n (n)}<option value={n}>{n} / halaman</option>{/each}
        </select>
      </label>
    </div>
  </div>

  {#if info && !info.editable && info.readOnlyReason}
    <div class="notice">
      <i class="ti ti-lock"></i>
      Tabel ini hanya bisa dibaca — {info.readOnlyReason}.
    </div>
  {/if}
  {#if info?.editable && !pkResolvable}
    <div class="notice">
      <i class="ti ti-alert-triangle"></i>
      Kolom primary key ({(info.primaryKey || []).join(', ')}) tidak ada di hasil, jadi baris tidak bisa dialamatkan untuk diedit.
    </div>
  {/if}
  {#if page?.orderImplicit}
    <div class="notice subtle">
      <i class="ti ti-arrow-down"></i>
      Diurutkan otomatis berdasarkan <code>{page.orderBy}</code> supaya penomoran halaman stabil dan tidak ada baris yang terlewat.
    </div>
  {:else if info && !page?.orderBy}
    <div class="notice">
      <i class="ti ti-alert-triangle"></i>
      Tabel ini tidak punya primary key, jadi urutan baris antar halaman tidak dijamin — klik salah satu judul kolom untuk mengurutkan.
    </div>
  {/if}
  {#if info?.columnsFromSample}
    <div class="notice">
      <i class="ti ti-info-circle"></i>
      Daftar kolom diambil dari sampel dokumen — field yang hanya muncul di dokumen lain mungkin belum tampil.
    </div>
  {/if}

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th class="gutter" scope="col">#</th>
          {#if info?.canDelete}<th class="act" scope="col"><span class="sr-only">Aksi</span></th>{/if}
          {#each cols as c, ci (c + ci)}
            {@const meta = colMeta[c]}
            <th scope="col">
              <button onclick={() => toggleSort(c)} title={meta ? `${meta.type}${meta.nullable ? ' · nullable' : ' · NOT NULL'}` : c}>
                {#if meta?.isPk}<i class="ti ti-key pk"></i>{/if}
                <span>{c}</span>
                {#if meta?.isGenerated}<i class="ti ti-wand gen" title="Dibuat otomatis — tidak bisa diedit"></i>{/if}
                {#if orderBy === c}<i class="ti {dir === 'asc' ? 'ti-arrow-up' : 'ti-arrow-down'}"></i>{/if}
              </button>
            </th>
          {/each}
        </tr>
      </thead>

      <tbody>
        {#each rows as row, ri (offset + ri)}
          <tr class:deleting={confirmDelete === ri}>
            <td class="gutter">{offset + ri + 1}</td>
            {#if info?.canDelete}
              <td class="act">
                {#if confirmDelete === ri}
                  <button class="del yes" onclick={() => doDelete(ri)} disabled={saving}>Hapus</button>
                  <button class="del no" onclick={() => (confirmDelete = null)} aria-label="Batal"><i class="ti ti-x"></i></button>
                {:else}
                  <button class="del" onclick={() => (confirmDelete = ri)} aria-label="Hapus baris" title="Hapus baris">
                    <i class="ti ti-trash"></i>
                  </button>
                {/if}
              </td>
            {/if}

            {#each row as cell, ci (ci)}
              {@const editable = canEditColumn(cols[ci])}
              {@const fk = fkByColumn[cols[ci]]}
              {@const isEditing = editing && editing.r === ri && editing.c === ci}
              <!--
                A <td> is a container here, never itself the interactive
                element — edit and FK-navigate are two independent affordances
                that can both apply to the same cell, and a button nested
                inside a button (the old `role="button" td` design) breaks
                keyboard/screen-reader semantics the moment a cell is both
                editable and a foreign key, which is the common case
                (orders.customer_id is ordinarily both).
              -->
              <td class="t-{cell.t}" class:editing={isEditing} class:failed={failed.has(`${ri}:${ci}`)}>
                <div class="cell-inner">
                  {#if fk && cell.v !== null}
                    <button class="fk-link" onclick={() => onnavigatefk(fk, cell.v)}
                      title={`Buka ${fk.refTable} dengan ${fk.refColumn} = ${cell.v}`}>
                      {cell.v}<i class="ti ti-arrow-up-right"></i>
                    </button>
                  {:else if cell.v === null}
                    <span class="null">NULL</span>
                  {:else}
                    <span class="val">{cell.v}</span>
                  {/if}

                  {#if editable}
                    <button class="edit-btn" onclick={() => startEdit(ri, ci)} aria-label={`Ubah ${cols[ci]}`}
                      title={`Ubah ${cols[ci]}`}>
                      <i class="ti ti-pencil"></i>
                    </button>
                  {/if}
                </div>
              </td>
            {/each}
          </tr>
        {/each}

        {#if adding}
          <tr class="new-row">
            <td class="gutter"><i class="ti ti-plus"></i></td>
            {#if info?.canDelete}<td class="act"></td>{/if}
            {#each cols as c, ci (c + ci)}
              <td>
                {#if newRow[c]}
                  <div class="editor">
                    <input
                      value={newRow[c].value}
                      oninput={(e) => { newRow[c].value = e.currentTarget.value; newRow[c].isNull = false; }}
                      disabled={newRow[c].isNull}
                      placeholder={colMeta[c]?.default ? `default: ${colMeta[c].default}` : ''}
                      aria-label={`Nilai baru ${c}`}
                    />
                    {#if colMeta[c]?.nullable}
                      <button class="null-btn" class:on={newRow[c].isNull}
                        onclick={() => (newRow[c].isNull = !newRow[c].isNull)} title="Biarkan kosong / NULL">NULL</button>
                    {/if}
                  </div>
                {:else}
                  <span class="auto">otomatis</span>
                {/if}
              </td>
            {/each}
          </tr>
        {/if}
      </tbody>
    </table>

    {#if rows.length === 0 && !loading}
      <p class="empty">Tabel ini kosong.</p>
    {/if}
  </div>

  {#if adding}
    <div class="add-bar">
      <span>Isi nilai lalu simpan. Kolom otomatis diisi database.</span>
      <span class="spacer"></span>
      <button class="tb-btn" onclick={() => (adding = false)}>Batal</button>
      <button class="primary" onclick={commitAdd} disabled={saving}>
        {#if saving}<i class="ti ti-loader-2 spin"></i>{/if} Simpan baris
      </button>
    </div>
  {/if}

  <CellEditModal
    open={!!editing}
    {table}
    {dialect}
    column={editing ? cols[editing.c] : ''}
    meta={editing ? colMeta[cols[editing.c]] : null}
    oldValue={editing ? rows[editing.r][editing.c].v : null}
    keyValues={editing ? keyValuesFor(editing.r) : {}}
    {saving}
    error={editError}
    onconfirm={commitEdit}
    oncancel={cancelEdit}
  />

  {#if dumpOpen}
    <DumpModal
      {connectionId}
      {dialect}
      {table}
      {info}
      viewFilter={page?.filter || null}
      {orderBy}
      {dir}
      onclose={() => (dumpOpen = false)}
    />
  {/if}

  <div class="pager">
    <button class="pg" onclick={() => goto(0)} disabled={pageNo <= 1 || loading} aria-label="Halaman pertama"><i class="ti ti-chevrons-left"></i></button>
    <button class="pg" onclick={() => goto(offset - limit)} disabled={pageNo <= 1 || loading} aria-label="Halaman sebelumnya"><i class="ti ti-chevron-left"></i></button>
    <span class="pg-info">
      Halaman
      <input type="number" min="1" max={pageCount} value={pageNo} onchange={jumpTo} aria-label="Nomor halaman" />
      dari {pageCount.toLocaleString('id-ID')}
    </span>
    <button class="pg" onclick={() => goto(offset + limit)} disabled={pageNo >= pageCount || loading} aria-label="Halaman berikutnya"><i class="ti ti-chevron-right"></i></button>
    <button class="pg" onclick={() => goto((pageCount - 1) * limit)} disabled={pageNo >= pageCount || loading} aria-label="Halaman terakhir"><i class="ti ti-chevrons-right"></i></button>
    <span class="range">
      {#if total}
        baris {(offset + 1).toLocaleString('id-ID')}–{Math.min(offset + rows.length, total).toLocaleString('id-ID')}
      {/if}
    </span>
  </div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }

  .toolbar {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 7px 12px; border-bottom: 0.5px solid var(--border);
    background: var(--surface-1); flex: 0 0 auto; flex-wrap: wrap;
  }
  .left, .right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .total { font-size: var(--fs-meta); color: var(--text-muted); }
  .total strong { color: var(--text-primary); }
  .approx { color: var(--text-muted); }
  .count-btn {
    background: transparent; border: 0; padding: 0 0 0 2px;
    color: var(--accent); font-size: var(--fs-meta); text-decoration: underline;
  }
  .count-btn:hover { filter: brightness(1.15); }
  .dim { color: var(--text-muted); }

  .badge {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: var(--fs-meta); border-radius: 20px; padding: 2px 8px;
    border: 0.5px solid currentColor;
  }
  .badge.ok { color: var(--success); }
  .badge.ro { color: var(--text-muted); }

  /* The exact privilege set, straight from the database — no guessing. */
  .privs { display: inline-flex; gap: 3px; }
  .priv {
    font-size: 9px; letter-spacing: 0.04em; padding: 2px 5px; border-radius: 3px;
    background: var(--surface-2); color: var(--text-muted);
    text-decoration: line-through; opacity: 0.6;
  }
  .priv.on { color: var(--success); text-decoration: none; opacity: 1; background: var(--wash-success); }

  .tb-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-meta); padding: 3px 9px; border-radius: var(--radius-sm);
  }
  .tb-btn:hover:not(:disabled) { background: var(--surface-3); color: var(--text-primary); }
  .pick {
    display: inline-flex; align-items: center;
    border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 2px 6px;
  }
  .pick select {
    background: transparent; border: 0; color: var(--text-secondary);
    font-size: var(--fs-meta); outline: none; cursor: pointer;
  }
  .pick select option { background: var(--surface-1); color: var(--text-primary); }

  .notice {
    padding: 6px 12px; font-size: var(--fs-meta); color: var(--text-secondary);
    background: var(--wash-warning); border-bottom: 0.5px solid var(--wash-warning-line);
    display: flex; gap: 6px; align-items: flex-start; flex: 0 0 auto;
  }

  .export { display: inline-flex; align-items: center; gap: 4px; }
  .ex-label {
    font-size: var(--fs-meta); color: var(--text-muted);
    display: inline-flex; align-items: center; gap: 4px; margin-right: 2px;
  }
  .export .tb-btn { text-decoration: none; }

  .filter-bar {
    display: flex; align-items: center; gap: 7px; flex: 0 0 auto;
    padding: 6px 12px; font-size: var(--fs-sub); color: var(--text-secondary);
    background: var(--accent-soft); border-bottom: 0.5px solid var(--accent-line);
  }
  .filter-bar i { color: var(--accent); font-size: 13px; }
  .filter-bar code { font-family: var(--mono); color: var(--text-primary); }
  .clear-filter {
    margin-left: auto; display: inline-flex; align-items: center; gap: 4px;
    background: transparent; border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-muted); font-size: var(--fs-meta); padding: 3px 8px;
  }
  .clear-filter:hover { color: var(--text-primary); background: var(--surface-3); }
  /* Automatic ordering is normal behaviour, not a problem — don't alarm. */
  .notice.subtle { background: var(--surface-2); border-bottom-color: var(--border); color: var(--text-muted); }
  .notice code { font-family: var(--mono); color: var(--text-secondary); }

  .scroll { flex: 1 1 auto; overflow: auto; min-height: 0; background: var(--surface-1); }
  table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: var(--fs-code); font-family: var(--mono); }
  thead th {
    position: sticky; top: 0; z-index: 2; background: var(--surface-2);
    border-bottom: 0.5px solid var(--border-strong); text-align: left;
    font-weight: 500; padding: 0; white-space: nowrap;
  }
  thead th button {
    display: flex; align-items: center; gap: 4px; width: 100%;
    background: transparent; border: 0; color: var(--text-secondary);
    font: inherit; padding: 7px 10px; text-align: left;
  }
  thead th button:hover { color: var(--text-primary); background: var(--surface-3); }
  .pk { color: var(--sev-warning); font-size: 11px; }
  .gen { color: var(--text-muted); font-size: 11px; }

  /* `td` stays a real table-cell (display default) so column widths still
     line up across rows — flex lives one level down, on `.cell-inner`, so
     switching a cell's contents to flex can't fall out of table layout. */
  td {
    padding: 0; border-bottom: 0.5px solid var(--border);
    color: var(--text-primary); white-space: nowrap;
    max-width: 420px; overflow: hidden; text-overflow: ellipsis;
  }
  tbody tr:hover td { background: var(--surface-2); }
  tbody tr.deleting td { background: var(--wash-critical); }
  .cell-inner { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 5px 6px 5px 10px; }
  .val { overflow: hidden; text-overflow: ellipsis; }

  .gutter {
    color: var(--text-muted); text-align: right; user-select: none;
    position: sticky; left: 0; background: var(--surface-1);
    border-right: 0.5px solid var(--border); padding: 5px 8px;
  }
  thead .gutter { background: var(--surface-2); z-index: 3; }
  tbody tr:hover .gutter { background: var(--surface-2); }
  .act { width: 1%; padding: 2px 4px; white-space: nowrap; }
  .del {
    background: transparent; border: 0; color: var(--text-muted);
    font-size: 12px; padding: 2px 4px; border-radius: 3px; opacity: 0;
    transition: opacity var(--dur-fast) var(--ease);
  }
  tbody tr:hover .del, .del:focus-visible { opacity: 1; }
  .del:hover { color: var(--sev-critical); }
  .del.yes { opacity: 1; color: var(--sev-critical); font-family: var(--sans); font-size: var(--fs-meta); }
  .del.no { opacity: 1; }

  td.editing { box-shadow: inset 0 0 0 1px var(--accent); }
  td.failed { animation: shake 0.35s ease; box-shadow: inset 0 0 0 1px var(--sev-critical); }
  @keyframes shake { 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }

  /* The edit affordance fades in on hover/focus rather than sitting there
     permanently — most cells in a wide table are never touched. */
  .edit-btn {
    flex: 0 0 auto; background: transparent; border: 0;
    color: var(--text-muted); font-size: 11px; padding: 2px; border-radius: 3px;
    opacity: 0; transition: opacity var(--dur-fast) var(--ease);
  }
  tr:hover .edit-btn, .edit-btn:focus-visible { opacity: 1; }
  .edit-btn:hover { color: var(--accent); background: var(--surface-3); }

  /* A foreign key is a real navigation control, not a value to edit in place —
     styled like a link so it reads as "goes somewhere" at a glance. */
  .fk-link {
    display: inline-flex; align-items: center; gap: 3px; min-width: 0;
    background: transparent; border: 0; padding: 0;
    color: var(--accent); font: inherit; text-decoration: underline;
    text-decoration-color: var(--accent-line); overflow: hidden; text-overflow: ellipsis;
  }
  .fk-link:hover { text-decoration-color: var(--accent); }
  .fk-link i { flex: 0 0 auto; font-size: 10px; opacity: 0.8; }

  .editor { display: flex; align-items: center; gap: 3px; }
  .editor input {
    flex: 1 1 auto; min-width: 80px;
    background: var(--surface-0); border: 0.5px solid var(--border);
    border-radius: 3px; color: var(--text-primary);
    font-family: var(--mono); font-size: var(--fs-code); padding: 3px 6px; outline: none;
  }
  .editor input:focus { border-color: var(--accent); }
  .editor input:disabled { opacity: 0.45; }
  .null-btn {
    background: transparent; border: 0.5px solid var(--border); border-radius: 3px;
    color: var(--text-muted); font-size: 10px; padding: 3px 5px; flex: 0 0 auto;
  }
  .null-btn.on { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); }

  .null { color: var(--text-muted); font-style: italic; }
  .auto { color: var(--text-muted); font-style: italic; font-size: var(--fs-meta); }
  .t-number { color: var(--c-purple); text-align: right; }
  .t-date { color: var(--c-teal); }
  .t-boolean { color: var(--c-blue); }
  .t-id { color: var(--c-coral); }
  .t-json { color: var(--text-secondary); }
  .t-binary { color: var(--text-muted); }

  tr.new-row td { background: var(--wash-success); }
  .add-bar {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    border-top: 0.5px solid var(--border); background: var(--surface-1);
    font-size: var(--fs-meta); color: var(--text-muted); flex: 0 0 auto;
  }
  .spacer { flex: 1 1 auto; }
  .primary {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--accent); color: var(--accent-ink); border: 0;
    font-size: var(--fs-sub); padding: 6px 12px; border-radius: var(--radius-sm);
  }
  .primary:disabled { opacity: 0.6; }

  .pager {
    display: flex; align-items: center; gap: 4px; padding: 6px 12px;
    border-top: 0.5px solid var(--border); background: var(--surface-1);
    font-size: var(--fs-meta); color: var(--text-muted); flex: 0 0 auto; flex-wrap: wrap;
  }
  .pg {
    background: transparent; border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-secondary); width: 26px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .pg:hover:not(:disabled) { background: var(--surface-3); color: var(--text-primary); }
  .pg:disabled { opacity: 0.35; cursor: default; }
  .pg-info { display: inline-flex; align-items: center; gap: 5px; margin: 0 6px; }
  .pg-info input {
    width: 58px; background: var(--surface-2); border: 0.5px solid var(--border);
    border-radius: 3px; color: var(--text-primary); font: inherit;
    padding: 2px 5px; text-align: center; outline: none;
  }
  .range { margin-left: auto; }
  .empty { color: var(--text-muted); font-size: var(--fs-sub); text-align: center; padding: 30px; }
  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
