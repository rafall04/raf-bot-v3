let saldoTable, transactionTable;
let allTransactions = [];
let allSaldoData = [];
let allTopupRequests = [];
let refreshInterval = null; // Store interval ID for cleanup

$(document).ready(function() {
    // Initialize DataTables
    saldoTable = $('#saldoTable').DataTable({
        language: {
            "sProcessing":   "Sedang memproses...",
            "sLengthMenu":   "Tampilkan _MENU_ entri",
            "sZeroRecords":  "Tidak ditemukan data yang sesuai",
            "sInfo":         "Menampilkan _START_ sampai _END_ dari _TOTAL_ entri",
            "sInfoEmpty":    "Menampilkan 0 sampai 0 dari 0 entri",
            "sInfoFiltered": "(disaring dari _MAX_ entri keseluruhan)",
            "sInfoPostFix":  "",
            "sSearch":       "Cari:",
            "sUrl":          "",
            "oPaginate": {
                "sFirst":    "Pertama",
                "sPrevious": "Sebelumnya",
                "sNext":     "Selanjutnya",
                "sLast":     "Terakhir"
            }
        },
        order: [[3, 'desc']]
    });

    transactionTable = $('#transactionTable').DataTable({
        language: {
            "sProcessing":   "Sedang memproses...",
            "sLengthMenu":   "Tampilkan _MENU_ entri",
            "sZeroRecords":  "Tidak ditemukan data yang sesuai",
            "sInfo":         "Menampilkan _START_ sampai _END_ dari _TOTAL_ entri",
            "sInfoEmpty":    "Menampilkan 0 sampai 0 dari 0 entri",
            "sInfoFiltered": "(disaring dari _MAX_ entri keseluruhan)",
            "sInfoPostFix":  "",
            "sSearch":       "Cari:",
            "sUrl":          "",
            "oPaginate": {
                "sFirst":    "Pertama",
                "sPrevious": "Sebelumnya",
                "sNext":     "Selanjutnya",
                "sLast":     "Terakhir"
            }
        },
        order: [[1, 'desc']]
    });


    // Load initial data
    loadStatistics();
    loadTopupRequests();
    loadSaldoData();
    loadTransactions();

    // Auto refresh every 30 seconds - Store interval ID for cleanup
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    refreshInterval = setInterval(function() {
        loadStatistics();
        loadTopupRequests();
    }, 30000);
    
    // Setup event listeners for buttons (to avoid CSP issues with onclick)
    // Remove old listeners first to prevent memory leaks
    setupButtonEventListeners();
});

// Cleanup on page unload
$(window).on('beforeunload', function() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    // Remove all event listeners with namespace
    $(document).off('click.saldoManagement');
});

// Setup event listeners for all buttons
// Use namespace to prevent memory leaks and allow easy cleanup
function setupButtonEventListeners() {
    // Remove old listeners first to prevent memory leaks
    $(document).off('click.saldoManagement');
    
    // Button "Tambah Saldo Manual"
    $(document).on('click.saldoManagement', '#btnAddSaldoManual', function() {
        window.showAddSaldoModal();
    });
    
    // Button "Tambah Saldo" in modal
    $(document).on('click.saldoManagement', '#btnSubmitAddSaldo', function() {
        window.addSaldoManual();
    });
    
    // Button "Topup Saldo Agent"
    $(document).on('click.saldoManagement', '#btnAddAgentSaldo', function() {
        if (window.showAddAgentSaldoModal) {
            window.showAddAgentSaldoModal();
        }
    });
    
    // Button "Topup Saldo" in agent modal
    $(document).on('click.saldoManagement', '#btnSubmitAddAgentSaldo', function() {
        if (window.addAgentSaldoManual) {
            window.addAgentSaldoManual();
        }
    });
    
    // Button "Approve/Reject" in topup requests (dynamic content)
    $(document).on('click.saldoManagement', '.btn-verify-topup', function() {
        const requestId = $(this).data('request-id');
        const approved = $(this).data('approved') === true || $(this).data('approved') === 'true';
        if (window.verifyTopup && requestId) {
            window.verifyTopup(requestId, approved);
        }
    });
    
    // Button "Lihat Bukti" in topup requests (dynamic content)
    $(document).on('click.saldoManagement', '.btn-view-proof', function() {
        const requestId = $(this).data('request-id');
        const proofFile = $(this).data('proof-file');
        if (window.viewTopupProof && requestId && proofFile) {
            window.viewTopupProof(requestId, proofFile);
        }
    });
    
    // Button "Show Transactions" in user saldo table (dynamic content)
    $(document).on('click.saldoManagement', '.btn-show-transactions', function() {
        const userId = $(this).data('user-id');
        if (window.showUserTransactions && userId) {
            window.showUserTransactions(userId);
        }
    });
    
    // Button "Add Saldo" in user saldo table (dynamic content)
    $(document).on('click.saldoManagement', '.btn-add-saldo-user', function() {
        const userId = $(this).data('user-id');
        if (window.showAddSaldoModal && userId) {
            window.showAddSaldoModal(userId);
        }
    });
    
    // Button "Topup Agent" in agent saldo table (dynamic content)
    $(document).on('click.saldoManagement', '.btn-topup-agent', function() {
        const agentId = $(this).data('agent-id');
        const agentName = $(this).data('agent-name');
        if (window.topupAgentSaldo && agentId && agentName) {
            window.topupAgentSaldo(agentId, agentName);
        }
    });
    
    // Button "View Proof" in transaction table (dynamic content)
    $(document).on('click.saldoManagement', '.btn-view-transaction-proof', function() {
        const transactionId = $(this).data('transaction-id');
        if (window.viewProof && transactionId) {
            window.viewProof(transactionId);
        }
    });
    
}

