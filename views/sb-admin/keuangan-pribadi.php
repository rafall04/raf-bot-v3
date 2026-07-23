<?php
/**
 * Header Doc
 * Purpose: Halaman "Keuangan Pribadi" — dompet PRIBADI pemilik yang menumpang instance bot ini.
 *          Kartu ringkas (masuk/keluar/selisih), tutorial, form catat cepat, rincian per
 *          kategori, dan daftar catatan periode.
 *          BERDIRI SENDIRI — sengaja TIDAK memuat `_navbar.php`/`topbar.php`: sesi dompet
 *          terpisah dari sesi admin, jadi menampilkan sidebar admin akan membocorkan seluruh
 *          peta menu admin ke sesi yang tak punya hak admin (dan semua tautannya pun akan
 *          memantul ke /login). Header, pengalih tema, dan tombol keluar disediakan sendiri.
 *          TIDAK menyisipkan data apa pun dari server: seluruh angka diambil via
 *          /api/keuangan-pribadi/* yang punya penjaga sesi sendiri (berlapis).
 * Caller: routes/pages.js path `/keuangan-pribadi` (butuh cookie `pf_session`).
 * Deps: `_head.php`, API `/api/keuangan-pribadi/*`, `static/css/keuangan-pribadi.css`,
 *       `static/js/keuangan-pribadi-theme.js` (anti-FOUC, di <head>), `static/js/theme.js`
 *       (toggle bersama), `static/js/keuangan-pribadi.js`.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'Keuangan Pribadi';
    $themeRole = 'admin';
    $pageDescription = 'Catatan keuangan pribadi: pemasukan, pengeluaran, dan rekap per kategori';
    include __DIR__ . '/_head.php';
    ?>
    <link rel="stylesheet" href="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/css/keuangan-pribadi.css') : '/css/keuangan-pribadi.css'; ?>">
    <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/keuangan-pribadi-theme.js') : '/js/keuangan-pribadi-theme.js'; ?>"></script>
</head>
<body class="kp-page">
  <header class="kp-topbar">
    <div class="kp-topbar__kiri">
      <span class="kp-topbar__ikon">💰</span>
      <div>
        <h1 class="kp-topbar__judul">Keuangan Pribadi</h1>
        <p class="kp-topbar__sub">Terpisah dari saldo pelanggan dan pembukuan ISP.</p>
      </div>
    </div>
    <div class="kp-topbar__kanan">
      <select id="kp-mode" class="form-control form-control-sm kp-input-mode" aria-label="Mode periode">
        <option value="bulan">Per bulan</option>
        <option value="rentang">Rentang tanggal</option>
      </select>
      <input type="month" id="kp-bulan" class="form-control form-control-sm kp-input-bulan">
      <span id="kp-rentang" class="kp-rentang" hidden>
        <input type="date" id="kp-dari" class="form-control form-control-sm" aria-label="Dari tanggal">
        <span class="kp-rentang__sep">–</span>
        <input type="date" id="kp-sampai" class="form-control form-control-sm" aria-label="Sampai tanggal">
      </span>
      <a href="#" id="kp-ekspor" class="kp-ikonbtn" title="Unduh CSV sesuai filter" download>CSV</a>
      <button type="button" id="tkThemeToggle" class="kp-ikonbtn" title="Ganti mode terang/gelap" aria-label="Ganti mode terang/gelap">
        <i class="fas fa-moon"></i>
      </button>
      <button type="button" id="kp-logout" class="kp-keluar" title="Keluar dari dompet">Keluar</button>
    </div>
  </header>

  <main class="kp-main">
    <div id="kp-alert" class="kp-alert" hidden></div>

    <!-- Tutorial: sengaja di ATAS dan terbuka secara default. Fitur ini dipakai sesekali,
         jadi panduannya harus terlihat tanpa dicari. Bisa ditutup, dan pilihannya diingat. -->
    <details class="kp-tutorial" id="kp-tutorial" open>
      <summary class="kp-tutorial__judul">📖 Cara pakai — lewat WhatsApp &amp; lewat halaman ini</summary>
      <div class="kp-tutorial__isi">
        <div class="kp-tutorial__kolom">
          <h2>Lewat WhatsApp</h2>
          <p class="kp-tutorial__catatan">Kirim ke nomor bot. Tak ada kode/awalan apa pun.</p>
          <dl class="kp-cmd">
            <dt>keluar 50rb bensin</dt><dd>catat pengeluaran Rp50.000</dd>
            <dt>masuk 2jt gaji</dt><dd>catat pemasukan Rp2.000.000</dd>
            <dt>uang</dt><dd>rekap hari ini</dd>
            <dt>uang bulan</dt><dd>rekap bulan ini</dd>
            <dt>uang bulan 2026-06</dt><dd>rekap bulan tertentu</dd>
            <dt>uang hapus 12</dt><dd>hapus catatan nomor 12</dd>
            <dt>uang bantuan</dt><dd>tampilkan panduan ini di WhatsApp</dd>
          </dl>
        </div>
        <div class="kp-tutorial__kolom">
          <h2>Hal yang sering ditanya</h2>
          <ul class="kp-tutorial__list">
            <li><b>Format nominal bebas:</b> <code>50rb</code>, <code>50k</code>, <code>2jt</code>, <code>1,5jt</code>, <code>50.000</code> — semuanya dimengerti.</li>
            <li><b>Kategori ditebak sendiri</b> dari catatan (bensin&nbsp;→&nbsp;transport, kopi&nbsp;→&nbsp;makan, listrik&nbsp;→&nbsp;tagihan). Kalau salah tebak, hapus lalu catat ulang dengan kata lain.</li>
            <li><b>Salah catat?</b> Nomor catatan muncul di balasan WhatsApp dan di tabel bawah — pakai <code>uang hapus &lt;nomor&gt;</code> atau tombol × di tabel.</li>
            <li><b>Hanya nomor Anda</b> yang bisa memakai perintah ini. Pelanggan yang kebetulan mengetik kata sama tetap dilayani seperti biasa.</li>
            <li><b>Catatan ini terpisah</b> dari saldo pelanggan dan pembukuan ISP — tidak pernah tercampur, dan tidak ikut terkirim ke grup backup.</li>
            <li><b>Login halaman ini terpisah</b> dari akun admin. Keluar dari admin tidak menutup dompet, dan sebaliknya — pakai tombol <b>Keluar</b> di atas.</li>
          </ul>
        </div>
      </div>
    </details>

    <!-- Ringkasan periode -->
    <div class="kp-stats" id="kp-stats">
      <div class="kp-stat kp-stat--in">
        <span class="kp-stat__label">Pemasukan</span>
        <span class="kp-stat__value" id="kp-masuk">—</span>
        <span class="kp-tren" id="kp-tren-masuk"></span>
      </div>
      <div class="kp-stat kp-stat--out">
        <span class="kp-stat__label">Pengeluaran</span>
        <span class="kp-stat__value" id="kp-keluar">—</span>
        <span class="kp-tren" id="kp-tren-keluar"></span>
      </div>
      <div class="kp-stat kp-stat--net">
        <span class="kp-stat__label">Selisih</span>
        <span class="kp-stat__value" id="kp-selisih">—</span>
        <span class="kp-tren" id="kp-tren-selisih"></span>
      </div>
      <div class="kp-stat kp-stat--today">
        <span class="kp-stat__label">Hari ini (keluar)</span>
        <span class="kp-stat__value" id="kp-hariini">—</span>
      </div>
    </div>

    <!-- Pengeluaran per hari -->
    <section class="kp-card kp-card--full">
      <div class="kp-card__head">
        <h2 class="kp-card__title">Pengeluaran per hari</h2>
        <div class="kp-harian__meta">
          <span>Rata-rata <b id="kp-rata">—</b>/hari</span>
          <span id="kp-terboros" class="kp-harian__puncak"></span>
        </div>
      </div>
      <div class="kp-harian" id="kp-harian">
        <p class="kp-empty">Memuat…</p>
      </div>
    </section>

    <div class="kp-grid">
      <!-- Catat cepat -->
      <section class="kp-card">
        <h2 class="kp-card__title">Catat cepat</h2>
        <form id="kp-form" class="kp-form" autocomplete="off">
          <div class="kp-form__row">
            <div class="kp-field kp-field--kind">
              <label for="kp-kind">Jenis</label>
              <select id="kp-kind" class="form-control form-control-sm">
                <option value="out">Keluar</option>
                <option value="in">Masuk</option>
              </select>
            </div>
            <div class="kp-field">
              <label for="kp-amount">Nominal</label>
              <input type="text" id="kp-amount" class="form-control form-control-sm" placeholder="50rb / 2jt / 50000" required>
            </div>
          </div>
          <div class="kp-form__row">
            <div class="kp-field kp-field--wide">
              <label for="kp-note">Catatan</label>
              <input type="text" id="kp-note" class="form-control form-control-sm" placeholder="bensin, makan siang, gaji…">
            </div>
            <div class="kp-field">
              <label for="kp-tanggal">Tanggal</label>
              <input type="date" id="kp-tanggal" class="form-control form-control-sm">
            </div>
          </div>
          <button type="submit" class="kp-btn" id="kp-submit">Simpan catatan</button>
          <p class="kp-hint">Kategori ditebak otomatis dari catatan. Lewat WhatsApp cukup ketik: <code>keluar 50rb bensin</code></p>
        </form>
      </section>

      <!-- Rincian kategori + anggaran -->
      <section class="kp-card">
        <div class="kp-card__head">
          <h2 class="kp-card__title">Pengeluaran per kategori</h2>
          <button type="button" id="kp-atur-pagu" class="kp-keluar">Atur anggaran</button>
        </div>
        <div id="kp-kategori" class="kp-kategori">
          <p class="kp-empty">Memuat…</p>
        </div>
        <p class="kp-hint" id="kp-pagu-hint" hidden>
          Klik <b>Atur anggaran</b> untuk menetapkan pagu bulanan tiap kategori. Pagu berlaku
          terus, tak perlu disetel ulang tiap bulan.
        </p>
      </section>
    </div>

    <!-- Daftar catatan -->
    <section class="kp-card kp-card--full">
      <div class="kp-card__head">
        <h2 class="kp-card__title">Catatan periode ini</h2>
        <p class="kp-subtotal" id="kp-subtotal"></p>
      </div>

      <!-- Filter: sengaja hanya memengaruhi TABEL ini, bukan kartu ringkasan di atas.
           Kalau filter ikut mengubah kartu, angka "Pemasukan/Pengeluaran" berubah makna
           diam-diam dan pemakai bisa salah baca kondisi keuangannya. Subtotal khusus
           hasil filter ditampilkan di atas. -->
      <div class="kp-filter" role="group" aria-label="Saring catatan">
        <div class="kp-filter__item">
          <label for="kp-f-jenis">Jenis</label>
          <select id="kp-f-jenis" class="form-control form-control-sm">
            <option value="">Semua</option>
            <option value="out">Keluar</option>
            <option value="in">Masuk</option>
          </select>
        </div>
        <div class="kp-filter__item">
          <label for="kp-f-kategori">Kategori</label>
          <select id="kp-f-kategori" class="form-control form-control-sm">
            <option value="">Semua</option>
          </select>
        </div>
        <div class="kp-filter__item kp-filter__item--cari">
          <label for="kp-f-cari">Cari</label>
          <input type="search" id="kp-f-cari" class="form-control form-control-sm" placeholder="bensin, warung, gaji…">
        </div>
        <button type="button" id="kp-f-reset" class="kp-keluar kp-filter__reset" hidden>Hapus filter</button>
      </div>

      <div class="kp-tabel-wrap">
        <table class="kp-tabel">
          <thead>
            <tr>
              <th>Tanggal</th><th>Jenis</th><th class="kp-num">Nominal</th>
              <th>Kategori</th><th>Catatan</th><th>Asal</th><th></th>
            </tr>
          </thead>
          <tbody id="kp-rows">
            <tr><td colspan="7" class="kp-empty">Memuat…</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </main>

  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/theme.js') : '/js/theme.js'; ?>"></script>
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/keuangan-pribadi.js') : '/js/keuangan-pribadi.js'; ?>"></script>
</body>
</html>
