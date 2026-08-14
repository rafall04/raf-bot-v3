/**
 * Header Doc
 * Purpose: Mengelola halaman admin payment status, termasuk filter periode, toggle/bulk update bayar, invoice, partial payment, dan bayar di muka (prabayar cash).
 * Caller: `views/sb-admin/payment-status.php`.
 * Deps: API `/api/payment-status/*`, `/api/send-invoice-manual`, jQuery, Bootstrap modal, dan Select2.
 * MainFuncs: `loadUsers`, `togglePaymentStatus`, `bulkUpdatePaymentStatus`, `sendInvoice`, `printInvoice`, `submitPartialPayment`, `openAdvancePaymentModal`, `submitAdvancePayment`, `openFreeMonthModal`, `submitFreeMonth`.
 * SideEffects: Memuat data pelanggan, memanggil API pembayaran, memperbarui tabel/statistik UI, dan memunculkan modal/toast.
 */
// Global variables
let allUsers = [];
let filteredUsers = [];
let selectedUsers = new Set();
// Pelanggan yang baru saja diubah statusnya — tetap ditampilkan di tempat (mis. jadi hijau)
// meski filter status mengecualikannya, sampai user ganti filter/periode atau reload halaman.
let pinnedVisibleUserIds = new Set();
let currentPage = 1;
const itemsPerPage = 20;
let allPackages = [];
let whitelistedPackages = [];
const VALID_PAYMENT_METHODS = ['CASH', 'TRANSFER_BANK'];
const DEFAULT_ADMIN_PAYMENT_METHOD = 'TRANSFER_BANK';
const DEFAULT_INVOICE_PAYMENT_METHOD = 'TRANSFER_BANK';
const DEFAULT_ADMIN_PAYMENT_METHOD_STORAGE_KEY = 'payment-status.default-admin-payment-method';
const paymentPeriodMonths = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

// Initialize page
$(document).ready(function() {
    initializePeriodSelectors();
    initializeDefaultAdminPaymentMethod();
    loadUsers();
    setupEventListeners();
    
    // Initialize Select2
    $('#subscriptionFilter').select2({
        theme: 'bootstrap',
        width: '100%'
    });
    
    // Event handler for toggle status button
    $(document).on('click', '.btn-toggle-status', function() {
        const userId = parseInt($(this).data('id'));
        const currentStatus = $(this).data('paid');
        const newStatus = !currentStatus;
        togglePaymentStatus(userId, newStatus);
    });
    
    // Event handler for send invoice button
    $(document).on('click', '.btn-send-invoice', function() {
        const userId = $(this).data('id');
        const userName = $(this).data('name');
        const phoneNumber = $(this).data('phone') || '';
        showPaymentMethodModal(userId, userName, phoneNumber, 'send');
    });
    
    // Event handler for print invoice button
    $(document).on('click', '.btn-print-invoice', function() {
        const userId = $(this).data('id');
        const userName = $(this).data('name');
        const phoneNumber = $(this).data('phone') || '';
        showPaymentMethodModal(userId, userName, phoneNumber, 'print');
    });
    
    // Event handler for partial payment button
    $(document).on('click', '.btn-partial-payment', function() {
        const userId = $(this).data('id');
        const userName = $(this).data('name');
        const subscription = $(this).data('subscription');
        openPartialPaymentModal(userId, userName, subscription);
    });

    // Event handler for advance payment (bayar di muka) button
    $(document).on('click', '.btn-advance-payment', function() {
        const userId = parseInt($(this).data('id'));
        const userName = $(this).data('name');
        const subscription = $(this).data('subscription');
        openAdvancePaymentModal(userId, userName, subscription);
    });

    // Event handler for free-month (tandai gratis) button
    $(document).on('click', '.btn-free-month', function() {
        const userId = parseInt($(this).data('id'));
        const userName = $(this).data('name');
        openFreeMonthModal(userId, userName);
    });
});

function initializePeriodSelectors() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const monthSelect = $('#periodMonthFilter');
    const yearSelect = $('#periodYearFilter');

    monthSelect.empty();
    paymentPeriodMonths.forEach((month, index) => {
        const monthNumber = index + 1;
        monthSelect.append(`<option value="${monthNumber}" ${monthNumber === currentMonth ? 'selected' : ''}>${month}</option>`);
    });

    yearSelect.empty();
    for (let year = currentYear + 1; year >= currentYear - 3; year -= 1) {
        yearSelect.append(`<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`);
    }

    updatePeriodContextText();
}

function getSelectedPeriod() {
    const periodMonth = parseInt($('#periodMonthFilter').val(), 10);
    const periodYear = parseInt($('#periodYearFilter').val(), 10);
    return { periodMonth, periodYear };
}

function isPeriodSelectionValid() {
    const { periodMonth, periodYear } = getSelectedPeriod();
    return Number.isInteger(periodMonth) && periodMonth >= 1 && periodMonth <= 12 && Number.isInteger(periodYear) && periodYear > 2000;
}

function formatSelectedPeriod() {
    const { periodMonth, periodYear } = getSelectedPeriod();
    if (!Number.isInteger(periodMonth) || !Number.isInteger(periodYear)) {
        return 'periode tidak valid';
    }
    return `${paymentPeriodMonths[periodMonth - 1]} ${periodYear}`;
}

function formatFailedPaymentReasons(failedItems = []) {
    if (!Array.isArray(failedItems) || failedItems.length === 0) {
        return '';
    }

    return failedItems
        .slice(0, 3)
        .map(item => item.reason || item.error || 'unknown_error')
        .join('; ');
}

function updatePeriodContextText() {
    const label = formatSelectedPeriod();
    $('#paymentPeriodContextText').text(label);
    $('#paymentPeriodStatsLabel').text(label);
    $('#paymentPeriodPaidLabel').text(`Lunas ${label}`);
    $('#paymentPeriodUnpaidLabel').text(`Belum lunas ${label}`);
    $('#paymentPeriodCompletionLabel').text(label);
}

function ensureValidPeriodSelection() {
    updatePeriodContextText();
    if (isPeriodSelectionValid()) {
        return true;
    }
    showToast('Pilih bulan dan tahun tagihan yang valid terlebih dahulu.', 'warning');
    return false;
}

function normalizePaymentMethod(method) {
    return VALID_PAYMENT_METHODS.includes(method) ? method : null;
}

function getPaymentMethodLabel(method) {
    return method === 'CASH' ? 'Cash' : 'Transfer Bank';
}

function readSessionPaymentMethodPreference() {
    try {
        return sessionStorage.getItem(DEFAULT_ADMIN_PAYMENT_METHOD_STORAGE_KEY);
    } catch (_error) {
        return null;
    }
}

function writeSessionPaymentMethodPreference(method) {
    try {
        sessionStorage.setItem(DEFAULT_ADMIN_PAYMENT_METHOD_STORAGE_KEY, method);
    } catch (_error) {
        // Ignore storage errors; UI state remains the source of truth for this page session.
    }
}

function getDefaultAdminPaymentMethod() {
    const selectedMethod = normalizePaymentMethod($('#defaultAdminPaymentMethod').val());
    if (selectedMethod) {
        return selectedMethod;
    }
    const storedMethod = normalizePaymentMethod(readSessionPaymentMethodPreference());
    return storedMethod || DEFAULT_ADMIN_PAYMENT_METHOD;
}

