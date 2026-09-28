<script>
  // Job browser for a single queue. Paged on the server — a failed registry can
  // hold hundreds of thousands of ids, so "load everything" is only ever the
  // export path, which streams straight to a file.
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';
  import * as api from '$lib/api.js';

  let {
    connectionId,
    system,
    queue,
    stateLabels = {},
    onclose = () => {}
  } = $props();

  const PAGE = 50;

  let states = $state([]);
  let jobState = $state('waiting');
  let offset = $state(0);
  let jobs = $state([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state('');
  let expanded = $state(null);

  // Reload whenever the queue, state, or page changes. The fetch writes only
  // `jobs`/`total`/`loading`, none of which are read here, so it settles.
  $effect(() => {
    const args = { connectionId, system, queue, state: jobState, offset };
    let cancelled = false;
    loading = true;
    api.fetchQueueJobs(connectionId, { ...args, limit: PAGE }).then((r) => {
      if (cancelled) return;
      loading = false;
      if (r.ok) {
        jobs = r.jobs;
        total = r.total;
        states = r.states || [];
        error = '';
      } else {
        error = r.error || 'Gagal membaca job.';
        jobs = [];
        total = 0;
      }
    });
    return () => (cancelled = true);
  });

  $effect(() => lockScroll());

  function pick(next) {
    jobState = next;
    offset = 0;
    expanded = null;
  }

  const from = $derived(total === 0 ? 0 : offset + 1);
  const to = $derived(Math.min(offset + jobs.length, total));

  function exportUrl(format) {
    return api.queueExportUrl(connectionId, { kind: 'jobs', system, queue, state: jobState, format });
  }

  function short(v) {
    if (!v) return '—';
    return String(v).replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
  }
  function secs(v) {
    if (v == null) return '—';
    if (v < 60) return `${v}s`;
    if (v < 3600) return `${Math.floor(v / 60)}m ${v % 60}s`;
    return `${Math.floor(v / 3600)}j ${Math.floor((v % 3600) / 60)}m`;
  }
</script>

<div class="overlay" role="presentation">
  <div class="panel" use:dismissable={onclose} use:focusTrap role="dialog" aria-modal="true"
    aria-label={`Job pada antrian ${queue}`} tabindex="-1">
    <div class="p-head">
      <div class="p-title">
        <i class="ti ti-list-search"></i>
        <span class="q">{queue}</span>
        <span class="sys">{system}</span>
      </div>
      <div class="p-tools">
        <a class="btn" href={exportUrl('csv')} download title="Unduh semua job pada status ini sebagai CSV">
          <i class="ti ti-file-spreadsheet"></i> CSV
        </a>
        <a class="btn" href={exportUrl('json')} download title="Unduh semua job pada status ini sebagai JSON">
          <i class="ti ti-file-code-2"></i> JSON
        </a>
        <button class="x" onclick={() => onclose()} aria-label="Tutup (Esc)"><i class="ti ti-x"></i></button>
      </div>
    </div>

    <div class="tabs" role="tablist" aria-label="Status job">
      {#each states as s (s)}
        <button role="tab" aria-selected={s === jobState} class:active={s === jobState} onclick={() => pick(s)}>
          {stateLabels[s] || s}
        </button>
      {/each}
    </div>

    <div class="p-body">
      {#if error}
        <p class="err"><i class="ti ti-alert-octagon"></i> {error}</p>
      {:else if loading && jobs.length === 0}
        <p class="muted"><i class="ti ti-loader-2 spin"></i> Memuat job…</p>
      {:else if jobs.length === 0}
        <p class="muted">Tidak ada job pada status <strong>{stateLabels[jobState] || jobState}</strong>.</p>
      {:else}
        <table>
          <thead>
            <tr>
              <th scope="col">Job</th>
              <th scope="col">Masuk</th>
              <th scope="col" class="num">Tunggu</th>
              <th scope="col" class="num">Durasi</th>
              <th scope="col">Worker</th>
              <th scope="col" class="num">Coba</th>
            </tr>
          </thead>
          <tbody>
            {#each jobs as j (j.id)}
              <tr class:failed={!!j.error} onclick={() => (expanded = expanded === j.id ? null : j.id)}>
                <td class="j">
                  <span class="j-name">{j.name || j.description || j.id}</span>
                  <span class="j-id mono">{j.id}</span>
                  {#if j.missing}<span class="tag">hash hilang</span>{/if}
                </td>
                <td class="mono dim">{short(j.enqueuedAt || j.createdAt)}</td>
                <td class="num">{secs(j.waitSec)}</td>
                <td class="num">{secs(j.durationSec)}</td>
                <td class="mono dim">{j.worker || '—'}</td>
                <td class="num">{j.attempts == null ? '—' : j.attempts}</td>
              </tr>
              {#if expanded === j.id}
                <tr class="detail">
                  <td colspan="6">
                    {#if j.description}<pre class="payload">{j.description}</pre>{/if}
                    {#if j.error}<pre class="fail">{j.error}</pre>{/if}
                    <div class="times">
                      <span>Dibuat: <b>{short(j.createdAt)}</b></span>
                      <span>Mulai: <b>{short(j.startedAt)}</b></span>
                      <span>Selesai: <b>{short(j.endedAt)}</b></span>
                      {#if j.timeoutSec}<span>Timeout: <b>{secs(j.timeoutSec)}</b></span>{/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <div class="p-foot">
      <span class="count">
        {#if total}{from.toLocaleString('id-ID')}–{to.toLocaleString('id-ID')} dari {total.toLocaleString('id-ID')}{:else}0 job{/if}
        {#if loading}<i class="ti ti-loader-2 spin"></i>{/if}
      </span>
      <span class="pager">
        <button class="btn" disabled={offset === 0 || loading} onclick={() => (offset = Math.max(0, offset - PAGE))}>
          <i class="ti ti-chevron-left"></i> Sebelumnya
        </button>
        <button class="btn" disabled={to >= total || loading} onclick={() => (offset = offset + PAGE)}>
          Berikutnya <i class="ti ti-chevron-right"></i>
        </button>
      </span>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 200; background: var(--scrim);
    display: flex; align-items: flex-end; justify-content: center;
    animation: fade var(--dur-med) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } }
  .panel {
    width: min(1100px, 100%); height: min(78vh, 100%); display: flex; flex-direction: column;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius) var(--radius) 0 0; box-shadow: var(--shadow-modal); overflow: hidden;
    animation: rise var(--dur-med) var(--ease);
  }
  @keyframes rise { from { transform: translateY(16px); opacity: 0; } }
  .panel:focus { outline: none; }

  .p-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 10px 12px; border-bottom: 0.5px solid var(--border);
  }
  .p-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .p-title .q { font-size: var(--fs-label); font-weight: 500; color: var(--text-primary); word-break: break-all; }
  .p-title .sys {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent);
    border: 0.5px solid var(--accent-line); border-radius: 20px; padding: 1px 6px;
  }
  .p-tools { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .btn {
    display: inline-flex; align-items: center; gap: 5px; text-decoration: none;
    background: transparent; border: 0.5px solid var(--border); color: var(--text-secondary);
    font-size: var(--fs-sub); padding: 4px 9px; border-radius: var(--radius-sm);
  }
  .btn:not(:disabled):hover { background: var(--surface-3); color: var(--text-primary); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .x { background: transparent; border: 0; color: var(--text-secondary); font-size: 16px; }
  .x:hover { color: var(--text-primary); }

  .tabs { display: flex; gap: 2px; padding: 6px 12px; border-bottom: 0.5px solid var(--border); flex-wrap: wrap; }
  .tabs button {
    background: transparent; border: 0.5px solid transparent; color: var(--text-muted);
    font-size: var(--fs-meta); padding: 4px 10px; border-radius: 20px;
  }
  .tabs button:hover { color: var(--text-primary); background: var(--surface-3); }
  .tabs button.active { color: var(--accent); border-color: var(--accent-line); background: var(--surface-2); }

  .p-body { flex: 1 1 auto; overflow: auto; min-height: 0; }
  table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: var(--fs-sub); }
  thead th {
    position: sticky; top: 0; z-index: 2; background: var(--surface-2); text-align: left;
    border-bottom: 0.5px solid var(--border-strong); font-weight: 500;
    padding: 7px 10px; color: var(--text-secondary); white-space: nowrap;
  }
  thead th.num { text-align: right; }
  td { padding: 6px 10px; border-bottom: 0.5px solid var(--border); white-space: nowrap; }
  td.num { text-align: right; font-family: var(--mono); }
  td.mono { font-family: var(--mono); }
  td.dim { color: var(--text-muted); }
  tbody tr:hover td { background: var(--surface-2); cursor: pointer; }
  tbody tr.failed td { background: var(--wash-critical); }
  td.j { white-space: normal; }
  .j-name { color: var(--text-primary); }
  .j-id { color: var(--text-muted); font-size: var(--fs-meta); margin-left: 8px; }
  .tag {
    font-size: 10px; color: var(--sev-warning); border: 0.5px solid var(--sev-warning);
    border-radius: 20px; padding: 0 6px; margin-left: 6px;
  }
  tr.detail td { background: var(--surface-2); white-space: normal; }
  .payload, .fail {
    margin: 0 0 6px; font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6;
    white-space: pre-wrap; word-break: break-word; padding: 8px 10px;
    border-radius: var(--radius-sm); border: 0.5px solid var(--border); background: var(--surface-1);
  }
  .fail { color: var(--sev-critical); background: var(--wash-critical); border-color: var(--wash-critical-line); }
  .times { display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--fs-meta); color: var(--text-muted); }
  .times b { color: var(--text-secondary); font-weight: 500; font-family: var(--mono); }

  .p-foot {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 12px; border-top: 0.5px solid var(--border); background: var(--surface-1);
  }
  .count { font-size: var(--fs-meta); color: var(--text-muted); display: inline-flex; gap: 6px; align-items: center; }
  .pager { display: flex; gap: 6px; }
  .err { color: var(--sev-critical); font-size: var(--fs-sub); display: flex; gap: 6px; padding: 16px; }
  .muted { color: var(--text-muted); font-size: var(--fs-sub); display: flex; gap: 6px; align-items: center; padding: 24px; justify-content: center; }
  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
