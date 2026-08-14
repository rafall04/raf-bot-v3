/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/teknisi-kasbon.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/teknisi-kasbon.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        let allKasbon = [];
        let dataTable = null;
        let kasbonToCancel = null;

        $(document).ready(function() {
            loadTechnicianInfo();
            loadKasbonData();
            loadSummary();
            setupEventHandlers();
        });

        function loadTechnicianInfo() {
            fetch('/api/me', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && data.data) {
                        $('#loggedInTechnicianInfo').text(data.data.name || 'Teknisi');
                    }
                })
                .catch(() => $('#loggedInTechnicianInfo').text('Teknisi'));
        }

        function loadSummary() {
            fetch('/api/kasbon/summary', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && data.data) {
                        $('#pendingAmount').text(formatCurrency(data.data.pending_amount));
                        $('#approvedAmount').text(formatCurrency(data.data.approved_amount));
                        $('#paidAmount').text(formatCurrency(data.data.paid_amount));
                        $('#totalKasbon').text(data.data.total_kasbon);
                    }
                })
                .catch(err => console.error('Error loading summary:', err));
        }

        function loadKasbonData() {
            $('#refreshBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memuat...');
            
            fetch('/api/kasbon', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200 && Array.isArray(data.data)) {
                        allKasbon = data.data;
                        renderTable();
                    } else {
                        showAlert('danger', 'Gagal memuat data kasbon');
                    }
                })
                .catch(err => {
                    console.error('Error:', err);
                    showAlert('danger', 'Terjadi kesalahan saat memuat data');
                })
                .finally(() => {
                    $('#refreshBtn').prop('disabled', false).html('<i class="fas fa-sync-alt"></i> Refresh Data');
                });
        }

        function formatCurrency(amount) {
            return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
        }

        function formatDate(dateStr) {
            if (!dateStr) return '-';
            return new Date(dateStr).toLocaleString('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Jakarta'
            });
        }

        function getStatusBadge(status) {
            const badges = {
                'pending': '<span class="badge badge-pending"><i class="fas fa-clock"></i> Menunggu</span>',
                'approved': '<span class="badge badge-approved"><i class="fas fa-check"></i> Disetujui</span>',
                'rejected': '<span class="badge badge-rejected"><i class="fas fa-times"></i> Ditolak</span>',
                'paid': '<span class="badge badge-paid"><i class="fas fa-check-double"></i> Lunas</span>'
            };
            return badges[status] || `<span class="badge badge-secondary">${status}</span>`;
        }

        function renderTable() {
            if (dataTable) dataTable.destroy();

            const tbody = $('#kasbonTable tbody');
            tbody.empty();

            allKasbon.forEach(kasbon => {
                let actionBtn = '';
                const displayStatus = kasbon.financial_status || kasbon.status;
                if (kasbon.status === 'pending') {
                    actionBtn = `<button class="btn btn-danger btn-sm" onclick="openCancelModal(${kasbon.id}, ${kasbon.amount})" title="Batalkan">
                        <i class="fas fa-times"></i>
                    </button>`;
                }

                const row = `
                    <tr>
                        <td><strong>#${kasbon.id}</strong></td>
                        <td>${formatDate(kasbon.created_at)}</td>
                        <td class="text-right font-weight-bold">${formatCurrency(kasbon.amount)}<small class="d-block text-muted">Sisa: ${formatCurrency(kasbon.remaining_amount || 0)}</small></td>
                        <td>${escapeHtml(kasbon.description || '-')}</td>
                        <td>${getStatusBadge(displayStatus)}</td>
                        <td>${escapeHtml(kasbon.notes || '-')}${(kasbon.paid_amount || 0) > 0 ? `<small class="d-block text-success">Terbayar: ${formatCurrency(kasbon.paid_amount)}</small>` : ''}</td>
                        <td>${actionBtn}</td>
                    </tr>
                `;
                tbody.append(row);
            });

            dataTable = $('#kasbonTable').DataTable({
                order: [[0, 'desc']],
                pageLength: 10,
                language: {
                    search: "Cari:",
                    lengthMenu: "Tampilkan _MENU_ data",
                    info: "Menampilkan _START_ - _END_ dari _TOTAL_ data",
                    infoEmpty: "Tidak ada data",
                    zeroRecords: "Tidak ada data yang cocok",
                    paginate: { first: "Pertama", last: "Terakhir", next: "Selanjutnya", previous: "Sebelumnya" }
                }
            });
        }

        function setupEventHandlers() {
            $('#refreshBtn').on('click', function() {
                loadKasbonData();
                loadSummary();
            });

            $('#kasbonAmount').on('input', function() {
                const amount = parseInt($(this).val()) || 0;
                $('#amountPreview').text(formatCurrency(amount));
            });

            $('#kasbonForm').on('submit', function(e) {
                e.preventDefault();
                submitKasbon();
            });

            $('#confirmCancelBtn').on('click', cancelKasbon);
        }

        function submitKasbon() {
            const amount = parseInt($('#kasbonAmount').val());
            const description = $('#kasbonDescription').val().trim();

            if (!amount || amount < 1000) {
                showAlert('warning', 'Nominal kasbon minimal Rp 1.000');
                return;
            }

            if (amount > 10000000) {
                showAlert('warning', 'Nominal kasbon maksimal Rp 10.000.000');
                return;
            }

            const btn = $('#submitKasbonBtn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Mengirim...');

            fetch('/api/kasbon', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ amount, description })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 201) {
                    showAlert('success', 'Pengajuan kasbon berhasil dikirim! Menunggu approval admin.');
                    $('#kasbonForm')[0].reset();
                    $('#amountPreview').text('Rp 0');
                    loadKasbonData();
                    loadSummary();
                } else {
                    showAlert('danger', data.message || 'Gagal mengajukan kasbon');
                }
            })
            .catch(err => {
                console.error('Error:', err);
                showAlert('danger', 'Terjadi kesalahan saat mengirim pengajuan');
            })
            .finally(() => {
                btn.prop('disabled', false).html('<i class="fas fa-paper-plane"></i> Ajukan Kasbon');
            });
        }

        function openCancelModal(id, amount) {
            kasbonToCancel = id;
            $('#cancelKasbonId').text('#' + id);
            $('#cancelKasbonAmount').text(formatCurrency(amount));
            $('#cancelModal').modal('show');
        }

        function cancelKasbon() {
            if (!kasbonToCancel) return;

            const btn = $('#confirmCancelBtn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');

            fetch(`/api/kasbon/${kasbonToCancel}`, {
                method: 'DELETE',
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                $('#cancelModal').modal('hide');
                if (data.status === 200) {
                    showAlert('success', 'Kasbon berhasil dibatalkan');
                    loadKasbonData();
                    loadSummary();
                } else {
                    showAlert('danger', data.message || 'Gagal membatalkan kasbon');
                }
            })
            .catch(err => {
                console.error('Error:', err);
                showAlert('danger', 'Terjadi kesalahan');
            })
            .finally(() => {
                btn.prop('disabled', false).html('Ya, Batalkan');
                kasbonToCancel = null;
            });
        }

        function setKasbonAmount(delta) {
            const input = document.getElementById('kasbonAmount');
            if (delta === 0) {
                input.value = '';
            } else {
                const current = parseInt(input.value) || 0;
                input.value = Math.min(current + delta, 10000000);
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
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

        function showAlert(type, message) {
            const alertHtml = `
                <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                    ${message}
                    <button type="button" class="close" data-dismiss="alert"><span>&times;</span></button>
                </div>
            `;
            $('.container-fluid').prepend(alertHtml);
            setTimeout(() => $('.alert').alert('close'), 5000);
        }
    
