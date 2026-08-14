/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/bulk-ssid-diff.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/bulk-ssid-diff.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        let diffData = [];

        function fmtBulk(arr) {
            if (!Array.isArray(arr) || arr.length === 0) return '(kosong)';
            return arr.map((x) => 'SSID ' + x).join(', ');
        }

        // Scan perbedaan bulk vs kapabilitas modem
        async function scanBulk() {
            showProgress('Scanning...', 'Mengambil data modem dari GenieACS dan membandingkan dengan kolom bulk...');

            try {
                const response = await fetch('/api/users/bulk-diff');
                const result = await response.json();

                hideProgress();

                if (result.status !== 200) {
                    Swal.fire('Error', result.message || 'Gagal scan bulk SSID', 'error');
                    return;
                }

                diffData = result.data || [];

                document.getElementById('statTotal').textContent = result.stats?.total || 0;
                document.getElementById('statDiff').textContent = result.stats?.different || 0;
                document.getElementById('statSame').textContent = result.stats?.same || 0;
                document.getElementById('statNotFound').textContent = result.stats?.notFound || 0;

                document.getElementById('statsSection').style.display = 'flex';
                document.getElementById('emptyState').style.display = 'none';
                document.getElementById('mainContent').style.display = 'block';

                renderTable();

                if (diffData.length === 0) {
                    Swal.fire('Info', 'Semua bulk SSID sudah sesuai dengan kapabilitas modem', 'info');
                }
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

        function renderTable() {
            const tbody = document.getElementById('tableBody');

            if (diffData.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="empty-state">
                            <i class="fas fa-check-circle text-success"></i>
                            <p>Tidak ada bulk SSID yang perlu disesuaikan</p>
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
                        <td><span class="device-id-mono">${escapeHtml(item.device_id || '-')}</span></td>
                        <td><small>${escapeHtml(item.model || '-')}</small> ${item.has5G ? '<span class="badge badge-info">dual-band</span>' : ''}</td>
                        <td><span class="bulk-old">${escapeHtml(fmtBulk(item.current_bulk))}</span></td>
                        <td><span class="bulk-new">${escapeHtml(fmtBulk(item.expected_bulk))}</span></td>
                        <td><span class="badge badge-diff">Perlu Disesuaikan</span></td>
                    </tr>
                `;
            }).join('');

            updateSelection();
        }

        function updateSelection() {
            const checked = document.querySelectorAll('.row-check:checked').length;
            document.getElementById('selectedCount').textContent = checked;
            document.getElementById('btnSync').disabled = checked === 0;
        }

        function toggleCheckAll() {
            const checkAll = document.getElementById('checkAll').checked;
            document.querySelectorAll('.row-check').forEach((cb) => { cb.checked = checkAll; });
            updateSelection();
        }

        function selectAll() {
            document.querySelectorAll('.row-check').forEach((cb) => { cb.checked = true; });
            document.getElementById('checkAll').checked = true;
            updateSelection();
        }

        function deselectAll() {
            document.querySelectorAll('.row-check').forEach((cb) => { cb.checked = false; });
            document.getElementById('checkAll').checked = false;
            updateSelection();
        }

        // Terapkan koreksi bulk
        async function syncBulk() {
            const selectedItems = [];

            document.querySelectorAll('.row-check:checked').forEach((cb) => {
                const index = parseInt(cb.dataset.index);
                selectedItems.push({
                    userId: diffData[index].id,
                    bulk: diffData[index].expected_bulk
                });
            });

            if (selectedItems.length === 0) {
                Swal.fire('Peringatan', 'Pilih minimal satu pelanggan untuk disinkronkan', 'warning');
                return;
            }

            const confirm = await Swal.fire({
                title: 'Konfirmasi Penyesuaian',
                html: `Anda akan menyesuaikan kolom <strong>bulk</strong> untuk <strong>${selectedItems.length}</strong> pelanggan.<br><br>` +
                    `Ini hanya mengubah daftar SSID yang dikelola (tidak mengubah sandi WiFi). Lanjutkan?`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Ya, Sinkronkan',
                cancelButtonText: 'Batal'
            });

            if (!confirm.isConfirmed) return;

            showProgress('Menyinkronkan...', `Mengupdate ${selectedItems.length} kolom bulk...`);

            try {
                const response = await fetch('/api/users/sync-bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: selectedItems })
                });

                const result = await response.json();
                hideProgress();

                if (result.status === 200) {
                    const successCount = result.results?.success?.length || 0;
                    const failedCount = result.results?.failed?.length || 0;

                    let message = `<strong>${successCount}</strong> bulk SSID berhasil disesuaikan.`;
                    if (failedCount > 0) {
                        message += `<br><strong>${failedCount}</strong> gagal.`;
                    }

                    await Swal.fire({
                        title: 'Penyesuaian Selesai',
                        html: message,
                        icon: failedCount > 0 ? 'warning' : 'success'
                    });

                    scanBulk();
                } else {
                    Swal.fire('Error', result.message || 'Gagal sinkronisasi', 'error');
                }
            } catch (error) {
                hideProgress();
                Swal.fire('Error', 'Gagal menghubungi server: ' + error.message, 'error');
            }
        }

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

        // & < > — TIDAK " maupun '. Untuk atribut/argumen handler, nama ber-apostrof memutus string.

        function escapeHtml(text) {

            return typeof rafEscapeHtml === 'function'

                ? rafEscapeHtml(text)

                : String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {

                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];

                });

        }
    
