<script>
  import Navbar from '$lib/components/Navbar.svelte';
</script>

<svelte:head>
  <title>Dokumentasi — QueryFlow</title>
</svelte:head>

<div class="app">
  <Navbar active="docs" />
  <div class="doc-scroll">
    <article class="doc">
      <h1>QueryFlow — Dokumentasi</h1>
      <p class="lead">Visualisasi alur eksekusi & debugger statis untuk query kompleks. Mendukung <strong>SQL</strong> (MariaDB, MySQL, PostgreSQL) dan <strong>NoSQL</strong> (MongoDB aggregation pipeline). Semua analisa berjalan <strong>lokal di browser</strong> — query tidak dikirim ke server.</p>

      <h2>Engine yang didukung</h2>
      <ul>
        <li><strong>MariaDB / MySQL</strong> — dialek default; identifier yang bentrok keyword (mis. <code>status</code>) di-quote otomatis.</li>
        <li><strong>PostgreSQL</strong> — termasuk <code>ILIKE</code>, <code>DATE_TRUNC()</code>, <code>STRING_AGG()</code>, dll.</li>
        <li><strong>MongoDB</strong> — pipeline <code>db.coll.aggregate([…])</code> dan <code>find()</code>. Stage pipeline dipetakan langsung ke node alur (sudah dalam urutan eksekusi).</li>
      </ul>
      <p>Pilih engine lewat dropdown di toolbar. Sampel query otomatis menyesuaikan saat berpindah antara SQL dan MongoDB.</p>

      <h2>Cara pakai</h2>
      <ol>
        <li>Tempel query SQL pada editor (atau upload file <code>.sql</code> / drag-drop).</li>
        <li>Klik <strong>Analisa</strong> (atau ⌘/Ctrl+Enter).</li>
        <li>Telusuri diagram alur di kiri; klik node untuk detail & penjelasan fungsi.</li>
        <li>Lihat temuan masalah di panel kanan; klik temuan untuk menyorot node terkait.</li>
        <li>Export diagram (PNG/SVG) atau analisa (Markdown), atau salin link share.</li>
      </ol>

      <h2>Urutan eksekusi logis</h2>
      <p>Diagram menampilkan query sesuai urutan <em>eksekusi</em>, bukan urutan penulisan:</p>
      <p class="flow-order"><code>FROM → JOIN → WHERE → GROUP BY → HAVING → WINDOW → SELECT → DISTINCT → ORDER BY → LIMIT</code></p>
      <p>CTE dan subquery ditampilkan sebagai sub-blok yang bisa di-collapse. Subquery korelasi ditandai dengan garis coral putus-putus dan ikon <code>⟲</code>.</p>

      <h2>MongoDB — alur pipeline</h2>
      <p>Tiap stage jadi satu node dengan urutan persis seperti ditulis (pipeline = urutan eksekusi):</p>
      <p class="flow-order"><code>$match → $lookup → $unwind → $group → $sort → $limit</code></p>
      <p>Warna mengikuti makna yang sama: <code>$match</code> (filter, coral), <code>$lookup</code> (join, biru), <code>$group</code> (agregasi, ungu), <code>$project/$addFields</code> (output, teal). <code>$lookup</code> dengan sub-pipeline & <code>$facet</code> jadi sub-blok. Analisa Mongo mencakup: $match terlambat, scan tanpa $match, $where/$function, regex tanpa anchor, $unwind tanpa filter, $sort tanpa $limit, deep $skip.</p>

      <h2>Warna node (semantik)</h2>
      <ul class="legend">
        <li><span class="sw" style="background:var(--c-gray)"></span> Netral — FROM, ORDER BY, LIMIT</li>
        <li><span class="sw" style="background:var(--c-blue)"></span> JOIN — penggabungan data</li>
        <li><span class="sw" style="background:var(--c-coral)"></span> WHERE / HAVING — penyaringan</li>
        <li><span class="sw" style="background:var(--c-purple)"></span> GROUP BY — pengelompokan</li>
        <li><span class="sw" style="background:var(--c-teal)"></span> SELECT — pembentukan hasil</li>
      </ul>

      <h2>Severity temuan</h2>
      <ul class="legend">
        <li><span class="sw" style="background:var(--sev-critical)"></span> Critical — berpotensi salah hasil / lock / cartesian</li>
        <li><span class="sw" style="background:var(--sev-warning)"></span> Warning — risiko performa (index, N+1, wildcard)</li>
        <li><span class="sw" style="background:var(--sev-info)"></span> Info — gaya / best-practice</li>
      </ul>

      <h2>Convert antar-dialek</h2>
      <p>Tombol <strong>Convert</strong> di toolbar menerjemahkan query aktif ke dialek lain (MariaDB ↔ MySQL ↔ PostgreSQL ↔ MongoDB). Hasilnya bisa langsung disalin atau dimuat ke editor.</p>
      <ul>
        <li><strong>SQL ↔ SQL</strong> — re-emit lewat parser; penyesuaian kutip identifier (backtick ↔ kutip ganda) & sintaks dasar.</li>
        <li><strong>SQL → MongoDB</strong> — WHERE→$match, JOIN→$lookup+$unwind, GROUP BY/agregat→$group, HAVING→$match, ORDER BY→$sort, LIMIT→$limit.</li>
        <li><strong>MongoDB → SQL</strong> — kebalikannya untuk stage umum.</li>
      </ul>
      <p>Konversi bersifat <strong>best-effort</strong>: konstruksi yang tidak punya padanan langsung (subquery, window function, $expr, $where, dll) dilewati dan dilaporkan sebagai catatan. Selalu verifikasi hasil sebelum dipakai di produksi.</p>

      <h2>Catatan & batasan (v1)</h2>
      <ul>
        <li>Analisa bersifat <strong>statis berbasis pola umum</strong> — bukan pengganti <code>EXPLAIN</code>/profiling pada database aktual.</li>
        <li>Dialek: MariaDB/MySQL. Identifier yang bentrok dengan keyword parser (mis. <code>status</code>) di-quote otomatis.</li>
        <li>Hanya statement <code>SELECT</code> yang divisualisasikan.</li>
        <li>Tidak ada koneksi ke database; tidak ada data yang diunggah.</li>
      </ul>

      <p class="back"><a href="/">← Kembali ke Visualizer</a></p>
    </article>
  </div>
</div>

<style>
  .app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .doc-scroll { flex: 1 1 auto; overflow-y: auto; background: var(--surface-0); }
  .doc { max-width: 720px; margin: 0 auto; padding: 32px 28px 80px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 8px; }
  .lead { color: var(--text-secondary); font-size: var(--fs-body); line-height: 1.7; margin-bottom: 24px; }
  h2 { font-size: 15px; font-weight: 600; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 0.5px solid var(--border); }
  p, li { font-size: var(--fs-body); line-height: 1.7; color: var(--text-secondary); }
  ol, ul { padding-left: 20px; }
  li { margin-bottom: 5px; }
  code { font-family: var(--mono); font-size: var(--fs-code); color: var(--accent); background: var(--surface-2); padding: 1px 5px; border-radius: 3px; }
  .flow-order code { display: inline-block; color: var(--text-primary); padding: 8px 12px; }
  .legend { list-style: none; padding: 0; }
  .legend li { display: flex; align-items: center; gap: 9px; }
  .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; flex: 0 0 auto; }
  .back { margin-top: 28px; }
  .back a, a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
