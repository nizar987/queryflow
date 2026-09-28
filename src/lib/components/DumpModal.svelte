<script>
  // Export one table — or the slice a filter describes — as CSV, JSON, or a
  // runnable SQL dump.
  //
  // The filter is built here rather than typed as raw SQL: a column picker and
  // a fixed operator list mean nothing a user types can become SQL syntax, and
  // the same conditions travel to the server as data. What the filter *says* is
  // shown in full before anyone downloads, because the failure mode worth
  // preventing is a file that looks complete and quietly holds the wrong rows.
  import * as api from '$lib/api.js';
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';
  import { OPERATOR_LIST, OPERATORS, MAX_CONDITIONS, describeConditions, isIncomplete } from '$lib/filter.js';

  let {
    connectionId,
    dialect = 'MariaDB',
    table = '',
    info = null,
    /** The view's current filter (from a foreign-key click), seeded as condition #1. */
    viewFilter = null,
    orderBy = null,
    dir = 'asc',
    onclose = () => {}
  } = $props();

  const DIALECTS_WITH_SQL = ['MySQL', 'MariaDB', 'PostgreSQL'];
  const sqlCapable = $derived(DIALECTS_WITH_SQL.includes(dialect));

  // The dialog is mounted fresh each time it opens, so these read the props
  // once, on purpose: they are the starting point of an editable form, not a
  // view of the props. Changing the table behind an open dialog is not a thing
  // the UI can do.
  const initialFormat = () => (DIALECTS_WITH_SQL.includes(dialect) ? 'sql' : 'csv');
  const initialConditions = () => {
    const f = viewFilter;
    if (!f || !f.column) return [];
    // The view's foreign-key filter, carried in so "ekspor hasil filter" means
    // what it looks like it means — and stays editable from here.
    return [{ column: f.column, op: '=', value: f.value == null ? '' : String(f.value) }];
  };

  let format = $state(initialFormat());
  let includeSchema = $state(true);
  let limit = $state(200000);

  /** Editing shape: one `value` text field per row, split into a list only for IN. */
  let conditions = $state(initialConditions());

  $effect(() => lockScroll());

  const columns = $derived((info?.columns || []).map((c) => c.name));
  const ready = $derived(conditions.filter((c) => c.column && !isIncomplete(c)));
  const pending = $derived(conditions.length - ready.length);
  const summary = $derived(ready.length ? describeConditions(ready) : '');

  const url = $derived(
    api.tableExportUrl(connectionId, table, {
      format,
      orderBy,
      dir,
      conditions: ready,
      includeSchema,
      limit
    })
  );

  const rowsHint = $derived.by(() => {
    if (!info) return '';
    const n = (info.rowCount ?? 0).toLocaleString('id-ID');
    const approx = info.exactCount ? '' : '≈';
    return ready.length ? `dari ${approx}${n} baris, sebelum filter` : `${approx}${n} baris`;
  });

  function addCondition() {
    if (conditions.length >= MAX_CONDITIONS) return;
    conditions = [...conditions, { column: columns[0] || '', op: '=', value: '' }];
  }

  function removeCondition(i) {
    conditions = conditions.filter((_, idx) => idx !== i);
  }

  function patch(i, key, value) {
    conditions = conditions.map((c, idx) => (idx === i ? { ...c, [key]: value } : c));
  }

  const arityOf = (op) => (OPERATORS[op] ? OPERATORS[op].arity : 1);

  function start() {
    // The download is a plain navigation, so the dialog's work ends here.
    onclose();
  }
</script>

