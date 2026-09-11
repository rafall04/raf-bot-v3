<!DOCTYPE html>
<html lang="id">

<head>
<?php
    $pageTitle = 'RAF BOT - Routing Notifikasi';
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
                    <div class="dashboard-header">
                        <h1>Routing Notifikasi ke Grup</h1>
                        <p>Pilih grup WhatsApp untuk tiap jenis notifikasi supaya tidak menumpuk di chat pribadi admin. Contoh: notifikasi <b>pembayaran</b> ke grup admin keuangan, notifikasi <b>gangguan jaringan</b> ke grup teknisi. Kalau sebuah jenis belum dipilih grupnya, notifikasinya tetap dikirim ke chat pribadi admin seperti biasa (jadi tidak ada yang hilang).</p>
                    </div>

                    <div id="nrMessage" class="mb-3"></div>

                    <div class="card shadow mb-4">
                        <div class="card-body d-flex align-items-center justify-content-between flex-wrap" style="gap:1rem;">
                            <div>
                                <div style="font-weight:700;">Aktifkan Routing ke Grup</div>
                                <div class="small text-muted">MATI = semua notifikasi ke chat pribadi admin (seperti sekarang). AKTIF = pakai grup yang dipilih per jenis di bawah.</div>
                                <div class="small mt-1" id="nrWaStatus"></div>
                            </div>
                            <div class="custom-control custom-switch" style="white-space:nowrap;">
                                <input type="checkbox" class="custom-control-input" id="nrMaster">
                                <label class="custom-control-label" for="nrMaster" id="nrMasterLabel">MATI</label>
                            </div>
                        </div>
                    </div>

                    <div id="nrLoading" class="text-center text-muted py-5">
                        <i class="fas fa-spinner fa-spin fa-2x"></i>
                        <p class="mt-2">Memuat kategori & grup…</p>
                    </div>
                    <div id="nrContainer" class="d-none"></div>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="<?= rafAssetUrl('/js/notif-routing.js') ?>"></script>
</body>
</html>