function syncDefaultAdminPaymentMethodUI() {
    const currentMethod = getDefaultAdminPaymentMethod();
    $('#defaultAdminPaymentMethod').val(currentMethod);
    $('#bulkDefaultMethodLabel').text(getPaymentMethodLabel(currentMethod));
}

function initializeDefaultAdminPaymentMethod() {
    const storedMethod = normalizePaymentMethod(readSessionPaymentMethodPreference()) || DEFAULT_ADMIN_PAYMENT_METHOD;
    writeSessionPaymentMethodPreference(storedMethod);
    $('#defaultAdminPaymentMethod').val(storedMethod);
    syncDefaultAdminPaymentMethodUI();
}

function getModalPaymentMethod() {
    return normalizePaymentMethod($('#paymentMethodSelect').val());
}

function configurePaymentMethodModal(actionType, preselectedMethod = null) {
    const isStatusAction = actionType === 'status_toggle' || actionType === 'status_bulk';
    const selectedMethod = normalizePaymentMethod(preselectedMethod)
        || (isStatusAction ? getDefaultAdminPaymentMethod() : DEFAULT_INVOICE_PAYMENT_METHOD);

    $('#paymentMethodSelect').empty().append(`
        <option value="TRANSFER_BANK">Transfer Bank</option>
        <option value="CASH">Cash</option>
    `);
    $('#paymentMethodSelect').val(selectedMethod);
    $('#paymentMethodModal').data('actionType', actionType);

    if (isStatusAction) {
        $('#paymentMethodModalTitle').text('Metode Pembayaran Tercatat');
        $('#paymentMethodModalContextText').text(`Metode ini akan dicatat pada histori pembayaran admin untuk periode ${formatSelectedPeriod()}.`);
        $('#paymentMethodHelpText').text('Pilih CASH atau TRANSFER_BANK yang benar-benar dipakai pada pencatatan pembayaran admin.');
    } else {
        $('#paymentMethodModalTitle').text(actionType === 'send' ? 'Metode Pembayaran pada Invoice' : 'Metode Pembayaran pada Invoice Cetak');
        $('#paymentMethodModalContextText').text('Metode ini hanya akan ditampilkan pada dokumen invoice. Aksi ini tidak mencatat pembayaran user.');
        $('#paymentMethodHelpText').text('Pilihan ini hanya memengaruhi template invoice yang dikirim atau dicetak.');
    }
}

