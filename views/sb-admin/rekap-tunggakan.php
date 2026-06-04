<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Rekap Tunggakan</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/admin-theme.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
</head>
<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_topbar.php'; ?>
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
