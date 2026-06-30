// MongoDB stage + operator explanation dictionary (parity with SQL glossary).
// Ringkas (2-4 kalimat), fokus apa & kenapa. Keyed by exact operator name (with $).

export const MONGO_STAGES = {
  $match: { label: '$match', text: 'Menyaring dokumen seperti WHERE di SQL. Letakkan sedini mungkin di pipeline agar bisa memanfaatkan index dan mengurangi jumlah dokumen di tahap berikutnya.' },
  $group: { label: '$group', text: 'Mengelompokkan dokumen berdasarkan ekspresi `_id` lalu menghitung akumulator ($sum, $avg, dll) per grup — setara GROUP BY. `_id: null` mengagregasi seluruh koleksi.' },
  $lookup: { label: '$lookup', text: 'Left outer join ke koleksi lain. Performa bergantung pada index di `foreignField` koleksi target; tanpa index, tiap dokumen memicu pencarian penuh.' },
  $graphLookup: { label: '$graphLookup', text: 'Pencarian rekursif (graph traversal) ke koleksi. Mahal pada data dalam/besar — batasi `maxDepth`.' },
  $unwind: { label: '$unwind', text: 'Memecah field array menjadi satu dokumen per elemen, menggandakan jumlah dokumen. Filter sebelum $unwind agar tidak meledakkan pipeline.' },
  $project: { label: '$project', text: 'Memilih/membentuk ulang field output, seperti daftar kolom di SELECT. Membuang field besar lebih awal mengurangi memori.' },
  $addFields: { label: '$addFields', text: 'Menambah atau menghitung field baru tanpa membuang yang lain (alias $set). Berguna untuk field turunan sebelum $group/$sort.' },
  $set: { label: '$set', text: 'Sama dengan $addFields — menambah/menimpa field. Nama lebih intuitif untuk update nilai.' },
  $sort: { label: '$sort', text: 'Mengurutkan dokumen. Tanpa index pendukung, sort dilakukan di memori (batas 100MB); paling efisien bila dikombinasikan dengan $limit (top-k) dan index.' },
  $limit: { label: '$limit', text: 'Membatasi jumlah dokumen yang diteruskan. Dipasangkan dengan $sort untuk "ambil N teratas" yang efisien.' },
  $skip: { label: '$skip', text: 'Melewati N dokumen pertama. $skip besar (deep pagination) lambat karena tetap memindai dokumen yang dilewati — pertimbangkan range query berbasis _id.' },
  $count: { label: '$count', text: 'Menghitung jumlah dokumen yang tersisa di pipeline dan mengembalikannya sebagai satu field.' },
  $facet: { label: '$facet', text: 'Menjalankan beberapa sub-pipeline paralel atas input yang sama (mis. data + total + faset filter sekaligus). Tiap sub-pipeline independen.' },
  $bucket: { label: '$bucket', text: 'Mengelompokkan dokumen ke dalam rentang (bucket) yang ditentukan — histogram.' },
  $replaceRoot: { label: '$replaceRoot', text: 'Mengganti dokumen root dengan sub-dokumen tertentu. Berguna setelah $lookup untuk "mengangkat" dokumen tergabung.' },
  $sample: { label: '$sample', text: 'Mengambil N dokumen acak. Pada koleksi besar tanpa index bisa memicu scan koleksi.' },
  $out: { label: '$out', text: 'Menulis hasil pipeline ke koleksi (mengganti isinya). Operasi tulis — tahap terakhir.' },
  $merge: { label: '$merge', text: 'Menggabungkan hasil pipeline ke koleksi target (upsert). Tahap akhir yang menulis data.' },
  $unionWith: { label: '$unionWith', text: 'Menggabungkan dokumen dari koleksi/pipeline lain (mirip UNION ALL).' },
  SOURCE: { label: 'Koleksi sumber', text: 'Titik awal pipeline: pemindaian koleksi. Apakah index dipakai ditentukan oleh tahap $match/$sort pertama.' }
};

