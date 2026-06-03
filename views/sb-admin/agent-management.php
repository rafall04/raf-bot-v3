<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Agent Management - RAF NET</title>
    
    <!-- Custom fonts -->
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    
    <!-- Custom styles -->
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    
    <style>
        .agent-card {
            border-left: 3px solid var(--primary);
            transition: all 0.3s;
            background: #ffffff;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .agent-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .service-badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            margin: 0.1rem;
            border-radius: 6px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .service-topup { background-color: var(--success); color: white; }
        .service-voucher { background-color: var(--info); color: white; }
        .service-pembayaran { background-color: var(--warning); color: white; }
        .status-active { color: var(--success); }
        .status-inactive { color: var(--danger); }
        
        /* Toast container styling */
        .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            min-width: 300px;
        }
        
        .toast {
            margin-bottom: 10px;
        }
        
        .toast-header {
            font-weight: 600;
        }
        
        .toast.bg-success .toast-header {
            background-color: #28a745 !important;
            color: white;
        }
        
        .toast.bg-danger .toast-header {
            background-color: #dc3545 !important;
            color: white;
        }
        
        .toast.bg-warning .toast-header {
            background-color: #ffc107 !important;
            color: #212529;
        }
        
        .toast.bg-info .toast-header {
            background-color: #17a2b8 !important;
            color: white;
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>
                
                <div class="container-fluid">
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <h1>Agent Management</h1>
                                <p>Kelola agent dan outlet untuk topup saldo</p>
                            </div>
                            <button class="btn btn-primary-custom" onclick="showAddAgentModal()">
                                <i class="fas fa-plus"></i> Tambah Agent
                            </button>
                        </div>
                    </div>
                    
                    <!-- Statistics Cards -->
                    <h4 class="dashboard-section-title">Statistik Agent</h4>
                    <div class="row match-height mb-4">
                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card dashboard-card card-primary">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Total Agent</div>
                                            <div class="card-value" id="totalAgents">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-circle" style="font-size: 8px;"></i>
                                                <span>Registered</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-store"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card dashboard-card card-success">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Agent Aktif</div>
                                            <div class="card-value" id="activeAgents">0</div>
                                            <div class="card-subtitle">
                                                <span class="card-change positive">
                                                    <i class="fas fa-check-circle"></i> Active
                                                </span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-check-circle"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card dashboard-card card-info">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Area Terlayani</div>
                                            <div class="card-value" id="totalAreas">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-circle" style="font-size: 8px;"></i>
                                                <span>Locations</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-map-marked-alt fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="col-xl-3 col-md-6 mb-4">
                            <div class="card dashboard-card card-warning">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Total Layanan</div>
                                            <div class="card-value" id="totalServices">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-circle" style="font-size: 8px;"></i>
                                                <span>Services</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-clipboard-list"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Agent List -->
                    <h4 class="dashboard-section-title">Daftar Agent</h4>
                    <div class="card table-card mb-4">
                        <div class="card-header">
                            <h6>Daftar Agent</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered" id="agentTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama Agent</th>
                                            <th>Telepon</th>
                                            <th>Area</th>
                                            <th>Alamat</th>
                                            <th>Layanan</th>
                                            <th>Jam Operasional</th>
                                            <th>Status</th>
                                            <th>PIN Status</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody id="agentTableBody">
                                        <!-- Data will be loaded here -->
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <?php include 'footer.php'; ?>
        </div>
    </div>
    
    <!-- Toast Container for Notifications -->
    <div class="toast-container" aria-live="polite" aria-atomic="true"></div>
    
    <!-- Add/Edit Agent Modal -->
    <div class="modal fade" id="agentModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="agentModalTitle">Tambah Agent</h5>
                    <button type="button" class="close" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="agentForm">
                        <input type="hidden" id="agentId">
                        
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Nama Agent *</label>
                                <input type="text" class="form-control" id="agentName" required>
                            </div>
                            <div class="form-group col-md-6">
                                <label>Nomor Telepon *</label>
                                <input type="text" class="form-control" id="agentPhone" required>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Area *</label>
                                <input type="text" class="form-control" id="agentArea" required>
                            </div>
                            <div class="form-group col-md-6">
                                <label>Jam Operasional</label>
                                <input type="text" class="form-control" id="agentHours" value="08:00 - 20:00">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Alamat Lengkap *</label>
                            <textarea class="form-control" id="agentAddress" rows="2" required></textarea>
                        </div>
                        
                        <div class="form-group">
                            <label>Layanan yang Tersedia</label>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="topup" id="serviceTopup" checked>
                                <label class="form-check-label" for="serviceTopup">
                                    Topup Saldo
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="voucher" id="serviceVoucher" checked>
                                <label class="form-check-label" for="serviceVoucher">
                                    Jual Voucher
                                </label>
                            </div>
                            <div class="form-check">
                                <input class="form-check-input" type="checkbox" value="pembayaran" id="servicePembayaran">
                                <label class="form-check-label" for="servicePembayaran">
                                    Terima Pembayaran
                                </label>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Latitude (Opsional)</label>
                                <input type="text" class="form-control" id="agentLat" placeholder="-2.2833">
                            </div>
                            <div class="form-group col-md-6">
                                <label>Longitude (Opsional)</label>
                                <input type="text" class="form-control" id="agentLng" placeholder="115.3833">
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" onclick="saveAgent()">Simpan</button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- PIN Management Modal -->
    <div class="modal fade" id="pinModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-md" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="pinModalTitle">Manage PIN Agent</h5>
                    <button type="button" class="close" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="pinAgentId">
                    <input type="hidden" id="pinAgentPhone">
                    <input type="hidden" id="pinAgentName">
                    
                    <div id="pinStatusInfo" class="alert alert-info mb-3">
                        <i class="fas fa-info-circle"></i> <span id="pinStatusText">Loading...</span>
                    </div>
                    
                    <form id="pinForm">
                        <!-- Create PIN Mode -->
                        <div id="createPinMode" style="display: none;">
                            <div class="form-group">
                                <label>PIN Baru *</label>
                                <input type="text" class="form-control" id="newPin" placeholder="Masukkan PIN (4-6 digit)" maxlength="6" pattern="[0-9]{4,6}">
                                <small class="form-text text-muted">PIN harus 4-6 digit angka</small>
                            </div>
                            <div class="form-group">
                                <label>Konfirmasi PIN *</label>
                                <input type="text" class="form-control" id="confirmPin" placeholder="Konfirmasi PIN" maxlength="6" pattern="[0-9]{4,6}">
                            </div>
                            <div class="form-group">
                                <label>Nomor WhatsApp (Opsional)</label>
                                <input type="text" class="form-control" id="whatsappNumber" placeholder="Akan menggunakan nomor telepon agent jika kosong">
                                <small class="form-text text-muted">Jika kosong, akan menggunakan nomor telepon agent</small>
                            </div>
                        </div>
                        
                        <!-- Reset PIN Mode -->
                        <div id="resetPinMode" style="display: none;">
                            <div class="alert alert-warning">
                                <i class="fas fa-exclamation-triangle"></i> PIN akan direset tanpa perlu PIN lama.
                            </div>
                            <div class="form-group">
                                <label>PIN Baru *</label>
                                <input type="text" class="form-control" id="resetNewPin" placeholder="Masukkan PIN baru (4-6 digit)" maxlength="6" pattern="[0-9]{4,6}">
                                <small class="form-text text-muted">PIN harus 4-6 digit angka</small>
                            </div>
                            <div class="form-group">
                                <label>Konfirmasi PIN *</label>
                                <input type="text" class="form-control" id="resetConfirmPin" placeholder="Konfirmasi PIN" maxlength="6" pattern="[0-9]{4,6}">
                            </div>
                        </div>
                        
                        <!-- Change PIN Mode -->
                        <div id="changePinMode" style="display: none;">
                            <div class="form-group">
                                <label>PIN Lama *</label>
                                <input type="text" class="form-control" id="oldPin" placeholder="Masukkan PIN lama" maxlength="6" pattern="[0-9]{4,6}">
                            </div>
                            <div class="form-group">
                                <label>PIN Baru *</label>
                                <input type="text" class="form-control" id="changeNewPin" placeholder="Masukkan PIN baru (4-6 digit)" maxlength="6" pattern="[0-9]{4,6}">
                                <small class="form-text text-muted">PIN harus 4-6 digit angka</small>
                            </div>
                            <div class="form-group">
                                <label>Konfirmasi PIN Baru *</label>
                                <input type="text" class="form-control" id="changeConfirmPin" placeholder="Konfirmasi PIN baru" maxlength="6" pattern="[0-9]{4,6}">
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" id="savePinBtn" onclick="savePin()">Simpan</button>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Scripts -->
    <script src="/static/vendor/jquery/jquery.min.js"></script>
    <script src="/static/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/static/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/static/js/sb-admin-2.min.js"></script>
    <script src="/static/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/static/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    
    <script>
    let agentTable;
    
    $(document).ready(function() {
        loadAgents();
        loadStatistics();
    });
    
    // Toast notification function
    function showToast(message, type = 'success', title = null) {
        const toastId = 'toast-' + new Date().getTime();
        const bgClass = type === 'success' ? 'bg-success' : 
                       type === 'error' ? 'bg-danger' : 
                       type === 'warning' ? 'bg-warning' : 'bg-info';
        
        const toastTitle = title || (type === 'success' ? 'Berhasil' : 
                                    type === 'error' ? 'Error' : 
                                    type === 'warning' ? 'Peringatan' : 'Info');
        
        const icon = type === 'success' ? 'fa-check-circle' : 
                    type === 'error' ? 'fa-times-circle' : 
                    type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle';
        
        const toastHtml = `
            <div id="${toastId}" class="toast ${bgClass} text-white" role="alert" aria-live="assertive" aria-atomic="true" data-delay="5000">
                <div class="toast-header ${bgClass} text-white">
                    <i class="fas ${icon} mr-2"></i>
                    <strong class="mr-auto">${toastTitle}</strong>
                    <button type="button" class="ml-2 mb-1 close text-white" data-dismiss="toast" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="toast-body">
                    ${message}
                </div>
            </div>`;
        
        $('.toast-container').append(toastHtml);
        $(`#${toastId}`).toast('show');
        
        // Remove toast from DOM after it's hidden
        $(`#${toastId}`).on('hidden.bs.toast', function () {
            $(this).remove();
        });
    }
    
    function loadAgents() {
        $.get('/api/agents/list', function(response) {
            if (response.success) {
                const agents = response.data;
                let html = '';
                
                agents.forEach(agent => {
                    const services = agent.services.map(s => {
                        let className = 'service-' + s;
                        let label = s;
                        if (s === 'topup') label = 'Topup';
                        else if (s === 'voucher') label = 'Voucher';
                        else if (s === 'pembayaran') label = 'Pembayaran';
                        return `<span class="service-badge ${className}">${label}</span>`;
                    }).join('');
                    
                    const statusClass = agent.active ? 'status-active' : 'status-inactive';
                    const statusText = agent.active ? 'Aktif' : 'Nonaktif';
                    
                    // PIN status will be loaded asynchronously
                    const pinStatusId = `pin-status-${agent.id}`;
                    
                    html += `
                        <tr>
                            <td>${agent.id}</td>
                            <td><strong>${agent.name}</strong></td>
                            <td>${agent.phone}</td>
                            <td>${agent.area}</td>
                            <td>${agent.address}</td>
                            <td>${services}</td>
                            <td>${agent.operational_hours}</td>
                            <td><span class="${statusClass}"><i class="fas fa-circle"></i> ${statusText}</span></td>
                            <td id="${pinStatusId}">
                                <span class="text-muted"><i class="fas fa-spinner fa-spin"></i> Loading...</span>
                            </td>
                            <td>
                                <button class="btn btn-sm btn-info" onclick="editAgent('${agent.id}')" title="Edit Agent">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-warning" onclick="managePin('${agent.id}')" title="Manage PIN">
                                    <i class="fas fa-key"></i>
                                </button>
                                <button class="btn btn-sm btn-danger" onclick="deleteAgent('${agent.id}')" title="Hapus Agent">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </td>
                        </tr>
                    `;
                });
                
                $('#agentTableBody').html(html);
                
                // Load PIN status for each agent
                agents.forEach(agent => {
                    loadPinStatus(agent.id);
                });
                
                // Initialize DataTable
                if (agentTable) {
                    agentTable.destroy();
                }
                
                agentTable = $('#agentTable').DataTable({
                    "language": {
                        "sProcessing": "Sedang memproses...",
                        "sLengthMenu": "Tampilkan _MENU_ entri",
                        "sZeroRecords": "Tidak ditemukan data yang sesuai",
                        "sInfo": "Menampilkan _START_ sampai _END_ dari _TOTAL_ entri",
                        "sInfoEmpty": "Menampilkan 0 sampai 0 dari 0 entri",
                        "sInfoFiltered": "(disaring dari _MAX_ entri keseluruhan)",
                        "sInfoPostFix": "",
                        "sSearch": "Cari:",
                        "sUrl": "",
                        "oPaginate": {
                            "sFirst": "Pertama",
                            "sPrevious": "Sebelumnya",
                            "sNext": "Selanjutnya",
                            "sLast": "Terakhir"
                        }
                    },
                    "pageLength": 25,
                    "order": [[0, "desc"]]
                });
            }
        });
    }
    
    function loadStatistics() {
        $.get('/api/agents/statistics')
            .done(function(response) {
                if (response.success) {
                    const stats = response.data;
                    $('#totalAgents').text(stats.total || 0);
                    $('#activeAgents').text(stats.active || 0);
                    $('#totalAreas').text(Object.keys(stats.byArea || {}).length);
                    
                    // Count total services
                    let totalServices = 0;
                    for (let service in stats.byService) {
                        totalServices += stats.byService[service];
                    }
                    $('#totalServices').text(totalServices);
                } else {
                    // Set default values on error
                    $('#totalAgents').text('0');
                    $('#activeAgents').text('0');
                    $('#totalAreas').text('0');
                    $('#totalServices').text('0');
                }
            })
            .fail(function(xhr, status, error) {
                // Set default values on error
                $('#totalAgents').text('0');
                $('#activeAgents').text('0');
                $('#totalAreas').text('0');
                $('#totalServices').text('0');
            });
    }
    
    function showAddAgentModal() {
        $('#agentModalTitle').text('Tambah Agent');
        $('#agentForm')[0].reset();
        $('#agentId').val('');
        $('#agentModal').modal('show');
    }
    
    function editAgent(agentId) {
        $.get(`/api/agents/detail/${agentId}`)
            .done(function(response) {
                if (response.success) {
                    const agent = response.data;
                    $('#agentModalTitle').text('Edit Agent');
                    $('#agentId').val(agent.id);
                    $('#agentName').val(agent.name);
                    $('#agentPhone').val(agent.phone);
                    $('#agentArea').val(agent.area);
                    $('#agentAddress').val(agent.address);
                    $('#agentHours').val(agent.operational_hours);
                    
                    // Set services
                    $('#serviceTopup').prop('checked', agent.services && agent.services.includes('topup'));
                    $('#serviceVoucher').prop('checked', agent.services && agent.services.includes('voucher'));
                    $('#servicePembayaran').prop('checked', agent.services && agent.services.includes('pembayaran'));
                    
                    // Set location if available
                    if (agent.location) {
                        $('#agentLat').val(agent.location.lat);
                        $('#agentLng').val(agent.location.lng);
                    } else {
                        $('#agentLat').val('');
                        $('#agentLng').val('');
                    }
                    
                    $('#agentModal').modal('show');
                } else {
                    showToast(response.message || 'Gagal memuat data agent', 'error', 'Error');
                }
            })
            .fail(function(xhr, status, error) {
                let errorMsg = 'Gagal memuat data agent';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMsg = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMsg = 'Agent tidak ditemukan';
                } else if (xhr.status === 401) {
                    errorMsg = 'Sesi Anda telah berakhir. Silakan login kembali.';
                }
                showToast(errorMsg, 'error', 'Error');
            });
    }
    
    // Validate phone number format
    function validatePhoneNumber(phone) {
        if (!phone || phone.trim() === '') {
            return { valid: false, message: 'Nomor telepon tidak boleh kosong' };
        }
        
        // Remove spaces, dashes, parentheses
        const cleaned = phone.replace(/[\s\-\(\)]/g, '');
        
        // Check if contains only digits and optional + at start
        if (!/^\+?[0-9]+$/.test(cleaned)) {
            return { valid: false, message: 'Nomor telepon hanya boleh berisi angka' };
        }
        
        // Check length (minimum 10 digits, maximum 15 digits for international)
        const digits = cleaned.replace(/^\+/, '');
        if (digits.length < 10 || digits.length > 15) {
            return { valid: false, message: 'Nomor telepon harus 10-15 digit' };
        }
        
        // Check Indonesian format (08xx, 628xx, +628xx)
        if (cleaned.startsWith('08') || cleaned.startsWith('628') || cleaned.startsWith('+628')) {
            // Indonesian format - validate length
            const idDigits = cleaned.replace(/^\+?628?/, '').replace(/^0/, '');
            if (idDigits.length < 9 || idDigits.length > 11) {
                return { valid: false, message: 'Format nomor Indonesia tidak valid (min 9, max 11 digit setelah 08/628)' };
            }
        }
        
        return { valid: true, message: 'OK' };
    }
    
    // Validate coordinates
    function validateCoordinates(lat, lng) {
        const latNum = parseFloat(lat);
        const lngNum = parseFloat(lng);
        
        if (isNaN(latNum) || isNaN(lngNum)) {
            return { valid: false, message: 'Koordinat harus berupa angka' };
        }
        
        if (latNum < -90 || latNum > 90) {
            return { valid: false, message: 'Latitude harus antara -90 sampai 90' };
        }
        
        if (lngNum < -180 || lngNum > 180) {
            return { valid: false, message: 'Longitude harus antara -180 sampai 180' };
        }
        
        return { valid: true, message: 'OK', lat: latNum, lng: lngNum };
    }
    
    function saveAgent() {
        const agentId = $('#agentId').val();
        const services = [];
        if ($('#serviceTopup').is(':checked')) services.push('topup');
        if ($('#serviceVoucher').is(':checked')) services.push('voucher');
        if ($('#servicePembayaran').is(':checked')) services.push('pembayaran');
        
        // Validate required fields
        const name = $('#agentName').val().trim();
        const phone = $('#agentPhone').val().trim();
        const area = $('#agentArea').val().trim();
        const address = $('#agentAddress').val().trim();
        
        if (!name || !phone || !area || !address) {
            showToast('Nama, nomor telepon, area, dan alamat wajib diisi!', 'error', 'Validasi Gagal');
            return;
        }
        
        // Validate phone number
        const phoneValidation = validatePhoneNumber(phone);
        if (!phoneValidation.valid) {
            showToast(phoneValidation.message, 'error', 'Validasi Nomor Telepon');
            $('#agentPhone').focus();
            return;
        }
        
        // Normalize phone number (remove spaces, dashes, etc)
        const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');
        
        const data = {
            name: name,
            phone: normalizedPhone,
            area: area,
            address: address,
            operational_hours: $('#agentHours').val() || '08:00 - 20:00',
            services: services
        };
        
        // Validate and add location if provided
        const lat = $('#agentLat').val().trim();
        const lng = $('#agentLng').val().trim();
        if (lat || lng) {
            // Both must be provided
            if (!lat || !lng) {
                showToast('Jika ingin menambahkan koordinat, latitude dan longitude harus diisi keduanya!', 'warning', 'Validasi Koordinat');
                return;
            }
            
            const coordValidation = validateCoordinates(lat, lng);
            if (!coordValidation.valid) {
                showToast(coordValidation.message, 'error', 'Validasi Koordinat');
                return;
            }
            
            data.location = {
                lat: coordValidation.lat,
                lng: coordValidation.lng
            };
        }
        
        const url = agentId ? `/api/agents/update/${agentId}` : '/api/agents/add';
        const method = agentId ? 'PUT' : 'POST';
        
        $.ajax({
            url: url,
            method: method,
            data: JSON.stringify(data),
            contentType: 'application/json',
            success: function(response) {
                if (response.success) {
                    showToast(
                        agentId ? 'Data agent berhasil diperbarui!' : 'Agent baru berhasil ditambahkan!',
                        'success',
                        agentId ? 'Update Berhasil' : 'Tambah Berhasil'
                    );
                    $('#agentModal').modal('hide');
                    loadAgents();
                    loadStatistics();
                } else {
                    showToast(response.message || 'Gagal menyimpan agent', 'error', 'Gagal Menyimpan');
                }
            },
            error: function(xhr, status, error) {
                let errorMsg = 'Terjadi kesalahan saat menyimpan agent';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMsg = xhr.responseJSON.message;
                } else if (xhr.status === 400) {
                    errorMsg = 'Data yang dimasukkan tidak valid. Periksa kembali form.';
                } else if (xhr.status === 401) {
                    errorMsg = 'Sesi Anda telah berakhir. Silakan login kembali.';
                } else if (xhr.status >= 500) {
                    errorMsg = 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
                }
                showToast(errorMsg, 'error', 'Error');
            }
        });
    }
    
    function deleteAgent(agentId) {
        if (!confirm('Apakah Anda yakin ingin menonaktifkan agent ini?')) {
            return;
        }
        
        $.ajax({
            url: `/api/agents/delete/${agentId}`,
            method: 'DELETE',
            success: function(response) {
                if (response.success) {
                    showToast('Agent berhasil dinonaktifkan!', 'success', 'Berhasil');
                    loadAgents();
                    loadStatistics();
                } else {
                    showToast(response.message || 'Gagal menonaktifkan agent', 'error', 'Gagal');
                }
            },
            error: function(xhr, status, error) {
                let errorMsg = 'Terjadi kesalahan saat menonaktifkan agent';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMsg = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMsg = 'Agent tidak ditemukan';
                } else if (xhr.status === 401) {
                    errorMsg = 'Sesi Anda telah berakhir. Silakan login kembali.';
                } else if (xhr.status >= 500) {
                    errorMsg = 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
                }
                showToast(errorMsg, 'error', 'Error');
            }
        });
    }
    
    // Load PIN status for an agent
    function loadPinStatus(agentId) {
        $.get(`/api/agents/${agentId}/pin/status`)
            .done(function(response) {
                const statusId = `#pin-status-${agentId}`;
                if (response.hasPin) {
                    $(statusId).html(`
                        <span class="badge badge-success">
                            <i class="fas fa-check-circle"></i> Terdaftar
                        </span>
                    `);
                } else {
                    $(statusId).html(`
                        <span class="badge badge-secondary">
                            <i class="fas fa-times-circle"></i> Belum Terdaftar
                        </span>
                    `);
                }
            })
            .fail(function() {
                const statusId = `#pin-status-${agentId}`;
                $(statusId).html(`
                    <span class="badge badge-danger">
                        <i class="fas fa-exclamation-triangle"></i> Error
                    </span>
                `);
            });
    }
    
    // Manage PIN modal
    function managePin(agentId) {
        // Get agent details first
        $.get(`/api/agents/detail/${agentId}`)
            .done(function(agentResponse) {
                if (!agentResponse.success) {
                    showToast('Agent tidak ditemukan', 'error', 'Error');
                    return;
                }
                
                const agent = agentResponse.data;
                $('#pinAgentId').val(agent.id);
                $('#pinAgentPhone').val(agent.phone);
                $('#pinAgentName').val(agent.name);
                
                // Load PIN status
                $.get(`/api/agents/${agentId}/pin/status`)
                    .done(function(pinResponse) {
                        if (pinResponse.hasPin) {
                            $('#pinStatusText').text(`Agent ${agent.name} sudah memiliki PIN.`);
                            $('#pinStatusInfo').removeClass('alert-info').addClass('alert-success');
                            $('#pinModalTitle').text(`Reset PIN - ${agent.name}`);
                            
                            // Show reset mode
                            $('#createPinMode').hide();
                            $('#changePinMode').hide();
                            $('#resetPinMode').show();
                            $('#savePinBtn').text('Reset PIN').removeClass('btn-primary').addClass('btn-warning');
                        } else {
                            $('#pinStatusText').text(`Agent ${agent.name} belum memiliki PIN.`);
                            $('#pinStatusInfo').removeClass('alert-success').addClass('alert-info');
                            $('#pinModalTitle').text(`Buat PIN - ${agent.name}`);
                            
                            // Show create mode
                            $('#resetPinMode').hide();
                            $('#changePinMode').hide();
                            $('#createPinMode').show();
                            $('#savePinBtn').text('Buat PIN').removeClass('btn-warning').addClass('btn-primary');
                        }
                        
                        // Clear all form fields
                        $('#newPin, #confirmPin, #whatsappNumber, #resetNewPin, #resetConfirmPin, #oldPin, #changeNewPin, #changeConfirmPin').val('');
                        
                        $('#pinModal').modal('show');
                    })
                    .fail(function() {
                        showToast('Gagal memuat status PIN', 'error', 'Error');
                    });
            })
            .fail(function() {
                showToast('Gagal memuat data agent', 'error', 'Error');
            });
    }
    
    // Validate PIN format
    function validatePinFormat(pin) {
        if (!pin || pin.trim() === '') {
            return { valid: false, message: 'PIN tidak boleh kosong' };
        }
        if (!/^[0-9]+$/.test(pin)) {
            return { valid: false, message: 'PIN hanya boleh berisi angka' };
        }
        if (pin.length < 4 || pin.length > 6) {
            return { valid: false, message: 'PIN harus 4-6 digit' };
        }
        return { valid: true };
    }
    
    // Save PIN (Create, Reset, or Change)
    function savePin() {
        const agentId = $('#pinAgentId').val();
        const agentPhone = $('#pinAgentPhone').val();
        const agentName = $('#pinAgentName').val();
        
        if (!agentId) {
            showToast('Agent ID tidak ditemukan', 'error', 'Error');
            return;
        }
        
        // Determine which mode is active
        let mode = '';
        let pin = '';
        let confirmPin = '';
        let oldPin = '';
        let whatsappNumber = '';
        
        if ($('#createPinMode').is(':visible')) {
            mode = 'create';
            pin = $('#newPin').val().trim();
            confirmPin = $('#confirmPin').val().trim();
            whatsappNumber = $('#whatsappNumber').val().trim() || agentPhone;
        } else if ($('#resetPinMode').is(':visible')) {
            mode = 'reset';
            pin = $('#resetNewPin').val().trim();
            confirmPin = $('#resetConfirmPin').val().trim();
        } else if ($('#changePinMode').is(':visible')) {
            mode = 'change';
            oldPin = $('#oldPin').val().trim();
            pin = $('#changeNewPin').val().trim();
            confirmPin = $('#changeConfirmPin').val().trim();
            whatsappNumber = agentPhone;
        } else {
            showToast('Mode tidak valid', 'error', 'Error');
            return;
        }
        
        // Validate PIN format
        const pinValidation = validatePinFormat(pin);
        if (!pinValidation.valid) {
            showToast(pinValidation.message, 'error', 'Validasi Gagal');
            return;
        }
        
        // Check PIN confirmation
        if (pin !== confirmPin) {
            showToast('PIN dan konfirmasi PIN tidak cocok', 'error', 'Validasi Gagal');
            return;
        }
        
        // Disable button during request
        const $saveBtn = $('#savePinBtn');
        const originalText = $saveBtn.text();
        $saveBtn.prop('disabled', true).text('Memproses...');
        
        // Make API call based on mode
        let apiUrl = '';
        let apiMethod = '';
        let requestData = {};
        
        if (mode === 'create') {
            apiUrl = `/api/agents/${agentId}/pin/create`;
            apiMethod = 'POST';
            requestData = { pin: pin, whatsappNumber: whatsappNumber };
        } else if (mode === 'reset') {
            apiUrl = `/api/agents/${agentId}/pin/reset`;
            apiMethod = 'PUT';
            requestData = { pin: pin };
        } else if (mode === 'change') {
            apiUrl = `/api/agents/${agentId}/pin/change`;
            apiMethod = 'PUT';
            requestData = { oldPin: oldPin, newPin: pin, whatsappNumber: whatsappNumber };
        }
        
        $.ajax({
            url: apiUrl,
            method: apiMethod,
            contentType: 'application/json',
            data: JSON.stringify(requestData),
            success: function(response) {
                if (response.success) {
                    showToast(response.message || 'PIN berhasil disimpan', 'success', 'Berhasil');
                    $('#pinModal').modal('hide');
                    
                    // Reload PIN status in table
                    loadPinStatus(agentId);
                } else {
                    showToast(response.message || 'Gagal menyimpan PIN', 'error', 'Gagal');
                }
            },
            error: function(xhr, status, error) {
                let errorMsg = 'Terjadi kesalahan saat menyimpan PIN';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errorMsg = xhr.responseJSON.message;
                } else if (xhr.status === 404) {
                    errorMsg = 'Agent tidak ditemukan';
                } else if (xhr.status === 401) {
                    errorMsg = 'Sesi Anda telah berakhir. Silakan login kembali.';
                } else if (xhr.status >= 500) {
                    errorMsg = 'Terjadi kesalahan pada server. Silakan coba lagi nanti.';
                }
                showToast(errorMsg, 'error', 'Error');
            },
            complete: function() {
                $saveBtn.prop('disabled', false).text(originalText);
            }
        });
    }
    </script>
</body>
</html>
