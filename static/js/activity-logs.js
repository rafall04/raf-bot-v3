/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/activity-logs.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/activity-logs.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        let dataTable;
        let currentFilters = {
            actionType: '',
            resourceType: '',
            userId: ''
        };

        function loadActivityLogs() {
            const params = new URLSearchParams({
                limit: 100,
                offset: 0,
                ...currentFilters
            });

            fetch(`/api/logs/activity?${params}`, {
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
                    $('#activityLogsBody').html('<tr><td colspan="7" class="text-center text-danger">Error loading logs: ' + (result.message || 'Unknown error') + '</td></tr>');
                }
            })
            .catch(error => {
                console.error('Error loading activity logs:', error);
                let errorMsg = error.message || 'Unknown error';
                if (errorMsg.includes('Akses ditolak') || errorMsg.includes('403')) {
                    errorMsg = 'Akses ditolak. Silakan login ulang atau hubungi administrator.';
                }
                $('#activityLogsBody').html('<tr><td colspan="7" class="text-center text-danger">' + errorMsg + '</td></tr>');
            });
        }

        function renderLogs(logs) {
            const tbody = $('#activityLogsBody');
            tbody.empty();

            if (logs.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center">No activity logs found</td></tr>');
                return;
            }

            logs.forEach(log => {
                const timestamp = new Date(log.timestamp).toLocaleString('id-ID');
                const actionClass = `action-${log.action_type}`;
                
                const row = `
                    <tr>
                        <td class="log-timestamp">${timestamp}</td>
                        <td>${log.username}</td>
                        <td><span class="badge badge-info">${log.role}</span></td>
                        <td><span class="badge ${actionClass} action-badge">${log.action_type}</span></td>
                        <td>
                            <strong>${log.resource_type}</strong>
                            ${log.resource_id ? `<br><small class="text-muted">ID: ${log.resource_id}</small>` : ''}
                            ${log.resource_name ? `<br><small class="text-muted">${log.resource_name}</small>` : ''}
                        </td>
                        <td>${log.description || '-'}</td>
                        <td><small>${log.ip_address || '-'}</small></td>
                    </tr>
                `;
                tbody.append(row);
            });

            // Initialize DataTable if not already initialized
            if (!dataTable) {
                dataTable = $('#activityLogsTable').DataTable({
                    order: [[0, 'desc']],
                    pageLength: 25
                });
            } else {
                dataTable.clear().rows.add($('#activityLogsTable tbody tr')).draw();
            }
        }

        // Event handlers
        $('#refreshBtn').on('click', function() {
            loadActivityLogs();
        });

        $('#applyFiltersBtn').on('click', function() {
            currentFilters = {
                actionType: $('#filterActionType').val(),
                resourceType: $('#filterResourceType').val(),
                userId: $('#filterUserId').val()
            };
            loadActivityLogs();
        });

        // Load on page load
        $(document).ready(function() {
            loadActivityLogs();
        });
    
