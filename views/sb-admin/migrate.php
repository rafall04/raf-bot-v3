<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Database Migration';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
                    <form class="form-inline"><button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3"><i class="fa fa-bars"></i></button></form>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown"><span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span><img class="img-profile rounded-circle" src="/img/undraw_profile.svg"></a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown"><a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal"><i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>Logout</a></div>
                        </li>
                    </ul>
                </nav>

                <div class="container-fluid">
                    <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Migrasi Database</h1>
            <p>Kelola dan monitor migrasi database</p>
          </div>
                    
                    <!-- Migration Options Tabs -->
                    <ul class="nav nav-tabs mb-4" id="migrationTabs" role="tablist">
                        <li class="nav-item">
                            <a class="nav-link active" id="sqlite-migration-tab" data-toggle="tab" href="#sqlite-migration" role="tab">
                                <i class="fas fa-database"></i> Migrasi Database SQLite Lama
                            </a>
                        </li>
                        <li class="nav-item">
                            <a class="nav-link" id="json-migration-tab" data-toggle="tab" href="#json-migration" role="tab">
                                <i class="fas fa-file-code"></i> Migrasi dari JSON
                            </a>
                        </li>
                    </ul>

                    <!-- Tab Content -->
                    <div class="tab-content" id="migrationTabContent">
                        <!-- SQLite Migration Tab -->
                        <div class="tab-pane fade show active" id="sqlite-migration" role="tabpanel">
                            <h4 class="dashboard-section-title">Migrasi Database SQLite Lama</h4>
                            
                            <!-- Upload Database Section -->
                            <div class="card table-card mb-4">
                                <div class="card-header">
                                    <h6><i class="fas fa-cloud-upload-alt"></i> Upload Database Lama</h6>
                                </div>
                                <div class="card-body">
                                    <div class="alert alert-info">
                                        <i class="fas fa-info-circle"></i> <strong>Upload Database:</strong>
                                        Upload file database SQLite lama (.sqlite atau .db) untuk melakukan migrasi otomatis.
                                    </div>
                                    
                                    <form id="uploadDatabaseForm" enctype="multipart/form-data">
                                        <div class="custom-file mb-3">
                                            <input type="file" class="custom-file-input" id="databaseFile" accept=".sqlite,.db,.sqlite3" required>
                                            <label class="custom-file-label" for="databaseFile">Pilih file database...</label>
                                        </div>
                                        
                                        <div class="form-check mb-3">
                                            <input type="checkbox" class="form-check-input" id="autoMigrate" checked>
                                            <label class="form-check-label" for="autoMigrate">
                                                Jalankan migrasi otomatis setelah upload
                                            </label>
                                        </div>
                                        
                                        <button type="submit" class="btn btn-success btn-block">
                                            <i class="fas fa-upload"></i> Upload & Replace Database
                                        </button>
                                    </form>
                                    
                                    <div id="upload-status" class="mt-3"></div>
                                </div>
                            </div>
                            
                            <div class="row">
                                <!-- Current Database Info -->
                                <div class="col-lg-6">
                                    <div class="card table-card mb-4">
                                        <div class="card-header">
                                            <h6><i class="fas fa-info-circle"></i> Database Saat Ini</h6>
                                        </div>
                                        <div class="card-body">
                                            <div id="current-db-info">
                                                <p class="text-muted">Memuat informasi database...</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Migration Actions -->
                                <div class="col-lg-6">
                                    <div class="card table-card mb-4">
                                        <div class="card-header">
                                            <h6><i class="fas fa-tools"></i> Tindakan Migrasi</h6>
                                        </div>
                                        <div class="card-body">
                                            <div class="alert alert-warning">
                                                <i class="fas fa-exclamation-triangle"></i> <strong>Perhatian:</strong>
                                                <ul class="mb-0 mt-2">
                                                    <li>Backup otomatis akan dibuat sebelum migrasi</li>
                                                    <li>Proses migrasi akan menambah kolom yang hilang</li>
                                                    <li>Tabel turunan (mis. payment_history) akan disiapkan otomatis</li>
                                                    <li>Data existing akan dipertahankan</li>
                                                </ul>
                                            </div>

                                            <button id="check-schema-btn" class="btn btn-info btn-block mb-2">
                                                <i class="fas fa-search"></i> Cek Skema Database
                                            </button>

                                            <button id="start-sqlite-migration-btn" class="btn btn-primary btn-block mb-2">
                                                <i class="fas fa-database"></i> Mulai Migrasi Database
                                            </button>

                                            <button id="reload-database-btn" class="btn btn-warning btn-block" title="Reload database dari disk ke memory tanpa restart">
                                                <i class="fas fa-sync-alt"></i> Reload Database (No Restart)
                                            </button>

                                            <div id="sqlite-migration-status" class="mt-3"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Schema Check Result -->
                            <div class="card table-card mb-4" id="schema-result-card" style="display: none;">
                                <div class="card-header">
                                    <h6><i class="fas fa-clipboard-check"></i> Hasil Pemeriksaan Skema</h6>
                                </div>
                                <div class="card-body">
                                    <div id="schema-check-result"></div>
                                </div>
                            </div>

                            <!-- Backup List -->
                            <div class="card table-card mb-4">
                                <div class="card-header d-flex justify-content-between align-items-center">
                                    <h6><i class="fas fa-history"></i> Daftar Backup Database</h6>
                                    <button id="refresh-backups-btn" class="btn btn-sm btn-outline-primary">
                                        <i class="fas fa-sync-alt"></i> Refresh
                                    </button>
                                </div>
                                <div class="card-body">
                                    <div id="backup-list">
                                        <p class="text-muted">Memuat daftar backup...</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- JSON Migration Tab -->
                        <div class="tab-pane fade" id="json-migration" role="tabpanel">
                            <h4 class="dashboard-section-title">Migrasi dari users.json</h4>
                            <div class="card table-card mb-4">
                                <div class="card-header">
                                    <h6><i class="fas fa-file-code"></i> Upload & Migrasi JSON</h6>
                                </div>
                                <div class="card-body">
                                    <div class="alert alert-info">
                                        <i class="fas fa-info-circle"></i> <strong>Upload File users.json:</strong>
                                        Upload file users.json untuk melakukan migrasi ke database SQLite.
                                    </div>
                                    
                                    <form id="uploadUsersJsonForm" enctype="multipart/form-data">
                                        <div class="custom-file mb-3">
                                            <input type="file" class="custom-file-input" id="usersJsonFile" accept=".json" required>
                                            <label class="custom-file-label" for="usersJsonFile">Pilih file users.json...</label>
                                        </div>
                                        
                                        <p class="text-warning"><i class="fas fa-exclamation-triangle"></i> Proses ini tidak dapat diurungkan. Pastikan Anda telah membuat cadangan data jika diperlukan.</p>
                                        
                                        <button type="submit" id="start-migration-btn" class="btn btn-primary btn-block">
                                            <i class="fas fa-upload"></i> Upload & Mulai Migrasi JSON
                                        </button>
                                    </form>
                                    
                                    <div id="migration-status" class="mt-3"></div>
                                </div>
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

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>

    <script src="/js/migrate.js"></script>
</body>
</html>
