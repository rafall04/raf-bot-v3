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
    <link href="/css/admin-theme.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    
    <link href="/css/agent-management.css" rel="stylesheet">
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
    
    <script src="/js/agent-management.js"></script>
</body>
</html>
