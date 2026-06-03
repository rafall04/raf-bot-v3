/**
 * Rekap Keuangan - Ledger-backed financial recap page
 */

let allTransactions = [];
let dataTable = null;
let currentDirectionFilter = 'all';
let diagnosticsPayload = null;

$(document).ready(function onReady() {
    initializeSelectors();
    setupEventHandlers();
    loadFinancialData();
});

function initializeSelectors() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const months = [
        'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
        'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    const monthSelect = $('#selectMonth');
    months.forEach((month, index) => {
        const selected = (index + 1) === currentMonth ? 'selected' : '';
        monthSelect.append(`<option value="${index + 1}" ${selected}>${month}</option>`);
    });

    const yearSelect = $('#selectYear');
    for (let year = currentYear; year >= currentYear - 4; year -= 1) {
        const selected = year === currentYear ? 'selected' : '';
        yearSelect.append(`<option value="${year}" ${selected}>${year}</option>`);
    }
}

function setupEventHandlers() {
    $('#refreshBtn, #applyPeriodBtn').on('click', loadFinancialData);

    $('#periodType').on('change', function onPeriodChange() {
        $('#monthSelector').toggle($(this).val() !== 'year');
    });

    $('.ledger-filter-btn').on('click', function onFilterClick() {
        $('.ledger-filter-btn').removeClass('active');
        $(this).addClass('active');
        currentDirectionFilter = $(this).data('filter');
        renderTable();
    });

    $('#domainFilter, #directionFilter, #methodFilter, #sourceFilter').on('change', loadFinancialData);
    $('#exportExcelBtn').on('click', exportToCsv);
    $('#saveAdjustmentBtn').on('click', submitAdjustment);
}

async function loadFinancialData() {
    const periodType = $('#periodType').val();
    const params = new URLSearchParams({
        year: $('#selectYear').val(),
        type: periodType
    });
    const diagnosticsParams = new URLSearchParams({
        year: $('#selectYear').val(),
        type: periodType
    });

    if (periodType !== 'year') {
        const selectedMonth = $('#selectMonth').val();
        params.set('month', selectedMonth);
        diagnosticsParams.set('month', selectedMonth);
    }

    const optionalFilters = {
        domain: $('#domainFilter').val(),
        direction: $('#directionFilter').val(),
        payment_method: $('#methodFilter').val(),
        source: $('#sourceFilter').val()
    };

    Object.entries(optionalFilters).forEach(([key, value]) => {
        if (value) {
            params.set(key, value);
        }
    });

    $('#refreshBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i>');

    try {
        const [response, diagnosticsResponse] = await Promise.all([
            fetch(`/api/rekap-keuangan?${params.toString()}`, {
                credentials: 'include'
            }),
            fetch(`/api/rekap-keuangan/diagnostics?${diagnosticsParams.toString()}`, {
                credentials: 'include'
            })
        ]);
        const payload = await response.json();
        if (payload.status !== 200) {
            throw new Error(payload.message || 'Gagal memuat rekap');
        }
        const diagnosticsResult = await diagnosticsResponse.json();
        diagnosticsPayload = diagnosticsResult.status === 200 ? (diagnosticsResult.data || {}) : null;

        const data = payload.data || {};
        allTransactions = data.transactions || [];
        updateSummaryCards(data.summary || {});
        renderDomainSummary(data.domainSummary || {});
        renderMethodSummary(data.methodSummary || {});
        renderSourceSummary(data.sourceSummary || {});
        renderMonthlyTrend(data.monthlyTrend || []);
        renderExpenseCategorySummary(data.expenseCategorySummary || {});
        renderExpenseList('#recentExpenses', data.recentExpenses || [], 'Belum ada pengeluaran terbaru.');
        renderExpenseList('#largestExpenses', data.largestExpenses || [], 'Belum ada pengeluaran besar.');
        renderCashflowHealth(data.cashflowHealth || {});
        renderDiagnosticsHealth(diagnosticsPayload || {});
        renderTable();
    } catch (error) {
        console.error('[REKAP_KEUANGAN_LOAD_ERROR]', error);
        showToast(error.message || 'Gagal memuat data keuangan', 'danger');
    } finally {
        $('#refreshBtn').prop('disabled', false).html('<i class="fas fa-sync-alt"></i> Refresh');
    }
}

