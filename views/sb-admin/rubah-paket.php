<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Rubah Paket Pelanggan</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/@ttskch/select2-bootstrap4-theme@1.5.2/dist/select2-bootstrap4.min.css" rel="stylesheet">
    <style>
        .select2-container--bootstrap4 .select2-selection--single { height: calc(1.5em + 0.75rem + 2px) !important; }
        .select2-container--bootstrap4 .select2-selection--single .select2-selection__rendered { line-height: calc(1.5em + 0.75rem) !important; }
        .info-card { border-radius: 12px; border-left: 4px solid #4e73df; }
    </style>
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
                            <i class="fas fa-exchange-alt text-primary mr-2"></i>Rubah Paket Pelanggan
                        </h1>
                    </div>

                    <div class="row">
                        <div class="col-lg-5">
                            <div class="card shadow mb-4">
                                <div class="card-header py-3">
                                    <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-edit mr-2"></i>Form Rubah Paket</h6>
                                </div>
                                <div class="card-body">
                                    <form id="changePackageForm">
                                        <div class="form-group">
                                            <label><i class="fas fa-user mr-1"></i> Pilih Pelanggan <span class="text-danger">*</span></label>
                                            <select class="form-control" id="userSelect" style="width: 100%"></select>
                                        </div>

                                        <div id="selectedUserInfo" class="alert alert-info info-card" style="display: none;">
                                            <h6 class="font-weight-bold mb-2"><i class="fas fa-info-circle mr-1"></i> Info Pelanggan</h6>
                                            <div id="userInfoContent"></div>
                                        </div>

                                        <div class="form-group">
                                            <label><i class="fas fa-box mr-1"></i> Paket Saat Ini</label>
                                            <input type="text" class="form-control" id="currentPackage" readonly>
                                        </div>

                                        <div class="form-group">
                                            <label><i class="fas fa-box-open mr-1"></i> Paket Baru <span class="text-danger">*</span></label>
                                            <select class="form-control" id="newPackage" required>
                                                <option value="">-- Pilih Paket Baru --</option>
                                            </select>
                                            <small id="packagePriceInfo" class="text-muted"></small>
                                        </div>

                                        <div class="form-group">
                                            <div class="custom-control custom-checkbox">
                                                <input type="checkbox" class="custom-control-input" id="syncMikrotik" checked>
                                                <label class="custom-control-label" for="syncMikrotik">
                                                    <i class="fas fa-sync mr-1"></i> Sinkronkan ke MikroTik
                                                </label>
                                            </div>
                                            <small class="text-muted">Profile PPPoE akan otomatis diubah</small>
                                        </div>

                                        <div class="form-group">
                                            <label><i class="fas fa-sticky-note mr-1"></i> Catatan (Opsional)</label>
                                            <textarea class="form-control" id="changeNotes" rows="2" placeholder="Alasan perubahan..."></textarea>
                                        </div>

                                        <button type="submit" class="btn btn-primary btn-block" id="submitBtn" disabled>
                                            <i class="fas fa-save mr-1"></i> Simpan Perubahan
                                        </button>
                                    </form>
                                </div>
                            </div>
                        </div>

                        <div class="col-lg-7">
                            <div class="card shadow mb-4">
                                <div class="card-header py-3 d-flex justify-content-between align-items-center">
                                    <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-history mr-2"></i>Riwayat Perubahan</h6>
                                    <button class="btn btn-sm btn-outline-primary" onclick="loadHistory()"><i class="fas fa-sync-alt"></i></button>
                                </div>
                                <div class="card-body">
                                    <div class="table-responsive">
                                        <table class="table table-bordered table-hover" id="historyTable" width="100%">
                                            <thead class="thead-light">
                                                <tr>
                                                    <th>Waktu</th>
                                                    <th>Pelanggan</th>
                                                    <th>Paket Lama</th>
                                                    <th>Paket Baru</th>
                                                    <th>Oleh</th>
                                                </tr>
                                            </thead>
                                            <tbody></tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <?php include 'footer.php'; ?>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="/static/js/rubah-paket.js"></script>
</body>
</html>
