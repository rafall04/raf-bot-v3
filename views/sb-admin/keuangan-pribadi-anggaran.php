<?php
/**
 * Header Doc
 * Purpose: Halaman ANGGARAN dompet — tabel kategori dengan input pagu bulanan yang bisa
 *          diedit langsung, plus realisasi periode berjalan sebagai pembanding.
 *          Menggantikan rangkaian `prompt()` di versi pertama, yang menyulitkan sekadar
 *          melihat pagu mana saja yang sudah disetel.
 * Caller: routes/pages.js path `/keuangan-pribadi/anggaran` (butuh cookie `pf_session`).
 * Deps: `_kp-shell.php`, `_kp-shell-end.php`, `static/js/keuangan-pribadi-anggaran.js`.
 */
$kpPage = 'anggaran';
$kpTitle = 'Anggaran';
$kpScript = 'keuangan-pribadi-anggaran.js';
include __DIR__ . '/_kp-shell.php';
?>

<h1 class="kp-judul">Pagu bulanan per kategori</h1>
<p class="kp-sub">Pagu berlaku terus — tak perlu disetel ulang tiap bulan. Kosongkan nominalnya untuk mencabut pagu.</p>

<section class="kp-kartu">
  <div class="kp-tabel-bungkus">
    <table class="kp-tabel">
      <thead>
        <tr>
          <th>Kategori</th>
          <th class="kp-angka">Terpakai bulan ini</th>
          <th>Pagu bulanan</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="kp-baris-pagu"><tr><td colspan="4" class="kp-kosong">Memuat…</td></tr></tbody>
    </table>
  </div>
</section>

<section class="kp-kartu">
  <div class="kp-kartu__kepala">
    <h2 class="kp-kartu__judul">Tambah kategori baru</h2>
  </div>
  <form id="kp-form-pagu" autocomplete="off">
    <div class="kp-baris">
      <div class="kp-medan kp-medan--lebar">
        <label class="kp-label" for="kp-pagu-kategori">Nama kategori</label>
        <input type="text" id="kp-pagu-kategori" class="kp-input" placeholder="mis. hiburan" required>
      </div>
      <div class="kp-medan">
        <label class="kp-label" for="kp-pagu-nominal">Pagu bulanan</label>
        <input type="text" id="kp-pagu-nominal" class="kp-input" placeholder="500rb / 1jt" required>
      </div>
    </div>
    <button type="submit" class="kp-tombol" id="kp-pagu-simpan">Tambah pagu</button>
    <p class="kp-petunjuk">Kategori dibuat otomatis saat kamu mencatat pengeluaran, jadi biasanya kamu tak perlu menambahnya di sini.</p>
  </form>
</section>

<?php include __DIR__ . '/_kp-shell-end.php'; ?>
