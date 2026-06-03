<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Kelola Kasbon Teknisi</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        .stats-card { border-radius: 10px; transition: transform 0.2s; }
        .stats-card:hover { transform: translateY(-2px); }
        .stats-value { font-size: 1.5rem; font-weight: 700; }
        .stats-label { font-size: 0.85rem; color: #6c757d; }
        
        .badge-pending { background-color: #ffc107; color: #000; }
        .badge-approved { background-color: #28a745; color: white; }
        .badge-rejected { background-color: #dc3545; color: white; }
        .badge-paid { background-color: #17a2b8; color: white; }
        
        .filter-tabs { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .filter-tab { padding: 8px 16px; border-radius: 20px; cursor: pointer; border: 2px solid #e3e6f0; background: white; transition: all 0.2s; font-weight: 500; }
        .filter-tab:hover { border-color: #4e73df; }
        .filter-tab.active { background: #4e73df; color: white; border-color: #4e73df; }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>

                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <h1 class="h3 mb-0 text-gray-800">
                            <i class="fas fa-hand-holding-usd text-primary"></i> Kelola Kasbon Teknisi
                        </h1>
                        <button class="btn btn-primary btn-sm" id="refreshBtn">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>

                    <!-- Stats Cards -->
                    <div class="row mb-4">
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-warning shadow h-100">
                                <div class="card-body">
                                    <div class="stats-label text-uppercase">Menunggu Approval</div>
                                    <div class="stats-value text-warning" id="pendingCount">0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-success shadow h-100">
                                <div class="card-body">
                                    <div class="stats-label text-uppercase">Total Disetujui</div>
                                    <div class="stats-value text-success" id="approvedAmount">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-danger shadow h-100">
                                <div class="card-body">
                                    <div class="stats-label text-uppercase">Belum Lunas</div>
                                    <div class="stats-value text-danger" id="outstandingAmount">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-info shadow h-100">
                                <div class="card-body">
                                    <div class="stats-label text-uppercase">Total Lunas</div>
                                    <div class="stats-value text-info" id="paidAmount">Rp 0</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Filter Tabs -->
                    <div class="filter-tabs">
                        <div class="filter-tab active" data-filter="all">Semua</div>
                        <div class="filter-tab" data-filter="pending">Menunggu</div>
                        <div class="filter-tab" data-filter="approved">Aktif</div>
                        <div class="filter-tab" data-filter="rejected">Ditolak</div>
                        <div class="filter-tab" data-filter="paid">Lunas</div>
                    </div>

                    <!-- Data Table -->
                    <div class="card shadow mb-4">
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="kasbonTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Teknisi</th>
                                            <th>Tanggal</th>
                                            <th>Nominal</th>
                                            <th>Keterangan</th>
                                            <th>Status</th>
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

    <!-- Approve/Reject Modal -->
    <div class="modal fade" id="actionModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header" id="actionModalHeader">
                    <h5 class="modal-title" id="actionModalTitle">Proses Kasbon</h5>
                    <button type="button" class="close" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <p><strong>Teknisi:</strong> <span id="modalTeknisi"></span></p>
                    <p><strong>Nominal:</strong> <span id="modalAmount"></span></p>
                    <p><strong>Keterangan:</strong> <span id="modalDesc"></span></p>
                    <div class="form-group">
                        <label for="actionNotes">Catatan Admin</label>
                        <textarea class="form-control" id="actionNotes" rows="2" placeholder="Catatan (opsional)"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-danger" id="rejectBtn">
                        <i class="fas fa-times"></i> Tolak
                    </button>
                    <button type="button" class="btn btn-success" id="approveBtn">
                        <i class="fas fa-check"></i> Setujui
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Mark as Paid Modal -->
    <div class="modal fade" id="paidModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header bg-info text-white">
                    <h5 class="modal-title"><i class="fas fa-check-double"></i> Tandai Lunas</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <p>Tandai kasbon ini sebagai <strong>LUNAS</strong>?</p>
                    <p><strong>Teknisi:</strong> <span id="paidTeknisi"></span></p>
                    <p><strong>Nominal:</strong> <span id="paidAmount2"></span></p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-info" id="confirmPaidBtn">
                        <i class="fas fa-check-double"></i> Ya, Tandai Lunas
                    </button>
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
    </script>
</body>
</html>
