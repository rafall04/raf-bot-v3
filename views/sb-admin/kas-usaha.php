<?php
/**
 * Header Doc
 * Purpose: Halaman "Kas Usaha" — setelan grup WhatsApp kas, pengelolaan BIAYA RUTIN
 *          (internet, listrik, sewa) yang jatuh temponya diingatkan bot, dan ringkasan kas
 *          bulan berjalan. Angkanya mendarat di `expense_entries` yang sama dengan
 *          /pengeluaran & /rekap-keuangan — halaman ini tidak punya pembukuan sendiri.
 *          Bot TIDAK memposting biaya rutin sendiri; ia mengingatkan, pencatatan menunggu
 *          konfirmasi di grup (atau tombol "Catat" di sini).
 * Caller: routes/pages.js path `/kas-usaha` (checkRole admin/owner/superadmin).
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/kas-usaha/*`,
 *       `static/css/kas-usaha.css`, `static/js/kas-usaha.js`.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Kas Usaha';
    $themeRole = 'admin';
    $pageDescription = 'Kas usaha per site: grup WhatsApp, biaya rutin, dan ringkasan pengeluaran';
    include __DIR__ . '/_head.php';
    ?>
    <link rel="stylesheet" href="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/css/kas-usaha.css') : '/css/kas-usaha.css'; ?>">
</head>
<body id="page-top">
  <div id="wrapper">
    <?php include '_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>
        <div class="container-fluid">

          <div class="d-sm-flex align-items-center justify-content-between mb-3">
            <div>
              <h1 class="h3 mb-1 text-gray-800">🏢 Kas Usaha</h1>
              <p class="mb-0 text-muted small">Pengeluaran operasional site ini. Tercatat di <b>Pengeluaran</b> &amp; <b>Rekap Keuangan</b> — sumber angkanya sama.</p>
            </div>
          </div>

          <!-- Toast mengambang (CSS position:fixed). Bisa diklik untuk menutup lebih cepat —
               ia melapisi konten, jadi harus ada cara membuangnya tanpa menunggu. -->
          <div id="ku-alert" class="ku-alert" role="status" title="Klik untuk menutup" hidden></div>

          <!-- ARUS KAS bulan berjalan. Urutannya sengaja mengikuti pertanyaan pemilik:
               berapa yang bisa ditagih -> berapa sudah masuk -> berapa keluar -> sisa berapa. -->
          <div class="ku-stats">
            <div class="ku-stat">
              <span class="ku-stat__label">Omset bulan ini <span class="ku-stat__catatan">tanpa isolir</span></span>
              <span class="ku-stat__nilai" id="ku-omset">—</span>
              <span class="ku-stat__jejak" id="ku-omset-jejak"></span>
            </div>
            <div class="ku-stat ku-stat--masuk">
              <span class="ku-stat__label">Sudah masuk</span>
              <span class="ku-stat__nilai" id="ku-masuk">—</span>
              <span class="ku-stat__jejak" id="ku-belum"></span>
            </div>
            <div class="ku-stat ku-stat--keluar">
              <span class="ku-stat__label">Pengeluaran <span class="ku-stat__catatan">sudah keluar</span></span>
              <span class="ku-stat__nilai" id="ku-total">—</span>
              <!-- Tagihan yang belum jatuh tempo ditulis di jejak ini, TIDAK dijumlahkan ke
                   angka di atas: satu baris pengeluaran = uang benar-benar sudah keluar. -->
              <span class="ku-stat__jejak" id="ku-keluar-jejak"></span>
              <span class="ku-stat__jejak" hidden><span id="ku-jumlah">—</span> · <span id="ku-tertunda">—</span></span>
            </div>
            <div class="ku-stat ku-stat--sisa">
              <span class="ku-stat__label">Sisa (masuk − keluar)</span>
              <span class="ku-stat__nilai" id="ku-sisa">—</span>
              <span class="ku-stat__jejak" id="ku-sisa-jejak"></span>
            </div>
          </div>

          <!-- Grafik pengeluaran bulan ini per kategori. -->
          <section class="ku-kartu">
            <div class="ku-kartu__kepala">
              <h2 class="ku-kartu__judul">Pengeluaran bulan ini</h2>
              <span class="ku-kartu__meta" id="ku-grafik-meta"></span>
            </div>
            <div class="ku-grafik-bungkus">
              <canvas id="ku-grafik" height="150"></canvas>
              <p class="ku-kosong" id="ku-grafik-kosong" hidden>Belum ada pengeluaran bulan ini.</p>
            </div>
          </section>

          <!-- Grup WhatsApp -->
          <section class="ku-kartu">
            <div class="ku-kartu__kepala">
              <h2 class="ku-kartu__judul">Grup WhatsApp kas</h2>
              <span class="ku-kartu__meta" id="ku-status-fitur"></span>
            </div>
            <div class="ku-baris">
              <label class="ku-sakelar" for="ku-aktif">
                <input type="checkbox" id="ku-aktif">
                <span>Aktifkan kas usaha</span>
              </label>
              <label class="ku-sakelar" for="ku-digest">
                <input type="checkbox" id="ku-digest">
                <span>Kirim ringkasan uang tiap pagi</span>
              </label>
            </div>
            <p class="ku-petunjuk">
              Saat aktif, bot mengirim pengingat biaya rutin ke grup di bawah dan menerima perintah
              <code>kas …</code> di sana. Mematikannya membuat bot diam tanpa menghapus data apa pun.
            </p>
            <div class="ku-baris">
              <select id="ku-grup" class="form-control form-control-sm ku-input"><option value="">— belum dipilih —</option></select>
              <button type="button" class="btn btn-sm btn-outline-secondary" id="ku-muat-grup">Muat grup</button>
              <button type="button" class="btn btn-sm btn-primary" id="ku-simpan-grup">Simpan</button>
            </div>
            <p class="ku-petunjuk">
              Grup tempat bot mengirim pengingat jatuh tempo dan tempat kamu membalas
              <code>ok</code> / <code>ok 620rb</code> / <code>lewati</code>. Di grup itu juga bisa
              mencatat langsung: <code>kas 150rb kabel dropcore</code>.
            </p>

            <h3 class="ku-subjudul">Siapa yang boleh mencatat</h3>
            <p class="ku-petunjuk">
              Hanya orang di daftar ini yang perintah <code>kas …</code>-nya dijalankan. Selama
              daftarnya kosong, bot <b>diam</b> di grup walaupun sudah aktif.
            </p>
            <div id="ku-pemilik" class="ku-pemilik"><span class="ku-kosong">Memuat anggota grup…</span></div>
            <div class="ku-baris">
              <input type="text" id="ku-pemilik-manual" class="form-control form-control-sm ku-input"
                     placeholder="Nomor lain, pisahkan koma (mis. 08123456789)">
              <button type="button" class="btn btn-sm btn-primary" id="ku-simpan-pemilik">Simpan pemilik</button>
            </div>
          </section>

          <!-- Biaya rutin -->
          <section class="ku-kartu">
            <div class="ku-kartu__kepala">
              <h2 class="ku-kartu__judul">Biaya rutin</h2>
              <span class="ku-kartu__meta">Bot mengingatkan pada tanggalnya — pencatatan tetap menunggu konfirmasi.</span>
            </div>

            <div class="ku-tabel-bungkus">
              <table class="ku-tabel tabel-tumpuk-hp">
                <thead>
                  <tr>
                    <th>Nama</th><th class="ku-angka">Perkiraan</th><th>Kategori</th>
                    <th class="ku-angka">Tgl</th><th>Metode</th><th>Status bulan ini</th><th></th>
                  </tr>
                </thead>
                <tbody id="ku-rutin"><tr><td colspan="7" class="ku-kosong">Memuat…</td></tr></tbody>
              </table>
            </div>

            <form id="ku-form-rutin" class="ku-form" autocomplete="off">
              <input type="hidden" id="ku-id">
              <div class="ku-baris">
                <input type="text" id="ku-nama" class="form-control form-control-sm" placeholder="Nama (mis. Listrik Dander)" required>
                <input type="text" id="ku-perkiraan" class="form-control form-control-sm ku-input--kecil" placeholder="500rb" required>
                <select id="ku-kategori" class="form-control form-control-sm ku-input--kecil"></select>
                <input type="number" id="ku-tanggal" class="form-control form-control-sm ku-input--mini" min="1" max="31" placeholder="Tgl" required>
                <!-- Pilihan, bukan ketikan: hanya ada dua nilai sah dan mengetiknya bebas
                     membuka jalan ke "TF"/"Bank"/salah ketik yang lolos karena kolomnya teks. -->
                <select id="ku-metode" class="form-control form-control-sm ku-input--kecil">
                  <option value="TUNAI">TUNAI</option>
                  <option value="TRANSFER">TRANSFER</option>
                </select>
                <button type="submit" class="btn btn-sm btn-primary" id="ku-simpan-rutin">Simpan</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="ku-batal-edit" hidden>Batal</button>
              </div>
              <p class="ku-petunjuk">
                Tanggal 29–31 pada bulan pendek otomatis jatuh ke hari terakhir bulan itu.
                <b>Gaji teknisi sengaja tidak di sini</b> — sudah dikelola halaman Gaji Teknisi,
                memasukkannya juga akan terhitung dua kali.
              </p>
            </form>
          </section>

        </div>
      </div>
    </div>
  </div>

  <script src="/vendor/chart.js/Chart.min.js"></script>
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/kas-usaha.js') : '/js/kas-usaha.js'; ?>"></script>
</body>
</html>
