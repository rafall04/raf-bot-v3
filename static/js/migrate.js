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

            // Render ringkasan migrasi berbasis-versi (tabel turunan seperti payment_history)
            function renderVersionMigration(versionResults) {
                if (!versionResults || typeof versionResults !== 'object') return '';
                let rows = '';
                Object.keys(versionResults).forEach(function(dbName) {
                    const r = versionResults[dbName] || {};
                    let label, cls;
                    if (r.skipped) {
                        label = 'dilewati (dibuat saat pertama dipakai)';
                        cls = 'text-muted';
                    } else if (r.error) {
                        label = 'gagal: ' + r.error;
                        cls = 'text-danger';
                    } else if (r.migrated) {
                        const extra = dbName === 'users.sqlite' ? ' (payment_history disiapkan)' : '';
                        label = 'v' + r.currentVersion + ' → v' + r.targetVersion + extra;
                        cls = 'text-success';
                    } else {
                        label = 'sudah versi terbaru (v' + (r.currentVersion != null ? r.currentVersion : '?') + ')';
                        cls = 'text-muted';
                    }
                    rows += '<li><code>' + dbName + '</code>: <span class="' + cls + '">' + label + '</span></li>';
                });
                if (!rows) return '';
                return '<p class="mt-2 mb-1"><strong>Migrasi versi skema:</strong></p><ul class="mb-0">' + rows + '</ul>';
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

                        html += renderVersionMigration(data.data.versionResults);

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
                            if (result.error) {
                                successMsg += `<p class="text-warning">Catatan migrasi: ${result.error}</p>`;
                            }
                            successMsg += renderVersionMigration(result.versionResults);
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
