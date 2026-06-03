<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="RAF BOT - Import Pelanggan dari MikroTik">
    <meta name="author" content="RAF BOT">
    <title>RAF BOT - Import dari MikroTik</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --success: #10b981;
            --info: #3b82f6;
            --warning: #f59e0b;
            --danger: #ef4444;
            --dark: #1f2937;
            --light: #f9fafb;
            --border-radius: 12px;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: #f3f4f6;
            min-height: 100vh;
        }

        .dashboard-header {
            margin-bottom: 1.5rem;
        }

        .dashboard-header h1 {
            font-size: 1.875rem;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 0.25rem;
        }

        .dashboard-header p {
            color: #6b7280;
            font-size: 0.95rem;
        }

        .stats-card {
            background: white;
            border-radius: var(--border-radius);
            padding: 1.25rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e5e7eb;
        }

        .stats-card .stats-icon {
            width: 48px;
            height: 48px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.25rem;
        }

        .stats-card .stats-value {
            font-size: 1.75rem;
            font-weight: 700;
            color: var(--dark);
        }

        .stats-card .stats-label {
            color: #6b7280;
            font-size: 0.875rem;
        }

        .card-modern {
            background: white;
            border-radius: var(--border-radius);
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e5e7eb;
        }

        .card-modern .card-header {
            background: transparent;
            border-bottom: 1px solid #e5e7eb;
            padding: 1rem 1.25rem;
        }

        .card-modern .card-body {
            padding: 1.25rem;
        }

        .btn-primary-modern {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            border: none;
            border-radius: 10px;
            padding: 0.875rem 1.75rem;
            font-weight: 600;
            font-size: 1rem;
            color: white;
            transition: all 0.2s;
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);
        }

        .btn-primary-modern:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
            color: white;
        }

        .btn-primary-modern i {
            margin-right: 0.5rem;
        }

        .table-import {
            font-size: 0.875rem;
        }

        .table-import th {
            background: #f9fafb;
            font-weight: 600;
            color: var(--dark);
            border-bottom: 2px solid #e5e7eb;
            white-space: nowrap;
        }

        .table-import td {
            vertical-align: middle;
        }

        .table-import .form-control {
            font-size: 0.875rem;
            padding: 0.375rem 0.75rem;
            border-radius: 6px;
            min-width: 120px;
        }

        .table-import .input-phone {
            min-width: 140px;
        }

        .table-import .device-select,
        .table-import .select-device {
            min-width: 220px;
        }

        .table-import .input-name {
            min-width: 150px;
        }

        .table-import .input-address {
            min-width: 130px;
        }

        .phone-container {
            min-width: 180px;
        }

        .phone-container .phone-field-item {
            align-items: center;
        }

        .phone-container .input-phone {
            flex: 1;
            min-width: 120px;
        }

        .phone-container .btn-remove-phone {
            padding: 0.2rem 0.4rem;
            font-size: 0.7rem;
        }

        .phone-container .btn-add-phone {
            font-size: 0.75rem;
            padding: 0.2rem 0.5rem;
        }

        .table-import .form-control:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        .table-import tr.selected {
            background-color: rgba(99, 102, 241, 0.05);
        }

        .table-import tr.disabled-row {
            opacity: 0.5;
            background-color: #f9fafb;
        }

        .badge-profile {
            font-size: 0.75rem;
            padding: 0.35rem 0.65rem;
            border-radius: 6px;
            font-weight: 500;
        }

        .badge-disabled {
            background-color: #fee2e2;
            color: #dc2626;
        }

        .badge-active {
            background-color: #d1fae5;
            color: #059669;
        }

        .validation-icon {
            font-size: 0.875rem;
        }

        .validation-icon.valid {
            color: var(--success);
        }

        .validation-icon.invalid {
            color: var(--danger);
        }

        .filter-section {
            background: #f9fafb;
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1rem;
        }

        .default-settings {
            background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
            border-radius: 8px;
            padding: 1rem;
            border: 1px solid #bae6fd;
        }

        .ssid-checkbox {
            display: inline-flex;
            align-items: center;
            margin-right: 1rem;
        }

        .ssid-checkbox input[type="checkbox"] {
            width: 18px;
            height: 18px;
            margin-right: 0.5rem;
        }

        .progress-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }

        .progress-card {
            background: white;
            border-radius: var(--border-radius);
            padding: 2rem;
            min-width: 400px;
            text-align: center;
        }

        .import-counter {
            font-size: 1rem;
            color: var(--dark);
            font-weight: 500;
        }

        .import-counter .count-ready {
            color: var(--success);
            font-weight: 700;
        }

        .import-counter .count-incomplete {
            color: var(--warning);
            font-weight: 700;
        }

        .password-toggle {
            cursor: pointer;
            color: #6b7280;
        }

        .password-toggle:hover {
            color: var(--primary);
        }

        .empty-state {
            text-align: center;
            padding: 3rem;
            color: #6b7280;
        }

        .empty-state i {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }

        /* Device Sync Styles */
        .device-sync-section {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1rem;
            border: 1px solid #f59e0b;
        }

        .device-sync-section h6 {
            color: #92400e;
        }

        .btn-sync-device {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            border: none;
            color: white;
            font-weight: 600;
        }

        .btn-sync-device:hover {
            background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
            color: white;
        }

        .device-select {
            min-width: 200px;
        }

        .device-matched {
            background-color: #d1fae5 !important;
        }

        .device-manual {
            background-color: #fef3c7 !important;
        }

        .sync-status {
            font-size: 0.75rem;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
        }

        .sync-status.matched {
            background: #d1fae5;
            color: #059669;
        }

        .sync-status.manual {
            background: #fef3c7;
            color: #d97706;
        }

        .sync-status.not-found {
            background: #fee2e2;
            color: #dc2626;
        }

        /* SSID Preset Buttons */
        .ssid-preset-btn {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
        }

        .ssid-checkbox small {
            font-size: 0.7rem;
        }

        /* SSID Row Selector */
        .ssid-row-selector {
            min-width: 100px;
        }

        .ssid-row-selector .ssid-mini-checkbox {
            display: inline-block;
            margin: 1px;
        }

        .ssid-row-selector .ssid-mini-checkbox input {
            width: 14px;
            height: 14px;
        }

        .ssid-row-selector .ssid-mini-checkbox label {
            font-size: 0.65rem;
            margin-left: 1px;
            cursor: pointer;
        }

        .ssid-row-buttons {
            margin-top: 4px;
        }

        .ssid-row-buttons .btn {
            font-size: 0.6rem;
            padding: 1px 4px;
        }

        /* Select2 custom styling */
        .select2-container--bootstrap .select2-selection--single {
            height: calc(1.5em + .75rem + 2px) !important;
            padding: .375rem .75rem !important;
            border-radius: 6px !important;
            font-size: 0.875rem !important;
        }

        .select2-container--bootstrap .select2-selection--single .select2-selection__rendered {
            line-height: 1.5 !important;
            padding-left: 0 !important;
        }

        .select2-container--bootstrap .select2-results__option {
            font-size: 0.8rem;
            padding: 6px 12px;
        }

        .select2-container--bootstrap .select2-results__option small {
            display: block;
            color: #6b7280;
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include __DIR__ . '/_navbar.php'; ?>

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include __DIR__ . '/topbar.php'; ?>

                <div class="container-fluid">
                    <!-- Header -->
                    <div class="dashboard-header d-flex justify-content-between align-items-center flex-wrap">
                        <div>
                            <h1><i class="fas fa-file-import mr-2"></i>Import dari MikroTik</h1>
                            <p class="mb-0">Import pelanggan PPPoE yang sudah ada di MikroTik ke sistem</p>
                        </div>
                        <div>
                            <button class="btn btn-primary-modern" id="btnScan" onclick="scanMikrotik()">
                                <i class="fas fa-sync-alt mr-2"></i>Scan MikroTik
                            </button>
                        </div>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row mb-4" id="statsSection" style="display: none;">
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-primary text-white mr-3">
                                        <i class="fas fa-server"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statTotal">0</div>
                                        <div class="stats-label">Total di MikroTik</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-success text-white mr-3">
                                        <i class="fas fa-user-check"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statRegistered">0</div>
                                        <div class="stats-label">Sudah Terdaftar</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-warning text-white mr-3">
                                        <i class="fas fa-user-plus"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statUnregistered">0</div>
                                        <div class="stats-label">Belum Terdaftar</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-info text-white mr-3">
                                        <i class="fas fa-check-circle"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statSelected">0</div>
                                        <div class="stats-label">Dipilih untuk Import</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Main Content -->
                    <div class="card-modern" id="mainContent" style="display: none;">
                        <div class="card-header">
                            <div class="d-flex justify-content-between align-items-center flex-wrap">
                                <h6 class="m-0 font-weight-bold text-primary">
                                    <i class="fas fa-list mr-2"></i>Daftar PPPoE Belum Terdaftar
                                </h6>
                                <div class="import-counter">
                                    <span class="count-ready" id="countReady">0</span> siap import |
                                    <span class="count-incomplete" id="countIncomplete">0</span> belum lengkap
                                </div>
                            </div>
                        </div>
                        <div class="card-body">
                            <!-- Filter Section -->
                            <div class="filter-section">
                                <div class="row align-items-center">
                                    <div class="col-md-3 mb-2 mb-md-0">
                                        <select class="form-control" id="filterProfile" onchange="applyFilters()">
                                            <option value="">Semua Profile</option>
                                        </select>
                                    </div>
                                    <div class="col-md-3 mb-2 mb-md-0">
                                        <select class="form-control" id="filterStatus" onchange="applyFilters()">
                                            <option value="">Semua Status</option>
                                            <option value="active">Aktif</option>
                                            <option value="disabled">Disabled</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4 mb-2 mb-md-0">
                                        <input type="text" class="form-control" id="searchUsername" placeholder="Cari username..." oninput="applyFilters()">
                                    </div>
                                    <div class="col-md-2">
                                        <div class="btn-group btn-group-sm w-100">
                                            <button class="btn btn-outline-primary" onclick="selectAll()">Pilih Semua</button>
                                            <button class="btn btn-outline-secondary" onclick="deselectAll()">Batal</button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Default Settings -->
                            <div class="default-settings mb-3">
                                <h6 class="font-weight-bold mb-3"><i class="fas fa-cog mr-2"></i>Pengaturan Default</h6>
                                <div class="row">
                                    <div class="col-md-5 mb-2">
                                        <label class="font-weight-bold mb-2">SSID WiFi:</label>
                                        <div class="mb-2">
                                            <div class="btn-group btn-group-sm mb-2" role="group">
                                                <button type="button" class="btn btn-outline-primary" onclick="selectSSIDPreset('dual')" title="Untuk router dual band (2.4GHz + 5GHz)">
                                                    <i class="fas fa-wifi mr-1"></i>Dual Band
                                                </button>
                                                <button type="button" class="btn btn-outline-secondary" onclick="selectSSIDPreset('single')" title="Untuk router single band (2.4GHz saja)">
                                                    <i class="fas fa-broadcast-tower mr-1"></i>Single Band
                                                </button>
                                                <button type="button" class="btn btn-outline-info" onclick="selectSSIDPreset('all')" title="Pilih semua SSID">
                                                    <i class="fas fa-check-double mr-1"></i>Semua
                                                </button>
                                                <button type="button" class="btn btn-outline-warning" onclick="selectSSIDPreset('none')" title="Hapus semua pilihan">
                                                    <i class="fas fa-times mr-1"></i>Reset
                                                </button>
                                            </div>
                                        </div>
                                        <div>
                                            <label class="ssid-checkbox"><input type="checkbox" id="ssid1" checked> SSID 1 <small class="text-muted">(2.4GHz)</small></label>
                                            <label class="ssid-checkbox"><input type="checkbox" id="ssid2"> SSID 2</label>
                                            <label class="ssid-checkbox"><input type="checkbox" id="ssid3"> SSID 3</label>
                                            <label class="ssid-checkbox"><input type="checkbox" id="ssid4"> SSID 4</label>
                                            <label class="ssid-checkbox"><input type="checkbox" id="ssid5" checked> SSID 5 <small class="text-muted">(5GHz)</small></label>
                                            <label class="ssid-checkbox"><input type="checkbox" id="ssid6"> SSID 6</label>
                                            <label class="ssid-checkbox"><input type="checkbox" id="ssid7"> SSID 7</label>
                                            <label class="ssid-checkbox"><input type="checkbox" id="ssid8"> SSID 8</label>
                                        </div>
                                        <div class="mt-2">
                                            <button type="button" class="btn btn-sm btn-success" onclick="applySSIDToAll()" title="Terapkan pengaturan SSID di atas ke semua baris">
                                                <i class="fas fa-check-double mr-1"></i>Apply ke Semua Baris
                                            </button>
                                            <button type="button" class="btn btn-sm btn-outline-primary" onclick="applySSIDToSelected()" title="Terapkan hanya ke baris yang dicentang">
                                                <i class="fas fa-check mr-1"></i>Apply ke Terpilih
                                            </button>
                                        </div>
                                        <small class="text-muted d-block mt-1">
                                            <i class="fas fa-info-circle mr-1"></i>Dual Band: SSID 1 (2.4GHz) + SSID 5 (5GHz) | Single Band: SSID 1 saja
                                        </small>
                                    </div>
                                    <div class="col-md-2 mb-2">
                                        <label class="font-weight-bold mb-2">Status Pembayaran:</label>
                                        <div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio" name="paidStatus" id="paidNo" value="false" checked>
                                                <label class="form-check-label" for="paidNo">Belum Bayar</label>
                                            </div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="radio" name="paidStatus" id="paidYes" value="true">
                                                <label class="form-check-label" for="paidYes">Lunas</label>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-2 mb-2">
                                        <label class="font-weight-bold mb-2">Kirim Invoice:</label>
                                        <div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" id="sendInvoice" checked>
                                                <label class="form-check-label" for="sendInvoice">Ya, kirim invoice</label>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-3 mb-2">
                                        <label class="font-weight-bold mb-2">Kirim PSB Welcome:</label>
                                        <div>
                                            <div class="form-check">
                                                <input class="form-check-input" type="checkbox" id="sendPsbWelcome">
                                                <label class="form-check-label" for="sendPsbWelcome">Ya, kirim pesan selamat datang</label>
                                            </div>
                                            <small class="text-muted">Kirim pesan WhatsApp sesuai template PSB Welcome</small>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Device Sync Section -->
                            <div class="device-sync-section mb-3">
                                <h6 class="font-weight-bold mb-3"><i class="fas fa-link mr-2"></i>Sinkronisasi Device ID (GenieACS)</h6>
                                <div class="row align-items-center">
                                    <div class="col-md-8">
                                        <p class="mb-2 small">
                                            <strong>Auto-Sync:</strong> Otomatis mencocokkan PPPoE username dengan device di GenieACS.<br>
                                            <strong>Manual:</strong> Pilih device dari dropdown di setiap baris jika tidak cocok otomatis.
                                        </p>
                                    </div>
                                    <div class="col-md-4 text-right">
                                        <button class="btn btn-sync-device" id="btnAutoSync" onclick="autoSyncDevices()" disabled>
                                            <i class="fas fa-sync-alt mr-2"></i>Auto-Sync Device
                                        </button>
                                    </div>
                                </div>
                                <div class="row mt-2" id="syncStats" style="display: none;">
                                    <div class="col-12">
                                        <small>
                                            <span class="sync-status matched mr-2"><i class="fas fa-check"></i> Matched: <span id="syncMatched">0</span></span>
                                            <span class="sync-status manual mr-2"><i class="fas fa-hand-pointer"></i> Manual: <span id="syncManual">0</span></span>
                                            <span class="sync-status not-found"><i class="fas fa-times"></i> Tidak ditemukan: <span id="syncNotFound">0</span></span>
                                        </small>
                                    </div>
                                </div>
                            </div>

                            <!-- Table -->
                            <div class="table-responsive">
                                <table class="table table-import table-hover" id="importTable">
                                    <thead>
                                        <tr>
                                            <th width="40"><input type="checkbox" id="checkAll" onchange="toggleCheckAll()"></th>
                                            <th width="130">PPPoE Username</th>
                                            <th width="80">Password</th>
                                            <th width="90">Profile</th>
                                            <th width="70">Status</th>
                                            <th width="150">Nama Pelanggan <span class="text-danger">*</span></th>
                                            <th width="140">No HP</th>
                                            <th width="200">Device ID <span class="text-danger">*</span></th>
                                            <th width="120">SSID</th>
                                            <th width="120">Alamat</th>
                                            <th width="50">Valid</th>
                                        </tr>
                                    </thead>
                                    <tbody id="tableBody">
                                        <tr>
                                            <td colspan="11" class="empty-state">
                                                <i class="fas fa-cloud-download-alt"></i>
                                                <p>Klik tombol "Scan MikroTik" untuk mengambil data PPPoE</p>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <!-- Import Button -->
                            <div class="text-center mt-4">
                                <button class="btn btn-success btn-lg" id="btnImport" onclick="importUsers()" disabled>
                                    <i class="fas fa-file-import mr-2"></i>Import <span id="importCount">0</span> Pelanggan
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Empty State -->
                    <div class="card-modern" id="emptyState">
                        <div class="card-body empty-state">
                            <i class="fas fa-cloud-download-alt"></i>
                            <h5>Belum Ada Data</h5>
                            <p>Klik tombol "Scan MikroTik" untuk mengambil daftar PPPoE yang belum terdaftar di sistem</p>
                        </div>
                    </div>
                </div>
            </div>

            <?php include __DIR__ . '/footer.php'; ?>
        </div>
    </div>

    <!-- Progress Overlay -->
    <div class="progress-overlay" id="progressOverlay" style="display: none;">
        <div class="progress-card">
            <div class="spinner-border text-primary mb-3" role="status">
                <span class="sr-only">Loading...</span>
            </div>
            <h5 id="progressTitle">Memproses...</h5>
            <p id="progressText" class="text-muted mb-0">Mohon tunggu</p>
        </div>
    </div>

    <!-- Scripts -->
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

    <script>
        // Global data
        let allPPPoEData = [];
        let filteredData = [];
        let packages = [];
        let genieacsDevices = []; // Store GenieACS devices
        let maxPhoneLimit = 3; // Default, will be loaded from config

        // Load config on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadPhoneLimitConfig();
        });

        // Load max phone limit from config
        async function loadPhoneLimitConfig() {
            try {
                const response = await fetch('/api/stats/config');
                const result = await response.json();
                
                if (result.status === 200 && result.data) {
                    const loadedLimit = parseInt(result.data.accessLimit);
                    if (!isNaN(loadedLimit) && loadedLimit > 0) {
                        maxPhoneLimit = loadedLimit;
                        console.log('[IMPORT] Max phone limit loaded:', maxPhoneLimit);
                        // Update UI displays
                        document.querySelectorAll('.max-phone-display').forEach(el => {
                            el.textContent = maxPhoneLimit;
                        });
                    }
                }
            } catch (error) {
                console.warn('[IMPORT] Failed to load phone limit config, using default:', maxPhoneLimit);
            }
        }

        // Scan MikroTik
        async function scanMikrotik() {
            showProgress('Mengambil Data...', 'Menghubungi MikroTik, mohon tunggu...');
            
            try {
                const response = await fetch('/api/mikrotik/unregistered-pppoe');
                const result = await response.json();
                
                hideProgress();
                
                if (result.status !== 200) {
                    Swal.fire('Error', result.message || 'Gagal mengambil data', 'error');
                    return;
                }
                
                allPPPoEData = result.data || [];
                packages = result.packages || [];
                
                // Update stats
                document.getElementById('statTotal').textContent = result.stats?.total || 0;
                document.getElementById('statRegistered').textContent = result.stats?.registered || 0;
                document.getElementById('statUnregistered').textContent = result.stats?.unregistered || 0;
                document.getElementById('statSelected').textContent = '0';
                
                // Populate profile filter
                const profiles = result.profiles || [];
                const filterProfile = document.getElementById('filterProfile');
                filterProfile.innerHTML = '<option value="">Semua Profile</option>';
                profiles.forEach(profile => {
                    filterProfile.innerHTML += `<option value="${profile}">${profile}</option>`;
                });
                
                // Show sections
                document.getElementById('statsSection').style.display = 'flex';
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';
                
                // Render table
                filteredData = [...allPPPoEData];
                renderTable();
                
                if (allPPPoEData.length === 0) {
                    Swal.fire('Info', 'Semua PPPoE sudah terdaftar di sistem', 'info');
                } else {
                    // Enable auto-sync button
                    document.getElementById('btnAutoSync').disabled = false;
                }
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        // Render table
        function renderTable() {
            const tbody = document.getElementById('tableBody');
            
            if (filteredData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="11" class="empty-state">
                            <i class="fas fa-search"></i>
                            <p>Tidak ada data yang sesuai filter</p>
                        </td>
                    </tr>
                `;
                return;
            }
            
            // Get default SSID settings
            const defaultSSID = getDefaultSSIDArray();
            
            tbody.innerHTML = filteredData.map((item, index) => {
                const isDisabled = item.disabled;
                const rowClass = isDisabled ? 'disabled-row' : '';
                const statusBadge = isDisabled 
                    ? '<span class="badge badge-disabled">Disabled</span>'
                    : '<span class="badge badge-active">Aktif</span>';
                
                // Find matching package
                const matchedPkg = packages.find(p => p.profile && p.profile.toLowerCase() === (item.profile || '').toLowerCase());
                const subscription = matchedPkg ? matchedPkg.name : '';
                
                // Warning jika profile tidak cocok
                const profileWarning = !matchedPkg && item.profile 
                    ? `<br><small class="text-warning"><i class="fas fa-exclamation-triangle"></i> Profile "${escapeHtml(item.profile)}" tidak ada di paket</small>` 
                    : '';
                
                // Generate SSID checkboxes for this row
                const ssidCheckboxes = generateRowSSIDCheckboxes(index, defaultSSID);
                
                return `
                    <tr class="${rowClass}" data-index="${index}">
                        <td>
                            <input type="checkbox" class="row-check" data-index="${index}" onchange="updateSelection()">
                        </td>
                        <td>
                            <strong>${escapeHtml(item.name)}</strong>
                            ${item.comment ? `<br><small class="text-muted">${escapeHtml(item.comment)}</small>` : ''}
                        </td>
                        <td>
                            <span class="password-text" id="pwd-${index}">••••••</span>
                            <i class="fas fa-eye password-toggle ml-2" onclick="togglePassword(${index}, '${escapeHtml(item.password)}')"></i>
                        </td>
                        <td>
                            <span class="badge badge-profile bg-primary text-white">${escapeHtml(item.profile || '-')}</span>
                            ${profileWarning}
                        </td>
                        <td>${statusBadge}</td>
                        <td>
                            <input type="text" class="form-control input-name" data-index="${index}" 
                                placeholder="Nama pelanggan" value="${escapeHtml(item.comment || '')}"
                                oninput="validateRow(${index})">
                        </td>
                        <td>
                            <div class="phone-container" data-index="${index}">
                                <div class="phone-fields" id="phone-fields-${index}">
                                    <div class="d-flex phone-field-item mb-1" data-phone-index="0">
                                        <input type="text" class="form-control form-control-sm input-phone" 
                                            placeholder="08xxxxxxxxxx" oninput="validateRow(${index})">
                                        <button type="button" class="btn btn-danger btn-sm ml-1 btn-remove-phone" 
                                            onclick="removePhoneField(${index}, 0)" disabled title="Hapus">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                </div>
                                <button type="button" class="btn btn-outline-primary btn-sm btn-add-phone mt-1" 
                                    onclick="addPhoneField(${index})" title="Tambah No HP">
                                    <i class="fas fa-plus"></i> <small>Maks <span class="max-phone-display">${maxPhoneLimit}</span></small>
                                </button>
                            </div>
                        </td>
                        <td>
                            <select class="form-control device-select select-device" data-index="${index}" onchange="validateRow(${index})">
                                <option value="">-- Pilih Device --</option>
                            </select>
                            <input type="text" class="form-control input-device-manual mt-1" data-index="${index}" 
                                placeholder="Atau ketik manual..." oninput="onManualDeviceInput(${index})" style="display:none;">
                            <small class="text-muted device-toggle" style="cursor:pointer;" onclick="toggleDeviceInput(${index})">
                                <i class="fas fa-keyboard"></i> Input manual
                            </small>
                        </td>
                        <td>
                            <div class="ssid-row-selector" data-index="${index}">
                                ${ssidCheckboxes}
                                <div class="ssid-row-buttons">
                                    <button type="button" class="btn btn-outline-primary" onclick="setRowSSID(${index}, 'dual')" title="Dual Band">D</button>
                                    <button type="button" class="btn btn-outline-secondary" onclick="setRowSSID(${index}, 'single')" title="Single Band">S</button>
                                </div>
                            </div>
                        </td>
                        <td>
                            <input type="text" class="form-control input-address" data-index="${index}" 
                                placeholder="Alamat (opsional)">
                        </td>
                        <td class="text-center">
                            <i class="fas fa-times-circle validation-icon invalid" id="valid-${index}"></i>
                        </td>
                    </tr>
                `;
            }).join('');
            
            updateCounters();
        }

        // Generate SSID checkboxes for a row
        function generateRowSSIDCheckboxes(rowIndex, defaultSSID) {
            let html = '<div class="d-flex flex-wrap">';
            for (let i = 1; i <= 8; i++) {
                const checked = defaultSSID.includes(String(i)) ? 'checked' : '';
                html += `
                    <span class="ssid-mini-checkbox" title="SSID ${i}">
                        <input type="checkbox" id="row-ssid-${rowIndex}-${i}" ${checked}>
                        <label for="row-ssid-${rowIndex}-${i}">${i}</label>
                    </span>
                `;
            }
            html += '</div>';
            return html;
        }

        // Get default SSID array from global settings
        function getDefaultSSIDArray() {
            const ssids = [];
            for (let i = 1; i <= 8; i++) {
                if (document.getElementById(`ssid${i}`).checked) {
                    ssids.push(String(i));
                }
            }
            return ssids;
        }

        // Get SSID array for a specific row
        function getRowSSIDArray(rowIndex) {
            const ssids = [];
            for (let i = 1; i <= 8; i++) {
                const checkbox = document.getElementById(`row-ssid-${rowIndex}-${i}`);
                if (checkbox && checkbox.checked) {
                    ssids.push(String(i));
                }
            }
            return ssids;
        }

        // Set SSID for a specific row
        function setRowSSID(rowIndex, preset) {
            // Reset all for this row
            for (let i = 1; i <= 8; i++) {
                const checkbox = document.getElementById(`row-ssid-${rowIndex}-${i}`);
                if (checkbox) checkbox.checked = false;
            }
            
            switch (preset) {
                case 'dual':
                    document.getElementById(`row-ssid-${rowIndex}-1`).checked = true;
                    document.getElementById(`row-ssid-${rowIndex}-5`).checked = true;
                    break;
                case 'single':
                    document.getElementById(`row-ssid-${rowIndex}-1`).checked = true;
                    break;
            }
        }

        // Apply SSID settings to all rows
        function applySSIDToAll() {
            const defaultSSID = getDefaultSSIDArray();
            
            filteredData.forEach((item, index) => {
                for (let i = 1; i <= 8; i++) {
                    const checkbox = document.getElementById(`row-ssid-${index}-${i}`);
                    if (checkbox) {
                        checkbox.checked = defaultSSID.includes(String(i));
                    }
                }
            });
            
            showToast(`SSID diterapkan ke ${filteredData.length} baris`, 'success');
        }

        // Apply SSID settings to selected rows only
        function applySSIDToSelected() {
            const defaultSSID = getDefaultSSIDArray();
            let count = 0;
            
            document.querySelectorAll('.row-check:checked').forEach(cb => {
                const index = parseInt(cb.dataset.index);
                for (let i = 1; i <= 8; i++) {
                    const checkbox = document.getElementById(`row-ssid-${index}-${i}`);
                    if (checkbox) {
                        checkbox.checked = defaultSSID.includes(String(i));
                    }
                }
                count++;
            });
            
            if (count > 0) {
                showToast(`SSID diterapkan ke ${count} baris terpilih`, 'success');
            } else {
                showToast('Tidak ada baris yang dipilih', 'warning');
            }
        }

        // Toggle password visibility
        function togglePassword(index, password) {
            const pwdSpan = document.getElementById(`pwd-${index}`);
            if (pwdSpan.textContent === '••••••') {
                pwdSpan.textContent = password;
            } else {
                pwdSpan.textContent = '••••••';
            }
        }

        // Validate row
        function validateRow(index) {
            const nameInput = document.querySelector(`.input-name[data-index="${index}"]`);
            const phoneContainer = document.querySelector(`#phone-fields-${index}`);
            const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
            const deviceManual = document.querySelector(`.input-device-manual[data-index="${index}"]`);
            const validIcon = document.getElementById(`valid-${index}`);
            
            const name = nameInput.value.trim();
            
            // Get all phone numbers from container
            const phoneInputs = phoneContainer ? phoneContainer.querySelectorAll('.input-phone') : [];
            const phones = Array.from(phoneInputs).map(input => input.value.trim()).filter(p => p);
            
            // Get device ID from dropdown or manual input
            let deviceId = '';
            if (deviceSelect && deviceSelect.value) {
                deviceId = deviceSelect.value;
            } else if (deviceManual && deviceManual.value.trim()) {
                deviceId = deviceManual.value.trim();
            }
            
            // Validate name (min 3 chars) - WAJIB
            const nameValid = name.length >= 3;
            
            // Validate device_id - WAJIB
            const deviceValid = deviceId.length >= 1;
            
            // Validate phones (Indonesian format) - OPSIONAL, tapi jika diisi harus valid
            let phoneValid = true;
            phoneInputs.forEach(input => {
                const phone = input.value.trim();
                if (phone !== '') {
                    const isValidFormat = /^(08|628|\+628)[0-9]{8,12}$/.test(phone.replace(/[\s-]/g, ''));
                    if (!isValidFormat) {
                        phoneValid = false;
                        input.style.borderColor = '#f59e0b';
                    } else {
                        input.style.borderColor = '';
                    }
                } else {
                    input.style.borderColor = '';
                }
            });
            
            // Update validation icon - nama dan device_id wajib
            if (nameValid && deviceValid && phoneValid) {
                validIcon.className = 'fas fa-check-circle validation-icon valid';
            } else {
                validIcon.className = 'fas fa-times-circle validation-icon invalid';
            }
            
            // Update input styles
            nameInput.style.borderColor = nameValid ? '' : '#ef4444';
            if (deviceSelect) deviceSelect.style.borderColor = deviceValid ? '' : '#ef4444';
            if (deviceManual) deviceManual.style.borderColor = deviceValid ? '' : '#ef4444';
            
            updateCounters();
        }

        // Add phone field
        function addPhoneField(rowIndex) {
            const container = document.getElementById(`phone-fields-${rowIndex}`);
            if (!container) return;
            
            const currentFields = container.querySelectorAll('.phone-field-item').length;
            
            if (currentFields >= maxPhoneLimit) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Maksimal Nomor HP',
                    text: `Maksimal ${maxPhoneLimit} nomor HP sesuai konfigurasi.`
                });
                return;
            }
            
            const newIndex = currentFields;
            const newField = document.createElement('div');
            newField.className = 'd-flex phone-field-item mb-1';
            newField.setAttribute('data-phone-index', newIndex);
            newField.innerHTML = `
                <input type="text" class="form-control form-control-sm input-phone" 
                    placeholder="08xxxxxxxxxx" oninput="validateRow(${rowIndex})">
                <button type="button" class="btn btn-danger btn-sm ml-1 btn-remove-phone" 
                    onclick="removePhoneField(${rowIndex}, ${newIndex})" title="Hapus">
                    <i class="fas fa-times"></i>
                </button>
            `;
            container.appendChild(newField);
            
            // Update remove buttons state
            updatePhoneFieldButtons(rowIndex);
            
            // Focus new input
            newField.querySelector('.input-phone').focus();
        }

        // Remove phone field
        function removePhoneField(rowIndex, phoneIndex) {
            const container = document.getElementById(`phone-fields-${rowIndex}`);
            if (!container) return;
            
            const fields = container.querySelectorAll('.phone-field-item');
            if (fields.length <= 1) return; // Keep at least one field
            
            const fieldToRemove = container.querySelector(`.phone-field-item[data-phone-index="${phoneIndex}"]`);
            if (fieldToRemove) {
                fieldToRemove.remove();
            }
            
            // Re-index remaining fields
            container.querySelectorAll('.phone-field-item').forEach((field, idx) => {
                field.setAttribute('data-phone-index', idx);
                const removeBtn = field.querySelector('.btn-remove-phone');
                if (removeBtn) {
                    removeBtn.setAttribute('onclick', `removePhoneField(${rowIndex}, ${idx})`);
                }
            });
            
            updatePhoneFieldButtons(rowIndex);
            validateRow(rowIndex);
        }

        // Update phone field buttons state
        function updatePhoneFieldButtons(rowIndex) {
            const container = document.getElementById(`phone-fields-${rowIndex}`);
            if (!container) return;
            
            const fields = container.querySelectorAll('.phone-field-item');
            const addBtn = container.closest('.phone-container').querySelector('.btn-add-phone');
            
            // Disable/enable remove buttons
            fields.forEach(field => {
                const removeBtn = field.querySelector('.btn-remove-phone');
                if (removeBtn) {
                    removeBtn.disabled = fields.length <= 1;
                }
            });
            
            // Disable/enable add button
            if (addBtn) {
                addBtn.disabled = fields.length >= maxPhoneLimit;
            }
        }

        // Toggle between dropdown and manual input for device
        function toggleDeviceInput(index) {
            const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
            const deviceManual = document.querySelector(`.input-device-manual[data-index="${index}"]`);
            const toggleText = document.querySelectorAll(`.device-toggle`)[index];
            
            if (deviceManual.style.display === 'none') {
                deviceManual.style.display = 'block';
                deviceSelect.style.display = 'none';
                toggleText.innerHTML = '<i class="fas fa-list"></i> Pilih dari list';
            } else {
                deviceManual.style.display = 'none';
                deviceSelect.style.display = 'block';
                toggleText.innerHTML = '<i class="fas fa-keyboard"></i> Input manual';
            }
            validateRow(index);
        }

        // Handle manual device input
        function onManualDeviceInput(index) {
            const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
            if (deviceSelect) deviceSelect.value = ''; // Clear dropdown when typing manual
            validateRow(index);
        }

        // Update selection
        function updateSelection() {
            const checked = document.querySelectorAll('.row-check:checked').length;
            document.getElementById('statSelected').textContent = checked;
            
            // Update row highlighting
            document.querySelectorAll('.row-check').forEach(cb => {
                const row = cb.closest('tr');
                if (cb.checked) {
                    row.classList.add('selected');
                } else {
                    row.classList.remove('selected');
                }
            });
            
            updateCounters();
        }

        // Update counters
        function updateCounters() {
            let ready = 0;
            let incomplete = 0;
            
            document.querySelectorAll('.row-check:checked').forEach(cb => {
                const index = cb.dataset.index;
                const validIcon = document.getElementById(`valid-${index}`);
                if (validIcon.classList.contains('valid')) {
                    ready++;
                } else {
                    incomplete++;
                }
            });
            
            document.getElementById('countReady').textContent = ready;
            document.getElementById('countIncomplete').textContent = incomplete;
            document.getElementById('importCount').textContent = ready;
            document.getElementById('btnImport').disabled = ready === 0;
        }

        // Toggle check all
        function toggleCheckAll() {
            const checkAll = document.getElementById('checkAll').checked;
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = checkAll;
            });
            updateSelection();
        }

        // Select all visible
        function selectAll() {
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = true;
            });
            document.getElementById('checkAll').checked = true;
            updateSelection();
        }

        // Deselect all
        function deselectAll() {
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = false;
            });
            document.getElementById('checkAll').checked = false;
            updateSelection();
        }

        // Apply filters
        function applyFilters() {
            const profile = document.getElementById('filterProfile').value.toLowerCase();
            const status = document.getElementById('filterStatus').value;
            const search = document.getElementById('searchUsername').value.toLowerCase();
            
            filteredData = allPPPoEData.filter(item => {
                // Profile filter
                if (profile && (item.profile || '').toLowerCase() !== profile) return false;
                
                // Status filter
                if (status === 'active' && item.disabled) return false;
                if (status === 'disabled' && !item.disabled) return false;
                
                // Search filter
                if (search && !(item.name || '').toLowerCase().includes(search)) return false;
                
                return true;
            });
            
            renderTable();
        }

        // Get default settings (without bulk - bulk is now per row)
        function getDefaultSettings() {
            return {
                paid: document.querySelector('input[name="paidStatus"]:checked').value === 'true',
                send_invoice: document.getElementById('sendInvoice').checked,
                send_psb_welcome: document.getElementById('sendPsbWelcome').checked
            };
        }

        // Import users
        async function importUsers() {
            // Collect selected and valid users
            const usersToImport = [];
            
            document.querySelectorAll('.row-check:checked').forEach(cb => {
                const index = parseInt(cb.dataset.index);
                const validIcon = document.getElementById(`valid-${index}`);
                
                if (validIcon.classList.contains('valid')) {
                    const item = filteredData[index];
                    const nameInput = document.querySelector(`.input-name[data-index="${index}"]`);
                    const phoneContainer = document.getElementById(`phone-fields-${index}`);
                    const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
                    const deviceManual = document.querySelector(`.input-device-manual[data-index="${index}"]`);
                    const addressInput = document.querySelector(`.input-address[data-index="${index}"]`);
                    
                    // Get all phone numbers and join with |
                    const phoneInputs = phoneContainer ? phoneContainer.querySelectorAll('.input-phone') : [];
                    const phones = Array.from(phoneInputs)
                        .map(input => input.value.trim())
                        .filter(p => p);
                    const phoneNumber = phones.join('|');
                    
                    // Get device ID from dropdown or manual input
                    let deviceId = '';
                    if (deviceSelect && deviceSelect.value) {
                        deviceId = deviceSelect.value;
                    } else if (deviceManual && deviceManual.value.trim()) {
                        deviceId = deviceManual.value.trim();
                    }
                    
                    // Get SSID/bulk for this specific row
                    const rowBulk = getRowSSIDArray(index);
                    
                    // Find matching package by profile (case-insensitive)
                    const matchedPkg = packages.find(p => p.profile && p.profile.toLowerCase() === (item.profile || '').toLowerCase());
                    
                    // PENTING: Jika tidak ada paket yang cocok, tampilkan warning dan gunakan paket pertama sebagai fallback
                    let subscriptionName = '';
                    if (matchedPkg) {
                        subscriptionName = matchedPkg.name;
                    } else {
                        // Fallback: gunakan paket pertama jika ada, atau kosongkan
                        console.warn(`[IMPORT] Profile "${item.profile}" tidak ditemukan di packages. PPPoE: ${item.name}`);
                        subscriptionName = packages.length > 0 ? packages[0].name : '';
                    }
                    
                    usersToImport.push({
                        pppoe_username: item.name,
                        pppoe_password: item.password,
                        profile: item.profile,
                        subscription: subscriptionName, // Selalu gunakan nama paket, bukan profile MikroTik
                        name: nameInput.value.trim(),
                        phone_number: phoneNumber,
                        device_id: deviceId,
                        address: addressInput.value.trim(),
                        bulk: rowBulk // SSID per row
                    });
                }
            });
            
            if (usersToImport.length === 0) {
                Swal.fire('Peringatan', 'Tidak ada data yang siap di-import. Pastikan nama dan device ID sudah diisi dengan benar.', 'warning');
                return;
            }
            
            // Cek apakah ada user dengan subscription kosong (profile tidak cocok)
            const usersWithoutPackage = usersToImport.filter(u => !u.subscription || u.subscription === '');
            let warningHtml = '';
            if (usersWithoutPackage.length > 0) {
                warningHtml = `<br><br><small class="text-warning"><i class="fas fa-exclamation-triangle"></i> <strong>${usersWithoutPackage.length}</strong> pelanggan memiliki profile yang tidak cocok dengan paket di sistem. Paket akan dikosongkan.</small>`;
            }
            
            // Confirm
            const confirm = await Swal.fire({
                title: 'Konfirmasi Import',
                html: `Anda akan mengimport <strong>${usersToImport.length}</strong> pelanggan.${warningHtml}<br><br>Lanjutkan?`,
                icon: usersWithoutPackage.length > 0 ? 'warning' : 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Import',
                cancelButtonText: 'Batal'
            });
            
            if (!confirm.isConfirmed) return;
            
            showProgress('Mengimport Data...', `Memproses ${usersToImport.length} pelanggan...`);
            
            try {
                const response = await fetch('/api/users/bulk-import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        users: usersToImport,
                        defaultSettings: getDefaultSettings()
                    })
                });
                
                const result = await response.json();
                hideProgress();
                
                if (result.status === 200) {
                    const successCount = result.results?.success?.length || 0;
                    const failedCount = result.results?.failed?.length || 0;
                    
                    let message = `<strong>${successCount}</strong> pelanggan berhasil diimport.`;
                    if (failedCount > 0) {
                        message += `<br><strong>${failedCount}</strong> gagal.`;
                        
                        // Show failed details
                        const failedList = result.results.failed.map(f => 
                            `<li>${f.pppoe_username}: ${f.reason}</li>`
                        ).join('');
                        message += `<br><br><small>Detail gagal:<ul class="text-left">${failedList}</ul></small>`;
                    }
                    
                    // Tampilkan info WhatsApp jika send_psb_welcome dicentang
                    if (result.whatsappStatus) {
                        const waStatus = result.whatsappStatus;
                        if (waStatus.sendPsbWelcomeEnabled) {
                            if (waStatus.connected) {
                                message += `<br><br><small class="text-success"><i class="fas fa-check-circle"></i> Notifikasi WhatsApp terkirim</small>`;
                            } else {
                                message += `<br><br><small class="text-warning"><i class="fas fa-exclamation-triangle"></i> WhatsApp tidak terkoneksi (${waStatus.state}), notifikasi tidak terkirim</small>`;
                            }
                        }
                    }
                    
                    await Swal.fire({
                        title: 'Import Selesai',
                        html: message,
                        icon: failedCount > 0 ? 'warning' : 'success'
                    });
                    
                    // Refresh data
                    scanMikrotik();
                } else {
                    Swal.fire('Error', result.message || 'Gagal mengimport data', 'error');
                }
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        // Helper functions
        function showProgress(title, text) {
            document.getElementById('progressTitle').textContent = title;
            document.getElementById('progressText').textContent = text;
            document.getElementById('progressOverlay').style.display = 'flex';
        }

        function hideProgress() {
            document.getElementById('progressOverlay').style.display = 'none';
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Auto-sync devices from GenieACS
        async function autoSyncDevices() {
            showProgress('Sinkronisasi Device...', 'Mengambil data dari GenieACS...');
            
            try {
                // Fetch all devices from GenieACS
                const response = await fetch('/api/genieacs/devices-for-import');
                const result = await response.json();
                
                if (result.status !== 200) {
                    hideProgress();
                    Swal.fire('Error', result.message || 'Gagal mengambil data GenieACS', 'error');
                    return;
                }
                
                genieacsDevices = result.data || [];
                
                // Match devices with PPPoE usernames
                let matched = 0;
                let manual = 0;
                
                filteredData.forEach((item, index) => {
                    const pppoeUsername = item.name; // PPPoE username from MikroTik
                    const deviceSelect = document.querySelector(`.select-device[data-index="${index}"]`);
                    
                    if (!deviceSelect) return;
                    
                    // Populate dropdown with all devices first
                    populateDeviceDropdown(deviceSelect, genieacsDevices, index);
                    
                    // Try to find matching device by PPPoE username
                    const matchedDevice = genieacsDevices.find(d => 
                        d.pppUsername && d.pppUsername.toLowerCase() === pppoeUsername.toLowerCase()
                    );
                    
                    if (matchedDevice) {
                        // Set value using Select2 API to properly trigger change
                        $(deviceSelect).val(matchedDevice.deviceId).trigger('change');
                        deviceSelect.closest('tr').classList.remove('device-manual');
                        deviceSelect.closest('tr').classList.add('device-matched');
                        matched++;
                    } else {
                        // No match found
                        deviceSelect.closest('tr').classList.remove('device-matched');
                        deviceSelect.closest('tr').classList.add('device-manual');
                        manual++;
                    }
                    
                    validateRow(index);
                });
                
                // Update sync stats
                document.getElementById('syncStats').style.display = 'block';
                document.getElementById('syncMatched').textContent = matched;
                document.getElementById('syncManual').textContent = manual;
                document.getElementById('syncNotFound').textContent = '0';
                
                hideProgress();
                
                Swal.fire({
                    title: 'Sinkronisasi Selesai',
                    html: `<strong>${matched}</strong> device berhasil dicocokkan otomatis.<br>
                           <strong>${manual}</strong> perlu dipilih manual.`,
                    icon: matched > 0 ? 'success' : 'info'
                });
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi GenieACS: ' + error.message, 'error');
            }
        }

        // Populate device dropdown with GenieACS devices
        function populateDeviceDropdown(selectElement, devices, rowIndex) {
            // Destroy existing Select2 if any
            if ($(selectElement).hasClass('select2-hidden-accessible')) {
                $(selectElement).select2('destroy');
            }
            
            // Clear existing options except first
            selectElement.innerHTML = '<option value="">-- Pilih Device --</option>';
            
            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                // Display: PPPoE Username - Serial Number (Model)
                const displayPPP = device.pppUsername || 'Belum ada PPP';
                const displaySN = device.serialNumber || device.deviceId;
                option.textContent = `${displayPPP} - ${displaySN}`;
                option.setAttribute('data-device', JSON.stringify(device));
                option.setAttribute('data-ppp', device.pppUsername || '');
                option.setAttribute('data-sn', device.serialNumber || '');
                selectElement.appendChild(option);
            });
            
            // Initialize Select2 for better search - search by PPPoE username
            $(selectElement).select2({
                theme: 'bootstrap',
                placeholder: '-- Pilih Device --',
                allowClear: true,
                width: '100%',
                matcher: function(params, data) {
                    // Custom matcher to search by PPPoE username primarily
                    if ($.trim(params.term) === '') {
                        return data;
                    }
                    
                    const term = params.term.toLowerCase();
                    const ppp = ($(data.element).data('ppp') || '').toLowerCase();
                    const sn = ($(data.element).data('sn') || '').toLowerCase();
                    const text = (data.text || '').toLowerCase();
                    
                    // Search in PPPoE username first, then serial number, then full text
                    if (ppp.indexOf(term) > -1 || sn.indexOf(term) > -1 || text.indexOf(term) > -1) {
                        return data;
                    }
                    
                    return null;
                },
                templateResult: formatDeviceOption,
                templateSelection: formatDeviceSelection
            }).on('change', function() {
                const index = $(this).data('index');
                validateRow(index);
            });
        }

        // Format device option in dropdown
        function formatDeviceOption(device) {
            if (!device.id) return device.text;
            
            const deviceData = $(device.element).data('device');
            if (!deviceData) return device.text;
            
            const pppDisplay = deviceData.pppUsername 
                ? `<strong class="text-success">${deviceData.pppUsername}</strong>` 
                : '<span class="text-muted">Belum ada PPP</span>';
            
            return $(`
                <div>
                    <div>${pppDisplay}</div>
                    <small class="text-muted">
                        SN: ${deviceData.serialNumber || '-'} | 
                        Model: ${deviceData.model || '-'}
                    </small>
                </div>
            `);
        }

        // Format selected device
        function formatDeviceSelection(device) {
            if (!device.id) return device.text;
            
            const deviceData = $(device.element).data('device');
            if (!deviceData) return device.text;
            
            // Show PPPoE username if available, otherwise serial number
            if (deviceData.pppUsername) {
                return deviceData.pppUsername + ' (' + (deviceData.serialNumber || 'N/A') + ')';
            }
            return deviceData.serialNumber || deviceData.deviceId;
        }

        // SSID Preset Selection
        function selectSSIDPreset(preset) {
            // Reset all checkboxes first
            for (let i = 1; i <= 8; i++) {
                document.getElementById(`ssid${i}`).checked = false;
            }
            
            switch (preset) {
                case 'dual':
                    // Dual band: SSID 1 (2.4GHz) + SSID 5 (5GHz)
                    document.getElementById('ssid1').checked = true;
                    document.getElementById('ssid5').checked = true;
                    showToast('Dual Band dipilih: SSID 1 (2.4GHz) + SSID 5 (5GHz)', 'info');
                    break;
                case 'single':
                    // Single band: SSID 1 only (2.4GHz)
                    document.getElementById('ssid1').checked = true;
                    showToast('Single Band dipilih: SSID 1 (2.4GHz)', 'info');
                    break;
                case 'all':
                    // Select all SSIDs
                    for (let i = 1; i <= 8; i++) {
                        document.getElementById(`ssid${i}`).checked = true;
                    }
                    showToast('Semua SSID dipilih', 'info');
                    break;
                case 'none':
                    // Already reset above
                    showToast('Semua SSID direset', 'warning');
                    break;
            }
        }

        // Simple toast notification
        function showToast(message, type = 'info') {
            const Toast = Swal.mixin({
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true
            });
            Toast.fire({
                icon: type,
                title: message
            });
        }
    </script>
</body>
</html>
