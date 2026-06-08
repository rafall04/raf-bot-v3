<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Import dari MikroTik';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT - Import Pelanggan dari MikroTik';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link href="/css/import-mikrotik.css" rel="stylesheet">
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

    <script src="/js/import-mikrotik.js"></script>
</body>
</html>
