<script>
  // A teaching aid: SQL is written in one order and executed in another.
  // Each step shows what enters it, what it does, and how many rows survive,
  // using one worked example so the shrinking result set is visible.
  let expanded = $state(null);

  const STEPS = [
    {
      n: 1,
      clause: 'FROM',
      cat: 'gray',
      title: 'Ambil tabel sumber',
      what: 'Engine mulai dari tabel di FROM. Belum ada penyaringan apa pun — ini himpunan baris awal.',
      example: 'FROM pesanan p',
      rows: '1.000.000 baris',
      note: 'Kalau FROM berisi subquery/derived table, isinya dijalankan lebih dulu sampai selesai.'
    },
    {
      n: 2,
      clause: 'JOIN … ON',
      cat: 'blue',
      title: 'Gabungkan tabel lain',
      what: 'Setiap baris kiri dipasangkan dengan baris kanan yang memenuhi ON. Hasilnya bisa membesar (satu baris kiri cocok banyak baris kanan) atau mengecil (INNER JOIN membuang yang tidak cocok).',
      example: 'JOIN pelanggan c ON c.id = p.pelanggan_id',
      rows: '1.000.000 baris',
      note: 'ON dievaluasi di sini, bukan di WHERE. Untuk LEFT JOIN, perbedaannya besar: kondisi di ON menyaring pasangan, kondisi di WHERE menyaring hasil akhir — dan bisa membatalkan sifat LEFT-nya.'
    },
    {
      n: 3,
      clause: 'WHERE',
      cat: 'coral',
      title: 'Saring baris',
      what: 'Baris yang tidak memenuhi syarat dibuang. Ini terjadi SEBELUM pengelompokan, jadi fungsi agregat seperti COUNT() belum ada nilainya di sini.',
      example: "WHERE p.status = 'aktif'",
      rows: '120.000 baris',
      note: 'Inilah kenapa membungkus kolom dengan fungsi di WHERE mahal: nilainya harus dihitung untuk setiap baris sebelum penyaringan, sehingga index pada kolom itu tidak terpakai.'
    },
    {
      n: 4,
      clause: 'GROUP BY',
      cat: 'purple',
      title: 'Kelompokkan baris',
      what: 'Baris dengan nilai kunci yang sama dilebur jadi satu grup. Setelah langkah ini, satu baris hasil mewakili satu grup — bukan lagi satu baris asli.',
      example: 'GROUP BY p.pelanggan_id',
      rows: '8.400 grup',
      note: 'Setelah GROUP BY, kolom yang boleh dipakai hanya kolom kunci grup atau hasil fungsi agregat.'
    },
    {
      n: 5,
      clause: 'HAVING',
      cat: 'coral',
      title: 'Saring grup',
      what: 'Sama seperti WHERE, tapi bekerja pada grup dan boleh memakai hasil agregat — karena agregatnya sudah dihitung di langkah sebelumnya.',
      example: 'HAVING COUNT(*) > 5',
      rows: '1.200 grup',
      note: 'Filter yang tidak memakai agregat sebaiknya ditaruh di WHERE, bukan HAVING — supaya barisnya dibuang lebih awal dan yang dikelompokkan lebih sedikit.'
    },
    {
      n: 6,
      clause: 'WINDOW',
      cat: 'purple',
      title: 'Hitung window function',
      what: 'Fungsi seperti ROW_NUMBER() atau SUM() OVER (…) dihitung di sini — setelah penyaringan dan pengelompokan, tapi sebelum SELECT selesai.',
      example: 'ROW_NUMBER() OVER (PARTITION BY … ORDER BY …)',
      rows: '1.200 baris',
      note: 'Karena dihitung setelah HAVING, hasil window function tidak bisa disaring di WHERE maupun HAVING. Bungkus query-nya dulu bila perlu menyaringnya.'
    },
    {
      n: 7,
      clause: 'SELECT',
      cat: 'teal',
      title: 'Bentuk kolom hasil',
      what: 'Baru di sini daftar kolom dipilih dan ekspresi/alias dihitung.',
      example: 'SELECT p.pelanggan_id, COUNT(*) AS jumlah',
      rows: '1.200 baris',
      note: 'Karena SELECT berjalan setelah WHERE, alias yang dibuat di SELECT belum ada saat WHERE dievaluasi — itulah sebabnya "unknown column" sering muncul saat alias dipakai di WHERE.'
    },
    {
      n: 8,
      clause: 'DISTINCT',
      cat: 'gray',
      title: 'Buang duplikat',
      what: 'Baris hasil yang identik disatukan. Perlu mengurutkan atau hashing seluruh hasil, jadi tidak gratis.',
      example: 'SELECT DISTINCT …',
      rows: '1.200 baris',
      note: 'DISTINCT yang dipakai untuk "menambal" duplikat akibat JOIN biasanya menandakan join-nya yang perlu diperbaiki.'
    },
    {
      n: 9,
      clause: 'ORDER BY',
      cat: 'gray',
      title: 'Urutkan hasil',
      what: 'Hasil akhir diurutkan. Di sinilah alias dari SELECT sudah bisa dipakai, karena SELECT sudah berjalan.',
      example: 'ORDER BY jumlah DESC',
      rows: '1.200 baris',
      note: 'Mengurutkan tanpa LIMIT memaksa seluruh hasil masuk ke proses sort. Index yang urutannya cocok bisa menghilangkan langkah ini sepenuhnya.'
    },
    {
      n: 10,
      clause: 'LIMIT / OFFSET',
      cat: 'gray',
      title: 'Potong hasil',
      what: 'Langkah paling akhir: ambil sebagian baris saja.',
      example: 'LIMIT 20',
      rows: '20 baris',
      note: 'LIMIT tidak membuat langkah sebelumnya lebih murah kecuali engine bisa berhenti lebih awal — OFFSET yang besar tetap harus memindai lalu membuang baris yang dilewati.'
    }
  ];

  const WRITTEN = ['SELECT', 'FROM', 'JOIN', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT'];
</script>

<div class="exec">
  <div class="orders">
    <div class="order">
      <span class="o-label">Urutan yang kamu tulis</span>
      <div class="chips">
        {#each WRITTEN as c (c)}<span class="chip written">{c}</span>{/each}
      </div>
    </div>
    <div class="order">
      <span class="o-label">Urutan yang dijalankan engine</span>
      <div class="chips">
        {#each STEPS as s (s.n)}<span class="chip run cat-{s.cat}">{s.clause}</span>{/each}
      </div>
    </div>
  </div>

  <p class="intro">
    <code>SELECT</code> ditulis paling depan tapi hampir dijalankan paling akhir. Sebagian besar kebingungan
    soal SQL — alias yang tidak dikenali, agregat yang ditolak di <code>WHERE</code>, <code>LEFT JOIN</code>
    yang berubah jadi <code>INNER</code> — berasal dari perbedaan dua urutan di atas. Klik tiap langkah untuk detailnya.
  </p>

  <ol class="steps">
    {#each STEPS as s (s.n)}
      <li class="step cat-{s.cat}" class:open={expanded === s.n}>
        <button class="s-head" onclick={() => (expanded = expanded === s.n ? null : s.n)}
          aria-expanded={expanded === s.n}>
          <span class="s-num">{s.n}</span>
          <span class="s-clause">{s.clause}</span>
          <span class="s-title">{s.title}</span>
          <span class="s-rows">{s.rows}</span>
          <i class="ti {expanded === s.n ? 'ti-chevron-up' : 'ti-chevron-down'}"></i>
        </button>
        {#if expanded === s.n}
          <div class="s-body">
            <p class="s-what">{s.what}</p>
            <code class="s-ex">{s.example}</code>
            <p class="s-note"><i class="ti ti-bulb"></i> {s.note}</p>
          </div>
        {/if}
      </li>
    {/each}
  </ol>

  <p class="tail">
    Angka baris di atas hanya ilustrasi satu contoh query, bukan hasil pengukuran. Yang penting polanya:
    <strong>semakin awal baris dibuang, semakin sedikit kerja untuk semua langkah sesudahnya.</strong>
    Itulah alasan menaruh filter di tempat yang tepat berpengaruh besar pada kecepatan.
  </p>
</div>

<style>
  .exec { margin: 6px 0 8px; }

  .orders { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
  .o-label {
    font-size: var(--fs-meta); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .chip {
    font-family: var(--mono); font-size: var(--fs-meta);
    border-radius: var(--radius-sm); padding: 3px 8px;
    border: 0.5px solid var(--border);
  }
  .chip.written { color: var(--text-muted); background: var(--surface-2); }
  .chip.run { color: var(--text-primary); background: var(--surface-2); border-left-width: 2px; }
  .cat-gray.run { border-left-color: var(--c-gray); }
  .cat-blue.run { border-left-color: var(--c-blue); }
  .cat-coral.run { border-left-color: var(--c-coral); }
  .cat-purple.run { border-left-color: var(--c-purple); }
  .cat-teal.run { border-left-color: var(--c-teal); }

  .intro { margin: 0 0 14px; }

  .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .step {
    border: 0.5px solid var(--border); border-left-width: 3px;
    border-radius: var(--radius-sm); background: var(--surface-1); overflow: hidden;
  }
  .step.cat-gray { border-left-color: var(--c-gray); }
  .step.cat-blue { border-left-color: var(--c-blue); }
  .step.cat-coral { border-left-color: var(--c-coral); }
  .step.cat-purple { border-left-color: var(--c-purple); }
  .step.cat-teal { border-left-color: var(--c-teal); }
  .step.open { background: var(--surface-2); }

  .s-head {
    display: flex; align-items: center; gap: 10px; width: 100%;
    background: transparent; border: 0; padding: 9px 12px; text-align: left;
    color: var(--text-secondary); font-family: var(--sans); font-size: var(--fs-sub);
  }
  .s-head:hover { background: var(--surface-2); }
  .s-num {
    flex: 0 0 auto; width: 20px; height: 20px; border-radius: 50%;
    background: var(--surface-3); color: var(--text-muted);
    font-size: var(--fs-meta); display: inline-flex; align-items: center; justify-content: center;
  }
  .s-clause {
    flex: 0 0 auto; font-family: var(--mono); color: var(--text-primary);
    font-size: var(--fs-code); min-width: 108px;
  }
  .s-title { flex: 1 1 auto; min-width: 0; }
  .s-rows {
    flex: 0 0 auto; font-family: var(--mono); font-size: var(--fs-meta);
    color: var(--text-muted);
  }
  .s-head i { flex: 0 0 auto; font-size: 13px; color: var(--text-muted); }

  .s-body { padding: 0 12px 12px 42px; display: flex; flex-direction: column; gap: 8px; }
  .s-what { margin: 0; font-size: var(--fs-sub); line-height: 1.65; color: var(--text-secondary); }
  .s-ex {
    font-family: var(--mono); font-size: var(--fs-code); color: var(--text-primary);
    background: var(--surface-0); border: 0.5px solid var(--border);
    border-radius: 3px; padding: 6px 9px; display: block;
    white-space: pre-wrap; word-break: break-word;
  }
  .s-note {
    margin: 0; font-size: var(--fs-meta); line-height: 1.65; color: var(--text-muted);
    display: flex; gap: 6px; align-items: flex-start;
  }
  .s-note i { color: var(--sev-warning); font-size: 13px; margin-top: 1px; flex: 0 0 auto; }

  .tail { margin: 14px 0 0; }

  @media (max-width: 640px) {
    .s-rows { display: none; }
    .s-clause { min-width: 84px; }
    .s-body { padding-left: 12px; }
  }
</style>
