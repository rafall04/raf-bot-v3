<?php
/**
 * Header Doc
 * Purpose: Halaman RINGKASAN dompet — kartu masuk/keluar/selisih (+tren vs periode
 *          sebelumnya), grafik pengeluaran per hari, dan ringkas pengeluaran per kategori.
 *          Hanya "melihat"; mencatat ada di halaman Catatan, mengatur pagu di Anggaran.
 *          TIDAK menyisipkan data dari server — semua angka via /api/keuangan-pribadi/*
 *          yang punya penjaga sesi sendiri (berlapis).
 * Caller: routes/pages.js path `/keuangan-pribadi` (butuh cookie `pf_session`).
 * Deps: `_kp-shell.php`, `_kp-shell-end.php`, `static/js/keuangan-pribadi-ringkasan.js`.
 */
$kpPage = 'ringkasan';
$kpTitle = 'Ringkasan';
$kpScript = 'keuangan-pribadi-ringkasan.js';
include __DIR__ . '/_kp-shell.php';
?>

<div id="kp-toolbar" class="kp-toolbar"></div>

<div class="kp-stat-grid">
  <div class="kp-stat kp-stat--masuk">
    <span class="kp-stat__label">Pemasukan</span>
    <span class="kp-stat__nilai" id="kp-masuk">—</span>
    <span class="kp-tren" id="kp-tren-masuk"></span>
  </div>
  <div class="kp-stat kp-stat--keluar">
    <span class="kp-stat__label">Pengeluaran</span>
    <span class="kp-stat__nilai" id="kp-keluar">—</span>
    <span class="kp-tren" id="kp-tren-keluar"></span>
  </div>
  <div class="kp-stat kp-stat--saldo">
    <span class="kp-stat__label">Selisih</span>
    <span class="kp-stat__nilai" id="kp-selisih">—</span>
    <span class="kp-tren" id="kp-tren-selisih"></span>
  </div>
  <div class="kp-stat kp-stat--hari">
    <span class="kp-stat__label">Keluar hari ini</span>
    <span class="kp-stat__nilai" id="kp-hariini">—</span>
    <span class="kp-tren" id="kp-rata"></span>
  </div>
</div>

<section class="kp-kartu">
  <div class="kp-kartu__kepala">
    <h2 class="kp-kartu__judul">Pengeluaran per hari</h2>
    <span class="kp-kartu__meta" id="kp-terboros"></span>
  </div>
  <div class="kp-harian" id="kp-harian"><p class="kp-kosong">Memuat…</p></div>
</section>

<section class="kp-kartu">
  <div class="kp-kartu__kepala">
    <h2 class="kp-kartu__judul">Pengeluaran per kategori</h2>
    <a class="kp-kartu__meta" href="/keuangan-pribadi/anggaran">Atur anggaran →</a>
  </div>
  <div id="kp-kategori"><p class="kp-kosong">Memuat…</p></div>
</section>

<?php include __DIR__ . '/_kp-shell-end.php'; ?>
