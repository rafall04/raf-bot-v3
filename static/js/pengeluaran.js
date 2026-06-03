let expenseTable = null;
let expenseRows = [];
let expenseCategories = [];

$(document).ready(function onReady() {
    initializeExpenseFilters();
    setupExpenseHandlers();
    loadExpenseMeta().then(loadExpenses);
});

function initializeExpenseFilters() {
    const now = new Date();
    const monthSelect = $('#expenseMonth');
    const yearSelect = $('#expenseYear');
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    months.forEach((label, index) => {
        monthSelect.append(`<option value="${index + 1}" ${(index + 1) === (now.getMonth() + 1) ? 'selected' : ''}>${label}</option>`);
    });

    for (let year = now.getFullYear(); year >= now.getFullYear() - 4; year -= 1) {
        yearSelect.append(`<option value="${year}" ${year === now.getFullYear() ? 'selected' : ''}>${year}</option>`);
    }

    $('#expenseDate').val(now.toISOString().slice(0, 10));
}

function setupExpenseHandlers() {
    $('#refreshExpensesBtn, #applyExpenseFilterBtn').on('click', loadExpenses);
    $('#saveExpenseBtn').on('click', saveExpense);
    $('#newExpenseBtn').on('click', () => openExpenseModal());
}

async function loadExpenseMeta() {
    const response = await fetch('/api/expenses/meta', { credentials: 'include' });
    const payload = await response.json();
    expenseCategories = payload.data?.categories || [];

    const options = expenseCategories
        .map((item) => `<option value="${item}">${humanizeKey(item)}</option>`)
        .join('');

    $('#expenseCategory').html(options);
    $('#expenseCategoryFilter').append(options);
}

async function loadExpenses() {
    const params = new URLSearchParams({
        month: $('#expenseMonth').val(),
        year: $('#expenseYear').val()
    });

    if ($('#expenseCategoryFilter').val()) params.set('category', $('#expenseCategoryFilter').val());
    if ($('#expenseStatusFilter').val()) params.set('status', $('#expenseStatusFilter').val());

    $('#refreshExpensesBtn').prop('disabled', true);
    try {
        const response = await fetch(`/api/expenses?${params.toString()}`, { credentials: 'include' });
        const payload = await response.json();
        if (!response.ok || payload.status !== 200) {
            throw new Error(payload.message || 'Gagal memuat pengeluaran');
        }

        expenseRows = payload.data || [];
        renderExpenseSummary(payload.summary || {});
        renderExpenseTable();
    } catch (error) {
        showExpenseToast(error.message || 'Gagal memuat pengeluaran', 'danger');
    } finally {
        $('#refreshExpensesBtn').prop('disabled', false);
    }
}

function renderExpenseSummary(summary) {
    $('#expenseTotalAmount').text(formatCurrency(summary.total_expense || 0));
    $('#expenseTotalRecords').text(summary.total_records || 0);
    $('#largestExpenseAmount').text(formatCurrency(summary.largest?.[0]?.amount || 0));

    const dominant = Object.entries(summary.by_category || {})
        .sort((left, right) => (right[1]?.amount || 0) - (left[1]?.amount || 0))[0];
    $('#dominantExpenseCategory').text(dominant ? humanizeKey(dominant[0]) : '-');
}

function renderExpenseTable() {
    if (expenseTable) {
        expenseTable.destroy();
    }

    const tbody = $('#expenseTable tbody');
    tbody.empty();

    expenseRows.forEach((row) => {
        const canMutate = row.status === 'active';
        tbody.append(`
            <tr>
                <td>${formatDate(row.expense_date)}</td>
                <td>${escapeHtml(row.title)}</td>
                <td>${humanizeKey(row.category)}</td>
                <td class="text-danger font-weight-bold">${formatCurrency(row.amount)}</td>
                <td>${humanizeKey(row.payment_method)}</td>
                <td>${escapeHtml(row.vendor_or_counterparty || '-')}</td>
                <td>${renderStatusBadge(row.status)}</td>
                <td>
                    ${canMutate ? `<button class="btn btn-sm btn-primary mr-1" onclick="openExpenseModal(${row.id})"><i class="fas fa-edit"></i></button>` : ''}
                    ${canMutate ? `<button class="btn btn-sm btn-outline-danger" onclick="cancelExpense(${row.id})"><i class="fas fa-ban"></i></button>` : ''}
                </td>
            </tr>
        `);
    });

    expenseTable = $('#expenseTable').DataTable({
        pageLength: 25,
        order: [[0, 'desc']],
        language: {
            url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/id.json'
        }
    });
}