export const MONGO_OPERATORS = {
  // accumulators
  $sum: { label: '$sum', text: 'Akumulator yang menjumlahkan nilai per grup; `$sum: 1` menghitung dokumen (setara COUNT(*)).' },
  $avg: { label: '$avg', text: 'Rata-rata nilai numerik per grup, mengabaikan non-numerik.' },
  $min: { label: '$min', text: 'Nilai terkecil per grup.' },
  $max: { label: '$max', text: 'Nilai terbesar per grup — sering untuk "yang terbaru".' },
  $push: { label: '$push', text: 'Mengumpulkan nilai grup ke dalam array (setara ARRAY_AGG). Hati-hati pada grup besar — array bisa membengkak.' },
  $addToSet: { label: '$addToSet', text: 'Seperti $push tapi unik (membuang duplikat dalam array hasil).' },
  $first: { label: '$first', text: 'Nilai dari dokumen pertama dalam grup (bergantung urutan $sort sebelumnya).' },
  $last: { label: '$last', text: 'Nilai dari dokumen terakhir dalam grup.' },
  // query operators
  $eq: { label: '$eq', text: 'Sama dengan. Operator kesetaraan yang bisa memakai index.' },
  $ne: { label: '$ne', text: 'Tidak sama dengan. Tidak selektif dan biasanya tidak memakai index dengan baik.' },
  $gt: { label: '$gt', text: 'Lebih besar dari — operator rentang yang bisa memakai index.' },
  $gte: { label: '$gte', text: 'Lebih besar atau sama dengan — operator rentang yang ramah index.' },
  $lt: { label: '$lt', text: 'Lebih kecil dari — operator rentang.' },
  $lte: { label: '$lte', text: 'Lebih kecil atau sama dengan — operator rentang.' },
  $in: { label: '$in', text: 'Cocok bila nilai ada di daftar. Bisa memakai index; daftar sangat besar bisa lambat.' },
  $nin: { label: '$nin', text: 'Tidak ada di daftar. Kurang selektif, jarang memakai index efektif.' },
  $regex: { label: '$regex', text: 'Pencocokan regular expression. Hanya bisa memakai index bila ter-anchor di awal (`^...`); pola tanpa anchor memicu scan.' },
  $exists: { label: '$exists', text: 'Mengecek keberadaan field. `$exists: false` cenderung tidak memakai index.' },
  $expr: { label: '$expr', text: 'Mengizinkan ekspresi agregasi di dalam $match (mis. membandingkan dua field). Perbandingan antar-field umumnya tidak memakai index.' },
  $and: { label: '$and', text: 'Semua kondisi harus terpenuhi (implisit bila beberapa field digabung dalam satu objek).' },
  $or: { label: '$or', text: 'Salah satu kondisi terpenuhi. Tiap cabang idealnya didukung index agar tidak memaksa scan.' },
  $not: { label: '$not', text: 'Negasi sebuah kondisi. Sering mengurangi kemampuan memakai index.' },
  $elemMatch: { label: '$elemMatch', text: 'Mencocokkan elemen array yang memenuhi beberapa kondisi sekaligus.' },
  $size: { label: '$size', text: 'Mencocokkan array dengan panjang tertentu. Tidak memakai index — scan.' },
  $where: { label: '$where', text: 'Menjalankan ekspresi JavaScript per dokumen. Sangat lambat, tidak memakai index, dan berisiko keamanan — hindari; ganti dengan operator query atau $expr.' },
  $text: { label: '$text', text: 'Pencarian teks penuh memakai text index. Memerlukan text index pada field terkait.' },
  // projection / expression
  $cond: { label: '$cond', text: 'Ekspresi kondisional (if-then-else) di dalam agregasi.' },
  $ifNull: { label: '$ifNull', text: 'Mengembalikan nilai pengganti bila ekspresi null/absen — mirip COALESCE.' },
  $concat: { label: '$concat', text: 'Menggabungkan string dalam ekspresi agregasi.' },
  $dateToString: { label: '$dateToString', text: 'Memformat tanggal ke string dalam pipeline. Memformat untuk pengelompokan baik-baik saja di $group, tapi hindari untuk memfilter di $match (tidak memakai index).' }
};

export function lookupMongo(name) {
  return MONGO_STAGES[name] || MONGO_OPERATORS[name] || null;
}
