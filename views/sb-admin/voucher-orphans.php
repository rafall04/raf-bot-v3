<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Voucher Orphan';
    $themeRole = 'admin';
    $pageDescription = 'Rekonsiliasi voucher gagal terbit / terbit tanpa tagihan';
    include __DIR__ . '/_head.php';
    ?>
    <link href="<?= rafAssetUrl('/css/paket-voucher.css') ?>" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/voucher-orphans.css') ?>" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include __DIR__ . '/_navbar.php'; ?>

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include __DIR__ . '/topbar.php'; ?>

                <div class="container-fluid">
                    <div class="page-header">
                        <h1><i class="fas fa-life-ring mr-2"></i>Voucher Orphan</h1>
                        <p>Voucher yang dibayar tapi gagal terbit, atau terbit tanpa tagihan — selesaikan di sini</p>
                    </div>

                    <div class="stats-row">
                        <div class="stat-card">
                            <div class="value" id="stOpen">-</div>
                            <div class="label">Butuh Tindakan</div>
                        </div>
                        <div class="stat-card">
                            <div class="value" id="stResolved">-</div>
                            <div class="label">Sudah Selesai</div>
                        </div>
                        <div class="stat-card">
                            <div class="value" id="stTotal">-</div>
                            <div class="label">Total Tercatat</div>
                        </div>
                    </div>

                    <div class="card-modern mb-4">
                        <div class="card-header d-flex align-items-center justify-content-between">
                            <span><i class="fas fa-list mr-2 text-primary"></i>Daftar Orphan</span>
                            <div class="vo-tabs">
                                <button type="button" class="vo-tab active" data-status="open">Belum Selesai</button>
                                <button type="button" class="vo-tab" data-status="resolved">Selesai</button>
                                <button type="button" class="vo-tab" data-status="all">Semua</button>
                            </div>
                        </div>
                        <div class="card-body p-0">
                            <div class="table-responsive">
                                <table class="table mb-0 tabel-tumpuk-hp">
                                    <thead>
                                        <tr><th>Waktu</th><th>Jenis</th><th>Paket</th><th>Nominal</th><th>Pembeli</th><th>Kode</th><th>Keterangan</th><th>Aksi</th></tr>
                                    </thead>
                                    <tbody id="orphanBody">
                                        <tr><td colspan="8" class="text-center py-3 text-muted">Memuat…</td></tr>
                                    </tbody>
                                </table>
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
    <script src="<?= rafAssetUrl('/js/voucher-orphans.js') ?>"></script>
</body>

</html>
