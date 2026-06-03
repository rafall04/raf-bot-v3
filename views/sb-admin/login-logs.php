<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Login Logs</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    
    <style>
        .stats-card {
            border-left: 4px solid #4e73df;
            background: linear-gradient(90deg, rgba(78, 115, 223, 0.1) 0%, rgba(255, 255, 255, 1) 100%);
        }
        .stats-card.success {
            border-left-color: #1cc88a;
            background: linear-gradient(90deg, rgba(28, 200, 138, 0.1) 0%, rgba(255, 255, 255, 1) 100%);
        }
        .stats-card.danger {
            border-left-color: #e74a3b;
            background: linear-gradient(90deg, rgba(231, 74, 59, 0.1) 0%, rgba(255, 255, 255, 1) 100%);
        }
        .filter-section {
            background-color: #f8f9fc;
            border-radius: 0.35rem;
            padding: 1rem;
            margin-bottom: 1rem;
        }
        .log-badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
        }
        .log-timestamp {
            font-size: 0.8rem;
            color: #858796;
        }
        .table-responsive {
            border-radius: 0.35rem;
        }
        .success-badge { background-color: #1cc88a; color: white; }
        .failed-badge { background-color: #e74a3b; color: white; }
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
                        <div class="dashboard-header">
                            <h1>Login & Logout Logs</h1>
                            <p>Riwayat login dan logout admin dan teknisi</p>
                        </div>
                        <button id="refreshBtn" class="btn btn-primary btn-sm">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>

                    <!-- Filter Section -->
                    <div class="filter-section">
                        <div class="row">
                            <div class="col-md-4">
                                <label>Username</label>
                                <input type="text" id="filterUsername" class="form-control form-control-sm" placeholder="Username">
                            </div>
                            <div class="col-md-3">
                                <label>Action</label>
                                <select id="filterAction" class="form-control form-control-sm">
                                    <option value="">Semua</option>
                                    <option value="login">Login</option>
                                    <option value="logout">Logout</option>
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label>Status</label>
                                <select id="filterSuccess" class="form-control form-control-sm">
                                    <option value="">Semua</option>
                                    <option value="true">Success</option>
                                    <option value="false">Failed</option>
                                </select>
                            </div>
                            <div class="col-md-2">
                                <label>&nbsp;</label>
                                <button id="applyFiltersBtn" class="btn btn-primary btn-sm btn-block">
                                    <i class="fas fa-filter"></i> Filter
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Logs Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary">Login & Logout History</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered" id="loginLogsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Action</th>
                                            <th>Timestamp</th>
                                            <th>Username</th>
                                            <th>Role</th>
                                            <th>Status</th>
                                            <th>IP Address</th>
                                            <th>User Agent</th>
                                            <th>Failure Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody id="loginLogsBody">
                                        <tr>
                                            <td colspan="8" class="text-center">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Konfirmasi Logout</h5>
                    <button type="button" class="close" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">Apakah Anda yakin ingin logout?</div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <a href="/logout" class="btn btn-primary">Logout</a>
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

    <script>
        let dataTable;
        let currentFilters = {
            username: '',
            actionType: '',
            successOnly: false
        };

        function loadLoginLogs() {
            const params = new URLSearchParams({
                limit: 100,
                offset: 0
            });

            if (currentFilters.username) {
                params.append('username', currentFilters.username);
            }
            if (currentFilters.actionType) {
                params.append('actionType', currentFilters.actionType);
            }
            if (currentFilters.successOnly) {
                params.append('successOnly', 'true');
            }

            fetch(`/api/logs/login?${params}`, {
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json'
                }
            })
            .then(response => {
                if (response.status === 403) {
                    // Handle 403 - redirect to login or show error
                    return response.json().then(data => {
                        throw new Error(data.message || 'Akses ditolak. Silakan login ulang.');
                    });
                }
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(result => {
                if (result.status === 200 && result.data) {
                    renderLogs(result.data);
                } else {
                    $('#loginLogsBody').html('<tr><td colspan="8" class="text-center text-danger">Error loading logs: ' + (result.message || 'Unknown error') + '</td></tr>');
                }
            })
            .catch(error => {
                console.error('Error loading login logs:', error);
                let errorMsg = error.message || 'Unknown error';
                if (errorMsg.includes('Akses ditolak') || errorMsg.includes('403')) {
                    errorMsg = 'Akses ditolak. Silakan login ulang atau hubungi administrator.';
                }
                $('#loginLogsBody').html('<tr><td colspan="8" class="text-center text-danger">' + errorMsg + '</td></tr>');
            });
        }

        function renderLogs(logs) {
            const tbody = $('#loginLogsBody');
            tbody.empty();

            if (logs.length === 0) {
                tbody.html('<tr><td colspan="8" class="text-center">No login/logout logs found</td></tr>');
                return;
            }

            logs.forEach(log => {
                // Determine action type (login or logout)
                const actionType = log.action_type || (log.logout_time ? 'logout' : 'login');
                const isLogout = actionType === 'logout';
                
                // Use logout_time for logout events, login_time for login events
                // Format with Asia/Jakarta timezone
                const timeField = isLogout && log.logout_time ? log.logout_time : log.login_time;
                const timestamp = timeField ? new Date(timeField).toLocaleString('id-ID', {
                    timeZone: 'Asia/Jakarta',
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }) : '-';
                
                const success = log.success === 1 || log.success === true;
                const actionBadgeClass = isLogout ? 'badge-warning' : 'badge-primary';
                const actionBadgeText = isLogout ? 'Logout' : 'Login';
                const statusBadgeClass = success ? 'success-badge' : 'failed-badge';
                const statusBadgeText = success ? 'Success' : 'Failed';
                
                const row = `
                    <tr>
                        <td><span class="badge ${actionBadgeClass}">${actionBadgeText}</span></td>
                        <td class="log-timestamp">${timestamp}</td>
                        <td><strong>${log.username}</strong></td>
                        <td><span class="badge badge-info">${log.role}</span></td>
                        <td><span class="badge ${statusBadgeClass}">${statusBadgeText}</span></td>
                        <td><small>${log.ip_address || '-'}</small></td>
                        <td><small class="text-muted">${log.user_agent ? log.user_agent.substring(0, 50) + '...' : '-'}</small></td>
                        <td>${log.failure_reason || '-'}</td>
                    </tr>
                `;
                tbody.append(row);
            });

            // Initialize DataTable if not already initialized
            if (!dataTable) {
                dataTable = $('#loginLogsTable').DataTable({
                    order: [[1, 'desc']], // Order by timestamp column (2nd column)
                    pageLength: 25,
                    language: {
                        search: "Cari:",
                        lengthMenu: "Tampilkan _MENU_ entries",
                        info: "Menampilkan _START_ sampai _END_ dari _TOTAL_ entries",
                        paginate: {
                            first: "Pertama",
                            last: "Terakhir",
                            next: "Selanjutnya",
                            previous: "Sebelumnya"
                        }
                    }
                });
            } else {
                dataTable.clear().rows.add($('#loginLogsTable tbody tr')).draw();
            }
        }

        // Event handlers
        $('#refreshBtn').on('click', function() {
            loadLoginLogs();
        });

        $('#applyFiltersBtn').on('click', function() {
            currentFilters = {
                username: $('#filterUsername').val(),
                actionType: $('#filterAction').val(),
                successOnly: $('#filterSuccess').val() === 'true'
            };
            loadLoginLogs();
        });

        // Load on page load
        $(document).ready(function() {
            loadLoginLogs();
        });
    </script>
</body>

</html>

