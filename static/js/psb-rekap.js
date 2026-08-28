        let psbTable = null;
        let allPSBData = [];
        let filteredPSBData = [];

        $(document).ready(function() {
            initializeTable();
            loadPSBData();
            
            // Auto refresh every 30 seconds
            setInterval(function() {
                loadPSBData();
            }, 30000);
        });

        function initializeTable() {
            psbTable = $('#psbTable').DataTable({
                order: [[8, 'desc']], // Sort by date descending
                pageLength: 25,
                responsive: true,
                columnDefs: [
                    { targets: [0], width: '80px' },
                    { targets: [1], width: '150px' },
                    { targets: [2], width: '120px' },
                    { targets: [3], width: '200px' },
                    { targets: [4], width: '120px' },
                    { targets: [5], width: '120px' },
                    { targets: [6], width: '120px' },
                    { targets: [7], width: '120px' },
                    { targets: [8], width: '150px' },
                    { targets: [9], width: '120px' },
                    { targets: [10], width: '150px', orderable: false }
                ]
            });
        }

        function loadPSBData() {
            fetch('/api/psb/list-customers', {
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 200) {
                    allPSBData = data.data || [];
                    updateStatistics();
                    applyFilters();
                } else {
                    showMessage('error', data.message || 'Gagal memuat data PSB');
                }
            })
            .catch(err => {
                console.error('Error loading PSB data:', err);
                showMessage('error', 'Error saat memuat data PSB');
            });
        }

        function updateStatistics() {
            const stats = {
                total: allPSBData.length,
                phase1: allPSBData.filter(p => p.psb_status === 'phase1_completed').length,
                meluncur: allPSBData.filter(p => p.psb_status === 'teknisi_meluncur').length,
                phase2: allPSBData.filter(p => p.psb_status === 'phase2_completed').length,
                completed: allPSBData.filter(p => p.psb_status === 'completed').length
            };

            $('#stat-total').text(stats.total);
            $('#stat-phase1').text(stats.phase1);
            $('#stat-meluncur').text(stats.meluncur);
            $('#stat-phase2').text(stats.phase2);
            $('#stat-completed').text(stats.completed);
        }

        function applyFilters() {
            const status = $('#filter-status').val();
            const dateFrom = $('#filter-date-from').val();
            const dateTo = $('#filter-date-to').val();
            const search = $('#filter-search').val().toLowerCase();

            filteredPSBData = allPSBData.filter(psb => {
                // Status filter
                if (status && psb.psb_status !== status) return false;

                // Date filter
                if (dateFrom || dateTo) {
                    const psbDate = new Date(psb.created_at || psb.phase1_completed_at);
                    if (dateFrom) {
                        const fromDate = new Date(dateFrom);
                        fromDate.setHours(0, 0, 0, 0);
                        if (psbDate < fromDate) return false;
                    }
                    if (dateTo) {
                        const toDate = new Date(dateTo);
                        toDate.setHours(23, 59, 59, 999);
                        if (psbDate > toDate) return false;
                    }
                }

                // Search filter
                if (search) {
                    const searchText = `${psb.name || ''} ${psb.phone_number || ''} ${psb.address || ''}`.toLowerCase();
                    if (!searchText.includes(search)) return false;
                }

                return true;
            });

            populateTable();
        }

        function resetFilters() {
            $('#filter-status').val('');
            $('#filter-date-from').val('');
            $('#filter-date-to').val('');
            $('#filter-search').val('');
            applyFilters();
        }

        function populateTable() {
            if (psbTable) {
                psbTable.clear();
                
                filteredPSBData.forEach(psb => {
                    const statusBadge = getStatusBadge(psb.psb_status);
                    const date = formatDate(psb.created_at || psb.phase1_completed_at);
                    const teknisi = psb.created_by || '-';
                    const odcOdp = `${psb.odc_id || '-'} / ${psb.odp_id || '-'}`;
                    
                    psbTable.row.add([
                        psb.id || '-',
                        psb.name || '-',
                        psb.phone_number || '-',
                        (psb.address || '-').substring(0, 50) + (psb.address && psb.address.length > 50 ? '...' : ''),
                        statusBadge,
                        psb.subscription || '-',
                        psb.device_id || '-',
                        odcOdp,
                        date,
                        teknisi,
                        `<button class="btn btn-sm btn-info" onclick="showDetail(${psb.id})">
                            <i class="fas fa-eye"></i> Detail
                        </button>`
                    ]);
                });
                
                psbTable.draw();
            }
        }

        function getStatusBadge(status) {
            const statusMap = {
                'phase1_completed': { text: 'Phase 1 (Data Awal)', class: 'status-phase1_completed' },
                'teknisi_meluncur': { text: 'Teknisi Meluncur', class: 'status-teknisi_meluncur' },
                'phase2_completed': { text: 'Phase 2 (Instalasi)', class: 'status-phase2_completed' },
                'completed': { text: 'Selesai', class: 'status-completed' }
            };
            
            const statusInfo = statusMap[status] || { text: status, class: 'status-phase1_completed' };
            return `<span class="status-badge ${statusInfo.class}">${statusInfo.text}</span>`;
        }

        function formatDate(dateString) {
            if (!dateString) return '-';
            const date = new Date(dateString);
            return date.toLocaleDateString('id-ID', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        function showDetail(id) {
            const psb = allPSBData.find(p => p.id === id);
            if (!psb) {
                showMessage('error', 'Data PSB tidak ditemukan');
                return;
            }

            const psbData = psb.psb_data || {};
            const ktpPhoto = psbData.ktp_photo || '';
            const housePhoto = psbData.house_photo || '';
            
            // Get ODC/ODP data - check both top level and psb_data
            // Rencana (from Phase 1)
            const odcRencana = psb.odc_id || psbData.odc_id || null;
            const odpRencana = psb.odp_id || psbData.odp_id || null;
            
            // Terpasang (from Phase 2)
            const odcTerpasang = psb.installed_odc_id || psbData.installed_odc_id || null;
            const odpTerpasang = psb.installed_odp_id || psbData.installed_odp_id || null;

            let detailHtml = `
                <div class="detail-section">
                    <h6 class="mb-3"><i class="fas fa-user"></i> Data Pelanggan</h6>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">ID</div>
                            <div class="detail-value">${psb.id || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Nama</div>
                            <div class="detail-value">${psb.name || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Nomor HP</div>
                            <div class="detail-value">${psb.phone_number || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Alamat</div>
                            <div class="detail-value">${psb.address || '-'}</div>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h6 class="mb-3"><i class="fas fa-info-circle"></i> Status & Progress</h6>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Status</div>
                            <div class="detail-value">${getStatusBadge(psb.psb_status)}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Paket</div>
                            <div class="detail-value">${psb.subscription || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Tanggal Daftar</div>
                            <div class="detail-value">${formatDate(psb.created_at)}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Dibuat Oleh</div>
                            <div class="detail-value">${psb.created_by || '-'}</div>
                        </div>
                        ${psb.phase1_completed_at ? `
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Phase 1 Selesai</div>
                            <div class="detail-value">${formatDate(psb.phase1_completed_at)}</div>
                        </div>
                        ` : ''}
                        ${psb.phase2_completed_at ? `
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Phase 2 Selesai</div>
                            <div class="detail-value">${formatDate(psb.phase2_completed_at)}</div>
                        </div>
                        ` : ''}
                        ${psb.phase3_completed_at ? `
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Phase 3 Selesai</div>
                            <div class="detail-value">${formatDate(psb.phase3_completed_at)}</div>
                        </div>
                        ` : ''}
                    </div>
                </div>

                <div class="detail-section">
                    <h6 class="mb-3"><i class="fas fa-network-wired"></i> Data Instalasi</h6>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Device ID</div>
                            <div class="detail-value">${psb.device_id || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">PPPoE Username</div>
                            <div class="detail-value">${psb.pppoe_username || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">PPPoE Password</div>
                            <div class="detail-value">${psb.pppoe_password ? '••••••••' : '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">WiFi SSID</div>
                            <div class="detail-value">${psb.psb_wifi_ssid || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">WiFi Password</div>
                            <div class="detail-value">${psb.psb_wifi_password ? '••••••••' : '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">Port Number</div>
                            <div class="detail-value">${psb.port_number || psbData.port_number || '-'}</div>
                        </div>
                    </div>
                </div>

                <div class="detail-section">
                    <h6 class="mb-3"><i class="fas fa-sitemap"></i> Network Assets</h6>
                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">ODC (Rencana)</div>
                            <div class="detail-value">${odcRencana || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">ODP (Rencana)</div>
                            <div class="detail-value">${odpRencana || '-'}</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">ODC (Terpasang)</div>
                            <div class="detail-value">${odcTerpasang || '-'}</div>
                            ${odcRencana && odcTerpasang && odcRencana === odcTerpasang ? 
                                '<small class="text-success"><i class="fas fa-check"></i> Sesuai rencana</small>' :
                                odcRencana && odcTerpasang && odcRencana !== odcTerpasang ?
                                '<small class="text-warning"><i class="fas fa-exclamation-triangle"></i> Berbeda dari rencana</small>' :
                                ''
                            }
                        </div>
                        <div class="col-md-6 mb-3">
                            <div class="detail-label">ODP (Terpasang)</div>
                            <div class="detail-value">${odpTerpasang || '-'}</div>
                            ${odpRencana && odpTerpasang && odpRencana === odpTerpasang ? 
                                '<small class="text-success"><i class="fas fa-check"></i> Sesuai rencana</small>' :
                                odpRencana && odpTerpasang && odpRencana !== odpTerpasang ?
                                '<small class="text-warning"><i class="fas fa-exclamation-triangle"></i> Berbeda dari rencana</small>' :
                                ''
                            }
                        </div>
                    </div>
                </div>
            `;

            // Add photos if available
            if (ktpPhoto || housePhoto) {
                detailHtml += `
                    <div class="detail-section">
                        <h6 class="mb-3"><i class="fas fa-images"></i> Dokumen</h6>
                        <div class="row">
                            ${ktpPhoto ? `
                            <div class="col-md-6 mb-3">
                                <div class="detail-label">Foto KTP</div>
                                <img src="${ktpPhoto}" class="photo-preview" onclick="openPhotoModal('${ktpPhoto}')" alt="Foto KTP">
                            </div>
                            ` : ''}
                            ${housePhoto ? `
                            <div class="col-md-6 mb-3">
                                <div class="detail-label">Foto Rumah</div>
                                <img src="${housePhoto}" class="photo-preview" onclick="openPhotoModal('${housePhoto}')" alt="Foto Rumah">
                            </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }

            // Add location map if coordinates available
            if (psb.latitude && psb.longitude) {
                detailHtml += `
                    <div class="detail-section">
                        <h6 class="mb-3"><i class="fas fa-map-marker-alt"></i> Lokasi</h6>
                        <div class="map-preview" id="detail-map-${psb.id}"></div>
                        ${psb.location_url ? `
                        <div class="mt-2">
                            <a href="${psb.location_url}" target="_blank" class="btn btn-sm btn-outline-primary">
                                <i class="fas fa-external-link-alt"></i> Buka di Google Maps
                            </a>
                        </div>
                        ` : ''}
                    </div>
                `;
            }

            // Add installation notes if available
            const installationNotes = psb.installation_notes || psbData.installation_notes;
            if (installationNotes) {
                detailHtml += `
                    <div class="detail-section">
                        <h6 class="mb-3"><i class="fas fa-sticky-note"></i> Catatan Instalasi</h6>
                        <div class="detail-value">${installationNotes}</div>
                    </div>
                `;
            }

            $('#detail-content').html(detailHtml);
            $('#detailModal').modal('show');

            // Initialize map if coordinates available
            if (psb.latitude && psb.longitude) {
                setTimeout(() => {
                    const map = L.map(`detail-map-${psb.id}`).setView([psb.latitude, psb.longitude], 15);
                    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                        attribution: '© OpenStreetMap contributors'
                    }).addTo(map);
                    L.marker([psb.latitude, psb.longitude]).addTo(map)
                        .bindPopup(`<b>${psb.name || 'Lokasi'}</b><br>${psb.address || ''}`)
                        .openPopup();
                }, 100);
            }
        }

        function openPhotoModal(photoUrl) {
            Swal.fire({
                imageUrl: photoUrl,
                imageAlt: 'Photo',
                showCloseButton: true,
                showConfirmButton: false,
                width: '80%',
                padding: '0'
            });
        }

        function refreshData() {
            showMessage('info', 'Memuat ulang data...');
            loadPSBData();
        }

        function exportToExcel() {
            // Simple CSV export
            let csv = 'ID,Nama,HP,Alamat,Status,Paket,Device ID,ODC,ODP,Tanggal Daftar,Teknisi\n';
            
            filteredPSBData.forEach(psb => {
                const statusMap = {
                    'phase1_completed': 'Phase 1 (Data Awal)',
                    'teknisi_meluncur': 'Teknisi Meluncur',
                    'phase2_completed': 'Phase 2 (Instalasi)',
                    'completed': 'Selesai'
                };
                
                csv += `${psb.id || ''},${psb.name || ''},${psb.phone_number || ''},${(psb.address || '').replace(/,/g, ' ')},${statusMap[psb.psb_status] || psb.psb_status},${psb.subscription || ''},${psb.device_id || ''},${psb.odc_id || ''},${psb.odp_id || ''},${formatDate(psb.created_at)},${psb.created_by || ''}\n`;
            });
            
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `psb-rekap-${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            showMessage('success', 'Data berhasil diekspor');
        }

        function showMessage(type, message) {
            const alertClass = {
                'success': 'alert-success',
                'error': 'alert-danger',
                'warning': 'alert-warning',
                'info': 'alert-info'
            }[type] || 'alert-info';
            
            const icon = {
                'success': 'fa-check-circle',
                'error': 'fa-exclamation-circle',
                'warning': 'fa-exclamation-triangle',
                'info': 'fa-info-circle'
            }[type] || 'fa-info-circle';
            
            const html = `
                <div class="alert ${alertClass} alert-dismissible fade show" role="alert">
                    <i class="fas ${icon}"></i> ${message}
                    <button type="button" class="close" data-dismiss="alert">
                        <span>&times;</span>
                    </button>
                </div>
            `;
            $('#message-container').html(html);
            
            setTimeout(() => {
                $('#message-container .alert').fadeOut();
            }, 5000);
        }

        // Show delete all modal
        function showDeleteAllModal() {
            if (allPSBData.length === 0) {
                Swal.fire({
                    icon: 'info',
                    title: 'Tidak Ada Data',
                    text: 'Tidak ada data PSB yang bisa dihapus.'
                });
                return;
            }
            
            $('#delete-count').text(allPSBData.length);
            $('#delete-password').val('');
            $('#deleteAllModal').modal('show');
        }

        // Confirm delete all with password verification
        function confirmDeleteAll() {
            const password = $('#delete-password').val();
            
            if (!password) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Password Diperlukan',
                    text: 'Masukkan password Anda untuk konfirmasi.'
                });
                return;
            }
            
            // Disable button to prevent double click
            $('#confirm-delete-btn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');
            
            fetch('/api/psb/delete-all', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password: password }),
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                $('#confirm-delete-btn').prop('disabled', false).html('<i class="fas fa-trash-alt"></i> Hapus Semua Data');
                
                if (data.status === 200) {
                    $('#deleteAllModal').modal('hide');
                    Swal.fire({
                        icon: 'success',
                        title: 'Berhasil!',
                        text: data.message || 'Semua data PSB berhasil dihapus.'
                    }).then(() => {
                        loadPSBData();
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Gagal',
                        text: data.message || 'Gagal menghapus data PSB.'
                    });
                }
            })
            .catch(err => {
                $('#confirm-delete-btn').prop('disabled', false).html('<i class="fas fa-trash-alt"></i> Hapus Semua Data');
                console.error('Delete all error:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Terjadi kesalahan saat menghapus data.'
                });
            });
        }