function formatRupiah(amount) {
    const numericAmount = Number.parseInt(amount, 10);
    return 'Rp ' + (Number.isFinite(numericAmount) ? numericAmount : 0).toLocaleString('id-ID');
}

function formatNumber(amount) {
    const numericAmount = Number.parseInt(amount, 10);
    return (Number.isFinite(numericAmount) ? numericAmount : 0).toLocaleString('id-ID');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatUserIdentifier(userId) {
    const normalized = typeof userId === 'string' ? userId.trim() : '';
    if (!normalized) {
        return '-';
    }

    if (normalized.endsWith('@s.whatsapp.net')) {
        return normalized.replace('@s.whatsapp.net', '');
    }

    return normalized;
}

function loadStatistics() {
    $.get('/api/saldo/statistics', function(data) {
        $('#totalSaldo').text(formatRupiah(data.totalSaldo || 0));
        $('#activeUsers').text(data.activeUsers || 0);
        $('#pendingTopups').text(data.pendingTopups || 0);
        $('#todayTransactions').text(data.todayTransactions || 0);
        $('#pendingBadge').text(data.pendingTopups || 0);
    }).fail(function(xhr, status, error) {
        console.error('Failed to load statistics:', status, error, xhr.responseText);
    });
}

function loadTopupRequests() {
    $.get('/api/saldo/topup-requests', function(response) {
        // Handle response that might be {data: Array} or direct array
        let data = response;
        if (response && typeof response === 'object' && 'data' in response) {
            data = response.data;
        }
        
        // Ensure data is an array
        if (!Array.isArray(data)) {
            console.error('Invalid topup requests data:', response);
            allTopupRequests = [];
            renderTopupRequests([]);
            return;
        }
        allTopupRequests = data;
        // Show both pending and waiting_verification requests
        renderTopupRequests(data.filter(r => r.status === 'pending' || r.status === 'waiting_verification'));
    }).fail(function(xhr, status, error) {
        console.error('Failed to load topup requests:', status, error, xhr.responseText);
        allTopupRequests = [];
        renderTopupRequests([]);
    });
}

function renderTopupRequests(requests) {
    const container = $('#topupRequestsList');
    container.empty();

    if (requests.length === 0) {
        container.html(`
            <div class="text-center py-5">
                <i class="fas fa-inbox fa-3x text-gray-300 mb-3"></i>
                <p class="text-muted">Tidak ada request topup pending</p>
            </div>
        `);
        return;
    }

    requests.forEach(request => {
        const statusBadge = getStatusBadge(request.status);
        const hasProof = Boolean(request.paymentProof);
        const canApprove = request.paymentMethod === 'cash' || hasProof;
        
        // Display name with priority: customerName > formatted phone
        const rawUserId = typeof request.userId === 'string' ? request.userId : '';
        const phoneNumber = rawUserId ? rawUserId.replace('@s.whatsapp.net', '') : '-';
        const displayName = request.customerName || (phoneNumber.startsWith('62') && phoneNumber.length > 10 ? '+' + phoneNumber.substring(0, 2) + ' ' + phoneNumber.substring(2) : phoneNumber);
        
        const card = $(`
            <div class="card topup-request-card mb-3 ${request.status === 'waiting_verification' ? 'border-warning' : ''}">
                <div class="card-body">
                    <div class="row align-items-center">
                        <div class="col-md-8">
                            <h6 class="font-weight-bold mb-2">
                                <i class="fas fa-user-circle"></i> ${displayName}
                            </h6>
                            <small class="text-muted d-block"><i class="fas fa-phone"></i> ${phoneNumber}</small>
                            <p class="mb-1">
                                <span class="badge badge-primary">Rp ${formatNumber(request.amount)}</span>
                                <span class="badge badge-info">${request.paymentMethod}</span>
                            </p>
                            <small class="text-muted">
                                <i class="fas fa-clock"></i> ${formatDate(request.created_at)}
                            </small>
                            ${request.paymentProof ? `
                                <div class="mt-2">
                                    <button class="btn btn-info btn-sm btn-view-proof" data-request-id="${request.id.replace(/'/g, "\\'")}" data-proof-file="${(request.paymentProof || '').replace(/'/g, "\\'")}" title="Lihat Bukti">
                                        <i class="fas fa-image"></i> Lihat Bukti
                                    </button>
                                    <span class="badge badge-warning ml-2">
                                        <i class="fas fa-exclamation-triangle"></i> Menunggu Verifikasi
                                    </span>
                                </div>
                            ` : request.paymentMethod === 'cash' ? `
                                <div class="mt-2">
                                    <span class="badge badge-info">
                                        <i class="fas fa-user-tie"></i> Menunggu Konfirmasi Agent
                                    </span>
                                </div>
                            ` : `
                                <div class="mt-2">
                                    <span class="badge badge-secondary">
                                        <i class="fas fa-clock"></i> Menunggu Bukti Transfer
                                    </span>
                                </div>
                            `}
                        </div>
                        <div class="col-md-4 text-right">
                            <button class="btn btn-success btn-sm btn-verify-topup" data-request-id="${request.id.replace(/'/g, "\\'")}" data-approved="true" ${canApprove ? '' : 'disabled title="Bukti transfer wajib diupload sebelum approve"'}>
                                <i class="fas fa-check"></i> Approve
                            </button>
                            <button class="btn btn-danger btn-sm btn-verify-topup" data-request-id="${request.id.replace(/'/g, "\\'")}" data-approved="false">
                                <i class="fas fa-times"></i> Reject
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `);
        container.append(card);
    });
}

