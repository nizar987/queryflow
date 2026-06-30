# Implementation Plan: SQL Query Visualizer & Debugger

**Versi:** 1.0
**Tanggal:** 30 Juni 2026
**Berdasarkan:** PRD-SQL-Query-Visualizer.md v1.0
**Asumsi:** dikerjakan solo/part-time di sela kerja utama, estimasi dalam *effort days* (hari kerja fokus), bukan kalender — sesuaikan jika ada kontributor tambahan.

---

## 1. Prinsip Eksekusi

1. **Parser dulu, baru visual.** Tanpa AST yang akurat, diagram dan analisa cuma dekorasi. Fase 1 fokus total ke parsing benar untuk kasus nyata (query Frappe/MariaDB), bukan ke UI.
2. **Rule-based dulu, AI belakangan.** Penjelasan dan analisa masalah pakai rule-based di v1 — murah, deterministik, gampang di-test. LLM masuk di fase lanjut sebagai *enhancement*, bukan dependency inti.
3. **Bangun dari query nyata.** Pakai 10-15 query asli dari `praktis-simpan` (yang sudah pernah didebug: ghost `reserved_qty`, replication lag, `tabComment`/`tabVersion` history) sebagai golden test set sejak hari pertama — bukan query sintetis generik.
4. **Vertical slice tiap fase.** Tiap fase harus menghasilkan sesuatu yang bisa dipakai end-to-end (paste query → lihat hasil), bukan tumpukan komponen setengah jadi.

## 2. Ringkasan Fase

| Fase | Nama | Output | Estimasi |
|---|---|---|---|
| 0 | Setup & spike parser | Parser terbukti jalan di query nyata | 2-3 hari |
| 1 | MVP diagram alur | Paste query → diagram alur eksekusi | 5-7 hari |
| 2 | Penjelasan non-redundan | Diagram + panel glosarium klik-detail | 3-4 hari |
| 3 | Engine analisa masalah | Deteksi pola bermasalah + saran perbaikan | 5-7 hari |
| 4 | Input UX & export | Code editor, export PNG/markdown, share link | 3-4 hari |
| 5 | Polish & hardening | Edge case, performa, dialek MariaDB spesifik | 3-5 hari |

**Total estimasi MVP (Fase 0-5): ~21-30 hari effort.**

Fase 6+ (AI explanation, EXPLAIN integration, multi-dialek) didorong ke roadmap pasca-v1, mengikuti PRD §12.

---

## 3. Fase 0 — Setup & Spike Parser (2-3 hari)

Tujuan: buktikan parser bisa menangani query nyata sebelum investasi waktu ke UI.

**Tasks:**
- [ ] Inisialisasi project: SvelteKit 5 (frontend) + struktur monorepo ringan jika backend Hono dipisah.
- [ ] Riset & bandingkan parser SQL yang tersedia: `node-sql-parser` (MySQL dialect) vs alternatif lain. Cek dukungan: CTE, window function, subquery korelasi, `GREATEST()`/fungsi custom MariaDB.
- [ ] Kumpulkan 10-15 query nyata dari riwayat kerja (lihat §1.3) sebagai golden test set, simpan di `tests/fixtures/queries/`.
- [ ] Spike: jalankan parser ke seluruh golden set, catat mana yang gagal parse atau hasil AST-nya ambigu.
- [ ] Putuskan: pakai parser library apa adanya, fork/extend, atau bangun custom parser parsial untuk syntax yang tidak ter-cover.

**Exit criteria:** parser berhasil menghasilkan AST yang bisa dipetakan ke tahap eksekusi logis untuk minimal 80% dari golden test set.

**Risiko utama:** parser SQL umum sering tidak 100% kompatibel dengan dialek MariaDB (contoh: fungsi `GREATEST()`, syntax tertentu di window function). Jika gap besar, alokasikan waktu ekstra di sini sebelum lanjut — ini fondasi semua fase berikutnya.

---

## 4. Fase 1 — MVP Diagram Alur (5-7 hari)

Tujuan: dari AST ke diagram alur eksekusi yang bisa dilihat di browser, untuk satu query pada satu waktu.

**Tasks:**
- [ ] Modul `ast-to-flow`: transformasi AST → daftar node bertahap sesuai urutan eksekusi logis (FROM → JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT), termasuk union/CTE sebagai node bertingkat.
- [ ] Render diagram: pilih antara SVG custom vs library flow (`svelte-flow` atau sejenis) — keputusan berdasarkan kebutuhan collapse/expand subquery dan performa render untuk query besar.
- [ ] Layout dasar: node vertikal/horizontal, jalur edge antar tahap.
- [ ] Subquery & CTE sebagai sub-diagram collapsible (klik untuk expand).
- [ ] Highlight visual untuk correlated subquery (garis ke kolom luar yang direferensikan).
- [ ] Klik node → tampilkan cuplikan SQL asli dari bagian itu (tanpa penjelasan dulu, itu Fase 2).

