<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Monitoring Pembayaran';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="/css/teknisi-pembayaran.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_role_aware_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_role_aware_teknisi_topbar.php'; ?>

                <div class="container-fluid">
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-file-invoice-dollar"></i></span>
                            <div>
                                <h1>Monitoring Pembayaran</h1>
                                <p class="tk-subtitle">Pantau status pembayaran pelanggan periode berjalan</p>
                            </div>
                        </div>
                        <div class="tk-actions">
                            <button class="btn btn-primary btn-sm" id="refreshBtn">
                                <i class="fas fa-sync-alt"></i> Refresh Data
                            </button>
                        </div>
                    </div>

                    <div class="alert alert-info mb-4">
                        <div class="font-weight-bold">Status bayar mengikuti periode aktif</div>
                        <div class="small mb-0">Request teknisi dan status lunas di halaman ini berlaku untuk periode tagihan berjalan. Pending bulan lalu tidak boleh memblok request bulan ini.</div>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row tk-stats-row mb-4">
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card tk-stat tk-accent-primary shadow">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Total Pelanggan</div>
                                        <div class="tk-stat-value" id="totalCustomers">-</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-users"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card tk-stat tk-accent-success shadow">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Sudah Bayar</div>
                                        <div class="tk-stat-value" id="paidCount">-</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-check-circle"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card tk-stat tk-accent-danger shadow">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Belum Bayar</div>
                                        <div class="tk-stat-value" id="unpaidCount">-</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-exclamation-circle"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card tk-stat tk-accent-warning shadow">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Persentase Lunas</div>
                                        <div class="tk-stat-value" id="paidPercentage">-</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-percentage"></i></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Filter Tabs -->
                    <div class="filter-tabs">
                        <div class="filter-tab active" data-filter="all">
                            <i class="fas fa-list"></i> Semua <span class="count" id="countAll">0</span>
                        </div>
                        <div class="filter-tab" data-filter="unpaid">
                            <i class="fas fa-times-circle text-danger"></i> Belum Bayar <span class="count" id="countUnpaid">0</span>
                        </div>
                        <div class="filter-tab" data-filter="paid">
                            <i class="fas fa-check-circle text-success"></i> Sudah Bayar <span class="count" id="countPaid">0</span>
                        </div>
                    </div>

                    <!-- Data Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-table"></i> Daftar Pelanggan</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover table-payment" id="paymentTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Pelanggan</th>
                                            <th>Paket</th>
                                            <th>Tgl Tagihan</th>
                                            <th>Status</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Konfirmasi Logout</h5>
                    <button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">Apakah Anda yakin ingin logout?</div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <a href="/logout" class="btn btn-primary">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Request Payment Modal -->
    <div class="modal fade" id="requestPaymentModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header bg-success text-white">
                    <h5 class="modal-title"><i class="fas fa-money-bill-wave"></i> Request Pembayaran</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <div class="customer-summary" id="paymentCustomerSummary">
                        <!-- Filled by JS -->
                    </div>
                    
                    <!-- Partial Payment Option -->
                    <div class="form-group">
                        <label class="font-weight-bold">Jenis Pembayaran</label>
                        <div class="custom-control custom-radio">
                            <input type="radio" id="paymentFull" name="paymentType" class="custom-control-input" value="full" checked>
                            <label class="custom-control-label" for="paymentFull">Pembayaran Penuh</label>
                        </div>
                        <div class="custom-control custom-radio">
                            <input type="radio" id="paymentPartial" name="paymentType" class="custom-control-input" value="partial">
                            <label class="custom-control-label" for="paymentPartial">Pembayaran Sebagian</label>
                        </div>
                    </div>
                    
                    <div id="partialPaymentSection" style="display: none;">
                        <div class="form-group">
                            <label for="partialAmount">Nominal yang Dibayar</label>
                            <input type="number" class="form-control" id="partialAmount" placeholder="Masukkan nominal" min="1000">
                            <small class="form-text text-muted">Minimal Rp 1.000</small>
                        </div>
                        <div class="alert alert-info" id="partialInfo" style="display: none;">
                            <i class="fas fa-info-circle"></i> 
                            <span id="partialInfoText"></span>
                        </div>
                    </div>
                    
                    <div class="form-group">
                        <label for="paymentNotes">Catatan (Opsional)</label>
                        <input type="text" class="form-control" id="paymentNotes" placeholder="Contoh: Bayar sebagian dulu" maxlength="200">
                    </div>
                    
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> 
                        <strong>Catatan:</strong> Request pembayaran akan dikirim ke admin untuk disetujui. 
                        Metode pembayaran otomatis tercatat sebagai <strong>TUNAI</strong> karena diterima langsung oleh teknisi.
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-success" id="confirmPaymentBtn">
                        <i class="fas fa-paper-plane"></i> Kirim Request
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Detail Modal -->
    <div class="modal fade" id="detailModal" tabindex="-1">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
            <div class="modal-content">
                <div class="modal-header bg-primary text-white">
                    <h5 class="modal-title"><i class="fas fa-user"></i> Detail Pelanggan</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body" id="detailModalBody"></div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

    <script src="/js/teknisi-pembayaran.js"></script>

    <style>
        @media (max-width: 768px) {
            .container-fluid { padding: 0.75rem; }
            .d-sm-flex { flex-direction: column !important; align-items: flex-start !important; }
            .d-sm-flex .btn { width: 100%; margin-top: 1rem; }
            h1.h3 { font-size: 1.25rem; }
            .stats-card .card-body { padding: 1rem; }
            .stats-value { font-size: 1.5rem; }
            .stats-icon { width: 40px; height: 40px; font-size: 1.2rem; }
            .filter-tabs { gap: 8px; }
            .filter-tab { padding: 6px 12px; font-size: 0.85rem; }
            .card-body { padding: 1rem; }
            .table-responsive { font-size: 0.85rem; }
            .btn-action { padding: 4px 8px; font-size: 0.75rem; }
            .modal-dialog { margin: 0.5rem; max-width: calc(100% - 1rem); }
            .form-control, select { font-size: 16px !important; }
        }
        @media (max-width: 576px) {
            .container-fluid { padding: 0.5rem; }
            h1.h3 { font-size: 1.1rem; }
            .stats-value { font-size: 1.25rem; }
            .stats-label { font-size: 0.75rem; }
            .stats-icon { width: 35px; height: 35px; font-size: 1rem; }
            .filter-tab { padding: 5px 10px; font-size: 0.8rem; }
            .filter-tab .count { padding: 1px 6px; font-size: 0.7rem; }
            .card-body { padding: 0.75rem; }
            .table-responsive { font-size: 0.8rem; }
            .package-badge { font-size: 0.7rem; padding: 3px 8px; }
            .customer-summary { padding: 12px; }
            .price-highlight { font-size: 1.25rem; }
        }
    </style>
</body>
</html>