function loadSaldoData() {
    $.get('/api/saldo/users', function(response) {
        // Handle response that might be {data: Array} or direct array
        let data = response;
        if (response && typeof response === 'object' && 'data' in response) {
            data = response.data;
        }
        
        // Ensure data is an array
        if (!Array.isArray(data)) {
            console.error('Invalid saldo data:', response);
            allSaldoData = [];
            saldoTable.clear().draw();
            return;
        }
        allSaldoData = data;
        
        // Filter only users with saldo > 0
        const usersWithSaldo = data.filter(u => u.saldo > 0);
        
        saldoTable.clear();
        
        usersWithSaldo.forEach((user, index) => {
            // Extract name and phone for display
            const phoneNumber = formatUserIdentifier(user.id);
            const displayName = user.name || phoneNumber;
            
            // Enhanced display: Show name + phone number for clarity
            // This prevents confusion when multiple accounts have same name
            const nameDisplay = user.name 
                ? `<strong>${displayName}</strong><br><small class="text-muted">${phoneNumber}</small>`
                : phoneNumber;
            
            // Escape single quotes in user.id for onclick handler
            const safeUserId = (user.id || '').replace(/'/g, "\\'");
            
            saldoTable.row.add([
                index + 1,
                user.id,
                nameDisplay,
                formatRupiah(user.saldo || 0),
                formatDate(user.updated_at || new Date()),
                `
                    <button class="btn btn-sm btn-primary btn-show-transactions" data-user-id="${safeUserId}">
                        <i class="fas fa-history"></i>
                    </button>
                    <button class="btn btn-sm btn-success btn-add-saldo-user" data-user-id="${safeUserId}">
                        <i class="fas fa-plus"></i>
                    </button>
                `
            ]);
        });
        
        saldoTable.draw();
    }).fail(function() {
        console.error('Failed to load saldo data');
    });
}

function loadTransactions() {
    $.get('/api/saldo/transactions', function(response) {
        // Handle response that might be {data: Array} or direct array
        let data = response;
        if (response && typeof response === 'object' && 'data' in response) {
            data = response.data;
        }
        
        // Ensure data is an array
        if (!Array.isArray(data)) {
            console.error('Invalid transactions data:', response);
            allTransactions = [];
            renderTransactions([]);
            return;
        }
        allTransactions = data;
        renderTransactions(data);
    }).fail(function(xhr, status, error) {
        console.error('Failed to load transactions:', status, error, xhr.responseText);
        allTransactions = [];
        renderTransactions([]);
    });
}

function renderTransactions(transactions) {
    transactionTable.clear();
    
    // Ensure transactions is an array
    if (!Array.isArray(transactions)) {
        console.error('Invalid transactions array:', transactions);
        transactionTable.draw();
        return;
    }
    
    transactions.forEach(tx => {
        const typeClass = tx.type === 'credit' ? 'credit' : 'debit';
        const typeIcon = tx.type === 'credit' ? '↓' : '↑';
        
        // Format user display: try to find name from saldo data
        const rawUserId = typeof tx.userId === 'string' ? tx.userId : '';
        const phoneNumber = rawUserId ? rawUserId.replace('@s.whatsapp.net', '') : '-';
        const userSaldo = rawUserId ? allSaldoData.find(u => u.id === rawUserId) : null;
        const userDisplay = userSaldo && userSaldo.name
            ? `<strong>${userSaldo.name}</strong><br><small class="text-muted">${phoneNumber}</small>`
            : (tx.userName ? `<strong>${tx.userName}</strong><br><small class="text-muted">${phoneNumber}</small>` : phoneNumber);
        
        // Proof button
        let proofButton = '<span class="text-muted">-</span>';
        
        if (tx.hasProof) {
            const safeTxId = (tx.id || '').replace(/"/g, '&quot;');
            proofButton = `<button class="btn btn-sm btn-success btn-view-transaction-proof" data-transaction-id="${safeTxId}" title="Lihat Bukti Transfer">
                <i class="fas fa-file-image"></i> Lihat
            </button>`;
        }
        
        transactionTable.row.add([
            tx.id,
            formatDate(tx.created_at),
            userDisplay,
            `<span class="${typeClass}">${typeIcon} ${tx.type.toUpperCase()}</span>`,
            `<span class="${typeClass}">${formatRupiah(tx.amount)}</span>`,
            tx.description,
            formatRupiah(tx.balance_after || 0),
            proofButton
        ]);
    });
    
    transactionTable.draw();
}

// View topup proof from transaction (popup modal)
window.viewProof = function(transactionId) {
    const proofUrl = `/api/saldo/transaction/${transactionId}/proof`;

    Swal.fire({
        title: 'Bukti Transfer',
        html: `
            <div class="text-center">
                <img src="${proofUrl}" class="img-fluid proof-preview-image" style="max-height: 500px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" alt="Bukti transfer">
                <div class="alert alert-warning mt-3 d-none proof-preview-error">
                    Bukti transfer untuk transaksi ini tidak ditemukan atau sudah tidak tersedia.
                </div>
                <div class="mt-3">
                    <p class="text-muted mb-2">
                        <i class="fas fa-receipt"></i> Transaction ID: <code>${transactionId}</code>
                    </p>
                    <a href="${proofUrl}" target="_blank" class="btn btn-sm btn-outline-primary">
                        <i class="fas fa-external-link-alt"></i> Buka di Tab Baru
                    </a>
                </div>
            </div>
        `,
        width: '700px',
        showCloseButton: true,
        confirmButtonText: '<i class="fas fa-times"></i> Tutup',
        confirmButtonColor: '#6c757d',
        customClass: {
            popup: 'animated fadeIn faster'
        },
        didOpen: () => {
            const container = Swal.getHtmlContainer();
            const image = container ? container.querySelector('.proof-preview-image') : null;
            const errorBox = container ? container.querySelector('.proof-preview-error') : null;

            if (image && errorBox) {
                image.addEventListener('error', () => {
                    image.classList.add('d-none');
                    errorBox.classList.remove('d-none');
                }, { once: true });
            }
        }
    });
};

// Make functions globally accessible for onclick handlers
window.showAddSaldoModal = function(userId = '') {
    $('#addSaldoUserId').val(userId || '');
    $('#addSaldoModal').modal('show');
};

window.addSaldoManual = function() {
    const userId = $('#addSaldoUserId').val();
    const amount = $('#addSaldoAmount').val();
    const description = $('#addSaldoDescription').val();

    if (!userId || !amount) {
        Swal.fire('Error', 'Lengkapi semua field', 'error');
        return;
    }

    // Format user ID if needed
    let formattedUserId = userId;
    if (!userId.includes('@')) {
        formattedUserId = userId + '@s.whatsapp.net';
    }

    $.post('/api/saldo/add-manual', {
        userId: formattedUserId,
        amount: amount,
        description: description
    }, function(response) {
        if (response.success) {
            Swal.fire('Sukses', 'Saldo berhasil ditambahkan', 'success');
            $('#addSaldoModal').modal('hide');
            $('#addSaldoForm')[0].reset();
            loadSaldoData();
            loadTransactions();
            loadStatistics();
        } else {
            Swal.fire('Error', response.message || 'Gagal menambah saldo', 'error');
        }
    }).fail(function() {
        Swal.fire('Error', 'Gagal menambah saldo', 'error');
    });
};

// verifyTopup function moved to end of file to avoid duplication

window.showUserTransactions = function(userId) {
    // Filter transactions for specific user
    const userTransactions = allTransactions.filter(tx => tx.userId === userId);
    
    // Create modal content
    let content = '<div class="table-responsive"><table class="table table-sm">';
    content += '<thead><tr><th>Tanggal</th><th>Tipe</th><th>Jumlah</th><th>Keterangan</th></tr></thead><tbody>';
    
    if (userTransactions.length === 0) {
        content += '<tr><td colspan="4" class="text-center">Tidak ada transaksi</td></tr>';
    } else {
        userTransactions.slice(0, 10).forEach(tx => {
            const typeClass = tx.type === 'credit' ? 'text-success' : 'text-danger';
            content += `<tr>
                <td>${formatDate(tx.created_at)}</td>
                <td class="${typeClass}">${tx.type.toUpperCase()}</td>
                <td class="${typeClass}">${formatRupiah(tx.amount)}</td>
                <td>${tx.description}</td>
            </tr>`;
        });
    }
    
    content += '</tbody></table></div>';
    
    Swal.fire({
        title: `Riwayat Transaksi: ${userId}`,
        html: content,
        width: '800px',
        confirmButtonText: 'Tutup'
    });
}

function getStatusBadge(status) {
    const badges = {
        'pending': '<span class="badge badge-warning">Pending</span>',
        'waiting_verification': '<span class="badge badge-info">Menunggu Verifikasi</span>',
        'verified': '<span class="badge badge-success">Terverifikasi</span>',
        'rejected': '<span class="badge badge-danger">Ditolak</span>',
        'cancelled': '<span class="badge badge-secondary">Dibatalkan</span>'
    };
    return badges[status] || '<span class="badge badge-secondary">Unknown</span>';
}

window.viewTopupProof = function(requestId, proofFile) {
    const proofPath = String(proofFile || '').startsWith('/static/')
        ? proofFile
        : `/temp/topup_proofs/${proofFile}`;
    Swal.fire({
        title: 'Bukti Transfer',
        html: `
            <div class="text-center">
                <img src="${proofPath}" class="img-fluid" style="max-height: 400px;">
                <div class="mt-3">
                    <p class="text-muted">Request ID: ${requestId}</p>
                </div>
            </div>
        `,
        width: '600px',
        confirmButtonText: 'Tutup'
    });
};

window.verifyTopup = function(requestId, approved) {
    const targetRequest = allTopupRequests.find((request) => String(request.id) === String(requestId));
    if (approved && targetRequest && targetRequest.paymentMethod !== 'cash' && !targetRequest.paymentProof) {
        Swal.fire('Bukti Transfer Belum Ada', 'Request transfer hanya bisa di-approve setelah bukti transfer diupload.', 'warning');
        return;
    }
    const title = approved ? 'Approve Topup?' : 'Reject Topup?';
    const text = approved ? 'Saldo akan ditambahkan ke user' : 'Request akan ditolak';
    
    Swal.fire({
        title: title,
        text: text,
        input: approved ? null : 'textarea',
        inputPlaceholder: approved ? null : 'Alasan penolakan (opsional)',
        icon: approved ? 'question' : 'warning',
        showCancelButton: true,
        confirmButtonColor: approved ? '#28a745' : '#dc3545',
        confirmButtonText: approved ? 'Ya, Approve' : 'Ya, Reject',
        cancelButtonText: 'Batal'
    }).then((result) => {
        if (result.isConfirmed) {
            const notes = result.value || '';
            
            $.post('/api/saldo/verify-topup', {
                requestId: requestId,
                approved: approved,
                notes: notes
            }, function(response) {
                if (response.success) {
                    Swal.fire(
                        'Berhasil!',
                        response.message,
                        'success'
                    );
                    loadTopupRequests();
                    loadSaldoData();
                    loadTransactions();
                    loadStatistics();
                } else {
                    Swal.fire('Error', response.message || 'Gagal memverifikasi topup', 'error');
                }
            }).fail(function() {
                Swal.fire('Error', 'Gagal memverifikasi topup', 'error');
            });
        }
    });
}
