<script>
  import IssueCard from './IssueCard.svelte';
  let { node, usages = [], findings = [], glossaryByName = {}, onfindingselect = () => {} } = $props();
</script>

{#if node}
  <div class="detail">
    <div class="node-head">
      <span class="cat cat-{node.category}"></span>
      <span class="stage">{node.title}</span>
    </div>

    <div class="snippet">
      <span class="lbl">SQL</span>
      <code>{node.sql || node.subtitle}</code>
    </div>

    {#if node.correlated && node.correlatedCols?.length}
      <div class="corr">
        <i class="ti ti-arrow-loop-right"></i>
        Mereferensikan kolom luar: <strong>{node.correlatedCols.join(', ')}</strong> (correlated)
      </div>
    {/if}

    {#if findings.length}
      <div class="section-label">Temuan pada node ini</div>
      <div class="findings">
        {#each findings as f (f.id)}
          <IssueCard finding={f} onselect={onfindingselect} />
        {/each}
      </div>
    {/if}

    {#if usages.length}
      <div class="section-label">Fungsi & klausa di node ini</div>
      <div class="usages">
        {#each usages as u (u.signature + node.id)}
          <div class="usage">
            <div class="u-head">
              <span class="u-name">{u.name}</span>
              {#if !u.isFirst}<span class="u-ref">lihat glosarium ↗</span>{/if}
            </div>
            {#if u.isFirst && glossaryByName[u.signature]}
              <p class="u-text">{glossaryByName[u.signature]}</p>
            {/if}
            {#if u.context}<p class="u-ctx">{u.context}</p>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <div class="empty">
    <i class="ti ti-pointer"></i>
    <p>Klik node pada diagram untuk melihat detail & penjelasan kontekstual.</p>
  </div>
{/if}

<style>
  .detail { display: flex; flex-direction: column; gap: 12px; }
  .node-head { display: flex; align-items: center; gap: 8px; }
  .cat { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .cat-gray { background: var(--c-gray); }
  .cat-blue { background: var(--c-blue); }
  .cat-coral { background: var(--c-coral); }
  .cat-purple { background: var(--c-purple); }
  .cat-teal { background: var(--c-teal); }
  .stage { font-size: var(--fs-label); font-weight: 500; }
  .snippet .lbl, .section-label {
    font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .snippet code {
    display: block; margin-top: 4px; font-family: var(--mono); font-size: var(--fs-code);
    background: var(--surface-0); border: 0.5px solid var(--border); border-radius: 3px;
    padding: 7px 9px; white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
  }
  .corr {
    font-size: var(--fs-sub); color: var(--c-coral);
    background: rgba(232,128,107,0.08); border: 0.5px solid rgba(232,128,107,0.3);
    border-radius: var(--radius-sm); padding: 6px 9px; display: flex; gap: 6px; align-items: baseline;
  }
  .corr strong { font-family: var(--mono); }
  .section-label { margin-top: 2px; }
  .findings { display: flex; flex-direction: column; gap: 7px; margin-top: 6px; }
  .usages { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
  .usage { border: 0.5px solid var(--border); border-radius: var(--radius-sm); padding: 7px 9px; background: var(--surface-1); }
  .u-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .u-name { font-family: var(--mono); font-size: var(--fs-sub); color: var(--c-teal); }
  .u-ref { font-size: var(--fs-meta); color: var(--text-muted); }
  .u-text { margin: 5px 0 0; font-size: var(--fs-sub); line-height: 1.6; color: var(--text-secondary); }
  .u-ctx { margin: 4px 0 0; font-size: var(--fs-meta); font-family: var(--mono); color: var(--text-muted); }
  .empty { color: var(--text-muted); text-align: center; padding: 40px 20px; font-size: var(--fs-sub); }
  .empty i { font-size: 22px; display: block; margin-bottom: 8px; }
</style>
