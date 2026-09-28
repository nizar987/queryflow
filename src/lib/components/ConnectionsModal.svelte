<script>
  import { dismissable, focusTrap, lockScroll } from '$lib/actions/popover.js';
  import * as api from '$lib/api.js';

  let { open = false, onclose = () => {}, onchange = () => {} } = $props();

  const DIALECTS = ['MariaDB', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis'];
  const DEFAULT_PORT = { MariaDB: 3306, MySQL: 3306, PostgreSQL: 5432, MongoDB: 27017, Redis: 6379 };
  /** Mirrors DEFAULT_QUERY_TIMEOUT_SEC in server/run-control.js — the server is the one that enforces it. */
  const DEFAULT_QUERY_TIMEOUT_SEC = 30;
  const blank = () => ({
    id: null, name: '', dialect: 'MariaDB', host: '127.0.0.1',
    port: 3306, database: '', user: '', password: '', sslMode: 'disable', sslCa: '',
    readOnly: false, queryTimeoutSec: DEFAULT_QUERY_TIMEOUT_SEC,
    redisMode: 'standalone', redisNodes: '', sentinelMaster: '', uri: ''
  });

  const REDIS_MODES = [
    ['standalone', 'Standalone — satu host:port'],
    ['sentinel', 'Sentinel — failover otomatis'],
    ['cluster', 'Cluster — keyspace terbagi antar master']
  ];

  // Mirrors SSL_MODES on the server; the label says what is actually verified,
  // because "SSL: on" told nobody whether the server's identity was checked.
  const SSL_MODES = [
    ['disable', 'Nonaktif'],
    ['require', 'Aktif, tanpa verifikasi'],
    ['verify-ca', 'Verifikasi CA'],
    ['verify-full', 'Verifikasi CA + hostname']
  ];

  let connections = $state([]);
  let configPath = $state('');
  let loadError = $state('');
  let loading = $state(true);

  /** null = list view; otherwise the profile being added/edited. */
  let draft = $state(null);
  let saving = $state(false);
  let formError = $state('');
  /** id -> { state: 'testing'|'ok'|'fail', message } */
  let status = $state({});
  let confirmDelete = $state(null);

  $effect(() => {
    if (!open) return;
    load();
    return lockScroll();
  });

  async function load() {
    loading = true;
    const r = await api.listConnections();
    loading = false;
    if (r.ok) {
      connections = r.connections;
      configPath = r.configPath || '';
      loadError = '';
    } else {
      loadError = r.error || 'Gagal memuat daftar koneksi.';
      configPath = r.configPath || '';
    }
  }

  function startAdd() {
    draft = blank();
    formError = '';
  }
  function startEdit(c) {
    // The server never sends passwords back; an empty field means "keep it".
    draft = { ...c, password: '', uri: c.uri && c.uri.includes('***') ? '' : c.uri };
    formError = '';
  }
  function onDialectChange() {
    if (!draft) return;
    draft.port = DEFAULT_PORT[draft.dialect] || draft.port;
  }

  async function save() {
    if (!draft || saving) return;
    saving = true;
    formError = '';
    const payload = { ...draft };
    const r = draft.id ? await api.updateConnection(draft.id, payload) : await api.createConnection(payload);
    saving = false;
    if (!r.ok) {
      formError = r.error || 'Gagal menyimpan.';
      return;
    }
    draft = null;
    await load();
    onchange();
  }

  async function remove(id) {
    const r = await api.deleteConnection(id);
    confirmDelete = null;
    if (r.ok) {
      await load();
      onchange();
    } else {
      loadError = r.error || 'Gagal menghapus.';
    }
  }

  async function test(id) {
    status = { ...status, [id]: { state: 'testing' } };
    const r = await api.testConnection(id);
    status = {
      ...status,
      [id]: r.ok
        ? { state: 'ok', message: `${r.version} · ${r.durationMs}ms` }
        : { state: 'fail', message: r.error }
    };
  }

  const isMongo = $derived(draft && draft.dialect === 'MongoDB');
  const verifying = $derived(!!draft && String(draft.sslMode || '').startsWith('verify'));
  // Redis has numbered databases and no tables — it powers the Antrian tab only.
  const isRedis = $derived(draft && draft.dialect === 'Redis');
  const redisMulti = $derived(isRedis && draft.redisMode && draft.redisMode !== 'standalone');
</script>

{#if open}
  <div class="overlay" role="presentation">
    <div class="modal" use:dismissable={onclose} use:focusTrap role="dialog" aria-modal="true"
      aria-label="Pengaturan koneksi database" tabindex="-1">
      <div class="m-head">
        <span class="m-title"><i class="ti ti-plug"></i> Koneksi database</span>
        <button class="x" onclick={onclose} aria-label="Tutup (Esc)"><i class="ti ti-x"></i></button>
      </div>

      <div class="m-body">
        {#if draft}
          <form onsubmit={(e) => { e.preventDefault(); save(); }}>
            <div class="grid">
              <label class="f full">
                <span>Nama</span>
                <input bind:value={draft.name} placeholder="mis. MariaDB lokal" required />
              </label>

              <label class="f">
                <span>Dialek</span>
                <select bind:value={draft.dialect} onchange={onDialectChange}>
                  {#each DIALECTS as d (d)}<option value={d}>{d}</option>{/each}
                </select>
              </label>

              <label class="f">
                <span>Port</span>
                <input type="number" bind:value={draft.port} min="1" max="65535" />
              </label>

              <label class="f full">
                <span>Host</span>
                <input bind:value={draft.host} placeholder="127.0.0.1" />
              </label>

              {#if isRedis}
                <label class="f full">
                  <span>Mode Redis</span>
                  <select bind:value={draft.redisMode}>
                    {#each REDIS_MODES as [value, label] (value)}<option {value}>{label}</option>{/each}
                  </select>
                </label>

                {#if redisMulti}
                  <label class="f full">
                    <span>
                      Node {draft.redisMode === 'sentinel' ? 'sentinel' : 'cluster'}
                      <em>(pisahkan dengan koma)</em>
                    </span>
                    <input bind:value={draft.redisNodes}
                      placeholder={draft.redisMode === 'sentinel'
                        ? 'sentinel-0:26379, sentinel-1:26379, sentinel-2:26379'
                        : 'node-0:6379, node-1:6379, node-2:6379'} />
                  </label>
                {/if}
                {#if draft.redisMode === 'sentinel'}
                  <label class="f full">
                    <span>Nama master</span>
                    <input bind:value={draft.sentinelMaster} placeholder="mymaster" />
                  </label>
                {/if}
                {#if draft.redisMode === 'cluster'}
                  <p class="tls-note full">
                    <i class="ti ti-info-circle"></i>
                    Di mode cluster, indeks database selalu 0 dan penelusuran key dilakukan ke
                    setiap master — jadi antrian yang tersebar antar node tetap terbaca.
                  </p>
                {/if}
              {/if}

              <label class="f">
                <span>{isRedis ? 'DB index' : 'Database'}</span>
                <input bind:value={draft.database}
                  placeholder={isRedis ? '0' : isMongo ? 'nama database' : 'nama schema/database'} />
              </label>

              <label class="f">
                <span>User</span>
                <input bind:value={draft.user} autocomplete="off" />
              </label>

              <label class="f full">
                <span>Password {#if draft.id}<em>(kosongkan untuk tidak mengubah)</em>{/if}</span>
                <input type="password" bind:value={draft.password} autocomplete="new-password" />
              </label>

              <label class="f full">
                <span>Connection URI <em>(opsional — menimpa isian di atas)</em></span>
                <input bind:value={draft.uri}
                  placeholder={isRedis ? 'redis://… / rediss://…' : isMongo ? 'mongodb://…' : 'postgres://… / mysql://…'}
                  autocomplete="off" />
              </label>

              <label class="f full">
                <span>TLS/SSL</span>
                <select bind:value={draft.sslMode}>
                  {#each SSL_MODES as [value, label] (value)}<option {value}>{label}</option>{/each}
                </select>
              </label>

              {#if draft.sslMode === 'require'}
                <p class="tls-note full">
                  <i class="ti ti-shield-off"></i>
                  Terenkripsi, tapi identitas server <strong>tidak diperiksa</strong> — masih bisa disadap
                  lewat man-in-the-middle. Pakai verifikasi kalau server punya sertifikat yang benar.
                </p>
              {/if}

              {#if verifying}
                <label class="f full">
                  <span>
                    Sertifikat CA <em>(path file .pem, atau tempel isi PEM-nya)</em>
                    {#if draft.id && draft.hasInlineCa}<em>— PEM tersimpan, kosongkan untuk tidak mengubah</em>{/if}
                  </span>
                  <input bind:value={draft.sslCa} autocomplete="off"
                    placeholder={draft.hasInlineCa ? '(PEM tersimpan di file profil)' : '/etc/ssl/certs/rds-ca.pem'} />
                </label>
                {#if draft.sslMode === 'verify-ca'}
                  <p class="tls-note full">
                    <i class="ti ti-info-circle"></i>
                    Rantai sertifikat diperiksa, nama host tidak — mode ini untuk database yang diakses
                    lewat port-forward atau IP, di mana hostname memang tidak akan cocok.
                  </p>
                {/if}
              {/if}

              {#if !isRedis}
                <label class="f full">
                  <span>Batas waktu query <em>(detik, 0 = tanpa batas — query yang lewat batas dihentikan di database)</em></span>
                  <input type="number" bind:value={draft.queryTimeoutSec} min="0" max="3600" step="1"
                    placeholder={String(DEFAULT_QUERY_TIMEOUT_SEC)} />
                </label>
                <label class="check full guard">
                  <input type="checkbox" bind:checked={draft.readOnly} />
                  <span>
                    <strong>Read-only</strong> — tolak semua penulisan ke koneksi ini
                    <em>UPDATE/DELETE/DDL diblokir di server, edit sel dimatikan. Untuk profil produksi.</em>
                  </span>
                </label>
              {/if}
            </div>

            {#if formError}<p class="err"><i class="ti ti-alert-circle"></i> {formError}</p>{/if}

            {#if isRedis}
              <p class="note">
                <i class="ti ti-stack-2"></i>
                Koneksi Redis dipakai di tab <strong>Antrian</strong> untuk memantau job dan worker
                (python-rq, BullMQ, Sidekiq). QueryFlow hanya membaca — tidak pernah menghapus atau
                memindahkan job.
              </p>
            {/if}

            <p class="note">
              <i class="ti ti-lock"></i>
              Disimpan di <code>{configPath || '.queryflow/connections.json'}</code> pada mesin ini (mode 0600, sudah di-gitignore).
              Password tidak pernah dikirim kembali ke browser.
            </p>

            <div class="form-actions">
              <button type="button" class="ghost" onclick={() => (draft = null)}>Batal</button>
              <button type="submit" class="primary" disabled={saving}>
                {#if saving}<i class="ti ti-loader-2 spin"></i>{/if}
                {draft.id ? 'Simpan perubahan' : 'Tambah koneksi'}
              </button>
            </div>
          </form>
        {:else}
          {#if loading}
            <p class="muted"><i class="ti ti-loader-2 spin"></i> Memuat…</p>
          {:else if loadError}
            <p class="err"><i class="ti ti-alert-octagon"></i> {loadError}</p>
          {/if}

          {#if !loading && connections.length === 0 && !loadError}
            <div class="empty">
              <i class="ti ti-plug-connected-x"></i>
              <p>Belum ada koneksi. Tambahkan satu untuk mulai menjalankan query di tab <strong>Query</strong>.</p>
            </div>
          {/if}

          <div class="list">
            {#each connections as c (c.id)}
              <div class="conn">
                <div class="c-main">
                  <div class="c-head">
                    <span class="c-name">{c.name}</span>
                    <span class="c-dialect">{c.dialect}</span>
                    {#if c.readOnly}
                      <span class="c-ro" title="Semua penulisan ke koneksi ini ditolak server">
                        <i class="ti ti-lock"></i> read-only
                      </span>
                    {/if}
                  </div>
                  <div class="c-meta">
                    {c.uri ? c.uri : `${c.user ? c.user + '@' : ''}${c.host}:${c.port}${c.database ? '/' + c.database : ''}`}
                    {#if c.redisMode && c.redisMode !== 'standalone'}
                      <span class="c-ro" title={c.redisNodes}>{c.redisMode}</span>
                    {/if}
                    {#if c.sslMode && c.sslMode !== 'disable'}
                      <span class="tls" class:weak={c.sslMode === 'require'}
                        title={c.sslMode === 'require' ? 'Terenkripsi tanpa verifikasi identitas server' : 'Sertifikat server diverifikasi'}>
                        {c.sslMode === 'require' ? 'TLS tanpa verifikasi' : c.sslMode === 'verify-ca' ? 'TLS verify-ca' : 'TLS verify-full'}
                      </span>
                    {/if}
                    {#if !c.hasPassword && !c.uri}<span class="nopw">tanpa password</span>{/if}
                  </div>
                  {#if status[c.id]}
                    <div class="c-status {status[c.id].state}">
                      {#if status[c.id].state === 'testing'}
                        <i class="ti ti-loader-2 spin"></i> Menguji…
                      {:else if status[c.id].state === 'ok'}
                        <i class="ti ti-circle-check"></i> {status[c.id].message}
                      {:else}
                        <i class="ti ti-alert-circle"></i> {status[c.id].message}
                      {/if}
                    </div>
                  {/if}
                </div>
                <div class="c-actions">
                  <button onclick={() => test(c.id)} title="Uji koneksi"><i class="ti ti-plug-connected"></i></button>
                  <button onclick={() => startEdit(c)} title="Ubah"><i class="ti ti-pencil"></i></button>
                  {#if confirmDelete === c.id}
                    <button class="danger" onclick={() => remove(c.id)}>Hapus?</button>
                    <button onclick={() => (confirmDelete = null)} title="Batal"><i class="ti ti-x"></i></button>
                  {:else}
                    <button onclick={() => (confirmDelete = c.id)} title="Hapus"><i class="ti ti-trash"></i></button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>

          {#if configPath}
            <p class="note">
              <i class="ti ti-file-text"></i> Profil tersimpan di <code>{configPath}</code>
            </p>
          {/if}
        {/if}
      </div>

      {#if !draft}
        <div class="m-foot">
          <button class="primary" onclick={startAdd}><i class="ti ti-plus"></i> Tambah koneksi</button>
        </div>
      {/if}
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
    width: min(640px, 100%); max-height: 86vh; display: flex; flex-direction: column;
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
  .m-body { padding: 14px; overflow-y: auto; }
  .m-foot { display: flex; justify-content: flex-end; padding: 11px 14px; border-top: 0.5px solid var(--border); }

  .list { display: flex; flex-direction: column; gap: 8px; }
  .conn {
    display: flex; align-items: flex-start; gap: 10px;
    border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    padding: 9px 11px; background: var(--surface-2);
  }
  .c-main { flex: 1 1 auto; min-width: 0; }
  .c-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .c-name { font-size: var(--fs-body); color: var(--text-primary); }
  .c-dialect {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--accent); border: 0.5px solid var(--accent-line); border-radius: 20px; padding: 1px 6px;
  }
  .c-meta {
    font-family: var(--mono); font-size: var(--fs-meta); color: var(--text-muted);
    margin-top: 3px; word-break: break-all; display: flex; gap: 6px; flex-wrap: wrap;
  }
  .tls { color: var(--success); }
  .tls.weak { color: var(--sev-warning); }
  .c-ro {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--success); border: 0.5px solid var(--success); border-radius: 20px;
    padding: 1px 6px; display: inline-flex; align-items: center; gap: 3px;
  }
  .tls-note {
    margin: 0; padding: 8px 11px; font-size: var(--fs-meta); line-height: 1.6;
    color: var(--text-secondary); background: var(--wash-warning);
    border: 0.5px solid var(--wash-warning-line); border-radius: var(--radius-sm);
    display: flex; gap: 7px; align-items: flex-start;
  }
  .check.guard { align-items: flex-start; }
  .check.guard span { line-height: 1.5; }
  .check.guard em { display: block; font-style: normal; color: var(--text-muted); font-size: var(--fs-meta); }
  .nopw { color: var(--sev-warning); }
  .c-status { margin-top: 6px; font-size: var(--fs-meta); display: flex; gap: 5px; align-items: flex-start; }
  .c-status.ok { color: var(--success); }
  .c-status.fail { color: var(--sev-critical); }
  .c-status.testing { color: var(--text-muted); }
  .c-actions { display: flex; gap: 2px; flex: 0 0 auto; }
  .c-actions button {
    background: transparent; border: 0; color: var(--text-muted);
    width: 26px; height: 26px; border-radius: var(--radius-sm); font-size: 14px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .c-actions button:hover { background: var(--surface-3); color: var(--text-primary); }
  .c-actions button.danger { width: auto; padding: 0 8px; font-size: var(--fs-meta); color: var(--sev-critical); }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .f { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .f.full, .check.full { grid-column: 1 / -1; }
  .f > span { font-size: var(--fs-meta); color: var(--text-muted); }
  .f em { font-style: normal; opacity: 0.75; }
  .f input, .f select {
    background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius-sm);
    color: var(--text-primary); font-family: var(--sans); font-size: var(--fs-sub); padding: 6px 8px;
    outline: none; min-width: 0;
  }
  .f input:focus, .f select:focus { border-color: var(--accent); }
  .check { display: flex; align-items: center; gap: 7px; font-size: var(--fs-sub); color: var(--text-secondary); }
  .form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }

  .ghost, .primary {
    display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sub);
    padding: 6px 12px; border-radius: var(--radius-sm); border: 0.5px solid var(--border);
  }
  .ghost { background: transparent; color: var(--text-secondary); }
  .ghost:hover { background: var(--surface-3); color: var(--text-primary); }
  .primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
  .primary:hover { filter: brightness(1.08); }
  .primary:disabled { opacity: 0.6; cursor: default; }

  .note {
    margin: 14px 0 0; font-size: var(--fs-meta); color: var(--text-muted);
    line-height: 1.6; display: flex; gap: 6px; align-items: flex-start;
  }
  .note code { font-family: var(--mono); color: var(--text-secondary); word-break: break-all; }
  .err { color: var(--sev-critical); font-size: var(--fs-sub); display: flex; gap: 6px; align-items: flex-start; margin: 10px 0 0; }
  .muted { color: var(--text-muted); font-size: var(--fs-sub); display: flex; gap: 6px; align-items: center; }
  .empty { text-align: center; color: var(--text-muted); font-size: var(--fs-sub); padding: 28px 16px; line-height: 1.6; }
  .empty i { font-size: 26px; display: block; margin-bottom: 10px; opacity: 0.6; }
  .spin { animation: spin 0.8s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 560px) {
    .grid { grid-template-columns: 1fr; }
  }
</style>
