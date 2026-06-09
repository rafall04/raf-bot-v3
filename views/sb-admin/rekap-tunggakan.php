<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Rekap Tunggakan';
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
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <h1 class="h3 mb-0 text-gray-800">
                            <i class="fas fa-file-invoice-dollar text-primary"></i> Rekap Tunggakan
                        </h1>
                    </div>
                    <div id="arrearsAppRoot">
                        <div class="card shadow-sm border-0 mb-4">
                            <div class="card-body">
                                <div class="row">
                                    <div class="col-md-2 mb-2">
                                        <label class="font-weight-bold mb-1">Bulan</label>
                                        <select id="periodMonth" class="form-control"></select>
                                    </div>
                                    <div class="col-md-2 mb-2">
                                        <label class="font-weight-bold mb-1">Tahun</label>
                                        <select id="periodYear" class="form-control"></select>
                                    </div>
                                    <div class="col-md-2 mb-2 d-flex align-items-end">
                                        <button id="applyArrearsFilterBtn" class="btn btn-primary btn-block">Terapkan</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <ul class="nav nav-tabs mb-3" id="arrearsTabNav">
                            <li class="nav-item">
                                <button class="nav-link active" type="button" data-tab="operasional">Operasional</button>
                            </li>
                            <li class="nav-item">
                                <button class="nav-link" type="button" data-tab="manajerial">Manajerial</button>
                            </li>
                        </ul>
                        <div id="arrearsSummaryRow" class="row mb-3"></div>
                        <div id="arrearsTabContent">
                            <div class="alert alert-light border">Memuat rekap tunggakan...</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="/js/rekap-tunggakan.js"></script>
</body>
</html>
