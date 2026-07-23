<?php
/**
 * Header Doc
 * Purpose: Halaman PENGATURAN dompet — pemilih grup WhatsApp, ganti sandi, dan keluar.
 *          Setelan ini SENGAJA di sini, bukan di `/config` admin: seluruh desain dompet
 *          memisahkan diri dari panel admin, dan kalau ikut di sana admin lain bisa
 *          memindahkan grup lalu fitur ini diam tanpa pemiliknya tahu.
 *          Tombol "Keluar" juga dipindah ke sini — di header ia bersebelahan dengan tombol
 *          lain dan gampang tersentuh tak sengaja di layar sempit.
 * Caller: routes/pages.js path `/keuangan-pribadi/pengaturan` (butuh cookie `pf_session`).
 * Deps: `_kp-shell.php`, `_kp-shell-end.php`, `static/js/keuangan-pribadi-pengaturan.js`.
 */
$kpPage = 'pengaturan';
$kpTitle = 'Pengaturan';
$kpScript = 'keuangan-pribadi-pengaturan.js';
include __DIR__ . '/_kp-shell.php';
?>

<section class="kp-kartu">
  <div class="kp-kartu__kepala">
    <h2 class="kp-kartu__judul">Grup WhatsApp</h2>
  </div>
  <div class="kp-baris">
    <div class="kp-medan kp-medan--lebar">
      <label class="kp-label" for="kp-grup">Grup tujuan</label>
      <select id="kp-grup" class="kp-pilih"><option value="">— tidak ada / pakai DM —</option></select>
    </div>
  </div>
  <div class="kp-toolbar">
    <button type="button" class="kp-tombol kp-tombol--halus" id="kp-grup-muat">Muat grup</button>
    <button type="button" class="kp-tombol" id="kp-grup-simpan">Simpan grup</button>
  </div>
  <p class="kp-petunjuk">
    Pilih grup khusus supaya perintah dompet dilayani <b>di grup itu</b>, bukan di DM — DM bot
    sudah penuh notifikasi jalur upstream sehingga balasan dompet tenggelam. Bot harus online
    saat memuat daftar. Kosongkan untuk kembali ke DM. Di dalam grup pun hanya pesan dari nomor
    kamu yang dilayani.
  </p>
</section>

<section class="kp-kartu">
  <div class="kp-kartu__kepala">
    <h2 class="kp-kartu__judul">Ganti sandi</h2>
  </div>
  <form id="kp-form-sandi" autocomplete="off">
    <input type="text" id="kp-sandi-user" autocomplete="username" hidden aria-hidden="true" tabindex="-1">
    <div class="kp-baris">
      <div class="kp-medan">
        <label class="kp-label" for="kp-sandi-lama">Sandi sekarang</label>
        <input type="password" id="kp-sandi-lama" class="kp-input" autocomplete="current-password" required>
      </div>
      <div class="kp-medan">
        <label class="kp-label" for="kp-sandi-baru">Sandi baru</label>
        <input type="password" id="kp-sandi-baru" class="kp-input" autocomplete="new-password" minlength="8" required>
      </div>
      <div class="kp-medan">
        <label class="kp-label" for="kp-sandi-ulang">Ulangi sandi baru</label>
        <input type="password" id="kp-sandi-ulang" class="kp-input" autocomplete="new-password" minlength="8" required>
      </div>
    </div>
    <button type="submit" class="kp-tombol" id="kp-sandi-simpan">Simpan sandi baru</button>
    <p class="kp-petunjuk">Minimal 8 karakter. Setelah diganti, perangkat lain yang masih terbuka otomatis keluar — perangkat ini tetap masuk.</p>
  </form>
</section>

<section class="kp-kartu">
  <div class="kp-kartu__kepala">
    <h2 class="kp-kartu__judul">Sesi</h2>
    <span class="kp-kartu__meta" id="kp-sesi-info"></span>
  </div>
  <button type="button" class="kp-tombol kp-tombol--halus" id="kp-logout">Keluar dari dompet</button>
  <p class="kp-petunjuk">Keluar dari dompet tidak memengaruhi sesi panel admin — keduanya terpisah.</p>
</section>

<?php include __DIR__ . '/_kp-shell-end.php'; ?>
