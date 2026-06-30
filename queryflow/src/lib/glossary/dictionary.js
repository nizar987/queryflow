// Rule-based explanation dictionary (PRD §4.1.C, PLAN §5).
// Each entry: ringkas (2-4 kalimat), fokus pada APA yang dilakukan & KENAPA dipakai —
// bukan textbook generik. Keyed by uppercased function/clause name.
// Fallback handling lives in glossary/index.js (no hallucination — show "belum ada penjelasan").

export const FUNCTIONS = {
  COUNT: {
    label: 'COUNT()',
    text: 'Menghitung jumlah baris. `COUNT(*)` menghitung semua baris termasuk yang ber-NULL; `COUNT(kolom)` hanya menghitung baris di mana kolom itu tidak NULL. Perbedaan ini sering jadi sumber bug saat maksudnya menghitung total baris.'
  },
  SUM: {
    label: 'SUM()',
    text: 'Menjumlahkan nilai numerik pada satu grup. Mengabaikan NULL. Dipakai pada agregasi setelah GROUP BY untuk total per kelompok.'
  },
  AVG: {
    label: 'AVG()',
    text: 'Rata-rata nilai numerik dalam grup, mengabaikan NULL. Hati-hati: NULL tidak dihitung sebagai 0, jadi rata-rata bisa berbeda dari ekspektasi bila banyak NULL.'
  },
  MIN: { label: 'MIN()', text: 'Nilai terkecil dalam grup. Bekerja untuk angka, tanggal, maupun string (urutan leksikografis).' },
  MAX: { label: 'MAX()', text: 'Nilai terbesar dalam grup. Sering dipakai untuk mengambil "yang terbaru" pada kolom tanggal di dalam GROUP BY.' },
  GREATEST: {
    label: 'GREATEST()',
    text: 'Mengembalikan nilai terbesar di antara beberapa ekspedisi argumen pada baris yang sama (bukan agregat antar-baris seperti MAX). Jika salah satu argumen NULL, hasilnya NULL di MariaDB.'
  },
  LEAST: { label: 'LEAST()', text: 'Kebalikan GREATEST — nilai terkecil di antara argumen pada baris yang sama. Bukan agregat antar-baris.' },
  COALESCE: {
    label: 'COALESCE()',
    text: 'Mengembalikan argumen pertama yang bukan NULL. Dipakai untuk memberi nilai default saat kolom mungkin NULL, misalnya `COALESCE(diskon, 0)`.'
  },
  IFNULL: { label: 'IFNULL()', text: 'Versi dua-argumen dari COALESCE khas MySQL/MariaDB: `IFNULL(a, b)` mengembalikan `a` bila tidak NULL, selain itu `b`.' },
  NULLIF: { label: 'NULLIF()', text: 'Mengembalikan NULL bila kedua argumen sama, selain itu argumen pertama. Trik umum untuk menghindari pembagian dengan nol: `x / NULLIF(y, 0)`.' },
  ROW_NUMBER: {
    label: 'ROW_NUMBER() OVER (…)',
    text: 'Window function yang memberi nomor urut unik (1,2,3,…) per baris dalam tiap partisi, mengikuti urutan ORDER BY di dalam OVER. Pola umum untuk mengambil "baris terbaru per grup" lewat filter `rn = 1` di query pembungkus.'
  },
  RANK: { label: 'RANK() OVER (…)', text: 'Window function pemeringkat: baris dengan nilai ORDER BY sama mendapat rank sama, lalu melompati nomor berikutnya (1,1,3). Berbeda dari ROW_NUMBER yang selalu unik.' },
  DENSE_RANK: { label: 'DENSE_RANK() OVER (…)', text: 'Seperti RANK tapi tanpa lompatan nomor saat ada nilai seri (1,1,2). Dipakai saat ingin peringkat rapat tanpa gap.' },
  LAG: { label: 'LAG() OVER (…)', text: 'Window function yang mengambil nilai dari baris sebelumnya dalam partisi (mengikuti ORDER BY). Berguna untuk menghitung selisih antar baris berurutan tanpa self-join.' },
  LEAD: { label: 'LEAD() OVER (…)', text: 'Kebalikan LAG — mengambil nilai dari baris berikutnya dalam partisi. Berguna untuk membandingkan baris saat ini dengan yang akan datang.' },
  DATE: {
    label: 'DATE()',
    text: 'Mengambil bagian tanggal (tanpa jam) dari nilai datetime. Hati-hati di WHERE: membungkus kolom ber-index dengan `DATE(col)` membuat index tidak terpakai (lihat analisa masalah).'
  },
  DATE_FORMAT: { label: 'DATE_FORMAT()', text: 'Memformat tanggal/datetime ke string sesuai pola. Karena membungkus kolom, hindari memakainya pada sisi WHERE/JOIN bila kolomnya ber-index.' },
  YEAR: { label: 'YEAR()', text: 'Mengambil komponen tahun dari tanggal. Sama seperti DATE(), membungkus kolom ber-index di WHERE membatalkan pemakaian index.' },
  NOW: { label: 'NOW()', text: 'Waktu server saat query dijalankan (datetime). Bersifat konstan dalam satu statement.' },
  LOWER: { label: 'LOWER()', text: 'Mengubah string ke huruf kecil. Di WHERE, membungkus kolom dengan LOWER(col) membatalkan index pada kolom tersebut; pertimbangkan collation case-insensitive sebagai gantinya.' },
  UPPER: { label: 'UPPER()', text: 'Mengubah string ke huruf besar. Sama seperti LOWER, membungkus kolom ber-index di WHERE membatalkan index.' },
  CONCAT: { label: 'CONCAT()', text: 'Menggabungkan beberapa string jadi satu. Di MariaDB, bila salah satu argumen NULL hasilnya NULL (berbeda dari beberapa dialek lain).' },
  SUBSTRING: { label: 'SUBSTRING()', text: 'Mengambil potongan string mulai posisi tertentu. Membungkus kolom ber-index dengannya di WHERE membatalkan index.' },
  CAST: { label: 'CAST()', text: 'Mengubah tipe data nilai secara eksplisit. Di WHERE/JOIN, casting kolom dapat membatalkan index dan memicu konversi tipe implisit yang lambat.' },
  IF: { label: 'IF()', text: 'Ekspresi kondisional khas MySQL/MariaDB: `IF(kondisi, nilai_benar, nilai_salah)`. Setara CASE WHEN sederhana.' },
  ABS: { label: 'ABS()', text: 'Nilai absolut sebuah angka.' },
  ROUND: { label: 'ROUND()', text: 'Membulatkan angka ke jumlah desimal tertentu.' },
  // PostgreSQL-leaning
  STRING_AGG: { label: 'STRING_AGG()', text: 'Agregat Postgres yang menggabungkan nilai string per grup dengan pemisah, mis. `STRING_AGG(name, \', \')`. Setara GROUP_CONCAT di MySQL.' },
  ARRAY_AGG: { label: 'ARRAY_AGG()', text: 'Agregat Postgres yang mengumpulkan nilai grup menjadi sebuah array. Berguna untuk mengembalikan banyak nilai per baris hasil tanpa join tambahan.' },
  GENERATE_SERIES: { label: 'GENERATE_SERIES()', text: 'Fungsi Postgres yang menghasilkan deret angka/tanggal sebagai baris. Sering dipakai untuk membuat kalender atau mengisi gap data.' },
  JSONB_AGG: { label: 'JSONB_AGG()', text: 'Agregat Postgres yang mengumpulkan baris grup menjadi array JSON. Hati-hati pada grup besar — payload JSON bisa membengkak.' },
  DATE_TRUNC: { label: 'DATE_TRUNC()', text: 'Fungsi Postgres untuk memotong tanggal ke presisi tertentu (mis. DATE_TRUNC(month, created)). Di WHERE, membungkus kolom ber-index dengannya membatalkan index.' }
};

