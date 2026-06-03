<!DOCTYPE html>
<html lang="en">

<head>

    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="RAF BOT Network Assets Management - Premium Edition">
    <meta name="author" content="RAF BOT">

    <title>RAF BOT - Network Assets Management</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet"
        href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />

    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --success: #10b981;
            --info: #3b82f6;
            --warning: #f59e0b;
            --danger: #ef4444;
            --dark: #1f2937;
            --light: #f9fafb;
            --border-radius: 12px;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: #f3f4f6;
            min-height: 100vh;
        }

        #content-wrapper {
            background: #ffffff;
            min-height: 100vh;
        }

        .topbar {
            background: #ffffff !important;
            border-bottom: 1px solid #e5e7eb;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
        }

        .container-fluid {
            padding: 1.5rem;
        }

        /* Section Headers */
        .dashboard-header {
            margin-bottom: 2rem;
        }

        .dashboard-header h1 {
            font-size: 1.875rem;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 0.25rem;
        }

        .dashboard-header p {
            color: #6b7280;
            font-size: 0.95rem;
        }

        /* Modern Cards */
        .dashboard-card {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: var(--border-radius);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            overflow: hidden;
            position: relative;
        }

        .dashboard-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .dashboard-card .card-header {
            background: #ffffff;
            border-bottom: 1px solid #e5e7eb;
            padding: 1rem 1.25rem;
        }

        .dashboard-card .card-header h6 {
            font-weight: 600;
            font-size: 1rem;
            color: var(--dark);
            margin: 0;
        }

        .dashboard-card .card-body {
            padding: 1.25rem;
        }

        /* Modern Button */
        .btn-primary-custom {
            background: var(--primary);
            color: white !important;
            border: none;
            border-radius: 8px;
            padding: 10px 24px;
            font-weight: 600;
            font-size: 0.95rem;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
            transition: all 0.2s ease;
        }

        .btn-primary-custom:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
            color: white !important;
        }

        .btn-success-custom {
            background: var(--success);
            color: white !important;
            border: none;
            border-radius: 8px;
            padding: 8px 16px;
            font-weight: 600;
            font-size: 0.875rem;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
            transition: all 0.2s ease;
        }

        .btn-success-custom:hover {
            background: #059669;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
            color: white !important;
        }

        /* Filter Section */
        .filter-section {
            background: #f9fafb;
            border-radius: 8px;
            padding: 1rem;
            margin-top: 1rem;
            border: 1px solid #e5e7eb;
        }

        .filter-section label {
            font-size: 0.875rem;
            font-weight: 500;
            color: #4b5563;
            margin-bottom: 0.25rem;
        }

        .filter-section .form-control {
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 0.875rem;
            transition: border-color 0.2s ease;
        }

        .filter-section .form-control:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        /* Table Styling */
        .table {
            font-size: 0.875rem;
        }

        .table thead th {
            background: #f9fafb;
            border-bottom: 2px solid #e5e7eb;
            font-weight: 600;
            color: #374151;
            padding: 0.75rem;
        }

        .table tbody td {
            padding: 0.75rem;
            vertical-align: middle;
            color: #4b5563;
        }

        .table tbody tr:hover {
            background: #f9fafb;
        }

        /* Action Buttons in Table */
        .btn-action {
            padding: 0.375rem 0.75rem;
            font-size: 0.75rem;
            border-radius: 6px;
            font-weight: 500;
            transition: all 0.2s ease;
        }

        .btn-action.btn-info {
            background: var(--info);
            border: none;
            color: white;
        }

        .btn-action.btn-info:hover {
            background: #2563eb;
            transform: translateY(-1px);
        }

        .btn-action.btn-danger {
            background: var(--danger);
            border: none;
            color: white;
        }

        .btn-action.btn-danger:hover {
            background: #dc2626;
            transform: translateY(-1px);
        }

        /* Modal Styling */
        .modal-content {
            border: none;
            border-radius: var(--border-radius);
            box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        }

        .modal-header {
            background: #f9fafb;
            border-bottom: 1px solid #e5e7eb;
            border-radius: var(--border-radius) var(--border-radius) 0 0;
            padding: 1.25rem;
        }

        .modal-title {
            font-weight: 600;
            color: var(--dark);
        }

        .modal-body {
            padding: 1.5rem;
            max-height: calc(100vh - 200px);
            overflow-y: auto;
        }

        .modal-footer {
            background: #f9fafb;
            border-top: 1px solid #e5e7eb;
            padding: 1rem 1.25rem;
            border-radius: 0 0 var(--border-radius) var(--border-radius);
        }

        /* Form Controls in Modal */
        .form-group label {
            font-size: 0.875rem;
            font-weight: 500;
            color: #374151;
            margin-bottom: 0.375rem;
        }

        .form-control {
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 0.875rem;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .form-control:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        .form-control-sm {
            padding: 0.5rem 0.75rem;
            font-size: 0.875rem;
        }

        /* Map Styling */
        .map-in-modal {
            height: 280px;
            width: 100%;
            margin-bottom: 15px;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            overflow: hidden;
        }

        .leaflet-control-custom {
            background-color: white;
            border: 2px solid rgba(0,0,0,0.2);
            border-radius: 6px;
            width: 32px;
            height: 32px;
            line-height: 32px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .leaflet-control-custom:hover {
            background: var(--primary);
            border-color: var(--primary);
        }

        .leaflet-control-custom i {
            font-size: 16px;
            color: var(--primary);
        }

        .leaflet-control-custom:hover i {
            color: white;
        }

        /* Select2 Customization */
        .select2-container--bootstrap .select2-selection--single {
            height: calc(1.5em + 0.75rem + 2px) !important;
            padding: 0.375rem 0.75rem !important;
            border: 1px solid #d1d5db;
            border-radius: 6px;
        }

        .select2-container--bootstrap.select2-container--focus .select2-selection {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }

        .select2-dropdown {
            z-index: 1060;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        /* DataTables Customization */
        #assetsDataTable_wrapper .dataTables_length,
        #assetsDataTable_wrapper .dataTables_filter {
            margin-bottom: 1rem;
        }

        #assetsDataTable_wrapper .dataTables_length label,
        #assetsDataTable_wrapper .dataTables_filter label {
            font-size: 0.875rem;
            font-weight: 500;
            color: #4b5563;
        }

        #assetsDataTable_wrapper .dataTables_length select {
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 0.375rem 2rem 0.375rem 0.75rem;
            font-size: 0.875rem;
        }

        #assetsDataTable_wrapper .dataTables_filter input {
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 0.375rem 0.75rem;
            font-size: 0.875rem;
            margin-left: 0.5rem;
        }

        #assetsDataTable_wrapper .dataTables_filter input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
            outline: none;
        }

        .dataTables_paginate .pagination .page-link {
            border: 1px solid #d1d5db;
            color: #4b5563;
            font-size: 0.875rem;
            padding: 0.5rem 0.75rem;
            margin: 0 0.125rem;
            border-radius: 6px;
        }

        .dataTables_paginate .pagination .page-item.active .page-link {
            background: var(--primary);
            border-color: var(--primary);
            color: white;
        }

        .dataTables_paginate .pagination .page-link:hover {
            background: #f3f4f6;
            border-color: #d1d5db;
        }

        /* Alert Messages */
        .alert {
            border: none;
            border-radius: 8px;
            padding: 1rem;
            font-size: 0.875rem;
            font-weight: 500;
        }

        .alert-info {
            background: rgba(59, 130, 246, 0.1);
            color: #1e40af;
        }

        .alert-success {
            background: rgba(16, 185, 129, 0.1);
            color: #065f46;
        }

        .alert-warning {
            background: rgba(245, 158, 11, 0.1);
            color: #92400e;
        }

        .alert-danger {
            background: rgba(239, 68, 68, 0.1);
            color: #991b1b;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .dashboard-header h1 {
                font-size: 1.5rem;
            }

            .container-fluid {
                padding: 1rem;
            }

            .filter-section {
                padding: 0.75rem;
            }

            .modal-body {
                padding: 1rem;
            }
        }
    </style>
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
                                <h1>Network Assets Management</h1>
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
                                <table class="table table-bordered" id="assetsDataTable" width="100%" cellspacing="0">
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
                        <span>Copyright &copy; RAF BOT <script>document.write(new Date().getFullYear())</script></span>
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

    <script>
        // ===== PERBAIKAN DIMULAI DI SINI =====

        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
            console.warn("PERINGATAN: Halaman ini diakses melalui HTTP. Fitur geolokasi mungkin tidak berfungsi atau tidak meminta izin. Silakan gunakan HTTPS.");
        }

        let addAssetMapInstance = null;
        let editAssetMapInstance = null;
        let addAssetMarker = null;
        let editAssetMarker = null;
        let assetsDataTable = null;
        let allAssetsData = []; 
        let allOdcData = []; 

        function displayGlobalAssetMessage(message, type = 'info', duration = 5000) {
            const globalMessageDiv = $('#globalAssetMessage');
            globalMessageDiv.empty(); 
            globalMessageDiv.html(`<div class="alert alert-${type} alert-dismissible fade show" role="alert">${message}<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>`);
            if (duration > 0) {
                setTimeout(() => { globalMessageDiv.find('.alert').alert('close'); }, duration);
            }
        }
        
        function handleGeolocationError(error, contextMessage, displayTarget, fallbackLat, fallbackLng, mapUpdaterFn) {
            console.warn(`${contextMessage} - Error Code: ${error.code}, Message: ${error.message}`);
            let errorText = `<b>${contextMessage}</b><br/>`;
            switch(error.code) {
                case error.PERMISSION_DENIED: errorText += "IZIN LOKASI DITOLAK. Periksa izin di OS & Browser."; break;
                case error.POSITION_UNAVAILABLE: errorText += "INFORMASI LOKASI TIDAK TERSEDIA. Pastikan GPS aktif."; break;
                case error.TIMEOUT: errorText += "WAKTU PERMINTAAN LOKASI HABIS. Sinyal mungkin lemah."; break;
                default: errorText += `Kesalahan (Code: ${error.code || 'N/A'}). Cek koneksi & HTTPS.`; break;
            }
            if (fallbackLat && fallbackLng && mapUpdaterFn) {
                 errorText += "<br/>Menampilkan lokasi default.";
                 mapUpdaterFn(L.latLng(fallbackLat, fallbackLng), false);
            }
            displayTarget(errorText, 'danger', 20000);
        }

        function initializeModalMapAsset(mapId, latInputId, lngInputId, initialLat, initialLng, isEditMode = false) {
            let mapInstanceVar = (mapId === 'addAssetMap') ? addAssetMapInstance : editAssetMapInstance;
            let markerInstanceVar = (mapId === 'addAssetMap') ? addAssetMarker : editAssetMarker;

            const latInput = $(`#${latInputId}`);
            const lngInput = $(`#${lngInputId}`);

            if (mapInstanceVar) { mapInstanceVar.remove(); }
            mapInstanceVar = null; markerInstanceVar = null;

            let defaultLat = -7.24917; 
            let defaultLng = 112.75083; 
            let defaultZoom = 12;

            const viewLat = (initialLat && !isNaN(parseFloat(initialLat))) ? parseFloat(initialLat) : defaultLat;
            const viewLng = (initialLng && !isNaN(parseFloat(initialLng))) ? parseFloat(initialLng) : defaultLng;
            // Pastikan viewZoom tidak melebihi maxZoom (18 untuk satellite)
            const calculatedZoom = (initialLat && initialLng && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) ? 18 : defaultZoom;
            const viewZoom = Math.min(calculatedZoom, 18); // Maksimal 18 untuk mencegah error
            
            const osmMaxZoom = 22;
            const satelliteMaxZoom = 18; // Esri World Imagery hanya support sampai level 18

            const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: osmMaxZoom, attribution: '&copy; <a href="http://www.openstreetmap.org/copyright">OSM</a>' });
            const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
                maxZoom: satelliteMaxZoom,
                maxNativeZoom: 18, // Esri World Imagery hanya support sampai level 18
                attribution: 'Tiles &copy; Esri',
                errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' // Transparent 1x1 pixel
            });

            mapInstanceVar = L.map(mapId, { layers: [satelliteLayer], maxZoom: satelliteMaxZoom }).setView([viewLat, viewLng], viewZoom);
            
            L.control.layers({ "Satelit": satelliteLayer, "OpenStreetMap": osmLayer }, null, { collapsed: true, position: 'topright' }).addTo(mapInstanceVar);
            mapInstanceVar.on('baselayerchange', function(e) { mapInstanceVar.options.maxZoom = (e.name === "Satelit") ? satelliteMaxZoom : osmMaxZoom; });

            const geolocationOptions = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };

            function updateMarkerAndInputs(latlng, setView = false) {
                latInput.val(latlng.lat.toFixed(6));
                lngInput.val(latlng.lng.toFixed(6));
                if (!markerInstanceVar) {
                    markerInstanceVar = L.marker(latlng, { draggable: true }).addTo(mapInstanceVar);
                    if (mapId === 'addAssetMap') addAssetMarker = markerInstanceVar; else editAssetMarker = markerInstanceVar;
                    markerInstanceVar.on('dragend', function(event) {
                        const pos = event.target.getLatLng();
                        latInput.val(pos.lat.toFixed(6));
                        lngInput.val(pos.lng.toFixed(6));
                    });
                } else {
                    markerInstanceVar.setLatLng(latlng);
                }
                if (setView) { mapInstanceVar.setView(latlng, Math.max(mapInstanceVar.getZoom(), 16)); }
            }
            
            function processSuccessfulGeolocation(position, contextMessage, buttonContainer, originalIcon) {
                const userLat = position.coords.latitude;
                const userLng = position.coords.longitude;
                updateMarkerAndInputs(L.latLng(userLat, userLng), true);
                let accuracyMessage = `Lokasi GPS ditemukan (Akurasi: ${Math.round(position.coords.accuracy)}m).`;
                let accuracyType = "success";
                if (position.coords.accuracy > 1000) { accuracyMessage = `Akurasi lokasi sangat rendah (${Math.round(position.coords.accuracy)}m).`; accuracyType = "danger"; } 
                else if (position.coords.accuracy > 150) { accuracyMessage = `Akurasi lokasi sedang (${Math.round(position.coords.accuracy)}m).`; accuracyType = "warning"; }
                displayGlobalAssetMessage(accuracyMessage, accuracyType, 15000);
                if (buttonContainer && originalIcon) { buttonContainer.innerHTML = originalIcon; }
            }

            const GpsControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function (mapCtrl) {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
                    const originalIconHTML = '<i class="fas fa-map-marker-alt"></i>';
                    container.innerHTML = originalIconHTML; container.title = 'Dapatkan Lokasi GPS Saat Ini';
                    L.DomEvent.on(container, 'click', L.DomEvent.stopPropagation).on(container, 'click', L.DomEvent.preventDefault)
                        .on(container, 'click', function() {
                            container.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                            displayGlobalAssetMessage("Meminta lokasi GPS...", "info", 3000);
                            if (navigator.geolocation) {
                                navigator.geolocation.getCurrentPosition(
                                    (pos) => processSuccessfulGeolocation(pos, "Tombol GPS", container, originalIconHTML),
                                    (err) => { handleGeolocationError(err, "Gagal dari Tombol GPS", displayGlobalAssetMessage); container.innerHTML = originalIconHTML; },
                                    geolocationOptions
                                );
                            } else {
                                handleGeolocationError({code: -1, message: "Browser tidak dukung geolokasi."}, "Tombol GPS", displayGlobalAssetMessage); container.innerHTML = originalIconHTML;
                            }
                        });
                    return container;
                }
            });
            new GpsControl().addTo(mapInstanceVar);
            
            if (isEditMode) {
                if (initialLat && initialLng && !isNaN(parseFloat(initialLat)) && !isNaN(parseFloat(initialLng))) {
                    updateMarkerAndInputs(L.latLng(parseFloat(initialLat), parseFloat(initialLng))); 
                }
            } else { 
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => processSuccessfulGeolocation(pos, "Inisialisasi Peta"),
                        (err) => handleGeolocationError(err, "Inisialisasi Peta", displayGlobalAssetMessage, defaultLat, defaultLng, updateMarkerAndInputs),
                        geolocationOptions 
                    );
                } else {
                     handleGeolocationError({code: -1, message: "Browser tidak dukung geolokasi."}, "Inisialisasi Peta", displayGlobalAssetMessage, defaultLat, defaultLng, updateMarkerAndInputs);
                }
            }

            mapInstanceVar.on('click', function (e) { updateMarkerAndInputs(e.latlng); });
            
            if (mapId === 'addAssetMap') addAssetMapInstance = mapInstanceVar; else editAssetMapInstance = mapInstanceVar;
            
            const modalId = mapId === 'addAssetMap' ? '#addAssetModal' : '#editAssetModal';
            $(modalId).off('shown.bs.modal.mapfix').on('shown.bs.modal.mapfix', function() {
                 setTimeout(function () { if (mapInstanceVar) mapInstanceVar.invalidateSize(); }, 100);
            });
        }

        function handleAssetTypeChange(mode, typeValue) {
            const $capacityField = $(`#assetCapacity${mode}`);
            const $parentOdcGroup = $(`#parentOdcGroup${mode}`);
            const isAddMode = mode === 'Add';

            $parentOdcGroup.hide();
            
            if (typeValue === 'ODP') {
                $parentOdcGroup.show();
                // Set default ODP capacity only if it's currently a default ODC capacity or 0/empty
                if (isAddMode || $capacityField.val() == 144 || $capacityField.val() == 0 || !$capacityField.val()) {
                    $capacityField.val(8);
                }
                if (isAddMode) { loadParentOdcOptions(`parentOdcId${mode}`); }
            } else if (typeValue === 'ODC') {
                // Set default ODC capacity only if it's currently a default ODP capacity or 0/empty
                if (isAddMode || $capacityField.val() == 8 || $capacityField.val() == 0 || !$capacityField.val()) {
                    $capacityField.val(144);
                }
            } else { 
                if (isAddMode) $capacityField.val(0);
            }
        }
        
        /**
         * PERBAIKAN #2: Fungsi ini dirombak total untuk menampilkan kapasitas dan menonaktifkan ODC yang penuh.
         * Membutuhkan variabel global 'allAssetsData' untuk menghitung ODP yang terhubung.
         */
        function loadParentOdcOptions(selectElementId, selectedOdcId = null) {
            const $select = $(`#${selectElementId}`);
            $select.html('<option value="">Memuat ODC...</option>');

            if (allOdcData.length > 0) {
                $select.html('<option value="">Tidak ada induk ODC</option>'); 
                
                allOdcData.forEach(odc => {
                    const odcCapacity = parseInt(odc.capacity_ports) || 0;
                    // Kalkulasi jumlah ODP anak yang sudah terhubung ke ODC ini
                    const childOdpsCount = allAssetsData.filter(asset => asset.type === 'ODP' && String(asset.parent_odc_id) === String(odc.id)).length;
                    
                    const isFull = odcCapacity > 0 && childOdpsCount >= odcCapacity;
                    const statusText = isFull 
                        ? `(Penuh ${childOdpsCount}/${odcCapacity})` 
                        : `(${childOdpsCount}/${odcCapacity || 'N/A'})`;
                    
                    const displayText = `${odc.name} ${statusText}`;
                    
                    const option = new Option(displayText, odc.id);

                    // Nonaktifkan opsi jika ODC penuh, KECUALI jika itu adalah ODC yang sedang dipilih saat ini (untuk mode edit)
                    if (isFull && String(odc.id) !== String(selectedOdcId)) {
                        $(option).prop('disabled', true);
                    }
                    
                    $select.append(option);
                });
            } else {
                $select.html('<option value="" disabled>Tidak ada data ODC yang ditemukan</option>');
            }

            // Inisialisasi atau re-inisialisasi Select2
            if ($select.data('select2')) { $select.select2('destroy'); }
            $select.select2({ 
                theme: "bootstrap", 
                dropdownParent: $select.closest('.modal'), 
                placeholder: 'Pilih Induk ODC', 
                allowClear: true 
            });

            // Set nilai yang dipilih setelah Select2 diinisialisasi
            if (selectedOdcId) {
                $select.val(selectedOdcId).trigger('change.select2');
            } else {
                $select.val(null).trigger('change.select2');
            }
        }
        
        async function fetchAllAssetsAndInitialize() {
            try {
                const response = await $.ajax({ url: '/api/map/network-assets?_=' + new Date().getTime(), method: 'GET' });
                if (response.status === 200 && Array.isArray(response.data)) {
                    allAssetsData = response.data;
                    allOdcData = allAssetsData.filter(asset => asset.type === 'ODC').sort((a,b) => (a.name || "").localeCompare(b.name || ""));
                    
                    if (assetsDataTable) { assetsDataTable.destroy(); $('#assetsDataTable tbody').empty(); }

                    assetsDataTable = $('#assetsDataTable').DataTable({
                        data: allAssetsData,
                        columns: [
                            { data: 'id', width: '10%', className: 'text-monospace small'}, { data: 'name' },
                            { data: 'type', width: '5%', className: "text-center" }, { data: 'address', render: data => data || '-' },
                            { data: null, render: (data, type, row) => (row.latitude && row.longitude) ? `${parseFloat(row.latitude).toFixed(5)}, ${parseFloat(row.longitude).toFixed(5)}` : 'N/A' },
                            { data: 'capacity_ports', className: "text-center", width: '5%' },
                            { data: 'ports_used', className: "text-center", width: '5%', render: (data) => data != null ? data : 0 },
                            { data: 'parent_odc_id', render: function(data, type, row) {
                                if (row.type === 'ODP' && data) {
                                    const parentOdc = allOdcData.find(odc => String(odc.id) === String(data));
                                    return parentOdc ? `<span title="ID: ${parentOdc.id}">${parentOdc.name}</span>` : `ID: ${data} (Tidak Ditemukan)`;
                                } return '-';
                            }},
                            { data: null, orderable: false, searchable: false, width: '10%', className: "text-center", render: (data, type, row) => 
                                `<button class="btn btn-action btn-info btn-edit-asset" data-id="${row.id}" title="Edit"><i class="fas fa-edit"></i></button> <button class="btn btn-action btn-danger btn-delete-asset" data-id="${row.id}" data-name="${row.name}" title="Hapus"><i class="fas fa-trash"></i></button>`
                            }
                        ],
                        order: [[0, 'desc']], language: { search: "", searchPlaceholder: "Cari aset..." }
                    });
                    
                    $('#assetTypeFilter').select2({ theme: "bootstrap", minimumResultsForSearch: Infinity, width: '100%' });
                    const $parentOdcFilter = $('#parentOdcFilter');
                    $parentOdcFilter.html('<option value="">Semua ODC Induk</option>');
                    allOdcData.forEach(odc => $parentOdcFilter.append(`<option value="${odc.id}">${odc.name} (ID: ${odc.id})</option>`));
                    $parentOdcFilter.select2({ theme: "bootstrap", placeholder: 'Pilih Induk ODC', allowClear: true, width: '100%' });
                    $parentOdcFilter.prop('disabled', $('#assetTypeFilter').val() !== 'ODP').val(null).trigger('change.select2');
                } else { displayGlobalAssetMessage('Gagal memuat data aset: ' + (response.message || 'Format salah.'), 'warning'); }
            } catch (error) { displayGlobalAssetMessage('Error server: ' + (error.responseJSON?.message || error.statusText || error.message), 'danger'); }
        }

        function initializePage() {
            $.get('/api/me', data => { if (data.status === 200 && data.data) $('#adminUsername').text(data.data.username); })
             .fail(() => $('#adminUsername').text("Admin"));
            fetchAllAssetsAndInitialize();
        }
        
        $(document).ready(function () {
            initializePage();

            $('#addAssetModal').on('shown.bs.modal', function () {
                $('#addAssetForm')[0].reset(); $('#addFormStatus').html('');
                $('#assetTypeAdd').val("").trigger('change'); 
                initializeModalMapAsset('addAssetMap', 'assetLatitudeAdd', 'assetLongitudeAdd', null, null, false);
            });
            $('#assetTypeAdd, #assetTypeEdit').change(function() {
                const mode = $(this).attr('id').includes('Add') ? 'Add' : 'Edit';
                handleAssetTypeChange(mode, $(this).val());
            });
            
            $('#addAssetForm, #editAssetForm').submit(function (event) {
                event.preventDefault();
                const isEdit = this.id === 'editAssetForm';
                const mode = isEdit ? 'Edit' : 'Add';
                const assetId = isEdit ? $('#editAssetId').val() : null;

                const $statusDiv = $(`#${mode.toLowerCase()}FormStatus`).html('<div class="alert alert-info">Mengirim...</div>').show();
                const $submitBtn = $(this).find('button[type="submit"]').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');
                
                const lat = $(`#assetLatitude${mode}`).val(), lng = $(`#assetLongitude${mode}`).val();
                if (!lat || !lng || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) {
                    $statusDiv.html('<div class="alert alert-danger">Latitude & Longitude wajib valid dan ditandai di peta.</div>');
                    $submitBtn.prop('disabled', false).html(isEdit ? 'Simpan Perubahan' : 'Simpan Aset'); return;
                }
                
                const assetType = $(`#assetType${mode}`).val();
                const formData = { 
                    type: assetType, 
                    name: $(`#assetName${mode}`).val(), 
                    address: $(`#assetAddress${mode}`).val(),
                    capacity_ports: parseInt($(`#assetCapacity${mode}`).val()) || 0, 
                    notes: $(`#assetNotes${mode}`).val(), 
                    latitude: parseFloat(lat), 
                    longitude: parseFloat(lng),
                    parent_odc_id: assetType === 'ODP' ? ($(`#parentOdcId${mode}`).val() || null) : null
                };
                
                $.ajax({
                    url: isEdit ? `/api/map/network-assets/${assetId}` : '/api/map/network-assets',
                    method: isEdit ? 'PUT' : 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify(formData),
                    success: res => {
                        if (res.status === 200 || res.status === 201) {
                            $(`#${mode.toLowerCase()}AssetModal`).modal('hide');
                            displayGlobalAssetMessage(res.message || `Aset berhasil di${isEdit ? 'perbarui' : 'tambah'}.`, 'success');
                            fetchAllAssetsAndInitialize();
                        } else {
                            $statusDiv.html(`<div class="alert alert-warning">${res.message || 'Gagal.'}</div>`);
                        }
                    },
                    error: xhr => $statusDiv.html(`<div class="alert alert-danger">${xhr.responseJSON?.message || 'Terjadi kesalahan pada server.'}</div>`),
                    complete: () => $submitBtn.prop('disabled', false).html(isEdit ? 'Simpan Perubahan' : 'Simpan Aset')
                });
            });

            $('#assetsDataTable').on('click', '.btn-edit-asset', function () {
                const assetId = $(this).data('id');
                const assetData = allAssetsData.find(a => String(a.id) === String(assetId));
                if (assetData) {
                    $('#editAssetForm')[0].reset(); 
                    $('#editAssetId').val(assetData.id);
                    $('#assetTypeEdit').val(assetData.type); 
                    $('#assetNameEdit').val(assetData.name);
                    $('#assetAddressEdit').val(assetData.address || '');
                    $('#assetCapacityEdit').val(assetData.capacity_ports);
                    $('#assetNotesEdit').val(assetData.notes || '');
                    $('#assetLatitudeEdit').val(assetData.latitude || ''); 
                    $('#assetLongitudeEdit').val(assetData.longitude || '');
                    $('#assetPortsUsedOdpDisplayEdit').val(assetData.ports_used != null ? assetData.ports_used : 'N/A');
                    $('#assetPortsUsedDisplayEdit').val(assetData.ports_used != null ? assetData.ports_used : 'N/A');
                    
                    // Muat opsi ODC dengan data kapasitas terbaru
                    if (assetData.type === 'ODP') {
                        loadParentOdcOptions('parentOdcIdEdit', assetData.parent_odc_id || null);
                    }
                    
                    // ===== PERBAIKAN #1: MENGHINDARI BUG RESET KAPASITAS =====
                    // Logika .trigger('change') dihapus dan diganti dengan pengaturan UI manual
                    // untuk mencegah side effect yang tidak diinginkan (reset nilai kapasitas).
                    const $parentOdcGroup = $('#parentOdcGroupEdit');
                    const $portsUsedOdcGroup = $('#portsUsedDisplayGroupEdit');
                    const $portsUsedOdpGroup = $('#portsUsedDisplayOdpGroupEdit');

                    $parentOdcGroup.hide(); $portsUsedOdcGroup.hide(); $portsUsedOdpGroup.hide();

                    if (assetData.type === 'ODP') {
                        $parentOdcGroup.show();
                        $portsUsedOdpGroup.show();
                    } else if (assetData.type === 'ODC') {
                        $portsUsedOdcGroup.show();
                    }
                    // ===== PERBAIKAN #1 SELESAI =====

                    $('#editAssetModal').modal('show'); 
                    $('#editAssetModal').off('shown.bs.modal.editmapinit').on('shown.bs.modal.editmapinit', function() {
                        initializeModalMapAsset('editAssetMap', 'assetLatitudeEdit', 'assetLongitudeEdit', assetData.latitude, assetData.longitude, true);
                    });
                } else { displayGlobalAssetMessage('Data aset tidak ditemukan (ID: '+assetId+').', 'warning'); }
            });

            $('#assetsDataTable').on('click', '.btn-delete-asset', function () {
                const assetId = $(this).data('id'), assetName = $(this).data('name');
                if (confirm(`Yakin hapus aset "${assetName}" (ID: ${assetId})? Menghapus ODC akan melepaskan ODP anaknya.`)) {
                    $.ajax({ url: `/api/map/network-assets/${assetId}`, method: 'DELETE',
                        success: res => { if (res.status === 200) { displayGlobalAssetMessage(res.message || 'Aset dihapus.', 'success'); fetchAllAssetsAndInitialize(); } else displayGlobalAssetMessage(res.message || 'Gagal.', 'warning'); },
                        error: xhr => displayGlobalAssetMessage(xhr.responseJSON?.message || 'Error server.', 'danger')
                    });
                }
            });

            $('#assetTypeFilter').on('change', () => {
                if ($('#assetTypeFilter').val() === 'ODP') {
                    $('#parentOdcFilter').prop('disabled', false);
                } else {
                    $('#parentOdcFilter').val(null).prop('disabled', true);
                }
                $('#parentOdcFilter').trigger('change.select2'); // Re-render select2
                if(assetsDataTable) assetsDataTable.draw();
            });

            $('#parentOdcFilter').on('change', () => {
                 if(assetsDataTable) assetsDataTable.draw();
            });

            $('#clearAssetFilters').on('click', () => {
                 $('#assetTypeFilter').val("").trigger('change'); // Ini akan otomatis men-disable dan mereset filter ODC
            });

            $.fn.dataTable.ext.search.push(
                (settings, data, dataIndex) => {
                    if (settings.nTable.id !== 'assetsDataTable') return true;
                    const typeFilter = $('#assetTypeFilter').val(), odcFilter = $('#parentOdcFilter').val();
                    const row = allAssetsData[dataIndex]; if (!row) return false; 
                    
                    const typeMatch = !typeFilter || row.type === typeFilter;
                    let odcMatch = true;
                    if (typeFilter === 'ODP' && odcFilter) { 
                        odcMatch = (String(row.parent_odc_id) === String(odcFilter));
                    }
                    
                    return typeMatch && odcMatch;
                }
            );
        });
        
        // ===== PERBAIKAN SELESAI =====
    </script>
</body>
</html>