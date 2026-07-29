/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/wifi-logs.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/wifi-logs.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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
                    'web_customer': '<span class="badge badge-primary log-source">Portal Pelanggan</span>',
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
    
