<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Penjualan Voucher';
    $themeRole = 'admin';
    $pageDescription = 'Statistik penjualan voucher online';
    include __DIR__ . '/_head.php';
    ?>
    <link href="<?= rafAssetUrl('/css/paket-voucher.css') ?>" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/voucher-sales.css') ?>" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include __DIR__ . '/_navbar.php'; ?>

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include __DIR__ . '/topbar.php'; ?>

                <div class="container-fluid">
                    <div class="page-header">
                        <h1><i class="fas fa-chart-line mr-2"></i>Penjualan Voucher</h1>
                        <p>Statistik voucher online yang terjual (web &amp; WhatsApp)</p>
                    </div>

                    <div class="stats-row">
                        <div class="stat-card">
                            <div class="value" id="stToday">-</div>
                            <div class="label">Terjual Hari Ini</div>
                        </div>
                        <div class="stat-card">
                            <div class="value" id="stWeek">-</div>
                            <div class="label">7 Hari Terakhir</div>
                        </div>
                        <div class="stat-card">
                            <div class="value" id="stTotal">-</div>
                            <div class="label">Total Terjual</div>
                        </div>
                        <div class="stat-card">
                            <div class="value" id="stRevenue">-</div>
                            <div class="label">Total Pendapatan</div>
                        </div>
                    </div>

                    <div class="row">
                        <div class="col-lg-5 mb-4">
                            <div class="card-modern">
                                <div class="card-header"><i class="fas fa-trophy mr-2 text-primary"></i>Paket Terlaris</div>
                                <div class="card-body" id="topPackages">
                                    <div class="text-muted text-center py-3">Memuat…</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-lg-7 mb-4">
                            <div class="card-modern">
                                <div class="card-header"><i class="fas fa-history mr-2 text-primary"></i>Penjualan Terbaru</div>
                                <div class="card-body p-0">
                                    <div class="table-responsive">
                                        <table class="table mb-0">
                                            <thead>
                                                <tr><th>Waktu</th><th>Paket</th><th>Nominal</th><th>Sumber</th><th>Kode</th><th>Aksi</th></tr>
                                            </thead>
                                            <tbody id="recentBody">
                                                <tr><td colspan="6" class="text-center py-3 text-muted">Memuat…</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <?php include __DIR__ . '/footer.php'; ?>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="<?= rafAssetUrl('/js/voucher-sales.js') ?>"></script>
</body>

</html>
