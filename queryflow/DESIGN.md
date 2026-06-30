# DESIGN.md — SQL Query Visualizer & Debugger

**Versi:** 1.0
**Tanggal:** 30 Juni 2026
**Berdasarkan:** PRD-SQL-Query-Visualizer.md, PLAN-SQL-Query-Visualizer.md

---

## 1. Tujuan Dokumen

Mendokumentasikan struktur layout, komponen, dan pola visual aplikasi, supaya implementasi UI konsisten dengan mockup yang sudah disepakati dan bisa langsung dipakai sebagai referensi saat membangun komponen Svelte.

## 2. Prinsip Desain

1. **Flat & rapat informasi.** Tanpa gradient/shadow dekoratif. Border tipis (0.5px), permukaan datar. Fokus ke kepadatan informasi yang tetap mudah dipindai (scannable), bukan ke ornamen visual.
2. **Diagram adalah pusat perhatian, bukan chrome aplikasi.** Navbar dan sidebar dibuat seminimal mungkin secara visual supaya area diagram + analisa mendapat porsi terbesar.
3. **Warna membawa makna, bukan dekorasi.** Tiap warna pada node/badge punya arti tetap (lihat §6) — tidak dipakai bergantian sembarangan antar elemen.
4. **Semua node & temuan saling terhubung.** Klik node di diagram → highlight temuan analisa terkait, dan sebaliknya. Tidak ada elemen interaktif yang "buntu".
5. **Kepadatan tinggi, tapi tidak sesak.** Tiap panel dipisah jelas dengan border halus, padding konsisten, ukuran font dibatasi 2 tingkat (12px untuk detail/subtitle, 14px untuk label utama).

## 3. Struktur Halaman (Layout)

```
┌─────────────────────────────────────────────────────────┐
│ Navbar atas: logo · tab navigasi · settings · avatar     │
├───────────┬─────────────────────────────────────────────┤
│           │ Toolbar konteks: dialek DB · Export · Share  │
│ Sidebar   ├─────────────────────────────────────────────┤
│ riwayat   │ Kotak input query (code editor) + tombol     │
│ query     │ "Analisa"                                    │
│ (180px)   ├──────────────────────┬──────────────────────┤
│           │ Diagram alur          │ Panel analisa        │
│           │ eksekusi (kiri)       │ masalah (kanan)       │
│           │                       │                      │
└───────────┴──────────────────────┴──────────────────────┘
```

Tiga zona utama di area kerja: **input** (atas, full-width), **diagram** (kiri, ~55% lebar), **analisa** (kanan, ~45% lebar). Rasio kolom: `1.1fr / 1fr`.

## 4. Komponen

### 4.1 Navbar atas
- Tinggi ringkas (~44-48px), background sedikit lebih gelap dari konten (`surface-1` di atas `surface-2`).
- Kiri: ikon app (`ti-binary-tree`) + nama produk + tab navigasi ("Visualizer" aktif dengan border, "Dokumentasi" pasif teks abu-abu).
- Kanan: ikon settings + avatar inisial user dalam lingkaran beraksen biru (`bg-accent` / `text-accent`).

### 4.2 Sidebar riwayat (kiri, 180px)
- Tombol "Query baru" di atas, full-width, dengan ikon plus.
- Daftar riwayat sesi: tiap item menampilkan cuplikan query (mono font, satu baris, truncate) + metadata kecil (jumlah temuan, waktu relatif).
- Item aktif dibedakan dengan background `surface-2` + border, item lain polos dengan teks abu-abu (`text-secondary`).

### 4.3 Toolbar konteks
- Baris tipis di atas kotak input: label dialek database (badge kecil, mis. "MariaDB") di kiri, tombol Export dan Share di kanan.

### 4.4 Kotak input query
- Code editor dengan syntax highlighting manual per token: keyword (`SELECT`, `FROM`, `JOIN`, dst) berwarna aksen biru, bagian yang berpotensi bermasalah berwarna merah/coral sebagai preview sebelum analisa dijalankan secara penuh.
- Background sedikit berbeda dari kanvas utama (`surface-1` sebagai wrapper, `surface-2` untuk kotak editor itu sendiri) supaya terasa sebagai elemen input, bukan bagian dari konten hasil.
- Tombol "Analisa" rata kanan di bawah kotak, aksen warna (`text-accent` sebagai background, ikon play).

### 4.5 Diagram alur eksekusi
- Node vertikal berurutan top-down sesuai urutan eksekusi logis (FROM → JOIN → WHERE → GROUP BY → SELECT → ORDER BY).
- Tiap node: rounded rect, judul tahap (bold, 14px) + opsional subtitle (12px, detail kondisi).
- Panah penghubung lurus antar node, tanpa label kecuali makna tidak jelas dari konteks.
- Node yang berkaitan dengan temuan analisa diberi badge lingkaran kecil bertanda `!` di pojok kanan, warna mengikuti severity (lihat §6).
- Semua node bersifat clickable (cursor pointer, efek hover ringan) — klik memunculkan detail/penjelasan kontekstual di panel kanan.

