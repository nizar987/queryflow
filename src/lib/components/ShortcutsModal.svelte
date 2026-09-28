<script>
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';

  let { open = false, onclose = () => {} } = $props();

  const GROUPS = [
    {
      title: 'Umum',
      items: [
        { keys: ['?'], desc: 'Buka / tutup daftar pintasan ini' },
        { keys: ['Esc'], desc: 'Tutup dialog atau menu yang terbuka' },
        { keys: ['⌘/Ctrl', 'K'], desc: 'Query baru (kosongkan editor)' },
        { keys: ['⌘/Ctrl', 'B'], desc: 'Sembunyikan / tampilkan riwayat' }
      ]
    },
    {
      title: 'Editor',
      items: [
        { keys: ['⌘/Ctrl', '↵'], desc: 'Jalankan analisa (tab Visualizer)' },
        { keys: ['Tab'], desc: 'Sisipkan dua spasi (indent)' },
        { keys: ['drag & drop'], desc: 'Muat file query dari desktop' }
      ]
    },
    {
      title: 'Tables',
      items: [
        { keys: ['klik'], desc: 'Buka dialog ubah nilai sel (bila punya izin)' },
        { keys: ['↵'], desc: 'Simpan perubahan di dialog' },
        { keys: ['Esc'], desc: 'Tutup dialog tanpa menyimpan' }
      ]
    },
    {
      title: 'Query & Log',
      items: [
        { keys: ['⌘/Ctrl', '↵'], desc: 'Jalankan query ke database (tab Query)' },
        { keys: ['⌘/Ctrl', 'R'], desc: 'Muat ulang processlist (tab Log)' }
      ]
    },
    {
      title: 'Diagram',
      items: [
        { keys: ['drag'], desc: 'Geser kanvas' },
        { keys: ['⌘/Ctrl', 'scroll'], desc: 'Perbesar / perkecil' },
        { keys: ['↑', '↓'], desc: 'Pindah antar node (saat node fokus)' },
        { keys: ['↵'], desc: 'Pilih node yang sedang fokus' }
      ]
    }
  ];

  $effect(() => {
    if (!open) return;
    return lockScroll();
  });
</script>

{#if open}
  <div class="overlay" role="presentation">
    <div class="modal" use:dismissable={onclose} use:focusTrap role="dialog" aria-modal="true" aria-label="Pintasan keyboard" tabindex="-1">
      <div class="m-head">
        <span class="m-title"><i class="ti ti-keyboard"></i> Pintasan keyboard</span>
        <button class="x" onclick={onclose} aria-label="Tutup (Esc)"><i class="ti ti-x"></i></button>
      </div>
      <div class="m-body">
        {#each GROUPS as g (g.title)}
          <section>
            <h3>{g.title}</h3>
            <dl>
              {#each g.items as it (it.desc)}
                <div class="row">
                  <dt>{#each it.keys as k, i (k)}{#if i > 0}<span class="plus">+</span>{/if}<kbd>{k}</kbd>{/each}</dt>
                  <dd>{it.desc}</dd>
                </div>
              {/each}
            </dl>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 200;
    background: var(--scrim); display: flex; align-items: center; justify-content: center; padding: 24px;
    animation: fade var(--dur-med) var(--ease);
  }
  @keyframes fade { from { opacity: 0; } }
  .modal {
    width: min(520px, 100%); max-height: 84vh; display: flex; flex-direction: column;
    background: var(--surface-1); border: 0.5px solid var(--border-strong);
    border-radius: var(--radius); box-shadow: var(--shadow-modal); overflow: hidden;
    animation: rise var(--dur-med) var(--ease);
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(0.99); } }
  .modal:focus { outline: none; }
  .m-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 0.5px solid var(--border); }
  .m-title { display: flex; align-items: center; gap: 8px; font-size: var(--fs-label); font-weight: 500; }
  .x { background: transparent; border: 0; color: var(--text-secondary); font-size: 16px; }
  .x:hover { color: var(--text-primary); }
  .m-body { padding: 6px 14px 14px; overflow-y: auto; }
  h3 {
    font-size: var(--fs-meta); color: var(--text-muted); text-transform: uppercase;
    letter-spacing: 0.05em; margin: 14px 0 6px; font-weight: 500;
  }
  dl { margin: 0; }
  .row { display: flex; align-items: baseline; gap: 12px; padding: 4px 0; }
  dt { flex: 0 0 128px; display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
  dd { margin: 0; font-size: var(--fs-sub); color: var(--text-secondary); line-height: 1.5; }
  kbd {
    font-family: var(--sans); font-size: 10px; line-height: 1;
    border: 0.5px solid var(--border-strong); border-bottom-width: 1.5px;
    border-radius: 3px; padding: 3px 5px; color: var(--text-primary); background: var(--surface-2);
  }
  .plus { color: var(--text-muted); font-size: 10px; }

  @media (max-width: 520px) {
    .row { flex-direction: column; gap: 3px; }
    dt { flex: none; }
  }
</style>
