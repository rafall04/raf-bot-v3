/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/sync-device-id.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/sync-device-id.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        let diffData = [];

        // Scan devices for differences
        async function scanDevices() {
            showProgress('Scanning...', 'Mengambil data dari GenieACS dan mencocokkan dengan database...');
            
            try {
                const response = await fetch('/api/users/device-id-diff');
                const result = await response.json();
                
                hideProgress();
                
                if (result.status !== 200) {
                    Swal.fire('Error', result.message || 'Gagal scan device', 'error');
                    return;
                }
                
                diffData = result.data || [];
                
                // Update stats
                document.getElementById('statTotal').textContent = result.stats?.total || 0;
                document.getElementById('statDiff').textContent = result.stats?.different || 0;
                document.getElementById('statSame').textContent = result.stats?.same || 0;
                document.getElementById('statNotFound').textContent = result.stats?.notFound || 0;
                
                // Show sections
                document.getElementById('statsSection').style.display = 'flex';
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';
                
                // Render table
                renderTable();
                
                if (diffData.length === 0) {
                    Swal.fire('Info', 'Semua Device ID sudah sesuai atau tidak ditemukan perbedaan', 'info');
                }
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        // Render table
        function renderTable() {
            const tbody = document.getElementById('tableBody');
            
            if (diffData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="empty-state">
                            <i class="fas fa-check-circle text-success"></i>
                            <p>Tidak ada Device ID yang perlu diupdate</p>
                        </td>
                    </tr>
                `;
                return;
            }
            
            tbody.innerHTML = diffData.map((item, index) => {
                return `
                    <tr data-index="${index}">
                        <td>
                            <input type="checkbox" class="row-check" data-index="${index}" onchange="updateSelection()">
                        </td>
                        <td>
                            <strong>${escapeHtml(item.name)}</strong>
                            <br><small class="text-muted">ID: ${item.id}</small>
                        </td>
                        <td><code>${escapeHtml(item.pppoe_username)}</code></td>
                        <td>
                            <span class="device-id-old">${escapeHtml(item.old_device_id || '-')}</span>
                        </td>
                        <td>
                            <span class="device-id-new">${escapeHtml(item.new_device_id)}</span>
                        </td>
                        <td><small>${escapeHtml(item.model || '-')}</small></td>
                        <td><span class="badge badge-diff">Perlu Update</span></td>
                    </tr>
                `;
            }).join('');
            
            updateSelection();
        }

        // Update selection count
        function updateSelection() {
            const checked = document.querySelectorAll('.row-check:checked').length;
            document.getElementById('selectedCount').textContent = checked;
            document.getElementById('btnSync').disabled = checked === 0;
        }

        // Toggle check all
        function toggleCheckAll() {
            const checkAll = document.getElementById('checkAll').checked;
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = checkAll;
            });
            updateSelection();
        }

        // Select all
        function selectAll() {
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = true;
            });
            document.getElementById('checkAll').checked = true;
            updateSelection();
        }

        // Deselect all
        function deselectAll() {
            document.querySelectorAll('.row-check').forEach(cb => {
                cb.checked = false;
            });
            document.getElementById('checkAll').checked = false;
            updateSelection();
        }

        // Sync devices
        async function syncDevices() {
            const selectedItems = [];
            
            document.querySelectorAll('.row-check:checked').forEach(cb => {
                const index = parseInt(cb.dataset.index);
                selectedItems.push({
                    userId: diffData[index].id,
                    newDeviceId: diffData[index].new_device_id
                });
            });
            
            if (selectedItems.length === 0) {
                Swal.fire('Peringatan', 'Pilih minimal satu pelanggan untuk disinkronkan', 'warning');
                return;
            }
            
            const confirm = await Swal.fire({
                title: 'Konfirmasi Sinkronisasi',
                html: `Anda akan mengupdate Device ID untuk <strong>${selectedItems.length}</strong> pelanggan.<br><br>Lanjutkan?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Sinkronkan',
                cancelButtonText: 'Batal'
            });
            
            if (!confirm.isConfirmed) return;
            
            showProgress('Menyinkronkan...', `Mengupdate ${selectedItems.length} Device ID...`);
            
            try {
                const response = await fetch('/api/users/sync-device-ids', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: selectedItems })
                });
                
                const result = await response.json();
                hideProgress();
                
                if (result.status === 200) {
                    const successCount = result.results?.success?.length || 0;
                    const failedCount = result.results?.failed?.length || 0;
                    
                    let message = `<strong>${successCount}</strong> Device ID berhasil diupdate.`;
                    if (failedCount > 0) {
                        message += `<br><strong>${failedCount}</strong> gagal.`;
                    }
                    
                    await Swal.fire({
                        title: 'Sinkronisasi Selesai',
                        html: message,
                        icon: failedCount > 0 ? 'warning' : 'success'
                    });
                    
                    // Refresh data
                    scanDevices();
                } else {
                    Swal.fire('Error', result.message || 'Gagal sinkronisasi', 'error');
                }
                
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        // Helper functions
        function showProgress(title, text) {
            document.getElementById('progressTitle').textContent = title;
            document.getElementById('progressText').textContent = text;
            document.getElementById('progressOverlay').style.display = 'flex';
        }

        function hideProgress() {
            document.getElementById('progressOverlay').style.display = 'none';
        }

        // Delegasi ke helper bersama (static/js/html-escape.js, dimuat lewat _head.php).


        // Implementasi lama memakai `div.textContent -> div.innerHTML`, yang HANYA meloloskan


        // & < > — TIDAK " maupun '. Dipakai untuk atribut atau argumen handler inline, nama


        // ber-apostrof (Ma'ruf, Nur'aini) memutus string dan tombolnya diam total.


        function escapeHtml(text) {


            return typeof rafEscapeHtml === 'function'


                ? rafEscapeHtml(text)


                : String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {


                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];


                });


        }
    
