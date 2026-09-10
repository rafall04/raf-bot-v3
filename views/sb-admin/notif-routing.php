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
                        <p>Arahkan tiap jenis notifikasi ke GRUP WhatsApp tertentu agar tak menumpuk di DM admin. Saat master OFF (atau grup belum dipilih), notifikasi tetap dikirim ke DM admin seperti biasa — jadi aman, tak ada yang hilang.</p>
                    </div>

                    <div id="nrMessage" class="mb-3"></div>

                    <div class="card shadow mb-4">
                        <div class="card-body d-flex align-items-center justify-content-between flex-wrap" style="gap:1rem;">
                            <div>
                                <div style="font-weight:700;">Master: Routing ke Grup</div>
                                <div class="small text-muted">OFF = semua notifikasi ke DM admin (perilaku sekarang). ON = pakai grup yang dipilih per kategori, dengan fallback ke DM admin bila grup kosong.</div>
                                <div class="small" id="nrWaStatus" style="opacity:.7;"></div>
                            </div>
                            <div class="custom-control custom-switch" style="white-space:nowrap;">
                                <input type="checkbox" class="custom-control-input" id="nrMaster">
                                <label class="custom-control-label" for="nrMaster" id="nrMasterLabel">OFF</label>
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
