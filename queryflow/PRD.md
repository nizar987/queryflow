# PRD: SQL Query Visualizer & Debugger

**Versi:** 1.0
**Tanggal:** 30 Juni 2026
**Penulis:** Nizar
**Status:** Draft

---

## 1. Latar Belakang & Masalah

Saat melakukan debugging query SQL yang kompleks (multi-JOIN, subquery, CTE, window function, UNION), engineer kesulitan untuk:

- Memahami **urutan eksekusi logis** query — karena urutan penulisan SQL (`SELECT ... FROM ... WHERE ... GROUP BY ...`) berbeda dengan urutan eksekusi sebenarnya (`FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY`).
- Memahami **apa fungsi tiap bagian** query (fungsi agregat, window function, subquery korelasi, dsb) tanpa harus membaca dokumentasi berulang-ulang.
- Melihat **alur data** — dari tabel mana, di-filter di mana, di-join ke mana, sampai menghasilkan output kolom apa.

Hal ini relevan langsung dengan kebutuhan debugging query di stack Frappe/ERPNext + MariaDB (`tabVersion`, `tabComment`, `tabImport Tool Document`, dll), terutama saat investigasi query lambat, lock contention, atau replication lag yang root cause-nya ada di query kompleks.

## 2. Tujuan Produk

1. Memberi engineer **representasi visual** dari alur eksekusi query SQL, bukan hanya teks mentah.
2. Memberi **penjelasan ringkas per-bagian query** (klausa, fungsi, syntax) tanpa redundansi — tiap konsep dijelaskan sekali, direferensikan jika muncul berulang.
3. Mempercepat proses debug query kompleks dari hitungan puluhan menit (manual tracing) ke hitungan menit (visual + anotasi).

## 3. Target Pengguna

- **Primary:** Backend/Data engineer yang menulis dan men-debug query SQL kompleks (kasus pribadi: query Frappe ORM hasil generate, raw SQL untuk reporting/analytics).
- **Secondary:** Engineer junior yang sedang belajar membaca query SQL kompleks dari codebase.

## 4. Lingkup (In Scope)

### 4.1 Fitur Utama

**A. Parsing & Alur Eksekusi Query**
- Input: raw SQL (paste teks, atau upload `.sql`).
- Parser memecah query menjadi komponen logis: CTE, subquery, JOIN, WHERE, GROUP BY, HAVING, SELECT, ORDER BY, LIMIT, UNION/UNION ALL.
- Output: urutan **eksekusi logis** (bukan urutan penulisan), ditampilkan sebagai langkah bernomor.
- Mendukung nested subquery dan CTE rekursif (level nesting ditampilkan sebagai indentasi/grouping).

**B. Diagram Visual Alur Query**
- Render sebagai **flow diagram** (bukan sequence diagram klasik UML, tapi diagram alur data — node = tahap eksekusi, edge = aliran data/baris).
- Tiap node merepresentasikan satu tahap: misal `FROM tabVersion` → `JOIN tabComment ON ...` → `WHERE ...` → `GROUP BY ...` → `SELECT ...`.
- Interaktif: klik node untuk melihat detail (cuplikan SQL asli + penjelasan).
- Untuk subquery/CTE: ditampilkan sebagai sub-diagram yang bisa di-collapse/expand.
- Highlight jalur jika ada **korelasi** (correlated subquery) — garis penghubung ke kolom luar yang direferensikan.

**C. Penjelasan Per-Komponen (Non-Redundant)**
- Setiap fungsi/syntax (`GREATEST()`, `ROW_NUMBER() OVER (...)`, `COALESCE()`, dll) dijelaskan **satu kali** di panel "Glosarium" pada sesi tersebut.
- Jika fungsi/syntax yang sama muncul lagi di node lain, panel detail node hanya menampilkan **referensi** ("lihat penjelasan `ROW_NUMBER()` di atas") + konteks spesifik penggunaannya di node itu (misal: partition key apa, order by apa).
- Penjelasan ditulis ringkas (2-4 kalimat), fokus pada *apa yang dilakukan* dan *kenapa dipakai di posisi itu*, bukan textbook generik.

**D. Anotasi Tambahan (opsional, fase 2)**
- Tag manual oleh user pada node: "🔴 suspect N+1", "🟡 slow di production", "🟢 sudah optimal".
- Catatan bebas per-node (untuk dokumentasi investigasi, misalnya kasus replication lag dari Airflow query).

