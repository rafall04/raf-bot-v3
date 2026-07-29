<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Sinkronisasi Device ID';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT - Sinkronisasi Device ID';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/sync-device-id.css') ?>" rel="stylesheet">

</head>

<body id="page-top">
    <div id="wrapper">
        <?php include __DIR__ . '/_navbar.php'; ?>

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include __DIR__ . '/topbar.php'; ?>

                <div class="container-fluid">
                    <!-- Header -->
                    <div class="dashboard-header d-flex justify-content-between align-items-center flex-wrap mb-4">
                        <div>
                            <h1><i class="fas fa-sync-alt mr-2"></i>Sinkronisasi Device ID</h1>
                            <p class="mb-0">Update Device ID pelanggan berdasarkan PPPoE username di GenieACS</p>
                        </div>
                        <div>
                            <button class="btn btn-scan" id="btnScan" onclick="scanDevices()">
                                <i class="fas fa-search mr-2"></i>Scan Perbedaan
                            </button>
                        </div>
                    </div>

                    <!-- Info Box -->
                    <div class="info-box">
                        <h6 class="font-weight-bold mb-2"><i class="fas fa-info-circle mr-2"></i>Cara Kerja</h6>
                        <p>
                            Fitur ini akan mencocokkan <strong>PPPoE Username</strong> pelanggan di sistem dengan device di GenieACS.
                            Jika ditemukan device dengan PPPoE username yang sama tapi Device ID berbeda, maka Device ID akan diupdate ke yang baru.
                            Ini berguna ketika alat pelanggan sudah diganti dengan yang baru.
                        </p>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row mb-4" id="statsSection" style="display: none;">
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-primary text-white mr-3">
                                        <i class="fas fa-users"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statTotal">0</div>
                                        <div class="stats-label">Total Pelanggan</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-warning text-white mr-3">
                                        <i class="fas fa-exchange-alt"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statDiff">0</div>
                                        <div class="stats-label">Perlu Update</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-success text-white mr-3">
                                        <i class="fas fa-check-circle"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statSame">0</div>
                                        <div class="stats-label">Sudah Sesuai</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="stats-card">
                                <div class="d-flex align-items-center">
                                    <div class="stats-icon bg-danger text-white mr-3">
                                        <i class="fas fa-question-circle"></i>
                                    </div>
                                    <div>
                                        <div class="stats-value" id="statNotFound">0</div>
                                        <div class="stats-label">Tidak Ditemukan</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Main Content -->
                    <div class="card-modern" id="mainContent" style="display: none;">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <h6 class="m-0 font-weight-bold text-primary">
                                <i class="fas fa-list mr-2"></i>Daftar Pelanggan dengan Device ID Berbeda
                            </h6>
                            <div>
                                <button class="btn btn-sm btn-outline-primary mr-2" onclick="selectAll()">
                                    <i class="fas fa-check-double mr-1"></i>Pilih Semua
                                </button>
                                <button class="btn btn-sm btn-outline-secondary mr-2" onclick="deselectAll()">
                                    <i class="fas fa-times mr-1"></i>Batal Pilih
                                </button>
                                <button class="btn btn-sync" id="btnSync" onclick="syncDevices()" disabled>
                                    <i class="fas fa-sync mr-2"></i>Sinkronkan (<span id="selectedCount">0</span>)
                                </button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-sync table-hover" id="syncTable">
                                    <thead>
                                        <tr>
                                            <th width="40">
                                                <input type="checkbox" id="checkAll" onchange="toggleCheckAll()">
                                            </th>
                                            <th>Nama Pelanggan</th>
                                            <th>PPPoE Username</th>
                                            <th>Device ID Lama</th>
                                            <th>Device ID Baru</th>
                                            <th>Model</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody id="tableBody">
                                        <tr>
                                            <td colspan="7" class="empty-state">
                                                <i class="fas fa-search"></i>
                                                <p>Klik tombol "Scan Perbedaan" untuk memulai</p>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <!-- Empty State -->
                    <div class="card-modern" id="emptyState">
                        <div class="card-body empty-state">
                            <i class="fas fa-sync-alt"></i>
                            <h5>Sinkronisasi Device ID</h5>
                            <p>Klik tombol "Scan Perbedaan" untuk mencari pelanggan yang Device ID-nya perlu diupdate</p>
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

    <script src="<?= rafAssetUrl('/js/sync-device-id.js') ?>"></script>

</body>
</html>
