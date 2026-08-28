<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Kompensasi Peningkatan Kecepatan';
    $themeRole = 'admin';
    $pageDescription = 'Halaman Kompensasi Pelanggan';
    include __DIR__ . '/_head.php';
    ?>

    <link href="<?= rafAssetUrl('/css/kompensasi.css') ?>" rel="stylesheet">

</head>

<body id="page-top">
    <div id="wrapper">
    <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>
                <div class="container-fluid">
                    <div class="dashboard-header">
                        <h1>Kompensasi Peningkatan Kecepatan</h1>
                        <p>Kelola kompensasi pelanggan dengan peningkatan kecepatan sementara</p>
                    </div>
                    
                    <h4 class="dashboard-section-title">Input Data Kompensasi</h4>
                    <div class="card table-card mb-4">
                        <div class="card-header">
                            <h6>Form Kompensasi</h6>
                        </div>
                        <div class="card-body">
                            <form id="compensationForm">
                                <div class="form-group">
                                    <label for="customerSearch">Cari Pelanggan (Nama, ID, atau Username PPPoE):</label>
                                    <div class="input-group">
                                        <input type="text" class="form-control" id="customerSearch" placeholder="Ketik untuk mencari...">
                                        <div class="input-group-append">
                                            <button class="btn btn-primary" type="button" onclick="searchCustomer()">
                                                <i class="fas fa-search fa-sm"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div id="customerSearchResults" class="mb-3 customer-search-results"></div>
                                <div class="form-group">
                                    <label>Pelanggan Dipilih:</label>
                                    <div id="selectedCustomers" class="selected-customers-list">
                                        <small class="text-muted">Belum ada pelanggan dipilih.</small>
                                    </div>
                                </div>
                                <hr>
                                <div class="form-group">
                                    <label for="speedProfile">Pilih Profil Kecepatan Baru (Kompensasi):</label>
                                    <select class="form-control" id="speedProfile" name="speedProfile" required>
                                        <option value="">Memuat profil...</option>
                                    </select>
                                </div>

                                <label>Durasi Peningkatan Kecepatan:</label>
                <div class="duration-input-group mb-3">
                    <div class="form-group mb-0">
                        <label for="durationDays">Hari:</label>
                        <select class="form-control" id="durationDays" name="durationDays">
                            <option value="0">0 Hari</option>
                            <option value="1">1 Hari</option>
                            <option value="2">2 Hari</option>
                            <option value="3">3 Hari</option>
                            <option value="5">5 Hari</option>
                            <option value="7" selected>7 Hari</option>
                            <option value="14">14 Hari</option>
                            <option value="30">30 Hari</option>
                        </select>
                    </div>
                    <div class="form-group mb-0">
                        <label for="durationHours">Jam:</label>
                        <select class="form-control" id="durationHours" name="durationHours">
                            <option value="0" selected>0 Jam</option>
                            <option value="1">1 Jam</option>
                            <option value="2">2 Jam</option>
                            <option value="3">3 Jam</option>
                            <option value="4">4 Jam</option>
                            <option value="5">5 Jam</option>
                            <option value="6">6 Jam</option>
                            <option value="8">8 Jam</option>
                            <option value="12">12 Jam</option>
                            <option value="18">18 Jam</option>
                            <option value="23">23 Jam</option>
                        </select>
                    </div>
                    <div class="form-group mb-0">
                        <label for="durationMinutes">Menit (untuk ujicoba):</label>
                        <select class="form-control" id="durationMinutes" name="durationMinutes">
                            <option value="0" selected>0 Menit</option>
                            <option value="1">1 Menit</option>
                            <option value="2">2 Menit</option>
                            <option value="3">3 Menit</option>
                            <option value="5">5 Menit</option>
                            <option value="10">10 Menit</option>
                            <option value="15">15 Menit</option>
                            <option value="20">20 Menit</option>
                            <option value="30">30 Menit</option>
                            <option value="45">45 Menit</option>
                            <option value="50">50 Menit</option>
                            <option value="55">55 Menit</option>
                        </select>
                    </div>
                </div>
                                <div class="form-group">
                                    <label for="notes">Catatan (Opsional):</label>
                                    <textarea class="form-control" id="notes" name="notes" rows="3" placeholder="Tambahkan catatan jika perlu, misal alasan kompensasi"></textarea>
                                </div>
                                <button type="submit" class="btn btn-success btn-icon-split">
                                    <span class="icon text-white-50">
                                        <i class="fas fa-check"></i>
                                    </span>
                                    <span class="text">Proses Kompensasi</span>
                                </button>
                            </form>
                        </div>
                    </div>

                    <div class="card shadow mb-4">
                        <div class="card-header py-3 d-flex flex-row align-items-center justify-content-between">
                            <h6 class="m-0 font-weight-bold text-primary">Pelanggan Aktif Mendapatkan Kompensasi</h6>
                            <button class="btn btn-sm btn-primary btn-icon-split" onclick="loadActiveCompensations()">
                                <span class="icon text-white-50">
                                    <i class="fas fa-sync-alt"></i>
                                </span>
                                <span class="text">Refresh Daftar</span>
                            </button>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="activeCompensationsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Nama Pelanggan</th>
                                            <th>PPPoE</th>
                                            <th>Profil Asli</th>
                                            <th>Profil Kompensasi</th>
                                            <th>Durasi</th>
                                            <th>Berakhir Pada</th>
                                            <th>Catatan</th>
                                        </tr>
                                    </thead>
                                    <tbody id="activeCompensationsList">
                                        <tr><td colspan="7" class="text-center">Memuat data...</td></tr>
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

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
        aria-hidden="true">
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

    <div class="modal fade" id="resultModal" tabindex="-1" role="dialog" aria-labelledby="resultModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="resultModalLabel">Hasil Proses</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body modal-body-scrollable" id="resultModalBody">
                    </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="<?= rafAssetUrl('/js/kompensasi.js') ?>"></script>

</body>
</html>