<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Monitoring Pembayaran</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        .stats-card { border-radius: 10px; transition: transform 0.2s; }
        .stats-card:hover { transform: translateY(-2px); }
        .stats-card .card-body { padding: 1.25rem; }
        .stats-icon { width: 50px; height: 50px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
        .stats-value { font-size: 1.75rem; font-weight: 700; }
        .stats-label { font-size: 0.85rem; color: #6c757d; }
        
        .badge-lunas { background-color: #28a745; color: white; }
        .badge-belum { background-color: #dc3545; color: white; }
        .badge-pending { background-color: #ffc107; color: #000; }
        
        .filter-tabs { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .filter-tab { padding: 8px 16px; border-radius: 20px; cursor: pointer; border: 2px solid #e3e6f0; background: white; transition: all 0.2s; font-weight: 500; }
        .filter-tab:hover { border-color: #4e73df; }
        .filter-tab.active { background: #4e73df; color: white; border-color: #4e73df; }
        .filter-tab .count { background: rgba(0,0,0,0.1); padding: 2px 8px; border-radius: 10px; margin-left: 5px; font-size: 0.8rem; }
        .filter-tab.active .count { background: rgba(255,255,255,0.2); }
        
        .table-payment th { background: #f8f9fc; font-weight: 600; font-size: 0.85rem; }
        .table-payment td { vertical-align: middle; }
        .customer-info { display: flex; flex-direction: column; }
        .customer-name { font-weight: 600; color: #2e2f37; }
        .customer-phone { font-size: 0.8rem; color: #6c757d; }
        .package-badge { background: #e7f1ff; color: #4e73df; padding: 4px 10px; border-radius: 15px; font-size: 0.8rem; font-weight: 500; }
        .billing-date { font-weight: 500; }
        .btn-action { padding: 5px 10px; font-size: 0.8rem; }
        
        /* Request Payment Modal */
        .customer-summary { background: #f8f9fc; border-radius: 10px; padding: 15px; margin-bottom: 20px; }
        .customer-summary h5 { margin-bottom: 10px; color: #4e73df; }
        .customer-summary .detail-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px dashed #e3e6f0; }
        .customer-summary .detail-row:last-child { border-bottom: none; }
        .customer-summary .detail-label { color: #6c757d; }
        .customer-summary .detail-value { font-weight: 600; }
        .price-highlight { font-size: 1.5rem; color: #28a745; font-weight: 700; }

        .table-payment {
            min-width: 640px;
        }

        .filter-tabs {
            align-items: stretch;
        }

        .filter-tab {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 0.35rem;
        }

        @media (max-width: 991.98px) {
            .stats-value {
                font-size: 1.5rem;
            }

            .stats-card .card-body {
                padding: 1rem;
            }
        }

        @media (max-width: 767.98px) {
            .container-fluid {
                padding: 0.875rem;
            }

            .d-sm-flex.align-items-center.justify-content-between {
                flex-direction: column;
                align-items: stretch !important;
                gap: 0.85rem;
            }

            #refreshBtn {
                width: 100%;
                justify-content: center;
            }

            .filter-tabs {
                display: grid;
                grid-template-columns: 1fr;
                gap: 0.6rem;
            }

            .filter-tab {
                width: 100%;
                justify-content: space-between;
            }

            .table-responsive {
                margin-left: -0.25rem;
                margin-right: -0.25rem;
            }

            .modal-dialog {
                margin: 0.75rem auto;
                max-width: calc(100vw - 1rem);
            }

            .customer-summary .detail-row {
                flex-direction: column;
                align-items: flex-start;
                gap: 0.2rem;
            }
        }

        @media (max-width: 575.98px) {
            .container-fluid {
                padding: 0.75rem;
            }

            .stats-card .card-body {
                padding: 0.95rem;
            }

            .stats-value {
                font-size: 1.3rem;
            }

            .stats-icon {
                width: 42px;
                height: 42px;
                font-size: 1.2rem;
            }

            .price-highlight {
                font-size: 1.25rem;
            }
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_role_aware_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_role_aware_teknisi_topbar.php'; ?>

                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <h1 class="h3 mb-0 text-gray-800">
                            <i class="fas fa-file-invoice-dollar text-primary"></i> Monitoring Pembayaran
                        </h1>
                        <button class="btn btn-primary btn-sm" id="refreshBtn">
                            <i class="fas fa-sync-alt"></i> Refresh Data
                        </button>
                    </div>

                    <div class="alert alert-info mb-4">
                        <div class="font-weight-bold">Status bayar mengikuti periode aktif</div>
                        <div class="small mb-0">Request teknisi dan status lunas di halaman ini berlaku untuk periode tagihan berjalan. Pending bulan lalu tidak boleh memblok request bulan ini.</div>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row mb-4">
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card stats-card border-left-primary shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label text-uppercase">Total Pelanggan</div>
                                            <div class="stats-value text-primary" id="totalCustomers">-</div>
                                        </div>
                                        <div class="stats-icon bg-primary text-white"><i class="fas fa-users"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card stats-card border-left-success shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label text-uppercase">Sudah Bayar</div>
                                            <div class="stats-value text-success" id="paidCount">-</div>
                                        </div>
                                        <div class="stats-icon bg-success text-white"><i class="fas fa-check-circle"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card stats-card border-left-danger shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label text-uppercase">Belum Bayar</div>
                                            <div class="stats-value text-danger" id="unpaidCount">-</div>
                                        </div>
                                        <div class="stats-icon bg-danger text-white"><i class="fas fa-exclamation-circle"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card stats-card border-left-warning shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label text-uppercase">Persentase Lunas</div>
                                            <div class="stats-value text-warning" id="paidPercentage">-</div>
                                        </div>
                                        <div class="stats-icon bg-warning text-white"><i class="fas fa-percentage"></i></div>
                                    </div>
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
        <div class="modal-dialog">
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
        <div class="modal-dialog modal-lg">
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

    <script>
        let allCustomers = [];
        let allPackages = [];
        let pendingRequests = [];
        let dataTable = null;
        let currentFilter = 'all';
        let selectedCustomerId = null;
        let selectedCustomerPaymentInfo = null;
        let billingDueDate = 10; // Default tanggal tagihan
        const customerPaymentInfoCache = new Map();

        $(document).ready(function() {
            loadTechnicianInfo();
            loadConfig();
            loadPackages();
            loadPendingRequests();
            loadCustomerData();
            setupEventHandlers();
        });

        function loadConfig() {
            fetch('/api/stats/config', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.data && data.data.tanggal_batas_bayar) {
                        billingDueDate = data.data.tanggal_batas_bayar;
                    }
                })
                .catch(err => console.error('Error loading config:', err));
        }

        function loadTechnicianInfo() {
            fetch('/api/teknisi/me', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && data.data) {
                        $('#loggedInTechnicianInfo').text(data.data.name || 'Teknisi');
                    }
                })
                .catch(() => $('#loggedInTechnicianInfo').text('Teknisi'));
        }

        function loadPackages() {
            fetch('/api/packages', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.data && Array.isArray(data.data)) {
                        allPackages = data.data;
                    } else if (Array.isArray(data)) {
                        allPackages = data;
                    }
                })
                .catch(err => console.error('Error loading packages:', err));
        }

        function getCurrentPaymentScope() {
            const now = new Date();
            return {
                period_month: now.getMonth() + 1,
                period_year: now.getFullYear()
            };
        }

        function normalizeRequestScope(request) {
            const scopeDate = new Date(request.updated_at || request.created_at || Date.now());
            const periodMonth = parseInt(request.period_month, 10) || (scopeDate.getMonth() + 1);
            const periodYear = parseInt(request.period_year, 10) || scopeDate.getFullYear();
            const requestType = request.request_type || (request.is_partial_payment ? 'partial_payment' : 'payment_status_change');

            return {
                ...request,
                period_month: periodMonth,
                period_year: periodYear,
                request_type: requestType
            };
        }

        function getPendingRequestStateForCurrentScope(userId) {
            const currentScope = getCurrentPaymentScope();
            const scopedPending = pendingRequests.filter((request) =>
                String(request.userId) === String(userId)
                && parseInt(request.period_month, 10) === currentScope.period_month
                && parseInt(request.period_year, 10) === currentScope.period_year
                && request.status === 'pending'
            );

            return {
                any: scopedPending.length > 0,
                full: scopedPending.some((request) => request.request_type === 'payment_status_change'),
                partial: scopedPending.some((request) => request.request_type === 'partial_payment')
            };
        }

        function hasPendingRequestForCurrentScope(userId, requestType) {
            const scopedState = getPendingRequestStateForCurrentScope(userId);
            return requestType === 'partial_payment' ? scopedState.partial : scopedState.full;
        }

        async function fetchCustomerPaymentInfo(customerId, options = {}) {
            const forceRefresh = Boolean(options.forceRefresh);
            if (!forceRefresh && customerPaymentInfoCache.has(String(customerId))) {
                return customerPaymentInfoCache.get(String(customerId));
            }

            const response = await fetch(`/api/partial-payment/outstanding/${customerId}`, { credentials: 'include' });
            const payload = await response.json();
            if (payload.status !== 200 || !payload.data) {
                throw new Error(payload.message || 'Gagal memuat data tagihan periode aktif');
            }

            customerPaymentInfoCache.set(String(customerId), payload.data);
            return payload.data;
        }

        function loadPendingRequests() {
            fetch('/api/requests', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && Array.isArray(data.data)) {
                        pendingRequests = data.data
                            .map(normalizeRequestScope)
                            .filter(r => r.status === 'pending');
                        if (allCustomers.length > 0) {
                            renderTable();
                        }
                    }
                })
                .catch(err => console.error('Error loading requests:', err));
        }

        function loadCustomerData() {
            $('#refreshBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memuat...');
            
            fetch('/api/users', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && Array.isArray(data.data)) {
                        customerPaymentInfoCache.clear();
                        allCustomers = data.data;
                        updateStats();
                        renderTable();
                    } else {
                        showAlert('danger', 'Gagal memuat data pelanggan');
                    }
                })
                .catch(err => {
                    console.error('Error:', err);
                    showAlert('danger', 'Terjadi kesalahan saat memuat data');
                })
                .finally(() => {
                    $('#refreshBtn').prop('disabled', false).html('<i class="fas fa-sync-alt"></i> Refresh Data');
                });
        }

        function formatCurrency(amount) {
            return 'Rp ' + Number(amount).toLocaleString('id-ID');
        }

        function updateStats() {
            // Get whitelisted package names (free packages)
            const whitelistedPackages = allPackages
                .filter(pkg => pkg.whitelist === true)
                .map(pkg => pkg.name);
            
            // Exclude whitelist users from statistics (they are free users)
            const payableCustomers = allCustomers.filter(c => !whitelistedPackages.includes(c.subscription));
            const total = payableCustomers.length;
            const paid = payableCustomers.filter(c => c.paid === true || c.paid === 1 || c.paid === 'true').length;
            const unpaid = total - paid;
            const percentage = total > 0 ? Math.round((paid / total) * 100) : 0;

            $('#totalCustomers').text(total);
            $('#paidCount').text(paid);
            $('#unpaidCount').text(unpaid);
            $('#paidPercentage').text(percentage + '%');
            $('#countAll').text(allCustomers.length);
            $('#countPaid').text(paid);
            $('#countUnpaid').text(unpaid);
        }

        function renderTable() {
            if (dataTable) dataTable.destroy();

            // Get whitelisted package names (free packages)
            const whitelistedPackages = allPackages
                .filter(pkg => pkg.whitelist === true)
                .map(pkg => pkg.name);

            let filteredData = allCustomers;
            if (currentFilter === 'paid') {
                filteredData = allCustomers.filter(c => c.paid === true || c.paid === 1 || c.paid === 'true');
            } else if (currentFilter === 'unpaid') {
                // Exclude whitelist users from unpaid filter (they are free users)
                filteredData = allCustomers.filter(c => 
                    (c.paid !== true && c.paid !== 1 && c.paid !== 'true') && 
                    !whitelistedPackages.includes(c.subscription)
                );
            }

            const tbody = $('#paymentTable tbody');
            tbody.empty();

            filteredData.forEach(customer => {
                const isPaid = customer.paid === true || customer.paid === 1 || customer.paid === 'true';
                const pendingState = getPendingRequestStateForCurrentScope(customer.id);
                const hasPending = pendingState.any;
                
                let statusBadge;
                if (hasPending) {
                    statusBadge = '<span class="badge badge-pending"><i class="fas fa-clock"></i> Menunggu Approval</span>';
                } else if (isPaid) {
                    statusBadge = '<span class="badge badge-lunas"><i class="fas fa-check"></i> Lunas</span>';
                } else {
                    statusBadge = '<span class="badge badge-belum"><i class="fas fa-times"></i> Belum Bayar</span>';
                }
                
                const phoneDisplay = customer.phone_number ? customer.phone_number.split('|')[0].trim() : '-';
                const packageName = customer.subscription || '-';

                let actionButtons = `<button class="btn btn-info btn-action" onclick="showDetail(${customer.id})" title="Lihat Detail"><i class="fas fa-eye"></i></button>`;
                
                if (!isPaid) {
                    actionButtons += ` <button class="btn btn-success btn-action" onclick="openPaymentModal(${customer.id})" title="Request Pembayaran"><i class="fas fa-money-bill-wave"></i></button>`;
                }
                if (hasPending && pendingState.full && pendingState.partial) {
                    actionButtons += ` <button class="btn btn-warning btn-action" disabled title="Menunggu Approval"><i class="fas fa-hourglass-half"></i></button>`;
                }

                const row = `
                    <tr>
                        <td><strong>${customer.id}</strong></td>
                        <td>
                            <div class="customer-info">
                                <span class="customer-name">${escapeHtml(customer.name)}</span>
                                <span class="customer-phone"><i class="fas fa-phone"></i> ${phoneDisplay}</span>
                            </div>
                        </td>
                        <td><span class="package-badge">${escapeHtml(packageName)}</span></td>
                        <td class="billing-date">Tgl ${billingDueDate}</td>
                        <td>${statusBadge}</td>
                        <td>${actionButtons}</td>
                    </tr>
                `;
                tbody.append(row);
            });

            dataTable = $('#paymentTable').DataTable({
                order: [[0, 'asc']],
                pageLength: 25,
                language: {
                    search: "Cari:",
                    lengthMenu: "Tampilkan _MENU_ data",
                    info: "Menampilkan _START_ - _END_ dari _TOTAL_ data",
                    infoEmpty: "Tidak ada data",
                    infoFiltered: "(difilter dari _MAX_ total data)",
                    zeroRecords: "Tidak ada data yang cocok",
                    paginate: { first: "Pertama", last: "Terakhir", next: "Selanjutnya", previous: "Sebelumnya" }
                },
                responsive: true
            });
        }

        function setupEventHandlers() {
            $('#refreshBtn').on('click', function() {
                loadPendingRequests();
                loadCustomerData();
            });

            $('.filter-tab').on('click', function() {
                $('.filter-tab').removeClass('active');
                $(this).addClass('active');
                currentFilter = $(this).data('filter');
                renderTable();
            });

            $('#confirmPaymentBtn').on('click', submitPaymentRequest);
            
            // Partial payment toggle
            $('input[name="paymentType"]').on('change', function() {
                if ($(this).val() === 'partial') {
                    $('#partialPaymentSection').slideDown();
                } else {
                    $('#partialPaymentSection').slideUp();
                    $('#partialAmount').val('');
                    $('#partialInfo').hide();
                }
            });
            
            // Partial amount input
            $('#partialAmount').on('input', function() {
                const amount = parseInt($(this).val()) || 0;
                const outstanding = selectedCustomerPaymentInfo?.outstanding || 0;
                if (outstanding > 0) {
                    if (amount > 0 && amount < outstanding) {
                        const remaining = outstanding - amount;
                        $('#partialInfoText').html(`Sisa tagihan: <strong>Rp ${remaining.toLocaleString('id-ID')}</strong>`);
                        $('#partialInfo').show();
                    } else if (amount >= outstanding) {
                        $('#partialInfoText').html(`Nominal sama atau lebih dari sisa tagihan. Akan diproses sebagai pelunasan periode aktif.`);
                        $('#partialInfo').show();
                    } else {
                        $('#partialInfo').hide();
                    }
                }
            });
        }

        async function openPaymentModal(customerId) {
            const customer = allCustomers.find(c => c.id === customerId);
            if (!customer) {
                showAlert('danger', 'Data pelanggan tidak ditemukan');
                return;
            }

            selectedCustomerId = customerId;
            selectedCustomerPaymentInfo = null;

            try {
                const paymentInfo = await fetchCustomerPaymentInfo(customerId, { forceRefresh: true });
                selectedCustomerPaymentInfo = paymentInfo;

                if (paymentInfo.is_fully_paid || paymentInfo.outstanding <= 0) {
                    showAlert('info', 'Pelanggan sudah lunas untuk periode aktif.');
                    loadCustomerData();
                    return;
                }

                const pendingState = getPendingRequestStateForCurrentScope(customerId);
                const infoMessages = [];
                if (pendingState.full) {
                    infoMessages.push('Request pembayaran penuh periode ini masih menunggu approval.');
                }
                if (pendingState.partial) {
                    infoMessages.push('Request pembayaran sebagian periode ini masih menunggu approval.');
                }

                const infoHtml = infoMessages.length > 0
                    ? `
                        <div class="alert alert-warning">
                            <i class="fas fa-exclamation-circle"></i> ${infoMessages.join(' ')}
                        </div>
                    `
                    : '';

                const summaryHtml = `
                    <h5><i class="fas fa-user"></i> ${escapeHtml(customer.name)}</h5>
                    <div class="detail-row">
                        <span class="detail-label">ID Pelanggan</span>
                        <span class="detail-value">${customer.id}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Paket</span>
                        <span class="detail-value">${escapeHtml(customer.subscription || '-')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tanggal Tagihan</span>
                        <span class="detail-value">Tanggal ${billingDueDate}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Tagihan Periode Aktif</span>
                        <span class="detail-value">${formatCurrency(paymentInfo.package_price)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Sudah Dibayar</span>
                        <span class="detail-value text-success">${formatCurrency(paymentInfo.total_paid)}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label"><strong>Sisa Tagihan</strong></span>
                        <span class="detail-value price-highlight">${formatCurrency(paymentInfo.outstanding)}</span>
                    </div>
                    ${infoHtml}
                `;

                $('#paymentCustomerSummary').html(summaryHtml);
                $('#paymentFull').prop('disabled', pendingState.full);
                $('#paymentPartial').prop('disabled', pendingState.partial);
                $('#paymentFull').prop('checked', !pendingState.full);
                $('#paymentPartial').prop('checked', pendingState.full && !pendingState.partial);
                $('#partialPaymentSection').toggle($('#paymentPartial').is(':checked'));
                $('#partialAmount').attr('max', paymentInfo.outstanding).val('');
                $('#partialInfo').hide();
                $('#paymentNotes').val('');
                $('#confirmPaymentBtn').prop('disabled', pendingState.full && pendingState.partial);

                $('#requestPaymentModal').modal('show');
            } catch (error) {
                console.error('Error fetching outstanding info:', error);
                showAlert('danger', error.message || 'Gagal memuat data tagihan periode aktif');
            }
        }

        function submitPaymentRequest() {
            if (!selectedCustomerId) {
                showAlert('danger', 'Pelanggan tidak dipilih');
                return;
            }

            const customer = allCustomers.find(c => c.id === selectedCustomerId);
            const paymentInfo = selectedCustomerPaymentInfo;
            if (!customer || !paymentInfo) {
                showAlert('danger', 'Data tagihan periode aktif belum siap');
                return;
            }

            const outstanding = paymentInfo.outstanding;
            const paymentType = $('input[name="paymentType"]:checked').val();
            const partialAmount = parseInt($('#partialAmount').val()) || 0;
            const notes = $('#paymentNotes').val().trim();
            const hasFullPending = hasPendingRequestForCurrentScope(selectedCustomerId, 'payment_status_change');
            const hasPartialPending = hasPendingRequestForCurrentScope(selectedCustomerId, 'partial_payment');

            if (outstanding <= 0) {
                showAlert('warning', 'Pelanggan sudah lunas untuk periode aktif');
                return;
            }

            if (paymentType === 'partial') {
                if (hasPartialPending) {
                    showAlert('warning', 'Request pembayaran sebagian untuk periode aktif masih menunggu approval.');
                    return;
                }
                if (partialAmount <= 0) {
                    showAlert('warning', 'Masukkan nominal pembayaran sebagian yang valid.');
                    return;
                }
                if (partialAmount > outstanding) {
                    showAlert('warning', `Nominal melebihi sisa tagihan periode aktif (${formatCurrency(outstanding)}).`);
                    return;
                }
            } else if (hasFullPending) {
                showAlert('warning', 'Request pembayaran penuh untuk periode aktif masih menunggu approval.');
                return;
            }

            const btn = $('#confirmPaymentBtn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Mengirim...');

            // Determine if using partial payment API
            if (paymentType === 'partial' && partialAmount > 0 && partialAmount <= outstanding) {
                // Use partial payment API
                fetch('/api/partial-payment/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        userId: selectedCustomerId,
                        amountPaid: partialAmount,
                        notes: notes
                    })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 || data.status === 201) {
                        $('#requestPaymentModal').modal('hide');
                        const msg = data.data.is_partial 
                            ? `Request pembayaran sebagian (Rp ${partialAmount.toLocaleString('id-ID')}) berhasil dikirim! Sisa: Rp ${data.data.amount_remaining.toLocaleString('id-ID')}`
                            : 'Request pembayaran berhasil dikirim!';
                        showAlert('success', msg);
                        loadPendingRequests();
                        setTimeout(() => loadCustomerData(), 500);
                    } else {
                        showAlert('danger', data.message || 'Gagal mengirim request');
                    }
                })
                .catch(err => {
                    console.error('Error:', err);
                    showAlert('danger', 'Terjadi kesalahan saat mengirim request');
                })
                .finally(() => {
                    btn.prop('disabled', false).html('<i class="fas fa-paper-plane"></i> Kirim Request');
                    selectedCustomerId = null;
                    selectedCustomerPaymentInfo = null;
                });
            } else {
                // Use regular payment API (full payment)
                fetch('/api/requests', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        userId: selectedCustomerId,
                        newStatus: true
                    })
                })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 || data.status === 201) {
                        $('#requestPaymentModal').modal('hide');
                        showAlert('success', 'Request pembayaran berhasil dikirim! Menunggu approval admin.');
                        loadPendingRequests();
                        setTimeout(() => loadCustomerData(), 500);
                    } else {
                        showAlert('danger', data.message || 'Gagal mengirim request');
                    }
                })
                .catch(err => {
                    console.error('Error:', err);
                    showAlert('danger', 'Terjadi kesalahan saat mengirim request');
                })
                .finally(() => {
                    btn.prop('disabled', false).html('<i class="fas fa-paper-plane"></i> Kirim Request');
                    selectedCustomerId = null;
                    selectedCustomerPaymentInfo = null;
                });
            }
        }

        async function showDetail(customerId) {
            const customer = allCustomers.find(c => c.id === customerId);
            if (!customer) {
                showAlert('danger', 'Data pelanggan tidak ditemukan');
                return;
            }

            const isPaid = customer.paid === true || customer.paid === 1 || customer.paid === 'true';
            const pendingState = getPendingRequestStateForCurrentScope(customer.id);
            const hasPending = pendingState.any;
            let paymentInfo = null;

            try {
                paymentInfo = await fetchCustomerPaymentInfo(customer.id);
            } catch (error) {
                console.warn('Failed to fetch customer payment info:', error);
            }
            
            let statusBadge;
            if (hasPending) {
                statusBadge = '<span class="badge badge-warning badge-lg"><i class="fas fa-clock"></i> MENUNGGU APPROVAL</span>';
            } else if (isPaid) {
                statusBadge = '<span class="badge badge-success badge-lg"><i class="fas fa-check"></i> LUNAS</span>';
            } else {
                statusBadge = '<span class="badge badge-danger badge-lg"><i class="fas fa-times"></i> BELUM BAYAR</span>';
            }

            const phones = customer.phone_number ? customer.phone_number.split('|').map(p => p.trim()).filter(p => p) : [];
            const phoneList = phones.length > 0 
                ? phones.map(p => `<a href="https://wa.me/${p}" target="_blank" class="btn btn-sm btn-success mr-1 mb-1"><i class="fab fa-whatsapp"></i> ${p}</a>`).join('')
                : '<span class="text-muted">Tidak ada nomor</span>';

            const amountDue = paymentInfo ? paymentInfo.package_price : 0;
            const outstanding = paymentInfo ? paymentInfo.outstanding : amountDue;
            const paidAmount = paymentInfo ? paymentInfo.total_paid : 0;
            const canOpenPaymentModal = !isPaid && !(pendingState.full && pendingState.partial);
            const pendingNotes = [];
            if (pendingState.full) pendingNotes.push('request pembayaran penuh periode aktif pending');
            if (pendingState.partial) pendingNotes.push('request pembayaran sebagian periode aktif pending');

            let actionSection = '';
            if (!isPaid && canOpenPaymentModal) {
                actionSection = `
                    <hr>
                    <div class="text-center">
                        <button class="btn btn-success btn-lg" onclick="$('#detailModal').modal('hide'); openPaymentModal(${customer.id});">
                            <i class="fas fa-money-bill-wave"></i> Lihat Opsi Pembayaran
                        </button>
                        ${pendingNotes.length ? `<div class="small text-warning mt-2"><i class="fas fa-info-circle"></i> ${pendingNotes.join(', ')}.</div>` : ''}
                    </div>
                `;
            } else if (hasPending) {
                actionSection = `
                    <hr>
                    <div class="text-center">
                        <div class="alert alert-warning mb-0">
                            <i class="fas fa-hourglass-half"></i> Semua opsi request untuk periode aktif sedang menunggu approval admin
                        </div>
                    </div>
                `;
            }

            const content = `
                <div class="row">
                    <div class="col-md-6">
                        <h6 class="font-weight-bold text-primary mb-3">Informasi Pelanggan</h6>
                        <table class="table table-sm">
                            <tr><td width="40%"><strong>ID</strong></td><td>${customer.id}</td></tr>
                            <tr><td><strong>Nama</strong></td><td>${escapeHtml(customer.name)}</td></tr>
                            <tr><td><strong>Alamat</strong></td><td>${escapeHtml(customer.address || '-')}</td></tr>
                            <tr><td><strong>Telepon</strong></td><td>${phoneList}</td></tr>
                        </table>
                    </div>
                    <div class="col-md-6">
                        <h6 class="font-weight-bold text-primary mb-3">Informasi Langganan</h6>
                        <table class="table table-sm">
                            <tr><td width="40%"><strong>Paket</strong></td><td><span class="package-badge">${escapeHtml(customer.subscription || '-')}</span></td></tr>
                            <tr><td><strong>Tagihan Periode Aktif</strong></td><td><strong class="text-success">${formatCurrency(amountDue)}</strong></td></tr>
                            <tr><td><strong>Sudah Dibayar</strong></td><td>${formatCurrency(paidAmount)}</td></tr>
                            <tr><td><strong>Sisa Tagihan</strong></td><td><strong class="text-danger">${formatCurrency(outstanding)}</strong></td></tr>
                            <tr><td><strong>Tgl Tagihan</strong></td><td>Tanggal ${billingDueDate}</td></tr>
                            <tr><td><strong>Status Bayar</strong></td><td>${statusBadge}</td></tr>
                        </table>
                    </div>
                </div>
                ${actionSection}
            `;

            $('#detailModalBody').html(content);
            $('#detailModal').modal('show');
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function showAlert(type, message) {
            const alertHtml = `
                <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                    ${message}
                    <button type="button" class="close" data-dismiss="alert"><span>&times;</span></button>
                </div>
            `;
            $('.container-fluid').prepend(alertHtml);
            setTimeout(() => $('.alert').alert('close'), 5000);
        }
    </script>

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
