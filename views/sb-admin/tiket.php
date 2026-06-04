<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="RAF BOT Ticket Management">
    <meta name="author" content="RAF BOT">
    <title>RAF BOT - Ticket Management</title>
    
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/admin-theme.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link href="/css/dashboard-modern.css" rel="stylesheet">

    <style>
        .ticket-details-admin { font-size: 0.8rem; white-space: pre-wrap; max-width: 250px; overflow-wrap: break-word; }
        .report-text-admin { font-size: 0.85rem; white-space: pre-wrap; max-width: 300px; overflow-wrap: break-word; }
        th, td { font-size: 0.85rem; }
        .action-buttons-admin .btn { margin-bottom: 5px; margin-right: 5px; }
        .modal-body { max-height: calc(100vh - 210px); overflow-y: auto; }
        
        /* Status badges per TICKET_STATUS_STANDARD.md */
        .badge-status-baru { 
            background: #6f42c1 !important; 
            color: #fff !important; 
            font-weight: 600;
            padding: 0.4em 0.8em;
        }
        .badge-status-process { 
            background: #17a2b8 !important; 
            color: #fff !important; 
            font-weight: 600;
            padding: 0.4em 0.8em;
        }
        .badge-status-otw { 
            background: #ffc107 !important; 
            color: #000 !important; 
            font-weight: 600;
            padding: 0.4em 0.8em;
        }
        .badge-status-arrived { 
            background: #fd7e14 !important; 
            color: #fff !important; 
            font-weight: 600;
            padding: 0.4em 0.8em;
        }
        .badge-status-working { 
            background: #20c997 !important; 
            color: #fff !important; 
            font-weight: 600;
            padding: 0.4em 0.8em;
        }
        .badge-status-resolved { 
            background: #28a745 !important; 
            color: #fff !important; 
            font-weight: 600;
            padding: 0.4em 0.8em;
        }
        .badge-status-cancelled { 
            background: #6c757d !important; 
            color: #fff !important; 
            font-weight: 600;
            padding: 0.4em 0.8em;
        }
        
        /* Photo Gallery Styles */
        .photo-gallery {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-top: 15px;
        }
        .photo-thumbnail {
            width: 150px;
            height: 150px;
            border: 2px solid #ddd;
            border-radius: 5px;
            overflow: hidden;
            cursor: pointer;
            position: relative;
        }
        .photo-thumbnail img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.3s;
        }
        .photo-thumbnail:hover img {
            transform: scale(1.1);
        }
        .photo-count-badge {
            position: absolute;
            top: 5px;
            right: 5px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
        }
        .photo-label-badge {
            position: absolute;
            bottom: 5px;
            left: 5px;
            right: 5px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 3px 6px;
            border-radius: 3px;
            font-size: 0.7rem;
            text-align: center;
            font-weight: 500;
        }
        
        /* Photo Category Header */
        .photo-category-header {
            width: 100%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 15px;
            margin: 15px 0 10px 0;
            border-radius: 8px;
            font-weight: 600;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        .photo-category-header:first-child {
            margin-top: 0;
        }
        .photo-category-header i {
            font-size: 1rem;
        }
        
        /* Workflow Progress */
        .workflow-progress {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            margin: 10px 0;
        }
        .workflow-step {
            flex: 1;
            text-align: center;
            position: relative;
        }
        .workflow-step:not(:last-child)::after {
            content: '';
            position: absolute;
            top: 20px;
            left: 60%;
            width: 80%;
            height: 2px;
            background: #ddd;
        }
        .workflow-step.completed:not(:last-child)::after {
            background: #28a745;
        }
        .step-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #ddd;
            color: #666;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 5px;
        }
        .workflow-step.completed .step-icon,
        .workflow-step.active .step-icon {
            background: #28a745;
            color: white;
        }
        .step-label {
            font-size: 0.75rem;
            color: #666;
        }
        .workflow-step.completed .step-label,
        .workflow-step.active .step-label {
            color: #333;
            font-weight: 600;
        }
        
        /* Detail Section */
        .detail-section {
            margin-bottom: 20px;
            padding: 15px;
            background: #f8f9fc;
            border-radius: 5px;
        }
        .detail-section h6 {
            color: #4e73df;
            margin-bottom: 10px;
            font-weight: 600;
        }
        .detail-item {
            display: flex;
            margin-bottom: 8px;
        }
        .detail-label {
            min-width: 120px;
            font-weight: 500;
            color: #666;
        }
        .detail-value {
            color: #333;
        }
        
        /* Fix z-index for photo modal to appear above detail modal */
        #photoModal {
            z-index: 1060 !important;
        }
        #photoModal .modal-backdrop {
            z-index: 1055 !important;
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
    <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow-sm">
                    <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3"><i class="fa fa-bars"></i></button>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                                <span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="/logout" data-toggle="modal" data-target="#logoutModal"><i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>Logout</a>
                            </div>
                        </li>
                    </ul>
                </nav>
                <div class="container-fluid">
                    <!-- Page Header -->
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <h1>Ticket Management</h1>
                                <p>Kelola tiket laporan dan keluhan pelanggan</p>
                            </div>
                            <div>
                                <button class="btn btn-warning-custom mr-2" data-toggle="modal" data-target="#cleanupOrphanedPhotosModal">
                                    <i class="fas fa-trash-alt"></i> Hapus Foto Tidak Terpakai
                                </button>
                                <button class="btn btn-primary-custom" data-toggle="modal" data-target="#createTicketModal">
                                    <i class="fas fa-ticket-alt"></i> Buat Tiket Baru
                                </button>
                            </div>
                        </div>
                    </div>
                    <div id="globalAdminMessage" class="mb-3"></div>

                    <!-- Filter Section -->
                    <h4 class="dashboard-section-title">Filter & Pencarian</h4>
                    <div class="filter-section">
                        <form id="filterForm" class="row">
                            <div class="form-group col-md-2">
                                <label for="filterTicketId">ID Tiket</label>
                                <input type="text" class="form-control form-control-modern" id="filterTicketId" placeholder="Cari ID Tiket">
                            </div>
                            <div class="form-group col-md-2">
                                <label for="filterStatus">Status</label>
                                <select id="filterStatus" class="form-control form-control-modern">
                                    <option value="all" selected>Semua Status</option>
                                    <option value="baru">Baru</option>
                                    <option value="process">Process (OTP Generated)</option>
                                    <option value="otw">OTW (On The Way)</option>
                                    <option value="arrived">Arrived (Tiba di Lokasi)</option>
                                    <option value="working">Working (Sedang Dikerjakan)</option>
                            <option value="completed">Completed (Selesai)</option>
                                    <option value="dibatalkan pelanggan">Dibatalkan Pelanggan</option>
                                    <option value="dibatalkan admin">Dibatalkan Admin</option>
                                </select>
                            </div>
                            <div class="form-group col-md-2">
                                <label for="filterPppoe">Nama PPPoE</label>
                                <input type="text" class="form-control form-control-modern" id="filterPppoe" placeholder="Cari PPPoE">
                            </div>
                            <div class="form-group col-md-2">
                                <label for="filterStartDate">Tgl Lapor Dari</label>
                                <input type="date" class="form-control form-control-modern" id="filterStartDate">
                            </div>
                            <div class="form-group col-md-2">
                                <label for="filterEndDate">Tgl Lapor Sampai</label>
                                <input type="date" class="form-control form-control-modern" id="filterEndDate">
                            </div>
                            <div class="form-group col-md-2 d-flex align-items-end">
                                <button type="submit" class="btn btn-primary-custom btn-sm-custom btn-block">
                                    <i class="fas fa-filter"></i> Filter
                                </button>
                            </div>
                        </form>
                    </div>
                    <!-- Data Table -->
                    <h4 class="dashboard-section-title">Daftar Tiket</h4>
                    <div class="dashboard-card" style="height: auto;">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div>
                                    <span class="font-weight-600" style="color: var(--dark); font-size: 1.1rem;">Data Tiket</span>
                                </div>
                                <button class="btn btn-info-custom btn-sm-custom" onclick="loadTickets(true)">
                                    <i class="fas fa-sync-alt"></i> Reset & Refresh
                                </button>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="allTicketsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID Tiket</th>
                                            <th>Pelanggan (WA)</th>
                                            <th>Detail Pelanggan (Sistem)</th>
                                            <th>Isi Laporan</th>
                                            <th>Foto</th>
                                            <th>Status</th>
                                            <th>Tgl Dibuat</th>
                                            <th>Diproses Oleh</th>
                                            <th>Diselesaikan Oleh</th>
                                            <th>Dibatalkan Oleh</th>
                                            <th style="min-width: 120px;">Aksi Admin</th>
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
                <div class="container my-auto"><div class="copyright text-center my-auto"><span>Copyright &copy; Raf BOT 2025</span></div></div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="logoutModalLabel"><div class="modal-dialog modal-dialog-centered" role="document"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Ready to Leave?</h5><button class="close" type="button" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div><div class="modal-body">Select "Logout" below if you are ready to end your current session.</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button><a class="btn btn-primary" href="/logout">Logout</a></div></div></div></div>

    <!-- Cleanup Orphaned Photos Modal -->
    <div class="modal fade" id="cleanupOrphanedPhotosModal" tabindex="-1" role="dialog" aria-labelledby="cleanupOrphanedPhotosModalLabel">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header bg-warning text-white">
                    <h5 class="modal-title" id="cleanupOrphanedPhotosModalLabel">
                        <i class="fas fa-trash-alt"></i> Hapus Foto Tidak Terpakai
                    </h5>
                    <button class="close text-white" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <div class="alert alert-warning">
                        <i class="fas fa-exclamation-triangle"></i> <strong>Peringatan!</strong>
                        <p class="mb-0 mt-2">Tindakan ini akan menghapus semua foto yang tidak memiliki tiket terkait di database.</p>
                        <p class="mb-0">Foto yang akan dihapus biasanya berasal dari ujicoba fitur atau tiket yang sudah terhapus.</p>
                    </div>
                    <p>Silakan masukkan password admin untuk melanjutkan:</p>
                    <form id="cleanupOrphanedPhotosForm">
                        <div class="form-group">
                            <label for="cleanupAdminPassword">Password Admin</label>
                            <input type="password" class="form-control" id="cleanupAdminPassword" required autocomplete="current-password">
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">
                        <i class="fas fa-times"></i> Batal
                    </button>
                    <button class="btn btn-warning" type="button" id="confirmCleanupOrphanedPhotos">
                        <i class="fas fa-trash-alt"></i> Hapus Foto Tidak Terpakai
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Photo Preview Modal -->
    <div class="modal fade" id="photoModal" tabindex="-1" role="dialog" aria-labelledby="photoModalLabel">
        <div class="modal-dialog modal-xl modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="photoModalTitle">Foto Dokumentasi</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body text-center" style="background: #000;">
                    <img id="photoModalImage" src="" alt="Photo" style="max-width: 100%; max-height: 80vh; object-fit: contain;">
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" onclick="downloadPhoto()">
                        <i class="fas fa-download"></i> Download
                    </button>
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Ticket Detail Modal -->
    <div class="modal fade" id="ticketDetailModal" tabindex="-1" role="dialog" aria-labelledby="ticketDetailModalLabel">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="ticketDetailModalLabel">Detail Tiket</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <!-- Workflow Progress -->
                    <div class="workflow-progress">
                        <div class="workflow-step" id="step-baru">
                            <div class="step-icon"><i class="fas fa-plus"></i></div>
                            <div class="step-label">Baru</div>
                        </div>
                        <div class="workflow-step" id="step-process">
                            <div class="step-icon"><i class="fas fa-cog"></i></div>
                            <div class="step-label">Process</div>
                        </div>
                        <div class="workflow-step" id="step-otw">
                            <div class="step-icon"><i class="fas fa-car"></i></div>
                            <div class="step-label">OTW</div>
                        </div>
                        <div class="workflow-step" id="step-arrived">
                            <div class="step-icon"><i class="fas fa-map-marker-alt"></i></div>
                            <div class="step-label">Arrived</div>
                        </div>
                        <div class="workflow-step" id="step-working">
                            <div class="step-icon"><i class="fas fa-wrench"></i></div>
                            <div class="step-label">Working</div>
                        </div>
                        <div class="workflow-step" id="step-completed">
                            <div class="step-icon"><i class="fas fa-check"></i></div>
                            <div class="step-label">Completed</div>
                        </div>
                    </div>
                    
                    <!-- Ticket Info -->
                    <div class="detail-section">
                        <h6>Informasi Tiket</h6>
                        <div class="detail-item">
                            <span class="detail-label">ID Tiket:</span>
                            <span class="detail-value" id="detail-ticketId">-</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Status:</span>
                            <span class="detail-value" id="detail-status">-</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Pelanggan:</span>
                            <span class="detail-value" id="detail-customer">-</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Laporan:</span>
                            <span class="detail-value" id="detail-report">-</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Dibuat:</span>
                            <span class="detail-value" id="detail-created">-</span>
                        </div>
                    </div>
                    
                    <!-- Teknisi Info -->
                    <div class="detail-section">
                        <h6>Informasi Teknisi</h6>
                        <div class="detail-item">
                            <span class="detail-label">Teknisi:</span>
                            <span class="detail-value" id="detail-teknisi">-</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">OTP:</span>
                            <span class="detail-value" id="detail-otp">-</span>
                        </div>
                    </div>
                    
                    <!-- Photos Section -->
                    <div class="detail-section">
                        <h6>Dokumentasi Foto</h6>
                        <div class="photo-gallery" id="detail-photos">
                            <p class="text-muted">Memuat foto...</p>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>
    
    <div class="modal fade" id="cancelTicketModal" tabindex="-1" role="dialog" aria-labelledby="cancelTicketModalLabel">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header"><h5 class="modal-title" id="cancelTicketModalLabel">Batalkan Tiket Laporan</h5><button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>
                <div class="modal-body">
                    <p>Anda akan membatalkan tiket <strong id="cancelTicketIdDisplay"></strong>.</p>
                    <div class="form-group"><label for="cancellationReasonInput">Alasan Pembatalan (Wajib Diisi):</label><textarea class="form-control" id="cancellationReasonInput" rows="3" placeholder="Masukkan alasan mengapa tiket ini dibatalkan..."></textarea></div>
                </div>
                <div class="modal-footer"><button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button><button type="button" class="btn btn-danger" id="confirmCancelTicketBtn">Ya, Batalkan Tiket</button></div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="createTicketModal" tabindex="-1" role="dialog" aria-labelledby="createTicketModalLabel" aria-modal="true">
        <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
            <form id="createTicketForm">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="createTicketModalLabel">Buat Tiket Laporan Baru untuk Pelanggan</h5>
                        <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                            <span aria-hidden="true">&times;</span>
                        </button>
                    </div>
                    <div class="modal-body">
                        <div class="form-group">
                            <label for="customerSelect">Pilih Pelanggan:</label>
                            <select class="form-control" id="customerSelect" name="customerUserId" style="width: 100%;" required>
                                <option value="">Memuat pelanggan...</option>
                            </select>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label for="prioritySelect">Prioritas:</label>
                                <select class="form-control" id="prioritySelect" name="priority" required>
                                    <option value="HIGH">🔴 URGENT (2-4 jam)</option>
                                    <option value="MEDIUM" selected>🟡 NORMAL (6-12 jam)</option>
                                    <option value="LOW">🟢 LOW (1-2 hari)</option>
                                </select>
                            </div>
                            <div class="form-group col-md-6">
                                <label for="issueTypeSelect">Tipe Masalah:</label>
                                <select class="form-control" id="issueTypeSelect" name="issueType" required>
                                    <option value="MATI">💀 Internet Mati Total</option>
                                    <option value="LEMOT">🐌 Internet Lemot</option>
                                    <option value="PUTUS_NYAMBUNG">🔄 Putus-Nyambung</option>
                                    <option value="WIFI">📶 Masalah WiFi</option>
                                    <option value="HARDWARE">🔧 Masalah Hardware</option>
                                    <option value="GENERAL" selected>📋 Lainnya/Umum</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="laporanTextInput">Deskripsi Laporan Kendala:</label>
                            <textarea class="form-control" id="laporanTextInput" name="laporanText" rows="4" placeholder="Jelaskan kendala yang dialami pelanggan..." required></textarea>
                        </div>
                        
                        <div class="alert alert-info" role="alert">
                            <strong>ℹ️ Info:</strong> Tiket akan otomatis dikirim ke semua teknisi via WhatsApp
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                        <button type="submit" class="btn btn-success" id="submitNewTicketBtn">Buat Tiket</button>
                    </div>
                </div>
            </form>
        </div>
    </div>


    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script> 


    <script>
        let currentUser = null;
        let ticketsCache = {}; // Store tickets for safe access
        
        fetch('/api/me', { credentials: 'include' }).then(response => response.json()).then(data => {
            if (data.status === 200 && data.data) {
                document.getElementById('username-placeholder').textContent = data.data.username;
                currentUser = data.data;
            }
        });

        function displayGlobalAdminMessage(message, type = 'info') {
             const globalMessageDiv = document.getElementById('globalAdminMessage');
            globalMessageDiv.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>
            </div>`;
            setTimeout(() => { if (globalMessageDiv.querySelector('.alert')) $(globalMessageDiv.querySelector('.alert')).alert('close'); }, 7000);
        }
        function formatTicketDetailsAdmin(d) { return d ? `Nama: ${d.name||'N/A'}\nAlamat: ${d.address||'N/A'}\nPaket: ${d.subscription||'N/A'}\nPPPoE: ${d.pppoe_username||'N/A'}` : 'N/A';}
        function normalizeTicketStatusAdmin(status) {
            const normalizedStatus = (status || '').toLowerCase().trim();

            if (normalizedStatus === 'diproses teknisi') return 'process';
            if (normalizedStatus === 'selesai' || normalizedStatus === 'resolved') return 'completed';
            if (normalizedStatus === 'dibatalkan pelanggan' || normalizedStatus === 'dibatalkan admin' || normalizedStatus === 'dibatalkan' || normalizedStatus.includes('dibatalkan')) {
                return 'cancelled';
            }

            return normalizedStatus;
        }

        function getTicketTechnicianPhotoCount(ticket) {
            if (typeof ticket.teknisiPhotoCount === 'number') return ticket.teknisiPhotoCount;
            if (Array.isArray(ticket.teknisiPhotos) && ticket.teknisiPhotos.length > 0) return ticket.teknisiPhotos.length;
            if (Array.isArray(ticket.completionPhotos) && ticket.completionPhotos.length > 0) return ticket.completionPhotos.length;
            if (Array.isArray(ticket.photos) && ticket.photos.length > 0) return ticket.photos.length;
            return 0;
        }

        function getCompletedByDisplay(ticket) {
            let completedByText = ticket.teknisiName || ticket.completedByName || ticket.completedBy || ticket.resolvedByTeknisiName || '-';
            const completedAt = ticket.completedAt || ticket.resolvedAt;

            if (completedAt && completedByText !== '-') {
                completedByText += ` <small class="text-muted">(${new Date(completedAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short'})})</small>`;
            }

            return completedByText;
        }

        function getStatusBadgeAdmin(s) { 
            const status = normalizeTicketStatusAdmin(s);
            
            // Per TICKET_STATUS_STANDARD.md
            if (status === 'baru') return '<span class="badge badge-status-baru">Baru</span>';
            
            if (status === 'process' || status === 'diproses teknisi') {
                return '<span class="badge badge-status-process">Process</span>';
            }
            
            if (status === 'otw') return '<span class="badge badge-status-otw">OTW</span>';
            
            if (status === 'arrived') return '<span class="badge badge-status-arrived">Arrived</span>';
            
            if (status === 'working') return '<span class="badge badge-status-working">Working</span>';
            
            if (status === 'completed') {
                return '<span class="badge badge-status-resolved">Selesai</span>';
            }
            
            if (status === 'cancelled') {
                return '<span class="badge badge-status-cancelled">Dibatalkan</span>';
            }
            
            // Default for unknown status
            return `<span class="badge badge-secondary">${s || 'N/A'}</span>`;
        }
        
        function showTicketDetailById(ticketId) {
            const ticket = ticketsCache[ticketId];
            if (!ticket) {
                console.error('Ticket not found in cache:', ticketId);
                return;
            }
            showTicketDetail(ticket);
        }
        
        function showTicketDetail(ticket) {
            // Open detail modal with full ticket information
            const detailModal = $('#ticketDetailModal');
            if (!detailModal.length) {
                console.error('Detail modal not found');
                return;
            }
            
            // Populate modal with ticket data
            $('#detail-ticketId').text(ticket.ticketId || '-');
            const authoritativeStatus = ticket.normalizedStatus || ticket.status;
            $('#detail-status').html(getStatusBadgeAdmin(authoritativeStatus));
            
            // Smart customer name resolution - check ALL possible fields
            const customerName = ticket.pelangganName || 
                               ticket.pelangganPushName || 
                               (ticket.pelangganDataSystem ? ticket.pelangganDataSystem.name : null) ||
                               'Customer';
            $('#detail-customer').text(customerName);
            $('#detail-report').text(ticket.laporanText || '-');
            $('#detail-otp').text(ticket.otp || '-');
            $('#detail-teknisi').text(ticket.teknisiName || '-');
            $('#detail-created').text(ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('id-ID') : '-');
            
            // Show photos if available
            const photoContainer = $('#detail-photos');
            photoContainer.empty();
            
            // Collect ALL photos from various sources
            let allPhotos = [];
            
            // 1. Collect photos from customerPhotos field (Customer uploads during report)
            if (ticket.customerPhotos && ticket.customerPhotos.length > 0) {
                ticket.customerPhotos.forEach(photo => {
                    // Handle both object format with path field or just filename
                    if (typeof photo === 'object') {
                        // photo.path contains FULL system path, need to extract web path
                        let webPath = photo.path;
                        
                        // If path contains full system path, extract uploads/... part
                        if (webPath && webPath.includes('uploads')) {
                            const uploadsIndex = webPath.indexOf('uploads');
                            webPath = '/' + webPath.substring(uploadsIndex).replace(/\\/g, '/');
                        } else {
                            // Fallback: construct path from filename
                            webPath = `/uploads/reports/${photo.fileName}`;
                        }
                        
                        const customerPhoto = {
                            type: 'customer',
                            path: webPath,
                            filename: photo.fileName || photo.filename,
                            label: 'Foto Pelanggan'
                        };
                        allPhotos.push(customerPhoto);
                    } else {
                        // If it's a string, check if it's full path or web path
                        let webPath = photo;
                        if (webPath.includes('uploads')) {
                            const uploadsIndex = webPath.indexOf('uploads');
                            webPath = '/' + webPath.substring(uploadsIndex).replace(/\\/g, '/');
                        }
                        
                        const customerPhoto = {
                            type: 'customer',
                            path: webPath,
                            filename: webPath.split('/').pop(),
                            label: 'Foto Pelanggan'
                        };
                        allPhotos.push(customerPhoto);
                    }
                });
            }
            
            // 2. Collect photos from teknisiPhotos field (WhatsApp uploads + Web create ticket uploads)
            // IMPORTANT: Skip photos that are already in photos field to avoid duplicates
            if (ticket.teknisiPhotos && ticket.teknisiPhotos.length > 0) {
                // Get list of filenames already in photos field (to avoid duplicates)
                const photosFilenames = new Set();
                if (ticket.photos && Array.isArray(ticket.photos)) {
                    ticket.photos.forEach(p => {
                        if (typeof p === 'object' && p.fileName) {
                            photosFilenames.add(p.fileName);
                        } else if (typeof p === 'object' && p.filename) {
                            photosFilenames.add(p.filename);
                        } else if (typeof p === 'string') {
                            photosFilenames.add(p);
                        }
                    });
                }
                
                // Get year and month from ticket creation date for structured path
                const ticketDate = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
                const year = ticketDate.getFullYear();
                const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
                
                ticket.teknisiPhotos.forEach(photo => {
                    // Handle both object format (from create ticket) and string format (from WhatsApp)
                    let photoFileName = null;
                    let photoPath = null;
                    let photoCategory = null;
                    let photoCategoryLabel = null;
                    
                    if (typeof photo === 'object' && photo.fileName) {
                        // Object format from create ticket upload
                        photoFileName = photo.fileName;
                        photoPath = photo.path;
                        photoCategory = photo.category;
                        photoCategoryLabel = photo.categoryLabel;
                        
                        // Skip if this photo is already in photos field (to avoid duplicates)
                        if (photosFilenames.has(photoFileName)) {
                            return; // Skip duplicate
                        }
                    } else if (typeof photo === 'string') {
                        // String format from WhatsApp upload
                        photoFileName = photo;
                        
                        // Skip if this photo is already in photos field (to avoid duplicates)
                        if (photosFilenames.has(photoFileName)) {
                            return; // Skip duplicate
                        }
                        
                        // Construct path for string format
                        photoPath = `/uploads/reports/${year}/${month}/${ticket.ticketId}/${photoFileName}`;
                    } else {
                        // Unknown format, skip
                        return;
                    }
                    
                    // If path not provided, construct it
                    if (!photoPath) {
                        photoPath = `/uploads/reports/${year}/${month}/${ticket.ticketId}/${photoFileName}`;
                    }
                    
                    allPhotos.push({
                        type: 'teknisi',
                        path: photoPath,
                        filename: photoFileName,
                        label: photoCategoryLabel || 'Foto Teknisi',
                        category: photoCategory
                    });
                });
            }
            
            // 3. Collect photos from photos field (Web Dashboard uploads) - WITH CATEGORY SUPPORT
            if (ticket.photos && ticket.photos.length > 0) {
                // Get year and month from ticket creation date for structured path (if path not already structured)
                const ticketDate = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
                const year = ticketDate.getFullYear();
                const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
                
                ticket.photos.forEach((photo, index) => {
                    // Handle both object format and string format
                    if (typeof photo === 'object') {
                        let photoPath = photo.path;
                        
                        // If path doesn't have structure (old format), construct new path
                        if (!photoPath || (!photoPath.includes(`/${year}/${month}/${ticket.ticketId}/`) && !photoPath.includes('/tickets/'))) {
                            // Construct new structured path
                            photoPath = `/uploads/tickets/${year}/${month}/${ticket.ticketId}/${photo.filename}`;
                        }
                        
                        // Check if photo has category (NEW guided upload)
                        if (photo.category && photo.categoryLabel) {
                            allPhotos.push({
                                type: 'web',
                                path: photoPath,
                                filename: photo.filename,
                                label: photo.categoryLabel, // Use category label
                                category: photo.category,
                                order: index + 1
                            });
                        } else {
                            // Legacy web upload without category
                            allPhotos.push({
                                type: 'web',
                                path: photoPath,
                                filename: photo.filename,
                                label: 'Foto Teknisi (Web)'
                            });
                        }
                    } else {
                        // If it's a string, treat as filename (legacy) - construct new structured path
                        const photoPath = `/uploads/tickets/${year}/${month}/${ticket.ticketId}/${photo}`;
                        allPhotos.push({
                            type: 'web',
                            path: photoPath,
                            filename: photo,
                            label: 'Foto Teknisi (Web)'
                        });
                    }
                });
            }
            
            // 4. Also check completionPhotos field (with category support)
            if (ticket.completionPhotos && ticket.completionPhotos.length > 0) {
                // Get year and month from ticket creation date for structured path
                const ticketDate = ticket.createdAt ? new Date(ticket.createdAt) : new Date();
                const year = ticketDate.getFullYear();
                const month = String(ticketDate.getMonth() + 1).padStart(2, '0');
                
                ticket.completionPhotos.forEach(photo => {
                    // Get filename
                    const photoFilename = typeof photo === 'object' ? (photo.filename || photo) : photo;
                    
                    // Construct structured path: uploads/teknisi/YEAR/MONTH/TICKET_ID/
                    const structuredPath = `/uploads/teknisi/${year}/${month}/${ticket.ticketId}/${photoFilename}`;
                    const oldPath = `/uploads/teknisi/${photoFilename}`;
                    
                    // Check if photo has category metadata (new format)
                    if (typeof photo === 'object' && photo.category) {
                        // NEW CATEGORIZED FORMAT
                        allPhotos.push({
                            type: 'completion',
                            path: structuredPath,
                            oldPath: oldPath, // For backward compatibility
                            filename: photoFilename,
                            label: photo.categoryLabel || 'Foto Selesai',
                            category: photo.category,
                            order: photo.order || 999
                        });
                    } else if (typeof photo === 'object') {
                        // Object without category (legacy object format)
                        allPhotos.push({
                            type: 'completion',
                            path: structuredPath,
                            oldPath: oldPath, // For backward compatibility
                            filename: photoFilename,
                            label: 'Foto Selesai'
                        });
                    } else {
                        // String format (legacy)
                        allPhotos.push({
                            type: 'completion',
                            path: structuredPath,
                            oldPath: oldPath, // For backward compatibility
                            filename: photoFilename,
                            label: 'Foto Selesai'
                        });
                    }
                });
            }
            
            // Sort and organize photos by category if available
            const categorizedPhotos = allPhotos.filter(p => p.category);
            const uncategorizedPhotos = allPhotos.filter(p => !p.category);
            
            // Define category order for sorting
            const categoryOrder = { 'problem': 1, 'speedtest': 2, 'result': 3, 'extra': 4 };
            
            if (categorizedPhotos.length > 0) {
                // Sort by category order
                categorizedPhotos.sort((a, b) => {
                    const orderA = categoryOrder[a.category] || 999;
                    const orderB = categoryOrder[b.category] || 999;
                    if (orderA !== orderB) return orderA - orderB;
                    return (a.order || 0) - (b.order || 0);
                });
            }
            
            // Combine: categorized first, then uncategorized
            const sortedPhotos = [...categorizedPhotos, ...uncategorizedPhotos];
            
            if (sortedPhotos.length > 0) {
                // Group photos by type and category for better display
                const customerPhotos = sortedPhotos.filter(p => p.type === 'customer');
                const teknisiPhotos = sortedPhotos.filter(p => p.type !== 'customer');
                
                // For teknisi photos, group by category
                const photosByCategory = {};
                teknisiPhotos.forEach(photo => {
                    const cat = photo.category || 'other';
                    if (!photosByCategory[cat]) photosByCategory[cat] = [];
                    photosByCategory[cat].push(photo);
                });
                
                // Display photos with clear grouping
                let globalIndex = 0;
                
                // 1. FIRST: Display Customer Photos (if any)
                if (customerPhotos.length > 0) {
                    photoContainer.append(`
                        <div class="photo-category-header">
                            <i class="fas fa-user-circle"></i> Foto Pelanggan (Saat Lapor)
                        </div>
                    `);
                    
                    customerPhotos.forEach(photo => {
                        globalIndex++;
                        const thumbnailHtml = `
                            <div class="photo-thumbnail" onclick="openPhotoModal('${photo.path}', '${photo.label}', ${globalIndex}, ${sortedPhotos.length})" title="${photo.label} ${globalIndex}">
                                <img src="${photo.path}" alt="${photo.label} ${globalIndex}" onerror="this.onerror=null; this.src='/img/no-image.png'; console.error('[IMG_ERROR] Failed to load:', '${photo.path}');">
                                <span class="photo-count-badge">${globalIndex}</span>
                                <div class="photo-label-badge">${photo.label}</div>
                            </div>
                        `;
                        photoContainer.append(thumbnailHtml);
                    });
                }
                
                // 2. SECOND: Display Teknisi Photos by Category
                const categorizedTekPhotos = teknisiPhotos.filter(p => p.category);
                const uncategorizedTekPhotos = teknisiPhotos.filter(p => !p.category);
                
                if (categorizedTekPhotos.length > 0) {
                    const categories = ['problem', 'speedtest', 'result', 'extra'];
                    categories.forEach(cat => {
                        if (photosByCategory[cat] && photosByCategory[cat].length > 0) {
                            // Add category header
                            const categoryLabel = photosByCategory[cat][0].label;
                            photoContainer.append(`
                                <div class="photo-category-header">
                                    <i class="fas fa-wrench"></i> ${categoryLabel}
                                </div>
                            `);
                            
                            // Add photos in this category
                            photosByCategory[cat].forEach(photo => {
                                globalIndex++;
                                const thumbnailHtml = `
                                    <div class="photo-thumbnail" onclick="openPhotoModal('${photo.path}', '${photo.label}', ${globalIndex}, ${sortedPhotos.length})" title="${photo.label} ${globalIndex}">
                                        <img src="${photo.path}" alt="${photo.label} ${globalIndex}" onerror="this.onerror=null; this.src='/img/no-image.png'; console.error('[IMG_ERROR] Failed to load:', '${photo.path}');">
                                        <span class="photo-count-badge">${globalIndex}</span>
                                        <div class="photo-label-badge">${photo.label}</div>
                                    </div>
                                `;
                                photoContainer.append(thumbnailHtml);
                            });
                        }
                    });
                }
                
                // 3. LAST: Display Uncategorized Teknisi Photos (if any)
                if (uncategorizedTekPhotos.length > 0) {
                    photoContainer.append(`
                        <div class="photo-category-header">
                            <i class="fas fa-images"></i> Foto Teknisi Lainnya
                        </div>
                    `);
                    
                    uncategorizedTekPhotos.forEach(photo => {
                        globalIndex++;
                        const thumbnailHtml = `
                            <div class="photo-thumbnail" onclick="openPhotoModal('${photo.path}', '${photo.label}', ${globalIndex}, ${sortedPhotos.length})" title="${photo.label} ${globalIndex}">
                                <img src="${photo.path}" alt="${photo.label} ${globalIndex}" onerror="this.onerror=null; this.src='/img/no-image.png'; console.error('[IMG_ERROR] Failed to load:', '${photo.path}');">
                                <span class="photo-count-badge">${globalIndex}</span>
                                <div class="photo-label-badge">${photo.label}</div>
                            </div>
                        `;
                        photoContainer.append(thumbnailHtml);
                    });
                }
            } else {
                photoContainer.append('<p class="text-muted">Belum ada foto dokumentasi</p>');
            }
            
            // Show workflow progress
            updateWorkflowProgress(ticket.normalizedStatus || ticket.status);
            
            detailModal.modal('show');
        }
        
        function updateWorkflowProgress(status) {
            // Normalize status to handle variations
            let normalizedStatus = normalizeTicketStatusAdmin(status);

            if (normalizedStatus === 'cancelled') {
                // For cancelled tickets, mark all as inactive
                $('.workflow-step').removeClass('completed active');
                return;
            }
            
            const steps = ['baru', 'process', 'otw', 'arrived', 'working', 'completed'];
            const currentIndex = steps.indexOf(normalizedStatus);
            
            // Clear all first
            $('.workflow-step').removeClass('completed active');
            
            if (normalizedStatus === 'completed') {
                steps.forEach((step, index) => {
                    const stepEl = $(`#step-${step}`);
                    if (stepEl.length === 0) {
                        console.error('[WORKFLOW_STEP] Element not found for step:', step);
                    } else {
                        stepEl.addClass('completed');
                    }
                });
                return; // Exit early after marking all as completed
            }
            
            if (currentIndex >= 0) {
                steps.forEach((step, index) => {
                    const stepEl = $(`#step-${step}`);
                    
                    if (stepEl.length === 0) {
                        console.error('[WORKFLOW_STEP] Element not found for step:', step);
                        return;
                    }
                    
                    if (index < currentIndex) {
                        stepEl.addClass('completed');
                    } else if (index === currentIndex) {
                        stepEl.addClass('active');
                    }
                });
            } else {
                // Status not in workflow, default to first step
                const baruStep = $('#step-baru');
                if (baruStep.length > 0) {
                    baruStep.addClass('active');
                } else {
                    console.error('[WORKFLOW_STEP] Element #step-baru not found!');
                }
            }
        }
        
        function openPhotoModal(photoPath, label, photoNum, totalPhotos) {
            // Set modal content
            $('#photoModalImage').attr('src', photoPath);
            $('#photoModalTitle').text(`${label} - Foto ${photoNum} dari ${totalPhotos}`);
            
            // Open modal with backdrop fix
            $('#photoModal').modal({
                show: true,
                backdrop: true,
                keyboard: true
            });
            
            // Ensure photo modal appears above detail modal
            $('#photoModal').on('shown.bs.modal', function() {
                // Force higher z-index on the backdrop
                $('.modal-backdrop').last().css('z-index', 1055);
                $('#photoModal').css('z-index', 1060);
            });
        }
        
        function downloadPhoto() {
            // Get current photo source
            const photoSrc = $('#photoModalImage').attr('src');
            if (!photoSrc) return;
            
            // Create temporary link and trigger download
            const link = document.createElement('a');
            link.href = photoSrc;
            link.download = photoSrc.split('/').pop();
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        
        let dataTableInstance;

        function setupCancelModal(ticketId) { 
            document.getElementById('cancelTicketIdDisplay').textContent = ticketId;
            document.getElementById('cancellationReasonInput').value = '';
            document.getElementById('confirmCancelTicketBtn').setAttribute('data-ticket-id', ticketId);
            $('#cancelTicketModal').modal('show');
        }
        async function executeAdminCancelTicket(ticketId, reason) { 
            if (!ticketId || !reason || reason.trim() === '') {
                displayGlobalAdminMessage('Alasan pembatalan wajib diisi!', 'warning');
                return;
            }
            console.log('[CANCEL_TICKET] Attempting to cancel ticket:', ticketId, 'with reason:', reason);
            try {
                const response = await fetch('/api/admin/ticket/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({ ticketId, cancellationReason: reason })
                });
                const result = await response.json();
                // Blur focus before hiding modal to prevent aria-hidden warning
                $('#cancelTicketModal').find(':focus').blur();
                $('#cancelTicketModal').modal('hide');
                if (response.ok && result.status === 200) {
                    displayGlobalAdminMessage(result.message, 'success');
                    loadTickets(); 
                } else {
                    displayGlobalAdminMessage(`Gagal membatalkan tiket: ${result.message || 'Error tidak diketahui.'}`, 'danger');
                }
            } catch (error) {
                $('#cancelTicketModal').find(':focus').blur();
                $('#cancelTicketModal').modal('hide');
                console.error('Error cancelling ticket by admin:', error);
                displayGlobalAdminMessage('Terjadi kesalahan koneksi saat membatalkan tiket.', 'danger');
            }
        }
        async function loadTickets(resetFilters = false) { 
            if (resetFilters) {
                document.getElementById('filterForm').reset();
                 // Jika Select2 digunakan untuk filter status atau lainnya, reset juga mereka
                // $('#filterStatusSelect2').val(null).trigger('change'); 
            }
            
            const status = document.getElementById('filterStatus').value;
            const startDate = document.getElementById('filterStartDate').value;
            const endDate = document.getElementById('filterEndDate').value;
            const pppoeName = document.getElementById('filterPppoe').value;
            const ticketIdVal = document.getElementById('filterTicketId').value;

            let queryParams = new URLSearchParams();
            if (status && status !== 'all') queryParams.append('status', status);
            if (startDate) queryParams.append('startDate', startDate);
            if (endDate) queryParams.append('endDate', endDate);
            if (pppoeName.trim() !== '') queryParams.append('pppoeName', pppoeName.trim());
            if (ticketIdVal.trim() !== '') queryParams.append('ticketId', ticketIdVal.trim());

            const apiUrl = `/api/admin/tickets?${queryParams.toString()}&_=${new Date().getTime()}`;

            try {
                const response = await fetch(apiUrl);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const result = await response.json();
                const tickets = result.data;
                
                // Properly destroy existing DataTable instance if it exists
                if (dataTableInstance && $.fn.DataTable.isDataTable('#allTicketsTable')) {
                    try {
                        dataTableInstance.clear().destroy();
                    } catch (e) {
                        // If error, try alternative destruction method
                        $('#allTicketsTable').DataTable().destroy();
                    }
                    dataTableInstance = null;
                    // Remove any lingering DataTable attributes
                    $('#allTicketsTable').removeAttr('aria-describedby');
                }
                
                const ticketsTableBody = document.getElementById('allTicketsTable').getElementsByTagName('tbody')[0];
                ticketsTableBody.innerHTML = ''; 

                // Clear tickets cache
                ticketsCache = {};
                
                if (tickets && tickets.length > 0) {
                    tickets.forEach(ticket => {
                        // Store ticket in cache for safe access
                        const safeTicketId = ticket.ticketId || ticket.id || 'unknown_' + Date.now();
                        ticketsCache[safeTicketId] = ticket;
                        let row = ticketsTableBody.insertRow();
                        row.insertCell().textContent = ticket.ticketId || '-';
                        // Smart customer name resolution - check ALL possible fields
                        const customerName = ticket.pelangganName || 
                                           ticket.pelangganPushName || 
                                           (ticket.pelangganDataSystem ? ticket.pelangganDataSystem.name : null) ||
                                           'Customer';
                        row.insertCell().textContent = `${customerName} (${ticket.pelangganId ? ticket.pelangganId.split('@')[0] : 'N/A'})`;
                        row.insertCell().innerHTML = `<div class="ticket-details-admin">${formatTicketDetailsAdmin(ticket.pelangganDataSystem)}</div>`;
                        row.insertCell().innerHTML = `<div class="report-text-admin">${ticket.laporanText || '-'}</div>`;
                        
                        // Photo column - Count ALL photos (customer + teknisi)
                        let photoCell = row.insertCell();
                        const ticketIdForPhoto = ticket.ticketId || ticket.id || 'unknown';
                        
                        // Count all photos from all sources
                        let totalPhotos = 0;
                        let photoLabels = [];
                        
                        const customerPhotoCount = typeof ticket.customerPhotoCount === 'number'
                            ? ticket.customerPhotoCount
                            : (ticket.customerPhotos && ticket.customerPhotos.length > 0 ? ticket.customerPhotos.length : 0);
                        const teknisiPhotoCount = getTicketTechnicianPhotoCount(ticket);

                        if (customerPhotoCount > 0) {
                            totalPhotos += customerPhotoCount;
                            photoLabels.push(`${customerPhotoCount} foto pelanggan`);
                        }

                        if (teknisiPhotoCount > 0) {
                            totalPhotos += teknisiPhotoCount;
                            photoLabels.push(`${teknisiPhotoCount} foto teknisi`);
                        }
                        
                        if (totalPhotos > 0) {
                            const title = photoLabels.join(', ');
                            photoCell.innerHTML = `
                                <button class="btn btn-sm btn-info" onclick="showTicketDetailById('${ticketIdForPhoto}')" title="${title}">
                                    <i class="fas fa-camera"></i> ${totalPhotos}
                                </button>
                            `;
                        } else {
                            photoCell.innerHTML = '<span class="text-muted">-</span>';
                        }
                        
                        const authoritativeStatus = ticket.normalizedStatus || ticket.status;
                        row.insertCell().innerHTML = getStatusBadgeAdmin(authoritativeStatus);
                        row.insertCell().textContent = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('id-ID', {dateStyle:'short', timeStyle:'short'}) : '-';
                        
                        let processedByText = ticket.processedByTeknisiName || '-';
                        if(ticket.processingStartedAt && ticket.processedByTeknisiName) processedByText += ` <small class="text-muted">(${new Date(ticket.processingStartedAt).toLocaleDateString('id-ID', {day:'2-digit',month:'short'})})</small>`;
                        row.insertCell().innerHTML = processedByText;

                        row.insertCell().innerHTML = getCompletedByDisplay(ticket);

                        // Handle both old format (object) and new format (string)
                        let cancelledByText = '-';
                        if (ticket.cancelled_by) {
                            // New format from our recent update
                            cancelledByText = ticket.cancelled_by;
                        } else if (ticket.cancelledBy) {
                            // Old format - might be object or string
                            if (typeof ticket.cancelledBy === 'object') {
                                cancelledByText = `${ticket.cancelledBy.name || 'N/A'} (${ticket.cancelledBy.type || 'N/A'})`;
                            } else {
                                cancelledByText = ticket.cancelledBy;
                            }
                        }
                        
                        // Add timestamp if available
                        const cancelTime = ticket.cancelled_at || ticket.cancellationTimestamp;
                        if (cancelTime && cancelledByText !== '-') {
                            cancelledByText += ` <small class="text-muted">(${new Date(cancelTime).toLocaleDateString('id-ID', {day:'2-digit',month:'short'})})</small>`;
                        }
                        row.insertCell().innerHTML = cancelledByText;

                        let adminActionCell = row.insertCell();
                        adminActionCell.classList.add('action-buttons-admin', 'text-center');
                        
                        // Check if ticket can be cancelled - handle various status formats
                        const normalizedStatus = normalizeTicketStatusAdmin(ticket.normalizedStatus || ticket.status);
                        const canCancel = normalizedStatus !== 'completed' && normalizedStatus !== 'cancelled';
                        
                        if (canCancel) {
                            let cancelButton = document.createElement('button');
                            cancelButton.classList.add('btn', 'btn-danger', 'btn-sm');
                            cancelButton.innerHTML = '<i class="fas fa-times-circle"></i> Batalkan';
                            cancelButton.title = 'Batalkan Tiket Ini';
                            const ticketIdForCancel = ticket.ticketId || ticket.id;
                            cancelButton.onclick = function() { setupCancelModal(ticketIdForCancel); };
                            adminActionCell.appendChild(cancelButton);
                        } else {
                            adminActionCell.textContent = '-';
                        }
                    });
                } else {
                    // Don't add colspan row yet - DataTable will handle empty state
                    // ticketsTableBody.innerHTML remains empty
                }

                // Only initialize DataTable if there are tickets
                // Otherwise DataTable will show its own empty message
                if (tickets && tickets.length > 0) {
                    try {
                        dataTableInstance = $('#allTicketsTable').DataTable({
                        "order": [[6, "desc"]], // Sort by "Tgl Dibuat" column (index 6)
                        "pageLength": 10,
                        "processing": true,
                        "destroy": true,
                        "responsive": true,
                        "autoWidth": false,
                        "language": {
                            "lengthMenu": "Tampilkan _MENU_ entri",
                            "zeroRecords": "Tidak ada data yang ditemukan",
                            "info": "Menampilkan _START_ hingga _END_ dari _TOTAL_ entri",
                            "infoEmpty": "Menampilkan 0 hingga 0 dari 0 entri",
                            "infoFiltered": "(difilter dari _MAX_ total entri)",
                            "search": "Cari:",
                            "paginate": {
                                "first": "Pertama",
                                "last": "Terakhir",
                                "next": "Selanjutnya",
                                "previous": "Sebelumnya"
                            }
                        },
                        "columnDefs": [
                            { "orderable": false, "targets": [4, 10] } // Photo and Action columns not sortable
                        ]
                        });
                    } catch(dtError) {
                        console.error('DataTable initialization error:', dtError);
                        // Table will still be visible even if DataTable fails
                    }
                } else {
                    // No tickets - show custom message without DataTable
                    dataTableInstance = null; // Clear reference since we're not initializing
                    const colCount = $('#allTicketsTable thead th').length;
                    ticketsTableBody.innerHTML = `<tr><td colspan="${colCount}" class="text-center text-muted py-4">Tidak ada tiket yang cocok dengan filter Anda.</td></tr>`;
                }

            } catch (error) {
                console.error('Error loading tickets for admin:', error);
                const colCount = $('#allTicketsTable thead th').length;
                document.getElementById('allTicketsTable').getElementsByTagName('tbody')[0].innerHTML = `<tr><td colspan="${colCount}" class="text-center">Gagal memuat data tiket. Coba refresh.</td></tr>`;
            }
        }

        document.getElementById('filterForm').addEventListener('submit', function(event) { event.preventDefault(); loadTickets();});
        
        document.addEventListener('DOMContentLoaded', function() {
            loadTickets(); 
            
            const confirmCancelBtn = document.getElementById('confirmCancelTicketBtn');
            if(confirmCancelBtn) {
                 confirmCancelBtn.addEventListener('click', function() {
                    const ticketId = this.getAttribute('data-ticket-id');
                    const reason = document.getElementById('cancellationReasonInput').value;
                    if (!reason || reason.trim() === "") {
                        // Menggunakan displayGlobalAdminMessage untuk pesan error di modal pembatalan juga bisa, atau alert
                        alert("Alasan pembatalan wajib diisi!"); 
                        // displayGlobalAdminMessage('Alasan pembatalan wajib diisi!', 'warning'); // Alternatif
                        return;
                    }
                    executeAdminCancelTicket(ticketId, reason);
                });
            }
            
            // Cleanup Orphaned Photos Handler
            const confirmCleanupBtn = document.getElementById('confirmCleanupOrphanedPhotos');
            if (confirmCleanupBtn) {
                confirmCleanupBtn.addEventListener('click', async function() {
                    const password = document.getElementById('cleanupAdminPassword').value;
                    if (!password) {
                        displayGlobalAdminMessage('Silakan masukkan password admin', 'warning');
                        return;
                    }
                    
                    // Disable button during request
                    confirmCleanupBtn.disabled = true;
                    confirmCleanupBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';
                    
                    try {
                        const response = await fetch('/api/admin/cleanup-orphaned-photos', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            credentials: 'include',
                            body: JSON.stringify({ password: password })
                        });
                        
                        const result = await response.json();
                        
                        if (response.ok && result.status === 200) {
                            displayGlobalAdminMessage(
                                `✅ ${result.message}${result.errors && result.errors.length > 0 ? '<br>⚠️ Beberapa file gagal dihapus: ' + result.errors.join(', ') : ''}`,
                                'success'
                            );
                            $('#cleanupOrphanedPhotosModal').modal('hide');
                            document.getElementById('cleanupAdminPassword').value = '';
                        } else {
                            displayGlobalAdminMessage(
                                `❌ ${result.message || 'Gagal menghapus foto tidak terpakai'}`,
                                'danger'
                            );
                        }
                    } catch (error) {
                        console.error('Error cleaning up orphaned photos:', error);
                        displayGlobalAdminMessage('Terjadi kesalahan koneksi saat menghapus foto.', 'danger');
                    } finally {
                        // Re-enable button
                        confirmCleanupBtn.disabled = false;
                        confirmCleanupBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Hapus Foto Tidak Terpakai';
                    }
                });
            }

            // Fix for createTicketModal aria-hidden issue
            $('#createTicketModal').on('show.bs.modal', function () {
                // Remove focus from any active element before showing modal
                document.activeElement.blur();
            });
            
            $('#createTicketModal').on('shown.bs.modal', function () {
                $(this).removeAttr('aria-hidden');
                $(this).attr('aria-modal', 'true');
                // Focus on first input instead of close button
                $('#customerSelect').select2('focus');
            });
            
            $('#createTicketModal').on('hide.bs.modal', function () {
                // Blur any focused element in the modal before hiding
                $(this).find(':focus').blur();
            });
            
            $('#createTicketModal').on('hidden.bs.modal', function () {
                // Reset form values after modal is completely hidden
                $('#customerSelectModal').val('');
                $('#laporanTextModal').val('');
                $('#prioritySelectModal').val('MEDIUM');
                $('#issueTypeSelectModal').val('WIFI_MATI');
                // Return focus to the trigger button
                $('[data-target="#createTicketModal"]').focus();
            });

            // Fix for cancel ticket modal aria-hidden issue
            $('#cancelTicketModal').on('show.bs.modal', function () {
                // Remove focus from any active element first
                document.activeElement.blur();
            });
            
            $('#cancelTicketModal').on('shown.bs.modal', function () {
                $(this).removeAttr('aria-hidden');
                $('#cancellationReasonInput').focus(); // Fokus ke textarea untuk alasan pembatalan
            });
            
            $('#cancelTicketModal').on('hide.bs.modal', function () {
                $(this).find(':focus').blur(); // Remove focus from any focused element
            });
            
            $('#cancelTicketModal').on('hidden.bs.modal', function () {
                // Return focus to the cancel button that opened it
                const ticketId = $('#confirmCancelTicketBtn').attr('data-ticket-id');
                if (ticketId && ticketsCache[ticketId]) {
                    // Try to find and focus the original button if still exists
                    $(`button[onclick*="setupCancelModal"]`).first().focus();
                }
            });

            // Fix for ticket detail modal aria-hidden issue
            $('#ticketDetailModal').on('show.bs.modal', function () {
                document.activeElement.blur();
            });
            
            $('#ticketDetailModal').on('shown.bs.modal', function () {
                $(this).removeAttr('aria-hidden');
                $(this).attr('aria-modal', 'true');
            });
            
            $('#ticketDetailModal').on('hide.bs.modal', function () {
                $(this).find(':focus').blur();
            });
            
            $('#ticketDetailModal').on('hidden.bs.modal', function () {
                // Return focus to the photo button that opened it
                $('button[onclick*="showTicketDetailById"]').first().focus();
            });
            
            // Fix for photo modal to ensure it's above detail modal
            $('#photoModal').on('show.bs.modal', function() {
                // Remove previous event handler to prevent memory leak
                $(this).off('shown.bs.modal.zindex');
            });
            
            $('#photoModal').on('shown.bs.modal.zindex', function() {
                // Ensure photo modal has higher z-index than detail modal
                const $photoModal = $(this);
                const $lastBackdrop = $('.modal-backdrop').last();
                
                $lastBackdrop.css('z-index', 1055);
                $photoModal.css('z-index', 1060);
                
                console.log('[PHOTO_MODAL] Z-index set - Modal:', $photoModal.css('z-index'), 'Backdrop:', $lastBackdrop.css('z-index'));
            });
            
            $('#photoModal').on('hidden.bs.modal', function() {
                // Clear image src to save memory
                $('#photoModalImage').attr('src', '');
            });

            $('#customerSelect').select2({
                theme: "bootstrap", // Menggunakan tema bootstrap umum yang lebih cocok untuk BS4
                dropdownParent: $('#createTicketModal'), 
                placeholder: 'Cari dan pilih pelanggan...',
                allowClear: true,
                dropdownAutoWidth: true,
                ajax: {
                    url: '/api/users', 
                    dataType: 'json',
                    delay: 250, 
                    data: function (params) {
                        return {
                            search: params.term, 
                            page: params.page || 1,
                            role: 'pelanggan' // Opsional: filter hanya user dengan role pelanggan jika API mendukung
                        };
                    },
                    processResults: function (data, params) {
                        params.page = params.page || 1;
                        const users = data.data || data; 
                        return {
                            results: users.map(user => ({
                                id: user.id,
                                text: `${user.name || `ID: ${user.id}`} (${user.pppoe_username || 'No PPPoE'}) - ${user.phone_number ? user.phone_number.split('|')[0] : 'No HP'}`
                            })),
                            pagination: {
                                more: (params.page * 10) < (data.total || users.length) 
                            }
                        };
                    },
                    cache: true
                }
            });

            document.getElementById('createTicketForm').addEventListener('submit', async function(event) {
                event.preventDefault();
                const customerUserId = document.getElementById('customerSelect').value;
                const laporanText = document.getElementById('laporanTextInput').value;
                const priority = document.getElementById('prioritySelect').value;
                const issueType = document.getElementById('issueTypeSelect').value;
                const submitBtn = document.getElementById('submitNewTicketBtn');
                
                // Prevent form submission if button is disabled
                if (submitBtn.disabled) {
                    return;
                }

                if (!customerUserId) { // Hanya cek customerUserId karena laporanText sudah 'required'
                    displayGlobalAdminMessage('Silakan pilih pelanggan', 'warning');
                    return;
                }
                
                // Disable submit button to prevent double submit
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Membuat tiket...';
                
                try {
                    const response = await fetch('/api/admin/ticket/create', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            customerUserId, 
                            laporanText,
                            priority,
                            issueType
                        })
                    });
                    const result = await response.json();

                    if (response.ok && (result.status === 201 || result.status === 200) ) {
                        // Display message with working hours info if outside hours
                        let messageToShow = result.message;
                        if (result.workingHours && !result.workingHours.isWithinHours && result.workingHours.warning) {
                            // Show warning style for outside working hours
                            displayGlobalAdminMessage(messageToShow, 'warning');
                        } else {
                            displayGlobalAdminMessage(messageToShow, 'success');
                        }
                        
                        // Blur focus before hiding modal to prevent aria-hidden warning
                        $('#createTicketModal').find(':focus').blur();
                        $('#createTicketModal').modal('hide');
                        document.getElementById('createTicketForm').reset();
                        $('#customerSelect').val(null).trigger('change'); 
                        loadTickets(); 
                    } else {
                        displayGlobalAdminMessage(result.message || 'Gagal membuat tiket', 'danger');
                    }
                } catch(error) {
                    console.error('Error creating ticket:', error);
                    displayGlobalAdminMessage('Terjadi kesalahan koneksi saat membuat tiket', 'danger');
                } finally {
                    // Re-enable submit button
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Buat Tiket';
                }
            });
        });
    </script>
</body>
</html>
