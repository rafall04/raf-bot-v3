<!DOCTYPE html>
<html lang="id">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - Diskon Pelanggan</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <style>
        .discount-card { border-radius: 12px; transition: transform 0.2s; }
        .discount-card:hover { transform: translateY(-2px); }
        .price-original { text-decoration: line-through; color: #6c757d; font-size: 0.9rem; }
        .price-final { color: #28a745; font-weight: 700; font-size: 1.1rem; }
        .discount-badge { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; }
        .select2-container { width: 100% !important; }
        .select2-container--default .select2-selection--single { height: 38px; border: 1px solid #d1d3e2; border-radius: 6px; }
        .select2-container--default .select2-selection--single .select2-selection__rendered { line-height: 36px; color: #6e707e; }
        .select2-container--default .select2-selection--single .select2-selection__arrow { height: 36px; }
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
                            <i class="fas fa-tags text-primary"></i> Diskon Pelanggan
                        </h1>
                        <button class="btn btn-primary btn-sm" id="refreshBtn">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>

                    <!-- Form Tambah Diskon -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
                            <h6 class="m-0 font-weight-bold text-white"><i class="fas fa-plus-circle"></i> Tambah/Edit Diskon Pelanggan</h6>
                        </div>
                        <div class="card-body">
                            <form id="discountForm">
                                <div class="row">
                                    <div class="col-md-4">
                                        <div class="form-group">
                                            <label for="customerSelect">Pilih Pelanggan</label>
                                            <select id="customerSelect" class="form-control" required>
                                                <option value="">-- Pilih Pelanggan --</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="form-group">
                                            <label for="discountAmount">Diskon Nominal (Rp)</label>
                                            <input type="number" class="form-control" id="discountAmount" placeholder="Contoh: 75000" min="0">
                                            <small class="form-text text-muted">Masukkan jumlah potongan dalam Rupiah</small>
                                        </div>
                                    </div>
                                    <div class="col-md-3">
                                        <div class="form-group">
                                            <label for="discountReason">Alasan Diskon</label>
                                            <input type="text" class="form-control" id="discountReason" placeholder="Contoh: Pelanggan setia">
                                        </div>
                                    </div>
                                    <div class="col-md-2">
                                        <div class="form-group">
                                            <label for="discountMonths">Periode (Bulan)</label>
                                            <select class="form-control" id="discountMonths">
                                                <option value="1">1 bulan</option>
                                                <option value="2">2 bulan</option>
                                                <option value="3">3 bulan</option>
                                                <option value="6">6 bulan</option>
                                                <option value="12">12 bulan</option>
                                            </select>
                                            <small class="form-text text-muted">Diskon berlaku berapa bulan</small>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Preview -->
                                <div id="discountPreview" class="alert alert-info" style="display: none;">
                                    <div class="row align-items-center">
                                        <div class="col-md-8">
                                            <strong id="previewName">-</strong> | Paket: <span id="previewPackage">-</span><br>
                                            <span class="price-original">Harga Normal: <span id="previewOriginal">Rp 0</span></span><br>
                                            <span class="price-final">Harga Setelah Diskon: <span id="previewFinal">Rp 0</span></span>
                                            <span class="discount-badge ml-2">Hemat <span id="previewSaving">Rp 0</span></span>
                                        </div>
                                        <div class="col-md-4 text-right">
                                            <button type="submit" class="btn btn-success" id="saveDiscountBtn">
                                                <i class="fas fa-save"></i> Simpan Diskon
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </form>
                        </div>
                    </div>

                    <!-- Daftar Pelanggan dengan Diskon -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary"><i class="fas fa-list"></i> Pelanggan dengan Diskon Aktif</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="discountTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama Pelanggan</th>
                                            <th>Paket</th>
                                            <th>Harga Normal</th>
                                            <th>Diskon</th>
                                            <th>Harga Final</th>
                                            <th>Alasan</th>
                                            <th>Sisa Periode</th>
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

    <!-- Delete Confirmation Modal -->
    <div class="modal fade" id="deleteModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title"><i class="fas fa-trash"></i> Hapus Diskon</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <p>Hapus diskon untuk pelanggan <strong id="deleteCustomerName"></strong>?</p>
                    <p>Pelanggan akan kembali membayar harga normal.</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-danger" id="confirmDeleteBtn">
                        <i class="fas fa-trash"></i> Ya, Hapus Diskon
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
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

    <script>
        let allCustomers = [];
        let allPackages = [];
        let discountedUsers = [];
        let dataTable = null;
        let selectedCustomerId = null;
        let deleteUserId = null;

        $(document).ready(function() {
            loadCustomers();
            loadPackages();
            loadDiscountedUsers();
            setupEventHandlers();
            
            $('#customerSelect').select2({
                placeholder: '-- Pilih Pelanggan --',
                allowClear: true
            });
        });

        function loadCustomers() {
            fetch('/api/users', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200) {
                        allCustomers = data.data || [];
                        populateCustomerSelect();
                    }
                })
                .catch(console.error);
        }

        function loadPackages() {
            fetch('/api/packages', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200) {
                        allPackages = data.data || [];
                    }
                })
                .catch(console.error);
        }

        function loadDiscountedUsers() {
            fetch('/api/discount/list/all', { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.status === 200) {
                        discountedUsers = data.data || [];
                        renderTable();
                    }
                })
                .catch(console.error);
        }

        function populateCustomerSelect() {
            const select = $('#customerSelect');
            select.find('option:not(:first)').remove();
            
            allCustomers.forEach(c => {
                select.append(`<option value="${c.id}" data-subscription="${c.subscription || ''}" data-price="${c.subscription_price || 0}">${c.name} - ${c.subscription || 'Tanpa Paket'}</option>`);
            });
        }

        function getPackagePrice(packageName) {
            if (!packageName) return 0;
            const pkg = allPackages.find(p => p.name === packageName);
            if (pkg && pkg.price) return pkg.price;
            const match = packageName.match(/([0-9]+)K/i);
            if (match) return parseInt(match[1]) * 1000;
            return 0;
        }

        function formatCurrency(amount) {
            return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
        }

        function formatDate(dateStr) {
            if (!dateStr) return 'Selamanya';
            return new Date(dateStr).toLocaleDateString('id-ID', { dateStyle: 'medium' });
        }

        function setupEventHandlers() {
            $('#refreshBtn').on('click', function() {
                loadCustomers();
                loadDiscountedUsers();
            });

            $('#customerSelect').on('change', function() {
                selectedCustomerId = $(this).val();
                updatePreview();
            });

            $('#discountAmount').on('input', updatePreview);

            $('#discountForm').on('submit', function(e) {
                e.preventDefault();
                saveDiscount();
            });

            $('#confirmDeleteBtn').on('click', deleteDiscount);
        }

        function updatePreview() {
            const customerId = $('#customerSelect').val();
            const discountAmount = parseInt($('#discountAmount').val()) || 0;

            if (!customerId) {
                $('#discountPreview').hide();
                return;
            }

            const customer = allCustomers.find(c => String(c.id) === String(customerId));
            if (!customer) {
                $('#discountPreview').hide();
                return;
            }

            const originalPrice = customer.subscription_price || getPackagePrice(customer.subscription);
            const finalPrice = Math.max(0, originalPrice - discountAmount);

            $('#previewName').text(customer.name);
            $('#previewPackage').text(customer.subscription || 'Tanpa Paket');
            $('#previewOriginal').text(formatCurrency(originalPrice));
            $('#previewFinal').text(formatCurrency(finalPrice));
            $('#previewSaving').text(formatCurrency(discountAmount));

            if (discountAmount > 0) {
                $('#discountPreview').show();
            } else {
                $('#discountPreview').hide();
            }
        }

        function saveDiscount() {
            const customerId = $('#customerSelect').val();
            const discountAmount = parseInt($('#discountAmount').val()) || 0;
            const discountReason = $('#discountReason').val().trim();
            const discountMonths = parseInt($('#discountMonths').val()) || 1;

            if (!customerId) {
                showAlert('warning', 'Pilih pelanggan terlebih dahulu');
                return;
            }

            if (discountAmount <= 0) {
                showAlert('warning', 'Masukkan nominal diskon');
                return;
            }

            const btn = $('#saveDiscountBtn');
            btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

            fetch(`/api/discount/${customerId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    discount_amount: discountAmount,
                    discount_percentage: 0,
                    discount_reason: discountReason,
                    discount_months: discountMonths
                })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 200) {
                    showAlert('success', `Diskon berhasil disimpan untuk ${discountMonths} bulan!`);
                    // Reset form
                    $('#discountForm')[0].reset();
                    $('#customerSelect').val('').trigger('change');
                    $('#discountPreview').hide();
                    loadDiscountedUsers();
                } else {
                    showAlert('danger', data.message || 'Gagal menyimpan diskon');
                }
            })
            .catch(err => {
                console.error(err);
                showAlert('danger', 'Terjadi kesalahan');
            })
            .finally(() => {
                btn.prop('disabled', false).html('<i class="fas fa-save"></i> Simpan Diskon');
            });
        }

        function renderTable() {
            if (dataTable) dataTable.destroy();

            const tbody = $('#discountTable tbody');
            tbody.empty();

            discountedUsers.forEach(user => {
                const discountMonths = user.discount_months || 0;
                const discountMonthsUsed = user.discount_months_used || 0;
                const remainingMonths = Math.max(0, discountMonths - discountMonthsUsed);
                const isExpired = remainingMonths <= 0 && discountMonths > 0;
                const statusClass = isExpired ? 'text-muted' : '';
                
                let periodeBadge = '';
                if (discountMonths > 0) {
                    if (isExpired) {
                        periodeBadge = '<span class="badge badge-secondary">Habis</span>';
                    } else {
                        periodeBadge = `<span class="badge badge-info">${remainingMonths}/${discountMonths} bulan</span>`;
                    }
                } else {
                    periodeBadge = '<span class="badge badge-warning">Selamanya</span>';
                }

                tbody.append(`
                    <tr class="${statusClass}">
                        <td>${user.id}</td>
                        <td><strong>${escapeHtml(user.name)}</strong></td>
                        <td>${escapeHtml(user.subscription || '-')}</td>
                        <td class="text-right">${formatCurrency(user.subscription_price)}</td>
                        <td class="text-right text-danger font-weight-bold">-${formatCurrency(user.discount_amount)}</td>
                        <td class="text-right text-success font-weight-bold">${formatCurrency(user.effective_price)}</td>
                        <td>${escapeHtml(user.discount_reason || '-')}</td>
                        <td class="text-center">${periodeBadge}</td>
                        <td>
                            <button class="btn btn-sm btn-info" onclick="editDiscount(${user.id})" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="openDeleteModal(${user.id}, '${escapeHtml(user.name)}')" title="Hapus">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `);
            });

            dataTable = $('#discountTable').DataTable({
                order: [[1, 'asc']],
                pageLength: 25,
                language: { search: "Cari:", lengthMenu: "Tampilkan _MENU_", info: "_START_-_END_ dari _TOTAL_", zeroRecords: "Tidak ada pelanggan dengan diskon" }
            });
        }

        function editDiscount(userId) {
            const user = discountedUsers.find(u => u.id === userId);
            if (!user) return;

            // Set form values
            $('#customerSelect').val(userId).trigger('change');
            $('#discountAmount').val(user.discount_amount);
            $('#discountReason').val(user.discount_reason || '');
            $('#discountMonths').val(user.discount_months || 1);
            
            updatePreview();
            
            // Scroll to form
            $('html, body').animate({ scrollTop: 0 }, 500);
        }

        function openDeleteModal(userId, userName) {
            deleteUserId = userId;
            $('#deleteCustomerName').text(userName);
            $('#deleteModal').modal('show');
        }

        function deleteDiscount() {
            if (!deleteUserId) return;

            const btn = $('#confirmDeleteBtn');
            btn.prop('disabled', true);

            fetch(`/api/discount/${deleteUserId}`, {
                method: 'DELETE',
                credentials: 'include'
            })
            .then(res => res.json())
            .then(data => {
                $('#deleteModal').modal('hide');
                if (data.status === 200) {
                    showAlert('success', 'Diskon berhasil dihapus');
                    loadDiscountedUsers();
                } else {
                    showAlert('danger', data.message || 'Gagal menghapus diskon');
                }
            })
            .catch(() => showAlert('danger', 'Terjadi kesalahan'))
            .finally(() => {
                btn.prop('disabled', false);
                deleteUserId = null;
            });
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
