<script>
  import { onMount } from 'svelte';
  import Navbar from '$lib/components/Navbar.svelte';
  import ShortcutsModal from '$lib/components/ShortcutsModal.svelte';
  import ConnectionsModal from '$lib/components/ConnectionsModal.svelte';
  import ExecutionOrder from '$lib/components/ExecutionOrder.svelte';
  import { readPreference, applyTheme, watchSystem } from '$lib/theme.js';

  let theme = $state('system');
  let shortcutsOpen = $state(false);
  let connectionsOpen = $state(false);

  onMount(() => {
    theme = readPreference();
    applyTheme(theme);
    return watchSystem(() => theme);
  });

  function setTheme(next) {
    theme = next;
    applyTheme(next, true);
  }

  // Section anchors, kept alongside the headings they point at.
  const TOC = [
    ['engine', 'Engine yang didukung'],
    ['cara-pakai', 'Cara pakai'],
    ['urutan', 'Urutan eksekusi SQL'],
    ['optimize', 'Tab Optimize'],
    ['mongo', 'MongoDB — alur pipeline'],
    ['warna', 'Warna node'],
    ['severity', 'Severity temuan'],
    ['convert', 'Convert antar-dialek'],
    ['query', 'Menjalankan query'],
    ['koneksi', 'Koneksi & kredensial'],
    ['read-only', 'Koneksi read-only & konfirmasi tulis'],
    ['tls', 'TLS & verifikasi sertifikat'],
    ['log', 'Tab Log — processlist'],
    ['tables', 'Tab Tables — jelajah & edit'],
    ['ekspor-tabel', 'Ekspor isi tabel'],
    ['hentikan-sesi', 'Menghentikan sesi'],
    ['antrian', 'Tab Antrian — Redis & worker'],
    ['pustaka', 'Riwayat & query tersimpan'],
    ['editor', 'Bantuan editor'],
    ['batasan', 'Catatan & batasan']
  ];
</script>

<svelte:head>
  <title>Dokumentasi — QueryFlow</title>
</svelte:head>

