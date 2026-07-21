<!--
Header Doc
- Purpose: Halaman admin untuk manajemen pelanggan, filter data, CRUD pelanggan, sinkronisasi profil, dan import/export Excel pelanggan.
- Caller: Router halaman admin web melalui render PHP Express.
- Deps: Bootstrap, jQuery, DataTables, Select2, Leaflet, SweetAlert, dan endpoint `/api/users*`, `/api/map/network-assets`, `/api/mikrotik/ppp-active-users`.
- MainFuncs: Menampilkan tabel pelanggan, modal create/edit, aksi bulk profil, sync MikroTik, serta UI preview/import/export Excel.
-->
<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Users Management';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Users Management';
    include __DIR__ . '/_head.php';
    ?>
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link href="/css/users.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
    <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>

                <div class="container-fluid">
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <h1>Manajemen Pelanggan</h1>
                                <p>Kelola data pelanggan dan layanan internet</p>
                            </div>
                            <div class="header-buttons">
                                <button id="refreshPppoeBtn" class="btn btn-info btn-sm" title="Refresh data PPPoE dari MikroTik">
                                    <i class="fas fa-sync-alt"></i> <span id="pppoeStatusText">Refresh PPPoE</span>
                                </button>
                                <button id="refreshDataBtn" class="btn btn-primary-custom btn-sm" disabled>
                                    <i class="fas fa-sync-alt"></i> <span>Refresh Data</span>
                                </button>
                                <a href="/api/users/excel/template" class="btn btn-outline-secondary btn-sm" title="Download template import Excel pelanggan">
                                    <i class="fas fa-file-download"></i> <span>Template Excel</span>
                                </a>
                                <a href="/api/users/excel/export" class="btn btn-sm" style="background: linear-gradient(135deg, #059669 0%, #047857 100%); color: white; border: none; border-radius: 8px;" title="Export data pelanggan ke Excel">
                                    <i class="fas fa-file-excel"></i> <span>Export Excel</span>
                                </a>
                                <button data-toggle="modal" data-target="#excelImportModal" class="btn btn-sm" style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white; border: none; border-radius: 8px;" title="Import data pelanggan dari Excel dengan preview validasi">
                                    <i class="fas fa-file-import"></i> <span>Import Excel</span>
                                </button>
                                <button data-toggle="modal" data-target="#bulkChangePackageModal" class="btn btn-sm" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px;" title="Rubah profil MikroTik untuk semua pelanggan dengan paket tertentu">
                                    <i class="fas fa-exchange-alt"></i> <span>Rubah Profil Massal</span>
                                </button>
                                <button data-toggle="modal" data-target="#syncProfileModal" class="btn btn-sm" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; border: none; border-radius: 8px;" title="Sinkronisasi profil dari sistem ke MikroTik">
                                    <i class="fas fa-sync"></i> <span>Sync Profil ke MikroTik</span>
                                </button>
                                <button data-toggle="modal" data-target="#createModal" class="btn btn-success-custom btn-sm">
                                    <i class="fas fa-user-plus"></i> <span>Tambah Pelanggan</span>
                                </button>
                                <a href="/migrate" class="btn btn-dark btn-sm" title="Migrasi database SQLite lama">
                                    <i class="fas fa-database"></i> Migrasi DB
                                </a>
                            </div>
                        </div>
                    </div>

                    <h4 class="dashboard-section-title">Filter Data</h4>
                    <div class="dashboard-card mb-4" style="height: auto;">
                        <div class="card-body">
                            <div class="row gx-2">
                                <div class="col-md-3 mb-3">
                                    <label for="odcFilterDropdown" class="form-label">Filter ODC</label>
                                    <select id="odcFilterDropdown" class="form-control form-control-sm" style="width: 100%;"></select>
                                </div>
                                <div class="col-md-3 mb-3">
                                    <label for="odpFilterDropdown" class="form-label">Filter ODP</label>
                                    <select id="odpFilterDropdown" class="form-control form-control-sm" style="width: 100%;"></select>
                                </div>
                                <div class="col-md-3 d-flex align-items-end mb-3">
                                    <button id="applyUserFilters" class="btn btn-primary-custom btn-sm w-100">
                                        <i class="fas fa-filter"></i> Terapkan Filter
                                    </button>
                                </div>
                                <div class="col-md-3 d-flex align-items-end mb-3">
                                    <button id="clearUserFilters" class="btn btn-outline-secondary btn-sm w-100" style="border-radius: 6px;">
                                        <i class="fas fa-times"></i> Bersihkan Filter
                                    </button>
                                </div>
                            </div>
                            <div class="d-flex justify-content-end">
                                <button data-toggle="modal" data-target="#deleteAllUsersModal" class="btn btn-sm" style="background: var(--danger); color: white; border-radius: 6px; padding: 0.375rem 0.75rem;">
                                    <i class="fas fa-trash-alt"></i> Delete All Users
                                </button>
                            </div>
                        </div>
                    </div>

                    <h4 class="dashboard-section-title">Daftar Pelanggan</h4>
                    <div class="dashboard-card" style="height: auto;">
                        <div class="card-body">
                            <div class="d-flex align-items-center mb-3 flex-wrap" id="accountTypeViewToggle" role="group">
                                <span class="mr-2 text-muted small">Tampilkan:</span>
                                <div class="btn-group btn-group-sm" role="group" aria-label="Filter jenis akun">
                                    <button type="button" class="btn btn-outline-primary active" data-view="pelanggan">Pelanggan</button>
                                    <button type="button" class="btn btn-outline-primary" data-view="infrastruktur">Infrastruktur/CCTV</button>
                                    <button type="button" class="btn btn-outline-primary" data-view="all">Semua</button>
                                </div>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-bordered table-sm" id="dataTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama</th>
                                            <th>Telepon</th>
                                            <th>Device ID</th>
                                            <th>Alamat</th>
                                            <th>Koordinat</th>
                                            <th>ODP Terhubung</th>
                                            <th>Paket</th>
                                            <th>Bayar</th>
                                            <th>PPPoE User</th>
                                            <th>Status</th>
                                            <th>IP Pelanggan</th>
                                            <th class="redaman-column">Redaman (dBm)</th>
                                            <th class="suhu-column">Suhu (°C)</th>
                                            <th class="tipe-router-column">Tipe Router</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white"><div class="container my-auto"><div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div></div></footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <div class="modal fade" id="logoutModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Ready to Leave?</h5><button class="close" type="button" data-dismiss="modal">&times;</button></div><div class="modal-body">Select "Logout" to end session.</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button><a class="btn btn-primary" href="/logout">Logout</a></div></div></div></div>

    <div class="modal fade" id="deleteAllUsersModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Delete All Users</h5>
                    <button class="close" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <p>This action will permanently delete all users. This cannot be undone.</p>
                    <p>Please enter your admin password to confirm.</p>
                    <form id="deleteAllUsersForm">
                        <div class="form-group">
                            <label for="adminPassword">Admin Password</label>
                            <input type="password" class="form-control" id="adminPassword" required>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <button class="btn btn-danger" id="confirmDeleteAllUsers">Delete All Users</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="excelImportModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header" style="background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: white;">
                    <h5 class="modal-title"><i class="fas fa-file-import"></i> Import Excel Pelanggan</h5>
                    <button class="close text-white" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> Gunakan template resmi untuk memastikan kolom sesuai.
                        <br><small class="text-muted">Langkah aman: upload file → klik Preview → periksa hasil validasi → klik Import ke Sistem jika semua baris valid.</small>
                    </div>

                    <div class="form-group">
                        <label for="excelImportFile"><strong>File Excel</strong></label>
                        <div class="custom-file">
                            <input type="file" class="custom-file-input" id="excelImportFile" accept=".xlsx,.xls">
                            <label class="custom-file-label" for="excelImportFile">Pilih file Excel...</label>
                        </div>
                        <small class="form-text text-muted">Format yang didukung: `.xlsx` dan `.xls`, ukuran maksimal 5 MB.</small>
                    </div>

                    <div id="excelImportResult" class="mt-3" style="display: none;"></div>
                </div>
                <div class="modal-footer">
                    <a href="/api/users/excel/template" class="btn btn-outline-secondary btn-sm">
                        <i class="fas fa-download"></i> Download Template
                    </a>
                    <button class="btn btn-info btn-sm" type="button" id="previewExcelImportBtn">
                        <i class="fas fa-search"></i> Preview
                    </button>
                    <button class="btn btn-success btn-sm" type="button" id="commitExcelImportBtn" disabled>
                        <i class="fas fa-check"></i> Import ke Sistem
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Bulk Change Profile Modal -->
    <div class="modal fade" id="bulkChangePackageModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                    <h5 class="modal-title"><i class="fas fa-exchange-alt"></i> Rubah Profil MikroTik Massal</h5>
                    <button class="close text-white" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-info">
                        <i class="fas fa-info-circle"></i> Fitur ini akan mengubah <strong>profil PPPoE di MikroTik</strong> untuk semua pelanggan dengan paket tertentu. 
                        <br><small class="text-muted"><i class="fas fa-sync-alt"></i> Profil di konfigurasi paket (packages.json) juga akan otomatis diperbarui agar sinkron.</small>
                    </div>
                    
                    <div class="row">
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="bulk-from-package"><strong>Pilih Paket Pelanggan:</strong></label>
                                <select class="form-control" id="bulk-from-package" required>
                                    <option value="">-- Pilih Paket --</option>
                                </select>
                                <small class="form-text text-muted">Semua pelanggan dengan paket ini akan diubah profilnya</small>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-group">
                                <label for="bulk-to-profile"><strong>Profil MikroTik Baru:</strong></label>
                                <select class="form-control" id="bulk-to-profile" required>
                                    <option value="">-- Pilih Profil --</option>
                                </select>
                                <small class="form-text text-muted">Profil PPPoE yang akan diterapkan di MikroTik</small>
                            </div>
                        </div>
                    </div>
                    
                    <hr>
                    
                    <div id="bulk-preview-section" style="display: none;">
                        <h6><i class="fas fa-users"></i> Preview Pelanggan yang Akan Diubah:</h6>
                        <div class="table-responsive" style="max-height: 300px; overflow-y: auto;">
                            <table class="table table-sm table-bordered" id="bulk-preview-table">
                                <thead class="thead-light">
                                    <tr>
                                        <th>ID</th>
                                        <th>Nama</th>
                                        <th>PPPoE Username</th>
                                        <th>Paket</th>
                                    </tr>
                                </thead>
                                <tbody></tbody>
                            </table>
                        </div>
                        <p class="mt-2"><strong>Total: <span id="bulk-affected-count">0</span> pelanggan</strong></p>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-info" type="button" id="bulk-preview-btn">
                        <i class="fas fa-eye"></i> Preview
                    </button>
                    <button class="btn" type="button" id="bulk-execute-btn" disabled style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none;">
                        <i class="fas fa-check"></i> Terapkan Perubahan
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Sync Profile to MikroTik Modal -->
    <div class="modal fade" id="syncProfileModal" tabindex="-1">
        <div class="modal-dialog modal-xl">
            <div class="modal-content">
                <div class="modal-header" style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white;">
                    <h5 class="modal-title"><i class="fas fa-sync"></i> Sinkronisasi Profil ke MikroTik</h5>
                    <button class="close text-white" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-warning">
                        <i class="fas fa-exclamation-triangle"></i> Fitur ini akan menyinkronkan <strong>profil PPPoE di MikroTik</strong> agar sesuai dengan data paket di sistem.
                        <br><small class="text-muted">Gunakan jika profil di sistem sudah diupdate tapi MikroTik belum.</small>
                    </div>
                    
                    <div class="mb-3">
                        <button class="btn btn-primary" type="button" id="scanProfileDiff" onclick="scanProfileDifferences()">
                            <i class="fas fa-search"></i> Scan Perbedaan Profil
                        </button>
                        <span id="syncScanStatus" class="ml-2 text-muted"></span>
                    </div>
                    
                    <div id="syncProfileResult" style="display: none;">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                            <h6 class="mb-0"><i class="fas fa-list"></i> Pelanggan dengan Profil Berbeda:</h6>
                            <div>
                                <button class="btn btn-sm btn-outline-primary" onclick="selectAllSyncRows()">Pilih Semua</button>
                                <button class="btn btn-sm btn-outline-secondary" onclick="deselectAllSyncRows()">Batal Pilih</button>
                            </div>
                        </div>
                        
                        <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                            <table class="table table-sm table-bordered table-hover" id="syncProfileTable">
                                <thead class="thead-light" style="position: sticky; top: 0;">
                                    <tr>
                                        <th width="40"><input type="checkbox" id="syncCheckAll" onchange="toggleSyncCheckAll()"></th>
                                        <th>Nama</th>
                                        <th>PPPoE Username</th>
                                        <th>Paket Sistem</th>
                                        <th>Profil Sistem</th>
                                        <th>Profil MikroTik</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody id="syncProfileTableBody">
                                    <tr><td colspan="7" class="text-center text-muted py-4">Klik "Scan Perbedaan Profil" untuk memulai</td></tr>
                                </tbody>
                            </table>
                        </div>
                        
                        <div class="mt-3 p-3 bg-light rounded">
                            <div class="row">
                                <div class="col-md-4">
                                    <strong>Total Berbeda:</strong> <span id="syncTotalDiff" class="badge badge-warning">0</span>
                                </div>
                                <div class="col-md-4">
                                    <strong>Dipilih:</strong> <span id="syncSelectedCount" class="badge badge-primary">0</span>
                                </div>
                                <div class="col-md-4">
                                    <strong>Sudah Sama:</strong> <span id="syncTotalSame" class="badge badge-success">0</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Tutup</button>
                    <button class="btn" type="button" id="executeSyncBtn" onclick="executeSyncProfiles()" disabled style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; border: none;">
                        <i class="fas fa-sync"></i> Sinkronkan (<span id="syncBtnCount">0</span> Pelanggan)
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="createModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <form class="modal-content" id="createUserForm">
                <div class="modal-header"><h5 class="modal-title">Tambah Pelanggan Baru</h5><button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button></div>
                <div class="modal-body">
                    <!-- Mode Selection -->
                    <div class="alert alert-light border mb-3">
                        <label class="form-label mb-2"><strong><i class="fas fa-cog"></i> Mode Registrasi</strong></label>
                        <div class="d-flex flex-wrap" style="gap: 1rem;">
                            <div class="form-check">
                                <input class="form-check-input" type="radio" name="registration_mode" id="mode_new" value="new" checked>
                                <label class="form-check-label" for="mode_new">
                                    <i class="fas fa-user-plus text-success"></i> Registrasi Baru <small class="text-muted">(Full Setup)</small>
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="radio" name="registration_mode" id="mode_import" value="import">
                                <label class="form-check-label" for="mode_import">
                                    <i class="fas fa-file-import text-info"></i> Import Existing <small class="text-muted">(Dari MikroTik)</small>
                                </label>
                            </div>
                        </div>
                        <small class="form-text text-muted mt-1" id="mode_description">
                            <i class="fas fa-info-circle"></i> Registrasi baru: Setup device, WiFi, dan PPPoE dari awal.
                        </small>
                    </div>

                    <div class="row">
                        <div class="col-md-6">
                            <div class="mb-3"><label for="create_name" class="form-label">Nama <span class="text-danger">*</span></label><input type="text" class="form-control form-control-sm" id="create_name" name="name" required/></div>
                            <div class="mb-3">
                                <div class="d-flex justify-content-between align-items-center">
                                    <h6>Nomor Telepon</h6>
                                    <button class="btn btn-primary btn-sm py-0 px-1" type="button" onclick="addNumberField('create_number_container')" title="Tambah Nomor HP"><i class="fas fa-plus"></i></button>
                                </div>
                                <div id="create_number_container" class="mt-1 d-flex flex-column" style="gap: 0.25rem;"></div>
                                <small class="form-text text-muted d-block mt-2">
                                    Maksimal <span class="max-phone-limit-display">3</span> nomor sesuai konfigurasi.
                                </small>
                            </div>
                            
                            <!-- Device ID Section - Mode New -->
                            <div class="mb-3" id="device_section_new">
                                <label class="form-label">Cari Device <span class="text-danger">*</span></label>
                                
                                <!-- Filter Options -->
                                <div class="mb-2">
                                    <div class="btn-group btn-group-sm" role="group" id="device-filter-group">
                                        <input type="radio" class="btn-check" name="device-filter" id="filter-default" value="default" checked>
                                <label class="btn btn-outline-primary" for="filter-default" title="Device dengan username 'tes@hw'">
                                            <i class="fas fa-filter"></i> Default
                                        </label>
                                        
                                        <input type="radio" class="btn-check" name="device-filter" id="filter-new" value="new">
                                        <label class="btn btn-outline-primary" for="filter-new" title="Device baru (< 1 hari)">
                                            <i class="fas fa-clock"></i> Baru
                                        </label>
                                        
                                        <input type="radio" class="btn-check" name="device-filter" id="filter-by-sn" value="by-sn">
                                        <label class="btn btn-outline-primary" for="filter-by-sn" title="Filter berdasarkan Serial Number">
                                            <i class="fas fa-barcode"></i> By SN
                                        </label>
                                        
                                        <input type="radio" class="btn-check" name="device-filter" id="filter-by-pppoe" value="by-pppoe">
                                        <label class="btn btn-outline-primary" for="filter-by-pppoe" title="Cari berdasarkan PPPoE Username">
                                            <i class="fas fa-user"></i> By PPPoE
                                        </label>
                                    </div>
                                </div>
                                
                                <!-- Search Input -->
                                <div class="input-group input-group-sm mb-2">
                                    <input type="text" class="form-control" id="create_device_search" placeholder="Masukkan Serial Number..." autocomplete="off">
                                    <div class="input-group-append">
                                        <button class="btn btn-primary" type="button" id="search_device_btn">
                                            <i class="fas fa-search"></i> Cari
                                        </button>
                                        <button class="btn btn-outline-secondary" type="button" id="clear_device_search_btn" title="Hapus pencarian">
                                            <i class="fas fa-times"></i>
                                        </button>
                                    </div>
                                </div>
                                <small class="form-text text-muted mb-2" id="device_search_hint">
                                    <i class="fas fa-info-circle"></i> Pilih filter dan masukkan kata kunci untuk mencari device.
                                </small>
                                
                                <!-- Device Select -->
                                <select class="form-control form-control-sm" id="create_device_select" style="display: none;">
                                    <option value="">-- Pilih Device --</option>
                                </select>
                                <small class="form-text text-muted" id="device_count_display" style="display: none;"></small>
                                <input type="hidden" id="create_device_id" name="device_id" />
                                <div id="device_info_display" class="mt-2"></div>
                            </div>

                            <!-- Device ID Section - Mode Import (simpler) -->
                            <div class="mb-3" id="device_section_import" style="display: none;">
                                <label for="create_device_id_import" class="form-label">Device ID <small class="text-muted">(Opsional)</small></label>
                                <input type="text" class="form-control form-control-sm" id="create_device_id_import" placeholder="Masukkan Device ID jika ada" />
                            </div>

                            <div class="mb-3"><label for="create_subscription" class="form-label">Paket Langganan <span class="text-danger">*</span></label><select name="subscription" id="create_subscription" class="form-control form-control-sm" required><option value="">-- Pilih Paket --</option></select></div>
                            <div class="mb-3">
                                <label for="create_connected_odc" class="form-label">ODC Induk</label>
                                <select id="create_connected_odc" class="form-control form-control-sm select2-odc-filter" style="width: 100%;"><option value="">-- Pilih ODC --</option></select>
                            </div>
                            <div class="mb-3">
                                <label for="create_connected_odp" class="form-label">ODP Terhubung</label>
                                <select name="connected_odp_id" id="create_connected_odp" class="form-control form-control-sm select2-odp" style="width: 100%;" disabled><option value="">-- Pilih ODC Dahulu --</option></select>
                            </div>
                            <div class="mb-3"><div class="form-check"><input type="checkbox" class="form-check-input" name="paid" id="create_paid"><label for="create_paid" class="form-check-label">Sudah membayar</label></div></div>
                            <div class="mb-3"><div class="form-check"><input type="checkbox" class="form-check-input" name="free_first_month" id="create_free_first_month"><label for="create_free_first_month" class="form-check-label">Bebaskan tagihan bulan ini (pelanggan baru &mdash; mulai bayar bulan depan)</label></div><small class="form-text text-muted">Bulan pendaftaran ditandai GRATIS (kebal isolir, tak dihitung pemasukan). Diabaikan bila &quot;Sudah membayar&quot; dicentang.</small></div>
                            <div class="mb-3"><div class="form-check"><input type="checkbox" class="form-check-input" name="send_invoice" id="create_send_invoice"><label for="create_send_invoice" class="form-check-label">Kirim Invoice PDF</label></div></div>
                            <div class="mb-3"><div class="form-check"><input type="checkbox" class="form-check-input" name="notify_outage" id="create_notify_outage" checked><label for="create_notify_outage" class="form-check-label">Terima info gangguan (GAMAS)</label></div></div>
                            <div class="mb-3"><label for="create_account_type" class="form-label">Jenis Akun</label><select class="form-control form-control-sm" name="account_type" id="create_account_type"><option value="pelanggan" selected>Pelanggan</option><option value="infrastruktur">Infrastruktur (CCTV/Monitoring)</option></select><small class="form-text text-muted">Akun infrastruktur disembunyikan dari data pelanggan &amp; kebal isolir/tagihan, tetapi tetap terbaca di monitor OLT.</small></div>
                        </div>
                        <div class="col-md-6">
                            <div class="mb-3"><label for="create_dusun" class="form-label">Dusun</label><input type="text" class="form-control form-control-sm" id="create_dusun" name="dusun" placeholder="mis. Ngitik"><small class="form-text text-muted">Dipakai mengelompokkan pelanggan (broadcast per dusun, gangguan area, pemetaan ODP).</small></div>
                            <div class="mb-3"><label for="create_address" class="form-label">Alamat</label><textarea class="form-control form-control-sm" id="create_address" name="address" rows="2"></textarea></div>
                            <div class="row"><div class="col-sm-6 mb-2"><label for="create_latitude" class="form-label">Latitude</label><input type="number" step="any" class="form-control form-control-sm" id="create_latitude" name="latitude" placeholder="Dari Peta"></div><div class="col-sm-6 mb-2"><label for="create_longitude" class="form-label">Longitude</label><input type="number" step="any" class="form-control form-control-sm" id="create_longitude" name="longitude" placeholder="Dari Peta"></div></div>
                            <div id="createUserMap" class="map-in-modal"></div><small class="form-text text-muted">Klik peta untuk menandai lokasi atau gunakan tombol GPS <i class="fas fa-map-marker-alt"></i>.</small>
                        </div>
                    </div>
                    
                    <hr class="my-2">
                    
                    <!-- WiFi Configuration - Mode New Only -->
                    <div id="wifi_config_section">
                        <h6 class="mb-3"><i class="fas fa-wifi text-primary"></i> Konfigurasi WiFi</h6>
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label for="create_wifi_ssid" class="form-label">Nama WiFi (SSID) <span class="text-danger">*</span></label>
                                <input type="text" class="form-control form-control-sm" id="create_wifi_ssid" placeholder="Nama_WiFi_Pelanggan" />
                            </div>
                            <div class="col-md-6 mb-3">
                                <label for="create_wifi_password" class="form-label">Password WiFi <span class="text-danger">*</span></label>
                                <input type="text" class="form-control form-control-sm" id="create_wifi_password" placeholder="password_wifi" />
                            </div>
                        </div>
                        <div id="ssid_checkbox_container" class="mb-3" style="display: none;">
                            <label class="form-label small">Pilih SSID yang akan dikonfigurasi:</label>
                            <div id="ssid_checkboxes" class="border rounded p-2 bg-light"></div>
                        </div>
                    </div>
                    
                    <!-- PPPoE Section - Mode New -->
                    <div id="pppoe_section_new">
                        <h6 class="mb-3"><i class="fas fa-network-wired text-success"></i> Konfigurasi PPPoE</h6>
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label for="create_pppoe_username" class="form-label">PPPoE Username <span class="text-danger">*</span></label>
                                <div class="input-group input-group-sm">
                                    <input type="text" class="form-control" id="create_pppoe_username" name="pppoe_username" placeholder="pelanggan001" />
                                    <div class="input-group-append">
                                        <span class="input-group-text" id="pppoe_username_status"></span>
                                    </div>
                                </div>
                                <small class="form-text" id="pppoe_username_feedback"></small>
                            </div>
                            <div class="col-md-6 mb-3">
                                <label for="create_pppoe_password" class="form-label">PPPoE Password</label>
                                <input type="text" class="form-control form-control-sm" id="create_pppoe_password" name="pppoe_password" placeholder="Kosongkan untuk password default" />
                                <small class="form-text text-muted">Jika kosong, akan menggunakan password default</small>
                            </div>
                        </div>
                        <input type="hidden" id="create_add_to_mikrotik" name="add_to_mikrotik" value="true">
                    </div>
                    
                    <!-- PPPoE Section - Mode Import -->
                    <div id="pppoe_section_import" style="display: none;">
                        <h6 class="mb-3"><i class="fas fa-file-import text-info"></i> Import dari MikroTik</h6>
                        <div class="row">
                            <div class="col-md-8 mb-3">
                                <label for="import_pppoe_username" class="form-label">PPPoE Username <span class="text-danger">*</span></label>
                                <div class="input-group input-group-sm">
                                    <input type="text" class="form-control" id="import_pppoe_username" placeholder="Username yang sudah ada di MikroTik" />
                                    <div class="input-group-append">
                                        <button class="btn btn-info" type="button" id="validate_import_btn">
                                            <i class="fas fa-check-circle"></i> Validasi
                                        </button>
                                    </div>
                                </div>
                                <small class="form-text" id="import_validation_feedback"></small>
                            </div>
                            <div class="col-md-4 mb-3">
                                <label class="form-label">Status</label>
                                <div id="import_status_display" class="border rounded p-2 bg-light text-center">
                                    <small class="text-muted">Belum divalidasi</small>
                                </div>
                            </div>
                        </div>
                        <div id="import_info_display" class="alert alert-info" style="display: none;"></div>
                    </div>
                    
                    <div id="bulk-container" class="mt-2"></div>
                </div>
                <div class="modal-footer"><button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button><button type="submit" class="btn btn-primary btn-sm" id="create_submit_btn">Simpan</button></div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="editModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <form class="modal-content" id="editUserForm">
                <div class="modal-header"><h5 class="modal-title" id="editModalTitle">Edit User</h5><button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button></div>
                <div class="modal-body">
                    <input type="hidden" id="edit_user_id" name="id_user_to_edit">
                    <div class="row">
                        <div class="col-md-6">
                            <div class="mb-3"><label for="edit_name" class="form-label">Nama <span class="text-danger">*</span></label><input type="text" class="form-control form-control-sm" id="edit_name" name="name" required/></div>
                            <div class="mb-3">
                                <div class="d-flex justify-content-between align-items-center">
                                    <h6>Nomor Telepon</h6>
                                    <button class="btn btn-primary btn-sm py-0 px-1" type="button" onclick="addNumberField('edit_number_container')" title="Tambah Nomor HP"><i class="fas fa-plus"></i></button>
                                </div>
                                <div id="edit_number_container" class="mt-1 d-flex flex-column" style="gap: 0.25rem;"></div>
                                <small class="form-text text-muted d-block mt-2">
                                    Maksimal <span class="max-phone-limit-display">3</span> nomor sesuai konfigurasi.
                                </small>
                            </div>
                            
                            <div class="mb-3">
                                <label for="edit_device_id_modal" class="form-label">Device ID</label>
                                <div class="input-group">
                                    <input type="text" class="form-control form-control-sm" id="edit_device_id_modal" name="device_id"/>
                                    <div class="input-group-append">
                                        <button class="btn btn-outline-secondary btn-sm" type="button" id="load_edit_ssid_btn">Muat SSID</button>
                                    </div>
                                </div>
                            </div>

                            <div class="mb-3"><label for="edit_subscription" class="form-label">Paket Langganan <span class="text-danger">*</span></label><select name="subscription" id="edit_subscription" class="form-control form-control-sm" required><option value="">-- Pilih Paket --</option></select></div>
                            <div class="mb-3">
                                <label for="edit_connected_odc" class="form-label">ODC Induk</label>
                                <select id="edit_connected_odc" class="form-control form-control-sm select2-odc-filter" style="width: 100%;"><option value="">-- Pilih ODC --</option></select>
                            </div>
                            <div class="mb-3">
                                <label for="edit_connected_odp" class="form-label">ODP Terhubung</label>
                                <select name="connected_odp_id" id="edit_connected_odp" class="form-control form-control-sm select2-odp" style="width: 100%;" disabled><option value="">-- Pilih ODC Dahulu --</option></select>
                            </div>
                            <div class="mb-3"><div class="form-check"><input type="checkbox" class="form-check-input" name="paid" id="edit_paid"><label for="edit_paid" class="form-check-label">Sudah membayar</label></div></div>
                            <div class="mb-3"><div class="form-check"><input type="checkbox" class="form-check-input" name="send_invoice" id="edit_send_invoice"><label for="edit_send_invoice" class="form-check-label">Kirim Invoice PDF</label></div></div>
                            <div class="mb-3"><div class="form-check"><input type="checkbox" class="form-check-input" name="notify_outage" id="edit_notify_outage"><label for="edit_notify_outage" class="form-check-label">Terima info gangguan (GAMAS)</label></div></div>
                            <div class="mb-3"><label for="edit_account_type" class="form-label">Jenis Akun</label><select class="form-control form-control-sm" name="account_type" id="edit_account_type"><option value="pelanggan">Pelanggan</option><option value="infrastruktur">Infrastruktur (CCTV/Monitoring)</option></select><small class="form-text text-muted">Akun infrastruktur disembunyikan dari data pelanggan &amp; kebal isolir/tagihan, tetapi tetap terbaca di monitor OLT.</small></div>
                        </div>
                        <div class="col-md-6">
                            <div class="mb-3"><label for="edit_dusun" class="form-label">Dusun</label><input type="text" class="form-control form-control-sm" id="edit_dusun" name="dusun" placeholder="mis. Ngitik"><small class="form-text text-muted">Dipakai mengelompokkan pelanggan (broadcast per dusun, gangguan area, pemetaan ODP).</small></div>
                            <div class="mb-3"><label for="edit_address" class="form-label">Alamat</label><textarea class="form-control form-control-sm" id="edit_address" name="address" rows="2"></textarea></div>
                            <div class="row"><div class="col-sm-6 mb-2"><label for="edit_latitude" class="form-label">Latitude</label><input type="number" step="any" class="form-control form-control-sm" id="edit_latitude" name="latitude" placeholder="Dari Peta"></div><div class="col-sm-6 mb-2"><label for="edit_longitude" class="form-label">Longitude</label><input type="number" step="any" class="form-control form-control-sm" id="edit_longitude" name="longitude" placeholder="Dari Peta"></div></div>
                            <div id="editUserMap" class="map-in-modal"></div><small class="form-text text-muted">Klik peta untuk menandai lokasi atau gunakan tombol GPS <i class="fas fa-map-marker-alt"></i>.</small>
                        </div>
                    </div>
                    <hr class="my-2">
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label for="edit_pppoe_username" class="form-label">PPPOE Username</label>
                            <input type="text" class="form-control form-control-sm" id="edit_pppoe_username" name="pppoe_username" readonly />
                            <small class="form-text text-muted">Perubahan username PPPoE harus melalui flow migrasi khusus.</small>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label for="edit_pppoe_password" class="form-label">PPPOE Password</label>
                            <input type="text" class="form-control form-control-sm" id="edit_pppoe_password" name="pppoe_password" readonly />
                            <small class="form-text text-muted">Password PPPoE dari halaman ini hanya ditampilkan, tidak diubah langsung.</small>
                        </div>
                    </div>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                                                <label for="create_payment_method" class="form-label">Metode Pembayaran Tercatat Saat Lunas</label>
                            <select id="create_payment_method" name="payment_method" class="form-control form-control-sm">
                                <option value="">-- Pilih Metode --</option>
                                <option value="CASH">Tunai</option>
                                <option value="TRANSFER_BANK">Transfer Bank</option>
                            </select>
                            <small class="form-text text-muted">Wajib dipilih jika status pelanggan ditandai sudah membayar.</small>
                        </div>
                        <div class="col-md-6 mb-3">
                                                <label for="edit_payment_method" class="form-label">Metode Pembayaran Tercatat Saat Lunas</label>
                            <select id="edit_payment_method" name="payment_method" class="form-control form-control-sm">
                                <option value="">-- Pilih Metode --</option>
                                <option value="CASH">Tunai</option>
                                <option value="TRANSFER_BANK">Transfer Bank</option>
                            </select>
                            <small class="form-text text-muted">Wajib dipilih saat mengubah status dari belum bayar menjadi lunas.</small>
                        </div>
                    </div>
                    <div id="edit-bulk-container" class="mt-2"></div>
                </div>
                <div class="modal-footer"><button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button><button type="submit" class="btn btn-primary btn-sm">Simpan</button></div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="ssid-update" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog"> <form class="modal-content" id="ssidUpdateForm">
                <div class="modal-header"><h5 class="modal-title" id="ssidUpdateModalTitle">Perbarui SSID</h5><button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button></div>
                <div class="modal-body">
                    <input type="hidden" id="ssid_update_device_id" name="device_id_for_ssid_update">
                    <div id="edit-ssid-container" class="mb-3">
                        <div class="loading-spinner-container"><i class="fas fa-spinner fa-spin fa-2x"></i> <p>Memuat data SSID...</p></div>
                    </div>
                    <div id="edit-ssid-passwd-container" class="mb-3">
                        </div>
                     <hr>
                    <div class="mb-3">
                        <label for="transmit_power" class="form-label">Transmit Power (WLAN 1)</label>
                        <select name="transmit_power" id="transmit_power" class="form-control form-control-sm">
                            <option value="">-- Pilih Transmit Power --</option>
                            <option value="20">20%</option>
                            <option value="40">40%</option>
                            <option value="60">60%</option>
                            <option value="80">80%</option>
                            <option value="100">100%</option>
                            </select>
                    </div>
                    <div class="mb-3">
                        <label for="reason" class="form-label">Alasan Perubahan</label>
                        <textarea name="reason" id="reason" class="form-control form-control-sm" rows="2" placeholder="Masukkan alasan perubahan WiFi (opsional)"></textarea>
                    </div>
                    <small class="form-text text-muted">Kosongkan password jika tidak ingin mengubahnya. Perubahan akan dikirim ke perangkat.</small>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button>
                    <button type="submit" class="btn btn-primary btn-sm" id="saveSsidChangesBtn">Simpan Perubahan SSID</button>
                </div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="connectedDevicesModal" data-backdrop="static" tabindex="-1" role="dialog" aria-labelledby="connectedDevicesModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="connectedDevicesModalLabel">Perangkat Terhubung</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body" id="connectedDevicesModalBody" style="max-height: 75vh; overflow-y: auto;">
                    <p class="text-center my-3"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Memuat informasi...</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Titik Lokasi Pelanggan — titik LAMA selalu ditampilkan sebelum ditimpa -->
    <div class="modal fade" id="lokasiModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-map-pin"></i> Titik Lokasi — <span id="lokasi_nama"></span></h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="lokasi_lama" class="alert alert-secondary py-2 mb-3" style="font-size:.9rem;"></div>
                    <div class="mb-2">
                        <label for="lokasi_input" class="form-label">Titik baru</label>
                        <textarea class="form-control form-control-sm" id="lokasi_input" rows="2" placeholder="Tempel di sini: -7.195085, 111.890908  atau  https://maps.google.com/?q=..."></textarea>
                        <small class="form-text text-muted">Tempel <b>koordinat</b> atau <b>link Google Maps</b> yang dikirim pelanggan. Link pendek (maps.app.goo.gl) buka dulu di HP, lalu salin link panjang/koordinatnya.</small>
                    </div>
                    <button type="button" class="btn btn-outline-primary btn-sm" id="lokasi_cek"><i class="fas fa-search-location"></i> Cek titik</button>
                    <div id="lokasi_hasil" class="mt-3"></div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
                    <button type="button" class="btn btn-success btn-sm" id="lokasi_simpan" disabled><i class="fas fa-save"></i> Simpan titik</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="credentialsModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog">
            <form class="modal-content" id="credentialsForm">
                <div class="modal-header">
                    <h5 class="modal-title" id="credentialsModalTitle">Kelola Kredensial Pelanggan</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="cred_user_id" name="id">
                    <div class="mb-3">
                        <label for="cred_username" class="form-label">Username Portal</label>
                        <input type="text" class="form-control" id="cred_username" name="username">
                    </div>
                    <div class="mb-3">
                        <label for="cred_password" class="form-label">Password Baru</label>
                        <input type="text" class="form-control" id="cred_password" name="password" placeholder="Kosongkan untuk buat password acak">
                        <small class="form-text text-muted">Masukkan password baru atau biarkan kosong agar sistem membuatkan password acak untuk Anda.</small>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Batal</button>
                    <button type="submit" class="btn btn-primary">Simpan Kredensial</button>
                </div>
            </form>
        </div>
    </div>

    <div class="modal fade" id="errorModal" tabindex="-1" role="dialog" aria-labelledby="errorModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title" id="errorModalLabel"><i class="fas fa-exclamation-triangle"></i> Terjadi Kesalahan!</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body" id="errorModalBody">
                    </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-danger btn-sm" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="paymentMethodModal" tabindex="-1" role="dialog" aria-labelledby="paymentMethodModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="paymentMethodModalLabel">Pilih Metode Pembayaran</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="paymentMethodForm">
                        <input type="hidden" id="manualInvoiceUserId">
                        <input type="hidden" id="manualInvoiceUserName">
                        <input type="hidden" id="manualInvoicePhoneNumber">
                        <input type="hidden" id="manualInvoiceActionType">
                        <div class="form-group">
                            <label for="paymentMethodSelect">Metode Pembayaran pada Invoice</label>
                            <select class="form-control" id="paymentMethodSelect" required>
                                <option value="CASH">Cash</option>
                                <option value="TRANSFER_BANK">Transfer Bank</option>
                            </select>
                            <small class="form-text text-muted">Pilihan ini hanya dipakai untuk isi invoice manual, bukan untuk mencatat pelunasan pelanggan.</small>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" id="confirmInvoiceActionBtn">Lanjutkan</button>
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
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script src="/js/users.js"></script>
</body>
</html>
