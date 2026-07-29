<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Log Perubahan WiFi';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    
    <link href="<?= rafAssetUrl('/css/wifi-logs.css') ?>" rel="stylesheet">

</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
                    <form class="form-inline">
                        <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                            <i class="fa fa-bars"></i>
                        </button>
                    </form>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown">
                                <span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTgiIGZpbGw9IiNlMGUwZTAiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjE1IiByPSI1IiBmaWxsPSIjYWFhIi8+PHBhdGggZD0iTTIwIDI0YzUgMCA5IDMgOSA2djZINDF2LTZjMC0zIDQtNiA5LTZ6IiBmaWxsPSIjYWFhIi8+PC9zdmc+'">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                                    Logout
                                </a>
                            </div>
                        </li>
                    </ul>
                </nav>

                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Log Perubahan WiFi</h1>
            <p>Kelola dan monitor log perubahan wifi</p>
          </div>
                        <button id="refreshStatsBtn" class="btn btn-primary btn-sm">
                            <i class="fas fa-sync-alt"></i> Refresh Data
                        </button>
                    </div>

                    <!-- Statistics Cards -->
                    <div class="row mb-4" id="statsContainer">
                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card stats-card h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">
                                                Total Perubahan
                                            </div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalChanges">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-wifi fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card stats-card warning h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-warning text-uppercase mb-1">
                                                24 Jam Terakhir
                                            </div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="changes24h">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-clock fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card stats-card success h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-success text-uppercase mb-1">
                                                7 Hari Terakhir
                                            </div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="changes7d">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-calendar-week fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card stats-card info h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-info text-uppercase mb-1">
                                                30 Hari Terakhir
                                            </div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="changes30d">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-calendar-alt fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Filters -->
                    <!-- Table Section -->
          <h4 class="dashboard-section-title">Filter Log</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Filter Log</h6>
                        </div>
                        <div class="card-body">
                            <div class="filter-section">
                                <div class="row">
                                    <div class="col-md-3 mb-3">
                                        <label for="filterChangeType" class="form-label">Jenis Perubahan</label>
                                        <select id="filterChangeType" class="form-control form-control-sm">
                                            <option value="">Semua Jenis</option>
                                            <option value="ssid_name">Nama SSID</option>
                                            <option value="password">Password</option>
                                            <option value="both">SSID & Password</option>
                                            <option value="transmit_power">Transmit Power</option>
                                        </select>
                                    </div>
                                    <div class="col-md-3 mb-3">
                                        <label for="filterChangeSource" class="form-label">Sumber Perubahan</label>
                                        <select id="filterChangeSource" class="form-control form-control-sm">
                                            <option value="">Semua Sumber</option>
                                            <option value="web_admin">Web Admin</option>
                                            <option value="web_technician">Web Teknisi</option>
                                            <option value="web_customer">Portal Pelanggan</option>
                                            <option value="wa_bot">WhatsApp Bot</option>
                                            <option value="api">API</option>
                                        </select>
                                    </div>
                                    <div class="col-md-3 mb-3">
                                        <label for="filterDateFrom" class="form-label">Dari Tanggal</label>
                                        <input type="date" id="filterDateFrom" class="form-control form-control-sm">
                                    </div>
                                    <div class="col-md-3 mb-3">
                                        <label for="filterDateTo" class="form-label">Sampai Tanggal</label>
                                        <input type="date" id="filterDateTo" class="form-control form-control-sm">
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label for="filterChangedBy" class="form-label">Diubah Oleh</label>
                                        <input type="text" id="filterChangedBy" class="form-control form-control-sm" placeholder="Nama user/admin">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label for="filterDeviceId" class="form-label">Device ID</label>
                                        <input type="text" id="filterDeviceId" class="form-control form-control-sm" placeholder="Device ID">
                                    </div>
                                    <div class="col-md-4 mb-3 d-flex align-items-end">
                                        <div class="w-100">
                                            <button id="applyFilters" class="btn btn-primary btn-sm mr-2">
                                                <i class="fas fa-filter"></i> Terapkan Filter
                                            </button>
                                            <button id="clearFilters" class="btn btn-outline-secondary btn-sm">
                                                <i class="fas fa-times"></i> Reset
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Logs Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <div class="d-flex justify-content-between align-items-center">
                                <h6 class="m-0 font-weight-bold text-primary">Log Perubahan WiFi</h6>
                                <button id="refreshLogsBtn" class="btn btn-info btn-sm">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-sm" id="logsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Waktu</th>
                                            <th>Pelanggan</th>
                                            <th>Device ID</th>
                                            <th>Jenis Perubahan</th>
                                            <th>Detail Perubahan</th>
                                            <th>Diubah Oleh</th>
                                            <th>Sumber</th>
                                            <th>Alasan</th>
                                        </tr>
                                    </thead>
                                    <tbody id="logsTableBody">
                                        <tr>
                                            <td colspan="8" class="text-center py-4">
                                                <i class="fas fa-spinner fa-spin fa-2x text-muted"></i>
                                                <p class="mt-2 text-muted">Memuat data log...</p>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            
                            <!-- Pagination -->
                            <div class="d-flex justify-content-between align-items-center mt-3">
                                <div class="text-muted" id="paginationInfo">
                                    Menampilkan 0 dari 0 log
                                </div>
                                <div>
                                    <button id="prevPage" class="btn btn-outline-primary btn-sm mr-2" disabled>
                                        <i class="fas fa-chevron-left"></i> Sebelumnya
                                    </button>
                                    <button id="nextPage" class="btn btn-outline-primary btn-sm" disabled>
                                        Selanjutnya <i class="fas fa-chevron-right"></i>
                                    </button>
                                </div>
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

    <!-- Logout Modal -->
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

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

    <script src="<?= rafAssetUrl('/js/wifi-logs.js') ?>"></script>

</body>

</html>