**Exit criteria:** seluruh golden test set ter-render sebagai diagram yang benar urutannya, termasuk minimal 2 query dengan subquery/CTE.

---

## 5. Fase 2 — Penjelasan Non-Redundan (3-4 hari)

Tujuan: panel detail + glosarium per sesi, sesuai prinsip non-redundansi di PRD §4.1.C.

**Tasks:**
- [ ] Bangun **kamus rule-based**: peta nama fungsi/syntax → penjelasan ringkas (2-4 kalimat). Mulai dari fungsi yang sering muncul di codebase sendiri: `COUNT`, `GREATEST`, `COALESCE`, `ROW_NUMBER() OVER`, `UNION ALL`, JOIN types, dll.
- [ ] Mekanisme deduplikasi: hashing signature fungsi (nama + jumlah arg) per sesi parsing → render sekali di glosarium, node lain cukup referensi + konteks spesifik (partition key, kondisi ON, dst).
- [ ] Panel glosarium UI: daftar fungsi yang muncul di query saat ini, urut sesuai kemunculan pertama.
- [ ] Panel detail node: klik node → tampilkan SQL snippet + penjelasan kontekstual (bukan ulang definisi generik).
- [ ] Fallback untuk fungsi yang belum ada di kamus: tampilkan nama fungsi + label "belum ada penjelasan tersedia" (bukan ngarang).

**Exit criteria:** golden test set menghasilkan glosarium tanpa duplikasi entri, dan tiap node detail menunjukkan konteks spesifik bukan teks generik berulang.

---

## 6. Fase 3 — Engine Analisa Masalah (5-7 hari)

Tujuan: implementasi PRD §4.1.E — deteksi pola bermasalah + kartu solusi terhubung ke diagram.

**Tasks:**
- [ ] Desain struktur rule: tiap rule = `{id, severity, deteksi(AST) → match[], pesan, contoh_perbaikan}` — modular supaya gampang nambah rule baru tanpa ubah core.
- [ ] Implementasi rule v1 (urutan prioritas berdasarkan PRD):
  - `SELECT *` pada tabel besar / subquery yang cuma butuh sebagian kolom
  - `COUNT(column)` vs `COUNT(*)` yang berpotensi salah maksud
  - Fungsi agregat dipakai di `WHERE` (harusnya `HAVING`)
  - Fungsi membungkus kolom di `WHERE`/`JOIN` yang membatalkan index (`DATE(col)`, `LOWER(col)`, dll)
  - `JOIN` tanpa kondisi `ON` yang jelas (cartesian product risk)
  - `LIKE '%xxx%'` leading wildcard
  - Subquery di `SELECT` (potensi N+1 pattern)
  - `ORDER BY` tanpa `LIMIT` pada query yang berpotensi hasil besar
  - `ORDER BY` pakai ordinal number (rawan salah saat kolom berubah)
  - Correlated subquery terdeteksi (severity warning, bukan otomatis salah — tandai untuk review manual)
- [ ] Linking: tiap temuan ter-anchor ke node spesifik di diagram (klik temuan ↔ highlight node, dan sebaliknya).
- [ ] UI kartu analisa: severity badge, deskripsi risiko, contoh before/after.
- [ ] Disclaimer statis di UI sesuai PRD (bukan pengganti `EXPLAIN` sungguhan).
- [ ] (Opsional, jika waktu cukup) Index awareness: input manual hasil `SHOW INDEX` → cross-check kolom di `WHERE`/`JOIN`/`ORDER BY`.

**Exit criteria:** dijalankan ke golden test set termasuk query yang **sudah diketahui bermasalah** dari pengalaman nyata (mis. case `tabImport Tool Document` lock contention, query lambat lainnya) — engine harus berhasil menandai minimal sebagian besar dari masalah yang memang sudah diketahui ada di query tersebut.

**Catatan kalibrasi:** rule-based linter rawan false positive. Sebelum dianggap selesai, uji ke beberapa query yang **sengaja sudah optimal** untuk pastikan tidak banjir warning yang tidak perlu (noise mengurangi kepercayaan ke tool).

---

## 7. Fase 4 — Input UX & Export (3-4 hari)