// Functions that bust indexes when wrapping a column in WHERE/JOIN (extends analyzer set for Postgres).
export const PG_INDEX_BUSTERS = ['DATE_TRUNC'];

export const CLAUSES = {
  'INNER JOIN': { label: 'INNER JOIN', text: 'Menggabungkan baris dari dua tabel hanya bila kondisi ON terpenuhi di keduanya. Baris tanpa pasangan dibuang.' },
  'LEFT JOIN': { label: 'LEFT JOIN', text: 'Menyertakan semua baris tabel kiri; kolom tabel kanan jadi NULL bila tidak ada pasangan. Sering dipakai untuk "ambil data utama beserta data terkait yang mungkin kosong".' },
  'RIGHT JOIN': { label: 'RIGHT JOIN', text: 'Kebalikan LEFT JOIN — semua baris tabel kanan dipertahankan. Jarang dipakai; biasanya bisa ditulis ulang sebagai LEFT JOIN agar lebih mudah dibaca.' },
  'CROSS JOIN': { label: 'CROSS JOIN', text: 'Hasil kali kartesian: setiap baris kiri dipasangkan ke setiap baris kanan. Tanpa kondisi ON, jumlah baris membengkak (N×M) — hampir selalu tidak disengaja.' },
  'GROUP BY': { label: 'GROUP BY', text: 'Mengelompokkan baris berdasarkan kolom tertentu agar fungsi agregat (COUNT/SUM/…) dihitung per kelompok, bukan untuk seluruh tabel.' },
  HAVING: { label: 'HAVING', text: 'Menyaring hasil SETELAH agregasi GROUP BY. Berbeda dari WHERE yang menyaring baris sebelum agregasi — fungsi agregat hanya valid di HAVING, bukan WHERE.' },
  'UNION ALL': { label: 'UNION ALL', text: 'Menggabungkan hasil dua query secara vertikal tanpa menghapus duplikat. Lebih cepat dari UNION (yang melakukan deduplikasi); pakai bila duplikat memang tidak mungkin atau tidak masalah.' },
  UNION: { label: 'UNION', text: 'Menggabungkan hasil dua query dan menghapus baris duplikat (operasi DISTINCT implisit yang berbiaya). Bila tahu tidak ada duplikat, UNION ALL lebih efisien.' },
  DISTINCT: { label: 'DISTINCT', text: 'Menghapus baris hasil yang identik. Berbiaya karena perlu sorting/hashing; sering jadi tanda query bisa ditulis ulang (mis. JOIN yang menggandakan baris).' },
  'ORDER BY': { label: 'ORDER BY', text: 'Mengurutkan hasil akhir. Salah satu tahap terakhir eksekusi; tanpa LIMIT pada hasil besar, sorting bisa mahal.' },
  LIMIT: { label: 'LIMIT', text: 'Membatasi jumlah baris hasil. Dikombinasikan dengan ORDER BY untuk paginasi atau "ambil N teratas".' },
  WINDOW: { label: 'Window function (OVER)', text: 'Menghitung nilai per baris dengan "melihat" sekumpulan baris terkait (partisi) tanpa menciutkan baris seperti GROUP BY. Tahap eksekusinya setelah WHERE/GROUP BY, sebelum ORDER BY akhir.' },
  CTE: { label: 'CTE (WITH)', text: 'Common Table Expression: subquery bernama yang didefinisikan di awal dengan WITH, lalu dipakai seperti tabel. Meningkatkan keterbacaan; di MariaDB modern bisa rekursif.' }
};

export function lookupFunction(name) {
  return FUNCTIONS[String(name).toUpperCase()] || null;
}
export function lookupClause(name) {
  return CLAUSES[String(name).toUpperCase()] || null;
}