**E. Analisa Masalah & Rekomendasi Perbaikan**
- Setelah parsing, sistem menjalankan serangkaian **rule-based check** terhadap AST query untuk mendeteksi pola bermasalah, tanpa perlu koneksi ke database. Kategori yang dicek di v1:
  - **Penggunaan fungsi yang salah/kurang tepat**: misal `COUNT(column)` dipakai padahal maksudnya `COUNT(*)`, `SELECT *` di subquery yang hanya butuh satu kolom, fungsi agregat dipakai di `WHERE` (seharusnya `HAVING`).
  - **Query tidak refined**: `SELECT *` pada tabel besar, `WHERE` dengan fungsi yang membungkus kolom ber-index (`WHERE DATE(created_at) = ...` yang membatalkan index), JOIN tanpa kondisi `ON` yang jelas (cartesian product), `LIKE '%xxx%'` di awal string (tidak bisa pakai index), subquery di `SELECT` yang berpotensi N+1, `ORDER BY` tanpa `LIMIT` pada hasil besar.
  - **Potensi korelasi tersembunyi**: correlated subquery yang dieksekusi per-baris (potensi lambat), terutama relevan untuk kasus seperti query `tabImport Tool Document` yang historinya berkaitan dengan lock contention.
  - **Index awareness (opsional, butuh skema)**: jika user menyediakan informasi index (manual input atau hasil `SHOW INDEX`), sistem bisa menandai kolom di `WHERE`/`JOIN`/`ORDER BY` yang kemungkinan tidak ter-cover index.
- Tiap temuan ditampilkan sebagai **kartu analisa** dengan tiga bagian: *apa masalahnya*, *kenapa ini berisiko* (dampak: performa, korektnes, lock, dsb), dan *contoh perbaikan* (cuplikan query sebelum/sesudah).
- Temuan terhubung langsung ke node terkait di diagram alur (klik temuan → diagram highlight node yang bermasalah, dan sebaliknya).
- Severity level: 🔴 critical (berpotensi salah hasil atau lock), 🟡 warning (performa), ⚪ info (gaya/best practice).
- Disclaimer eksplisit di UI: analisa ini bersifat **statis berbasis pola umum**, bukan pengganti `EXPLAIN`/profiling sungguhan — untuk kepastian dampak performa, tetap perlu dicek di database aktual.

**F. Input Query**
- Kotak input utama berupa **code editor** (bukan textarea polos) dengan syntax highlighting SQL, line number, dan placeholder contoh query.
- Mendukung paste langsung, upload file `.sql`, atau drag-drop.
- Tombol "Analisa" memicu parsing + render diagram + jalankan analisa masalah secara bersamaan.
- Riwayat singkat (opsional, fase 2): beberapa query terakhir yang pernah dianalisa dalam sesi, untuk kemudahan switching tanpa re-paste.

### 4.2 Format Input
- Dialek SQL: prioritas **MySQL/MariaDB** (sesuai stack utama), dengan target dukungan dialek lain (Postgres) di fase berikutnya.
- Input via textarea, drag-drop file `.sql`, atau (fase 2) sambungan langsung ke `EXPLAIN`/query log.

### 4.3 Output / Sharing
- Export diagram sebagai gambar (PNG/SVG) atau link shareable (untuk dilampirkan di tiket/PR/Slack).
- Export penjelasan sebagai markdown (untuk ditempel di dokumentasi internal/postmortem).

## 5. Di Luar Lingkup (Out of Scope — v1)

- Eksekusi query sungguhan ke database (tidak connect ke DB user; murni analisis statis dari teks SQL).
- Query optimization / rekomendasi index otomatis (bisa jadi fitur fase 3, terpisah dari tujuan utama "visualisasi alur").
- Dukungan dialek selain MySQL/MariaDB di v1.
- Real-time collaborative editing (multi-user di satu diagram).

## 6. User Stories

| # | Sebagai | Saya ingin | Agar |
|---|---------|------------|------|
| 1 | Engineer | paste query SQL kompleks dan langsung lihat diagram alurnya | tidak perlu trace manual urutan eksekusi |
| 2 | Engineer | klik tiap node untuk lihat penjelasan fungsi yang dipakai | paham fungsi tanpa buka dokumentasi eksternal |
| 3 | Engineer | melihat subquery/CTE sebagai blok yang bisa di-collapse | fokus ke bagian query yang relevan saat debugging |
| 4 | Engineer | export diagram sebagai gambar | melampirkan ke tiket investigasi atau PR review |
| 5 | Engineer junior | baca penjelasan ringkas per fungsi | belajar SQL kompleks dari query nyata di codebase |
| 6 | Engineer | melihat daftar potensi masalah pada query (fungsi salah, query belum refined) lengkap dengan solusinya | bisa langsung memperbaiki tanpa trial-and-error |

