<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Kasbon Teknisi</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        .stats-card { border-radius: 10px; transition: transform 0.2s; }
        .stats-card:hover { transform: translateY(-2px); }
        .stats-card .card-body { padding: 1.25rem; }
        .stats-icon { width: 50px; height: 50px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
        .stats-value { font-size: 1.75rem; font-weight: 700; }
        .stats-label { font-size: 0.85rem; color: #6c757d; }
        
        .badge-pending { background-color: #ffc107; color: #000; }
        .badge-approved { background-color: #28a745; color: white; }
        .badge-rejected { background-color: #dc3545; color: white; }
        .badge-paid { background-color: #17a2b8; color: white; }
        
        .kasbon-form { background: #f8f9fc; border-radius: 10px; padding: 20px; margin-bottom: 20px; }
        .kasbon-form h5 { color: #4e73df; margin-bottom: 15px; }
        
        .amount-input { font-size: 1.5rem; font-weight: 600; text-align: right; }
        .amount-preview { font-size: 1.25rem; color: #28a745; font-weight: 600; }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_role_aware_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_role_aware_teknisi_topbar.php'; ?>

                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <h1 class="h3 mb-0 text-gray-800">
                            <i class="fas fa-hand-holding-usd text-primary"></i> Kasbon Teknisi
                        </h1>
                        <button class="btn btn-primary btn-sm" id="refreshBtn">
                            <i class="fas fa-sync-alt"></i> Refresh Data
                        </button>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row mb-4">
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card stats-card border-left-warning shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label text-uppercase">Menunggu Approval</div>
                                            <div class="stats-value text-warning" id="pendingAmount">Rp 0</div>
                                        </div>
                                        <div class="stats-icon bg-warning text-white"><i class="fas fa-clock"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card stats-card border-left-success shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label text-uppercase">Saldo Hutang Aktif</div>
                                            <div class="stats-value text-success" id="approvedAmount">Rp 0</div>
                                        </div>
                                        <div class="stats-icon bg-success text-white"><i class="fas fa-check"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card stats-card border-left-info shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label text-uppercase">Total Cicilan/Lunas</div>
                                            <div class="stats-value text-info" id="paidAmount">Rp 0</div>
                                        </div>
                                        <div class="stats-icon bg-info text-white"><i class="fas fa-check-double"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-6 col-xl-3 mb-3">
                            <div class="card stats-card border-left-primary shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label text-uppercase">Total Pengajuan</div>
                                            <div class="stats-value text-primary" id="totalKasbon">0</div>
                                        </div>
                                        <div class="stats-icon bg-primary text-white"><i class="fas fa-list"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Form Pengajuan Kasbon -->
                    <div class="kasbon-form">
                        <h5><i class="fas fa-plus-circle"></i> Ajukan Kasbon Baru</h5>
                        <form id="kasbonForm">
                            <div class="row">
                                <div class="col-md-4">
                                    <div class="form-group">
                                        <label for="kasbonAmount">Nominal Kasbon</label>
                                        <input type="number" class="form-control amount-input" id="kasbonAmount" 
                                               placeholder="0" min="1000" max="10000000" required>
                                        <small class="form-text text-muted">Min: Rp 1.000 | Max: Rp 10.000.000</small>
                                    </div>
                                </div>
                                <div class="col-md-4">
                                    <div class="form-group">
                                        <label>Preview</label>
                                        <div class="amount-preview" id="amountPreview">Rp 0</div>
                                    </div>
                                </div>
                                <div class="col-md-4">
                                    <div class="form-group">
                                        <label for="kasbonDescription">Keterangan (Opsional)</label>
                                        <input type="text" class="form-control" id="kasbonDescription" 
                                               placeholder="Contoh: Keperluan operasional" maxlength="200">
                                    </div>
                                </div>
                            </div>
                            <button type="submit" class="btn btn-success" id="submitKasbonBtn">
                                <i class="fas fa-paper-plane"></i> Ajukan Kasbon
                            </button>
                        </form>
                    </div>

                    <!-- Data Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-history"></i> Riwayat Kasbon</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="kasbonTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Tanggal</th>
                                            <th>Nominal</th>
                                            <th>Keterangan</th>
                                            <th>Status</th>
                                            <th>Catatan Admin</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Konfirmasi Logout</h5>
                    <button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">Apakah Anda yakin ingin logout?</div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <a href="/logout" class="btn btn-primary">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Cancel Confirmation Modal -->
    <div class="modal fade" id="cancelModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title"><i class="fas fa-times-circle"></i> Batalkan Kasbon</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <p>Apakah Anda yakin ingin membatalkan pengajuan kasbon ini?</p>
                    <p><strong>ID:</strong> <span id="cancelKasbonId"></span></p>
                    <p><strong>Nominal:</strong> <span id="cancelKasbonAmount"></span></p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tidak</button>
                    <button type="button" class="btn btn-danger" id="confirmCancelBtn">Ya, Batalkan</button>
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
            fetch('/api/teknisi/me', { credentials: 'include' })
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

        function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
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
    </script>
</body>
</html>
