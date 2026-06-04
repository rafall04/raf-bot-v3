<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Log Perubahan WiFi</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/admin-theme.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    
    <style>
        .stats-card {
            border-left: 4px solid #4e73df;
            background: linear-gradient(90deg, rgba(78, 115, 223, 0.1) 0%, rgba(255, 255, 255, 1) 100%);
        }
        .stats-card.warning {
            border-left-color: #f6c23e;
            background: linear-gradient(90deg, rgba(246, 194, 62, 0.1) 0%, rgba(255, 255, 255, 1) 100%);
        }
        .stats-card.success {
            border-left-color: #1cc88a;
            background: linear-gradient(90deg, rgba(28, 200, 138, 0.1) 0%, rgba(255, 255, 255, 1) 100%);
        }
        .stats-card.info {
            border-left-color: #36b9cc;
            background: linear-gradient(90deg, rgba(54, 185, 204, 0.1) 0%, rgba(255, 255, 255, 1) 100%);
        }
        .log-badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
        }
        .log-details {
            font-size: 0.85rem;
            color: #6c757d;
        }
        .change-type-badge {
            font-weight: 600;
        }
        .filter-section {
            background-color: #f8f9fc;
            border-radius: 0.35rem;
            padding: 1rem;
            margin-bottom: 1rem;
        }
        .table-responsive {
            border-radius: 0.35rem;
        }
        .log-timestamp {
            font-size: 0.8rem;
            color: #858796;
        }
        .log-source {
            font-size: 0.75rem;
            font-weight: 600;
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
                    <form class="form-inline">
                        <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                            <i class="fa fa-bars"></i>
                        </button>
                    </form>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown">
                                <span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTgiIGZpbGw9IiNlMGUwZTAiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjE1IiByPSI1IiBmaWxsPSIjYWFhIi8+PHBhdGggZD0iTTIwIDI0YzUgMCA5IDMgOSA2djZINDF2LTZjMC0zIDQtNiA5LTZ6IiBmaWxsPSIjYWFhIi8+PC9zdmc+'">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                                    Logout
                                </a>
                            </div>
                        </li>
                    </ul>
                </nav>

                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Log Perubahan WiFi</h1>
            <p>Kelola dan monitor log perubahan wifi</p>
          </div>
                        <button id="refreshStatsBtn" class="btn btn-primary btn-sm">
                            <i class="fas fa-sync-alt"></i> Refresh Data
                        </button>
                    </div>

                    <!-- Statistics Cards -->
                    <div class="row mb-4" id="statsContainer">
                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card stats-card h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">
                                                Total Perubahan
                                            </div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalChanges">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-wifi fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card stats-card warning h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-warning text-uppercase mb-1">
                                                24 Jam Terakhir
                                            </div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="changes24h">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-clock fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card stats-card success h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-success text-uppercase mb-1">
                                                7 Hari Terakhir
                                            </div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="changes7d">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-calendar-week fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card stats-card info h-100 py-2">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-info text-uppercase mb-1">
                                                30 Hari Terakhir
                                            </div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="changes30d">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-calendar-alt fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Filters -->
                    <!-- Table Section -->
          <h4 class="dashboard-section-title">Filter Log</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Filter Log</h6>
                        </div>
                        <div class="card-body">
                            <div class="filter-section">
                                <div class="row">
                                    <div class="col-md-3 mb-3">
                                        <label for="filterChangeType" class="form-label">Jenis Perubahan</label>
                                        <select id="filterChangeType" class="form-control form-control-sm">
                                            <option value="">Semua Jenis</option>
                                            <option value="ssid_name">Nama SSID</option>
                                            <option value="password">Password</option>
                                            <option value="both">SSID & Password</option>
                                            <option value="transmit_power">Transmit Power</option>
                                        </select>
                                    </div>
                                    <div class="col-md-3 mb-3">
                                        <label for="filterChangeSource" class="form-label">Sumber Perubahan</label>
                                        <select id="filterChangeSource" class="form-control form-control-sm">
                                            <option value="">Semua Sumber</option>
                                            <option value="web_admin">Web Admin</option>
                                            <option value="web_technician">Web Teknisi</option>
                                            <option value="wa_bot">WhatsApp Bot</option>
                                            <option value="api">API</option>
                                        </select>
                                    </div>
                                    <div class="col-md-3 mb-3">
                                        <label for="filterDateFrom" class="form-label">Dari Tanggal</label>
                                        <input type="date" id="filterDateFrom" class="form-control form-control-sm">
                                    </div>
                                    <div class="col-md-3 mb-3">
                                        <label for="filterDateTo" class="form-label">Sampai Tanggal</label>
                                        <input type="date" id="filterDateTo" class="form-control form-control-sm">
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col-md-4 mb-3">
                                        <label for="filterChangedBy" class="form-label">Diubah Oleh</label>
                                        <input type="text" id="filterChangedBy" class="form-control form-control-sm" placeholder="Nama user/admin">
                                    </div>
                                    <div class="col-md-4 mb-3">
                                        <label for="filterDeviceId" class="form-label">Device ID</label>
                                        <input type="text" id="filterDeviceId" class="form-control form-control-sm" placeholder="Device ID">
                                    </div>
                                    <div class="col-md-4 mb-3 d-flex align-items-end">
                                        <div class="w-100">
                                            <button id="applyFilters" class="btn btn-primary btn-sm mr-2">
                                                <i class="fas fa-filter"></i> Terapkan Filter
                                            </button>
                                            <button id="clearFilters" class="btn btn-outline-secondary btn-sm">
                                                <i class="fas fa-times"></i> Reset
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Logs Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <div class="d-flex justify-content-between align-items-center">
                                <h6 class="m-0 font-weight-bold text-primary">Log Perubahan WiFi</h6>
                                <button id="refreshLogsBtn" class="btn btn-info btn-sm">
                                    <i class="fas fa-sync-alt"></i> Refresh
                                </button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-sm" id="logsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Waktu</th>
                                            <th>Pelanggan</th>
                                            <th>Device ID</th>
                                            <th>Jenis Perubahan</th>
                                            <th>Detail Perubahan</th>
                                            <th>Diubah Oleh</th>
                                            <th>Sumber</th>
                                            <th>Alasan</th>
                                        </tr>
                                    </thead>
                                    <tbody id="logsTableBody">
                                        <tr>
                                            <td colspan="8" class="text-center py-4">
                                                <i class="fas fa-spinner fa-spin fa-2x text-muted"></i>
                                                <p class="mt-2 text-muted">Memuat data log...</p>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            
                            <!-- Pagination -->
                            <div class="d-flex justify-content-between align-items-center mt-3">
                                <div class="text-muted" id="paginationInfo">
                                    Menampilkan 0 dari 0 log
                                </div>
                                <div>
                                    <button id="prevPage" class="btn btn-outline-primary btn-sm mr-2" disabled>
                                        <i class="fas fa-chevron-left"></i> Sebelumnya
                                    </button>
                                    <button id="nextPage" class="btn btn-outline-primary btn-sm" disabled>
                                        Selanjutnya <i class="fas fa-chevron-right"></i>
                                    </button>
                                </div>
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

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">Select "Logout" to end session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
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
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

    <script>
        $(document).ready(function() {
            let currentPage = 0;
            const pageSize = 25;
            let totalLogs = 0;
            let currentFilters = {};

            // Initialize
            loadStats();
            loadLogs();

            // Event handlers
            $('#refreshStatsBtn').click(function() {
                loadStats();
            });

            $('#refreshLogsBtn').click(function() {
                loadLogs();
            });

            $('#applyFilters').click(function() {
                currentPage = 0;
                loadLogs();
            });

            $('#clearFilters').click(function() {
                $('#filterChangeType').val('');
                $('#filterChangeSource').val('');
                $('#filterDateFrom').val('');
                $('#filterDateTo').val('');
                $('#filterChangedBy').val('');
                $('#filterDeviceId').val('');
                currentPage = 0;
                loadLogs();
            });

            $('#prevPage').click(function() {
                if (currentPage > 0) {
                    currentPage--;
                    loadLogs();
                }
            });

            $('#nextPage').click(function() {
                if ((currentPage + 1) * pageSize < totalLogs) {
                    currentPage++;
                    loadLogs();
                }
            });

            function loadStats() {
                $('#refreshStatsBtn').prop('disabled', true);
                
                $.ajax({
                    url: '/api/wifi-logs/stats',
                    method: 'GET',
                    success: function(response) {
                        if (response.status === 200) {
                            const stats = response.data;
                            $('#totalChanges').text(stats.totalChanges || 0);
                            $('#changes24h').text(stats.changesLast24h || 0);
                            $('#changes7d').text(stats.changesLast7d || 0);
                            $('#changes30d').text(stats.changesLast30d || 0);
                        }
                    },
                    error: function(xhr, status, error) {
                        console.error('Error loading stats:', error);
                        showAlert('Gagal memuat statistik: ' + error, 'danger');
                    },
                    complete: function() {
                        $('#refreshStatsBtn').prop('disabled', false);
                    }
                });
            }

            function loadLogs() {
                $('#refreshLogsBtn').prop('disabled', true);
                
                // Get current filters
                currentFilters = {
                    changeType: $('#filterChangeType').val(),
                    changeSource: $('#filterChangeSource').val(),
                    dateFrom: $('#filterDateFrom').val(),
                    dateTo: $('#filterDateTo').val(),
                    changedBy: $('#filterChangedBy').val(),
                    deviceId: $('#filterDeviceId').val(),
                    limit: pageSize,
                    offset: currentPage * pageSize
                };

                // Remove empty filters
                Object.keys(currentFilters).forEach(key => {
                    if (currentFilters[key] === '' || currentFilters[key] === null) {
                        delete currentFilters[key];
                    }
                });

                $.ajax({
                    url: '/api/wifi-logs',
                    method: 'GET',
                    data: currentFilters,
                    success: function(response) {
                        if (response.status === 200) {
                            const result = response.data;
                            totalLogs = result.total;
                            displayLogs(result.logs);
                            updatePagination();
                        }
                    },
                    error: function(xhr, status, error) {
                        console.error('Error loading logs:', error);
                        showAlert('Gagal memuat log: ' + error, 'danger');
                        $('#logsTableBody').html('<tr><td colspan="8" class="text-center text-danger">Gagal memuat data log</td></tr>');
                    },
                    complete: function() {
                        $('#refreshLogsBtn').prop('disabled', false);
                    }
                });
            }

            function displayLogs(logs) {
                const tbody = $('#logsTableBody');
                tbody.empty();

                if (logs.length === 0) {
                    tbody.html('<tr><td colspan="8" class="text-center text-muted py-4">Tidak ada log yang ditemukan</td></tr>');
                    return;
                }

                logs.forEach(log => {
                    const row = $('<tr>');
                    
                    // Timestamp
                    const timestamp = new Date(log.timestamp);
                    row.append(`<td class="log-timestamp">${timestamp.toLocaleString('id-ID')}</td>`);
                    
                    // Customer
                    row.append(`<td><strong>${log.customerName}</strong><br><small class="text-muted">${log.customerPhone}</small></td>`);
                    
                    // Device ID
                    row.append(`<td><code>${log.deviceId}</code></td>`);
                    
                    // Change Type
                    const changeTypeBadge = getChangeTypeBadge(log.changeType);
                    row.append(`<td>${changeTypeBadge}</td>`);
                    
                    // Change Details
                    const changeDetails = formatChangeDetails(log);
                    row.append(`<td class="log-details">${changeDetails}</td>`);
                    
                    // Changed By (actor attribution)
                    row.append(`<td>${formatActorCell(log)}</td>`);
                    
                    // Source
                    const sourceBadge = getSourceBadge(log.changeSource);
                    row.append(`<td>${sourceBadge}</td>`);
                    
                    // Reason
                    row.append(`<td><small>${log.reason || 'Tidak disebutkan'}</small></td>`);
                    
                    tbody.append(row);
                });
            }

            // Badge per role aktor + nama/identifier + nomor WA (kalau ada).
            // Fallback ke log.changedBy untuk entry lama yang belum punya field attribution.
            const ROLE_BADGE = {
                customer: { cls: 'badge-success', label: 'Customer' },
                teknisi: { cls: 'badge-info', label: 'Teknisi' },
                admin: { cls: 'badge-danger', label: 'Admin' },
                owner: { cls: 'badge-dark', label: 'Owner' },
                system: { cls: 'badge-secondary', label: 'Sistem' }
            };

            function escapeHtml(str) {
                return String(str == null ? '' : str)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            }

            function formatActorCell(log) {
                const role = log.actorRole;
                const identifier = log.actorIdentifier;
                const phone = log.actorPhone;

                if (role && ROLE_BADGE[role]) {
                    const meta = ROLE_BADGE[role];
                    const nameLine = role === 'customer'
                        ? '<strong>Customer</strong>'
                        : `<strong>${escapeHtml(identifier || meta.label)}</strong>`;
                    const phoneLine = phone ? `<br><small class="text-muted">${escapeHtml(phone)}</small>` : '';
                    return `<span class="badge ${meta.cls} log-source">${meta.label}</span><br>${nameLine}${phoneLine}`;
                }

                // Legacy log tanpa actor fields → tampilkan changedBy mentah.
                return `<strong>${escapeHtml(log.changedBy || '-')}</strong>`;
            }

            function getChangeTypeBadge(changeType) {
                const badges = {
                    'ssid_name': '<span class="badge badge-info change-type-badge">Nama SSID</span>',
                    'password': '<span class="badge badge-warning change-type-badge">Password</span>',
                    'both': '<span class="badge badge-primary change-type-badge">SSID & Password</span>',
                    'transmit_power': '<span class="badge badge-success change-type-badge">Transmit Power</span>'
                };
                return badges[changeType] || `<span class="badge badge-secondary change-type-badge">${changeType}</span>`;
            }

            function getSourceBadge(source) {
                const badges = {
                    'web_admin': '<span class="badge badge-danger log-source">Web Admin</span>',
                    'web_technician': '<span class="badge badge-info log-source">Web Teknisi</span>',
                    'wa_bot': '<span class="badge badge-success log-source">WhatsApp Bot</span>',
                    'api': '<span class="badge badge-warning log-source">API</span>'
                };
                return badges[source] || `<span class="badge badge-secondary log-source">${source}</span>`;
            }

            function formatChangeDetails(log) {
                const changes = log.changes;
                let details = '';

                switch (log.changeType) {
                    case 'ssid_name':
                        if (Array.isArray(changes.ssidEntries) && changes.ssidEntries.length > 0) {
                            details = changes.ssidEntries.map((entry) =>
                                `<strong>SSID ${entry.ssidId}:</strong> "${entry.oldValue || '(belum ada)'}" → "${entry.newValue}"`
                            ).join('<br>');
                        } else {
                            const oldSsidDisplay = changes.oldSsidName || '(belum ada)';
                            details = `<strong>SSID:</strong> "${oldSsidDisplay}" → "${changes.newSsidName}"`;
                        }
                        break;
                    case 'password':
                        if (changes.newPassword) {
                            details = changes.detailPassword
                                ? `<strong>Password:</strong><br>${changes.detailPassword}`
                                : `<strong>Password:</strong> ${changes.newPassword}`;
                        } else {
                            details = `<strong>Password:</strong> diubah (tidak tersimpan)`;
                        }
                        break;
                    case 'both':
                        const ssidDetails = Array.isArray(changes.ssidEntries) && changes.ssidEntries.length > 0
                            ? changes.ssidEntries.map((entry) =>
                                `<strong>SSID ${entry.ssidId}:</strong> "${entry.oldValue || '(belum ada)'}" → "${entry.newValue}"`
                            ).join('<br>')
                            : `<strong>SSID:</strong> "${changes.oldSsidName || '(belum ada)'}" → "${changes.newSsidName}"`;
                        const passwordDetails = changes.detailPassword
                            ? `<strong>Password:</strong><br>${changes.detailPassword}`
                            : `<strong>Password:</strong> ${changes.newPassword || 'diubah'}`;
                        details = `${ssidDetails}<br>${passwordDetails}`;
                        break;
                    case 'transmit_power':
                        details = `<strong>Transmit Power:</strong> ${changes.oldTransmitPower} → ${changes.newTransmitPower}`;
                        break;
                    default:
                        details = 'Detail tidak tersedia';
                }

                if (log.notes) {
                    details += `<br><small class="text-muted"><em>Catatan: ${log.notes}</em></small>`;
                }

                return details;
            }

            function updatePagination() {
                const start = currentPage * pageSize + 1;
                const end = Math.min((currentPage + 1) * pageSize, totalLogs);
                
                $('#paginationInfo').text(`Menampilkan ${start}-${end} dari ${totalLogs} log`);
                
                $('#prevPage').prop('disabled', currentPage === 0);
                $('#nextPage').prop('disabled', (currentPage + 1) * pageSize >= totalLogs);
            }

            function showAlert(message, type = 'info') {
                const alertHtml = `
                    <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                        ${message}
                        <button type="button" class="close" data-dismiss="alert" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                `;
                $('.container-fluid').prepend(alertHtml);
                
                // Auto dismiss after 5 seconds
                setTimeout(() => {
                    $('.alert').alert('close');
                }, 5000);
            }
        });
    </script>
</body>

</html>
