/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/login-logs.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/login-logs.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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
    
