<script>
  import { highlightSQL } from './sql-highlight.js';
  import { highlightMongo } from './mongo-highlight.js';
  import { currentWord, aliasMap, suggest, isInsideLiteral } from '$lib/schema.js';
  import { formatQuery, canFormat } from '$lib/format.js';
  import { runTarget } from '$lib/run-target.js';

  let {
    value = $bindable(''),
    onanalyze = () => {},
    oncopy = () => {},
    loading = false,
    stale = false,
    engine = 'sql',
    errorLine = null,
    placeholder = '',
    // The same editor drives both tabs: "Analisa" on the visualizer,
    // "Jalankan" when the target is a live database.
    runLabel = 'Analisa',
    runningLabel = 'Menganalisa…',
    runIcon = 'ti-player-play-filled',
    /** `{ tables: string[], columnsByTable: Map }` — empty until a connection is picked. */
    schema = null,
    dialect = 'MariaDB',
    onformat = null,
    /** When set, a selection runs on its own and the button says so (Query tab). */
    selectionLabel = null
  } = $props();

  /** @type {HTMLTextAreaElement | null} */
  let taEl = $state(null);
  /** @type {HTMLElement | null} */
  let highlightEl = $state(null);
  /** @type {HTMLElement | null} */
  let gutterEl = $state(null);
  let dragOver = $state(false);
  let caretLine = $state(1);
  let caretCol = $state(0);
  let hasSelection = $state(false);

  /** Autocomplete: the open suggestion list, or [] when nothing is offered. */
  let hints = $state([]);
  let hintIndex = $state(0);
  let hintAt = $state(null);
  let charWidth = $state(0);
  let formatError = $state('');
  let boxHeight = $state(190); // px — user-resizable via the drag handle below

  const lines = $derived(value.split('\n'));
  const lineCount = $derived(Math.max(1, lines.length));
  const highlighted = $derived((engine === 'mongo' ? highlightMongo(value) : highlightSQL(value)) + '\n');
  const charCount = $derived(value.length);

  function syncScroll() {
    if (highlightEl && taEl) {
      highlightEl.scrollTop = taEl.scrollTop;
      highlightEl.scrollLeft = taEl.scrollLeft;
    }
    if (gutterEl && taEl) gutterEl.scrollTop = taEl.scrollTop;
  }

  /** Track the caret's line so the gutter can mark where you are. */
  function syncCaret() {
    if (!taEl) return;
    hasSelection = !!selectionLabel && runTarget(value, taEl.selectionStart, taEl.selectionEnd).selection;
    const before = value.slice(0, taEl.selectionStart);
    const lines = before.split('\n');
    caretLine = lines.length;
    caretCol = lines[lines.length - 1].length;
  }

  /** Measured from the textarea itself — hardcoding these drifts with the CSS. */
  let lineHeight = $state(19);
  let padTop = $state(10);
  let padLeft = $state(12);

  /**
   * Suggestions are recomputed on every edit, never on a timer.
   * `force` is Ctrl+Space: it offers a list even where typing alone would not,
   * which is the escape hatch when you cannot remember how a name starts.
   */
  function refreshHints(force = false) {
    if (!taEl || !schema) {
      hints = [];
      return;
    }
    const caret = taEl.selectionStart;
    // Inside a string or a comment the caret is in prose, not in a name.
    if (isInsideLiteral(value, caret)) {
      hints = [];
      hintAt = null;
      return;
    }
    // With nothing typed, Ctrl+Space still has a position to insert at.
    const at = currentWord(value, caret) || (force ? { word: '', start: caret, qualifier: null } : null);
    if (!at) {
      hints = [];
      hintAt = null;
      return;
    }
    if (at.qualifier) at.qualifierTable = aliasMap(value).get(at.qualifier.toLowerCase()) || at.qualifier;
    const found = suggest(at, schema, { force, limit: force ? 12 : 8 });
    // A list whose only entry is the word already typed is noise.
    hints =
      found.length === 1 && at.word && found[0].label.toLowerCase() === at.word.toLowerCase() ? [] : found;
    hintIndex = 0;
    hintAt = at;
  }

  function applyHint(hint) {
    if (!hint || !hintAt) return;
    const before = value.slice(0, hintAt.start);
    const after = value.slice(taEl.selectionStart);
    value = before + hint.label + after;
    const caret = hintAt.start + hint.label.length;
    hints = [];
    requestAnimationFrame(() => {
      taEl.focus();
      taEl.selectionStart = taEl.selectionEnd = caret;
      syncCaret();
    });
  }

  /**
   * Monospace makes the caret's pixel position simple arithmetic — but only
   * with the real numbers. The probe goes in the parent, never in the textarea:
   * a textarea cannot contain elements, so measuring inside it returns zero.
   */
  function measureChar(node) {
    const apply = () => {
      const cs = getComputedStyle(node);
      const probe = document.createElement('span');
      probe.textContent = '0'.repeat(20);
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;top:-9999px;left:-9999px;';
      probe.style.font = cs.font || `${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
      document.body.appendChild(probe);
      charWidth = probe.getBoundingClientRect().width / 20;
      probe.remove();

      const lh = parseFloat(cs.lineHeight);
      if (Number.isFinite(lh)) lineHeight = lh;
      padTop = parseFloat(cs.paddingTop) || 0;
      padLeft = parseFloat(cs.paddingLeft) || 0;
    };
    apply();
    // Web fonts land after first paint; a stale width would offset every hint.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply).catch(() => {});
    return { destroy() {} };
  }

  const hintLeft = $derived(Math.max(0, padLeft + caretCol * charWidth - (taEl ? taEl.scrollLeft : 0)));
  const hintTop = $derived(padTop + caretLine * lineHeight - (taEl ? taEl.scrollTop : 0) + 4);

  function runFormat() {
    formatError = '';
    const r = formatQuery(value, dialect);
    if (!r.ok) {
      formatError = r.error;
      return;
    }
    value = r.text;
    if (onformat) onformat();
  }

  function onKeydown(e) {
    // The suggestion list owns these keys while it is open, and only then —
    // Tab must keep indenting and Enter must keep inserting a newline
    // whenever nothing is being suggested.
    if (hints.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); hintIndex = (hintIndex + 1) % hints.length; return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); hintIndex = (hintIndex - 1 + hints.length) % hints.length; return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyHint(hints[hintIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); hints = []; return; }
    }
    // Ctrl+Space is the conventional "show me the options" chord. Cmd+Space is
    // Spotlight on macOS, so it is deliberately not bound.
    if (e.ctrlKey && e.key === ' ') {
      e.preventDefault();
      syncCaret();
      refreshHints(true);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      runFormat();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = taEl.selectionStart, en = taEl.selectionEnd;
      value = value.slice(0, s) + '  ' + value.slice(en);
      requestAnimationFrame(() => { taEl.selectionStart = taEl.selectionEnd = s + 2; });
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      trigger();
    }
  }

  /** Hand the page what to run: the selection if there is one, else everything. */
  function trigger() {
    onanalyze(taEl ? runTarget(value, taEl.selectionStart, taEl.selectionEnd) : { text: value, selection: false });
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

  /** Drag the bar under the editor to give the query more (or less) room. */
  function startResize(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = boxHeight;
    const onMove = (ev) => {
      boxHeight = Math.min(560, Math.max(96, startH + (ev.clientY - startY)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
  function resizeKeys(e) {
    if (e.key === 'ArrowUp') { e.preventDefault(); boxHeight = Math.max(96, boxHeight - 20); }
    if (e.key === 'ArrowDown') { e.preventDefault(); boxHeight = Math.min(560, boxHeight + 20); }
  }

  export function focus() { taEl?.focus(); }
</script>

<div class="editor-wrap" class:drag={dragOver}
  ondragover={(e) => { e.preventDefault(); dragOver = true; }}
  ondragleave={() => (dragOver = false)}
  ondrop={onDrop}
  role="group"
>
  <div class="editor-box" style:height={boxHeight + 'px'}>
    <div class="gutter" bind:this={gutterEl} aria-hidden="true">
      {#each lines as _, i}
        <div class="ln" class:current={caretLine === i + 1} class:err={errorLine === i + 1}>{i + 1}</div>
      {/each}
    </div>
    <div class="code-area">
      <pre class="highlight" bind:this={highlightEl} aria-hidden="true"><code>{@html highlighted}</code></pre>
      <textarea
        bind:this={taEl}
        bind:value
        use:measureChar
        oninput={() => { syncCaret(); refreshHints(); }}
        onscroll={syncScroll}
        onkeydown={onKeydown}
        onkeyup={syncCaret}
        onselect={syncCaret}
        onmouseup={syncCaret}
        onclick={() => { syncCaret(); hints = []; }}
        onblur={() => setTimeout(() => (hints = []), 120)}
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        aria-label={engine === 'mongo' ? 'Editor pipeline MongoDB' : 'Editor query SQL'}
        placeholder={placeholder || '-- Tempel query SQL di sini lalu klik Analisa'}
      ></textarea>
      {#if hints.length}
        <ul class="hints" style:left={hintLeft + 'px'} style:top={hintTop + 'px'} role="listbox"
          aria-label="Saran nama tabel dan kolom">
          {#each hints as h, i (h.kind + h.label)}
            <li>
              <button type="button" role="option" aria-selected={i === hintIndex} class:active={i === hintIndex}
                onmousedown={(e) => { e.preventDefault(); applyHint(h); }}>
                <i class="ti {h.kind === 'table' ? 'ti-table' : 'ti-columns-3'}"></i>
                <span class="h-label">{h.label}</span>
                {#if h.detail}<span class="h-detail">{h.detail}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if dragOver}
        <div class="drop-hint"><i class="ti ti-file-download"></i> Lepaskan file untuk memuat</div>
      {/if}
    </div>
  </div>

  <!-- A focusable window splitter (WAI-ARIA separator); the linter can't tell
       it apart from a decorative separator, hence the suppressions. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
  <div
    class="resizer"
    role="separator"
    aria-label="Ubah tinggi editor"
    aria-orientation="horizontal"
    aria-valuenow={boxHeight}
    aria-valuemin={96}
    aria-valuemax={560}
    tabindex="0"
    onpointerdown={startResize}
    onkeydown={resizeKeys}
  ><span class="grip"></span></div>

  <div class="editor-foot">
    <label class="file-btn">
      <i class="ti ti-upload"></i> Upload
      <input type="file" accept=".sql,.js,.json,.txt,text/plain" onchange={onFile} hidden />
    </label>
    <button class="file-btn" onclick={runFormat} disabled={!value.trim() || !canFormat(dialect)}
      title={canFormat(dialect)
        ? 'Rapikan indentasi & huruf kapital (⌘/Ctrl+Shift+F)'
        : `Format otomatis belum tersedia untuk ${dialect}`}>
      <i class="ti ti-align-left"></i> Format
    </button>
    <button class="file-btn" onclick={() => oncopy(value)} disabled={!value.trim()} title="Salin query">
      <i class="ti ti-copy"></i> Salin
    </button>
    <button class="file-btn" onclick={() => (value = '')} disabled={!value} title="Kosongkan editor">
      <i class="ti ti-eraser"></i> Kosongkan
    </button>

    <span class="hint">
      <span class="stat">{lineCount} baris · {charCount} karakter</span>
      {#if formatError}<span class="fmt-err" title={formatError}><i class="ti ti-alert-circle"></i> {formatError.slice(0, 60)}</span>{/if}
      {#if schema}
        <span class="kbd-hint"><kbd>ctrl</kbd><kbd>space</kbd> saran</span>
      {/if}
      <span class="kbd-hint"><kbd>⌘</kbd><kbd>↵</kbd> {(hasSelection ? selectionLabel : runLabel).toLowerCase()}</span>
    </span>

    <button class="analyze" class:stale onclick={trigger} disabled={loading || !value.trim()}
      title={hasSelection ? 'Hanya teks yang diseleksi yang dijalankan' : undefined}>
      {#if loading}
        <i class="ti ti-loader-2 spin"></i> {runningLabel}
      {:else if hasSelection}
        <i class="ti ti-cursor-text"></i> {selectionLabel}
      {:else}
        <i class="ti {runIcon}"></i> {stale ? `${runLabel} ulang` : runLabel}
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
    transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
  }
  .editor-wrap:focus-within { border-color: var(--border-strong); }
  .editor-wrap.drag {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .editor-box {
    display: flex;
    background: var(--surface-2);
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
  .ln { height: calc(var(--fs-code) * 1.55); position: relative; }
  .ln.current { color: var(--text-secondary); }
  /* The parser already reports a line number; now the editor points at it. */
  .ln.err { color: var(--sev-critical); font-weight: 600; }
  .ln.err::before {
    content: ''; position: absolute; left: -12px; top: 0; bottom: 0;
    width: 2px; background: var(--sev-critical);
  }
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
  .hints {
    position: absolute; z-index: 30; margin: 0; padding: 3px; list-style: none;
    min-width: 190px; max-width: 320px; max-height: 190px; overflow-y: auto;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius-sm); box-shadow: var(--shadow-modal);
  }
  .hints button {
    display: flex; align-items: center; gap: 7px; width: 100%; text-align: left;
    background: transparent; border: 0; border-radius: var(--radius-sm);
    padding: 4px 8px; color: var(--text-secondary); font-size: var(--fs-meta);
  }
  .hints button.active, .hints button:hover { background: var(--surface-3); color: var(--text-primary); }
  .hints i { font-size: 13px; color: var(--text-muted); flex: 0 0 auto; }
  .h-label { font-family: var(--mono); flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
  .h-detail { color: var(--text-muted); font-size: 10px; flex: 0 0 auto; }
  .fmt-err { color: var(--sev-warning); display: inline-flex; gap: 4px; align-items: center; }

  .drop-hint {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    gap: 8px; background: var(--accent-soft); color: var(--accent);
    font-size: var(--fs-sub); pointer-events: none;
  }

  .resizer {
    height: 7px; cursor: ns-resize; background: var(--surface-1);
    display: flex; align-items: center; justify-content: center;
    border-top: 0.5px solid var(--border);
  }
  .grip { width: 30px; height: 2px; border-radius: 2px; background: var(--border-strong); }
  .resizer:hover .grip { background: var(--accent); }

  .editor-foot {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border-top: 0.5px solid var(--border);
    flex-wrap: wrap;
  }
  .file-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-sub);
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    padding: 3px 8px;
    border: 0.5px solid var(--border);
    border-radius: var(--radius-sm);
    transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
  }
  .file-btn:not(:disabled):hover { background: var(--surface-3); color: var(--text-primary); }
  .file-btn:disabled { opacity: 0.4; cursor: default; }
  .hint {
    flex: 1; display: flex; align-items: center; justify-content: flex-end; gap: 12px;
    font-size: var(--fs-meta); color: var(--text-muted);
  }
  kbd {
    font-family: var(--sans); font-size: 10px; line-height: 1;
    border: 0.5px solid var(--border-strong); border-bottom-width: 1.5px;
    border-radius: 3px; padding: 2px 4px; margin-right: 2px; color: var(--text-secondary);
    background: var(--surface-2);
  }
  .analyze {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent);
    color: var(--accent-ink);
    border: 0;
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-body);
    font-weight: 500;
    white-space: nowrap;
    transition: filter var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
  }
  .analyze:disabled { opacity: 0.45; cursor: default; }
  .analyze:not(:disabled):hover { filter: brightness(1.08); }
  /* Nudge — the on-screen results no longer match the query in the editor. */
  .analyze.stale:not(:disabled) { box-shadow: 0 0 0 3px var(--accent-soft); }
  .spin { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 720px) {
    /* Keep the footer on one row by dropping the informational bits first;
       the run button must never be pushed off-screen. */
    .hint { display: none; }
    .file-btn { padding: 3px 7px; }
    .editor-foot { gap: 5px; }
    .analyze { margin-left: auto; padding: 6px 12px; }
  }

  :global(.tk-kw) { color: var(--accent); font-weight: 500; }
  :global(.tk-fn) { color: var(--c-teal); }
  :global(.tk-risky) { color: var(--c-coral); text-decoration: underline wavy var(--c-coral) 1px; text-underline-offset: 3px; }
  :global(.tk-str) { color: var(--tk-string); }
  :global(.tk-num) { color: var(--c-purple); }
  :global(.tk-comment) { color: var(--text-muted); font-style: italic; }
  :global(.tk-punct) { color: var(--text-secondary); }
</style>
