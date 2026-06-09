<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Monitor OLT';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="/css/teknisi-olt.css" rel="stylesheet">
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
                                            <th title="Daya pancar ONU (upstream)">ONU Tx</th>
                                            <th title="Atenuasi downstream (≈ launch − redaman)">Atenuasi</th>
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

                    <!-- Optik GPON tambahan (ZTE): ONU Tx, Atenuasi. OLT Rx upstream hanya di CLI. -->
                    <div class="row text-center mb-3" id="modalGponOptic" style="display: none;">
                        <div class="col-4"><small class="text-muted d-block">ONU Tx (upstream)</small><div class="font-weight-bold" id="modalOnuTx">-</div></div>
                        <div class="col-4"><small class="text-muted d-block">Atenuasi ≈ (down)</small><div class="font-weight-bold" id="modalAtten">-</div></div>
                        <div class="col-4"><small class="text-muted d-block">OLT Rx (upstream)</small><div class="text-muted"><small>hanya di CLI OLT</small></div></div>
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

    <script src="/js/teknisi-olt.js"></script>
</body>
</html>
