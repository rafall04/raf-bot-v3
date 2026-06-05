<!DOCTYPE html>
<html lang="id">
<!--
Header Doc
Purpose: Halaman admin untuk monitor OLT ONT pelanggan secara real-time (status, redaman, LOS, dying gasp).
Caller: `routes/pages.js` pada path `/admin-olt`.
Deps: `_navbar.php`, `topbar.php`, API `/api/olt/onus` (OLT-centric, semua ONU + anotasi pelanggan), `/api/olt/refresh-single`, `/api/mikrotik/ppp-active-users`, `/api/users`.
MainFuncs: `loadAllData`, `loadOltMatchedData`, `showCustomerDetail`, `refreshCustomerOlt`.
SideEffects: Polling backend OLT dan MikroTik untuk merefresh tampilan; tidak menulis ke DB.
-->
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Monitor OLT</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/admin-theme.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        .status-badge { font-size: 0.85rem; padding: 0.4em 0.8em; }
        .rx-power-good { color: #1cc88a; font-weight: 600; }
        .rx-power-warning { color: #f6c23e; font-weight: 600; }
        .rx-power-bad { color: #e74a3b; font-weight: 600; }
        .refresh-timer { font-size: 0.8rem; color: #858796; }
        .olt-stats-card { transition: transform 0.2s; cursor: pointer; border-left: 4px solid #e3e6f0; }
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
        .olt-toolbar { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
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
        /* tombol sedang loading */
        .btn.is-loading { pointer-events: none; opacity: 0.65; }
        /* fade-in lembut sekali saat data baru dimuat */
        .olt-just-loaded tbody tr { animation: olt-fade-in 0.3s ease; }
        @media (max-width: 768px) {
            .container-fluid { padding: 0.75rem; }
            h1 { font-size: 1.25rem; }
            .card-body { padding: 1rem; }
            .table-responsive { font-size: 0.8rem; }
            .table td, .table th { padding: 0.5rem; }
        }
    </style>
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
                                <h1>Monitor OLT</h1>
                                <p>Pantau status ONT pelanggan secara real-time (redaman, LOS, dying gasp).</p>
                            </div>
                            <div class="olt-toolbar">
                                <span class="refresh-timer" id="lastUpdateTime">Belum dimuat</span>
                                <div class="d-flex align-items-center">
                                    <label class="switch mb-0 mr-2">
                                        <input type="checkbox" id="autoRefreshToggle">
                                        <span class="slider"></span>
                                    </label>
                                    <small class="text-muted">Auto</small>
                                </div>
                                <button class="btn btn-primary-custom" id="refreshOltBtn">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                        </div>
                    </div>

                    <div id="oltStatusAlert" class="alert alert-info" style="display: none;">
                        <span id="oltStatusMessage"></span>
                    </div>

                    <!-- Statistics Cards -->
                    <div class="row mb-4">
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card olt-stats-card online shadow" data-filter="online">
                                <div class="card-body d-flex justify-content-between align-items-center">
                                    <div>
                                        <div class="text-xs text-uppercase text-muted font-weight-bold">Online</div>
                                        <div class="h4 mb-0" id="statOnline">-</div>
                                    </div>
                                    <i class="fas fa-check-circle fa-2x text-success"></i>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card olt-stats-card offline shadow" data-filter="offline">
                                <div class="card-body d-flex justify-content-between align-items-center">
                                    <div>
                                        <div class="text-xs text-uppercase text-muted font-weight-bold">Offline</div>
                                        <div class="h4 mb-0" id="statOffline">-</div>
                                    </div>
                                    <i class="fas fa-times-circle fa-2x text-secondary"></i>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card olt-stats-card los shadow" data-filter="los">
                                <div class="card-body d-flex justify-content-between align-items-center">
                                    <div>
                                        <div class="text-xs text-uppercase text-muted font-weight-bold">LOS</div>
                                        <div class="h4 mb-0" id="statLos">-</div>
                                    </div>
                                    <i class="fas fa-exclamation-triangle fa-2x text-warning"></i>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card olt-stats-card dying-gasp shadow" data-filter="dying_gasp">
                                <div class="card-body d-flex justify-content-between align-items-center">
                                    <div>
                                        <div class="text-xs text-uppercase text-muted font-weight-bold">Dying Gasp</div>
                                        <div class="h4 mb-0" id="statDyingGasp">-</div>
                                    </div>
                                    <i class="fas fa-bolt fa-2x text-danger"></i>
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
                                    <option value="rx_asc">Redaman &uarr; (Terburuk)</option>
                                    <option value="rx_desc">Redaman &darr; (Terbaik)</option>
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
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
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
            initDataTable();
            initOltViewControls();
            await loadUsersData();
            await loadDevicesOnly(); // hanya isi dropdown OLT; data ONU dimuat setelah pilih OLT

            $('#refreshOltBtn').on('click', () => loadAllData(true));
            $('#autoRefreshToggle').on('change', function() {
                this.checked ? startAutoRefresh() : stopAutoRefresh();
            });
            $('#statusFilter').on('change', function() { filterByStatus(this.value); });
            $('#sortFilter').on('change', function() { applySorting(this.value); });

            $('.olt-stats-card').on('click', function() {
                const filter = $(this).data('filter');
                $('#statusFilter').val(filter).trigger('change');
            });

            $('#refreshCustomerOltBtn').on('click', refreshCustomerOlt);
        });

        async function loadUsersData() {
            try {
                const res = await fetch('/api/users?limit=9999', { credentials: 'include' });
                const result = await res.json();
                if (result.status === 200 && result.data) {
                    usersData = result.data;
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
                                // N/A → 9999 supaya tersortir ke BAWAH (redaman valid tampil dulu),
                                // bukan menumpuk di atas saat sort "Terburuk" (ascending).
                                if (data && data !== 'N/A') {
                                    const num = parseFloat(data);
                                    return isNaN(num) ? 9999 : num;
                                }
                                return 9999;
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
                            // GPON (ZTE): tampilkan label PON human (mis. "ONU-1:1") alih-alih ifIndex panjang.
                            if (row.pon_name) return row.pon_name;
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
                order: [[2, 'asc']],
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

            $('#oltDataTable tbody').on('click', 'tr.clickable-row', function(e) {
                if ($(e.target).closest('button').length) return;
                const key = $(this).data('key');
                if (key) showCustomerDetail(key);
            });

            $('#oltDataTable tbody').on('click', '.btn-detail', function(e) {
                e.stopPropagation();
                const key = $(this).data('key');
                if (key) showCustomerDetail(key);
            });
        }

        async function loadAllData(showLoading = false) {
            // Belum pilih OLT → jangan query apa pun (hemat: tak walk OLT lambat tanpa diminta).
            if (!currentOltFilter) { showOltEmptyState(); return; }
            if (oltLoading) return; // cegah dobel-fetch (mis. klik refresh saat masih memuat)
            oltLoading = true;

            // Overlay penuh hanya untuk load eksplisit / pertama. Auto-refresh background
            // (data sudah ada) berjalan senyap supaya tidak kedip tiap 30 detik.
            const explicit = showLoading || matchedData.length === 0;
            if (explicit) {
                setControlsLoading(true);
                const dev = oltDevicesList.find(d => d.id === currentOltFilter);
                const oltName = currentOltFilter === 'all' ? 'semua OLT' : (dev ? dev.name : 'OLT');
                showLoadingOverlay('Memuat data ONU…', 'Menghubungi ' + oltName + ' — OLT besar bisa ~30 detik');
            }

            try {
                await loadPppoeData();
                await loadOltMatchedData(showLoading); // refresh eksplisit → force bypass cache
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
                loadAllData(true); // muat data OLT terpilih (+ pppoe)
            });
            $('#viewModeToggle button').on('click', function () {
                currentViewMode = $(this).data('view');
                $('#viewModeToggle button').removeClass('btn-primary').addClass('btn-outline-primary');
                $(this).removeClass('btn-outline-primary').addClass('btn-primary');
                if (currentOltFilter) renderCurrentView(); // filter client-side dari data yang sudah dimuat
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
            // Rebuild hanya bila jumlah opsi berubah (jangan reset pilihan tiap auto-refresh).
            if ($sel.children().length !== opts.length) $sel.html(opts.join(''));
            $sel.val(currentOltFilter);
        }

        // Render ulang dari matchedData sesuai view mode (tanpa fetch ulang).
        function renderCurrentView() {
            const view = currentViewMode === 'matched' ? matchedData.filter(r => r.matched) : matchedData;
            updateStatsFromData(view);
            dataTableInstance.clear().rows.add(view).draw();
            // Data siap → tampilkan tabel, sembunyikan empty/overlay + fade-in lembut sekali.
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
                    matchedData.forEach(item => {
                        // Key stabil per-ONU (untuk modal & klik baris; user_id bisa null).
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

            // ONU belum terdaftar → pakai identitas ONU sebagai judul.
            const displayName = customer.customer_name || customer.description || customer.serial || 'Detail ONU';
            $('#modalCustomerName').text(displayName);
            $('#modalName').text(customer.customer_name || '(belum terdaftar)');
            $('#modalPppoe').text(customer.pppoe_username || '-');
            $('#modalPackage').text(customer.customer_package || '-');
            $('#modalAddress').text(customer.customer_address || '-');
            $('#modalPhone').text(customer.customer_phone || '-');
            // Badge merk OLT (GPON ZTE vs EPON HIOSO).
            const brandBadge = customer.olt_brand === 'zte'
                ? ' <span class="badge badge-info" title="GPON">ZTE GPON</span>'
                : (customer.olt_brand === 'hioso' ? ' <span class="badge badge-secondary" title="EPON">HIOSO</span>' : '');
            $('#modalOltName').html((customer.olt_name || '-') + brandBadge);

            // GPON tidak punya MAC ONU; tampilkan Serial Number sebagai gantinya.
            if (customer.mac_olt && customer.mac_olt !== 'N/A') {
                $('#modalMacOlt').text(customer.mac_olt);
            } else if (customer.serial) {
                $('#modalMacOlt').text('SN: ' + customer.serial);
            } else {
                $('#modalMacOlt').text('-');
            }

            // GPON match by username PPPoE (bukan MAC MikroTik) → tampilkan keterangan itu.
            let macMikrotikHtml = customer.mac_mikrotik || '-';
            if (customer.mac_source === 'cached') {
                macMikrotikHtml += ' <span class="badge badge-warning" title="MAC dari cache (pelanggan offline)"><i class="fas fa-history"></i></span>';
            } else if (customer.mac_source === 'olt' || (!customer.mac_mikrotik && customer.olt_brand === 'zte')) {
                macMikrotikHtml = '<span class="text-muted">— (match via PPPoE)</span>';
            }
            $('#modalMacMikrotik').html(macMikrotikHtml);

            $('#modalSlotOnu').text(customer.pon_name || ((customer.slot_id && customer.onu_id) ? `${customer.slot_id} / ${customer.onu_id}` : '-'));

            const isOnline = activePppoeUsersMap.has(customer.pppoe_username);
            $('#modalConnectionStatus').html(isOnline ?
                '<span class="badge badge-success"><i class="fas fa-check"></i> Online</span>' :
                '<span class="badge badge-secondary"><i class="fas fa-times"></i> Offline</span>');

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
            if (!currentCustomerData.slot_id || !currentCustomerData.onu_id) {
                alert('Data Slot/ONU tidak tersedia untuk pelanggan ini');
                return;
            }

            const btn = $('#refreshCustomerOltBtn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memuat...');

            try {
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
                        alert(result.message || 'Gagal mengambil data dari OLT');
                    } else if (result.data) {
                        const data = result.data;
                        updateModalRxPower(data.rx_power, data.olt_status, data.is_dying_gasp, data.is_los);
                        $('#modalLastCheck').text('Terakhir cek: ' + new Date().toLocaleTimeString('id-ID'));

                        const idx = matchedData.findIndex(m => m.user_id == currentCustomerData.user_id);
                        if (idx !== -1) {
                            matchedData[idx].rx_power = data.rx_power;
                            matchedData[idx].olt_status = data.olt_status;
                            matchedData[idx].is_dying_gasp = data.is_dying_gasp;
                            matchedData[idx].is_los = data.is_los;
                            currentCustomerData.rx_power = data.rx_power;
                            currentCustomerData.olt_status = data.olt_status;
                            currentCustomerData.is_dying_gasp = data.is_dying_gasp;
                            currentCustomerData.is_los = data.is_los;
                            dataTableInstance.clear().rows.add(matchedData).draw();
                        }
                    } else {
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
            // Ikon "cache/offline" hanya relevan untuk EPON (match via MAC). GPON (ZTE) match
            // via PPPoE — mac_olt='N/A' itu normal, BUKAN tanda offline.
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
