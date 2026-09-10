<!DOCTYPE html>
<html lang="id">

<head>
<?php
    $pageTitle = 'RAF BOT - Feature Flags';
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
                        <h1>Feature Flags</h1>
                        <p>Nyalakan/matikan fitur yang dibangun tapi belum aktif — tanpa perlu edit config.json manual. Perubahan langsung berlaku (hot-reload); sebagian butuh restart bila disebutkan.</p>
                    </div>

                    <div id="ffMessage" class="mb-3"></div>
                    <div id="ffLoading" class="text-center text-muted py-5">
                        <i class="fas fa-spinner fa-spin fa-2x"></i>
                        <p class="mt-2">Memuat daftar fitur…</p>
                    </div>
                    <div id="ffContainer" class="d-none"></div>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="<?= rafAssetUrl('/js/feature-flags.js') ?>"></script>
</body>
</html>
