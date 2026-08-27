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
    <?php
    $pageTitle = 'RAF BOT - Monitor OLT';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="/css/admin-olt.css" rel="stylesheet">
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
                                <a href="/admin-olt-provision" class="btn btn-outline-primary" title="Registrasi ONU, tipe modem, backup OLT">
                                    <i class="fas fa-plug"></i> Provisioning
                                </a>
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
                                <select id="identitasFilter" class="form-control form-control-sm mr-2 mb-1" style="width: auto;" title="Saring menurut asal identitas pelanggan">
                                    <option value="all">Semua ONU</option>
                                    <option value="bot">Terdaftar di bot</option>
                                    <option value="mikrotik">Belum didaftarkan (ada di MikroTik)</option>
                                    <option value="tanpa">Tanpa identitas</option>
                                </select>
                                <select id="statusFilter" class="form-control form-control-sm mr-2 mb-1" style="width: auto;">
                                    <option value="">Semua Status</option>
                                    <option value="online">Online</option>
                                    <option value="offline">Offline</option>
                                    <option value="los">LOS</option>
                                    <option value="dying_gasp">Dying Gasp</option>
                                </select>
                                <select id="redamanFilter" class="form-control form-control-sm mr-2 mb-1" style="width: auto;" title="Saring menurut mutu redaman">
                                    <option value="">Semua Redaman</option>
                                    <option value="kritis">Kritis (&lt; -25 dBm)</option>
                                    <option value="peringatan">Peringatan (-25 s/d -20)</option>
                                    <option value="baik">Baik (&ge; -20)</option>
                                    <option value="takterbaca">Tak terbaca / basi</option>
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
                                            <th title="Daya pancar ONU (upstream)">ONU Tx</th>
                                            <th title="Atenuasi downstream (≈ launch − redaman)">Atenuasi</th>
                                            <th>Status OLT</th>
                                            <th title="Penyebab offline terakhir (ZTE): LOS/LOSi/SFi/DyingGasp">Penyebab</th>
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

                    <!-- Optik GPON tambahan (ZTE): ONU Tx, Atenuasi downstream. OLT Rx upstream
                         tidak tersedia via SNMP C320 (hanya CLI `show pon power attenuation`). -->
                    <div class="row text-center mb-3" id="modalGponOptic" style="display: none;">
                        <div class="col-4"><small class="text-muted d-block">ONU Tx (upstream)</small><div class="font-weight-bold" id="modalOnuTx">-</div></div>
                        <div class="col-4"><small class="text-muted d-block">Atenuasi ≈ (down)</small><div class="font-weight-bold" id="modalAtten">-</div></div>
                        <div class="col-4"><small class="text-muted d-block">OLT Rx (upstream)</small><div class="text-muted"><small>hanya di CLI OLT</small></div></div>
                    </div>
                    <!-- Penyebab offline terakhir + waktu (ZTE native: col7/col5/col6). Durasi dihitung
                         dari "online sejak" — akurat setelah jam OLT di-set (WIB). -->
                    <div class="row text-center mb-3">
                        <div class="col-4"><small class="text-muted d-block">Penyebab terakhir</small><div class="font-weight-bold" id="modalCause">-</div></div>
                        <div class="col-4"><small class="text-muted d-block">Online sejak / durasi</small><div class="font-weight-bold" id="modalUptime">-</div></div>
                        <div class="col-4"><small class="text-muted d-block">Terakhir down</small><div class="font-weight-bold" id="modalLastDown">-</div></div>
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

    <script src="/js/olt-filter-core.js"></script>
    <script src="/js/admin-olt.js"></script>
</body>
</html>