### 4.6 Panel analisa masalah
- Header kecil menunjukkan jumlah temuan ("Analisa masalah (3 temuan)").
- Tiap temuan sebagai kartu dengan:
  - Border kiri tebal (2px) berwarna sesuai severity, border lain tipis (0.5px).
  - Baris judul: ikon peringatan + label severity ("Critical · index dibatalkan").
  - Deskripsi singkat kenapa berisiko (2-3 kalimat).
  - Blok kecil contoh perbaikan (mono font, background `surface-1`, teks warna sukses/hijau).
- Kartu temuan dan node diagram saling ter-anchor; idealnya saat salah satu di-hover/klik, yang lain ikut ter-highlight (interaksi, bukan murni visual statis).

### 4.7 Panel detail node & glosarium (lihat mockup awal)
- Saat node diklik dan belum ada temuan masalah terkait, tampilkan panel default: cuplikan SQL + penjelasan kontekstual node tersebut.
- Di bawahnya, daftar glosarium fungsi/syntax yang muncul di query saat ini — tiap entri muncul satu kali per sesi (lihat PRD §4.1.C untuk aturan non-redundansi).

## 5. Tipografi

| Elemen | Ukuran | Weight | Catatan |
|---|---|---|---|
| Nama produk (navbar) | 14px | 500 | |
| Tab navigasi | 13px | 400 | |
| Label tahap di node diagram | 14px | 500 | |
| Subtitle/kondisi di node | 12px | 400 | |
| Body teks penjelasan/temuan | 12-13px | 400 | line-height lega (~1.6) untuk keterbacaan |
| Query/code snippet | 11-12px | 400 | selalu monospace |
| Label metadata kecil (waktu, badge) | 10-11px | 400 | warna `text-muted` |

Dua level font untuk isi diagram (14px judul, 12px subtitle) dipertahankan ketat supaya diagram tidak terasa berantakan saat query kompleks.

## 6. Palet Warna & Makna

Warna dipakai secara **semantik**, bukan dekoratif:

| Warna | Dipakai untuk | Makna |
|---|---|---|
| Abu-abu (`c-gray`) | Node struktural netral (FROM, ORDER BY tanpa masalah) | Tahap standar, tidak ada perhatian khusus |
| Biru (`c-blue`) | Node JOIN | Kategori operasi penggabungan data |
| Coral | Node WHERE / filter | Kategori operasi penyaringan |
| Ungu (`c-purple`) | Node GROUP BY / agregasi | Kategori operasi pengelompokan |
| Teal | Node SELECT / output | Kategori pembentukan hasil akhir |
| Merah (badge `!` & border kartu) | Severity **critical** | Berpotensi salah hasil atau berdampak performa/lock serius |
| Amber/kuning (badge `!` & border kartu) | Severity **warning** | Berisiko performa atau gaya penulisan kurang tepat |
| Hijau (teks contoh perbaikan) | Saran/solusi | Menunjukkan "ini versi yang benar" |

Aturan: warna kategori (biru/coral/ungu/teal) hanya untuk membedakan **jenis tahap query**, warna severity (merah/amber) hanya untuk **indikator masalah** — dua sistem warna ini tidak pernah dicampur dalam elemen yang sama selain badge kecil di pojok node.

## 7. Interaksi Kunci

1. **Klik node diagram** → panel kanan menampilkan detail node tersebut (penjelasan kontekstual atau temuan masalah jika ada).
2. **Klik kartu temuan** → diagram scroll/highlight ke node terkait.
3. **Klik "Query baru"** di sidebar → reset kotak input, kosongkan diagram & panel.
4. **Klik item riwayat** di sidebar → muat ulang query, diagram, dan temuan analisa dari sesi sebelumnya (tanpa re-parse jika sudah pernah dianalisa, untuk respons instan).
5. **Tombol Analisa** → trigger pipeline penuh: parse → diagram → glosarium → analisa masalah, dengan loading state per tahap (bukan satu loading besar yang opaque).

## 8. Referensi Visual

Mockup acuan (dibuat sebagai bagian dari proses desain produk ini) menunjukkan dua iterasi:
1. **Versi awal**: diagram + panel detail/glosarium tanpa analisa masalah.
2. **Versi dengan analisa**: kotak input ditambahkan di atas, panel kanan diganti jadi kartu temuan masalah dengan severity dan contoh perbaikan, node diagram ditandai indikator `!` sesuai temuan.
3. **Versi halaman penuh**: menambahkan navbar atas dan sidebar riwayat query sebagai konteks aplikasi yang utuh (bukan cuma komponen tunggal).

Dokumen ini adalah versi tertulis dari ketiga iterasi tersebut, dipakai sebagai source of truth saat mulai implementasi komponen di Fase 1-4 sesuai PLAN-SQL-Query-Visualizer.md.

## 9. Hal yang Belum Diputuskan (Open Design Questions)

- Tema warna final (light/dark default) — mockup saat ini mengikuti token desain netral, belum diputuskan apakah pakai tema custom seperti "Void Indigo" yang dipakai di proyek lain.
- Perilaku diagram untuk query sangat besar (>10 node): auto-collapse sebagian, scroll, atau zoom — perlu prototsvar terpisah saat masuk Fase 5 (Polish & Hardening).
- Posisi panel glosarium vs panel analisa saat keduanya perlu tampil bersamaan (tab di dalam panel kanan, atau ditumpuk vertikal) — belum final, perlu diuji dengan query nyata yang punya banyak temuan sekaligus banyak fungsi.
