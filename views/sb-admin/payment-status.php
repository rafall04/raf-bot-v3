<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Manajemen Status Pembayaran';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Payment Status Management';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    
    <link href="/css/payment-status.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
                    <button id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                        <i class="fa fa-bars"></i>
                    </button>
                    
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown">
                                <span class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in">
                                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                                    Logout
                                </a>
                            </div>
                        </li>
                    </ul>
                </nav>

                <div class="container-fluid">
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <h1>Manajemen Status Pembayaran</h1>
                                <p>Kelola status pembayaran pelanggan untuk periode tagihan aktif yang dipilih.</p>
                            </div>
                            <button class="btn btn-primary-custom" onclick="location.reload()">
                                <i class="fas fa-sync-alt"></i> Refresh Data
                            </button>
                        </div>
                    </div>

                    <div class="alert alert-info mb-4">
                        <div class="font-weight-bold">Status pembayaran berbasis periode</div>
                        <div class="small mb-0">
                            Angka dan aksi di halaman ini merepresentasikan status bayar untuk periode tagihan yang dipilih, bukan status pelanggan sepanjang waktu.
                        </div>
                    </div>

                    <h4 class="dashboard-section-title">Statistik Pembayaran</h4>
                    <div class="row match-height">
                        <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                            <div class="card dashboard-card card-primary">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Total Pelanggan</div>
                                            <div class="card-value" id="totalCustomers">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-circle" style="font-size: 8px;"></i>
                                                <span id="paymentPeriodStatsLabel">Periode aktif</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-users"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                            <div class="card dashboard-card card-success">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Sudah Bayar</div>
                                            <div class="card-value" id="paidCustomers">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-check-circle text-success" style="font-size: 10px;"></i>
                                                <span id="paymentPeriodPaidLabel">Lunas periode aktif</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-user-check"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                            <div class="card dashboard-card card-danger">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Belum Bayar</div>
                                            <div class="card-value" id="unpaidCustomers">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-clock text-danger" style="font-size: 10px;"></i>
                                                <span id="paymentPeriodUnpaidLabel">Belum lunas periode aktif</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-user-clock"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                            <div class="card dashboard-card card-warning">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Persentase Bayar</div>
                                            <div class="card-value" id="paidPercentage">0%</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-chart-pie" style="font-size: 10px;"></i>
                                                <span id="paymentPeriodCompletionLabel">Periode aktif</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-percentage"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <h4 class="dashboard-section-title">Filter & Pencarian</h4>
                    <div class="filter-section">
                            <div class="row">
                                <div class="col-md-2 mb-3">
                                    <label for="periodMonthFilter" class="form-label">Bulan Tagihan</label>
                                    <select id="periodMonthFilter" class="form-control"></select>
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="periodYearFilter" class="form-label">Tahun Tagihan</label>
                                    <select id="periodYearFilter" class="form-control"></select>
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="statusFilter" class="form-label">Status Pembayaran</label>
                                    <select id="statusFilter" class="form-control">
                                        <option value="">Semua Status</option>
                                        <option value="unpaid">Belum Bayar</option>
                                        <option value="paid">Sudah Bayar</option>
                                    </select>
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="subscriptionFilter" class="form-label">Paket Langganan</label>
                                    <select id="subscriptionFilter" class="form-control">
                                        <option value="">Semua Paket</option>
                                    </select>
                                </div>
                                <div class="col-md-3 mb-3">
                                    <label for="searchInput" class="form-label">Cari Pelanggan</label>
                                    <div class="input-group">
                                        <input type="text" id="searchInput" class="form-control" 
                                               placeholder="Nama, No. Telepon, atau Device ID...">
                                        <div class="input-group-append">
                                            <button class="btn btn-outline-secondary" type="button" id="searchBtn">
                                                <i class="fas fa-search"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-1 mb-3 d-flex align-items-end">
                                    <button id="clearFilters" class="btn btn-outline-secondary btn-block" style="border-radius: 8px;">
                                        <i class="fas fa-times"></i> Clear Filter
                                    </button>
                                </div>
                            </div>
                            <div class="row">
                                <div class="col-md-4 mb-3">
                                    <label for="defaultAdminPaymentMethod" class="form-label">Default Metode Pembayaran Admin</label>
                                    <select id="defaultAdminPaymentMethod" class="form-control">
                                        <option value="TRANSFER_BANK" selected>Transfer Bank</option>
                                        <option value="CASH">Cash</option>
                                    </select>
                                    <small class="form-text text-muted">Berlaku untuk aksi admin tandai bayar, termasuk bulk action.</small>
                                </div>
                                <div class="col-md-8 mb-3 d-flex align-items-end">
                                    <div class="small text-muted">
                                        Nilai default ini hanya untuk metode pembayaran yang dicatat ke histori pembayaran admin. Metode pembayaran pada invoice tetap diatur terpisah saat kirim atau cetak invoice.
                                    </div>
                                </div>
                            </div>
                            <div class="small text-muted">
                                Perubahan status bayar dan bulk action akan dicatat ke periode <span id="paymentPeriodContextText" class="font-weight-bold">-</span>.
                            </div>
                    </div>

                    <div class="action-buttons" id="bulkActions" style="display: none;">
                        <div class="filter-section" style="background: #fef3c7; border-color: var(--warning);">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <span class="font-weight-bold" style="color: var(--dark); font-size: 1rem;">
                                        <i class="fas fa-check-square" style="color: var(--warning);"></i>
                                        <span id="selectedCount">0</span> pelanggan dipilih
                                    </span>
                                    <div class="small text-muted mt-1">
                                        Bulk bayar akan dicatat sebagai:
                                        <span id="bulkDefaultMethodLabel" class="font-weight-bold">Transfer Bank</span>
                                    </div>
                                </div>
                                <div>
                                    <button id="markPaidBtn" class="btn btn-success-custom btn-sm">
                                        <i class="fas fa-check-circle"></i> Tandai Sudah Bayar
                                    </button>
                                    <button id="markUnpaidBtn" class="btn btn-warning-custom btn-sm">
                                        <i class="fas fa-times-circle"></i> Tandai Belum Bayar
                                    </button>
                                    <button id="sendInvoiceBtn" class="btn btn-primary-custom btn-sm">
                                        <i class="fas fa-file-invoice"></i> Kirim Invoice
                                    </button>
                                    <button id="deselectAllBtn" class="btn btn-outline-secondary btn-sm" style="border-radius: 6px;">
                                        <i class="fas fa-minus-square"></i> Batal Pilih
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <h4 class="dashboard-section-title">Daftar Pelanggan</h4>
                    <div class="dashboard-card" style="height: auto;">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div>
                                    <span class="font-weight-600" style="color: var(--dark); font-size: 1.1rem;">Data Pelanggan</span>
                                </div>
                                <div>
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="checkbox" id="selectAllCheckbox">
                                        <label class="form-check-label" for="selectAllCheckbox" style="font-weight: 500;">
                                            Pilih Semua di Halaman Ini
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="paymentTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th width="5%">
                                                <input type="checkbox" id="selectAllHeader" class="bulk-select-checkbox">
                                            </th>
                                            <th width="5%">ID</th>
                                            <th width="20%">Nama Pelanggan</th>
                                            <th width="15%">No. Telepon</th>
                                            <th width="15%">Paket</th>
                                            <th width="15%">Device ID</th>
                                            <th width="10%">Status</th>
                                            <th width="15%">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody id="paymentTableBody">
                                    </tbody>
                                </table>
                            </div>
                            
                            <div class="d-flex justify-content-between align-items-center mt-3">
                                <div>
                                    Menampilkan <span id="showingFrom">0</span> - <span id="showingTo">0</span> 
                                    dari <span id="totalRecords">0</span> data
                                </div>
                                <nav>
                                    <ul class="pagination" id="pagination">
                                    </ul>
                                </nav>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; RAF BOT 2025</span>
                    </div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

    <div class="modal fade" id="logoutModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">Select "Logout" to end session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="confirmStatusModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Konfirmasi Perubahan Status</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="confirmStatusUserId">
                    <input type="hidden" id="confirmStatusNewStatus">
                    <input type="hidden" id="confirmStatusSendInvoice">
                    <input type="hidden" id="confirmStatusPhoneNumber">
                    <p>Apakah Anda yakin ingin mengubah status pembayaran <strong id="confirmStatusUserName"></strong> menjadi <strong id="confirmStatusText"></strong>?</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" id="confirmStatusBtn">Ya, Ubah Status</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="paymentMethodModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="paymentMethodModalTitle">Pilih Metode Pembayaran</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="text-muted mb-3" id="paymentMethodModalContextText">Pilih metode pembayaran yang akan dipakai pada aksi ini.</p>
                    <div class="form-group">
                        <label for="paymentMethodSelect">Metode Pembayaran:</label>
                        <select class="form-control" id="paymentMethodSelect">
                            <option value="TRANSFER_BANK" selected>Transfer Bank</option>
                            <option value="CASH">Cash</option>
                        </select>
                        <small class="form-text text-muted" id="paymentMethodHelpText">Pilih metode pembayaran yang akan dipakai pada aksi ini.</small>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" id="confirmPaymentMethodBtn">Konfirmasi</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="confirmModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="confirmModalTitle">Konfirmasi</h5>
                    <button class="close" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body" id="confirmModalBody">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-primary" id="confirmActionBtn">Ya, Lanjutkan</button>
                </div>
            </div>
        </div>
    </div>

    <div class="loading-overlay" id="loadingOverlay">
        <div class="loading-content">
            <div class="spinner-border text-primary mb-3" role="status">
                <span class="sr-only">Loading...</span>
            </div>
            <div id="loadingText">Memproses...</div>
        </div>
    </div>

    <div class="toast-container" id="toastContainer"></div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="/js/payment-status.js"></script>
</body>
</html>
