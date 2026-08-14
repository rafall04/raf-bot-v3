/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/admin-diskon.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/admin-diskon.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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
            $('.container-fluid').prepend(`
                <div class="alert alert-${type} alert-dismissible fade show">
                    ${message}
                    <button type="button" class="close" data-dismiss="alert"><span>&times;</span></button>
                </div>
            `);
            setTimeout(() => $('.alert').alert('close'), 5000);
        }
    