function updateSummaryCards(summary) {
    $('#totalIncome').text(formatCurrency(summary.totalIncome || 0));
    $('#totalExpense').text(formatCurrency(summary.totalExpense || 0));
    $('#netTotal').text(formatCurrency(summary.netTotal || 0));
    $('#totalTransactions').text(summary.totalTransactions || 0);
}

function renderDomainSummary(domainSummary) {
    const container = $('#domainSummary');
    container.empty();
    const entries = Object.entries(domainSummary || {});

    if (entries.length === 0) {
        container.html('<div class="text-muted small">Belum ada transaksi pada periode ini.</div>');
        return;
    }

    entries
        .sort((left, right) => Math.abs((right[1]?.net || 0)) - Math.abs((left[1]?.net || 0)))
        .forEach(([domain, item]) => {
            const credit = item.credit || 0;
            const debit = item.debit || 0;
            const net = item.net || 0;
            container.append(`
                <div class="domain-row">
                    <div>
                        <div class="font-weight-bold text-dark">${humanizeKey(domain)}</div>
                        <div class="small text-muted">${item.count || 0} transaksi</div>
                    </div>
                    <div class="text-right">
                        <div class="small text-success">+ ${formatCurrency(credit)}</div>
                        <div class="small text-danger">- ${formatCurrency(debit)}</div>
                        <div class="font-weight-bold ${net >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(net)}</div>
                    </div>
                </div>
            `);
        });
}

function renderMethodSummary(methodSummary) {
    const container = $('#methodSummary');
    container.empty();
    const entries = Object.entries(methodSummary || {});

    if (entries.length === 0) {
        container.html('<div class="text-muted small">Belum ada metode pembayaran tercatat.</div>');
        return;
    }

    entries.forEach(([method, item]) => {
        container.append(`
            <div class="summary-pill">
                <span class="summary-pill-label">${humanizeKey(method)}</span>
                <span class="summary-pill-value">${formatCurrency(item.amount || 0)}</span>
                <span class="summary-pill-meta">${item.count || 0} transaksi</span>
            </div>
        `);
    });
}

function renderSourceSummary(sourceSummary) {
    const container = $('#sourceSummary');
    container.empty();
    const entries = Object.entries(sourceSummary || {});

    if (entries.length === 0) {
        container.html('<div class="text-muted small">Belum ada sumber transaksi tercatat.</div>');
        return;
    }

    entries.forEach(([source, item]) => {
        container.append(`
            <div class="summary-pill">
                <span class="summary-pill-label">${humanizeKey(source)}</span>
                <span class="summary-pill-value">${formatCurrency(item.amount || 0)}</span>
                <span class="summary-pill-meta">${item.count || 0} transaksi</span>
            </div>
        `);
    });
}

function renderMonthlyTrend(trendRows) {
    const container = $('#monthlyTrend');
    container.empty();

    if (!trendRows.length) {
        container.html('<div class="text-muted small">Belum ada tren cashflow.</div>');
        return;
    }

    trendRows.forEach((row) => {
        container.append(`
            <div class="summary-list-row">
                <div>
                    <div class="font-weight-bold">${row.label}</div>
                    <div class="small text-muted">In ${formatCurrency(row.totalIncome)} / Out ${formatCurrency(row.totalExpense)}</div>
                </div>
                <div class="font-weight-bold ${row.netTotal >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(row.netTotal)}</div>
            </div>
        `);
    });
}

function renderExpenseCategorySummary(summary) {
    const container = $('#expenseCategorySummary');
    container.empty();
    const entries = Object.entries(summary || {}).sort((left, right) => (right[1]?.amount || 0) - (left[1]?.amount || 0));

    if (!entries.length) {
        container.html('<div class="text-muted small">Belum ada pengeluaran aktif pada periode ini.</div>');
        return;
    }

    entries.slice(0, 5).forEach(([category, item]) => {
        container.append(`
            <div class="summary-list-row">
                <div>
                    <div class="font-weight-bold">${humanizeKey(category)}</div>
                    <div class="small text-muted">${item.count || 0} transaksi</div>
                </div>
                <div class="font-weight-bold text-danger">${formatCurrency(item.amount || 0)}</div>
            </div>
        `);
    });
}

