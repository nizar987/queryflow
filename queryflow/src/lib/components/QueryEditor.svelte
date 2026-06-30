<script>
  import { highlightSQL } from './sql-highlight.js';
  import { highlightMongo } from './mongo-highlight.js';

  let {
    value = $bindable(''),
    onanalyze = () => {},
    loading = false,
    engine = 'sql',
    placeholder = ''
  } = $props();

  let taEl = $state(null);
  let highlightEl = $state(null);
  let gutterEl = $state(null);
  let dragOver = $state(false);

  const lineCount = $derived(Math.max(1, value.split('\n').length));
  const highlighted = $derived((engine === 'mongo' ? highlightMongo(value) : highlightSQL(value)) + '\n');

  function syncScroll() {
    if (highlightEl && taEl) {
      highlightEl.scrollTop = taEl.scrollTop;
      highlightEl.scrollLeft = taEl.scrollLeft;
    }
    if (gutterEl && taEl) gutterEl.scrollTop = taEl.scrollTop;
  }

  function onKeydown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = taEl.selectionStart, en = taEl.selectionEnd;
      value = value.slice(0, s) + '  ' + value.slice(en);
      requestAnimationFrame(() => { taEl.selectionStart = taEl.selectionEnd = s + 2; });
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onanalyze();
    }
  }

  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => { value = String(reader.result || ''); };
    reader.readAsText(file);
  }
  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (file) readFile(file);
    e.target.value = '';
  }
  function onDrop(e) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  }
</script>

<div class="editor-wrap" class:drag={dragOver}
  ondragover={(e) => { e.preventDefault(); dragOver = true; }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDrop}
  role="group"
>
  <div class="editor-box">
    <div class="gutter" bind:this={gutterEl} aria-hidden="true">
      {#each Array(lineCount) as _, i}
        <div class="ln">{i + 1}</div>
      {/each}
    </div>
    <div class="code-area">
      <pre class="highlight" bind:this={highlightEl} aria-hidden="true"><code>{@html highlighted}</code></pre>
      <textarea
        bind:this={taEl}
        bind:value
        onscroll={syncScroll}
        onkeydown={onKeydown}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        placeholder={placeholder || "-- Tempel query SQL di sini lalu klik Analisa"}
      ></textarea>
    </div>
  </div>

  <div class="editor-foot">
    <label class="file-btn">
      <i class="ti ti-upload"></i> Upload .sql
      <input type="file" accept=".sql,text/plain" onchange={onFile} hidden />
    </label>
    <span class="hint">atau drag-drop file · ⌘/Ctrl+Enter untuk analisa</span>
    <button class="analyze" onclick={onanalyze} disabled={loading}>
      {#if loading}
        <i class="ti ti-loader-2 spin"></i> Menganalisa…
      {:else}
        <i class="ti ti-player-play-filled"></i> Analisa
      {/if}
    </button>
  </div>
</div>

<style>
  .editor-wrap {
    background: var(--surface-1);
    border: 0.5px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .editor-wrap.drag {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .editor-box {
    display: flex;
    background: var(--surface-2);
    max-height: 240px;
    min-height: 150px;
    overflow: hidden;
  }
  .gutter {
    flex: 0 0 auto;
    padding: 10px 8px 10px 12px;
    text-align: right;
    color: var(--text-muted);
    font-family: var(--mono);
    font-size: var(--fs-code);
    line-height: 1.55;
    user-select: none;
    overflow: hidden;
    border-right: 0.5px solid var(--border);
    background: var(--surface-1);
  }
  .ln { height: calc(var(--fs-code) * 1.55); }
  .code-area {
    position: relative;
    flex: 1 1 auto;
    overflow: hidden;
  }
  .highlight,
  textarea {
    margin: 0;
    padding: 10px 12px;
    font-family: var(--mono);
    font-size: var(--fs-code);
    line-height: 1.55;
    white-space: pre;
    tab-size: 2;
    border: 0;
    width: 100%;
    height: 100%;
    box-sizing: border-box;
  }
  .highlight {
    position: absolute;
    inset: 0;
    overflow: auto;
    pointer-events: none;
    color: var(--text-primary);
  }
  .highlight code { font: inherit; }
  textarea {
    position: relative;
    background: transparent;
    color: transparent;
    caret-color: var(--accent);
    resize: none;
    outline: none;
    overflow: auto;
  }
  textarea::placeholder { color: var(--text-muted); }
  .editor-foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-top: 0.5px solid var(--border);
  }
  .file-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-sub);
    color: var(--text-secondary);
    cursor: pointer;
    padding: 3px 8px;
    border: 0.5px solid var(--border);
    border-radius: var(--radius-sm);
  }
  .file-btn:hover { background: var(--surface-3); }
  .hint { font-size: var(--fs-meta); color: var(--text-muted); flex: 1; }
  .analyze {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    color: #fff;
    border: 0;
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-body);
    font-weight: 500;
  }
  .analyze:disabled { opacity: 0.7; cursor: default; }
  .analyze:not(:disabled):hover { filter: brightness(1.08); }
  .spin { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  :global(.tk-kw) { color: var(--accent); font-weight: 500; }
  :global(.tk-fn) { color: var(--c-teal); }
  :global(.tk-risky) { color: var(--c-coral); text-decoration: underline wavy var(--c-coral) 1px; text-underline-offset: 3px; }
  :global(.tk-str) { color: #9bcb7a; }
  :global(.tk-num) { color: var(--c-purple); }
  :global(.tk-comment) { color: var(--text-muted); font-style: italic; }
  :global(.tk-punct) { color: var(--text-secondary); }
</style>
