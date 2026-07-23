<?php
/**
 * Header Doc
 * Purpose: Halaman CATATAN dompet — form catat cepat, penyaring (jenis/kategori/cari),
 *          tabel catatan periode, dan unduh CSV yang mengikuti filter aktif.
 *          Filter SENGAJA hanya memengaruhi tabel di halaman ini; kartu ringkasan ada di
 *          halaman Ringkasan dan tetap menggambarkan seluruh periode.
 * Caller: routes/pages.js path `/keuangan-pribadi/catatan` (butuh cookie `pf_session`).
 * Deps: `_kp-shell.php`, `_kp-shell-end.php`, `static/js/keuangan-pribadi-catatan.js`.
 */
$kpPage = 'catatan';
$kpTitle = 'Catatan';
$kpScript = 'keuangan-pribadi-catatan.js';
include __DIR__ . '/_kp-shell.php';
?>

<section class="kp-kartu">
  <div class="kp-kartu__kepala">
    <h2 class="kp-kartu__judul">Catat cepat</h2>
  </div>
  <form id="kp-form" autocomplete="off">
    <div class="kp-baris">
      <div class="kp-medan kp-medan--sempit">
        <label class="kp-label" for="kp-jenis">Jenis</label>
        <select id="kp-jenis" class="kp-pilih">
          <option value="out">Keluar</option>
          <option value="in">Masuk</option>
        </select>
      </div>
      <div class="kp-medan">
        <label class="kp-label" for="kp-nominal">Nominal</label>
        <input type="text" id="kp-nominal" class="kp-input" placeholder="50rb / 2jt / 50000" required>
      </div>
      <div class="kp-medan">
        <label class="kp-label" for="kp-tanggal">Tanggal</label>
        <input type="date" id="kp-tanggal" class="kp-input">
      </div>
    </div>
    <div class="kp-baris">
      <div class="kp-medan kp-medan--lebar">
        <label class="kp-label" for="kp-catatan">Catatan</label>
        <input type="text" id="kp-catatan" class="kp-input" placeholder="bensin, makan siang, gaji…">
      </div>
    </div>
    <button type="submit" class="kp-tombol kp-tombol--penuh" id="kp-simpan">Simpan catatan</button>
    <p class="kp-petunjuk">Kategori ditebak otomatis dari catatan. Lewat WhatsApp cukup ketik <code>keluar 50rb bensin</code>.</p>
  </form>
</section>

<div id="kp-toolbar" class="kp-toolbar"></div>

<section class="kp-kartu">
  <div class="kp-kartu__kepala">
    <h2 class="kp-kartu__judul">Catatan periode ini</h2>
    <span class="kp-kartu__meta" id="kp-subtotal"></span>
  </div>

  <div class="kp-baris">
    <div class="kp-medan kp-medan--sempit">
      <label class="kp-label" for="kp-f-jenis">Jenis</label>
      <select id="kp-f-jenis" class="kp-pilih">
        <option value="">Semua</option>
        <option value="out">Keluar</option>
        <option value="in">Masuk</option>
      </select>
    </div>
    <div class="kp-medan kp-medan--sempit">
      <label class="kp-label" for="kp-f-kategori">Kategori</label>
      <select id="kp-f-kategori" class="kp-pilih"><option value="">Semua</option></select>
    </div>
    <div class="kp-medan kp-medan--lebar">
      <label class="kp-label" for="kp-f-cari">Cari</label>
      <input type="search" id="kp-f-cari" class="kp-input" placeholder="bensin, warung, gaji…">
    </div>
  </div>
  <div class="kp-toolbar">
    <button type="button" class="kp-tombol kp-tombol--halus" id="kp-f-reset" hidden>Hapus filter</button>
    <a class="kp-tombol kp-tombol--halus" id="kp-ekspor" href="#" download><i class="fas fa-download"></i> Unduh CSV</a>
  </div>

  <div class="kp-tabel-bungkus">
    <table class="kp-tabel">
      <thead>
        <tr>
          <th>Tanggal</th><th>Jenis</th><th class="kp-angka">Nominal</th>
          <th>Kategori</th><th>Catatan</th><th>Asal</th><th></th>
        </tr>
      </thead>
      <tbody id="kp-baris-tabel"><tr><td colspan="7" class="kp-kosong">Memuat…</td></tr></tbody>
    </table>
  </div>
</section>

<?php include __DIR__ . '/_kp-shell-end.php'; ?>
