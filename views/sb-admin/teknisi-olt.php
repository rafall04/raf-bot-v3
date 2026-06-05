<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Monitor OLT</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/css/teknisi-theme.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        .status-badge { font-size: 0.85rem; padding: 0.4em 0.8em; }
        .rx-power-good { color: #1cc88a; font-weight: 600; }
        .rx-power-warning { color: #f6c23e; font-weight: 600; }
        .rx-power-bad { color: #e74a3b; font-weight: 600; }
        .refresh-timer { font-size: 0.8rem; color: #858796; }
        .olt-stats-card { transition: transform 0.2s; cursor: pointer; }
        .olt-stats-card:hover { transform: translateY(-2px); }
        .olt-stats-card.online { border-left-color: #1cc88a; }
        .olt-stats-card.offline { border-left-color: #858796; }
        .olt-stats-card.los { border-left-color: #f6c23e; }
        .olt-stats-card.dying-gasp { border-left-color: #e74a3b; }
        .customer-info { font-size: 0.85rem; color: #5a5c69; }
        .mac-address { font-family: 'Courier New', monospace; font-size: 0.8rem; color: #858796; }
        .switch { position: relative; display: inline-block; width: 50px; height: 24px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #ccc; transition: .4s; border-radius: 24px; }
        .slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: #1cc88a; }
        input:checked + .slider:before { transform: translateX(26px); }
        .clickable-row { cursor: pointer; }
        .clickable-row:hover { background-color: #f8f9fc; }
        .detail-label { font-weight: 600; color: #5a5c69; font-size: 0.85rem; }
        .detail-value { font-size: 0.95rem; }
        .rx-power-large { font-size: 2.5rem; font-weight: 700; text-shadow: 1px 1px 2px rgba(0,0,0,0.2); }
        .modal-rx-good { color: #00ff88; }
        .modal-rx-warning { color: #ffdd00; }
        .modal-rx-bad { color: #ff4444; }
        .info-card { border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1rem; }
        .info-card.signal { 
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%); 
            color: white; 
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        .info-card.signal .text-white-50 { color: rgba(255,255,255,0.7) !important; }
        .info-card.status { background: #f8f9fc; border: 1px solid #e3e6f0; }
        /* ── Loading overlay & empty state ───────────────────────────── */
        .olt-card-body { position: relative; min-height: 200px; }
        .olt-loading-overlay {
            position: absolute; inset: 0; z-index: 20;
            background: rgba(255,255,255,0.9);
            display: flex; align-items: center; justify-content: center;
            border-radius: 0 0 0.35rem 0.35rem;
            animation: olt-fade-in 0.2s ease;
        }
        .olt-loading-content { text-align: center; max-width: 340px; padding: 1rem; }
        .olt-spinner {
            width: 46px; height: 46px; margin: 0 auto 0.85rem;
            border: 4px solid #e3e6f0; border-top-color: #4e73df;
            border-radius: 50%; animation: olt-spin 0.8s linear infinite;
        }
        @keyframes olt-spin { to { transform: rotate(360deg); } }
        .olt-loading-title { font-weight: 700; color: #4e73df; }
        .olt-loading-sub { font-size: 0.85rem; color: #858796; margin-top: 0.25rem; min-height: 1.1em; }
        .olt-progress {
            width: 220px; height: 4px; margin: 0.9rem auto 0;
            background: #e3e6f0; border-radius: 2px; overflow: hidden; position: relative;
        }
        .olt-progress-bar {
            position: absolute; top: 0; height: 100%; width: 35%;
            background: linear-gradient(90deg, #4e73df, #36b9cc); border-radius: 2px;
            animation: olt-indet 1.15s ease-in-out infinite;
        }
        @keyframes olt-indet { 0% { left: -35%; } 100% { left: 100%; } }
        @keyframes olt-fade-in { from { opacity: 0; } to { opacity: 1; } }
        .olt-empty { text-align: center; padding: 2.75rem 1rem; color: #858796; animation: olt-fade-in 0.25s ease; }
        .olt-empty > i { font-size: 2.75rem; color: #d1d3e2; margin-bottom: 0.75rem; display: block; }
        .olt-empty .olt-empty-title { font-weight: 600; color: #5a5c69; font-size: 1.05rem; }
        .btn.is-loading { pointer-events: none; opacity: 0.65; }
        .olt-just-loaded tbody tr { animation: olt-fade-in 0.3s ease; }
        @media (max-width: 768px) {
            .container-fluid { padding: 0.75rem; }
            h1.h3 { font-size: 1.25rem; }
            .card-body { padding: 1rem; }
            .table-responsive { font-size: 0.8rem; }
            .table td, .table th { padding: 0.5rem; }
            .olt-stats-card .h5 { font-size: 1.2rem; }
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
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-broadcast-tower"></i></span>
                            <div>
                                <h1>Monitor OLT</h1>
                                <p class="tk-subtitle">Pantau status ONT pelanggan secara real-time</p>
                            </div>
                        </div>
                        <div class="tk-actions align-items-center">
                            <span class="refresh-timer mr-3" id="lastUpdateTime">Belum dimuat</span>
                            <div class="mr-3 d-flex align-items-center">
                                <label class="switch mb-0 mr-2">
                                    <input type="checkbox" id="autoRefreshToggle">
                                    <span class="slider"></span>
                                </label>
                                <small class="text-muted">Auto</small>
                            </div>
                            <button class="btn btn-primary btn-sm" id="refreshOltBtn">
                                <i class="fas fa-sync-alt"></i> Refresh
                            </button>
                        </div>
                    </div>

                    <div id="oltStatusAlert" class="alert alert-info" style="display: none;">
                        <span id="oltStatusMessage"></span>
                    </div>

                    <!-- Statistics Cards -->
                    <div class="row tk-stats-row mb-4">
                        <div class="col-6 col-xl-3 mb-4">
                            <div class="card olt-stats-card online tk-stat tk-accent-success shadow" data-filter="online">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Online</div>
                                        <div class="tk-stat-value" id="statOnline">-</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-check-circle"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-4">
                            <div class="card olt-stats-card offline tk-stat tk-accent-secondary shadow" data-filter="offline">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Offline</div>
                                        <div class="tk-stat-value" id="statOffline">-</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-times-circle"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-4">
                            <div class="card olt-stats-card los tk-stat tk-accent-warning shadow" data-filter="los">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">LOS</div>
                                        <div class="tk-stat-value" id="statLos">-</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-exclamation-triangle"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-4">
                            <div class="card olt-stats-card dying-gasp tk-stat tk-accent-danger shadow" data-filter="dying_gasp">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Dying Gasp</div>
                                        <div class="tk-stat-value" id="statDyingGasp">-</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-bolt"></i></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Main Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3 d-flex justify-content-between align-items-center flex-wrap">
                            <h6 class="m-0 font-weight-bold text-primary">
                                <i class="fas fa-list"></i> Data ONU OLT
                                <small class="text-muted ml-2">(Klik baris untuk detail)</small>
                            </h6>
                            <div class="d-flex align-items-center mt-2 mt-md-0 flex-wrap">
                                <select id="oltSelector" class="form-control form-control-sm mr-2 mb-1" style="width: auto;" title="Pilih OLT">
                                    <option value="">— Pilih OLT —</option>
                                </select>
                                <div class="btn-group btn-group-sm mr-2 mb-1" role="group" id="viewModeToggle" title="Mode tampilan">
                                    <button type="button" class="btn btn-primary" data-view="all">Semua ONU</button>
                                    <button type="button" class="btn btn-outline-primary" data-view="matched">Pelanggan</button>
                                </div>
                                <select id="statusFilter" class="form-control form-control-sm mr-2 mb-1" style="width: auto;">
                                    <option value="">Semua Status</option>
                                    <option value="online">Online</option>
                                    <option value="offline">Offline</option>
                                    <option value="los">LOS</option>
                                    <option value="dying_gasp">Dying Gasp</option>
                                </select>
                                <select id="sortFilter" class="form-control form-control-sm" style="width: auto;">
                                    <option value="rx_asc">Redaman ↑ (Terburuk)</option>
                                    <option value="rx_desc">Redaman ↓ (Terbaik)</option>
                                    <option value="name_asc">Nama A-Z</option>
                                    <option value="name_desc">Nama Z-A</option>
                                </select>
                            </div>
                        </div>
                        <div class="card-body olt-card-body">
                            <!-- Loading overlay (animasi ringan saat ambil data dari OLT) -->
                            <div id="oltLoadingOverlay" class="olt-loading-overlay" style="display: none;">
                                <div class="olt-loading-content">
                                    <div class="olt-spinner"></div>
                                    <div class="olt-loading-title" id="oltLoadingTitle">Memuat data ONU…</div>
                                    <div class="olt-loading-sub" id="oltLoadingSub">Menghubungi OLT</div>
                                    <div class="olt-progress"><div class="olt-progress-bar"></div></div>
                                </div>
                            </div>
                            <!-- Empty state: belum pilih OLT -->
                            <div id="oltEmptyState" class="olt-empty" style="display: none;">
                                <i class="fas fa-network-wired"></i>
                                <div class="olt-empty-title">Pilih OLT untuk memuat data</div>
                                <div class="small">Data ONU diambil langsung dari OLT yang dipilih.</div>
                            </div>
                            <div class="table-responsive" id="oltTableWrap">
                                <table class="table table-bordered table-hover" id="oltDataTable" width="100%">
                                    <thead class="thead-light">
                                        <tr>
                                            <th>Pelanggan</th>
                                            <th>PPPoE</th>
                                            <th>Redaman (dBm)</th>
                                            <th>Status OLT</th>
                                            <th>OLT</th>
                                            <th>Slot/ONU</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody id="oltTableBody"></tbody>
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
        <div class="modal-dialog"><div class="modal-content">
            <div class="modal-header"><h5 class="modal-title">Keluar?</h5><button class="close" data-dismiss="modal">&times;</button></div>
            <div class="modal-body">Pilih "Logout" untuk mengakhiri sesi.</div>
            <div class="modal-footer"><button class="btn btn-secondary" data-dismiss="modal">Batal</button><a class="btn btn-primary" href="/logout">Logout</a></div>
        </div></div>
    </div>

    <!-- Customer Detail Modal -->
    <div class="modal fade" id="customerDetailModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header bg-primary text-white">
                    <h5 class="modal-title"><i class="fas fa-user"></i> <span id="modalCustomerName">Detail Pelanggan</span></h5>
                    <button type="button" class="close text-white" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <!-- Signal Card -->
                    <div class="info-card signal text-center">
                        <div class="row align-items-center">
                            <div class="col-md-6">
                                <small class="text-white-50">REDAMAN (RX POWER)</small>
                                <div class="rx-power-large" id="modalRxPower">-</div>
                                <span id="modalRxStatus" class="badge badge-light">-</span>
                            </div>
                            <div class="col-md-6">
                                <small class="text-white-50">STATUS OLT</small>
                                <div class="h4 mb-0" id="modalOltStatus">-</div>
                                <small class="text-white-50 mt-2 d-block" id="modalLastCheck">-</small>
                            </div>
                        </div>
                    </div>

                    <!-- Customer Info -->
                    <div class="info-card status">
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <div class="detail-label"><i class="fas fa-user mr-1"></i> Nama Pelanggan</div>
                                <div class="detail-value" id="modalName">-</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <div class="detail-label"><i class="fas fa-network-wired mr-1"></i> PPPoE Username</div>
                                <div class="detail-value" id="modalPppoe">-</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <div class="detail-label"><i class="fas fa-box mr-1"></i> Paket Langganan</div>
                                <div class="detail-value" id="modalPackage">-</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <div class="detail-label"><i class="fas fa-wifi mr-1"></i> Status Koneksi</div>
                                <div class="detail-value" id="modalConnectionStatus">-</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <div class="detail-label"><i class="fas fa-map-marker-alt mr-1"></i> Alamat</div>
                                <div class="detail-value" id="modalAddress">-</div>
                            </div>
                            <div class="col-md-6 mb-3">
                                <div class="detail-label"><i class="fas fa-phone mr-1"></i> Telepon</div>
                                <div class="detail-value" id="modalPhone">-</div>
                            </div>
                        </div>
                    </div>

                    <!-- Technical Info -->
                    <div class="info-card status">
                        <h6 class="font-weight-bold text-primary mb-3"><i class="fas fa-cogs"></i> Informasi Teknis</h6>
                        <div class="row">
                            <div class="col-md-3 mb-2">
                                <div class="detail-label"><i class="fas fa-broadcast-tower mr-1"></i> Nama OLT</div>
                                <div class="detail-value" id="modalOltName">-</div>
                            </div>
                            <div class="col-md-3 mb-2">
                                <div class="detail-label">MAC OLT</div>
                                <div class="detail-value mac-address" id="modalMacOlt">-</div>
                            </div>
                            <div class="col-md-3 mb-2">
                                <div class="detail-label">MAC MikroTik</div>
                                <div class="detail-value mac-address" id="modalMacMikrotik">-</div>
                            </div>
                            <div class="col-md-3 mb-2">
                                <div class="detail-label">Slot / ONU ID</div>
                                <div class="detail-value" id="modalSlotOnu">-</div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-info" id="refreshCustomerOltBtn">
                        <i class="fas fa-sync-alt"></i> Refresh Redaman
                    </button>
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

    <script>
        // Global variables
        let dataTableInstance = null;
        let autoRefreshInterval = null;
        let matchedData = [];
        let usersData = [];
        let activePppoeUsersMap = new Map();
        let pppoeUserMacMap = new Map();
        let currentCustomerData = null;
        let oltColdRetryDone = false;
        let currentOltFilter = '';      // '' = belum pilih | 'all' = semua | id OLT tertentu
        let currentViewMode = 'all';    // 'all' = semua ONU | 'matched' = hanya pelanggan terdaftar
        let oltDevicesList = [];        // daftar OLT dari API (untuk dropdown)
        let oltLoading = false;         // guard supaya tidak dobel-fetch saat load berjalan
        const AUTO_REFRESH_INTERVAL = 30000;

        $(document).ready(async function() {
            loadTechnicianInfo();
            initDataTable();
            initOltViewControls();
            // Pastikan data pelanggan siap sebelum query OLT agar enrichment lengkap di paint pertama
            await loadUsersData();
            await loadDevicesOnly(); // hanya isi dropdown OLT; data ONU dimuat setelah pilih OLT
            
            $('#refreshOltBtn').on('click', () => loadAllData(true));
            $('#autoRefreshToggle').on('change', function() {
                this.checked ? startAutoRefresh() : stopAutoRefresh();
            });
            $('#statusFilter').on('change', function() {
                filterByStatus(this.value);
            });
            $('#sortFilter').on('change', function() {
                applySorting(this.value);
            });
            
            // Stats card click to filter
            $('.olt-stats-card').on('click', function() {
                const filter = $(this).data('filter');
                $('#statusFilter').val(filter).trigger('change');
            });
            
            // Refresh button in modal
            $('#refreshCustomerOltBtn').on('click', refreshCustomerOlt);
        });

        function loadTechnicianInfo() {
            fetch('/api/me', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && data.user) {
                        $('#loggedInTechnicianInfo').text(data.user.name || data.user.username);
                    }
                }).catch(console.error);
        }

        async function loadUsersData() {
            try {
                const res = await fetch('/api/users?limit=9999', { credentials: 'include' });
                const result = await res.json();
                if (result.status === 200 && result.data) {
                    usersData = result.data;
                    console.log(`[Users] Loaded ${usersData.length} users`);
                }
            } catch (e) { console.error('Error loading users:', e); }
        }

        function initDataTable() {
            dataTableInstance = $('#oltDataTable').DataTable({
                data: [],
                columns: [
                    {
                        data: null, title: 'Pelanggan / ONU',
                        render: (data, type, row) => {
                            if (type === 'display') {
                                if (row.customer_name) {
                                    let html = `<strong>${row.customer_name}</strong>`;
                                    if (row.customer_address) {
                                        const addr = row.customer_address.length > 30 ? row.customer_address.substring(0, 30) + '...' : row.customer_address;
                                        html += `<br><small class="customer-info">${addr}</small>`;
                                    }
                                    return html;
                                }
                                // ONU belum terhubung ke pelanggan: tampilkan identitas ONU.
                                const ident = row.description || row.serial || '-';
                                return `<span class="text-muted"><i class="fas fa-plug"></i> ${ident}</span><br><small class="text-muted">(belum terdaftar)</small>`;
                            }
                            return row.customer_name || row.description || row.serial || '';
                        }
                    },
                    { 
                        data: 'pppoe_username', title: 'PPPoE',
                        render: (data, type, row) => {
                            if (type === 'display') {
                                let html = data || '-';
                                if (row.is_online) html += ' <span class="badge badge-success">ON</span>';
                                return html;
                            }
                            return data || '';
                        }
                    },
                    { 
                        data: 'rx_power', title: 'Redaman',
                        render: (data, type, row) => {
                            if (type === 'display') return renderRxPower(data);
                            if (type === 'sort' || type === 'type') {
                                if (data && data !== 'N/A') {
                                    const num = parseFloat(data);
                                    return isNaN(num) ? -999 : num;
                                }
                                return -999;
                            }
                            return data;
                        }
                    },
                    {
                        data: 'olt_status', title: 'Status',
                        render: (data, type, row) => type === 'display' ? renderOltStatus(row) : data || ''
                    },
                    {
                        data: 'olt_name', title: 'OLT',
                        render: (data, type, row) => type === 'display' ? renderOltName(row) : (data || '')
                    },
                    {
                        data: null, title: 'Slot/ONU',
                        render: (data, type, row) => {
                            if (row.pon_name) return row.pon_name; // GPON: label human (ONU-1:1)
                            return (row.slot_id && row.onu_id) ? `${row.slot_id}/${row.onu_id}` : '-';
                        }
                    },
                    {
                        data: null, title: 'Aksi', orderable: false, searchable: false,
                        render: (data, type, row) => {
                            return `<button class="btn btn-info btn-sm btn-detail" data-key="${row._key}" title="Lihat Detail">
                                <i class="fas fa-info-circle"></i>
                            </button>`;
                        }
                    }
                ],
                order: [[2, 'asc']], // Default: Redaman ascending (terburuk dulu)
                pageLength: 25,
                language: {
                    search: "Cari:", lengthMenu: "Tampilkan _MENU_",
                    info: "_START_-_END_ dari _TOTAL_", infoEmpty: "Tidak ada data",
                    infoFiltered: "(filter dari _MAX_)", zeroRecords: "Tidak ditemukan",
                    paginate: { first: "«", last: "»", next: "›", previous: "‹" }
                },
                dom: '<"row"<"col-sm-12 col-md-6"l><"col-sm-12 col-md-6"f>>rtip',
                createdRow: function(row, data) {
                    $(row).addClass('clickable-row').attr('data-key', data._key);
                }
            });

            // Row click handler
            $('#oltDataTable tbody').on('click', 'tr.clickable-row', function(e) {
                if ($(e.target).closest('button').length) return; // Ignore button clicks
                const key = $(this).data('key');
                if (key) showCustomerDetail(key);
            });

            // Button click handler
            $('#oltDataTable tbody').on('click', '.btn-detail', function(e) {
                e.stopPropagation();
                const key = $(this).data('key');
                if (key) showCustomerDetail(key);
            });
        }

        async function loadAllData(showLoading = false) {
            // Belum pilih OLT → jangan query apa pun.
            if (!currentOltFilter) { showOltEmptyState(); return; }
            if (oltLoading) return; // cegah dobel-fetch
            oltLoading = true;

            // Overlay penuh hanya untuk load eksplisit / pertama; auto-refresh senyap.
            const explicit = showLoading || matchedData.length === 0;
            if (explicit) {
                setControlsLoading(true);
                const dev = oltDevicesList.find(d => d.id === currentOltFilter);
                const oltName = currentOltFilter === 'all' ? 'semua OLT' : (dev ? dev.name : 'OLT');
                showLoadingOverlay('Memuat data ONU…', 'Menghubungi ' + oltName + ' — OLT besar bisa ~30 detik');
            }

            try {
                await loadPppoeData();
                await loadOltMatchedData(showLoading);
                updateLastUpdateTime();
            } catch (e) {
                console.error('Error:', e);
                showAlert('danger', 'Gagal memuat data: ' + e.message);
            } finally {
                if (explicit) { hideLoadingOverlay(); setControlsLoading(false); }
                oltLoading = false;
            }
        }

        // ── Loading overlay & kontrol ────────────────────────────────────
        function showLoadingOverlay(title, sub) {
            $('#oltLoadingTitle').text(title || 'Memuat data ONU…');
            $('#oltLoadingSub').text(sub || '');
            $('#oltEmptyState').hide();
            $('#oltTableWrap').show();
            $('#oltLoadingOverlay').css('display', 'flex');
            hideAlert();
        }
        function hideLoadingOverlay() { $('#oltLoadingOverlay').hide(); }

        function setControlsLoading(on) {
            $('#oltSelector').prop('disabled', on);
            $('#refreshOltBtn').prop('disabled', on).toggleClass('is-loading', on)
                .html(on ? '<i class="fas fa-spinner fa-spin"></i> Memuat…' : '<i class="fas fa-sync-alt"></i> Refresh');
        }

        async function loadPppoeData() {
            try {
                const res = await fetch('/api/mikrotik/ppp-active-users?_=' + Date.now(), { credentials: 'include' });
                const result = await res.json();
                if (result.status === 200 && Array.isArray(result.data)) {
                    activePppoeUsersMap.clear();
                    pppoeUserMacMap.clear();
                    result.data.forEach(u => {
                        if (u.name) {
                            activePppoeUsersMap.set(u.name, u.address || '');
                            if (u.caller_id) pppoeUserMacMap.set(u.name, u.caller_id);
                        }
                    });
                }
            } catch (e) { console.error('PPPoE error:', e); }
        }

        // Kontrol view OLT-centric: dropdown pilih OLT + toggle Semua ONU / Pelanggan.
        function initOltViewControls() {
            $('#oltSelector').on('change', function () {
                currentOltFilter = this.value; // '' | 'all' | id
                oltColdRetryDone = false;
                if (!currentOltFilter) { showOltEmptyState(); return; }
                loadAllData(true);
            });
            $('#viewModeToggle button').on('click', function () {
                currentViewMode = $(this).data('view');
                $('#viewModeToggle button').removeClass('btn-primary').addClass('btn-outline-primary');
                $(this).removeClass('btn-outline-primary').addClass('btn-primary');
                if (currentOltFilter) renderCurrentView();
            });
        }

        // Hanya isi dropdown OLT (tanpa query ONU). "Pilih OLT dulu, baru ambil data."
        async function loadDevicesOnly() {
            try {
                const res = await fetch('/api/olt/onus?devicesOnly=true&_=' + Date.now(), { credentials: 'include' });
                const result = await res.json();
                if (result.status === 200) {
                    if (!result.enabled) {
                        showAlert('warning', 'OLT tidak diaktifkan. Aktifkan di Konfigurasi.');
                        return;
                    }
                    populateOltSelector(result.oltDevices || []);
                    showOltEmptyState();
                }
            } catch (e) {
                console.error('Load devices error:', e);
                showAlert('danger', 'Gagal memuat daftar OLT: ' + e.message);
            }
        }

        function showOltEmptyState() {
            updateStats(0, 0, 0, 0);
            if (dataTableInstance) dataTableInstance.clear().draw();
            hideLoadingOverlay();
            $('#oltTableWrap').hide();
            $('#oltEmptyState').show();
            hideAlert();
        }

        function populateOltSelector(devices) {
            oltDevicesList = devices || [];
            const opts = ['<option value="">— Pilih OLT —</option>', '<option value="all">Semua OLT</option>'].concat(
                oltDevicesList.map(d => {
                    const tag = d.brand && d.brand !== 'auto' ? ` (${String(d.brand).toUpperCase()})` : '';
                    return `<option value="${d.id}">${d.name}${tag}</option>`;
                })
            );
            const $sel = $('#oltSelector');
            if ($sel.children().length !== opts.length) $sel.html(opts.join(''));
            $sel.val(currentOltFilter);
        }

        function renderCurrentView() {
            const view = currentViewMode === 'matched' ? matchedData.filter(r => r.matched) : matchedData;
            updateStatsFromData(view);
            dataTableInstance.clear().rows.add(view).draw();
            $('#oltEmptyState').hide();
            $('#oltTableWrap').show();
            const $wrap = $('#oltTableWrap').addClass('olt-just-loaded');
            setTimeout(() => $wrap.removeClass('olt-just-loaded'), 400);
        }

        async function loadOltMatchedData(force = false) {
            if (!currentOltFilter) { showOltEmptyState(); return; }
            try {
                const oltParam = (currentOltFilter && currentOltFilter !== 'all')
                    ? '&oltId=' + encodeURIComponent(currentOltFilter) : '';
                const forceParam = force ? '&force=true' : '';
                const res = await fetch('/api/olt/onus?_=' + Date.now() + oltParam + forceParam, { credentials: 'include' });
                const result = await res.json();

                if (result.status === 200) {
                    if (!result.enabled) {
                        showAlert('warning', 'OLT tidak diaktifkan. Aktifkan di Konfigurasi.');
                        updateStats(0, 0, 0, 0);
                        dataTableInstance.clear().draw();
                        return;
                    }
                    if (result.error) {
                        showAlert('danger', result.message || 'Gagal mengambil data OLT');
                        return;
                    }

                    if (Array.isArray(result.oltDevices)) populateOltSelector(result.oltDevices);

                    matchedData = result.data || [];

                    // Enrich with user data and online status
                    matchedData.forEach(item => {
                        item._key = `${item.olt_id}|${item.slot_id}|${item.onu_id}`;
                        item.is_online = activePppoeUsersMap.has(item.pppoe_username);
                        if (item.user_id) {
                            const user = usersData.find(u => u.id == item.user_id);
                            if (user) {
                                item.customer_phone = user.phone || item.customer_phone;
                                item.customer_package = user.subscription || item.customer_package;
                                item.customer_address = user.address || item.customer_address;
                            }
                        }
                    });

                    renderCurrentView();
                    hideAlert();

                    // Cold-start backend: poll OLT/SNMP pertama bisa belum siap sehingga data kosong.
                    // Lakukan satu kali retry otomatis agar teknisi tidak perlu menekan Refresh manual.
                    if (matchedData.length === 0 && !oltColdRetryDone) {
                        oltColdRetryDone = true;
                        showAlert('info', 'Menyiapkan data OLT… memuat ulang otomatis.');
                        setTimeout(() => loadAllData(false), 6000);
                    }
                }
            } catch (e) {
                console.error('OLT error:', e);
                showAlert('danger', 'Gagal terhubung: ' + e.message);
            }
        }

        function showCustomerDetail(key) {
            const customer = matchedData.find(m => m._key === key);
            if (!customer) {
                alert('Data ONU tidak ditemukan');
                return;
            }

            currentCustomerData = customer;

            // Update modal content (ONU belum terdaftar → pakai identitas ONU).
            const displayName = customer.customer_name || customer.description || customer.serial || 'Detail ONU';
            $('#modalCustomerName').text(displayName);
            $('#modalName').text(customer.customer_name || '(belum terdaftar)');
            $('#modalPppoe').text(customer.pppoe_username || '-');
            $('#modalPackage').text(customer.customer_package || '-');
            $('#modalAddress').text(customer.customer_address || '-');
            $('#modalPhone').text(customer.customer_phone || '-');
            const brandBadge = customer.olt_brand === 'zte'
                ? ' <span class="badge badge-info" title="GPON">ZTE GPON</span>'
                : (customer.olt_brand === 'hioso' ? ' <span class="badge badge-secondary" title="EPON">HIOSO</span>' : '');
            $('#modalOltName').html((customer.olt_name || '-') + brandBadge);

            // GPON tanpa MAC ONU → tampilkan Serial Number.
            if (customer.mac_olt && customer.mac_olt !== 'N/A') {
                $('#modalMacOlt').text(customer.mac_olt);
            } else if (customer.serial) {
                $('#modalMacOlt').text('SN: ' + customer.serial);
            } else {
                $('#modalMacOlt').text('-');
            }

            // MAC MikroTik dengan indikator source
            let macMikrotikHtml = customer.mac_mikrotik || '-';
            if (customer.mac_source === 'cached') {
                macMikrotikHtml += ' <span class="badge badge-warning" title="MAC dari cache (pelanggan offline)"><i class="fas fa-history"></i></span>';
            } else if (customer.mac_source === 'olt' || (!customer.mac_mikrotik && customer.olt_brand === 'zte')) {
                macMikrotikHtml = '<span class="text-muted">— (match via PPPoE)</span>';
            }
            $('#modalMacMikrotik').html(macMikrotikHtml);

            $('#modalSlotOnu').text(customer.pon_name || ((customer.slot_id && customer.onu_id) ? `${customer.slot_id} / ${customer.onu_id}` : '-'));
            
            // Connection status
            const isOnline = activePppoeUsersMap.has(customer.pppoe_username);
            $('#modalConnectionStatus').html(isOnline ? 
                '<span class="badge badge-success"><i class="fas fa-check"></i> Online</span>' : 
                '<span class="badge badge-secondary"><i class="fas fa-times"></i> Offline</span>');
            
            // RX Power
            updateModalRxPower(customer.rx_power, customer.olt_status, customer.is_dying_gasp, customer.is_los);
            
            $('#modalLastCheck').text('Terakhir cek: ' + new Date().toLocaleTimeString('id-ID'));
            
            $('#customerDetailModal').modal('show');
        }

        function updateModalRxPower(rxPower, oltStatus, isDyingGasp, isLos) {
            let rxClass = 'modal-rx-good';
            let rxStatus = 'Bagus';
            
            if (rxPower && rxPower !== 'N/A') {
                const val = parseFloat(rxPower);
                if (!isNaN(val)) {
                    if (val < -25) { rxClass = 'modal-rx-bad'; rxStatus = 'Buruk'; }
                    else if (val < -20) { rxClass = 'modal-rx-warning'; rxStatus = 'Perhatian'; }
                }
                $('#modalRxPower').removeClass('modal-rx-good modal-rx-warning modal-rx-bad').addClass(rxClass).text(rxPower);
                $('#modalRxStatus').text(rxStatus);
            } else {
                $('#modalRxPower').removeClass('modal-rx-good modal-rx-warning modal-rx-bad').text('N/A');
                $('#modalRxStatus').text('-');
            }
            
            // OLT Status
            let statusHtml = '';
            if (isDyingGasp) {
                statusHtml = '<span class="badge badge-danger"><i class="fas fa-bolt"></i> Dying Gasp</span>';
            } else if (isLos) {
                statusHtml = '<span class="badge badge-warning"><i class="fas fa-exclamation-triangle"></i> LOS</span>';
            } else if (oltStatus === 'Online') {
                statusHtml = '<span class="badge badge-success"><i class="fas fa-check"></i> Online</span>';
            } else {
                statusHtml = '<span class="badge badge-secondary"><i class="fas fa-times"></i> Offline</span>';
            }
            $('#modalOltStatus').html(statusHtml);
        }

        async function refreshCustomerOlt() {
            if (!currentCustomerData) return;
            
            // Pastikan ada slot_id dan onu_id
            if (!currentCustomerData.slot_id || !currentCustomerData.onu_id) {
                alert('Data Slot/ONU tidak tersedia untuk pelanggan ini');
                return;
            }
            
            const btn = $('#refreshCustomerOltBtn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memuat...');
            
            try {
                // FAST REFRESH - query realtime untuk 1 ONT ini
                const res = await fetch('/api/olt/refresh-single', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        slotId: currentCustomerData.slot_id,
                        onuId: currentCustomerData.onu_id
                    })
                });
                const result = await res.json();
                
                if (result.status === 200) {
                    if (result.error) {
                        // Error dari SNMP
                        alert(result.message || 'Gagal mengambil data dari OLT');
                    } else if (result.data) {
                        // Data berhasil diambil (bisa Online atau Offline)
                        const data = result.data;
                        updateModalRxPower(data.rx_power, data.olt_status, data.is_dying_gasp, data.is_los);
                        $('#modalLastCheck').text('Terakhir cek: ' + new Date().toLocaleTimeString('id-ID'));
                        
                        // Update in matchedData array too
                        const idx = matchedData.findIndex(m => m.user_id == currentCustomerData.user_id);
                        if (idx !== -1) {
                            matchedData[idx].rx_power = data.rx_power;
                            matchedData[idx].olt_status = data.olt_status;
                            matchedData[idx].is_dying_gasp = data.is_dying_gasp;
                            matchedData[idx].is_los = data.is_los;
                            
                            // Update currentCustomerData juga
                            currentCustomerData.rx_power = data.rx_power;
                            currentCustomerData.olt_status = data.olt_status;
                            currentCustomerData.is_dying_gasp = data.is_dying_gasp;
                            currentCustomerData.is_los = data.is_los;
                            
                            dataTableInstance.clear().rows.add(matchedData).draw();
                        }
                    } else {
                        // Tidak ada data (seharusnya tidak terjadi dengan perbaikan backend)
                        alert('Data ONT tidak ditemukan di OLT');
                    }
                } else {
                    alert(result.message || 'Gagal refresh data');
                }
            } catch (e) {
                console.error('Refresh error:', e);
                alert('Gagal refresh: ' + e.message);
            } finally {
                btn.prop('disabled', false).html('<i class="fas fa-sync-alt"></i> Refresh Redaman');
            }
        }

        function renderRxPower(rxPower) {
            if (!rxPower || rxPower === 'N/A') return '<span class="text-muted">N/A</span>';
            const val = parseFloat(rxPower);
            if (isNaN(val)) return `<span class="text-muted">${rxPower}</span>`;
            
            let cls = 'rx-power-good', icon = 'fa-signal';
            if (val < -25) { cls = 'rx-power-bad'; icon = 'fa-exclamation-circle'; }
            else if (val < -20) { cls = 'rx-power-warning'; icon = 'fa-exclamation-triangle'; }
            
            return `<span class="${cls}"><i class="fas ${icon}"></i> ${rxPower}</span>`;
        }

        function renderOltStatus(row) {
            if (row.is_dying_gasp) return '<span class="badge badge-danger"><i class="fas fa-bolt"></i> DG</span>';
            if (row.is_los) return '<span class="badge badge-warning"><i class="fas fa-exclamation-triangle"></i> LOS</span>';
            if (row.olt_status === 'Online') return '<span class="badge badge-success"><i class="fas fa-check"></i></span>';
            return '<span class="badge badge-secondary"><i class="fas fa-times"></i></span>';
        }

        function renderOltName(row) {
            if (!row.olt_name) return '<span class="text-muted">-</span>';
            const safeName = $('<div>').text(row.olt_name).html();
            const title = row.olt_host ? `Host: ${row.olt_host}` : 'Nama OLT';
            // Tanda "dari cache" hanya untuk EPON (match via MAC). GPON (ZTE) match via
            // PPPoE — mac_olt='N/A' itu normal, bukan tanda offline.
            const isGpon = row.olt_brand === 'zte';
            const cached = (row.mac_olt === 'N/A' && !isGpon)
                ? ' <i class="fas fa-history text-muted" title="Diketahui dari cache (ONT sedang offline)"></i>'
                : '';
            const brandTag = isGpon ? ' <span class="badge badge-info" title="GPON">GPON</span>' : '';
            return `<span class="badge badge-light border" title="${title}"><i class="fas fa-broadcast-tower text-primary mr-1"></i>${safeName}</span>${brandTag}${cached}`;
        }

        function updateStatsFromData(data) {
            let online = 0, offline = 0, los = 0, dyingGasp = 0;
            data.forEach(item => {
                if (item.is_dying_gasp) dyingGasp++;
                else if (item.is_los) los++;
                else if (item.olt_status === 'Online') online++;
                else offline++;
            });
            updateStats(online, offline, los, dyingGasp);
        }

        function updateStats(online, offline, los, dyingGasp) {
            $('#statOnline').text(online);
            $('#statOffline').text(offline);
            $('#statLos').text(los);
            $('#statDyingGasp').text(dyingGasp);
        }

        function filterByStatus(status) {
            $.fn.dataTable.ext.search = [];
            if (status) {
                $.fn.dataTable.ext.search.push((settings, data, dataIndex) => {
                    const row = dataTableInstance.row(dataIndex).data();
                    if (!row) return false;
                    switch (status) {
                        case 'online': return row.olt_status === 'Online' && !row.is_los && !row.is_dying_gasp;
                        case 'offline': return row.olt_status !== 'Online' && !row.is_los && !row.is_dying_gasp;
                        case 'los': return row.is_los === true;
                        case 'dying_gasp': return row.is_dying_gasp === true;
                        default: return true;
                    }
                });
            }
            dataTableInstance.draw();
        }

        function applySorting(sortType) {
            switch (sortType) {
                case 'rx_asc': dataTableInstance.order([2, 'asc']).draw(); break;
                case 'rx_desc': dataTableInstance.order([2, 'desc']).draw(); break;
                case 'name_asc': dataTableInstance.order([0, 'asc']).draw(); break;
                case 'name_desc': dataTableInstance.order([0, 'desc']).draw(); break;
            }
        }

        function updateLastUpdateTime() {
            const time = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            $('#lastUpdateTime').html(`<i class="fas fa-clock"></i> ${time}`);
        }

        function startAutoRefresh() {
            if (autoRefreshInterval) return;
            autoRefreshInterval = setInterval(() => loadAllData(false), AUTO_REFRESH_INTERVAL);
        }

        function stopAutoRefresh() {
            if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; }
        }

        function showAlert(type, msg) {
            const icons = { info: 'fa-info-circle', warning: 'fa-exclamation-triangle', danger: 'fa-times-circle', success: 'fa-check-circle' };
            $('#oltStatusAlert').removeClass('alert-info alert-warning alert-danger alert-success')
                .addClass('alert-' + type).show();
            $('#oltStatusMessage').html('<i class="fas ' + (icons[type] || 'fa-info-circle') + '"></i> ' + msg);
        }

        function hideAlert() { $('#oltStatusAlert').hide(); }
    </script>
</body>
</html>
