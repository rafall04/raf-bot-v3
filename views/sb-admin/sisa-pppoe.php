<!DOCTYPE html>
<html lang="id">

<head>
<?php
    // Alat pembersih "modem hantu": kredensial PPPoE di MikroTik yang tak lagi punya baris
    // pelanggan. Ikut partial <head> bersama supaya otomatis dapat token tema + cache-bust aset.
    $pageTitle = 'Sisa PPPoE - RAF NET';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
?>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>
                <div class="container-fluid">
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-broom"></i></span>
                            <div>
                                <h1>Sisa PPPoE</h1>
                                <p class="tk-subtitle">Kredensial di MikroTik yang tak lagi punya pelanggan</p>
                            </div>
                        </div>
                    </div>

                    <div class="alert alert-info" role="status">
                        <b>Kenapa halaman ini ada.</b> Saat pelanggan dicopot, bot memutus sesinya lalu menghapus
                        kredensial PPPoE-nya di MikroTik. Kalau router kebetulan tak terjangkau saat itu, data
                        pelanggannya hilang tapi <b>kredensialnya tertinggal</b> — modemnya masih bisa konek atas nama
                        orang yang sudah tidak ada. Modem seperti itu akan terus dianggap "milik pelanggan tak dikenal"
                        setiap kali dipakai PSB, dan tak seorang pun bisa menutup pelanggan yang datanya sudah lenyap.
                    </div>

                    <div class="alert alert-warning" role="alert">
                        <b>Baca dulu sebelum menghapus.</b> Tidak punya baris pelanggan <b>tidak</b> otomatis berarti
                        sampah. VPN operator, akun monitoring, dan layanan gratis memang sengaja tidak terdaftar sebagai
                        pelanggan. Tombol hapus hanya aktif untuk kredensial yang <b>tidak sedang dipakai</b> — dan
                        walau begitu, periksa dulu kolom Profil sebelum menekannya.
                    </div>

                    <div class="card shadow mb-4">
                        <div class="card-header py-3 d-flex align-items-center justify-content-between">
                            <h6 class="m-0 font-weight-bold" id="sisaRingkas">Memuat…</h6>
                            <button class="btn btn-sm btn-primary" id="btnMuatUlang" type="button">
                                <i class="fas fa-sync"></i> Muat ulang
                            </button>
                        </div>
                        <div class="card-body">
                            <div id="sisaPesan"></div>
                            <div class="table-responsive">
                                <table class="table table-bordered" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Kredensial PPPoE</th>
                                            <th>Profil</th>
                                            <th>Status</th>
                                            <th>Terakhir logout</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody id="sisaTbody">
                                        <tr><td colspan="5" class="text-center">Memuat…</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="<?= rafAssetUrl('/js/sisa-pppoe.js') ?>"></script>
</body>

</html>
