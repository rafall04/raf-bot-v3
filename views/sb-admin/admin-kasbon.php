<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Kelola Kasbon Teknisi';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/admin-kasbon.css') ?>" rel="stylesheet">

</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>

                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <h1 class="h3 mb-0 text-gray-800">
                            <i class="fas fa-hand-holding-usd text-primary"></i> Kelola Kasbon Teknisi
                        </h1>
                        <button class="btn btn-primary btn-sm" id="refreshBtn">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row mb-4">
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-warning shadow h-100">
                                <div class="card-body">
                                    <div class="stats-label text-uppercase">Menunggu Approval</div>
                                    <div class="stats-value text-warning" id="pendingCount">0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-success shadow h-100">
                                <div class="card-body">
                                    <div class="stats-label text-uppercase">Total Disetujui</div>
                                    <div class="stats-value text-success" id="approvedAmount">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-danger shadow h-100">
                                <div class="card-body">
                                    <div class="stats-label text-uppercase">Belum Lunas</div>
                                    <div class="stats-value text-danger" id="outstandingAmount">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-info shadow h-100">
                                <div class="card-body">
                                    <div class="stats-label text-uppercase">Total Lunas</div>
                                    <div class="stats-value text-info" id="paidAmount">Rp 0</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Filter Tabs -->
                    <div class="filter-tabs">
                        <div class="filter-tab active" data-filter="all">Semua</div>
                        <div class="filter-tab" data-filter="pending">Menunggu</div>
                        <div class="filter-tab" data-filter="approved">Aktif</div>
                        <div class="filter-tab" data-filter="rejected">Ditolak</div>
                        <div class="filter-tab" data-filter="paid">Lunas</div>
                    </div>

                    <!-- Data Table -->
                    <div class="card shadow mb-4">
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="kasbonTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Teknisi</th>
                                            <th>Tanggal</th>
                                            <th>Nominal</th>
                                            <th>Keterangan</th>
                                            <th>Status</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody></tbody>
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

    <!-- Approve/Reject Modal -->
    <div class="modal fade" id="actionModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header" id="actionModalHeader">
                    <h5 class="modal-title" id="actionModalTitle">Proses Kasbon</h5>
                    <button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <p><strong>Teknisi:</strong> <span id="modalTeknisi"></span></p>
                    <p><strong>Nominal:</strong> <span id="modalAmount"></span></p>
                    <p><strong>Keterangan:</strong> <span id="modalDesc"></span></p>
                    <div class="form-group">
                        <label for="actionNotes">Catatan Admin</label>
                        <textarea class="form-control" id="actionNotes" rows="2" placeholder="Catatan (opsional)"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-danger" id="rejectBtn">
                        <i class="fas fa-times"></i> Tolak
                    </button>
                    <button type="button" class="btn btn-success" id="approveBtn">
                        <i class="fas fa-check"></i> Setujui
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Mark as Paid Modal -->
    <div class="modal fade" id="paidModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header bg-info text-white">
                    <h5 class="modal-title"><i class="fas fa-check-double"></i> Tandai Lunas</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <p>Tandai kasbon ini sebagai <strong>LUNAS</strong>?</p>
                    <p><strong>Teknisi:</strong> <span id="paidTeknisi"></span></p>
                    <p><strong>Nominal:</strong> <span id="paidAmount2"></span></p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-info" id="confirmPaidBtn">
                        <i class="fas fa-check-double"></i> Ya, Tandai Lunas
                    </button>
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

    <script src="<?= rafAssetUrl('/js/admin-kasbon.js') ?>"></script>

</body>
</html>
