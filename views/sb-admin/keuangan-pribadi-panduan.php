<?php
/**
 * Header Doc
 * Purpose: Halaman PANDUAN dompet — daftar perintah WhatsApp dan hal-hal yang sering
 *          ditanyakan. Dipisah ke halamannya sendiri karena di versi pertama panel ini
 *          menumpuk di atas halaman utama dan mendorong angka-angka ke bawah lipatan.
 * Caller: routes/pages.js path `/keuangan-pribadi/panduan` (butuh cookie `pf_session`).
 * Deps: `_kp-shell.php`, `_kp-shell-end.php`. Tak butuh skrip khusus (statis).
 */
$kpPage = 'panduan';
$kpTitle = 'Panduan';
include __DIR__ . '/_kp-shell.php';
?>

<h1 class="kp-judul">Cara pakai</h1>
<p class="kp-sub">Semua bisa dari WhatsApp — tanpa membuka halaman ini.</p>

<section class="kp-kartu">
  <div class="kp-panduan">
    <div>
      <h2 class="kp-kartu__judul">Lewat WhatsApp</h2>
      <p class="kp-petunjuk">Kirim ke bot. Tak ada kode atau awalan apa pun.</p>
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
    <div>
      <h2 class="kp-kartu__judul">Sering ditanyakan</h2>
      <ul class="kp-daftar">
        <li><b>Nominal bebas bentuknya:</b> <code class="kp-kode">50rb</code>, <code class="kp-kode">50k</code>,
            <code class="kp-kode">2jt</code>, <code class="kp-kode">1,5jt</code>, <code class="kp-kode">50.000</code> — semuanya dimengerti.</li>
        <li><b>Kategori ditebak sendiri</b> dari catatan (bensin&nbsp;→&nbsp;transport, kopi&nbsp;→&nbsp;makan,
            listrik&nbsp;→&nbsp;tagihan). Kalau salah tebak, hapus lalu catat ulang dengan kata lain.</li>
        <li><b>Salah catat?</b> Nomornya muncul di balasan WhatsApp dan di kolom tabel Catatan — pakai
            <code class="kp-kode">uang hapus &lt;nomor&gt;</code> atau tombol × di tabel.</li>
        <li><b>Di grup:</b> kalau grup sudah dipilih di Pengaturan, perintah dilayani di grup itu dan
            DM dimatikan. Di dalam grup pun hanya pesan dari nomor kamu yang dilayani.</li>
        <li><b>Terpisah</b> dari saldo pelanggan dan pembukuan ISP — tak pernah tercampur, dan tidak
            ikut terkirim ke grup backup.</li>
        <li><b>Login halaman ini terpisah</b> dari akun admin. Keluar dari admin tak menutup dompet,
            dan sebaliknya.</li>
      </ul>
    </div>
  </div>
</section>

<?php include __DIR__ . '/_kp-shell-end.php'; ?>
