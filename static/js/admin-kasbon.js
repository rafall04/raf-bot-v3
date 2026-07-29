/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/admin-kasbon.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/admin-kasbon.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        let allKasbon = [];
        let dataTable = null;
        let currentFilter = 'all';
        let selectedKasbon = null;

        $(document).ready(function() {
            loadKasbonData();
            setupEventHandlers();
        });

        function loadKasbonData() {
            $('#refreshBtn').prop('disabled', true);
            
            fetch('/api/kasbon', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200) {
                        allKasbon = data.data || [];
                        updateStats();
                        renderTable();
                    }
                })
                .catch(console.error)
                .finally(() => $('#refreshBtn').prop('disabled', false));
        }

        function updateStats() {
            const pending = allKasbon.filter(k => k.status === 'pending');
            const approved = allKasbon.filter(k => (k.financial_status || k.status) === 'approved');
            const paid = allKasbon.filter(k => (k.financial_status || k.status) === 'paid');
            
            $('#pendingCount').text(pending.length);
            $('#approvedAmount').text(formatCurrency(approved.reduce((sum, k) => sum + (k.approved_amount || k.amount || 0), 0)));
            $('#outstandingAmount').text(formatCurrency(approved.reduce((sum, k) => sum + (k.remaining_amount || 0), 0)));
            $('#paidAmount').text(formatCurrency(allKasbon.reduce((sum, k) => sum + (k.paid_amount || 0), 0)));
        }

        function formatCurrency(amount) {
            return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
        }

        function formatDate(dateStr) {
            if (!dateStr) return '-';
            return new Date(dateStr).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' });
        }

        function getStatusBadge(status) {
            const badges = {
                'pending': '<span class="badge badge-pending">Menunggu</span>',
                'approved': '<span class="badge badge-approved">Disetujui</span>',
                'rejected': '<span class="badge badge-rejected">Ditolak</span>',
                'paid': '<span class="badge badge-paid">Lunas</span>'
            };
            return badges[status] || status;
        }

        function renderTable() {
            if (dataTable) dataTable.destroy();

            let filtered = allKasbon;
            if (currentFilter !== 'all') {
                filtered = allKasbon.filter(k => (k.financial_status || k.status) === currentFilter || k.status === currentFilter);
            }

            const tbody = $('#kasbonTable tbody');
            tbody.empty();

            filtered.forEach(kasbon => {
                let actions = '';
                const displayStatus = kasbon.financial_status || kasbon.status;
                if (kasbon.status === 'pending') {
                    actions = `<button class="btn btn-sm btn-primary" onclick="openActionModal(${kasbon.id})"><i class="fas fa-cog"></i> Proses</button>`;
                } else if (displayStatus === 'approved') {
                    actions = `<button class="btn btn-sm btn-info" onclick="openPaidModal(${kasbon.id})"><i class="fas fa-check-double"></i> Lunas</button>`;
                }

                tbody.append(`
                    <tr>
                        <td>#${kasbon.id}</td>
                        <td>${escapeHtml(kasbon.teknisi_name || 'ID: ' + kasbon.teknisi_id)}</td>
                        <td>${formatDate(kasbon.created_at)}</td>
                        <td class="text-right font-weight-bold">${formatCurrency(kasbon.amount)}<small class="d-block text-muted">Sisa: ${formatCurrency(kasbon.remaining_amount || 0)}</small></td>
                        <td>${escapeHtml(kasbon.description || '-')}</td>
                        <td>${getStatusBadge(displayStatus)}</td>
                        <td>${actions}</td>
                    </tr>
                `);
            });

            dataTable = $('#kasbonTable').DataTable({
                order: [[0, 'desc']],
                pageLength: 25,
                language: { search: "Cari:", lengthMenu: "Tampilkan _MENU_", info: "_START_-_END_ dari _TOTAL_", zeroRecords: "Tidak ada data" }
            });
        }

        function setupEventHandlers() {
            $('#refreshBtn').on('click', loadKasbonData);
            
            $('.filter-tab').on('click', function() {
                $('.filter-tab').removeClass('active');
                $(this).addClass('active');
                currentFilter = $(this).data('filter');
                renderTable();
            });

            $('#approveBtn').on('click', () => processKasbon(true));
            $('#rejectBtn').on('click', () => processKasbon(false));
            $('#confirmPaidBtn').on('click', markAsPaid);
        }

        function openActionModal(id) {
            selectedKasbon = allKasbon.find(k => k.id === id);
            if (!selectedKasbon) return;
            
            $('#modalTeknisi').text(selectedKasbon.teknisi_name || 'ID: ' + selectedKasbon.teknisi_id);
            $('#modalAmount').text(formatCurrency(selectedKasbon.amount));
            $('#modalDesc').text(selectedKasbon.description || '-');
            $('#actionNotes').val('');
            $('#actionModal').modal('show');
        }

        function openPaidModal(id) {
            selectedKasbon = allKasbon.find(k => k.id === id);
            if (!selectedKasbon) return;
            
            $('#paidTeknisi').text(selectedKasbon.teknisi_name || 'ID: ' + selectedKasbon.teknisi_id);
            $('#paidAmount2').text(formatCurrency(selectedKasbon.remaining_amount || selectedKasbon.amount));
            $('#paidModal').modal('show');
        }

        function processKasbon(approved) {
            if (!selectedKasbon) return;
            
            const btn = approved ? $('#approveBtn') : $('#rejectBtn');
            btn.prop('disabled', true);

            fetch(`/api/kasbon/${selectedKasbon.id}/approve`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ approved, notes: $('#actionNotes').val() })
            })
            .then(res => res.json())
            .then(data => {
                $('#actionModal').modal('hide');
                if (data.status === 200) {
                    showAlert('success', data.message);
                    loadKasbonData();
                } else {
                    showAlert('danger', data.message);
                }
            })
            .catch(() => showAlert('danger', 'Terjadi kesalahan'))
            .finally(() => btn.prop('disabled', false));
        }

        function markAsPaid() {
            if (!selectedKasbon) return;
            
            $('#confirmPaidBtn').prop('disabled', true);

            fetch(`/api/kasbon/${selectedKasbon.id}/paid`, {
                method: 'PUT',
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                $('#paidModal').modal('hide');
                if (data.status === 200) {
                    showAlert('success', 'Kasbon berhasil ditandai lunas');
                    loadKasbonData();
                } else {
                    showAlert('danger', data.message);
                }
            })
            .catch(() => showAlert('danger', 'Terjadi kesalahan'))
            .finally(() => $('#confirmPaidBtn').prop('disabled', false));
        }

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function showAlert(type, message) {
            $('.container-fluid').prepend(`
                <div class="alert alert-${type} alert-dismissible fade show">
                    ${message}
                    <button type="button" class="close" data-dismiss="alert"><span>&times;</span></button>
                </div>
            `);
            setTimeout(() => $('.alert').alert('close'), 5000);
        }
    
