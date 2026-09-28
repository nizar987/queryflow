<script>
  // How a statement ended when it did not return a result. A cancel or a
  // time-out is the user's (or the profile's) decision, not a fault, so it is
  // not painted red; a real error is, with the engine's message copyable.
  import { formatElapsed } from '$lib/duration.js';

  let {
    message,
    /** 'QUERY_CANCELLED' | 'QUERY_TIMEOUT' | null */
    code = null,
    /** ms the attempt took, when known */
    took = null,
    oncopy = () => {},
    onconnections = () => {}
  } = $props();
</script>

{#if code}
  <div class="state stopped" class:timeout={code === 'QUERY_TIMEOUT'} role="status">
    <i class="ti {code === 'QUERY_TIMEOUT' ? 'ti-hourglass-off' : 'ti-player-stop'}"></i>
    <div>
      <strong>{code === 'QUERY_TIMEOUT' ? 'Batas waktu terlampaui' : 'Query dibatalkan'}</strong>
      <p>{message}</p>
      {#if code === 'QUERY_TIMEOUT'}
        <button class="link" onclick={() => onconnections()}><i class="ti ti-settings"></i> Ubah batas waktu</button>
      {/if}
    </div>
  </div>
{:else}
  <div class="state error" role="alert">
    <i class="ti ti-alert-octagon"></i>
    <div>
      <strong>Query gagal{#if took != null}<span class="took"> · setelah {formatElapsed(took)}</span>{/if}</strong>
      <pre>{message}</pre>
      <button class="link" onclick={() => oncopy(message, 'Pesan error disalin')}><i class="ti ti-copy"></i> Salin pesan</button>
    </div>
  </div>
{/if}

<style>
  .state {
    flex: 1 1 auto; display: flex; align-items: flex-start; justify-content: flex-start;
    gap: 10px; color: var(--text-secondary); font-size: var(--fs-sub); padding: 16px;
  }
  .state > i { font-size: 18px; margin-top: 1px; }
  .state > div { min-width: 0; flex: 1 1 auto; }

  .error > i { color: var(--sev-critical); }
  .error strong { display: block; color: var(--sev-critical); margin-bottom: 5px; }
  .error pre {
    margin: 0; font-family: var(--mono); font-size: var(--fs-code); line-height: 1.6;
    white-space: pre-wrap; word-break: break-word; color: var(--text-primary);
    background: var(--wash-critical); border: 0.5px solid var(--wash-critical-line);
    border-radius: var(--radius-sm); padding: 10px 12px;
  }
  .took { font-weight: 400; color: var(--text-muted); font-size: var(--fs-meta); }

  .stopped > i { color: var(--text-secondary); }
  .stopped.timeout > i, .stopped.timeout strong { color: var(--sev-warning); }
  .stopped strong { display: block; color: var(--text-primary); margin-bottom: 4px; }
  .stopped p { margin: 0 0 6px; color: var(--text-secondary); line-height: 1.5; }

  .link {
    background: transparent; border: 0; padding: 4px 0 0; color: var(--text-muted); cursor: pointer;
    font-size: var(--fs-meta); display: inline-flex; align-items: center; gap: 4px;
  }
  .link:hover { color: var(--accent); }
</style>