<div class="overlay" role="presentation">
  <div class="modal" use:dismissable={onclose} use:focusTrap role="dialog" aria-modal="true"
    aria-label="Ekspor tabel" tabindex="-1">
    <div class="m-head">
      <span class="m-title"><i class="ti ti-database-export"></i> Ekspor <strong>{table}</strong></span>
      <button class="x" onclick={() => onclose()} aria-label="Tutup"><i class="ti ti-x"></i></button>
    </div>

    <div class="m-body">
      <section>
        <h3>Format</h3>
        <div class="formats">
          {#if sqlCapable}
            <label class="fmt" class:on={format === 'sql'}>
              <input type="radio" value="sql" bind:group={format} />
              <i class="ti ti-file-type-sql"></i>
              <span class="fname">Dump SQL</span>
              <span class="fdesc">Statement yang bisa dijalankan ulang di database lain</span>
            </label>
          {/if}
          <label class="fmt" class:on={format === 'csv'}>
            <input type="radio" value="csv" bind:group={format} />
            <i class="ti ti-file-spreadsheet"></i>
            <span class="fname">CSV</span>
            <span class="fdesc">Untuk Excel atau Google Sheets</span>
          </label>
          <label class="fmt" class:on={format === 'json'}>
            <input type="radio" value="json" bind:group={format} />
            <i class="ti ti-file-code"></i>
            <span class="fname">JSON</span>
            <span class="fdesc">Satu objek per baris, plus metadata</span>
          </label>
        </div>

        {#if !sqlCapable}
          <p class="note"><i class="ti ti-info-circle"></i> Dump SQL hanya untuk MySQL, MariaDB, dan PostgreSQL — {dialect} tidak punya padanan statement-nya.</p>
        {/if}

        {#if format === 'sql'}
          <div class="sql-opts">
            <label class="check">
              <input type="checkbox" bind:checked={includeSchema} />
              <span>Sertakan <code>CREATE TABLE</code> sebelum datanya</span>
            </label>
            <p class="note subtle">
              <i class="ti ti-info-circle"></i>
              {#if includeSchema}
                File bisa dijalankan di database kosong. Matikan kalau tabel tujuan sudah ada dan hanya datanya yang dibutuhkan.
              {:else}
                Hanya <code>INSERT</code> — tabel tujuan harus sudah ada dengan kolom yang cocok.
              {/if}
            </p>
          </div>
        {/if}
      </section>

      <section>
        <h3>
          Filter baris
          {#if !sqlCapable}<span class="tag">tidak tersedia untuk {dialect}</span>{/if}
        </h3>

        {#if !sqlCapable}
          <p class="note"><i class="ti ti-alert-triangle"></i> Ekspor akan berisi seluruh isi koleksi.</p>
        {:else if !columns.length}
          <p class="note"><i class="ti ti-alert-triangle"></i> Daftar kolom belum terbaca, jadi filter belum bisa disusun.</p>
        {:else}
          {#each conditions as cond, i (i)}
            <div class="cond">
              <span class="joiner">{i === 0 ? 'DI MANA' : 'DAN'}</span>
              <select class="col" value={cond.column} onchange={(e) => patch(i, 'column', e.currentTarget.value)}
                aria-label="Kolom kondisi {i + 1}">
                {#each columns as c (c)}<option value={c}>{c}</option>{/each}
              </select>
              <select class="op" value={cond.op} onchange={(e) => patch(i, 'op', e.currentTarget.value)}
                aria-label="Operator kondisi {i + 1}">
                {#each OPERATOR_LIST as op (op.id)}<option value={op.id}>{op.label}</option>{/each}
              </select>
              {#if arityOf(cond.op) !== 0}
                <input class="val" type="text" value={cond.value}
                  placeholder={OPERATORS[cond.op]?.hint || 'nilai'}
                  title={OPERATORS[cond.op]?.hint || ''}
                  oninput={(e) => patch(i, 'value', e.currentTarget.value)}
                  aria-label="Nilai kondisi {i + 1}" />
              {:else}
                <span class="val empty">—</span>
              {/if}
              <button class="drop" onclick={() => removeCondition(i)} aria-label="Hapus kondisi {i + 1}">
                <i class="ti ti-x"></i>
              </button>
            </div>
          {/each}

          <div class="cond-actions">
            <button class="add" onclick={addCondition} disabled={conditions.length >= MAX_CONDITIONS}>
              <i class="ti ti-plus"></i> Tambah kondisi
            </button>
            {#if conditions.length >= MAX_CONDITIONS}
              <span class="dim">Maksimal {MAX_CONDITIONS} kondisi.</span>
            {/if}
          </div>

          {#if pending > 0}
            <p class="note"><i class="ti ti-alert-triangle"></i> {pending} kondisi belum diisi nilainya dan akan diabaikan.</p>
          {/if}
        {/if}
      </section>

      <section>
        <h3>Batas baris</h3>
        <div class="limit-row">
          <input class="num" type="number" min="1" max="200000" step="1000" bind:value={limit} aria-label="Maksimal baris" />
          <span class="dim">{rowsHint}</span>
        </div>
        <p class="note subtle">
          <i class="ti ti-info-circle"></i>
          Ekspor berhenti di batas ini dan file menuliskan bahwa isinya terpotong. Maksimum 200.000 baris.
        </p>
      </section>

      <section class="preview">
        <h3>Yang akan diambil</h3>
        <pre class="stmt">SELECT * FROM {table}{summary ? `\nWHERE ${summary}` : ''}{orderBy ? `\nORDER BY ${orderBy} ${dir === 'desc' ? 'DESC' : 'ASC'}` : ''}
LIMIT {Number(limit) || 200000}</pre>
        {#if !summary}
          <p class="note subtle"><i class="ti ti-info-circle"></i> Tanpa filter — seluruh isi tabel, sampai batas di atas.</p>
        {/if}
      </section>
    </div>

    <div class="m-foot">
      <button class="ghost" onclick={() => onclose()}>Batal</button>
      <a class="go" href={url} download onclick={start}>
        <i class="ti ti-download"></i>
        Unduh {format === 'sql' ? '.sql' : format === 'json' ? '.json' : '.csv'}
      </a>
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
    width: min(640px, 100%); max-height: 88vh; display: flex; flex-direction: column;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius); box-shadow: var(--shadow-modal); overflow: hidden;
    animation: rise var(--dur-med) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
  .modal:focus { outline: none; }

  .m-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 12px 14px; border-bottom: 0.5px solid var(--border);
  }
  .m-title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); font-weight: 500; }
  .m-title i { color: var(--accent); }
  .x {
    background: transparent; border: none; color: var(--text-muted);
    cursor: pointer; padding: 2px 4px; border-radius: var(--radius-sm);
  }
  .x:hover { background: var(--surface-3); color: var(--text-primary); }

  .m-body { padding: 14px; overflow-y: auto; display: flex; flex-direction: column; gap: 18px; }
  .m-foot { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 14px; border-top: 0.5px solid var(--border); }

  section { display: flex; flex-direction: column; gap: 8px; }
  h3 {
    margin: 0; font-size: var(--fs-meta); font-weight: 500;
    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em;
    display: flex; align-items: center; gap: 8px;
  }
  .tag {
    text-transform: none; letter-spacing: 0; color: var(--sev-warning);
    border: 0.5px solid var(--border); border-radius: 20px; padding: 1px 7px;
  }

  .formats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
  .fmt {
    display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto;
    gap: 2px 8px; align-items: center; cursor: pointer;
    padding: 9px 11px; border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); background: var(--surface-2);
  }
  .fmt:hover { border-color: var(--border-strong); }
  .fmt.on { border-color: var(--accent); background: var(--surface-3); }
  .fmt input { position: absolute; opacity: 0; pointer-events: none; }
  .fmt i { grid-row: 1 / span 2; font-size: 18px; color: var(--text-muted); }
  .fmt.on i { color: var(--accent); }
  .fname { font-size: var(--fs-sub); color: var(--text-primary); }
  .fdesc { font-size: var(--fs-meta); color: var(--text-muted); line-height: 1.4; }

  .sql-opts { display: flex; flex-direction: column; gap: 4px; }
  .check {
    display: flex; align-items: center; gap: 7px;
    font-size: var(--fs-sub); color: var(--text-secondary); cursor: pointer;
  }

  .cond {
    display: grid; grid-template-columns: 62px minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 1.2fr) auto;
    gap: 6px; align-items: center;
  }
  .joiner { font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-muted); }
  .cond select, .cond input, .num {
    background: var(--surface-2); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text-primary);
    font: inherit; font-size: var(--fs-sub); padding: 4px 7px; min-width: 0; outline: none;
  }
  .cond select:focus, .cond input:focus, .num:focus { border-color: var(--accent); }
  .val.empty { color: var(--text-muted); font-size: var(--fs-meta); padding-left: 4px; }
  .drop {
    background: transparent; border: none; color: var(--text-muted);
    cursor: pointer; padding: 3px 5px; border-radius: var(--radius-sm);
  }
  .drop:hover { background: var(--surface-3); color: var(--sev-critical); }

  .cond-actions { display: flex; align-items: center; gap: 10px; }
  .add {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 0.5px dashed var(--border-strong);
    border-radius: var(--radius-sm); color: var(--text-secondary);
    font-size: var(--fs-meta); padding: 4px 10px; cursor: pointer;
  }
  .add:hover:not(:disabled) { background: var(--surface-3); color: var(--text-primary); }
  .add:disabled { opacity: .45; cursor: default; }

  .limit-row { display: flex; align-items: center; gap: 10px; }
  .num { width: 130px; font-family: var(--mono); }
  .dim { color: var(--text-muted); font-size: var(--fs-meta); }

  .note {
    margin: 0; font-size: var(--fs-meta); line-height: 1.6;
    color: var(--text-secondary); display: flex; gap: 7px; align-items: flex-start;
  }
  .note i { color: var(--sev-warning); flex: 0 0 auto; margin-top: 2px; }
  .note.subtle { color: var(--text-muted); }
  .note.subtle i { color: var(--text-muted); }
  code { font-family: var(--mono); font-size: var(--fs-code); }

  .stmt {
    margin: 0; padding: 10px 12px; max-height: 160px; overflow: auto;
    font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6;
    white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
    background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius-sm);
  }

  .ghost, .go {
    display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sub);
    padding: 6px 12px; border-radius: var(--radius-sm); border: 0.5px solid var(--border);
    cursor: pointer; text-decoration: none;
  }
  .ghost { background: transparent; color: var(--text-secondary); }
  .ghost:hover { background: var(--surface-3); color: var(--text-primary); }
  .go { background: var(--accent); color: #fff; border-color: var(--accent); }
  .go:hover { filter: brightness(1.08); }
</style>
