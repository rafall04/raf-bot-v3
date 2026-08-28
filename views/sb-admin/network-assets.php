<!DOCTYPE html>
<html lang="en">

<head>

    <?php
    $pageTitle = 'RAF BOT - Manajemen Aset Jaringan';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Network Assets Management - Premium Edition';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />

    <link href="/css/network-assets.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow-sm">
                    <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                        <i class="fa fa-bars"></i>
                    </button>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button"
                                data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                                <span class="mr-2 d-none d-lg-inline text-gray-600 small" id="adminUsername">Admin</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in"
                                aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                                    Logout
                                </a>
                            </div>
                        </li>
                    </ul>
                </nav>
                <div class="container-fluid">
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <h1>Manajemen Aset Jaringan</h1>
                                <p>Kelola aset jaringan ODC dan ODP</p>
                            </div>
                            <button data-toggle="modal" data-target="#addAssetModal" class="btn btn-success-custom">
                                <i class="fas fa-plus"></i> Tambah Aset
                            </button>
                        </div>
                    </div>

                    <div id="globalAssetMessage" class="mb-3"></div>

                    <div class="card dashboard-card mb-4">
                        <div class="card-header">
                            <div class="d-flex justify-content-between align-items-center">
                                <h6>Daftar Aset Jaringan</h6>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="filter-section mb-3">
                                <div class="row">
                                    <div class="col-md-4 mb-2 mb-md-0">
                                        <label for="assetTypeFilter">Filter Tipe Aset</label>
                                        <select id="assetTypeFilter" class="form-control" style="width: 100%;">
                                            <option value="">Semua Tipe</option>
                                            <option value="ODC">ODC</option>
                                            <option value="ODP">ODP</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4 mb-2 mb-md-0">
                                        <label for="parentOdcFilter">Filter Induk ODC (untuk ODP)</label>
                                        <select id="parentOdcFilter" class="form-control" style="width: 100%;" disabled>
                                            <option value="">Pilih Tipe ODP dulu</option>
                                        </select>
                                    </div>
                                    <div class="col-md-4 d-flex align-items-end">
                                        <button id="clearAssetFilters" class="btn btn-outline-secondary w-100">
                                            <i class="fas fa-times"></i> Bersihkan Filter
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-bordered tabel-tumpuk-hp" id="assetsDataTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama</th>
                                            <th>Tipe</th>
                                            <th>Alamat</th>
                                            <th>Koordinat</th>
                                            <th>Kapasitas</th>
                                            <th>Terpakai</th>
                                            <th>Induk ODC</th>
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
                    <div class="copyright text-center my-auto">
                        <!-- Dulu ada <script src=".../network-assets.js"> terselip DI DALAM span ini,
                             dimuat SEBELUM jQuery. Skrip #1 sempat mendeklarasikan binding `let` di
                             lingkup global lalu melempar `$ is not defined`; skrip #2 di bawah
                             kemudian gagal PARSE ("Identifier 'addAssetMapInstance' has already been
                             declared") sehingga tak pernah dieksekusi sama sekali — DataTable tak
                             pernah di-init, daftar ODC/ODP kosong, tombol & peta mati total.
                             Pemuatan yang benar ada satu, di akhir body setelah dependensinya. -->
                        <span>Copyright &copy; RAF NET <?php echo date('Y'); ?></span>
                    </div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
        aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
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

    <div class="modal fade" id="addAssetModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <form class="modal-content" id="addAssetForm">
                <div class="modal-header">
                    <h5 class="modal-title">Tambah Aset Jaringan Baru</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="row">
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="assetTypeAdd">Tipe Aset <span class="text-danger">*</span></label>
                                <select class="form-control form-control-sm" id="assetTypeAdd" name="type" required>
                                    <option value="">Pilih Tipe</option>
                                    <option value="ODC">ODC</option>
                                    <option value="ODP">ODP</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="assetNameAdd">Nama Aset <span class="text-danger">*</span></label>
                                <input type="text" class="form-control form-control-sm" id="assetNameAdd" name="name" required>
                            </div>
                            <div class="form-group">
                                <label for="assetCapacityAdd">Kapasitas Port <span class="text-danger">*</span></label>
                                <input type="number" class="form-control form-control-sm" id="assetCapacityAdd" name="capacity_ports" value="0" required min="0">
                            </div>
                            <div class="form-group" id="parentOdcGroupAdd" style="display: none;">
                                <label for="parentOdcIdAdd">Induk ODC (Untuk ODP)</label>
                                <select class="form-control form-control-sm select2-parent-odc" id="parentOdcIdAdd" name="parent_odc_id" style="width:100%;">
                                    <option value="">Tidak ada induk ODC</option>
                                </select>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="assetAddressAdd">Alamat/Deskripsi</label>
                                <textarea class="form-control form-control-sm" id="assetAddressAdd" name="address" rows="2"></textarea>
                            </div>
                            <div class="row">
                                <div class="col-sm-6 mb-2">
                                    <label for="assetLatitudeAdd">Latitude <span class="text-danger">*</span></label>
                                    <input type="number" step="any" class="form-control form-control-sm" id="assetLatitudeAdd" name="latitude" placeholder="Dari Peta" readonly required>
                                </div>
                                <div class="col-sm-6 mb-2">
                                    <label for="assetLongitudeAdd">Longitude <span class="text-danger">*</span></label>
                                    <input type="number" step="any" class="form-control form-control-sm" id="assetLongitudeAdd" name="longitude" placeholder="Dari Peta" readonly required>
                                </div>
                            </div>
                            <div id="addAssetMap" class="map-in-modal"></div>
                            <small class="form-text text-muted">Klik peta untuk menandai lokasi.</small>
                        </div>
                    </div>
                    <div class="form-group mt-2">
                        <label for="assetNotesAdd">Catatan Tambahan</label>
                        <textarea class="form-control form-control-sm" id="assetNotesAdd" name="notes" rows="2"></textarea>
                    </div>
                    <div id="addFormStatus" class="mt-3"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="submit" class="btn btn-primary">Simpan Aset</button>
                </div>
            </form>
        </div>
    </div>
    
    <div class="modal fade" id="editAssetModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <form class="modal-content" id="editAssetForm">
                <div class="modal-header">
                    <h5 class="modal-title">Edit Aset Jaringan</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="editAssetId" name="id_asset_to_edit">
                    <div class="row">
                        <div class="col-md-6">
                            <div class="form-group"><label for="assetTypeEdit" class="form-label">Tipe Aset <span class="text-danger">*</span></label><select class="form-control form-control-sm" id="assetTypeEdit" name="type" required><option value="">Pilih Tipe</option><option value="ODC">ODC</option><option value="ODP">ODP</option></select></div>
                            <div class="form-group"><label for="assetNameEdit" class="form-label">Nama Aset <span class="text-danger">*</span></label><input type="text" class="form-control form-control-sm" id="assetNameEdit" name="name" required></div>
                            <div class="form-group"><label for="assetCapacityEdit" class="form-label">Kapasitas Port <span class="text-danger">*</span></label><input type="number" class="form-control form-control-sm" id="assetCapacityEdit" name="capacity_ports" required min="0"></div>
                            <div class="form-group" id="portsUsedDisplayOdpGroupEdit" style="display: none;"><label class="form-label">Port Terpakai (ODP - dari Pelanggan)</label><input type="text" class="form-control form-control-sm" id="assetPortsUsedOdpDisplayEdit" readonly></div>
                            <div class="form-group" id="portsUsedDisplayGroupEdit" style="display: none;"><label class="form-label">Port Terpakai (ODC - dari ODP)</label><input type="text" class="form-control form-control-sm" id="assetPortsUsedDisplayEdit" readonly></div>
                            <div class="form-group" id="parentOdcGroupEdit" style="display: none;"><label for="parentOdcIdEdit" class="form-label">Induk ODC (Untuk ODP)</label><select class="form-control form-control-sm select2-parent-odc" id="parentOdcIdEdit" name="parent_odc_id" style="width:100%;"><option value="">Tidak ada induk ODC</option></select></div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-group"><label for="assetAddressEdit" class="form-label">Alamat/Deskripsi</label><textarea class="form-control form-control-sm" id="assetAddressEdit" name="address" rows="2"></textarea></div>
                            <div class="row">
                                <div class="col-sm-6 mb-2"><label for="assetLatitudeEdit" class="form-label">Latitude <span class="text-danger">*</span></label><input type="number" step="any" class="form-control form-control-sm" id="assetLatitudeEdit" name="latitude" placeholder="Dari Peta" readonly required></div>
                                <div class="col-sm-6 mb-2"><label for="assetLongitudeEdit" class="form-label">Longitude <span class="text-danger">*</span></label><input type="number" step="any" class="form-control form-control-sm" id="assetLongitudeEdit" name="longitude" placeholder="Dari Peta" readonly required></div>
                            </div>
                            <div id="editAssetMap" class="map-in-modal"></div><small class="form-text text-muted">Klik peta untuk menandai lokasi atau geser marker.</small>
                        </div>
                    </div>
                     <div class="form-group mt-2"><label for="assetNotesEdit" class="form-label">Catatan Tambahan</label><textarea class="form-control form-control-sm" id="assetNotesEdit" name="notes" rows="2"></textarea></div>
                    <div id="editFormStatus" class="mt-3"></div>
                </div>
                <div class="modal-footer"><button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button><button type="submit" class="btn btn-primary btn-sm">Simpan Perubahan</button></div>
            </form>
        </div>
    </div>
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

    <script src="<?= rafAssetUrl('/js/network-assets.js') ?>"></script>
</body>
</html>