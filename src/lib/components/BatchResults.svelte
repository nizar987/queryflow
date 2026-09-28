<script>
  // The outcome of a script: one tab per statement, in the order they ran.
  // The server stops at the first failure, so later tabs say they were never
  // run rather than pretending to be empty results.
  import ResultGrid from './ResultGrid.svelte';
  import QueryFailure from './QueryFailure.svelte';
  import { formatElapsed } from '$lib/duration.js';
  import { readPaging } from '$lib/paging.js';

  let {
    /** [{ index, statement, status: 'ok'|'error'|'skipped', result?, error?, code? }] */
    results,
    tab = $bindable(0),
    oncopy = () => {},
    exportingAll = false,
    /** (format, filename, statement) — exports one statement's full result */
    onexportall = null,
    exportNameParts = ['query'],
    onconnections = () => {},
    dialect = '',
    /** (tabIndex, direction) — re-run one tab's statement at the next/previous page */
    onpage = null
  } = $props();

  const current = $derived(results[Math.min(tab, results.length - 1)]);
  const pager = $derived(onpage && current.status === 'ok' ? readPaging(dialect, current.statement) : null);
  const counts = $derived({
    ok: results.filter((x) => x.status === 'ok').length,
    failed: results.filter((x) => x.status === 'error').length,
    skipped: results.filter((x) => x.status === 'skipped').length
  });
  const totalMs = $derived(
    results.reduce((sum, x) => sum + (x.result && typeof x.result.durationMs === 'number' ? x.result.durationMs : 0), 0)
  );
  const stoppedBy = $derived(results.find((x) => x.status === 'error'));

  /** @type {HTMLElement[]} */
  let tabEls = $state([]);

  function label(item) {
    if (item.status === 'skipped') return 'Tidak dijalankan';
    if (item.status === 'error') {
      return item.code === 'QUERY_TIMEOUT' ? 'Timeout' : item.code === 'QUERY_CANCELLED' ? 'Dibatalkan' : 'Gagal';
    }
    const r = item.result;
    const cmd = r.command || (r.kind === 'rows' ? 'Hasil' : 'OK');
    if (r.kind === 'rows') return `${cmd} · ${r.rowCount.toLocaleString('id-ID')} baris`;
    return r.affectedRows != null ? `${cmd} · ${r.affectedRows.toLocaleString('id-ID')} terpengaruh` : cmd;
  }

  function icon(item) {
    if (item.status === 'skipped') return 'ti-circle-dashed';
    if (item.status === 'error') return item.code ? 'ti-player-stop' : 'ti-circle-x';
    return item.result.kind === 'rows' ? 'ti-table' : 'ti-circle-check';
  }

  /** Arrow keys move between tabs, as a tablist should. */
  function onTabKey(e) {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    tab = (tab + step + results.length) % results.length;
    tabEls[tab]?.focus();
  }

  const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
</script>

