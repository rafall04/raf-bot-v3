<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Diskon Pelanggan';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link href="<?= rafAssetUrl('/css/admin-diskon.css') ?>" rel="stylesheet">

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
                            <i class="fas fa-tags text-primary"></i> Diskon Pelanggan
                        </h1>
                        <button class="btn btn-primary btn-sm" id="refreshBtn">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>

                    <!-- Form Tambah Diskon -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                            <h6 class="m-0 font-weight-bold text-white"><i class="fas fa-plus-circle"></i> Tambah/Edit Diskon Pelanggan</h6>
                        </div>
                        <div class="card-body">
                            <form id="discountForm">
                                <div class="row">
                                    <div class="col-md-4">
                                        <div class="form-group">
                                            <label for="customerSelect">Pilih Pelanggan</label>
                                            <select id="customerSelect" class="form-control" required>
                                                <option value="">-- Pilih Pelanggan --</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="form-group">
                                            <label for="discountAmount">Diskon Nominal (Rp)</label>
                                            <input type="number" class="form-control" id="discountAmount" placeholder="Contoh: 75000" min="0">
                                            <small class="form-text text-muted">Masukkan jumlah potongan dalam Rupiah</small>
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="form-group">
                                            <label for="discountReason">Alasan Diskon</label>
                                            <input type="text" class="form-control" id="discountReason" placeholder="Contoh: Pelanggan setia">
                                        </div>
                                    </div>
                                    <div class="col-md-2">
                                        <div class="form-group">
                                            <label for="discountMonths">Periode (Bulan)</label>
                                            <select class="form-control" id="discountMonths">
                                                <option value="1">1 bulan</option>
                                                <option value="2">2 bulan</option>
                                                <option value="3">3 bulan</option>
                                                <option value="6">6 bulan</option>
                                                <option value="12">12 bulan</option>
                                            </select>
                                            <small class="form-text text-muted">Diskon berlaku berapa bulan</small>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Preview -->
                                <div id="discountPreview" class="alert alert-info" style="display: none;">
                                    <div class="row align-items-center">
                                        <div class="col-md-8">
                                            <strong id="previewName">-</strong> | Paket: <span id="previewPackage">-</span><br>
                                            <span class="price-original">Harga Normal: <span id="previewOriginal">Rp 0</span></span><br>
                                            <span class="price-final">Harga Setelah Diskon: <span id="previewFinal">Rp 0</span></span>
                                            <span class="discount-badge ml-2">Hemat <span id="previewSaving">Rp 0</span></span>
                                        </div>
                                        <div class="col-md-4 text-right">
                                            <button type="submit" class="btn btn-success" id="saveDiscountBtn">
                                                <i class="fas fa-save"></i> Simpan Diskon
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>

                    <!-- Daftar Pelanggan dengan Diskon -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-list"></i> Pelanggan dengan Diskon Aktif</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="discountTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama Pelanggan</th>
                                            <th>Paket</th>
                                            <th>Harga Normal</th>
                                            <th>Diskon</th>
                                            <th>Harga Final</th>
                                            <th>Alasan</th>
                                            <th>Sisa Periode</th>
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

    <!-- Delete Confirmation Modal -->
    <div class="modal fade" id="deleteModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title"><i class="fas fa-trash"></i> Hapus Diskon</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <p>Hapus diskon untuk pelanggan <strong id="deleteCustomerName"></strong>?</p>
                    <p>Pelanggan akan kembali membayar harga normal.</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-danger" id="confirmDeleteBtn">
                        <i class="fas fa-trash"></i> Ya, Hapus Diskon
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
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

    <script src="<?= rafAssetUrl('/js/admin-diskon.js') ?>"></script>

</body>
</html>