## 7. Alur Pengguna (High-Level)

1. User membuka web app → landing page dengan textarea input SQL.
2. User paste/upload query SQL.
3. Sistem mem-parsing query (client-side atau via API) → menghasilkan AST/struktur logis.
4. Sistem merender diagram alur + panel glosarium di sisi kanan/bawah.
5. User eksplorasi: klik node → detail muncul di panel; collapse/expand subquery.
6. User export hasil (gambar/markdown) atau share link.

## 8. Rancangan Teknis (Usulan)

Disesuaikan dengan stack yang sudah familiar:

| Layer | Pilihan |
|---|---|
| Frontend | SvelteKit 5 |
| Diagram rendering | SVG custom (atau library seperti `mermaid.js`/`reactflow`-equivalent untuk Svelte, mis. `svelte-flow`) |
| SQL Parser | `node-sql-parser` (mendukung MySQL dialect) sebagai titik awal, fallback ke custom parser untuk syntax MariaDB-spesifik yang belum tercover |
| Backend (jika perlu parsing berat/AI explanation) | Hono.js di atas Bun |
| AI explanation generator (opsional) | LLM call (Claude API) untuk men-generate penjelasan natural language dari AST node — dengan prompt yang menjaga *non-redundansi* (deduplikasi berdasarkan fingerprint fungsi yang sudah dijelaskan dalam sesi) |
| Storage (untuk share link) | Simpan AST+anotasi terkompresi, bukan raw SQL identitas sensitif tanpa izin — perlu keputusan soal apakah query disimpan permanen atau sesi-only |

**Catatan arsitektur penting:**
- Parsing query → AST sebaiknya dilakukan **deterministik** (pakai SQL parser library), bukan murni LLM, supaya struktur alur akurat.
- LLM (jika dipakai) hanya untuk *lapisan penjelasan natural language*, bukan untuk menentukan struktur eksekusi — ini menjaga akurasi sekaligus mengontrol biaya/latency.
- Deduplikasi penjelasan bisa diimplementasikan dengan hashing signature fungsi (nama fungsi + jumlah arg) per sesi parsing.

## 9. Kebutuhan Non-Fungsional

- **Privasi:** Query SQL bisa mengandung nama tabel/kolom internal sensitif → pertimbangkan opsi "local-only" (parsing di browser, tanpa kirim ke server) sebagai mode default, dengan opsi cloud sebagai pilihan eksplisit.
- **Performa:** Parsing dan render diagram untuk query dengan >10 JOIN/subquery harus tetap responsif (<2 detik).
- **Skalabilitas diagram:** Untuk query sangat besar, diagram harus tetap terbaca (auto-layout, zoom, minimap).

## 10. Metrik Keberhasilan

- Waktu rata-rata yang dibutuhkan engineer untuk memahami query baru turun signifikan (baseline: dibandingkan baca raw SQL).
- Jumlah query yang berhasil di-parse tanpa error (>90% dari query produksi nyata di `praktis-simpan`).
- Adopsi internal: dipakai minimal pada investigasi query lambat/lock contention berikutnya sebagai pengganti tracing manual.

## 11. Pertanyaan Terbuka

1. Apakah perlu dukungan untuk query yang sudah di-`EXPLAIN`-kan (menampilkan execution plan asli MariaDB), atau murni analisis statis dari teks SQL saja di v1?
2. Apakah tool ini personal-use saja atau akan dipakai tim (perlu auth, multi-user, history tersimpan)?
3. Mode local-only (privasi) vs cloud (kolaborasi/share link) — prioritas mana dulu di v1?
4. Apakah AI explanation generator diperlukan dari awal, atau v1 cukup dengan rule-based explanation untuk syntax/fungsi umum (lebih murah, lebih cepat, tanpa dependency LLM)?

## 12. Roadmap Bertahap (Usulan)

- **v1 (MVP):** Parsing MySQL/MariaDB dasar, diagram alur statis, penjelasan rule-based (bukan LLM) untuk fungsi-fungsi umum, analisa masalah rule-based dasar (SELECT *, fungsi salah, JOIN tanpa kondisi), kotak input code editor, export PNG.
- **v2:** Anotasi manual per-node, share link, glosarium non-redundan otomatis.
- **v3:** Integrasi `EXPLAIN`, AI-generated explanation untuk syntax yang belum ter-cover rule-based, dukungan dialek lain.
