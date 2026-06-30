<script>
  let { finding, active = false, onselect = () => {} } = $props();

  const SEV_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info' };
  const SEV_ICON = { critical: 'ti-alert-triangle-filled', warning: 'ti-alert-circle', info: 'ti-info-circle' };
</script>

<div class="card sev-{finding.severity}" class:active onclick={() => onselect(finding)} role="button" tabindex="0"
  onkeydown={(e) => e.key === 'Enter' && onselect(finding)}>
  <div class="head">
    <i class="ti {SEV_ICON[finding.severity]} sev-ic"></i>
    <span class="sev-label">{SEV_LABEL[finding.severity]}</span>
    <span class="dot">·</span>
    <span class="title">{finding.title}</span>
  </div>
  <p class="why">{finding.why}</p>
  {#if finding.before || finding.after}
    <div class="fix">
      {#if finding.before}<div class="before"><span class="tag">sebelum</span><code>{finding.before}</code></div>{/if}
      {#if finding.after}<div class="after"><span class="tag">sesudah</span><code>{finding.after}</code></div>{/if}
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
    transition: background 0.12s;
  }
  .card:hover { background: var(--surface-2); }
  .card.active { background: var(--surface-2); box-shadow: inset 0 0 0 0.5px var(--border-strong); }
  .sev-critical { border-left-color: var(--sev-critical); }
  .sev-warning { border-left-color: var(--sev-warning); }
  .sev-info { border-left-color: var(--sev-info); }
  .head { display: flex; align-items: center; gap: 5px; font-size: var(--fs-body); }
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
  .why { margin: 7px 0 0; font-size: var(--fs-sub); line-height: 1.6; color: var(--text-secondary); }
  .fix { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
  .before code, .after code {
    display: block; font-family: var(--mono); font-size: var(--fs-code);
    background: var(--surface-0); border: 0.5px solid var(--border);
    border-radius: 3px; padding: 5px 7px; white-space: pre-wrap; word-break: break-word;
  }
  .before code { color: var(--text-secondary); }
  .after code { color: var(--success); }
  .tag { font-size: var(--fs-meta); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; display: block; margin-bottom: 2px; }
</style>
