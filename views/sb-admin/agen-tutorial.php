<!DOCTYPE html>
<html lang="id">

<head>
  <?php
  $pageTitle = 'Agen - Panduan';
  $themeRole = 'admin';
  $pageDescription = 'Panduan agen penagih: cara menagih pelanggan, mengajukan pembayaran, dan mendapat fee.';
  include __DIR__ . '/_head.php';
  require_once __DIR__ . '/_asset.php';
  ?>
  <link href="<?= rafAssetUrl('/css/tutorial.css') ?>" rel="stylesheet">
</head>

<body id="page-top">
  <div id="wrapper">
    <?php include '_navbar_agen.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>
        <div class="container-fluid">
          <div class="dashboard-header mb-4">
            <div>
              <h1 class="h3 mb-1"><i class="fas fa-book-open mr-2"></i>Panduan Agen Penagih</h1>
              <p class="text-muted mb-0">Cara menagih pelanggan, mengajukan pembayaran, dan mendapat fee — lengkap.</p>
            </div>
          </div>

          <div class="tut">
            <div class="rules">
              <div class="rule"><span class="ic">🎯</span><span>Kamu menagih <b>pelanggan yang ditugaskan admin</b> kepadamu. Daftarnya ada di menu <b>Penagihan Pembayaran</b>.</span></div>
              <div class="rule"><span class="ic">💵</span><span>Setiap pelanggan yang berhasil kamu tagih (dan disetujui admin) memberimu <b>fee tetap per pelanggan</b>.</span></div>
              <div class="rule"><span class="ic">🧾</span><span>Kamu <b>mengajukan</b> pembayaran; pencatatan resmi menunggu <b>persetujuan admin</b>. Ini menjaga uang &amp; laporan tetap rapi.</span></div>
            </div>

            <section class="flow f-agen" id="agen-alur">
              <span class="flow-tag">Alur Penagihan</span>
              <h2>Langkah Menagih &amp; Dapat Fee</h2>
              <p class="flow-sub">Semua dari menu <b>Penagihan Pembayaran</b> di panel ini. Tak perlu perintah chat.</p>

              <ol class="steps">
                <li>
                  <p class="step-t">Buka daftar pelanggan yang ditugaskan</p>
                  <p class="step-d">Masuk menu <b>Penagihan Pembayaran</b>. Kartu ringkasan atas menunjukkan <b>jumlah pelanggan ditugaskan</b> dan <b>fee bulan ini</b>. Di bawahnya, tabel pelanggan beserta statusnya.</p>
                  <p class="step-d">Gunakan tab filter untuk melihat yang <b>belum lunas</b> lebih dulu.</p>
                </li>
                <li>
                  <p class="step-t">Tagih pelanggan &amp; terima uang tunai</p>
                  <p class="step-d">Datangi / hubungi pelanggan yang <b>belum lunas</b>, tagih sesuai nominal tagihannya, dan <b>terima uang tunai</b>. Pastikan jumlahnya pas dengan yang tertera di sistem.</p>
                  <div class="note tip"><span class="ic">💡</span><span>Nominal tagihan tiap pelanggan sudah tertera di tabel — tidak perlu menghitung sendiri.</span></div>
                </li>
                <li>
                  <p class="step-t">Ajukan pembayaran (CASH)</p>
                  <p class="step-d">Pada baris pelanggan itu, klik tombol <b>Ajukan</b>. Pilih metode <b>Tunai (CASH)</b> dan kirim pengajuan. Status pelanggan berubah menjadi <b>menunggu persetujuan</b>.</p>
                  <div class="note tip"><span class="ic">⏳</span><span>Salah orang / batal? Selama <b>masih menunggu persetujuan</b>, kamu bisa <b>Batalkan</b> pengajuan itu dari tabel <b>Riwayat Pengajuan</b>.</span></div>
                </li>
                <li>
                  <p class="step-t">Tunggu persetujuan admin</p>
                  <p class="step-d">Admin memverifikasi lalu <b>menyetujui</b> pengajuanmu. Setelah disetujui: pembayaran pelanggan <b>resmi tercatat lunas</b>, dan <b>fee kamu bertambah</b> untuk pelanggan tersebut.</p>
                  <div class="note warn"><span class="ic">⚠️</span><span>Kalau admin <b>menolak</b> (mis. nominal tak cocok), pelanggan tetap belum lunas. Cek kembali &amp; ajukan ulang bila perlu.</span></div>
                </li>
                <li>
                  <p class="step-t">Pantau fee kamu</p>
                  <p class="step-d">Kartu <b>Fee Bulan Ini</b> di atas halaman menunjukkan total fee yang sudah kamu kumpulkan bulan berjalan. Nilainya = <b>fee per pelanggan × jumlah pelanggan yang tertagih &amp; disetujui</b>.</p>
                  <div class="note tip"><span class="ic">💵</span><span>Fee yang terkumpul <b>dicairkan bersama admin</b> sesuai kesepakatan (jadwal/pencairan diatur admin). Simpan bukti setoran tunaimu.</span></div>
                </li>
              </ol>
            </section>

            <section class="faq">
              <h2>Masalah Umum</h2>
              <details class="qa">
                <summary>Kenapa daftar pelangganku kosong?</summary>
                <div class="qa-body">Admin belum menugaskan pelanggan kepadamu. Hubungi admin agar menambahkan pelanggan ke akunmu lewat menu Penugasan Agen.</div>
              </details>
              <details class="qa">
                <summary>Sudah ajukan tapi fee belum bertambah</summary>
                <div class="qa-body">Fee bertambah <b>setelah admin menyetujui</b> pengajuanmu. Selama masih "menunggu persetujuan", fee belum dihitung. Cek status di Riwayat Pengajuan.</div>
              </details>
              <details class="qa">
                <summary>Salah ajukan pembayaran, bagaimana?</summary>
                <div class="qa-body">Selama pengajuan masih menunggu persetujuan, klik <b>Batalkan</b> di tabel Riwayat Pengajuan. Kalau sudah terlanjur disetujui admin, hubungi admin untuk koreksi.</div>
              </details>
              <details class="qa">
                <summary>Berapa nominal fee per pelanggan?</summary>
                <div class="qa-body">Fee per pelanggan diatur admin dan tampil di kartu ringkasan (Fee Bulan Ini). Nilainya sama untuk tiap pelanggan yang berhasil ditagih &amp; disetujui.</div>
              </details>
            </section>

            <section class="cheat">
              <h2>Istilah Singkat</h2>
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Istilah</th><th>Arti</th></tr></thead>
                  <tbody>
                    <tr><td class="k a">Ditugaskan</td><td>Pelanggan yang diberikan admin untuk kamu tagih</td></tr>
                    <tr><td class="k a">Ajukan</td><td>Mengirim pengajuan pembayaran tunai ke admin</td></tr>
                    <tr><td class="k a">Menunggu persetujuan</td><td>Pengajuan terkirim, belum disetujui admin</td></tr>
                    <tr><td class="k a">Disetujui</td><td>Admin setuju → pelanggan lunas + fee kamu bertambah</td></tr>
                    <tr><td class="k a">Fee Bulan Ini</td><td>Total fee terkumpul bulan berjalan (dicairkan via admin)</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>

</html>