**Tasks:**
- [ ] Ganti textarea polos dengan code editor (CodeMirror 6, sudah familiar dari proyek NoteForge) + syntax highlighting SQL + line number.
- [ ] Upload `.sql` / drag-drop file.
- [ ] Tombol "Analisa" memicu pipeline penuh: parse → diagram → glosarium → analisa masalah, dengan loading state yang jelas per tahap.
- [ ] Export diagram sebagai PNG/SVG.
- [ ] Export penjelasan + temuan analisa sebagai markdown (untuk ditempel ke tiket/postmortem).
- [ ] Share link: putuskan dulu model penyimpanan (lihat §9 Keputusan Tertunda) sebelum implementasi.

**Exit criteria:** alur penuh paste → analisa → export bisa dilakukan tanpa reload manual, dan output export bisa langsung ditempel ke dokumentasi/tiket.

---

## 8. Fase 5 — Polish & Hardening (3-5 hari)

**Tasks:**
- [ ] Uji performa untuk query besar (>10 JOIN/subquery) — pastikan parsing & render tetap <2 detik (target NFR di PRD).
- [ ] Auto-layout/zoom/minimap untuk diagram besar.
- [ ] Error handling: query tidak valid/parsing gagal → pesan jelas, bukan crash diam-diam.
- [ ] Review ulang seluruh golden test set end-to-end sekali lagi setelah semua fase selesai.
- [ ] Decision check: mode local-only (privasi) vs cloud, sudah final atau masih perlu disesuaikan? (lihat §9)
- [ ] Tulis dokumentasi pemakaian singkat (untuk diri sendiri/tim jika dipakai bersama).

---

## 9. Keputusan yang Harus Diambil Sebelum/Selama Implementasi

Mengacu ke "Pertanyaan Terbuka" di PRD §11 — ini bukan keputusan teknis kecil, tapi menentukan arsitektur:

| Keputusan | Pengaruh ke plan | Rekomendasi sementara |
|---|---|---|
| Local-only (parsing di browser) vs cloud (server-side) | Menentukan apakah backend Hono wajib di v1 atau bisa ditunda | Mulai **local-only** (parsing + analisa di browser pakai JS parser) → backend baru masuk kalau butuh AI explanation atau share link server-side. Lebih cepat untuk MVP & aman untuk query internal sensitif. |
| Personal-use vs tim (auth, history) | Menentukan perlu tidaknya auth/login di v1 | **Personal-use dulu**, tanpa auth. Auth/multi-user didorong ke fase pasca-MVP kalau memang mau dipakai tim. |
| AI explanation dari awal vs rule-based dulu | Menentukan dependency ke API key/biaya LLM di v1 | **Rule-based dulu** (sudah jadi keputusan default di plan ini) — AI sebagai *fallback* untuk fungsi yang belum ada di kamus, masuk di fase pasca-MVP. |
| Dukungan `EXPLAIN` asli | Menambah scope koneksi ke DB (keluar dari prinsip "statis, tanpa koneksi DB") | Tetap **statis only di v1**, `EXPLAIN` masuk sebagai fitur terpisah di roadmap v3 sesuai PRD. |

**Saran:** putuskan baris pertama (local-only vs cloud) sebelum mulai Fase 0, karena ini mempengaruhi apakah perlu setup Hono.js sejak awal atau bisa ditunda sepenuhnya ke fase lanjut.

---

## 10. Struktur Project (Usulan Awal)

```
sql-query-visualizer/
├── src/
│   ├── lib/
│   │   ├── parser/          # wrapper di atas node-sql-parser + adjustment dialek MariaDB
│   │   ├── ast-to-flow/     # transformasi AST → struktur node eksekusi
│   │   ├── glossary/        # kamus rule-based penjelasan fungsi
│   │   ├── analyzer/        # engine rule-based deteksi masalah
│   │   └── components/      # komponen Svelte: DiagramView, NodeDetail, GlossaryPanel, IssueCard, QueryEditor
│   └── routes/
├── tests/
│   └── fixtures/queries/    # golden test set query nyata
└── docs/
```

## 11. Definition of Done (MVP)

MVP dianggap selesai kalau:
1. Bisa paste query SQL kompleks (multi-JOIN, subquery, CTE) dan langsung dapat diagram alur eksekusi yang benar.
2. Tiap node bisa diklik untuk lihat penjelasan kontekstual, tanpa duplikasi di glosarium.
3. Engine analisa menghasilkan minimal temuan yang relevan untuk seluruh golden test set, dengan tingkat false-positive yang sudah dikalibrasi rendah.
4. Hasil (diagram + analisa) bisa di-export untuk dilampirkan ke tiket/dokumentasi.
5. Sudah diuji nyata ke minimal satu kasus investigasi query lambat/lock contention sungguhan sebagai pengganti tracing manual.
