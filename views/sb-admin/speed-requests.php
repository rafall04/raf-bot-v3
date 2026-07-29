<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'Speed on Demand Requests - Admin Panel';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
</head>
<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>

                <div class="container-fluid">
                    <!-- Page Header -->
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <h1>Speed on Demand Requests</h1>
                                <p>Kelola permintaan penambahan kecepatan sementara dari pelanggan</p>
                            </div>
                            <button class="btn btn-warning-custom" onclick="cleanupExpiredRequests()">
                                <i class="fas fa-broom"></i> Cleanup Expired
                            </button>
                        </div>
                    </div>

                    <!-- Table Section -->
                    <h4 class="dashboard-section-title">Daftar Permintaan</h4>
                    <div class="card table-card mb-4">
                        <div class="card-header">
                            <h6>Permintaan Speed Boost</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered" id="speedRequestTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama Pelanggan</th>
                                            <th>Paket Diminta</th>
                                            <th>Durasi</th>
                                            <th>Harga</th>
                                            <th>Metode Bayar</th>
                                            <th>Status Bayar</th>
                                            <th>Tgl Permintaan</th>
                                            <th>Status</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    </tbody>
                                </table>
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

    <!-- Logout Modal-->
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Yakin ingin Logout?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">Pilih "Logout" di bawah jika Anda siap untuk mengakhiri sesi Anda saat ini.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Approve Modal -->
    <div class="modal fade" id="approveModal" tabindex="-1" role="dialog" aria-labelledby="approveModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="approveModalLabel">Setujui Permintaan Penambahan Kecepatan</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <form id="approveForm">
                    <div class="modal-body">
                        <input type="hidden" id="approveRequestId" name="requestId">
                        <p>Anda akan menyetujui permintaan untuk pelanggan: <strong id="modalCustomerName"></strong>.</p>
                        <p>Paket akan diubah ke <strong id="modalRequestedPackage"></strong> untuk durasi <strong id="modalDuration"></strong> dengan harga <strong id="modalPrice"></strong>.</p>
                        <hr>
                         <div class="form-group">
                            <label for="notes">Catatan (Opsional)</label>
                            <textarea class="form-control" id="notes" name="notes" rows="2"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                        <button type="submit" class="btn btn-success"><i class="fas fa-check"></i> Ya, Setujui</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script src="<?= rafAssetUrl('/js/speed-requests.js') ?>"></script>

</body>
</html>
