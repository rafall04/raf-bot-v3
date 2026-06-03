<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Database Migration</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
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

    <script>
        $(document).ready(function() {
            // Load user info
            fetch('/api/me', { credentials: 'include' })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200 && data.data && data.data.username) {
                        $('#username-placeholder').text(data.data.username);
                    }
                }).catch(err => console.warn("Could not fetch user data: ", err));

            // Load initial data
            loadDatabaseInfo();
            loadBackupList();

            // Load database information
            function loadDatabaseInfo() {
                fetch('/api/database/info', { credentials: 'include' })
                    .then(response => response.json())
                    .then(data => {
                        if (data.status === 200) {
                            const info = data.data;
                            let html = `
                                <table class="table table-sm">
                                    <tr><td><strong>File:</strong></td><td>database/database.sqlite</td></tr>
                                    <tr><td><strong>Size:</strong></td><td>${info.size}</td></tr>
                                    <tr><td><strong>Total Users:</strong></td><td>${info.totalUsers}</td></tr>
                                    <tr><td><strong>Total Columns:</strong></td><td>${info.totalColumns}</td></tr>
                                    <tr><td><strong>Last Modified:</strong></td><td>${info.lastModified}</td></tr>
                                </table>
                            `;
                            $('#current-db-info').html(html);
                        } else {
                            $('#current-db-info').html('<p class="text-danger">Error loading database info</p>');
                        }
                    })
                    .catch(err => {
                        $('#current-db-info').html('<p class="text-danger">Failed to load database info</p>');
                    });
            }

            // Load backup list
            function loadBackupList() {
                fetch('/api/database/backups', { credentials: 'include' })
                    .then(response => response.json())
                    .then(data => {
                        if (data.status === 200 && data.data.length > 0) {
                            let html = '<div class="table-responsive"><table class="table table-sm">';
                            html += '<thead><tr><th>Backup File</th><th>Created</th><th>Size</th><th>Action</th></tr></thead><tbody>';
                            
                            data.data.forEach(backup => {
                                html += `
                                    <tr>
                                        <td><small>${backup.filename}</small></td>
                                        <td><small>${backup.created}</small></td>
                                        <td><small>${backup.size}</small></td>
                                        <td>
                                            <button class="btn btn-sm btn-outline-success restore-backup" data-file="${backup.filename}">
                                                <i class="fas fa-undo"></i> Restore
                                            </button>
                                        </td>
                                    </tr>
                                `;
                            });
                            
                            html += '</tbody></table></div>';
                            $('#backup-list').html(html);
                        } else {
                            $('#backup-list').html('<p class="text-muted">No backups found</p>');
                        }
                    })
                    .catch(err => {
                        $('#backup-list').html('<p class="text-danger">Failed to load backup list</p>');
                    });
            }

            // Check schema button
            $('#check-schema-btn').on('click', function() {
                const btn = $(this);
                const resultCard = $('#schema-result-card');
                const resultDiv = $('#schema-check-result');

                btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Checking...');

                fetch('/api/database/check-schema', { 
                    method: 'POST',
                    credentials: 'include' 
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200) {
                        const result = data.data;
                        let html = '';
                        
                        if (result.missingColumns.length === 0) {
                            html = '<div class="alert alert-success"><i class="fas fa-check-circle"></i> Database schema is up to date! No migration needed.</div>';
                        } else {
                            html = `
                                <div class="alert alert-warning">
                                    <h6><i class="fas fa-exclamation-triangle"></i> Found ${result.missingColumns.length} missing columns:</h6>
                                    <ul class="mb-0 mt-2">
                                        ${result.missingColumns.map(col => `<li><code>${col}</code></li>`).join('')}
                                    </ul>
                                </div>
                                <p class="mt-3">Click <strong>"Mulai Migrasi Database"</strong> to add these missing columns.</p>
                            `;
                        }

                        if (result.existingColumns && result.existingColumns.length > 0) {
                            html += `
                                <details class="mt-3">
                                    <summary class="cursor-pointer"><strong>Current Columns (${result.existingColumns.length})</strong></summary>
                                    <div class="mt-2">
                                        <code>${result.existingColumns.join(', ')}</code>
                                    </div>
                                </details>
                            `;
                        }

                        resultDiv.html(html);
                        resultCard.show();
                    } else {
                        resultDiv.html('<div class="alert alert-danger">Error: ' + data.message + '</div>');
                        resultCard.show();
                    }
                    btn.prop('disabled', false).html('<i class="fas fa-search"></i> Cek Skema Database');
                })
                .catch(err => {
                    resultDiv.html('<div class="alert alert-danger">Error: ' + err.message + '</div>');
                    resultCard.show();
                    btn.prop('disabled', false).html('<i class="fas fa-search"></i> Cek Skema Database');
                });
            });

            // Start SQLite migration button
            $('#start-sqlite-migration-btn').on('click', function() {
                const btn = $(this);
                const statusDiv = $('#sqlite-migration-status');

                if (!confirm('Are you sure you want to start the database migration? A backup will be created automatically.')) {
                    return;
                }

                btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Migrating...');
                statusDiv.html('<div class="alert alert-info">Starting migration process...</div>');

                fetch('/api/database/migrate-schema', {
                    method: 'POST',
                    credentials: 'include'
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200) {
                        let html = '<div class="alert alert-success">';
                        html += '<h5><i class="fas fa-check-circle"></i> Migration Successful!</h5>';
                        
                        if (data.data.backupFile) {
                            html += `<p>Backup created: <code>${data.data.backupFile}</code></p>`;
                        }
                        
                        if (data.data.addedColumns && data.data.addedColumns.length > 0) {
                            html += `<p>Added ${data.data.addedColumns.length} columns: ${data.data.addedColumns.join(', ')}</p>`;
                        } else {
                            html += '<p>Database was already up to date.</p>';
                        }
                        
                        if (!data.data.restartRequired) {
                            html += '<p class="text-success"><strong><i class="fas fa-check"></i> Database reloaded automatically. No restart needed!</strong></p>';
                        } else {
                            html += '<p class="text-warning"><strong><i class="fas fa-exclamation-triangle"></i> Please restart the application for changes to take effect.</strong></p>';
                        }
                        
                        html += '</div>';
                        statusDiv.html(html);
                        
                        btn.removeClass('btn-primary').addClass('btn-success').html('<i class="fas fa-check"></i> Migration Complete');
                        
                        // Reload info
                        loadDatabaseInfo();
                        loadBackupList();
                        
                        // Hide schema result
                        $('#schema-result-card').hide();
                    } else {
                        statusDiv.html('<div class="alert alert-danger">Error: ' + data.message + '</div>');
                        btn.prop('disabled', false).html('<i class="fas fa-database"></i> Mulai Migrasi Database');
                    }
                })
                .catch(err => {
                    statusDiv.html('<div class="alert alert-danger">Error: ' + err.message + '</div>');
                    btn.prop('disabled', false).html('<i class="fas fa-database"></i> Mulai Migrasi Database');
                });
            });

            // Refresh backups button
            $('#refresh-backups-btn').on('click', function() {
                const btn = $(this);
                btn.find('i').addClass('fa-spin');
                loadBackupList();
                setTimeout(() => btn.find('i').removeClass('fa-spin'), 500);
            });

            // Manual database reload button
            $('#reload-database-btn').on('click', function() {
                const btn = $(this);
                const statusDiv = $('#sqlite-migration-status');
                
                if (!confirm('This will reload the database from disk to memory without restarting the application. Continue?')) {
                    return;
                }
                
                btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Reloading...');
                statusDiv.html('<div class="alert alert-info">Reloading database from disk to memory...</div>');
                
                fetch('/api/database/reload', {
                    method: 'POST',
                    credentials: 'include'
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200) {
                        let html = '<div class="alert alert-success">';
                        html += '<h5><i class="fas fa-check-circle"></i> Database Reloaded!</h5>';
                        html += `<p>Old: ${data.data.oldCount} users with ${data.data.oldColumns} fields</p>`;
                        html += `<p>New: ${data.data.newCount} users with ${data.data.newColumns} fields</p>`;
                        html += '<p class="mb-0"><strong>No restart required - changes applied immediately!</strong></p>';
                        html += '</div>';
                        
                        statusDiv.html(html);
                        btn.removeClass('btn-warning').addClass('btn-success').html('<i class="fas fa-check"></i> Reload Complete');
                        
                        // Reset button after 3 seconds
                        setTimeout(() => {
                            btn.removeClass('btn-success').addClass('btn-warning')
                               .prop('disabled', false)
                               .html('<i class="fas fa-sync-alt"></i> Reload Database (No Restart)');
                        }, 3000);
                        
                        // Reload info
                        loadDatabaseInfo();
                    } else {
                        statusDiv.html('<div class="alert alert-danger">Error: ' + data.message + '</div>');
                        btn.prop('disabled', false).html('<i class="fas fa-sync-alt"></i> Reload Database (No Restart)');
                    }
                })
                .catch(err => {
                    statusDiv.html('<div class="alert alert-danger">Error: ' + err.message + '</div>');
                    btn.prop('disabled', false).html('<i class="fas fa-sync-alt"></i> Reload Database (No Restart)');
                });
            });

            // Restore backup
            $(document).on('click', '.restore-backup', function() {
                const filename = $(this).data('file');
                
                if (!confirm(`Are you sure you want to restore from backup: ${filename}?\n\nThis will replace the current database!`)) {
                    return;
                }

                const btn = $(this);
                btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');

                fetch('/api/database/restore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ filename: filename })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200) {
                        alert('Database restored successfully! Please restart the application.');
                        loadDatabaseInfo();
                        loadBackupList();
                    } else {
                        alert('Error: ' + data.message);
                    }
                    btn.prop('disabled', false).html('<i class="fas fa-undo"></i> Restore');
                })
                .catch(err => {
                    alert('Error: ' + err.message);
                    btn.prop('disabled', false).html('<i class="fas fa-undo"></i> Restore');
                });
            });

            // Handle file input change
            $('#databaseFile').on('change', function(e) {
                const fileName = e.target.files[0]?.name || 'Pilih file database...';
                $(this).next('.custom-file-label').html(fileName);
                
                // Validate file extension
                if (e.target.files[0]) {
                    const ext = fileName.split('.').pop().toLowerCase();
                    if (!['sqlite', 'db', 'sqlite3'].includes(ext)) {
                        $('#upload-status').html('<div class="alert alert-danger">File harus berformat .sqlite, .db, atau .sqlite3</div>');
                        e.target.value = '';
                        $(this).next('.custom-file-label').html('Pilih file database...');
                    } else {
                        $('#upload-status').empty();
                    }
                }
            });

            // Handle database upload form
            $('#uploadDatabaseForm').on('submit', function(e) {
                e.preventDefault();
                
                const fileInput = document.getElementById('databaseFile');
                const file = fileInput.files[0];
                const autoMigrate = $('#autoMigrate').is(':checked');
                
                if (!file) {
                    $('#upload-status').html('<div class="alert alert-danger">Pilih file database untuk diupload</div>');
                    return;
                }
                
                // Validate file size (max 50MB)
                if (file.size > 50 * 1024 * 1024) {
                    $('#upload-status').html('<div class="alert alert-danger">File terlalu besar. Maksimal 50MB.</div>');
                    return;
                }
                
                const formData = new FormData();
                formData.append('database', file);
                formData.append('autoMigrate', autoMigrate);
                
                const submitBtn = $(this).find('button[type="submit"]');
                const originalText = submitBtn.html();
                
                submitBtn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Uploading...');
                $('#upload-status').html('<div class="alert alert-info">Mengupload database...</div>');
                
                fetch('/api/database/upload', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200) {
                        let successMsg = '<div class="alert alert-success">';
                        successMsg += '<h5><i class="fas fa-check-circle"></i> Upload Berhasil!</h5>';
                        
                        if (data.data.backupFile) {
                            successMsg += `<p>Backup dibuat: <code>${data.data.backupFile}</code></p>`;
                        }
                        
                        if (data.data.migrationResult) {
                            const result = data.data.migrationResult;
                            if (result.addedColumns && result.addedColumns.length > 0) {
                                successMsg += `<p>Kolom ditambahkan: ${result.addedColumns.join(', ')}</p>`;
                            } else if (result.upToDate) {
                                successMsg += '<p>Database sudah up to date.</p>';
                            }
                        }
                        
                        if (!data.data.restartRequired) {
                            successMsg += '<p class="mb-0 text-success"><strong><i class="fas fa-check"></i> Database berhasil di-reload otomatis. Tidak perlu restart!</strong></p>';
                        } else {
                            successMsg += '<p class="mb-0 text-warning"><strong><i class="fas fa-exclamation-triangle"></i> Restart aplikasi untuk memuat database baru!</strong></p>';
                        }
                        successMsg += '</div>';
                        
                        $('#upload-status').html(successMsg);
                        
                        // Reset form
                        fileInput.value = '';
                        $('.custom-file-label').html('Pilih file database...');
                        
                        // Reload info after success
                        setTimeout(() => {
                            loadDatabaseInfo();
                            loadBackupList();
                        }, 1000);
                        
                    } else {
                        $('#upload-status').html('<div class="alert alert-danger">Error: ' + data.message + '</div>');
                    }
                    
                    submitBtn.prop('disabled', false).html(originalText);
                })
                .catch(err => {
                    $('#upload-status').html('<div class="alert alert-danger">Error: ' + err.message + '</div>');
                    submitBtn.prop('disabled', false).html(originalText);
                });
            });

            // JSON Migration - Upload file form
            $('#uploadUsersJsonForm').on('submit', function(e) {
                e.preventDefault();
                
                const fileInput = document.getElementById('usersJsonFile');
                const file = fileInput.files[0];
                const btn = $('#start-migration-btn');
                const statusDiv = $('#migration-status');
                const originalText = btn.html();

                if (!file) {
                    statusDiv.html('<div class="alert alert-danger">Pilih file users.json untuk diupload</div>');
                    return;
                }

                // Validate file type
                if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
                    statusDiv.html('<div class="alert alert-danger">File harus berupa JSON (.json)</div>');
                    return;
                }

                // Validate file size (max 10MB)
                if (file.size > 10 * 1024 * 1024) {
                    statusDiv.html('<div class="alert alert-danger">File terlalu besar. Maksimal 10MB.</div>');
                    return;
                }

                const formData = new FormData();
                formData.append('usersFile', file);

                btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Mengupload & Memigrasi...');
                statusDiv.html('<div class="alert alert-info">Mengupload file dan memulai proses migrasi...</div>');

                fetch('/api/migrate-users', {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200) {
                        let statusHtml = '<div class="alert alert-success">' + data.message + '</div>';
                        if (data.details) {
                            statusHtml += '<div class="mt-2"><small>';
                            statusHtml += '<strong>Detail:</strong> ';
                            statusHtml += `Total: ${data.details.totalUsers}, `;
                            statusHtml += `Berhasil: ${data.details.inserted}, `;
                            statusHtml += `Error: ${data.details.errors}, `;
                            statusHtml += `Dimuat: ${data.details.reloaded}`;
                            statusHtml += '</small></div>';
                        }
                        statusDiv.html(statusHtml);
                        btn.removeClass('btn-primary').addClass('btn-success').html('<i class="fas fa-check"></i> Migrasi Selesai');
                        
                        // Reset form
                        $('#usersJsonFile').val('');
                        $('.custom-file-label').text('Pilih file users.json...');
                    } else {
                        statusDiv.html('<div class="alert alert-danger">Error: ' + data.message + '</div>');
                        btn.prop('disabled', false).html(originalText);
                    }
                })
                .catch(err => {
                    statusDiv.html('<div class="alert alert-danger">Error: ' + err.message + '</div>');
                    btn.prop('disabled', false).html(originalText);
                });
            });

            // Update file input label when file is selected
            $('#usersJsonFile').on('change', function() {
                const fileName = $(this).val().split('\\').pop();
                $(this).siblings('.custom-file-label').text(fileName || 'Pilih file users.json...');
            });
        });
    </script>
</body>
</html>