<div class="app">
  <Navbar active="docs" {theme} onthemechange={setTheme}
    onshortcuts={() => (shortcutsOpen = true)} onconnections={() => (connectionsOpen = true)} />
  <div class="doc-scroll">
    <article class="doc">
      <h1>QueryFlow — Dokumentasi</h1>
      <p class="lead">Visualisasi alur eksekusi & debugger statis untuk query kompleks. Mendukung <strong>SQL</strong> (MariaDB, MySQL, PostgreSQL) dan <strong>NoSQL</strong> (MongoDB aggregation pipeline). Semua analisa berjalan <strong>lokal di browser</strong> — query tidak dikirim ke server.</p>

      <nav class="toc" aria-label="Daftar isi">
        <span class="toc-title">Isi halaman</span>
        <ul>
          {#each TOC as [id, label] (id)}
            <li><a href={'#' + id}>{label}</a></li>
          {/each}
        </ul>
      </nav>

      <h2 id="engine">Engine yang didukung</h2>
      <ul>
        <li><strong>MariaDB / MySQL</strong> — dialek default; identifier yang bentrok keyword (mis. <code>status</code>) di-quote otomatis.</li>
        <li><strong>PostgreSQL</strong> — termasuk <code>ILIKE</code>, <code>DATE_TRUNC()</code>, <code>STRING_AGG()</code>, dll.</li>
        <li><strong>MongoDB</strong> — pipeline <code>db.coll.aggregate([…])</code> dan <code>find()</code>. Stage pipeline dipetakan langsung ke node alur (sudah dalam urutan eksekusi).</li>
      </ul>
      <p>Pilih engine lewat dropdown di toolbar. Sampel query otomatis menyesuaikan saat berpindah antara SQL dan MongoDB.</p>

      <h2 id="cara-pakai">Cara pakai</h2>
      <ol>
        <li>Tempel query SQL pada editor (atau upload file <code>.sql</code> / drag-drop).</li>
        <li>Klik <strong>Analisa</strong> (atau ⌘/Ctrl+Enter).</li>
        <li>Telusuri diagram alur di kiri; klik node untuk detail & penjelasan fungsi.</li>
        <li>Lihat temuan masalah di panel kanan; klik temuan untuk menyorot node terkait.</li>
        <li>Export diagram (PNG/SVG) atau analisa (Markdown), atau salin link share.</li>
      </ol>

      <h2 id="urutan">Urutan eksekusi SQL — bagaimana query sebenarnya dijalankan</h2>

      <ExecutionOrder />

      <h3>Kenapa ini penting dipahami</h3>
      <p>Tiga kesalahan yang paling sering muncul semuanya berakar pada urutan di atas:</p>
      <ul>
        <li><strong>Alias tidak dikenali di WHERE.</strong> <code>SELECT harga * qty AS total … WHERE total &gt; 100</code> gagal, karena <code>WHERE</code> berjalan sebelum <code>SELECT</code> membuat alias <code>total</code>. Solusinya: ulangi ekspresinya di <code>WHERE</code>, atau bungkus query-nya.</li>
        <li><strong>Agregat ditolak di WHERE.</strong> <code>WHERE COUNT(*) &gt; 5</code> tidak valid karena pada saat <code>WHERE</code> dijalankan, pengelompokan belum terjadi sehingga <code>COUNT(*)</code> belum punya nilai. Filter atas hasil agregat masuk ke <code>HAVING</code>.</li>
        <li><strong>LEFT JOIN berubah jadi INNER.</strong> Menaruh kondisi tabel kanan di <code>WHERE</code> (bukan di <code>ON</code>) membuang baris yang kolom kanannya <code>NULL</code> — dan itu justru baris yang membuat <code>LEFT JOIN</code> berguna.</li>
      </ul>

      <h3>Diagram di Visualizer memakai urutan ini</h3>
      <p>Node pada diagram disusun mengikuti urutan eksekusi, bukan urutan penulisan — jadi membacanya dari atas ke bawah sama dengan mengikuti langkah kerja engine. CTE dan subquery jadi sub-blok yang bisa di-collapse; subquery korelasi ditandai garis coral putus-putus dan ikon <code>⟲</code> karena ia dijalankan ulang untuk setiap baris luar.</p>
      <p class="warn">
        <strong>Ini urutan <em>logis</em>, bukan urutan fisik.</strong> Optimizer database bebas menyusun ulang selama hasilnya sama — misalnya mendorong filter lebih awal, menukar urutan join, atau melewati sorting karena sudah ada index yang urutannya cocok. Urutan logis menentukan <em>arti</em> query; rencana eksekusi sebenarnya bisa dilihat lewat <code>EXPLAIN</code>.
      </p>

      <h3>Cek index yang sudah terpasang</h3>
      <p>Saran index disusun dari teks query, jadi tanpa bantuan ia tidak tahu index mana yang sebenarnya sudah ada. Tombol <strong>Cek index terpasang</strong> di tab Optimize membacanya langsung dari katalog database lewat koneksi yang dipilih (<code>information_schema.STATISTICS</code>, <code>pg_index</code>, atau <code>listIndexes</code> di MongoDB) — semuanya operasi baca yang murah, tidak menyentuh isi tabel.</p>
      <p>Setiap saran lalu ditandai:</p>
      <ul>
        <li><strong>Sudah ada</strong> — ada index yang menutup semua kolom yang diminta, dari kolom pertama secara berurutan. Kartunya diredupkan supaya tidak ikut jadi daftar pekerjaan.</li>
        <li><strong>Ada sebagian</strong> — index yang ada cocok di kolom depan tapi tidak seluruhnya; nama index dan berapa kolom yang tercakup ikut ditampilkan.</li>
        <li><strong>Belum ada</strong> — tidak ada index yang bisa melayaninya.</li>
      </ul>
      <p>Urutan kolom ikut dinilai: index <code>(created_at, status)</code> tidak dianggap melayani query yang menyaring <code>status</code> lebih dulu, karena memang tidak bisa.</p>
      <p>Di bawahnya ada daftar <strong>index yang mungkin mubazir</strong>: index yang kolomnya persis awalan dari index lain yang lebih panjang, jadi query yang bisa dilayani index itu juga dilayani index yang panjang — sementara biaya tulis dan ruangnya tetap dibayar. Primary key tidak pernah masuk daftar ini (ia menegakkan constraint, bukan sekadar kecepatan), begitu juga index unik yang tidak tergantikan oleh index non-unik yang lebih lebar.</p>
      <p>Hasil pemeriksaan ditahan lima menit per koneksi + kumpulan tabel, jadi menekan <strong>Analisa</strong> berulang kali tidak memaksa cek ulang. Query yang menyentuh tabel lain selalu memulai dari nol, bukan meminjam jawaban query sebelumnya.</p>

      <h2 id="mongo">MongoDB — alur pipeline</h2>
      <p>Tiap stage jadi satu node dengan urutan persis seperti ditulis (pipeline = urutan eksekusi):</p>
      <p class="flow-order"><code>$match → $lookup → $unwind → $group → $sort → $limit</code></p>
      <p>Warna mengikuti makna yang sama: <code>$match</code> (filter, coral), <code>$lookup</code> (join, biru), <code>$group</code> (agregasi, ungu), <code>$project/$addFields</code> (output, teal). <code>$lookup</code> dengan sub-pipeline & <code>$facet</code> jadi sub-blok. Analisa Mongo mencakup: $match terlambat, scan tanpa $match, $where/$function, regex tanpa anchor, $unwind tanpa filter, $sort tanpa $limit, deep $skip.</p>

      <h2 id="optimize">Tab Optimize</h2>
      <p>Di panel kanan Visualizer, tab <strong>Analisa</strong> menjawab "apa yang salah dengan query ini?", sedangkan tab <strong>Optimize</strong> menjawab pertanyaan yang berbeda: "apa yang perlu diubah supaya lebih cepat?".</p>
      <ul>
        <li><strong>Verdict &amp; skor</strong> — ringkasan apakah query sudah rapi, masih bisa dioptimalkan, atau belum optimal. Skornya turunan dari jumlah dan bobot saran, bukan hasil pengukuran.</li>
        <li><strong>Daftar perbaikan</strong> — hanya temuan yang berdampak ke kecepatan, diurutkan berdasarkan dampak (besar → kecil). Temuan soal kebenaran dan gaya penulisan tetap di tab Analisa.</li>
        <li><strong>Index yang diminta query</strong> — disusun dari kolom yang difilter, di-join, dan diurutkan, lengkap dengan DDL siap salin. Urutan kolomnya penting: kolom <em>equality</em> lebih dulu, baru rentang dan sorting; untuk MongoDB mengikuti pola Equality → Sort → Range.</li>
        <li><strong>Checklist</strong> — daftar hal yang diperiksa, supaya query yang bersih pun tetap memberi informasi.</li>
      </ul>
      <p class="warn">
        <strong>QueryFlow tidak tahu index apa yang sudah ada.</strong> Ia hanya membaca teks query — tanpa akses ke statistik tabel, ukuran data, maupun selektivitas filter. Jadi setiap saran index berarti "periksa ini", bukan "ini pasti kurang". Cek dulu index yang terpasang, lalu ukur dengan <code>EXPLAIN</code> sebelum dan sesudah mengubah. Setiap index mempercepat baca tapi memperlambat tulis dan memakan ruang.
      </p>

      <h3>EXPLAIN sungguhan, ditumpuk ke diagram</h3>
      <p>Di atas daftar saran, panel EXPLAIN menjalankan rencana eksekusi <strong>sungguhan</strong> dari database yang terhubung — bukan perkiraan dari teks query. Pilih koneksi, klik <strong>Jalankan EXPLAIN</strong>, dan setiap node <code>FROM</code>/<code>JOIN</code> di diagram mendapat tanda kecil: <span style="color:var(--success)">✓ hijau</span> bila index terpakai, <span style="color:var(--sev-critical)">! merah</span> bila full scan. Arahkan kursor ke tandanya untuk detail (index yang dipakai, jumlah baris, waktu).</p>
      <ul>
        <li><strong>PostgreSQL</strong> — <code>EXPLAIN (FORMAT JSON)</code> untuk estimasi, atau centang <strong>Sertakan ANALYZE</strong> untuk angka nyata (baris & waktu aktual). ANALYZE benar-benar menjalankan query.</li>
        <li><strong>MySQL/MariaDB</strong> — <code>EXPLAIN FORMAT=JSON</code>. Tidak pernah mengeksekusi query, jadi hanya estimasi planner — tidak ada mode ANALYZE untuk dialek ini (belum ada format JSON yang stabil lintas versi).</li>
        <li><strong>MongoDB</strong> — <code>explain('executionStats')</code>. Dibangun mengikuti API resmi MongoDB, tapi belum pernah diuji ke <code>mongod</code> sungguhan — anggap best-effort.</li>
      </ul>
      <p class="warn">
        <strong>EXPLAIN ANALYZE benar-benar mengeksekusi statement</strong> — termasuk <code>UPDATE</code>/<code>DELETE</code> bila diarahkan ke situ, karena begitulah cara PostgreSQL mengukur waktu nyata. QueryFlow menolak ANALYZE untuk apa pun selain <code>SELECT</code>/<code>WITH</code> di sisi server, terlepas dari apa yang ditampilkan UI. <code>EXPLAIN</code> biasa (tanpa ANALYZE) tidak pernah mengeksekusi, di semua engine.
      </p>
      <p>Tombol EXPLAIN nonaktif setiap kali editor punya perubahan yang belum dianalisa ulang. Alasannya teknis tapi penting: id node diagram dibuat ulang setiap kali Analisa dijalankan, jadi query yang diedit tanpa Analisa ulang bisa memakai id node dari diagram lama — tanda EXPLAIN bisa salah tempel ke node yang sudah berarti lain. Klik <strong>Analisa</strong> dulu untuk mengaktifkannya lagi.</p>

      <h2 id="warna">Warna node (semantik)</h2>
      <ul class="legend">
        <li><span class="sw" style="background:var(--c-gray)"></span> Netral — FROM, ORDER BY, LIMIT</li>
        <li><span class="sw" style="background:var(--c-blue)"></span> JOIN — penggabungan data</li>
        <li><span class="sw" style="background:var(--c-coral)"></span> WHERE / HAVING — penyaringan</li>
        <li><span class="sw" style="background:var(--c-purple)"></span> GROUP BY — pengelompokan</li>
        <li><span class="sw" style="background:var(--c-teal)"></span> SELECT — pembentukan hasil</li>
      </ul>

      <h2 id="severity">Severity temuan</h2>
      <ul class="legend">
        <li><span class="sw" style="background:var(--sev-critical)"></span> Critical — berpotensi salah hasil / lock / cartesian</li>
        <li><span class="sw" style="background:var(--sev-warning)"></span> Warning — risiko performa (index, N+1, wildcard)</li>
        <li><span class="sw" style="background:var(--sev-info)"></span> Info — gaya / best-practice</li>
      </ul>

      <h2 id="convert">Convert antar-dialek</h2>
      <p>Tombol <strong>Convert</strong> di toolbar menerjemahkan query aktif ke dialek lain (MariaDB ↔ MySQL ↔ PostgreSQL ↔ MongoDB). Hasilnya bisa langsung disalin atau dimuat ke editor.</p>
      <ul>
        <li><strong>SQL ↔ SQL</strong> — re-emit lewat parser; penyesuaian kutip identifier (backtick ↔ kutip ganda) & sintaks dasar.</li>
        <li><strong>SQL → MongoDB</strong> — WHERE→$match, JOIN→$lookup+$unwind, GROUP BY/agregat→$group, HAVING→$match, ORDER BY→$sort, LIMIT→$limit.</li>
        <li><strong>MongoDB → SQL</strong> — kebalikannya untuk stage umum.</li>
      </ul>
      <p>Konversi bersifat <strong>best-effort</strong>: konstruksi yang tidak punya padanan langsung (subquery, window function, $expr, $where, dll) dilewati dan dilaporkan sebagai catatan. Selalu verifikasi hasil sebelum dipakai di produksi.</p>

      <h2 id="query">Menjalankan query ke database</h2>
      <p>Tab <strong>Query</strong> menjalankan statement ke database yang kamu konfigurasi, lalu menampilkan barisnya di grid (bisa diurutkan, disalin sebagai TSV, atau diunduh sebagai CSV).</p>
      <p><strong>Kenapa butuh server?</strong> Browser tidak bisa membuka koneksi TCP, jadi tidak bisa berbicara protokol MySQL/PostgreSQL/MongoDB. Karena itu QueryFlow menjalankan proses Node kecil di mesinmu yang memegang driver dan kredensial. Visualizer sendiri tetap sepenuhnya berjalan di browser.</p>
      <p>Query bisa dilempar bolak-balik: tombol <strong>Visualisasikan</strong> di tab Query membuka statement itu di Visualizer, dan tombol <strong>Jalankan</strong> di Visualizer mengirimnya ke tab Query.</p>
      <p class="warn">
        <strong>Tidak ada pembatasan statement.</strong> Apa pun yang diizinkan untuk user database tersebut akan dijalankan &mdash; termasuk <code>UPDATE</code>, <code>DELETE</code>, dan DDL. Arahkan hanya ke database yang memang boleh berubah. Opsi <em>Maks baris</em> hanya membatasi berapa baris yang dikirim ke browser, bukan efek statement-nya di server.
      </p>
      <p>Untuk MongoDB, <code>db.&lt;koleksi&gt;.&lt;method&gt;(...)</code> <strong>diparse, bukan di-eval</strong> &mdash; server memegang kredensial hidup, jadi mengeksekusi teks dari browser sebagai JavaScript sama dengan membuka celah eksekusi kode. Yang didukung: <code>find</code>, <code>findOne</code>, <code>aggregate</code>, <code>countDocuments</code>, <code>distinct</code>, <code>listIndexes</code>, keluarga <code>insert*</code>/<code>update*</code>/<code>delete*</code>/<code>findOneAnd*</code>, <code>bulkWrite</code>, <code>createIndex</code>, <code>dropIndex</code>, <code>drop</code>, plus modifier <code>.sort()</code>/<code>.limit()</code>/<code>.skip()</code> dan helper <code>ObjectId()</code>/<code>ISODate()</code>/<code>NumberDecimal()</code>.</p>

      <h2 id="koneksi">Koneksi &amp; kredensial</h2>
      <p>Buka ikon colokan di navbar (tersedia di semua tab) untuk menambah, mengubah, menguji, atau menghapus koneksi.</p>
      <p>Profil disimpan di file pada mesin yang menjalankan server:</p>
      <p class="flow-order"><code>.queryflow/connections.json</code></p>
      <ul>
        <li>Dibuat dengan mode <code>0600</code> dan sudah masuk <code>.gitignore</code>.</li>
        <li><strong>Password tidak pernah sampai ke browser.</strong> API hanya mengembalikan bentuk teredaksi; URI disamarkan.</li>
        <li>Saat mengubah koneksi, mengosongkan kolom password berarti "pakai yang tersimpan", bukan "hapus password".</li>
        <li>Lokasi file bisa diubah lewat environment variable <code>QUERYFLOW_CONFIG</code>.</li>
      </ul>
      <p class="warn">
        <strong>Jangan diekspos ke jaringan.</strong> Server ini menyimpan kredensial database dan menjalankan statement apa pun, tanpa lapisan autentikasi. <code>npm start</code> sudah mengikatnya ke <code>127.0.0.1</code> saja. Siapa pun yang bisa menjangkau port-nya punya akses penuh ke semua database yang terkonfigurasi.
      </p>

      <h2 id="read-only">Koneksi read-only &amp; konfirmasi tulis</h2>
      <p>Dua lapis pengaman supaya koneksi produksi tidak berubah karena salah tab atau salah tekan.</p>

      <h3>Tanda read-only pada profil koneksi</h3>
      <p>Centang <strong>Read-only</strong> saat menambah/mengubah koneksi. Efeknya ditegakkan di <em>server</em>, bukan di tampilan:</p>
      <ul>
        <li>Tab Query menolak semua statement yang menulis — <code>INSERT</code>, <code>UPDATE</code>, <code>DELETE</code>, <code>DROP</code>, <code>TRUNCATE</code>, <code>CALL</code>, sampai CTE yang berujung <code>DELETE</code> dan <code>SELECT … INTO OUTFILE</code>. Untuk MongoDB: semua method tulis, termasuk <code>aggregate</code> dengan <code>$out</code>/<code>$merge</code>.</li>
        <li><code>SELECT … FOR UPDATE</code> dan <code>LOCK IN SHARE MODE</code> ikut ditolak: keduanya memang membaca, tapi mengunci baris di produksi.</li>
        <li>Tab Tables mematikan edit sel, tambah baris, dan hapus baris; alasannya ditulis di grid.</li>
        <li>Yang tidak bisa dibuktikan sebagai bacaan dianggap tulisan. Statement yang tidak dikenali ikut ditolak, bukan diloloskan.</li>
      </ul>
      <p class="warn">
        <strong>Ini bukan pengganti privilege database.</strong> Tanda read-only ada di profil koneksi di mesin ini, jadi hanya berlaku untuk QueryFlow. Pengaman yang sesungguhnya tetap user database yang memang hanya punya hak <code>SELECT</code>.
      </p>

      <h3>Konfirmasi sebelum menulis</h3>
      <p>Pada koneksi yang <em>tidak</em> read-only, statement yang menulis selalu berhenti dulu di dialog konfirmasi yang menyebut koneksi tujuan, jenis perintah, dan teks statement-nya. Dialog akan berwarna merah kalau statement-nya:</p>
      <ul>
        <li><strong>tanpa filter</strong> — <code>UPDATE</code>/<code>DELETE</code> tanpa <code>WHERE</code>, atau <code>updateMany(&#123;&#125;)</code>/<code>deleteMany(&#123;&#125;)</code>;</li>
        <li><strong>merusak</strong> — <code>DROP</code>, <code>TRUNCATE</code>, <code>ALTER</code>, <code>db.coll.drop()</code>, dan sejenisnya.</li>
      </ul>
      <p>Untuk penulisan biasa yang sudah terfilter, ada pilihan <em>jangan tanya lagi untuk koneksi ini selama sesi ini</em>. Pilihan itu <strong>tidak pernah</strong> berlaku untuk statement tanpa filter atau yang merusak — keduanya selalu menanyakan konfirmasi, sesering apa pun dijalankan.</p>

      <h2 id="tls">TLS &amp; verifikasi sertifikat</h2>
      <p>Pilihan <strong>TLS/SSL</strong> pada profil koneksi menentukan apa yang benar-benar diperiksa, bukan sekadar hidup/mati:</p>
      <ul>
        <li><strong>Nonaktif</strong> — koneksi polos, tanpa enkripsi.</li>
        <li><strong>Aktif, tanpa verifikasi</strong> — trafik terenkripsi, tapi identitas server tidak dicek sama sekali. Sertifikat palsu tetap diterima, jadi enkripsinya tidak melindungi dari man-in-the-middle. Ini perilaku lama QueryFlow, dan profil lama otomatis memakai mode ini.</li>
        <li><strong>Verifikasi CA</strong> — sertifikat server harus ditandatangani CA yang dipercaya; nama host tidak dicocokkan. Ini mode untuk database yang diakses lewat <code>kubectl port-forward</code> atau alamat IP, di mana hostname memang tidak akan pernah cocok.</li>
        <li><strong>Verifikasi CA + hostname</strong> — rantai sertifikat <em>dan</em> nama host harus cocok. Pakai ini kalau bisa.</li>
      </ul>
      <p>Isian <strong>Sertifikat CA</strong> menerima path ke file <code>.pem</code> (mis. CA bundle RDS) atau isi PEM yang ditempel langsung. Kalau dikosongkan, yang dipakai adalah CA bawaan sistem. Path yang salah ditolak saat menyimpan, bukan dibiarkan jadi kegagalan handshake yang membingungkan nanti.</p>
      <p class="warn">
        <strong>Catatan driver MySQL/MariaDB.</strong> Pustaka <code>mysql2</code> melewati pengecekan nama host bila host diisi alamat IP — pada kasus itu <em>Verifikasi CA + hostname</em> efektif sama dengan <em>Verifikasi CA</em>. Isi host dengan nama DNS kalau ingin nama host benar-benar dicocokkan. PostgreSQL, MongoDB, dan Redis tidak punya batasan ini.
      </p>
      <p>Sertifikat klien (mTLS) belum didukung.</p>

      <h2 id="log">Tab Log — processlist &amp; koneksi</h2>
      <p>Tab <strong>Log</strong> menampilkan sesi yang sedang terbuka di server database, plus ringkasan berapa koneksi yang terpakai dari kapasitasnya.</p>
      <ul>
        <li><strong>Koneksi terbuka</strong> — jumlah sesi klien berbanding <code>max_connections</code> (atau <code>current + available</code> di MongoDB), dengan bar kapasitas yang berubah kuning di 70% dan merah di 90%.</li>
        <li><strong>Aktif vs idle</strong> — dihitung dari status yang dilaporkan server, bukan ditebak dari teks: <code>Threads_running</code> di MySQL/MariaDB, <code>state = 'active'</code> di PostgreSQL, <code>connections.active</code> di MongoDB.</li>
        <li><strong>Processlist</strong> — ID, user, client, database, command, state, durasi, dan teks query. Bisa diurutkan per kolom dan disaring.</li>
        <li>Sesi yang berjalan &ge;10 detik ditandai kuning dan &ge;60 detik merah, supaya query nyangkut langsung terlihat.</li>
        <li>Proses internal server (checkpointer, autovacuum, walwriter di PostgreSQL) disembunyikan secara default dan dihitung terpisah.</li>
        <li>Klik teks query mana pun untuk membukanya langsung di Visualizer.</li>
      </ul>
      <p>Sumber datanya: <code>information_schema.PROCESSLIST</code> + <code>SHOW GLOBAL STATUS</code> (MySQL/MariaDB), <code>pg_stat_activity</code> + <code>pg_settings</code> (PostgreSQL), <code>currentOp</code> + <code>serverStatus</code> (MongoDB).</p>
      <p>Refresh bisa manual (<code>⌘/Ctrl+R</code>) atau otomatis tiap 2/5/15 detik.</p>
      <p class="warn">
        <strong>Butuh hak baca khusus.</strong> Melihat sesi milik user lain memerlukan privilege <code>PROCESS</code> (MySQL/MariaDB), <code>pg_read_all_stats</code> atau superuser (PostgreSQL), atau role <code>clusterMonitor</code> (MongoDB). Tanpa itu daftarnya hanya berisi sesi milikmu sendiri &mdash; QueryFlow menandai kondisi ini secara eksplisit, dan angka ringkasan tetap diambil dari counter server sehingga tetap akurat.
      </p>

      <h2 id="antrian">Tab Antrian — Redis, job &amp; worker</h2>
      <p>Tab <strong>Antrian</strong> membaca antrian job yang tersimpan di Redis: berapa job menumpuk, mana yang gagal, dan worker mana yang masih hidup. Tambahkan koneksi dengan dialek <strong>Redis</strong> (port default 6379, kolom <em>DB index</em> diisi angka, mis. <code>0</code>) lewat <strong>Kelola koneksi</strong>.</p>
      <p>Sistem antrian yang dikenali otomatis — satu Redis boleh memuat ketiganya sekaligus:</p>
      <ul>
        <li><strong>python-rq</strong> (dipakai Frappe/ERPNext) — <code>rq:queue:*</code>, registry <code>rq:wip|failed|finished|deferred|scheduled|canceled:*</code>, worker dari <code>rq:workers</code> lengkap dengan heartbeat, job yang sedang dikerjakan, dan hitungan sukses/gagal.</li>
        <li><strong>BullMQ / Bull</strong> — <code>bull:&lt;antrian&gt;:*</code> beserta status <em>wait, active, delayed, prioritized, failed, completed</em>. BullMQ tidak menyimpan daftar worker di Redis, jadi worker dibaca dari <code>CLIENT LIST</code> (bisa dibatasi ACL).</li>
        <li><strong>Sidekiq</strong> — set <code>queues</code>, zset <code>retry</code>/<code>schedule</code>/<code>dead</code>, dan proses dari set <code>processes</code>.</li>
      </ul>
      <ul>
        <li><strong>Worker basi tersorot.</strong> Heartbeat &gt;2 menit ditandai kuning dan &gt;5 menit merah — antrian yang tidak turun padahal pod terlihat <em>Running</em> hampir selalu berawal dari sini.</li>
        <li><strong>Antrian dijeda ditandai.</strong> BullMQ memarkir job di list <code>paused</code>; kalau tidak ditandai, backlog terlihat wajar padahal tidak ada yang mengonsumsi.</li>
        <li><strong>Eviction Redis diperingatkan.</strong> Kalau <code>evicted_keys</code> &gt; 0, job bisa hilang dari antrian tanpa pernah diproses; naikkan <code>maxmemory</code> dulu sebelum menambah worker.</li>
        <li>Klik nama antrian untuk melihat daftar job per status, termasuk payload, traceback kegagalan, lama menunggu, dan lama berjalan.</li>
      </ul>

      <h3>Tren, ambang peringatan, dan scheduler</h3>
      <ul>
        <li><strong>Tren backlog.</strong> Setiap kali halaman menarik data (manual atau otomatis), angkanya dicatat. Kolom <em>Tren</em> menampilkan sparkline beberapa sampel terakhir plus selisihnya, sehingga backlog 4.000 yang sedang turun bisa dibedakan dari yang sedang naik. Sampel disimpan di memori halaman, jadi ikut hilang saat browser di-reload.</li>
        <li><strong>Ambang peringatan.</strong> Antrian dan worker yang melewati batas muncul di panel <em>perlu perhatian</em> dan barisnya diwarnai. Batasnya bisa diubah lewat tombol <strong>Ambang batas</strong> — backlog, jumlah gagal, dan umur heartbeat, masing-masing untuk level kuning dan merah — lalu diingat di browser ini.</li>
        <li><strong>rq-scheduler.</strong> Job terjadwal disimpan di zset tersendiri (<code>rq:scheduler:scheduled_jobs</code>) dan tidak terhitung di antrian mana pun. QueryFlow menampilkan jumlahnya, waktu jalan berikutnya, dan memperingatkan kalau job yang sudah jatuh tempo tak kunjung diambil — tanda scheduler mati, yang dari sisi antrian terlihat persis seperti sistem yang sedang sepi.</li>
      </ul>

      <h3>Sentinel &amp; Cluster</h3>
      <p>Selain <strong>Standalone</strong>, koneksi Redis bisa disetel ke:</p>
      <ul>
        <li><strong>Sentinel</strong> — isi daftar sentinel (mis. <code>sentinel-0:26379, sentinel-1:26379</code>) dan nama master. Master ditanyakan ke sentinel, jadi setelah failover koneksi ikut berpindah, bukan menempel di replika.</li>
        <li><strong>Cluster</strong> — isi beberapa node sebagai titik masuk. Karena keyspace terbagi antar master, penelusuran key dijalankan ke <em>setiap</em> master; tanpa itu sebagian besar antrian tidak akan terlihat. Indeks database selalu 0 di mode cluster.</li>
      </ul>

      <h3>Ekspor</h3>
      <p>Tiga tombol unduh tersedia: <strong>Ekspor antrian</strong> (ringkasan semua antrian, CSV), <strong>Ekspor worker</strong> (CSV), dan di dalam panel job tombol <strong>CSV</strong> / <strong>JSON</strong> untuk seluruh job pada antrian &amp; status yang sedang dibuka — bukan hanya halaman yang tampil. Berkas dibatasi 20.000 job per unduhan; kalau terpotong, versi JSON menuliskannya di field <code>truncated</code>. CSV memakai BOM UTF-8 agar Excel membacanya benar, dan sel yang diawali <code>=</code>, <code>+</code>, <code>-</code>, atau <code>@</code> diberi awalan kutip supaya payload job tidak dieksekusi sebagai formula.</p>
      <p class="warn">
        <strong>Hanya membaca.</strong> Semua perintah ke Redis bersifat baca (<code>SCAN</code>, <code>LRANGE</code>, <code>ZRANGE</code>, <code>HGETALL</code>, <code>INFO</code>). QueryFlow tidak pernah mengambil, mengulang, atau menghapus job. Penelusuran key memakai <code>SCAN</code>, bukan <code>KEYS</code>, agar Redis produksi tidak terblokir.
      </p>

      <h2 id="ekspor-tabel">Ekspor isi tabel</h2>
      <p>Tombol <strong>Ekspor CSV / JSON</strong> di tab Tables mengunduh <em>seluruh</em> isi tabel — bukan hanya halaman yang sedang tampil, dan bukan hanya 5.000 baris yang sudah diambil browser seperti tombol salin di grid hasil query.</p>
      <ul>
        <li><strong>Mengikuti tampilan.</strong> Kalau sedang difilter (mis. hasil navigasi foreign key), yang terunduh hanya baris yang cocok — labelnya berubah jadi <em>Ekspor hasil filter</em>. Urutannya juga sama dengan yang di layar.</li>
        <li><strong>Dibaca bertahap di server</strong> lalu langsung dialirkan ke berkas, jadi tabel jutaan baris hanya memakan memori sebesar satu halaman, bukan seluruh isi tabel.</li>
        <li><strong>Urutan dikunci ke primary key</strong> kalau tidak ada urutan lain. Tanpa itu, paging di tengah ekspor bisa melewati atau menggandakan baris — dan pada berkas 200.000 baris tidak akan ada yang sadar.</li>
        <li><strong>Batas 200.000 baris</strong> per unduhan; kalau terpotong, CSV menuliskannya di baris terakhir dan JSON di field <code>truncated</code>.</li>
        <li>Sel yang diawali <code>=</code>, <code>+</code>, <code>-</code>, atau <code>@</code> diberi awalan kutip agar isi tabel tidak dieksekusi sebagai formula saat dibuka di Excel.</li>
      </ul>

      <h2 id="hentikan-sesi">Menghentikan sesi</h2>
      <p>Di tab Log, arahkan kursor ke baris sesi mana pun untuk memunculkan tombol <i class="ti ti-hand-stop"></i>. Dialog konfirmasinya menyebut server, user, database, sudah berjalan berapa lama, dan teks query-nya — lalu menawarkan dua hal yang <em>berbeda</em>:</p>
      <ul>
        <li><strong>Batalkan query saja</strong> — <code>KILL QUERY</code> (MySQL/MariaDB), <code>pg_cancel_backend()</code> (PostgreSQL), <code>killOp</code> (MongoDB). Statement-nya dibatalkan, koneksinya tetap hidup.</li>
        <li><strong>Putus koneksinya</strong> — <code>KILL</code> atau <code>pg_terminate_backend()</code>. Seluruh sesi ditutup dan aplikasi pemiliknya melihat koneksi terputus. MongoDB tidak punya padanannya, jadi pilihan ini tidak ditawarkan di sana.</li>
      </ul>
      <p>Pengaman yang berlaku sebelum sinyal dikirim:</p>
      <ul>
        <li><strong>Daftar sesi dibaca ulang di server</strong>, bukan dipercaya dari browser. Sesi yang sudah selesai ditolak dengan jelas — kalau tidak, id yang sudah dipakai ulang bisa mengenai sesi lain yang tidak bersalah.</li>
        <li><strong>Proses internal server ditolak</strong> (checkpointer, walwriter, autovacuum, thread Daemon MySQL).</li>
        <li><strong>Sesi milik QueryFlow sendiri ditolak.</strong></li>
        <li><strong>Koneksi read-only menolak sepenuhnya.</strong> Membatalkan statement me-rollback apa pun yang sudah dikerjakannya, jadi ini termasuk mengubah keadaan server — persis yang dijanjikan tidak terjadi oleh tanda read-only. Lepas tandanya kalau memang perlu menghentikan sesi.</li>
      </ul>
      <p class="warn">
        <strong>Butuh hak khusus di database.</strong> Menghentikan sesi milik user lain memerlukan privilege <code>PROCESS</code>/<code>CONNECTION_ADMIN</code> (MySQL/MariaDB), <code>pg_signal_backend</code> atau superuser (PostgreSQL), dan <code>killop</code> (MongoDB). Tanpa itu server akan menolak, dan pesan penolakannya ditampilkan apa adanya.
      </p>

      <h2 id="pustaka">Riwayat &amp; query tersimpan</h2>
      <p>Tombol <strong>Riwayat</strong> di tab Query (atau <code>⌘/Ctrl+K</code>) membuka dua daftar yang sengaja dipisah:</p>
      <ul>
        <li><strong>Riwayat</strong> — semua query yang pernah dijalankan di browser ini, lengkap dengan koneksi, durasi, jumlah baris, dan berhasil/gagal. Tersimpan di <code>localStorage</code> (maksimal 100 entri) sehingga <em>tetap ada setelah tab ditutup</em> — sebelumnya riwayat hilang begitu sesi berakhir. Menjalankan query yang sama tidak menambah entri baru, hanya memindahkannya ke atas.</li>
        <li><strong>Tersimpan</strong> — query yang kamu beri nama sendiri, disimpan di <code>.queryflow/queries.json</code> pada mesin ini. Karena berupa file, isinya selamat walau data situs browser dibersihkan, dan bisa ikut dibaca/di-backup seperti file lain.</li>
      </ul>
      <p>Keduanya bisa dicari, dimuat ke editor dengan sekali klik, dan dihapus per entri.</p>

      <h2 id="editor">Bantuan editor</h2>
      <ul>
        <li>
          <strong>Autocomplete nama tabel &amp; kolom</strong> — hanya di tab <strong>Query</strong>, karena butuh koneksi database yang aktif. Tab Visualizer sengaja tetap murni lokal (query-nya tidak dikirim ke mana pun), jadi di sana tidak ada saran.
          <br />Tiga cara memunculkannya:
          <ul>
            <li><strong>Ketik minimal satu huruf</strong> — <code>SELECT * FROM sal…</code> menawarkan tabel yang cocok.</li>
            <li><strong>Ketik titik</strong> — <code>o.</code> pada <code>FROM sales_order o</code> langsung menampilkan seluruh kolom <code>sales_order</code>; alias dipahami, jadi kolom tabel lain tidak ikut.</li>
            <li><strong><kbd>Ctrl</kbd>+<kbd>Space</kbd></strong> — memunculkan daftar tabel walau belum mengetik apa pun. (<kbd>⌘</kbd>+<kbd>Space</kbd> tidak dipakai karena itu Spotlight di macOS.)</li>
          </ul>
          <kbd>↑</kbd>/<kbd>↓</kbd> memilih, <kbd>Tab</kbd>/<kbd>Enter</kbd> menerima, <kbd>Esc</kbd> menutup. Daftar tabel dibaca sekali per koneksi; kolom diambil hanya untuk tabel yang benar-benar disebut query.
        </li>
        <li><strong>Saran berhenti di dalam string dan komentar.</strong> Mengetik <code>WHERE nama = 'kolom</code> tidak memunculkan saran — menerimanya akan menulis ulang isi literal dan diam-diam mengubah baris mana yang cocok. Identifier berkutip (<code>`kolom</code>, <code>"kolom"</code>) tetap dilengkapi, karena itu memang nama.</li>
        <li><strong>Format SQL</strong> (<code>⌘/Ctrl+Shift+F</code>) merapikan indentasi dan huruf kapital kata kunci. Berlaku untuk MariaDB/MySQL/PostgreSQL; MongoDB belum didukung dan tombolnya dimatikan dengan keterangan.</li>
        <li><strong>Upload / drag-drop</strong> file <code>.sql</code> langsung ke editor.</li>
      </ul>

      <h2 id="tables">Tab Tables — jelajah &amp; edit isi tabel</h2>
      <p>Tab <strong>Tables</strong> menampilkan seluruh tabel pada database yang terhubung, lalu isinya bisa ditelusuri halaman demi halaman — bukan hanya seribu baris pertama.</p>
      <ul>
        <li><strong>Semua baris terjangkau.</strong> Navigasi halaman (100–5.000 baris per halaman) plus lompat ke nomor halaman tertentu.</li>
        <li><strong>Urutan otomatis mengikuti primary key.</strong> Tanpa <code>ORDER BY</code>, engine boleh mengembalikan baris dalam urutan apa pun — baris yang baru diupdate bisa berpindah, sehingga antar halaman ada yang terlewat atau terhitung dua kali. Karena itu QueryFlow mengurutkan berdasarkan primary key secara default.</li>
        <li><strong>Jumlah baris memakai perkiraan.</strong> <code>COUNT(*)</code> memindai seluruh tabel — pada tabel puluhan juta baris itu membebani database hanya untuk membuka tab. Yang tampil adalah estimasi statistik engine (ditandai <code>≈</code>), dan hitungan persis tersedia lewat tombol <em>hitung persis</em>.</li>
      </ul>

      <h3>Mengedit</h3>
      <p>Klik ikon pensil pada sebuah sel untuk membuka dialog <strong>Ubah nilai</strong> — bukan editor inline. Dialog itu menampilkan baris & kolom yang dituju, tipe datanya, diff <em>sebelum → sesudah</em>, dan perintah <code>UPDATE</code> yang persis akan dijalankan (nilainya tetap dikirim sebagai parameter terikat, bagian mentah itu hanya untuk dibaca). Tidak ada yang tersimpan sampai kamu menekan <strong>Simpan perubahan</strong>. Kolom nullable punya tombol <code>NULL</code>. Baris bisa ditambah dan dihapus dari grid yang sama.</p>
      <p><strong>Editing hanya aktif bila dua syarat terpenuhi:</strong></p>
      <ol>
        <li><strong>User database memang punya izinnya.</strong> Privilege dibaca langsung dari server — <code>has_table_privilege()</code> di PostgreSQL, <code>SHOW GRANTS</code> di MySQL/MariaDB (cakupan global, schema, maupun per-tabel), dan <code>connectionStatus</code> di MongoDB. Statusnya ditampilkan sebagai deretan <code>SELECT INSERT UPDATE DELETE</code>; yang tidak diizinkan dicoret.</li>
        <li><strong>Tabel punya primary key.</strong> Tanpa itu satu baris tidak bisa dialamatkan secara pasti, sehingga <code>UPDATE</code> berisiko mengenai baris lain. Tabel tanpa primary key tetap bisa dibaca dan ditambah barisnya, tapi tidak bisa diedit atau dihapus per baris.</li>
      </ol>
      <p>Kolom auto-increment, identity, dan generated ditandai ikon tongkat dan tidak bisa diketik — nilainya diisi database.</p>
      <p class="warn">
        <strong>Perubahan langsung kena ke database begitu dikonfirmasi.</strong> Tidak ada staging atau undo — begitu <strong>Simpan perubahan</strong> ditekan, <code>UPDATE</code> sudah dijalankan. Setiap perintah dibatasi ke satu baris lewat primary key dan akan ditolak bila ternyata mengenai jumlah baris yang berbeda, tapi nilai lama tidak disimpan di mana pun setelah tersimpan.
      </p>
      <p>Nama tabel dan kolom tidak pernah bisa dijadikan parameter di SQL, jadi keduanya divalidasi ketat lalu di-quote sesuai engine; seluruh <em>nilai</em> dikirim sebagai parameter terikat.</p>

      <h3>Navigasi foreign key</h3>
      <p>Kolom yang terdeteksi sebagai foreign key (<code>information_schema.KEY_COLUMN_USAGE</code> di MySQL/MariaDB, <code>pg_constraint</code> di PostgreSQL) tampil sebagai tautan biru bergaris bawah. Klik nilainya untuk berpindah ke tabel yang direferensikan, otomatis difilter ke baris yang persis dituju — muncul sebagai chip <em>"Difilter: kolom = nilai"</em> yang bisa dihapus kapan saja. Penghitung halaman pada tampilan terfilter mengikuti jumlah baris yang cocok, bukan jumlah seluruh tabel.</p>
      <p>Kolom yang sekaligus foreign key <em>dan</em> bisa diedit menampilkan dua kontrol terpisah — tautan navigasi dan tombol pensil — supaya satu klik tidak pernah ambigu antara "pindah ke sana" dan "ubah nilai ini".</p>
      <p>MongoDB tidak punya referensi yang ditegakkan sistem, jadi navigasi ini khusus SQL (MariaDB/MySQL/PostgreSQL).</p>

      <h2 id="batasan">Catatan & batasan (v1)</h2>
      <ul>
        <li>Analisa bersifat <strong>statis berbasis pola umum secara default</strong> — membaca teks query saja, tanpa rencana eksekusi, statistik, atau pengetahuan index. Panel EXPLAIN di tab Optimize menutup sebagian celah ini bila koneksi tersedia, tapi menjalankan query di tab Query tidak memengaruhi hasil analisa.</li>
        <li>Dialek: MariaDB/MySQL. Identifier yang bentrok dengan keyword parser (mis. <code>status</code>) di-quote otomatis.</li>
        <li>Hanya statement <code>SELECT</code> yang divisualisasikan.</li>
        <li>EXPLAIN MySQL/MariaDB tidak pernah melaporkan baris/waktu aktual (belum ada format JSON "analyze" yang stabil lintas versi) — hanya estimasi. Waktu nyata saat ini hanya tersedia lewat <code>ANALYZE</code> PostgreSQL.</li>
        <li>Pencocokan EXPLAIN ke diagram memakai alias tabel; tabel yang direferensikan tanpa node <code>FROM</code>/<code>JOIN</code> yang bisa dilihat QueryFlow (jarang terjadi) muncul sebagai "tidak cocok", bukan hilang diam-diam.</li>
        <li>Jalur EXPLAIN MongoDB dibangun mengikuti API resmi <code>explain()</code>, tapi belum pernah diuji ke <code>mongod</code> sungguhan di lingkungan ini — anggap best-effort sampai terverifikasi.</li>
        <li>Deteksi foreign key khusus SQL (MariaDB/MySQL/PostgreSQL); MongoDB tidak punya referensi yang ditegakkan sistem untuk dideteksi.</li>
        <li>Visualizer tidak menyentuh database sama sekali. Hanya tab Query, Log, Tables, dan panel EXPLAIN yang terhubung, dan hanya ke koneksi yang kamu konfigurasi sendiri.</li>
        <li>Tab Query menjalankan satu statement per eksekusi dan tidak punya autentikasi — ini alat pengembangan lokal.</li>
      </ul>

      <p class="back"><a href="/">← Kembali ke Visualizer</a></p>
    </article>
  </div>

  <ShortcutsModal open={shortcutsOpen} onclose={() => (shortcutsOpen = false)} />
  <ConnectionsModal open={connectionsOpen} onclose={() => (connectionsOpen = false)} />
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
  .warn {
    border: 0.5px solid var(--wash-warning-line); background: var(--wash-warning);
    border-radius: var(--radius); padding: 10px 14px;
  }
  .warn strong { color: var(--sev-warning); }
  .toc {
    border: 0.5px solid var(--border); background: var(--surface-1);
    border-radius: var(--radius); padding: 12px 16px; margin-bottom: 28px;
  }
  .toc-title {
    font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .toc ul { list-style: none; padding: 0; margin: 8px 0 0; columns: 2; column-gap: 24px; }
  .toc li { margin-bottom: 4px; break-inside: avoid; }
  .toc a { font-size: var(--fs-sub); color: var(--text-secondary); }
  .toc a:hover { color: var(--accent); }
  h2 { scroll-margin-top: 16px; }
  h3 { font-size: 13px; font-weight: 600; margin: 18px 0 8px; }
  @media (max-width: 560px) { .toc ul { columns: 1; } }
  a:hover { text-decoration: underline; }
</style>