// Load users data
async function loadUsers() {
    showLoading('Memuat data pelanggan...');
    updatePeriodContextText();
    
    try {
        // Load packages first to get whitelist info
        const packagesResponse = await fetch('/api/packages');
        if (packagesResponse.ok) {
            const packagesData = await packagesResponse.json();
            allPackages = packagesData.data || [];
            // Get whitelist package names (free packages)
            whitelistedPackages = allPackages
                .filter(pkg => pkg.whitelist === true)
                .map(pkg => pkg.name);
        }
        
        const { periodMonth, periodYear } = getSelectedPeriod();
        const response = await fetch(`/api/payment-status/read-model?period_month=${periodMonth}&period_year=${periodYear}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && data.status === 200 && data.data) {
            allUsers = data.data || [];

            // Populate subscription filter (mempertahankan pilihan paket aktif)
            populateSubscriptionFilter();

            // Terapkan kembali filter aktif (status/paket/cari) agar tabel tetap konsisten
            // dengan kontrol filter di UI — jangan reset ke semua pelanggan setelah reload.
            // applyFilters() sudah memanggil updateStatistics() dan renderTable() di dalamnya.
            applyFilters();

        } else {
            const errorMessage = data && data.message ? data.message : 'Format data tidak valid';
            console.error('Invalid data format:', data);
            showToast('Error memuat data: ' + errorMessage, 'danger');
        }
    } catch (error) {
        console.error('Error loading users:', error);
        const errorMessage = error.message || 'Error tidak diketahui';
        showToast('Error memuat data pelanggan: ' + errorMessage, 'danger');
        
        // Set empty data to prevent further errors
        allUsers = [];
        filteredUsers = [];
        updateStatistics();
        renderTable();
    } finally {
        hideLoading();
    }
}

// Populate subscription filter
function populateSubscriptionFilter() {
    const subscriptions = [...new Set(allUsers.map(u => u.subscription).filter(s => s))];
    const select = $('#subscriptionFilter');
    // Simpan pilihan paket aktif agar tidak hilang saat opsi dibangun ulang (mis. setelah loadUsers)
    const previousValue = select.val();

    select.empty().append('<option value="">Semua Paket</option>');
    subscriptions.sort().forEach(sub => {
        select.append(`<option value="${sub}">${sub}</option>`);
    });

    // Pulihkan pilihan paket sebelumnya bila masih tersedia di data terbaru
    if (previousValue && subscriptions.includes(previousValue)) {
        select.val(previousValue);
    }

    select.trigger('change.select2');
}

// Update statistics
function updateStatistics() {
    // Exclude whitelist package users from statistics (they are free users)
    const payableUsers = filteredUsers.filter(u => !whitelistedPackages.includes(u.subscription));
    const total = payableUsers.length;
    const paid = payableUsers.filter(u => u.paid === true || u.paid === 1).length;
    const unpaid = total - paid;
    const percentage = total > 0 ? Math.round((paid / total) * 100) : 0;
    
    $('#totalCustomers').text(total);
    $('#paidCustomers').text(paid);
    $('#unpaidCustomers').text(unpaid);
    $('#paidPercentage').text(percentage + '%');
}

// Render table
function renderTable() {
    const tbody = $('#paymentTableBody');
    tbody.empty();
    
    // Calculate pagination
    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
    // Jaga agar currentPage tak melebihi total halaman (mis. saat data menyusut setelah reload)
    if (currentPage > totalPages) {
        currentPage = totalPages > 0 ? totalPages : 1;
    }
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, filteredUsers.length);
    const pageUsers = filteredUsers.slice(startIndex, endIndex);
    
    // Render rows
    pageUsers.forEach(user => {
        const isPaid = user.paid === true || user.paid === 1;
        const isWaived = user.is_waived === true;
        // Pelanggan gratis (paket whitelist ATAU tagihan Rp0) bukan "Belum Bayar" — tak ada yang ditagih.
        const isFree = whitelistedPackages.includes(user.subscription) || Number(user.amount_due) === 0;
        const phoneNumbers = user.phone_number ? user.phone_number.split('|').join(', ') : '-';
        const isSelected = selectedUsers.has(user.id);
        
        const row = `
            <tr class="payment-row ${isPaid ? 'table-success' : ''}" data-user-id="${user.id}">
                <td class="text-center">
                    <input type="checkbox" class="bulk-select-checkbox user-checkbox" 
                           data-user-id="${user.id}" ${isSelected ? 'checked' : ''}>
                </td>
                <td>${user.id}</td>
                <td>
                    <div class="customer-info">
                        <div class="customer-avatar">${user.name ? user.name.charAt(0).toUpperCase() : '?'}</div>
                        <div>
                            <div class="font-weight-bold">${user.name || 'Tanpa Nama'}</div>
                            <small class="text-muted">${user.address ? user.address.substring(0, 50) + '...' : 'Alamat tidak tersedia'}</small>
                        </div>
                    </div>
                </td>
                <td>${phoneNumbers}</td>
                <td>${user.subscription || '-'}</td>
                <td><small>${user.device_id || '-'}</small></td>
                <td class="text-center">
                    ${(isWaived || isFree) ?
                        '<span class="badge badge-info status-badge" title="Bebas tagihan / gratis">GRATIS</span>' :
                      isPaid ?
                        '<span class="badge badge-success status-badge">Sudah Bayar</span>' :
                        '<span class="badge badge-danger status-badge">Belum Bayar</span>'}
                </td>
                <td class="text-center">
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm ${user.paid ? 'btn-warning' : 'btn-success'} btn-toggle-status" 
                                data-id="${user.id}" 
                                data-paid="${user.paid}" 
                                data-name="${user.name}"
                                data-phone="${user.phone_number || ''}"
                                data-send-invoice="${user.send_invoice || false}"
                                title="${user.paid ? 'Tandai belum bayar' : 'Tandai sudah bayar'}">
                            <i class="fas fa-${user.paid ? 'times-circle' : 'check-circle'}"></i>
                        </button>
                        ${!isPaid ?
                            `<button class="btn btn-sm btn-primary btn-partial-payment"
                                    data-id="${user.id}"
                                    data-name="${user.name}"
                                    data-subscription="${user.subscription || ''}"
                                    title="Bayar Sebagian">
                                <i class="fas fa-coins"></i>
                            </button>` : ''}
                        ${!isPaid && !whitelistedPackages.includes(user.subscription) && user.subscription !== 'PAKET-VOUCHER' ?
                            `<button class="btn btn-sm btn-info btn-free-month"
                                    data-id="${user.id}"
                                    data-name="${user.name}"
                                    title="Tandai gratis (bebas tagihan, tidak masuk pemasukan)">
                                <i class="fas fa-gift"></i>
                            </button>` : ''}
                        ${isPaid && (user.send_invoice === true || user.send_invoice === 1) ? 
                            `<button class="btn btn-sm btn-info btn-send-invoice" 
                                    data-id="${user.id}"
                                    data-name="${user.name}"
                                    data-phone="${user.phone_number || ''}"
                                    title="Kirim Invoice">
                                <i class="fas fa-file-invoice"></i>
                            </button>` : ''}
                        ${isPaid ?
                            `<button class="btn btn-sm btn-warning btn-print-invoice"
                                    data-id="${user.id}"
                                    data-name="${user.name}"
                                    data-phone="${user.phone_number || ''}"
                                    title="Cetak invoice">
                                <i class="fas fa-print"></i>
                            </button>` : ''}
                        ${isPaid && !whitelistedPackages.includes(user.subscription) && user.subscription !== 'PAKET-VOUCHER' ?
                            `<button class="btn btn-sm btn-secondary btn-advance-payment"
                                    data-id="${user.id}"
                                    data-name="${user.name}"
                                    data-subscription="${user.subscription || ''}"
                                    title="Bayar di muka (prabayar cash)">
                                <i class="fas fa-calendar-plus"></i>
                            </button>` : ''}
                    </div>
                </td>
            </tr>
        `;
        tbody.append(row);
    });
    
    // Update pagination info
    $('#showingFrom').text(filteredUsers.length > 0 ? startIndex + 1 : 0);
    $('#showingTo').text(endIndex);
    $('#totalRecords').text(filteredUsers.length);
    
    // Render pagination
    renderPagination(totalPages);
    
    // Update bulk action visibility
    updateBulkActionVisibility();
}

// Render pagination
function renderPagination(totalPages) {
    const pagination = $('#pagination');
    pagination.empty();
    
    if (totalPages <= 1) return;
    
    // Previous button
    pagination.append(`
        <li class="page-item ${currentPage === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${currentPage - 1}); return false;">
                <i class="fas fa-chevron-left"></i>
            </a>
        </li>
    `);
    
    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    if (startPage > 1) {
        pagination.append(`
            <li class="page-item">
                <a class="page-link" href="#" onclick="changePage(1); return false;">1</a>
            </li>
        `);
        if (startPage > 2) {
            pagination.append('<li class="page-item disabled"><span class="page-link">...</span></li>');
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        pagination.append(`
            <li class="page-item ${i === currentPage ? 'active' : ''}">
                <a class="page-link" href="#" onclick="changePage(${i}); return false;">${i}</a>
            </li>
        `);
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            pagination.append('<li class="page-item disabled"><span class="page-link">...</span></li>');
        }
        pagination.append(`
            <li class="page-item">
                <a class="page-link" href="#" onclick="changePage(${totalPages}); return false;">${totalPages}</a>
            </li>
        `);
    }
    
    // Next button
    pagination.append(`
        <li class="page-item ${currentPage === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${currentPage + 1}); return false;">
                <i class="fas fa-chevron-right"></i>
            </a>
        </li>
    `);
}

// Change page
function changePage(page) {
    const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
    if (page < 1 || page > totalPages) return;
    
    currentPage = page;
    renderTable();
    
    // Scroll to top of table
    $('html, body').animate({
        scrollTop: $('#paymentTable').offset().top - 100
    }, 300);
}

// Toggle payment status
async function togglePaymentStatus(userId, newStatus, selectedPaymentMethod = null) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    if (!ensureValidPeriodSelection()) return;

    if (newStatus && !selectedPaymentMethod) {
        configurePaymentMethodModal('status_toggle', getDefaultAdminPaymentMethod());
        $('#paymentMethodModal').data('pendingStatusChange', {
            mode: 'single',
            userId,
            newStatus
        });
        $('#paymentMethodModalTitle').text(`Metode Pembayaran Tercatat untuk ${user.name}`);
        $('#paymentMethodModal').modal('show');
        return;
    }

    const paymentMethod = newStatus
        ? normalizePaymentMethod(selectedPaymentMethod) || normalizePaymentMethod(getDefaultAdminPaymentMethod())
        : null;

    if (newStatus && !paymentMethod) {
        showToast('Pilih default metode pembayaran admin yang valid terlebih dahulu.', 'warning');
        return;
    }
    
    const action = newStatus ? 'sudah bayar' : 'belum bayar';
    const paymentMethodInfo = newStatus
        ? `<br><small class="text-muted">Pembayaran akan dicatat sebagai <strong>${getPaymentMethodLabel(paymentMethod)}</strong>.</small>`
        : '';
    const confirmMsg = `Apakah Anda yakin ingin mengubah status pembayaran <strong>${user.name}</strong> menjadi <strong>${action}</strong> untuk <strong>${formatSelectedPeriod()}</strong>?${paymentMethodInfo}`;
    
    $('#confirmModalBody').html(confirmMsg);
    $('#confirmModal').modal('show');
    
    $('#confirmActionBtn').off('click').on('click', async function() {
        $('#confirmModal').modal('hide');
        showLoading(`Mengubah status pembayaran...`);
        
        try {
            const payload = {
                userIds: [userId],
                paid: newStatus,
                period_month: getSelectedPeriod().periodMonth,
                period_year: getSelectedPeriod().periodYear,
                triggerNotification: true
            };

            if (newStatus) {
                payload.paymentMethod = paymentMethod;
            }

            const response = await fetch('/api/payment-status/bulk-update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                credentials: 'include'
            });
            
            const result = await response.json();
            const successCount = Array.isArray(result?.results?.success) ? result.results.success.length : 0;
            const failedReasons = formatFailedPaymentReasons(result?.results?.failed);
            
            if (response.ok && successCount > 0) {
                // Tetap tampilkan baris ini di tempat (mis. jadi hijau) walau filter status mengecualikannya
                pinnedVisibleUserIds.add(userId);
                await loadUsers();
                showToast(`Status pembayaran ${user.name} berhasil diubah untuk ${formatSelectedPeriod()}`, 'success');
                
                // If marked as paid and has send_invoice enabled, show payment method modal
                if (newStatus && (user.send_invoice === true || user.send_invoice === 1)) {
                    setTimeout(() => {
                        showPaymentMethodModal(userId, user.name, user.phone_number || '', 'send');
                    }, 500);
                } else if (newStatus) {
                    // Just show notification that payment has been confirmed
                    showToast(`✅ Notifikasi pembayaran telah dikirim ke ${user.name}`, 'info');
                }
            } else {
                showToast(failedReasons || result.message || 'Status pembayaran tidak berubah', 'danger');
            }
        } catch (error) {
            console.error('Error updating payment status:', error);
            showToast('Error mengubah status pembayaran', 'danger');
        } finally {
            hideLoading();
        }
    });
}

// Send invoice with payment method
async function sendInvoice(userId, method = 'TRANSFER_BANK') {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    
    showLoading('Mengirim invoice...');
    
    try {
        const response = await fetch('/api/send-invoice-manual', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                userId,
                userName: user.name,
                phoneNumber: user.phone_number || '',
                method: method
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showToast(`✅ Invoice PDF berhasil dikirim ke ${user.name}`, 'success');
        } else {
            showToast('Error: ' + result.message, 'danger');
        }
    } catch (error) {
        console.error('Error sending invoice:', error);
        showToast('Error mengirim invoice', 'danger');
    } finally {
        hideLoading();
    }
}

// Show payment method modal
function showPaymentMethodModal(userId, userName, phoneNumber, actionType) {
    const invoiceMethod = DEFAULT_INVOICE_PAYMENT_METHOD;
    configurePaymentMethodModal(actionType, invoiceMethod);
    $('#paymentMethodModal').removeData('pendingStatusChange');
    // Store data in modal
    $('#paymentMethodModal').data('userId', userId);
    $('#paymentMethodModal').data('userName', userName);
    $('#paymentMethodModal').data('phoneNumber', phoneNumber);
    $('#paymentMethodModal').data('actionType', actionType);
    
    // Show modal
    $('#paymentMethodModal').modal('show');
}

// Print invoice with payment method
async function printInvoice(userId, method = 'TRANSFER_BANK') {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    
    showLoading('Membuat invoice untuk dicetak...');
    
    try {
        const response = await fetch('/api/send-invoice-manual', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                userId,
                userName: user.name,
                phoneNumber: '',
                method: method,
                noSend: true // Don't send, just generate
            })
        });
        
        const result = await response.json();
        
        if (response.ok && result.invoiceId) {
            const printUrl = `/api/view-invoice?id=${result.invoiceId}&userId=${userId}`;
            window.open(printUrl, '_blank');
            showToast('Invoice dibuka untuk dicetak', 'success');
        } else {
            showToast('Error: ' + (result.message || 'Gagal membuat invoice'), 'danger');
        }
    } catch (error) {
        console.error('Error creating invoice for print:', error);
        showToast('Error membuat invoice', 'danger');
    } finally {
        hideLoading();
    }
}

// Bulk update payment status
async function bulkUpdatePaymentStatus(newStatus, selectedPaymentMethod = null) {
    if (selectedUsers.size === 0) {
        showToast('Tidak ada pelanggan yang dipilih', 'warning');
        return;
    }
    
    if (!ensureValidPeriodSelection()) return;

    if (newStatus && !selectedPaymentMethod) {
        configurePaymentMethodModal('status_bulk', getDefaultAdminPaymentMethod());
        $('#paymentMethodModal').data('pendingStatusChange', {
            mode: 'bulk',
            newStatus
        });
        $('#paymentMethodModalTitle').text(`Metode Pembayaran Tercatat untuk ${selectedUsers.size} pelanggan`);
        $('#paymentMethodModal').modal('show');
        return;
    }

    const paymentMethod = newStatus
        ? normalizePaymentMethod(selectedPaymentMethod) || normalizePaymentMethod(getDefaultAdminPaymentMethod())
        : null;

    if (newStatus && !paymentMethod) {
        showToast('Pilih default metode pembayaran admin yang valid terlebih dahulu.', 'warning');
        return;
    }

    const action = newStatus ? 'sudah bayar' : 'belum bayar';
    const paymentMethodInfo = newStatus
        ? `<br><small class="text-muted">Bulk bayar akan dicatat sebagai <strong>${getPaymentMethodLabel(paymentMethod)}</strong>.</small>`
        : '';
    const confirmMsg = `Apakah Anda yakin ingin mengubah status pembayaran <strong>${selectedUsers.size} pelanggan</strong> menjadi <strong>${action}</strong> untuk <strong>${formatSelectedPeriod()}</strong>?${paymentMethodInfo}`;
    
    $('#confirmModalBody').html(confirmMsg);
    $('#confirmModal').modal('show');
    
    $('#confirmActionBtn').off('click').on('click', async function() {
        $('#confirmModal').modal('hide');
        showLoading(`Mengubah status pembayaran ${selectedUsers.size} pelanggan...`);
        
        try {
            const payload = {
                userIds: Array.from(selectedUsers),
                paid: newStatus,
                period_month: getSelectedPeriod().periodMonth,
                period_year: getSelectedPeriod().periodYear,
                triggerNotification: true
            };

            if (newStatus) {
                payload.paymentMethod = paymentMethod;
            }

            const response = await fetch('/api/payment-status/bulk-update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                credentials: 'include'
            });
            
            const result = await response.json();
            const successCount = Array.isArray(result?.results?.success) ? result.results.success.length : 0;
            const failedCount = Array.isArray(result?.results?.failed) ? result.results.failed.length : 0;
            const failedReasons = formatFailedPaymentReasons(result?.results?.failed);
            
            if (response.ok && successCount > 0) {
                // Tetap tampilkan baris yang baru diubah di tempat sampai user ganti filter/reload
                payload.userIds.forEach(id => pinnedVisibleUserIds.add(id));
                selectedUsers.clear();
                $('#selectAllCheckbox, #selectAllHeader').prop('checked', false);
                await loadUsers();
                
                showToast(`Status pembayaran ${successCount} pelanggan berhasil diubah untuk ${formatSelectedPeriod()}`, 'success');
                if (failedCount > 0) {
                    showToast(`${failedCount} pelanggan gagal diproses pada bulk update`, 'warning');
                }
                
                if (newStatus) {
                    showToast(`✅ Notifikasi pembayaran telah dikirim ke semua pelanggan yang diubah`, 'info');
                }
            } else {
                showToast(failedReasons || result.message || 'Tidak ada status pembayaran yang berubah', 'danger');
            }
        } catch (error) {
            console.error('Error bulk updating payment status:', error);
            showToast('Error mengubah status pembayaran', 'danger');
        } finally {
            hideLoading();
        }
    });
}

// Bulk send invoices
async function bulkSendInvoices() {
    const eligibleUsers = Array.from(selectedUsers).filter(userId => {
        const user = allUsers.find(u => u.id === userId);
        return user && (user.paid === true || user.paid === 1) && (user.send_invoice === true || user.send_invoice === 1);
    });
    
    if (eligibleUsers.length === 0) {
        showToast('Tidak ada pelanggan yang memenuhi syarat untuk kirim invoice', 'warning');
        return;
    }
    
    const confirmMsg = `Kirim invoice ke <strong>${eligibleUsers.length} pelanggan</strong>?`;
    
    $('#confirmModalBody').html(confirmMsg);
    $('#confirmModal').modal('show');
    
    $('#confirmActionBtn').off('click').on('click', async function() {
        $('#confirmModal').modal('hide');
        showLoading(`Mengirim invoice ke ${eligibleUsers.length} pelanggan...`);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const userId of eligibleUsers) {
            try {
                const response = await fetch('/api/send-invoice-manual', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ userId })
                });
                
                const result = await response.json();
                
                if (result.status === 200) {
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error(`Error sending invoice to user ${userId}:`, error);
                failCount++;
            }
        }
        
        hideLoading();
        
        if (successCount > 0) {
            showToast(`Invoice berhasil dikirim ke ${successCount} pelanggan`, 'success');
        }
        if (failCount > 0) {
            showToast(`Gagal mengirim invoice ke ${failCount} pelanggan`, 'warning');
        }
    });
}

// Setup event listeners
function setupEventListeners() {
    // Filter listeners
    $('#periodMonthFilter, #periodYearFilter').on('change', function onPeriodChange() {
        pinnedVisibleUserIds.clear();
        currentPage = 1;
        updatePeriodContextText();
        loadUsers();
    });
    $('#statusFilter').on('change', applyFiltersFromUserInput);
    $('#subscriptionFilter').on('change', applyFiltersFromUserInput);
    $('#searchInput').on('keyup', debounce(applyFiltersFromUserInput, 300));
    $('#searchBtn').on('click', applyFiltersFromUserInput);
    $('#clearFilters').on('click', clearFilters);
    $('#defaultAdminPaymentMethod').on('change', function onDefaultPaymentMethodChange() {
        const selectedMethod = normalizePaymentMethod($(this).val());
        if (!selectedMethod) {
            $(this).val(getDefaultAdminPaymentMethod());
            showToast('Default metode pembayaran admin harus CASH atau TRANSFER_BANK.', 'warning');
            return;
        }
        writeSessionPaymentMethodPreference(selectedMethod);
        syncDefaultAdminPaymentMethodUI();
    });
    
    // Select all checkbox
    $('#selectAllCheckbox, #selectAllHeader').on('change', function() {
        const isChecked = $(this).prop('checked');
        $('#selectAllCheckbox, #selectAllHeader').prop('checked', isChecked);
        
        $('.user-checkbox').each(function() {
            const userId = parseInt($(this).data('user-id'));
            $(this).prop('checked', isChecked);
            
            if (isChecked) {
                selectedUsers.add(userId);
            } else {
                selectedUsers.delete(userId);
            }
        });
        
        updateBulkActionVisibility();
    });
    
    // Individual checkbox
    $(document).on('change', '.user-checkbox', function() {
        const userId = parseInt($(this).data('user-id'));
        
        if ($(this).prop('checked')) {
            selectedUsers.add(userId);
        } else {
            selectedUsers.delete(userId);
        }
        
        updateBulkActionVisibility();
    });
    
    // Bulk action buttons
    $('#markPaidBtn').on('click', () => bulkUpdatePaymentStatus(true));
    $('#markUnpaidBtn').on('click', () => bulkUpdatePaymentStatus(false));
    $('#sendInvoiceBtn').on('click', bulkSendInvoices);
    $('#deselectAllBtn').on('click', () => {
        selectedUsers.clear();
        $('.user-checkbox').prop('checked', false);
        $('#selectAllCheckbox, #selectAllHeader').prop('checked', false);
        updateBulkActionVisibility();
    });
    
    // Payment method modal confirmation
    $('#confirmPaymentMethodBtn').on('click', async function() {
        const pendingStatusChange = $('#paymentMethodModal').data('pendingStatusChange');
        const selectedMethod = getModalPaymentMethod();

        if (!selectedMethod) {
            showToast('Metode pembayaran harus CASH atau TRANSFER_BANK.', 'warning');
            return;
        }

        if (pendingStatusChange) {
            $('#paymentMethodModal').removeData('pendingStatusChange').modal('hide');
            if (pendingStatusChange.mode === 'single') {
                await togglePaymentStatus(pendingStatusChange.userId, pendingStatusChange.newStatus, selectedMethod);
            } else if (pendingStatusChange.mode === 'bulk') {
                await bulkUpdatePaymentStatus(pendingStatusChange.newStatus, selectedMethod);
            }
            return;
        }

        const userId = $('#paymentMethodModal').data('userId');
        const actionType = $('#paymentMethodModal').data('actionType');
        
        $('#paymentMethodModal').modal('hide');
        
        if (actionType === 'send') {
            await sendInvoice(userId, selectedMethod);
        } else if (actionType === 'print') {
            await printInvoice(userId, selectedMethod);
        }
    });

    $('#paymentMethodModal').on('hidden.bs.modal', function onPaymentMethodModalHidden() {
        $(this).removeData('pendingStatusChange');
    });
}

// Apply filters
function applyFilters() {
    const status = $('#statusFilter').val();
    const subscription = $('#subscriptionFilter').val();
    const searchTerm = $('#searchInput').val().toLowerCase();
    
    filteredUsers = allUsers.filter(user => {
        // Status filter — kecualikan baris yang baru diubah (pinned) agar tetap tampil di tempat
        if (status && !pinnedVisibleUserIds.has(user.id)) {
            const isPaid = user.paid === true || user.paid === 1;
            const isWhitelisted = whitelistedPackages.includes(user.subscription);

            if (status === 'paid' && !isPaid) return false;
            // Exclude whitelist users from unpaid filter (they are free users)
            if (status === 'unpaid' && (isPaid || isWhitelisted)) return false;
        }
        
        // Subscription filter
        if (subscription && user.subscription !== subscription) {
            return false;
        }
        
        // Search filter
        if (searchTerm) {
            const name = (user.name || '').toLowerCase();
            const phone = (user.phone_number || '').toLowerCase();
            const deviceId = (user.device_id || '').toLowerCase();
            const address = (user.address || '').toLowerCase();
            
            if (!name.includes(searchTerm) && 
                !phone.includes(searchTerm) && 
                !deviceId.includes(searchTerm) &&
                !address.includes(searchTerm)) {
                return false;
            }
        }
        
        return true;
    });
    
    updateStatistics();
    renderTable();
}

// Filter yang dipicu interaksi user — reset ke halaman 1 & buang daftar pinned agar penyaringan kembali ketat.
// (applyFilters sendiri tidak mereset halaman, supaya reload data biasa mempertahankan posisi halaman.)
function applyFiltersFromUserInput() {
    pinnedVisibleUserIds.clear();
    currentPage = 1;
    applyFilters();
}

// Clear filters
function clearFilters() {
    pinnedVisibleUserIds.clear();
    $('#statusFilter').val('');
    $('#subscriptionFilter').val('').trigger('change.select2');
    $('#searchInput').val('');
    
    filteredUsers = [...allUsers];
    currentPage = 1;
    updateStatistics();
    renderTable();
}

// Update bulk action visibility
function updateBulkActionVisibility() {
    syncDefaultAdminPaymentMethodUI();
    if (selectedUsers.size > 0) {
        $('#bulkActions').show();
        $('#selectedCount').text(selectedUsers.size);
    } else {
        $('#bulkActions').hide();
    }
}

// Show loading overlay
function showLoading(text = 'Memproses...') {
    $('#loadingText').text(text);
    $('#loadingOverlay').addClass('show');
}

// Hide loading overlay
function hideLoading() {
    $('#loadingOverlay').removeClass('show');
}

// Show toast notification
function showToast(message, type = 'info') {
    const toastId = 'toast-' + Date.now();
    const toastHtml = `
        <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-delay="5000">
            <div class="toast-header bg-${type} text-white">
                <strong class="mr-auto">
                    ${type === 'success' ? '<i class="fas fa-check-circle"></i>' : 
                      type === 'danger' ? '<i class="fas fa-exclamation-circle"></i>' : 
                      type === 'warning' ? '<i class="fas fa-exclamation-triangle"></i>' : 
                      '<i class="fas fa-info-circle"></i>'} 
                    Notifikasi
                </strong>
                <button type="button" class="ml-2 mb-1 close text-white" data-dismiss="toast" aria-label="Close">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `;
    
    $('#toastContainer').append(toastHtml);
    $(`#${toastId}`).toast('show');
    
    $(`#${toastId}`).on('hidden.bs.toast', function() {
        $(this).remove();
    });
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}


// ============ PARTIAL PAYMENT FUNCTIONS ============

let selectedPartialUserId = null;
let selectedPartialUserPrice = 0;

// Get package price from allPackages
function getPackagePrice(packageName) {
    if (!packageName) return 0;
    const pkg = allPackages.find(p => p.name === packageName);
    if (pkg && pkg.price) return pkg.price;
    // Fallback: parse from name
    const match = packageName.match(/([0-9]+)K/i);
    if (match) return parseInt(match[1]) * 1000;
    return 0;
}

// Format currency
function formatCurrency(amount) {
    return 'Rp ' + Number(amount).toLocaleString('id-ID');
}

// Open partial payment modal
async function openPartialPaymentModal(userId, userName, subscription) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) {
        showToast('Data pelanggan tidak ditemukan', 'danger');
        return;
    }
    
    selectedPartialUserId = userId;
    
    showLoading('Memuat data tagihan...');
    
    try {
        // Fetch effective price with discount
        let basePrice = getPackagePrice(subscription);
        let effectivePrice = basePrice;
        let discountHtml = '';
        let outstandingAmount = effectivePrice;
        let totalPaidBefore = 0;
        
        // Get discount info
        try {
            const discountRes = await fetch(`/api/discount/effective-price/${userId}`, { credentials: 'include' });
            const discountData = await discountRes.json();
            
            if (discountData.status === 200 && discountData.data) {
                basePrice = discountData.data.base_price || basePrice;
                effectivePrice = discountData.data.effective_price;
                
                if (discountData.data.has_discount && discountData.data.is_discount_valid) {
                    discountHtml = `
                        <div class="detail-row" style="background: #fff3cd; padding: 5px 10px; border-radius: 5px; margin-bottom: 10px;">
                            <span class="detail-label"><i class="fas fa-tags text-warning"></i> Diskon</span>
                            <span class="detail-value text-danger">-${discountData.data.discount_text}</span>
                        </div>
                    `;
                }
            }
        } catch (e) {
            console.warn('Could not fetch discount info:', e);
        }
        
        // Get outstanding balance
        try {
            const outstandingRes = await fetch(`/api/partial-payment/outstanding/${userId}`, { credentials: 'include' });
            const outstandingData = await outstandingRes.json();
            
            if (outstandingData.status === 200 && outstandingData.data) {
                outstandingAmount = outstandingData.data.outstanding;
                totalPaidBefore = outstandingData.data.total_paid;
                
                if (outstandingData.data.is_fully_paid) {
                    hideLoading();
                    showToast('Pelanggan sudah lunas untuk periode ini', 'info');
                    return;
                }
            }
        } catch (e) {
            console.warn('Could not fetch outstanding info:', e);
            outstandingAmount = effectivePrice;
        }
        
        selectedPartialUserPrice = outstandingAmount;
        
        // Build modal content
        const modalHtml = `
            <div class="modal fade" id="partialPaymentModal" tabindex="-1" role="dialog">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header bg-primary text-white">
                            <h5 class="modal-title"><i class="fas fa-coins"></i> Pembayaran Sebagian</h5>
                            <button type="button" class="close text-white" data-dismiss="modal">
                                <span>&times;</span>
                            </button>
                        </div>
                        <div class="modal-body">
                            <div class="customer-summary mb-3" style="background: #f8f9fc; border-radius: 10px; padding: 15px;">
                                <h6 class="mb-2"><i class="fas fa-user"></i> ${userName}</h6>
                                <div class="detail-row d-flex justify-content-between py-1">
                                    <span class="text-muted">Paket</span>
                                    <span class="font-weight-bold">${subscription || '-'}</span>
                                </div>
                                <div class="detail-row d-flex justify-content-between py-1">
                                    <span class="text-muted">Harga Paket</span>
                                    <span ${discountHtml ? 'style="text-decoration: line-through;" class="text-muted"' : 'class="font-weight-bold"'}>${formatCurrency(basePrice)}</span>
                                </div>
                                ${discountHtml}
                                ${totalPaidBefore > 0 ? `
                                <div class="detail-row d-flex justify-content-between py-1">
                                    <span class="text-muted">Sudah Dibayar</span>
                                    <span class="text-success font-weight-bold">${formatCurrency(totalPaidBefore)}</span>
                                </div>
                                ` : ''}
                                <hr class="my-2">
                                <div class="detail-row d-flex justify-content-between py-1">
                                    <span class="font-weight-bold">Sisa Tagihan</span>
                                    <span class="text-danger font-weight-bold" style="font-size: 1.2rem;">${formatCurrency(outstandingAmount)}</span>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label class="font-weight-bold">Jenis Pembayaran</label>
                                <div class="custom-control custom-radio">
                                    <input type="radio" id="ppFull" name="ppType" class="custom-control-input" value="full" checked>
                                    <label class="custom-control-label" for="ppFull">Pembayaran Penuh (${formatCurrency(outstandingAmount)})</label>
                                </div>
                                <div class="custom-control custom-radio">
                                    <input type="radio" id="ppPartial" name="ppType" class="custom-control-input" value="partial">
                                    <label class="custom-control-label" for="ppPartial">Pembayaran Sebagian</label>
                                </div>
                            </div>
                            
                            <div id="ppPartialSection" style="display: none;">
                                <div class="form-group">
                                    <label for="ppAmount">Nominal yang Dibayar</label>
                                    <div class="input-group">
                                        <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                        <input type="text" class="form-control currency-input" id="ppAmount" placeholder="Masukkan nominal" data-max="${outstandingAmount}">
                                    </div>
                                    <small class="form-text text-muted">Minimal Rp 1.000, Maksimal ${formatCurrency(outstandingAmount)}</small>
                                </div>
                                <div class="alert alert-info" id="ppInfo" style="display: none;">
                                    <i class="fas fa-info-circle"></i> <span id="ppInfoText"></span>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="ppMethod">Metode Pembayaran</label>
                                <select class="form-control" id="ppMethod">
                                    <option value="TRANSFER_BANK">Transfer Bank</option>
                                    <option value="CASH">Tunai</option>
                                </select>
                                <small class="form-text text-muted">Gunakan hanya CASH atau TRANSFER_BANK untuk pencatatan pembayaran admin.</small>
                            </div>
                            
                            <div class="form-group">
                                <label for="ppNotes">Catatan (Opsional)</label>
                                <input type="text" class="form-control" id="ppNotes" placeholder="Contoh: Bayar via BCA" maxlength="200">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                            <button type="button" class="btn btn-primary" id="ppConfirmBtn">
                                <i class="fas fa-check"></i> Proses Pembayaran
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing modal if any
        $('#partialPaymentModal').remove();
        
        // Add modal to body
        $('body').append(modalHtml);
        $('#ppMethod').val(getDefaultAdminPaymentMethod());
        
        // Setup event handlers
        $('input[name="ppType"]').on('change', function() {
            if ($(this).val() === 'partial') {
                $('#ppPartialSection').slideDown();
            } else {
                $('#ppPartialSection').slideUp();
                $('#ppAmount').val('');
                $('#ppInfo').hide();
            }
        });
        
        $('#ppAmount').on('input', function() {
            // Format with thousand separator
            let value = $(this).val().replace(/\./g, '').replace(/[^0-9]/g, '');
            // Remove leading zeros
            value = value.replace(/^0+/, '') || '';
            if (value) {
                $(this).val(value.replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
            } else {
                $(this).val('');
            }
            
            const amount = parseInt(value) || 0;
            if (amount > 0 && amount < outstandingAmount) {
                const remaining = outstandingAmount - amount;
                $('#ppInfoText').html(`Sisa tagihan setelah pembayaran: <strong>${formatCurrency(remaining)}</strong>`);
                $('#ppInfo').show();
            } else if (amount >= outstandingAmount) {
                $('#ppInfoText').html(`Nominal sama atau lebih dari sisa tagihan. Akan diproses sebagai pembayaran penuh.`);
                $('#ppInfo').show();
            } else {
                $('#ppInfo').hide();
            }
        });
        
        // Select all on focus for easy replacement
        $('#ppAmount').on('focus', function() {
            $(this).select();
        });
        
        $('#ppConfirmBtn').on('click', function() {
            submitPartialPayment(userId, outstandingAmount);
        });
        
        hideLoading();
        $('#partialPaymentModal').modal('show');
        
    } catch (error) {
        hideLoading();
        console.error('Error opening partial payment modal:', error);
        showToast('Error memuat data tagihan', 'danger');
    }
}

// Submit partial payment
async function submitPartialPayment(userId, maxAmount) {
    const paymentType = $('input[name="ppType"]:checked').val();
    // Parse formatted number (remove dots)
    const partialAmount = parseInt($('#ppAmount').val().replace(/\./g, '')) || 0;
    const paymentMethod = normalizePaymentMethod($('#ppMethod').val());
    const notes = $('#ppNotes').val().trim();

    if (!paymentMethod) {
        showToast('Metode pembayaran harus CASH atau TRANSFER_BANK.', 'warning');
        return;
    }
    
    let amountToPay = maxAmount;
    
    if (paymentType === 'partial') {
        if (partialAmount <= 0) {
            showToast('Masukkan nominal pembayaran', 'warning');
            return;
        }
        if (partialAmount > maxAmount) {
            showToast(`Nominal melebihi sisa tagihan (${formatCurrency(maxAmount)})`, 'warning');
            return;
        }
        amountToPay = partialAmount;
    }
    
    $('#ppConfirmBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');

    // Dibaca SEKALI supaya bulan dan tahun yang dikirim pasti berasal dari pembacaan yang sama.
    const periodeDipilih = getSelectedPeriod();

    try {
        const response = await fetch('/api/partial-payment/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                userId: userId,
                amountPaid: amountToPay,
                paymentMethod: paymentMethod,
                notes: notes,
                // Periode yang SEDANG DILIHAT admin. Tanpa ini server memakai bulan berjalan,
                // sehingga pembayaran untuk periode lama tercatat di bulan sekarang: periode
                // aslinya tetap menunggak dan struk ke pelanggan menyebut periode yang salah.
                period_month: periodeDipilih.periodMonth,
                period_year: periodeDipilih.periodYear
            })
        });
        
        const result = await response.json();
        
        if (result.status === 200 || result.status === 201) {
            $('#partialPaymentModal').modal('hide');
            
            const isPartial = result.data.is_partial;
            const msg = isPartial 
                ? `Pembayaran sebagian ${formatCurrency(amountToPay)} berhasil diproses! Sisa: ${formatCurrency(result.data.amount_remaining)}`
                : `Pembayaran penuh ${formatCurrency(amountToPay)} berhasil diproses!`;
            
            showToast(msg, 'success');
            
            // Reload data if fully paid — tetap tampilkan baris ini di tempat (hijau) setelah lunas
            if (result.data.will_be_fully_paid) {
                pinnedVisibleUserIds.add(userId);
                setTimeout(() => loadUsers(), 500);
            }
        } else {
            showToast('Error: ' + (result.message || 'Gagal memproses pembayaran'), 'danger');
        }
    } catch (error) {
        console.error('Error submitting partial payment:', error);
        showToast('Error memproses pembayaran', 'danger');
    } finally {
        $('#ppConfirmBtn').prop('disabled', false).html('<i class="fas fa-check"></i> Proses Pembayaran');
    }
}


// ============ ADVANCE PAYMENT (BAYAR DI MUKA) FUNCTIONS ============

// Daftar label bulan ke depan, mulai bulan DEPAN (bukan bulan berjalan), sebanyak `count`.
function getUpcomingPeriodLabels(count) {
    const now = new Date();
    const labels = [];
    for (let i = 1; i <= count; i += 1) {
        const zeroIdx = now.getMonth() + i; // getMonth() 0-based
        const month = ((zeroIdx % 12) + 12) % 12;
        const year = now.getFullYear() + Math.floor(zeroIdx / 12);
        labels.push(`${paymentPeriodMonths[month]} ${year}`);
    }
    return labels;
}

// Open advance payment (bayar di muka) modal
function openAdvancePaymentModal(userId, userName, subscription) {
    const pricePerMonth = getPackagePrice(subscription);

    const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1)
        .map(n => `<option value="${n}">${n} bulan</option>`)
        .join('');

    const modalHtml = `
        <div class="modal fade" id="advancePaymentModal" tabindex="-1" role="dialog">
            <div class="modal-dialog" role="document">
                <div class="modal-content">
                    <div class="modal-header bg-secondary text-white">
                        <h5 class="modal-title"><i class="fas fa-calendar-plus"></i> Bayar di Muka</h5>
                        <button type="button" class="close text-white" data-dismiss="modal">
                            <span>&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="customer-summary mb-3" style="background: #f8f9fc; border-radius: 10px; padding: 15px;">
                            <h6 class="mb-2"><i class="fas fa-user"></i> ${userName}</h6>
                            <div class="detail-row d-flex justify-content-between py-1">
                                <span class="text-muted">Paket</span>
                                <span class="font-weight-bold">${subscription || '-'}</span>
                            </div>
                            <div class="detail-row d-flex justify-content-between py-1">
                                <span class="text-muted">Harga / bulan</span>
                                <span class="font-weight-bold">${formatCurrency(pricePerMonth)}</span>
                            </div>
                        </div>

                        <div class="alert alert-info py-2">
                            <i class="fas fa-info-circle"></i> Pembayaran dicatat sebagai <strong>Tunai (Cash)</strong> untuk bulan-bulan ke depan. Tagihan bulan berjalan harus sudah lunas.
                        </div>

                        <div class="form-group">
                            <label for="apMonths" class="font-weight-bold">Jumlah bulan ke depan</label>
                            <select class="form-control" id="apMonths">${monthOptions}</select>
                        </div>

                        <div class="form-group mb-1">
                            <label class="font-weight-bold">Bulan yang akan dibayar</label>
                            <div id="apPeriodList" class="small text-muted"></div>
                        </div>

                        <hr class="my-2">
                        <div class="detail-row d-flex justify-content-between py-1">
                            <span class="font-weight-bold">Total</span>
                            <span class="text-success font-weight-bold" id="apTotal" style="font-size: 1.2rem;"></span>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                        <button type="button" class="btn btn-success" id="apConfirmBtn">
                            <i class="fas fa-check"></i> Catat Bayar di Muka
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#advancePaymentModal').remove();
    $('body').append(modalHtml);

    function refreshAdvancePreview() {
        const months = parseInt($('#apMonths').val(), 10) || 1;
        const labels = getUpcomingPeriodLabels(months);
        $('#apPeriodList').html(labels.join(' · '));
        $('#apTotal').text(formatCurrency(pricePerMonth * months));
    }

    $('#apMonths').on('change', refreshAdvancePreview);
    refreshAdvancePreview();

    $('#apConfirmBtn').on('click', function() {
        submitAdvancePayment(userId, userName);
    });

    $('#advancePaymentModal').modal('show');
}

// ============ FREE MONTH (TANDAI GRATIS) FUNCTIONS ============

// Open free-month modal — tandai periode terpilih sebagai GRATIS (bebas tagihan).
function openFreeMonthModal(userId, userName) {
    const periodeLabel = formatSelectedPeriod();
    const { periodMonth, periodYear } = getSelectedPeriod();

    const modalHtml = `
        <div class="modal fade" id="freeMonthModal" tabindex="-1" role="dialog">
            <div class="modal-dialog" role="document">
                <div class="modal-content">
                    <div class="modal-header bg-info text-white">
                        <h5 class="modal-title"><i class="fas fa-gift"></i> Tandai Gratis</h5>
                        <button type="button" class="close text-white" data-dismiss="modal">
                            <span>&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-2">Tandai tagihan <strong>${userName}</strong> untuk periode
                        <strong>${periodeLabel}</strong> sebagai <strong>GRATIS</strong>?</p>
                        <div class="alert alert-info py-2 mb-3">
                            <i class="fas fa-info-circle"></i> Periode ini akan dihitung <strong>lunas</strong>
                            (aman dari isolir), tetapi <strong>tidak dihitung sebagai pemasukan</strong> di laporan.
                        </div>
                        <div class="form-group mb-0">
                            <label for="fmReason" class="font-weight-bold">Alasan</label>
                            <input type="text" class="form-control" id="fmReason"
                                   value="Gratis pemasangan baru" maxlength="120"
                                   placeholder="Contoh: Gratis pemasangan baru / kompensasi gangguan">
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                        <button type="button" class="btn btn-info" id="fmConfirmBtn">
                            <i class="fas fa-check"></i> Tandai Gratis
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    $('#freeMonthModal').remove();
    $('body').append(modalHtml);

    $('#fmConfirmBtn').on('click', function() {
        submitFreeMonth(userId, userName, periodMonth, periodYear);
    });

    $('#freeMonthModal').modal('show');
}

// Submit free-month (tandai gratis)
async function submitFreeMonth(userId, userName, periodMonth, periodYear) {
    if (!ensureValidPeriodSelection()) return;
    const reason = $('#fmReason').val().trim() || 'Gratis (dibebaskan admin)';

    $('#fmConfirmBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');

    try {
        const response = await fetch('/api/payment-status/free', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ userId, period_month: periodMonth, period_year: periodYear, reason })
        });

        const result = await response.json();

        if (response.ok && result.status === 200) {
            $('#freeMonthModal').modal('hide');
            pinnedVisibleUserIds.add(userId);
            await loadUsers();
            showToast(`✅ ${userName} ditandai GRATIS untuk ${formatSelectedPeriod()}.`, 'success');
        } else {
            showToast('Error: ' + (result.message || 'Gagal menandai gratis'), 'danger');
        }
    } catch (error) {
        console.error('Error submitting free month:', error);
        showToast('Error menandai gratis', 'danger');
    } finally {
        $('#fmConfirmBtn').prop('disabled', false).html('<i class="fas fa-check"></i> Tandai Gratis');
    }
}

// Submit advance payment
async function submitAdvancePayment(userId, userName) {
    const months = parseInt($('#apMonths').val(), 10) || 0;
    if (months < 1 || months > 12) {
        showToast('Pilih jumlah bulan 1 sampai 12.', 'warning');
        return;
    }

    $('#apConfirmBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');

    try {
        const response = await fetch('/api/payment-status/advance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ userId, months })
        });

        const result = await response.json();

        if (response.ok && result.status === 200) {
            $('#advancePaymentModal').modal('hide');
            const recordedCount = Array.isArray(result.data?.recorded) ? result.data.recorded.length : 0;
            const skippedCount = Array.isArray(result.data?.skipped) ? result.data.skipped.length : 0;

            if (recordedCount > 0) {
                showToast(`✅ Bayar di muka ${userName} tercatat untuk ${recordedCount} bulan.`, 'success');
                if (result.data.receiptSent) {
                    showToast(`🧾 Struk prabayar telah dikirim ke ${userName}.`, 'info');
                }
            } else {
                showToast(`Tidak ada bulan baru yang dicatat — semua periode sudah lunas.`, 'info');
            }
            if (skippedCount > 0 && recordedCount > 0) {
                showToast(`${skippedCount} bulan dilewati (sudah lunas).`, 'warning');
            }
        } else if (response.status === 409) {
            showToast(result.message || 'Tagihan bulan berjalan belum lunas.', 'danger');
        } else {
            showToast('Error: ' + (result.message || 'Gagal mencatat bayar di muka'), 'danger');
        }
    } catch (error) {
        console.error('Error submitting advance payment:', error);
        showToast('Error mencatat bayar di muka', 'danger');
    } finally {
        $('#apConfirmBtn').prop('disabled', false).html('<i class="fas fa-check"></i> Catat Bayar di Muka');
    }
}
