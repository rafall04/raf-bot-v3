<?php
// FORCE NO CACHE - MUST BE FIRST
header("Cache-Control: no-cache, no-store, must-revalidate");
header("Pragma: no-cache");
header("Expires: 0");
header("X-Debug-Version: NO-PLUGIN-2025-11-07");
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <!-- CACHE BUSTER - Force reload on each access -->
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <!-- VERSION: 2025-11-07-FINAL - Copied working code from teknisi version -->
    <title>Peta Jaringan</title>

    <link href="/vendor/fontawesome-free/css/all.min.css?v=<?php echo time(); ?>" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css?v=<?php echo time(); ?>" rel="stylesheet">
    <link href="/css/admin-theme.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css?v=<?php echo time(); ?>" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
    <link href="https://cdn.jsdelivr.net/npm/select2@4.10-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <!-- Re-enable fullscreen CSS to match teknisi version -->
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet.fullscreen@1.6.0/Control.FullScreen.css" />

    <link href="/css/map-viewer.css?v=<?php echo time(); ?>" rel="stylesheet">
    <!-- Mobile sidebar styles handled by sb-admin-2.css -->
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-2 static-top shadow">
                    <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3"><i class="fa fa-bars"></i></button>
                    <h1 class="h4 mb-0 text-gray-800">Peta Aset Jaringan</h1>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                                <span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">User</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="/logout" data-toggle="modal" data-target="#logoutModal"><i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>Logout</a>
                            </div>
                        </li>
                    </ul>
                </nav>
                <div class="container-fluid">
                    <div class="map-instructions-header">
                        <span class="flex-grow-1">
                           <i class="fas fa-info-circle"></i> <strong class="d-none d-sm-inline">Petunjuk:</strong> <span class="d-none d-md-inline">Klik marker ODC/ODP/Pelanggan untuk melihat detail atau mengelola. Gunakan tombol <i class="fas fa-crosshairs"></i> untuk ke lokasi GPS Anda.</span><span class="d-inline d-md-none">Klik marker untuk detail.</span>
                        </span>
                        <button id="openCustomFilterModalBtn" class="btn btn-sm btn-info" title="Filter Item Peta Secara Spesifik">
                            <i class="fas fa-filter"></i> <span class="d-none d-sm-inline">Filter Kustom</span><span class="d-inline d-sm-none">Filter</span>
                        </button>
                        <button id="refreshAllDataBtn" class="btn btn-sm btn-primary ml-2" title="Refresh Status Pelanggan & Redaman">
                            <i class="fas fa-sync-alt"></i> <span class="d-none d-sm-inline">Refresh Data</span><span class="d-inline d-sm-none">Refresh</span>
                        </button>
                        <div class="form-check form-check-inline ml-3">
                            <input class="form-check-input" type="checkbox" id="autoRefreshToggle">
                            <label class="form-check-label" for="autoRefreshToggle" title="Aktifkan refresh data otomatis setiap 30 detik">
                                <span class="d-none d-sm-inline">Auto Refresh</span><span class="d-inline d-sm-none">Auto</span>
                            </label>
                        </div>
                    </div>
                    <div id="globalMessageMap" class="mb-2"></div>
                    
                    <!-- Quick Filter Buttons -->
                    <div id="quickFilterButtons" class="quick-filter-buttons mb-3">
                        <div class="quick-filter-group">
                            <span class="quick-filter-label"><i class="fas fa-filter"></i> Quick Filters:</span>
                            <button class="btn btn-sm quick-filter-btn active" data-filter="all" title="Tampilkan Semua">
                                <i class="fas fa-th"></i> Semua
                            </button>
                            <button class="btn btn-sm quick-filter-btn" data-filter="online" title="Hanya Pelanggan Online">
                                <i class="fas fa-circle text-success"></i> Online
                            </button>
                            <button class="btn btn-sm quick-filter-btn" data-filter="offline" title="Hanya Pelanggan Offline">
                                <i class="fas fa-circle text-danger"></i> Offline
                            </button>
                            <button class="btn btn-sm quick-filter-btn" data-filter="assets" title="Hanya Aset Jaringan">
                                <i class="fas fa-network-wired"></i> Aset
                            </button>
                            <button class="btn btn-sm quick-filter-btn" data-filter="customers" title="Hanya Pelanggan">
                                <i class="fas fa-users"></i> Pelanggan
                            </button>
                        </div>
                        <button class="btn btn-sm btn-outline-secondary" id="resetQuickFilterBtn" title="Reset Filter">
                            <i class="fas fa-redo"></i> Reset
                        </button>
                    </div>
                    
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
                                    <div class="mt-2">
                                        <canvas id="chart-online" class="monitoring-chart" style="height: 40px;"></canvas>
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
                                    <div class="mt-2">
                                        <canvas id="chart-offline" class="monitoring-chart" style="height: 40px;"></canvas>
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
                                    <div class="mt-2">
                                        <canvas id="chart-total" class="monitoring-chart" style="height: 40px;"></canvas>
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
                                    <div class="mt-2">
                                        <canvas id="chart-uptime" class="monitoring-chart" style="height: 40px;"></canvas>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Map Sidebar Panel -->
                    <div id="mapSidebar" class="map-sidebar">
                        <div class="map-sidebar-header">
                            <h6 class="mb-0"><i class="fas fa-tools"></i> Quick Tools</h6>
                            <button id="toggleMapSidebar" class="btn btn-sm btn-link text-white" title="Tutup Sidebar">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                        <div class="map-sidebar-content">
                            <!-- Quick Stats Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-chart-bar"></i> Quick Stats</h6>
                                <div class="quick-stats">
                                    <div class="stat-item">
                                        <span class="stat-label">ODC</span>
                                        <span class="stat-value" id="sidebar-odc-count">0</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">ODP</span>
                                        <span class="stat-value" id="sidebar-odp-count">0</span>
                                    </div>
                                    <div class="stat-item">
                                        <span class="stat-label">Pelanggan</span>
                                        <span class="stat-value" id="sidebar-customer-count">0</span>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Quick Search Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-search"></i> Quick Search</h6>
                                <div class="input-group input-group-sm">
                                    <input type="text" id="sidebarSearchInput" class="form-control" placeholder="Cari pelanggan/ODC/ODP...">
                                    <div class="input-group-append">
                                        <button class="btn btn-outline-secondary" type="button" id="sidebarSearchBtn">
                                            <i class="fas fa-search"></i>
                                        </button>
                                    </div>
                                </div>
                                <div id="sidebarSearchResults" class="search-results mt-2" style="display: none;"></div>
                            </div>
                            
                            <!-- Quick Filters Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-filter"></i> Quick Filters</h6>
                                <div class="quick-filters">
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="sidebarFilterOnline" checked>
                                        <label class="form-check-label" for="sidebarFilterOnline">
                                            <i class="fas fa-circle text-success"></i> Online
                                        </label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="sidebarFilterOffline" checked>
                                        <label class="form-check-label" for="sidebarFilterOffline">
                                            <i class="fas fa-circle text-danger"></i> Offline
                                        </label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="sidebarFilterOdc" checked>
                                        <label class="form-check-label" for="sidebarFilterOdc">
                                            <i class="fas fa-server text-purple"></i> ODC
                                        </label>
                                    </div>
                                    <div class="form-check">
                                        <input class="form-check-input" type="checkbox" id="sidebarFilterOdp" checked>
                                        <label class="form-check-label" for="sidebarFilterOdp">
                                            <i class="fas fa-network-wired text-orange"></i> ODP
                                        </label>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Recent Alerts Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-bell"></i> Recent Alerts</h6>
                                <div id="sidebarAlertsList" class="alerts-list">
                                    <div class="alert-item alert-info">
                                        <i class="fas fa-info-circle"></i>
                                        <span>Belum ada alert</span>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Export Options Section -->
                            <div class="sidebar-section">
                                <h6 class="sidebar-section-title"><i class="fas fa-download"></i> Export</h6>
                                <div class="export-buttons">
                                    <button class="btn btn-sm btn-outline-primary btn-block mb-2" id="exportCustomersBtn">
                                        <i class="fas fa-file-csv"></i> Export Pelanggan
                                    </button>
                                    <button class="btn btn-sm btn-outline-secondary btn-block mb-2" id="exportAssetsBtn">
                                        <i class="fas fa-file-excel"></i> Export Aset
                                    </button>
                                    <button class="btn btn-sm btn-outline-info btn-block" id="exportMapBtn">
                                        <i class="fas fa-image"></i> Export Peta
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Overlay untuk mobile -->
                    <div class="map-sidebar-overlay" id="mapSidebarOverlay"></div>
                    
                    <!-- Toast Notifications Container -->
                    <div id="toastNotificationsContainer" class="toast-notifications-container"></div>
                    
                    <!-- Alert Panel (Floating) -->
                    <div id="alertPanel" class="alert-panel">
                        <div class="alert-panel-header">
                            <h6 class="mb-0"><i class="fas fa-exclamation-triangle"></i> Active Alerts</h6>
                            <div class="alert-panel-actions">
                                <button id="toggleAlertPanel" class="btn btn-sm btn-link text-white" title="Minimize">
                                    <i class="fas fa-minus"></i>
                                </button>
                                <button id="closeAlertPanel" class="btn btn-sm btn-link text-white" title="Close">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                        <div class="alert-panel-content" id="alertPanelContent">
                            <div class="alert-panel-empty">
                                <i class="fas fa-check-circle text-success"></i>
                                <p>Tidak ada alert aktif</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Alert Panel Toggle Button (Floating) -->
                    <button id="openAlertPanelBtn" class="btn btn-warning alert-panel-toggle" title="Buka Alert Panel">
                        <i class="fas fa-bell"></i>
                        <span class="alert-badge" id="alertBadge" style="display: none;">0</span>
                    </button>
                    
                    <!-- Toggle Sidebar Button (Floating) -->
                    <button id="openMapSidebarBtn" class="btn btn-primary map-sidebar-toggle" title="Buka Quick Tools">
                        <i class="fas fa-tools"></i>
                    </button>
                    
                    <div id="mapContainer">
                        <button id="editWaypointBtn" class="btn btn-warning btn-sm" title="Edit Waypoint Manual">
                            <i class="fas fa-route"></i> Edit Waypoint
                        </button>
                        <button id="manualFullscreenBtn" class="btn btn-light btn-sm" title="Layar Penuh Peta (Kustom)">
                            <i class="fas fa-expand"></i>
                        </button>
                        <div id="interactiveMap"></div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto"><div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div></div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog"><div class="modal-dialog modal-dialog-centered" role="document"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Ready to Leave?</h5><button class="close" type="button" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div><div class="modal-body">Select "Logout" below if you are ready to end your current session.</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button><a class="btn btn-primary" href="/logout">Logout</a></div></div></div></div>

    <div class="modal fade" id="assetModal" tabindex="-1" role="dialog" aria-labelledby="assetModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
            <form id="assetForm">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="assetModalLabel">Tambah Aset Jaringan Baru</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                    </div>
                    <div class="modal-body">
                        <input type="hidden" id="assetId">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetType" class="form-label">Tipe Aset <span class="text-danger">*</span></label>
                                    <select class="form-control form-control-sm" id="assetType" name="type" required>
                                        <option value="ODC">ODC (Optical Distribution Cabinet)</option>
                                        <option value="ODP">ODP (Optical Distribution Point)</option>
                                    </select>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetName" class="form-label">Nama/Label Aset <span class="text-danger">*</span></label>
                                    <input type="text" class="form-control form-control-sm" id="assetName" name="name" placeholder="Contoh: ODC Kaliasin 01" required>
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="assetAddress" class="form-label">Alamat/Lokasi Detail</label>
                            <input type="text" class="form-control form-control-sm" id="assetAddress" name="address" placeholder="Contoh: Jl. Kaliasin No. 1, Surabaya">
                        </div>
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetLatitude" class="form-label">Latitude <span class="text-danger">*</span></label>
                                    <input type="number" step="any" class="form-control form-control-sm" id="assetLatitude" name="latitude" required>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetLongitude" class="form-label">Longitude <span class="text-danger">*</span></label>
                                    <input type="number" step="any" class="form-control form-control-sm" id="assetLongitude" name="longitude" required>
                                </div>
                            </div>
                        </div>
                        <div id="assetModalMap" style="height: 250px; width: 100%; margin-bottom: 15px; border: 1px solid #ddd; border-radius: .35rem;"></div>
                        <small class="form-text text-muted mb-2">Klik peta untuk menandai lokasi atau gunakan tombol GPS <i class="fas fa-map-marker-alt"></i>.</small>

                        <div class="form-group" id="parentOdcGroup" style="display:none;">
                            <label for="assetParentOdc" class="form-label">Induk ODC (untuk ODP)</label>
                            <select class="form-control form-control-sm" id="assetParentOdc" name="parent_odc_id" style="width: 100%;">
                                <option value="">-- Pilih ODC Induk --</option>
                            </select>
                            <div class="form-check mt-1">
                                <input class="form-check-input" type="checkbox" id="useParentOdcLocation">
                                <label class="form-check-label" for="useParentOdcLocation">
                                    Gunakan lokasi ODC Induk yang dipilih untuk ODP ini
                                </label>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetCapacity" class="form-label">Kapasitas Port</label>
                                    <input type="number" class="form-control form-control-sm" id="assetCapacity" name="capacity_ports" placeholder="Contoh: 144 atau 8">
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="assetPortsUsed" class="form-label">Port Terpakai
                                        <span id="odcPortsUsedLabelInfo" style="display:none;"><small class="text-muted">(otomatis dari ODP)</small></span>
                                        <span id="odpPortsUsedLabelInfo" style="display:none;"><small class="text-muted">(otomatis dari pelanggan)</small></span>
                                    </label>
                                    <input type="number" class="form-control form-control-sm" id="assetPortsUsed" name="ports_used" placeholder="Otomatis" readonly>
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="assetNotes" class="form-label">Catatan Tambahan</label>
                            <textarea class="form-control form-control-sm" id="assetNotes" name="notes" rows="2" placeholder="Informasi tambahan mengenai aset..."></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-danger mr-auto" id="deleteAssetBtn" style="display:none;">Hapus Aset Ini</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Batal</button>
                        <button type="submit" class="btn btn-primary btn-sm" id="saveAssetBtn">Simpan Aset</button>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="addOdpAfterOdcModal" tabindex="-1" role="dialog" aria-labelledby="addOdpAfterOdcModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="addOdpAfterOdcModalLabel">ODC Berhasil Disimpan</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <p id="addOdpAfterOdcMessageText"></p>
                    <p>Apakah Anda ingin menambahkan ODP di lokasi yang sama untuk ODC ini sekarang?</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal" id="noAddOdpBtn">Tidak, Lain Kali</button>
                    <button type="button" class="btn btn-primary btn-sm" id="yesAddOdpBtn">Ya, Tambah ODP</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="wifiInfoModal" data-backdrop="static" tabindex="-1" role="dialog" aria-labelledby="wifiInfoModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="wifiInfoModalLabel">Detail Informasi WiFi</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body" id="wifiInfoModalBody" style="max-height: 75vh; overflow-y: auto;">
                    <p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat informasi...</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="wifiManagementModal" data-backdrop="static" tabindex="-1" role="dialog" aria-labelledby="wifiManagementModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <form id="wifiManagementForm">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="wifiManagementModalLabel">Kelola WiFi Pelanggan</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                    </div>
                    <div class="modal-body">
                        <input type="hidden" id="wifi_manage_device_id" name="device_id_for_wifi_manage">
                        <input type="hidden" id="wifi_manage_customer_name" name="customer_name_for_wifi_manage">

                        <div id="wifiManagementFormContainer">
                            <p class="text-center"><i class="fas fa-spinner fa-spin"></i> Memuat detail WiFi...</p>
                        </div>
                         <div class="form-group mt-3">
                            <label for="wifi_manage_transmit_power" class="form-label">Transmit Power Global</label>
                            <select name="transmit_power" id="wifi_manage_transmit_power" class="form-control form-control-sm">
                                <option value="">-- Biarkan Default --</option>
                                <option value="20">20%</option>
                                <option value="40">40%</option>
                                <option value="60">60%</option>
                                <option value="80">80%</option>
                                <option value="100">100%</option>
                            </select>
                        </div>
                        <small class="form-text text-muted">Kosongkan field SSID atau Password jika tidak ingin mengubahnya. Password minimal 8 karakter.</small>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button>
                        <button type="submit" class="btn btn-primary btn-sm" id="saveWifiManagementBtn">Simpan Perubahan WiFi</button>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="customFilterModal" tabindex="-1" role="dialog" aria-labelledby="customFilterModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-xl" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="customFilterModalLabel">Filter Item Peta Kustom</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <div class="row">
                        <div class="col-md-4">
                            <h6><i class="fas fa-server"></i> Optical Distribution Cabinets (ODC)</h6>
                            <input type="text" class="form-control form-control-sm filter-search-input" id="searchOdcFilter" placeholder="Cari ODC...">
                            <div class="mb-2">
                                <input type="checkbox" id="selectAllOdc" class="mr-1">
                                <label for="selectAllOdc" class="small">Pilih Semua / Batal Pilih Semua ODC</label>
                            </div>
                            <ul class="list-group filter-list-column" id="odcFilterList">
                                </ul>
                        </div>
                        <div class="col-md-4">
                            <h6><i class="fas fa-network-wired"></i> Optical Distribution Points (ODP)</h6>
                            <input type="text" class="form-control form-control-sm filter-search-input" id="searchOdpFilter" placeholder="Cari ODP...">
                             <div class="mb-2">
                                <input type="checkbox" id="selectAllOdp" class="mr-1">
                                <label for="selectAllOdp" class="small">Pilih Semua / Batal Pilih Semua ODP</label>
                            </div>
                            <ul class="list-group filter-list-column" id="odpFilterList">
                                <li class="list-group-item text-muted small">Pilih ODC untuk melihat daftar ODP terkait.</li>
                            </ul>
                        </div>
                        <div class="col-md-4">
                            <h6><i class="fas fa-users"></i> Pelanggan</h6>
                             <input type="text" class="form-control form-control-sm filter-search-input" id="searchCustomerFilter" placeholder="Cari Pelanggan...">
                            <div class="mb-2">
                                <input type="checkbox" id="selectAllCustomer" class="mr-1">
                                <label for="selectAllCustomer" class="small">Pilih Semua / Batal Pilih Semua Pelanggan</label>
                            </div>
                            <ul class="list-group filter-list-column" id="customerFilterList">
                                <li class="list-group-item text-muted small">Pilih ODP untuk melihat daftar Pelanggan terkait.</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary btn-sm" id="resetCustomFilterBtn">Reset ke Tampilkan Semua</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary btn-sm" id="applyCustomFilterBtn">Terapkan Filter</button>
                </div>
            </div>
        </div>
    </div>


    <script src="/vendor/jquery/jquery.min.js?v=<?php echo time(); ?>"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js?v=<?php echo time(); ?>"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js?v=<?php echo time(); ?>"></script>
    <script src="/js/sb-admin-2.js?v=<?php echo time(); ?>"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script src="https://cdn.jsdelivr.net/npm/leaflet-ant-path@1.3.0/dist/leaflet-ant-path.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
    <!-- Re-enable plugin like in teknisi version which works -->
    <script src="https://cdn.jsdelivr.net/npm/leaflet.fullscreen@1.6.0/Control.FullScreen.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <!-- Map Routing Helper -->
    <script src="/js/map-routing-helper.js?v=<?php echo time(); ?>"></script>

    <script src="/js/map-viewer.js?v=<?php echo time(); ?>"></script>
</body>
</html>