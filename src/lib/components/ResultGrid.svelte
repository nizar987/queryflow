<script>
  import ExportNameModal from './ExportNameModal.svelte';
  import { defaultExportName } from '$lib/export-name.js';
  import { formatElapsed } from '$lib/duration.js';
  import { cellsToCsv } from '$lib/csv.js';

  let {
    result, oncopy = () => {}, exportingAll = false, onexportall = null,
    /** Words the suggested export filename is built from, e.g. the connection name. */
    exportNameParts = ['query'],
    /** { limit, offset } when the statement pages with its own LIMIT; null hides the pager. */
    pager = null,
    /** (direction: 1 | -1) => void */
    onpage = null
  } = $props();

  const canPrev = $derived(!!pager && pager.offset > 0);
  // A short page is the last one: there is nothing after it to ask for.
  const canNext = $derived(!!pager && result.kind === 'rows' && result.rowCount >= pager.limit);
  const firstRow = $derived(pager ? pager.offset + 1 : 1);
  const pageNo = $derived(pager ? Math.floor(pager.offset / pager.limit) + 1 : 1);

  /** Which download is waiting for a filename: 'loaded' rows or 'all' rows re-run on the server. */
  let pendingExport = $state(null);
  /** Fixed when the dialog opens so the timestamp doesn't tick while the user types. */
  let suggestedName = $state('');

  function askExport(kind) {
    suggestedName = defaultExportName(exportNameParts);
    pendingExport = kind;
  }

  function confirmExport(name) {
    const kind = pendingExport;
    pendingExport = null;
    if (kind === 'all') onexportall?.('csv', name);
    else toCSV(name);
  }

  /** Column index the grid is sorted by, or null for driver order. */
  let sortCol = $state(null);
  let sortDir = $state(1);

  // A new result must not inherit the previous one's sort — the columns differ.
  $effect(() => {
    result;
    sortCol = null;
    sortDir = 1;
  });

  const rows = $derived.by(() => {
    const src = result && result.rows ? result.rows : [];
    if (sortCol === null) return src;
    return [...src].sort((a, b) => cmp(a[sortCol], b[sortCol]) * sortDir);
  });

  function cmp(a, b) {
    const av = a ? a.v : null;
    const bv = b ? b.v : null;
    if (av === null && bv === null) return 0;
    if (av === null) return -1; // NULLs first, like most SQL clients
    if (bv === null) return 1;
    if (typeof av === 'number' && typeof bv === 'number') return av - bv;
    return String(av).localeCompare(String(bv), undefined, { numeric: true });
  }

  function toggleSort(i) {
    if (sortCol === i) sortDir = -sortDir;
    else { sortCol = i; sortDir = 1; }
  }

  /** Tab-separated — pastes straight into a spreadsheet. */
  function copyAll() {
    const head = result.columns.join('\t');
    const body = rows.map((r) => r.map((c) => (c.v === null ? '' : String(c.v))).join('\t')).join('\n');
    oncopy(`${head}\n${body}`, `${rows.length} baris disalin (TSV)`);
  }

  /** Same rules as every server export: BOM for Excel, formulas neutralised. */
  function toCSV(name) {
    const blob = new Blob([cellsToCsv(result.columns, rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

{#if result.kind === 'ack'}
  <div class="ack">
    <i class="ti ti-circle-check"></i>
    <div>
      <strong>{result.command || 'Perintah'} berhasil.</strong>
      <span>
        {#if result.affectedRows != null}{result.affectedRows} baris terpengaruh{:else}Tidak ada baris dikembalikan{/if}
        {#if result.insertId} · insertId {result.insertId}{/if}
        · {formatElapsed(result.durationMs)}
      </span>
      {#if result.info}<span class="info">{result.info}</span>{/if}
    </div>
  </div>
{:else if result.columns.length === 0}
  <div class="ack empty">
    <i class="ti ti-database-off"></i>
    <div><strong>0 baris.</strong><span>Query berhasil tapi tidak mengembalikan data · {formatElapsed(result.durationMs)}</span></div>
  </div>
{:else}
  <div class="grid-head">
    <span class="summary">
      <strong>{result.rowCount.toLocaleString('id-ID')}</strong> baris
      {#if result.truncated}<span class="trunc" title="Naikkan batas baris untuk melihat lebih banyak">· ditampilkan {result.rows.length}</span>{/if}
      · <span class="dur" title="Waktu eksekusi di server"><i class="ti ti-clock"></i> {formatElapsed(result.durationMs)}</span>
      {#if result.command}· {result.command}{/if}
    </span>
    {#if pager && onpage}
      <span class="pager" role="group" aria-label="Halaman hasil">
        <button onclick={() => onpage(-1)} disabled={!canPrev} title="Halaman sebelumnya (OFFSET {Math.max(0, pager.offset - pager.limit)})"
          aria-label="Halaman sebelumnya"><i class="ti ti-chevron-left"></i></button>
        <span class="pg" title="LIMIT {pager.limit} OFFSET {pager.offset}">
          Hal. <strong>{pageNo}</strong> · baris {firstRow.toLocaleString('id-ID')}–{(pager.offset + result.rowCount).toLocaleString('id-ID')}
        </span>
        <button onclick={() => onpage(1)} disabled={!canNext}
          title={canNext ? `Halaman berikutnya (OFFSET ${pager.offset + pager.limit})` : 'Ini halaman terakhir'}
          aria-label="Halaman berikutnya"><i class="ti ti-chevron-right"></i></button>
      </span>
    {/if}
    <span class="tools">
      <button onclick={copyAll} title="Salin semua sebagai TSV"><i class="ti ti-copy"></i> Salin</button>
      <button onclick={() => askExport('loaded')} title="Unduh baris yang dimuat sebagai CSV"><i class="ti ti-file-download"></i> CSV</button>
      {#if result.truncated && onexportall}
        <button
          onclick={() => askExport('all')}
          disabled={exportingAll}
          title="Jalankan ulang query di server tanpa batas baris, lalu unduh semuanya"
        >
          <i class="ti ti-cloud-download"></i> {exportingAll ? 'Mengunduh…' : `Unduh semua (${result.rowCount.toLocaleString('id-ID')})`}
        </button>
      {/if}
    </span>
  </div>

  {#if result.notices && result.notices.length}
    <div class="notices">
      {#each result.notices as n, i (i)}<div><i class="ti ti-info-circle"></i> {n}</div>{/each}
    </div>
  {/if}

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th class="rownum" scope="col">#</th>
          {#each result.columns as c, i (c + i)}
            <th scope="col">
              <button onclick={() => toggleSort(i)} title="Urutkan berdasarkan {c}">
                {c}
                {#if sortCol === i}<i class="ti {sortDir === 1 ? 'ti-arrow-up' : 'ti-arrow-down'}"></i>{/if}
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, ri (ri)}
          <tr>
            <td class="rownum">{firstRow + ri}</td>
            {#each row as cell, ci (ci)}
              <td class="t-{cell.t}" title={cell.v === null ? 'NULL' : String(cell.v)}>
                {#if cell.v === null}<span class="null">NULL</span>{:else}{cell.v}{/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if pendingExport}
  <ExportNameModal
    defaultName={suggestedName}
    title={pendingExport === 'all' ? 'Unduh semua baris ke CSV' : 'Unduh CSV'}
    detail={pendingExport === 'all'
      ? `Query dijalankan ulang di server tanpa batas baris (${result.rowCount.toLocaleString('id-ID')} baris).`
      : `${rows.length.toLocaleString('id-ID')} baris yang sedang dimuat di layar.`}
    onconfirm={confirmExport}
    oncancel={() => (pendingExport = null)} />
{/if}

<style>
  .ack {
    display: flex; gap: 10px; align-items: flex-start; margin: 12px;
    background: var(--wash-success); border: 0.5px solid var(--border);
    border-radius: var(--radius-sm); padding: 12px 14px; font-size: var(--fs-sub);
  }
  .ack i { color: var(--success); font-size: 18px; }
  .ack.empty i { color: var(--text-muted); }
  .ack.empty { background: var(--surface-2); }
  .ack strong { display: block; color: var(--text-primary); margin-bottom: 2px; }
  .ack span { color: var(--text-secondary); display: block; }
  .ack .info { font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-muted); margin-top: 4px; }

  .grid-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 7px 12px; border-bottom: 0.5px solid var(--border);
    font-size: var(--fs-meta); color: var(--text-muted); flex: 0 0 auto; flex-wrap: wrap;
  }
  .summary strong { color: var(--text-primary); }
  .trunc { color: var(--sev-warning); }
  .dur { display: inline-flex; align-items: center; gap: 3px; }
  .pager { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
  .pager .pg { color: var(--text-secondary); white-space: nowrap; }
  .pager .pg strong { color: var(--text-primary); }
  .pager button {
    display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px;
    background: transparent; border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-secondary); cursor: pointer; padding: 0;
  }
  .pager button:hover:not(:disabled) { background: var(--surface-3); color: var(--text-primary); }
  .pager button:disabled { opacity: 0.4; cursor: default; }
  .tools { display: flex; gap: 4px; flex-wrap: wrap; }
  .tools button:disabled { opacity: 0.6; cursor: default; }
  .tools button {
    display: inline-flex; align-items: center; gap: 4px;
    background: transparent; border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-secondary); font-size: var(--fs-meta); padding: 3px 8px;
  }
  .tools button:hover { background: var(--surface-3); color: var(--text-primary); }

  .notices {
    padding: 6px 12px; font-size: var(--fs-meta); color: var(--text-secondary);
    background: var(--wash-warning); border-bottom: 0.5px solid var(--border);
  }
  .notices div { display: flex; gap: 5px; align-items: baseline; }

  .scroll { flex: 1 1 auto; overflow: auto; min-height: 0; }
  table { border-collapse: separate; border-spacing: 0; font-size: var(--fs-code); font-family: var(--mono); width: max-content; min-width: 100%; }
  thead th {
    position: sticky; top: 0; z-index: 2;
    background: var(--surface-2); border-bottom: 0.5px solid var(--border-strong);
    text-align: left; font-weight: 500; padding: 0; white-space: nowrap;
  }
  thead th button {
    display: flex; align-items: center; gap: 4px; width: 100%;
    background: transparent; border: 0; color: var(--text-secondary);
    font: inherit; padding: 7px 10px; text-align: left;
  }
  thead th button:hover { color: var(--text-primary); background: var(--surface-3); }
  td {
    padding: 5px 10px; border-bottom: 0.5px solid var(--border);
    color: var(--text-primary); white-space: nowrap;
    max-width: 420px; overflow: hidden; text-overflow: ellipsis;
  }
  tbody tr:hover td { background: var(--surface-2); }
  .rownum {
    color: var(--text-muted); text-align: right; user-select: none;
    position: sticky; left: 0; background: var(--surface-1); border-right: 0.5px solid var(--border);
    padding: 5px 8px;
  }
  thead .rownum { background: var(--surface-2); z-index: 3; }
  tbody tr:hover .rownum { background: var(--surface-2); }
  .null { color: var(--text-muted); font-style: italic; }
  .t-number { color: var(--c-purple); text-align: right; }
  .t-date { color: var(--c-teal); }
  .t-boolean { color: var(--c-blue); }
  .t-id { color: var(--c-coral); }
  .t-json { color: var(--text-secondary); }
  .t-binary { color: var(--text-muted); }
</style>