function renderExpenseList(selector, items, emptyMessage) {
    const container = $(selector);
    container.empty();

    if (!items.length) {
        container.html(`<div class="text-muted small">${emptyMessage}</div>`);
        return;
    }

    items.forEach((item) => {
        container.append(`
            <div class="summary-list-row">
                <div>
                    <div class="font-weight-bold">${escapeHtml(item.title)}</div>
                    <div class="small text-muted">${humanizeKey(item.category)} • ${formatDateTime(item.expense_date)}</div>
                </div>
                <div class="text-right">
                    <div class="font-weight-bold text-danger">${formatCurrency(item.amount)}</div>
                    <div class="small text-muted">${humanizeKey(item.payment_method || '-')}</div>
                </div>
            </div>
        `);
    });
}

function renderCashflowHealth(health) {
    const container = $('#cashflowHealth');
    container.empty();

    if (!health.warnings || health.warnings.length === 0) {
        container.html(`
            <div class="health-item healthy">
                <div class="font-weight-bold text-success">Cashflow sehat</div>
                <div class="small text-muted">Belum ada warning penting untuk periode ini.</div>
            </div>
        `);
        return;
    }

    health.warnings.forEach((warning) => {
        container.append(`
            <div class="health-item">
                <div class="font-weight-bold text-warning">${humanizeKey(warning.code)}</div>
                <div class="small text-muted">${escapeHtml(warning.message)}</div>
            </div>
        `);
    });
}

function renderDiagnosticsHealth(diagnostics) {
    const container = $('#diagnosticsHealth');
    container.empty();

    if (!diagnostics || Object.keys(diagnostics).length === 0) {
        container.html('<div class="text-muted small">Diagnostics belum tersedia untuk periode ini.</div>');
        return;
    }

    const items = [];
    if ((diagnostics.paidStatusMismatch || 0) > 0) {
        items.push({
            title: 'Mismatch status bayar',
            message: `${diagnostics.paidStatusMismatch} pelanggan belum sinkron dengan read model periode aktif.`,
            healthy: false
        });
    }

    const approval = diagnostics.approvalConsistency || {};
    if ((approval.approved_without_effect || 0) > 0 || (approval.pending_obsolete || 0) > 0 || (approval.orphaned_requests || 0) > 0) {
        items.push({
            title: 'Approval consistency',
            message: `Approved tanpa efek: ${approval.approved_without_effect || 0}, pending obsolete: ${approval.pending_obsolete || 0}, orphan request: ${approval.orphaned_requests || 0}.`,
            healthy: false
        });
    }

    if ((diagnostics.paymentReversals?.count || 0) > 0) {
        items.push({
            title: 'Payment reversal',
            message: `${diagnostics.paymentReversals.count} reversal terdeteksi dengan nilai ${formatCurrency(diagnostics.paymentReversals.amount || 0)}.`,
            healthy: true
        });
    }

    const mismatch = diagnostics.summaryMismatch || {};
    if ((mismatch.incomeDifference || 0) !== 0 || (mismatch.expenseDifference || 0) !== 0 || (mismatch.netDifference || 0) !== 0) {
        items.push({
            title: 'Summary drift',
            message: `Income ${formatCurrency(mismatch.incomeDifference || 0)}, expense ${formatCurrency(mismatch.expenseDifference || 0)}, net ${formatCurrency(mismatch.netDifference || 0)}.`,
            healthy: false
        });
    }

    if (!items.length) {
        container.html(`
            <div class="health-item healthy">
                <div class="font-weight-bold text-success">Diagnostics konsisten</div>
                <div class="small text-muted">Tidak ada mismatch paid-status, approval, atau summary pada periode ini.</div>
            </div>
        `);
        return;
    }

    items.forEach((item) => {
        container.append(`
            <div class="health-item ${item.healthy ? 'healthy' : ''}">
                <div class="font-weight-bold ${item.healthy ? 'text-success' : 'text-warning'}">${escapeHtml(item.title)}</div>
                <div class="small text-muted">${escapeHtml(item.message)}</div>
            </div>
        `);
    });
}