<div class="batch">
  <div class="b-head">
    <span class="b-sum">
      <strong>{results.length}</strong> statement ·
      <span class="ok">{counts.ok} berhasil</span>
      {#if counts.failed}· <span class="bad">{counts.failed} {stoppedBy && stoppedBy.code ? 'dihentikan' : 'gagal'}</span>{/if}
      {#if counts.skipped}· {counts.skipped} tidak dijalankan{/if}
      · <span class="dur" title="Jumlah waktu eksekusi di server"><i class="ti ti-clock"></i> {formatElapsed(totalMs)}</span>
    </span>
    {#if stoppedBy}
      <span class="b-note" title="Semua statement berjalan di satu koneksi yang ditutup setelah selesai">
        <i class="ti ti-info-circle"></i>
        Berhenti di statement {stoppedBy.index + 1}. Transaksi yang belum di-COMMIT sudah di-rollback.
      </span>
    {/if}
  </div>

  <div class="tabs" role="tablist" aria-label="Hasil per statement" tabindex="-1" onkeydown={onTabKey}>
    {#each results as item, i (item.index)}
      <button bind:this={tabEls[i]} role="tab" class="tab {item.status}" class:stop={!!item.code}
        aria-selected={i === tab} tabindex={i === tab ? 0 : -1}
        title={oneLine(item.statement).slice(0, 300)} onclick={() => (tab = i)}>
        <i class="ti {icon(item)}"></i>
        <span class="n">{i + 1}</span>
        <span class="l">{label(item)}</span>
      </button>
    {/each}
  </div>

  <div class="stmt" title={item_title(current)}>
    <code>{oneLine(current.statement)}</code>
    <button class="copy" onclick={() => oncopy(current.statement, 'Statement disalin')} title="Salin statement ini">
      <i class="ti ti-copy"></i>
    </button>
  </div>

  <div class="body" role="tabpanel">
    {#if current.status === 'ok'}
      <ResultGrid result={current.result} {oncopy} {exportingAll} {exportNameParts} {pager}
        onpage={onpage ? (dir) => onpage(tab, dir) : null}
        onexportall={onexportall ? (format, name) => onexportall(format, name, current.statement) : null} />
    {:else if current.status === 'error'}
      <QueryFailure message={current.error} code={current.code} {oncopy} {onconnections} />
    {:else}
      <div class="skip-msg">
        <i class="ti ti-circle-dashed"></i>
        <p>
          Tidak dijalankan — statement {stoppedBy ? stoppedBy.index + 1 : 'sebelumnya'}
          {stoppedBy && stoppedBy.code ? 'dihentikan' : 'gagal'}, dan script berhenti di kegagalan pertama.
        </p>
      </div>
    {/if}
  </div>
</div>

<script module>
  /** The full statement, capped so a huge script does not become a huge tooltip. */
  function item_title(item) {
    return item.statement.length > 2000 ? item.statement.slice(0, 2000) + '…' : item.statement;
  }
</script>

<style>
  .batch { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }

  .b-head {
    display: flex; align-items: center; justify-content: space-between; gap: 6px 12px; flex-wrap: wrap;
    padding: 7px 12px; font-size: var(--fs-meta); color: var(--text-muted);
    border-bottom: 0.5px solid var(--border); flex: 0 0 auto;
  }
  .b-sum strong { color: var(--text-primary); }
  .ok { color: var(--success); }
  .bad { color: var(--sev-critical); }
  .dur { display: inline-flex; align-items: center; gap: 3px; }
  .b-note { display: inline-flex; align-items: center; gap: 4px; color: var(--text-secondary); }

  .tabs {
    display: flex; gap: 2px; padding: 6px 8px 0; overflow-x: auto; flex: 0 0 auto;
    border-bottom: 0.5px solid var(--border); scrollbar-width: thin;
  }
  .tabs:focus { outline: none; }
  .tab {
    display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; max-width: 240px;
    padding: 5px 10px; font-size: var(--fs-meta); cursor: pointer;
    background: transparent; color: var(--text-secondary);
    border: 0.5px solid transparent; border-bottom: 0; border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    margin-bottom: -0.5px;
  }
  .tab:hover { background: var(--surface-3); color: var(--text-primary); }
  .tab[aria-selected='true'] {
    background: var(--surface-1); color: var(--text-primary);
    border-color: var(--border); border-bottom: 0.5px solid var(--surface-1);
  }
  .tab .n { font-family: var(--mono); color: var(--text-muted); }
  .tab .l { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab.ok i { color: var(--success); }
  .tab.error i { color: var(--sev-critical); }
  .tab.error.stop i { color: var(--sev-warning); }
  .tab.skipped { opacity: 0.6; }

  .stmt {
    display: flex; align-items: center; gap: 6px; padding: 5px 12px; flex: 0 0 auto;
    background: var(--surface-2); border-bottom: 0.5px solid var(--border);
  }
  .stmt code {
    flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-secondary);
  }
  .copy {
    flex: 0 0 auto; display: inline-flex; background: transparent; border: 0; cursor: pointer;
    color: var(--text-muted); padding: 2px 4px; border-radius: var(--radius-sm);
  }
  .copy:hover { background: var(--surface-3); color: var(--text-primary); }

  .body { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
  .skip-msg {
    flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 24px; color: var(--text-muted); font-size: var(--fs-sub); text-align: center;
  }
  .skip-msg i { font-size: 26px; opacity: 0.5; }
  .skip-msg p { margin: 0; max-width: 460px; line-height: 1.5; }
</style>
