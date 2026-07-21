<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Peta Jaringan Teknisi';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
    ?>

    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet.fullscreen@1.6.0/Control.FullScreen.css" />

    <link href="/css/teknisi-map-viewer.css?v=<?php echo time(); ?>" rel="stylesheet">
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
                            <span class="tk-title-icon"><i class="fas fa-map-marked-alt"></i></span>
                            <div>
                                <h1>Peta Jaringan</h1>
                                <p class="tk-subtitle">Visualisasi ODC, ODP, dan pelanggan pada peta</p>
                            </div>
                        </div>
                    </div>
                    <div class="map-instructions-header">
                        <span class="flex-grow-1">
                           <i class="fas fa-info-circle"></i> <strong>Petunjuk:</strong> Klik marker ODC/ODP untuk info. Klik marker pelanggan untuk info dan opsi kelola. Gunakan tombol <i class="fas fa-crosshairs"></i> untuk ke lokasi GPS Anda.
                        </span>
                        <button id="openCustomFilterModalBtnMap" class="btn btn-sm btn-info" title="Filter Item Peta Secara Spesifik">
                            <i class="fas fa-filter"></i> Filter Kustom
                        </button>
                        <button id="refreshAllDataBtnMap" class="btn btn-sm btn-primary ml-2" title="Refresh Status Pelanggan & Redaman">
                            <i class="fas fa-sync-alt"></i> Refresh Data
                        </button>
                        <div class="form-check form-check-inline ml-3">
                            <input class="form-check-input" type="checkbox" id="autoRefreshToggle">
                            <label class="form-check-label" for="autoRefreshToggle" title="Aktifkan refresh data otomatis setiap 30 detik">
                                <span class="d-none d-sm-inline">Auto Refresh (30s)</span>
                                <span class="d-inline d-sm-none">Auto</span>
                            </label>
                        </div>
                        <button id="toggleConnectionLinesBtn" class="btn btn-sm btn-outline-success ml-2" title="Tampilkan/Sembunyikan Garis Koneksi Jaringan">
                            <i class="fas fa-project-diagram"></i> <span class="d-none d-sm-inline">Koneksi</span>
                        </button>
                    </div>
                    <div id="globalMessageMap" class="mb-2"></div>
                    
                    <!-- Connection Monitoring Dashboard -->
                    <div id="connectionMonitoringDashboard" class="row mb-3" style="display: none;">
                        <div class="col-md-3 col-sm-6 mb-2">
                            <div class="card border-left-success shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Pelanggan Online</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="monitoring-online-count">0</div>
                                            <div class="text-xs text-muted">Aktif</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-circle text-success fa-2x"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-2">
                            <div class="card border-left-danger shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-danger text-uppercase mb-1">Pelanggan Offline</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="monitoring-offline-count">0</div>
                                            <div class="text-xs text-muted">Putus</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-circle text-danger fa-2x"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-2">
                            <div class="card border-left-info shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-info text-uppercase mb-1">Total Pelanggan</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="monitoring-total-count">0</div>
                                            <div class="text-xs text-muted">Terdaftar</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-users fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-md-3 col-sm-6 mb-2">
                            <div class="card border-left-warning shadow h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-warning text-uppercase mb-1">Uptime Rate</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="monitoring-uptime-rate">0%</div>
                                            <div class="text-xs text-muted">Ketersediaan</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-chart-line fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div id="mapContainer">
                        <button id="manualFullscreenBtn" class="btn btn-light btn-sm" title="Layar Penuh Peta">
                            <i class="fas fa-expand"></i>
                        </button>
                        <div id="interactiveMap">
                            <div class="loading-spinner-container"><i class="fas fa-spinner fa-spin fa-3x"></i><p>Memuat peta dan data...</p></div>
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

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
        aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="wifiInfoModal" data-backdrop="static" tabindex="-1" role="dialog" aria-labelledby="wifiInfoModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="wifiInfoModalLabel">Informasi WiFi Pelanggan</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body" id="wifiInfoModalBody" style="max-height: 75vh; overflow-y: auto;">
                    <div class="loading-spinner-container"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Memuat informasi WiFi...</p></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="manageWifiModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog">
            <form class="modal-content" id="ssidUpdateFormMap">
                <div class="modal-header">
                    <h5 class="modal-title" id="manageWifiModalLabel">Kelola WiFi Pelanggan</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="map_ssid_update_device_id" name="device_id_for_ssid_update">
                    <input type="hidden" id="map_ssid_manage_customer_name" name="customer_name_for_wifi_manage">
                    <div id="manageWifiFormContainer">
                        <div class="loading-spinner-container" id="manageWifiLoading"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Memuat data SSID...</p></div>
                    </div>
                    <div class="form-group mt-3" id="manageWifiTransmitContainer">
                        <label for="map_transmit_power" class="form-label">Transmit Power Global</label>
                        <select name="transmit_power" id="map_transmit_power" class="form-control form-control-sm">
                            <option value="">-- Biarkan Default --</option>
                            <option value="20">20%</option><option value="40">40%</option>
                            <option value="60">60%</option><option value="80">80%</option>
                            <option value="100">100%</option>
                        </select>
                    </div>
                    <small class="form-text text-muted" id="manageWifiHelpText">Kosongkan field SSID atau Password jika tidak ingin mengubahnya. Password minimal 8 karakter.</small>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button>
                    <button type="submit" class="btn btn-primary btn-sm" id="mapSaveSsidChangesBtn">Simpan Perubahan</button>
                </div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="redamanInfoModal" tabindex="-1" role="dialog" aria-labelledby="redamanInfoModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="redamanInfoModalLabel">Informasi Redaman Optik</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                     <div class="loading-spinner-container" id="redamanLoadingSpinner"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Merefresh dan mengambil data redaman...</p></div>
                    <div id="redamanInfoContent" style="display: none;">
                        <p><strong>Device ID:</strong> <span id="redaman_device_id"></span></p>
                        <p><strong>Nama Pelanggan:</strong> <span id="redaman_customer_name"></span></p>
                        <h3>Redaman: <span id="redaman_value" class="font-weight-bold">N/A</span></h3>
                        <small id="redaman_message" class="form-text text-muted"></small>
                    </div>
                </div>
                <div class="modal-footer">
                     <button type="button" class="btn btn-info btn-sm" id="refreshRedamanButtonInModal">Refresh Lagi</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="customFilterModalMap" tabindex="-1" role="dialog" aria-labelledby="customFilterModalMapLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-xl" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="customFilterModalMapLabel">Filter Item Peta Kustom (Teknisi)</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <div class="row">
                        <div class="col-md-4">
                            <h6><i class="fas fa-server"></i> Optical Distribution Cabinets (ODC)</h6>
                            <input type="text" class="form-control form-control-sm filter-search-input" id="searchOdcFilterMap" placeholder="Cari ODC...">
                            <div class="mb-2">
                                <input type="checkbox" id="selectAllOdcMap" class="mr-1">
                                <label for="selectAllOdcMap" class="small">Pilih Semua / Batal Pilih Semua ODC</label>
                            </div>
                            <ul class="list-group filter-list-column" id="odcFilterListMap"></ul>
                        </div>
                        <div class="col-md-4">
                            <h6><i class="fas fa-network-wired"></i> Optical Distribution Points (ODP)</h6>
                            <input type="text" class="form-control form-control-sm filter-search-input" id="searchOdpFilterMap" placeholder="Cari ODP...">
                             <div class="mb-2">
                                <input type="checkbox" id="selectAllOdpMap" class="mr-1">
                                <label for="selectAllOdpMap" class="small">Pilih Semua / Batal Pilih Semua ODP</label>
                            </div>
                            <ul class="list-group filter-list-column" id="odpFilterListMap">
                                <li class="list-group-item text-muted small">Pilih ODC untuk melihat daftar ODP terkait.</li>
                            </ul>
                        </div>
                        <div class="col-md-4">
                            <h6><i class="fas fa-users"></i> Pelanggan</h6>
                             <input type="text" class="form-control form-control-sm filter-search-input" id="searchCustomerFilterMap" placeholder="Cari Pelanggan...">
                            <div class="mb-2">
                                <input type="checkbox" id="selectAllCustomerMap" class="mr-1">
                                <label for="selectAllCustomerMap" class="small">Pilih Semua / Batal Pilih Semua Pelanggan</label>
                            </div>
                            <ul class="list-group filter-list-column" id="customerFilterListMap">
                                <li class="list-group-item text-muted small">Pilih ODP untuk melihat daftar Pelanggan terkait.</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary btn-sm" id="resetCustomFilterBtnMap">Reset ke Tampilkan Semua</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary btn-sm" id="applyCustomFilterBtnMap">Terapkan Filter</button>
                </div>
            </div>
        </div>
    </div>


    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script src="https://cdn.jsdelivr.net/npm/leaflet-ant-path@1.3.0/dist/leaflet-ant-path.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/leaflet.fullscreen@1.6.0/Control.FullScreen.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <!-- Map Routing Helper -->
    <script src="/js/map-routing-helper.js?v=<?php echo time(); ?>"></script>

    <script src="/js/map-filter-core.js?v=<?php echo time(); ?>"></script>
    <script src="/js/teknisi-map-viewer.js?v=<?php echo time(); ?>"></script>
</body>
</html>
