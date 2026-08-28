<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Log Login & Logout';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    
    <link href="<?= rafAssetUrl('/css/login-logs.css') ?>" rel="stylesheet">

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
                        <div class="dashboard-header">
                            <h1>Log Login &amp; Logout</h1>
                            <p>Riwayat login dan logout admin dan teknisi</p>
                        </div>
                        <button id="refreshBtn" class="btn btn-primary btn-sm">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>

                    <!-- Filter Section -->
                    <div class="filter-section">
                        <div class="row">
                            <div class="col-md-4">
                                <label>Username</label>
                                <input type="text" id="filterUsername" class="form-control form-control-sm" placeholder="Username">
                            </div>
                            <div class="col-md-3">
                                <label>Action</label>
                                <select id="filterAction" class="form-control form-control-sm">
                                    <option value="">Semua</option>
                                    <option value="login">Login</option>
                                    <option value="logout">Logout</option>
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label>Status</label>
                                <select id="filterSuccess" class="form-control form-control-sm">
                                    <option value="">Semua</option>
                                    <option value="true">Success</option>
                                    <option value="false">Failed</option>
                                </select>
                            </div>
                            <div class="col-md-2">
                                <label>&nbsp;</label>
                                <button id="applyFiltersBtn" class="btn btn-primary btn-sm btn-block">
                                    <i class="fas fa-filter"></i> Filter
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Logs Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary">Login & Logout History</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered tabel-tumpuk-hp" id="loginLogsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Action</th>
                                            <th>Timestamp</th>
                                            <th>Username</th>
                                            <th>Role</th>
                                            <th>Status</th>
                                            <th>IP Address</th>
                                            <th>User Agent</th>
                                            <th>Failure Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody id="loginLogsBody">
                                        <tr>
                                            <td colspan="8" class="text-center">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Konfirmasi Logout</h5>
                    <button type="button" class="close" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">Apakah Anda yakin ingin logout?</div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <a href="/logout" class="btn btn-primary">Logout</a>
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

    <script src="<?= rafAssetUrl('/js/login-logs.js') ?>"></script>

</body>

</html>

