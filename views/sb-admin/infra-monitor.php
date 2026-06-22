<!DOCTYPE html>
<html lang="id">
<!--
Header Doc
Purpose: Halaman admin untuk monitor modem infrastruktur (account_type='infrastruktur', mis. modem CCTV/monitoring) — status online/offline/LOS + redaman, memakai ulang API OLT yang sudah ada. Akun ini sengaja disembunyikan dari Data Pelanggan tapi tetap terbaca di OLT.
Caller: `routes/pages.js` pada path `/infra-monitor`.
Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/olt/matched` (difilter account_type='infrastruktur' di sisi klien), `/css/admin-olt.css`, `/js/infra-monitor.js`.
MainFuncs: (klien) loadInfraData, renderRows, renderSummary.
SideEffects: Polling backend OLT (read-only) untuk merefresh tampilan; tidak menulis DB.
-->
<head>
    <?php
    $pageTitle = 'RAF BOT - Monitor Infrastruktur';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>
    <link href="/css/admin-olt.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>

                <div class="container-fluid">
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between flex-wrap">
                            <div>
                                <h1>Monitor Infrastruktur</h1>
                                <p>Modem PPPoE titik CCTV/monitoring (ditandai <strong>Infrastruktur</strong>) — dipisah dari Data Pelanggan namun tetap dipantau di OLT.</p>
                            </div>
                            <div class="olt-toolbar">
                                <a href="/admin-olt" class="btn btn-outline-primary" title="Monitor OLT lengkap">
                                    <i class="fas fa-network-wired"></i> Monitor OLT
                                </a>
                                <span class="refresh-timer" id="lastUpdateTime">Belum dimuat</span>
                                <div class="d-flex align-items-center">
                                    <label class="switch mb-0 mr-2">
                                        <input type="checkbox" id="autoRefreshToggle">
                                        <span class="slider"></span>
                                    </label>
                                    <small class="text-muted">Auto</small>
                                </div>
                                <button class="btn btn-primary-custom" id="refreshInfraBtn">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="infraStatusAlert" class="alert alert-info" style="display: none;">
                        <span id="infraStatusMessage"></span>
                    </div>

                    <div class="row mb-4">
                        <div class="col-md-3 col-sm-6 mb-3">
                            <div class="dashboard-card h-100"><div class="card-body">
                                <div class="text-muted small text-uppercase">Total Infra</div>
                                <div class="h3 mb-0" id="infraTotal">0</div>
                            </div></div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-3">
                            <div class="dashboard-card h-100"><div class="card-body">
                                <div class="text-muted small text-uppercase">Online</div>
                                <div class="h3 mb-0 text-success" id="infraOnline">0</div>
                            </div></div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-3">
                            <div class="dashboard-card h-100"><div class="card-body">
                                <div class="text-muted small text-uppercase">Mati / LOS</div>
                                <div class="h3 mb-0 text-danger" id="infraDown">0</div>
                            </div></div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-3">
                            <div class="dashboard-card h-100"><div class="card-body">
                                <div class="text-muted small text-uppercase">Redaman Lemah</div>
                                <div class="h3 mb-0 text-warning" id="infraBadRx">0</div>
                            </div></div>
                        </div>
                    </div>

                    <div class="dashboard-card" style="height: auto;">
                        <div class="card-body">
                            <div class="d-flex flex-wrap align-items-center mb-3" style="gap: .5rem;">
                                <input type="text" id="infraSearch" class="form-control form-control-sm" style="max-width: 260px;" placeholder="Cari nama / PPPoE / IP / OLT...">
                                <select id="infraStatusFilter" class="form-control form-control-sm" style="max-width: 220px;">
                                    <option value="all">Semua status</option>
                                    <option value="online">Online</option>
                                    <option value="offline">Offline</option>
                                    <option value="los">LOS (fiber putus)</option>
                                    <option value="dying">Dying Gasp (mati listrik)</option>
                                </select>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-bordered table-sm" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Nama / Lokasi</th>
                                            <th>PPPoE / IP</th>
                                            <th>Status</th>
                                            <th>Redaman (Rx)</th>
                                            <th>PON</th>
                                            <th>OLT</th>
                                            <th>Penyebab Terakhir</th>
                                        </tr>
                                    </thead>
                                    <tbody id="infraTableBody">
                                        <tr><td colspan="7" class="text-center text-muted py-4">Memuat...</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/js/infra-monitor.js"></script>
</body>
</html>
