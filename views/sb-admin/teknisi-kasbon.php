<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Kasbon Teknisi';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
    ?>
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/teknisi-kasbon.css') ?>" rel="stylesheet">

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
                            <span class="tk-title-icon"><i class="fas fa-hand-holding-usd"></i></span>
                            <div>
                                <h1>Kasbon Teknisi</h1>
                                <p class="tk-subtitle">Ajukan dan pantau status pinjaman kasbon Anda</p>
                            </div>
                        </div>
                        <div class="tk-actions">
                            <button class="btn btn-primary btn-sm" id="refreshBtn">
                                <i class="fas fa-sync-alt"></i> Refresh Data
                            </button>
                        </div>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row tk-stats-row mb-4">
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card tk-stat tk-accent-warning shadow">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Menunggu Approval</div>
                                        <div class="tk-stat-value" id="pendingAmount">Rp 0</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-clock"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card tk-stat tk-accent-success shadow">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Saldo Hutang Aktif</div>
                                        <div class="tk-stat-value" id="approvedAmount">Rp 0</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-check"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card tk-stat tk-accent-info shadow">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Total Cicilan/Lunas</div>
                                        <div class="tk-stat-value" id="paidAmount">Rp 0</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-check-double"></i></div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card tk-stat tk-accent-primary shadow">
                                <div class="card-body">
                                    <div>
                                        <div class="tk-stat-label">Total Pengajuan</div>
                                        <div class="tk-stat-value" id="totalKasbon">0</div>
                                    </div>
                                    <div class="tk-stat-icon"><i class="fas fa-list"></i></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Form Pengajuan Kasbon -->
                    <div class="card shadow mb-4">
                        <div class="card-header">
                            <h6 class="m-0"><i class="fas fa-plus-circle"></i> Ajukan Kasbon Baru</h6>
                        </div>
                        <div class="card-body">
                            <form id="kasbonForm">
                                <div class="row">
                                    <div class="col-lg-7">
                                        <div class="form-group">
                                            <label for="kasbonAmount">Nominal Kasbon</label>
                                            <div class="input-group tk-amount-group">
                                                <div class="input-group-prepend">
                                                    <span class="input-group-text">Rp</span>
                                                </div>
                                                <input type="number" class="form-control amount-input" id="kasbonAmount"
                                                       placeholder="0" min="1000" max="10000000" required>
                                            </div>
                                            <div class="tk-chip-row">
                                                <button type="button" class="tk-chip" onclick="setKasbonAmount(100000)">+ Rp 100rb</button>
                                                <button type="button" class="tk-chip" onclick="setKasbonAmount(250000)">+ Rp 250rb</button>
                                                <button type="button" class="tk-chip" onclick="setKasbonAmount(500000)">+ Rp 500rb</button>
                                                <button type="button" class="tk-chip" onclick="setKasbonAmount(1000000)">+ Rp 1jt</button>
                                                <button type="button" class="tk-chip" onclick="setKasbonAmount(0)">Reset</button>
                                            </div>
                                            <small class="form-text text-muted">Minimal Rp 1.000 &middot; Maksimal Rp 10.000.000</small>
                                        </div>
                                        <div class="form-group mb-lg-0">
                                            <label for="kasbonDescription">Keterangan <span class="text-muted font-weight-normal">(opsional)</span></label>
                                            <input type="text" class="form-control" id="kasbonDescription"
                                                   placeholder="Contoh: Keperluan operasional lapangan" maxlength="200">
                                        </div>
                                    </div>
                                    <div class="col-lg-5 mt-3 mt-lg-0">
                                        <div class="tk-preview-box">
                                            <span class="tk-preview-label">Jumlah Diajukan</span>
                                            <div class="amount-preview" id="amountPreview">Rp 0</div>
                                            <button type="submit" class="btn btn-success btn-block" id="submitKasbonBtn">
                                                <i class="fas fa-paper-plane"></i> Ajukan Kasbon
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>

                    <!-- Data Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-history"></i> Riwayat Kasbon</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="kasbonTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Tanggal</th>
                                            <th>Nominal</th>
                                            <th>Keterangan</th>
                                            <th>Status</th>
                                            <th>Catatan Admin</th>
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

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Konfirmasi Logout</h5>
                    <button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">Apakah Anda yakin ingin logout?</div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <a href="/logout" class="btn btn-primary">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Cancel Confirmation Modal -->
    <div class="modal fade" id="cancelModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title"><i class="fas fa-times-circle"></i> Batalkan Kasbon</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <p>Apakah Anda yakin ingin membatalkan pengajuan kasbon ini?</p>
                    <p><strong>ID:</strong> <span id="cancelKasbonId"></span></p>
                    <p><strong>Nominal:</strong> <span id="cancelKasbonAmount"></span></p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tidak</button>
                    <button type="button" class="btn btn-danger" id="confirmCancelBtn">Ya, Batalkan</button>
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

    <script src="<?= rafAssetUrl('/js/teknisi-kasbon.js') ?>"></script>

</body>
</html>