function openExpenseModal(id = null) {
    $('#expenseForm')[0].reset();
    $('#expenseId').val('');
    $('#expenseDate').val(new Date().toISOString().slice(0, 10));
    $('#expenseModalTitle').text('Input Pengeluaran');

    if (id) {
        const item = expenseRows.find((row) => String(row.id) === String(id));
        if (!item) return;
        $('#expenseId').val(item.id);
        $('#expenseModalTitle').text(`Revisi Pengeluaran #${item.id}`);
        $('#expenseTitle').val(item.title);
        $('#expenseCategory').val(item.category);
        $('#expenseAmount').val(item.amount);
        $('#expenseDate').val((item.expense_date || '').slice(0, 10));
        $('#expensePaymentMethod').val(item.payment_method);
        $('#expenseVendor').val(item.vendor_or_counterparty || '');
        $('#expenseNotes').val(item.notes || '');
    }

    $('#expenseModal').modal('show');
}

async function saveExpense() {
    const id = $('#expenseId').val();
    const payload = {
        title: $('#expenseTitle').val().trim(),
        category: $('#expenseCategory').val(),
        amount: parseInt($('#expenseAmount').val(), 10),
        expense_date: $('#expenseDate').val(),
        payment_method: $('#expensePaymentMethod').val(),
        vendor_or_counterparty: $('#expenseVendor').val().trim(),
        notes: $('#expenseNotes').val().trim()
    };

    if (!payload.title || !payload.category || !payload.amount || !payload.expense_date || !payload.payment_method) {
        showExpenseToast('Lengkapi seluruh field wajib pengeluaran.', 'warning');
        return;
    }

    $('#saveExpenseBtn').prop('disabled', true);
    try {
        const response = await fetch(id ? `/api/expenses/${id}` : '/api/expenses', {
            method: id ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || 'Gagal menyimpan pengeluaran');
        }
        $('#expenseModal').modal('hide');
        showExpenseToast(result.message || 'Pengeluaran berhasil disimpan', 'success');
        await loadExpenses();
    } catch (error) {
        showExpenseToast(error.message || 'Gagal menyimpan pengeluaran', 'danger');
    } finally {
        $('#saveExpenseBtn').prop('disabled', false);
    }
}

async function cancelExpense(id) {
    const notes = window.prompt('Catatan pembatalan pengeluaran:');
    if (notes === null) return;

    try {
        const response = await fetch(`/api/expenses/${id}/cancel`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ notes })
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || 'Gagal membatalkan pengeluaran');
        }
        showExpenseToast(result.message || 'Pengeluaran dibatalkan', 'success');
        await loadExpenses();
    } catch (error) {
        showExpenseToast(error.message || 'Gagal membatalkan pengeluaran', 'danger');
    }
}

function renderStatusBadge(status) {
    const map = {
        active: '<span class="badge badge-danger">Active</span>',
        revised: '<span class="badge badge-warning">Revised</span>',
        cancelled: '<span class="badge badge-secondary">Cancelled</span>'
    };
    return map[status] || escapeHtml(status || '-');
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('id-ID');
}

function formatCurrency(amount) {
    return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
}

function humanizeKey(value) {
    return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showExpenseToast(message, type) {
    const toast = $(`
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${escapeHtml(message)}
            <button type="button" class="close" data-dismiss="alert"><span>&times;</span></button>
        </div>
    `);
    $('#expenseToastContainer').append(toast);
    setTimeout(() => toast.alert('close'), 4000);
}