function renderTable() {
    if (dataTable) {
        dataTable.destroy();
    }

    let rows = [...allTransactions];
    if (currentDirectionFilter !== 'all') {
        rows = rows.filter((item) => item.direction === currentDirectionFilter);
    }

    const tbody = $('#transactionTable tbody');
    tbody.empty();

    rows.forEach((transaction) => {
        tbody.append(`
            <tr>
                <td>${formatDateTime(transaction.occurred_at)}</td>
                <td>${humanizeKey(transaction.domain)}</td>
                <td>${buildReferenceLabel(transaction)}</td>
                <td>${renderDirectionBadge(transaction.direction)}</td>
                <td class="${transaction.direction === 'credit' ? 'text-success' : 'text-danger'} font-weight-bold">${formatCurrency(transaction.amount || 0)}</td>
                <td>${humanizeKey(transaction.payment_method || '-')}</td>
                <td>${humanizeKey(transaction.source || '-')}</td>
                <td>${escapeHtml(transaction.notes || '-')}</td>
            </tr>
        `);
    });

    dataTable = $('#transactionTable').DataTable({
        pageLength: 25,
        order: [[0, 'desc']],
        language: {
            url: '//cdn.datatables.net/plug-ins/1.13.7/i18n/id.json'
        }
    });
}

async function submitAdjustment() {
    const payload = {
        direction: $('#adjustmentDirection').val(),
        amount: parseInt($('#adjustmentAmount').val(), 10),
        reason: $('#adjustmentReason').val().trim(),
        domain_target: $('#adjustmentDomainTarget').val(),
        period_month: parseInt($('#selectMonth').val(), 10),
        period_year: parseInt($('#selectYear').val(), 10),
        notes: $('#adjustmentNotes').val().trim()
    };

    if (!payload.amount || payload.amount <= 0) {
        showToast('Nominal adjustment harus lebih besar dari 0.', 'warning');
        return;
    }
    if (!payload.reason) {
        showToast('Alasan adjustment wajib diisi.', 'warning');
        return;
    }

    $('#saveAdjustmentBtn').prop('disabled', true);
    try {
        const response = await fetch('/api/rekap-keuangan/adjustments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.message || 'Gagal membuat adjustment');
        }
        if (result.status === 200 && result.data?.result === 'duplicate_retry') {
            $('#adjustmentModal').modal('hide');
            showToast('Request adjustment yang sama sudah pernah diproses. Tidak ada perubahan baru.', 'warning');
            await loadFinancialData();
            return;
        }
        if (result.status !== 201 || result.data?.result !== 'created') {
            throw new Error(result.message || 'Gagal membuat adjustment');
        }

        $('#adjustmentModal').modal('hide');
        $('#adjustmentForm')[0].reset();
        showToast('Manual adjustment berhasil dibuat.', 'success');
        await loadFinancialData();
    } catch (error) {
        console.error('[ADJUSTMENT_CREATE_ERROR]', error);
        showToast(error.message || 'Gagal membuat adjustment', 'danger');
    } finally {
        $('#saveAdjustmentBtn').prop('disabled', false);
    }
}

function exportToCsv() {
    const rows = [
        ['Tanggal', 'Domain', 'Referensi', 'Arah', 'Nominal', 'Metode', 'Sumber', 'Catatan']
    ];

    const activeRows = currentDirectionFilter === 'all'
        ? allTransactions
        : allTransactions.filter((item) => item.direction === currentDirectionFilter);

    activeRows.forEach((transaction) => {
        rows.push([
            formatDateTime(transaction.occurred_at),
            humanizeKey(transaction.domain),
            buildReferenceLabel(transaction),
            transaction.direction,
            transaction.amount || 0,
            transaction.payment_method || '',
            transaction.source || '',
            transaction.notes || ''
        ]);
    });

    const csv = rows
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rekap-keuangan-ledger-${$('#selectYear').val()}-${$('#selectMonth').val()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

function renderDirectionBadge(direction) {
    if (direction === 'debit') {
        return '<span class="badge badge-danger">Debit</span>';
    }
    return '<span class="badge badge-success">Credit</span>';
}

function buildReferenceLabel(transaction) {
    const referenceType = transaction.reference_type || '-';
    const referenceId = transaction.reference_id || '-';
    return `${referenceType} #${referenceId}`;
}

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('id-ID');
}

function formatCurrency(amount) {
    return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
}

function humanizeKey(value) {
    if (!value) return '-';
    return String(value)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (match) => match.toUpperCase());
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
    const toast = $(`
        <div class="alert alert-${type} alert-dismissible fade show toast-alert" role="alert">
            ${escapeHtml(message)}
            <button type="button" class="close" data-dismiss="alert">
                <span>&times;</span>
            </button>
        </div>
    `);

    $('#toastContainer').append(toast);
    setTimeout(() => toast.alert('close'), 4000);
}
