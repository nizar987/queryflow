<script>
  let { finding, active = false, onselect = () => {}, oncopy = null } = $props();

  const SEV_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info' };
  const SEV_ICON = { critical: 'ti-alert-triangle-filled', warning: 'ti-alert-circle', info: 'ti-info-circle' };

  let copied = $state(false);
  function copyFix(e) {
    e.stopPropagation();
    oncopy?.(finding.after);
    copied = true;
    setTimeout(() => (copied = false), 1400);
  }
</script>

<div
  class="card sev-{finding.severity}"
  class:active
  onclick={() => onselect(finding)}
  role="button"
  tabindex="0"
  aria-pressed={active}
  aria-label={`${SEV_LABEL[finding.severity]}: ${finding.title}`}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onselect(finding); } }}
>
  <div class="head">
    <i class="ti {SEV_ICON[finding.severity]} sev-ic"></i>
    <span class="sev-label">{SEV_LABEL[finding.severity]}</span>
    <span class="dot">·</span>
    <span class="title">{finding.title}</span>
    {#if finding.nodeId}<i class="ti ti-target-arrow jump" title="Sorot node terkait di diagram"></i>{/if}
  </div>
  <p class="why">{finding.why}</p>
  {#if finding.before || finding.after}
    <div class="fix">
      {#if finding.before}
        <div class="row">
          <!-- Without a rewrite to compare against, "sebelum" is meaningless —
               the snippet is just the part of the query being pointed at. -->
          <span class="tag">{finding.after ? 'sebelum' : 'di query kamu'}</span>
          <code>{finding.before}</code>
        </div>
      {/if}
      {#if finding.after}
        <div class="row">
          <span class="tag">
            sesudah
            {#if oncopy}
              <button class="copy" onclick={copyFix} title="Salin perbaikan">
                <i class="ti {copied ? 'ti-check' : 'ti-copy'}"></i>{copied ? 'Tersalin' : 'Salin'}
              </button>
            {/if}
          </span>
          <code class="after">{finding.after}</code>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .card {
    border: 0.5px solid var(--border);
    border-left-width: 2px;
    border-radius: var(--radius-sm);
    padding: 9px 11px;
    background: var(--surface-1);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
  }
  .card:hover { background: var(--surface-2); }
  .card.active { background: var(--surface-2); box-shadow: inset 0 0 0 0.5px var(--border-strong); }
  .sev-critical { border-left-color: var(--sev-critical); }
  .sev-warning { border-left-color: var(--sev-warning); }
  .sev-info { border-left-color: var(--sev-info); }
  .head { display: flex; align-items: center; gap: 5px; font-size: var(--fs-body); flex-wrap: wrap; }
  .sev-ic { font-size: 13px; }
  .sev-critical .sev-ic { color: var(--sev-critical); }
  .sev-warning .sev-ic { color: var(--sev-warning); }
  .sev-info .sev-ic { color: var(--sev-info); }
  .sev-label { font-weight: 600; }
  .sev-critical .sev-label { color: var(--sev-critical); }
  .sev-warning .sev-label { color: var(--sev-warning); }
  .sev-info .sev-label { color: var(--text-secondary); }
  .dot { color: var(--text-muted); }
  .title { color: var(--text-primary); }
  .jump { margin-left: auto; color: var(--text-muted); font-size: 13px; opacity: 0; transition: opacity var(--dur-fast) var(--ease); }
  .card:hover .jump { opacity: 1; }
  .why { margin: 7px 0 0; font-size: var(--fs-sub); line-height: 1.6; color: var(--text-secondary); }
  .fix { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .row code {
    display: block; font-family: var(--mono); font-size: var(--fs-code);
    background: var(--surface-0); border: 0.5px solid var(--border);
    border-radius: 3px; padding: 5px 7px; white-space: pre-wrap; word-break: break-word;
    color: var(--text-secondary);
  }
  /* The suggested rewrite is the payload of the card — tint it so the eye lands there. */
  .row code.after { color: var(--success); background: var(--wash-success); border-color: transparent; }
  .tag {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 3px;
  }
  .copy {
    display: inline-flex; align-items: center; gap: 4px;
    background: transparent; border: 0; padding: 0;
    color: var(--text-muted); font-size: var(--fs-meta); text-transform: none; letter-spacing: 0;
  }
  .copy:hover { color: var(--accent); }
</style>
