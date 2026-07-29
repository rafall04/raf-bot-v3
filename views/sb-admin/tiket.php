<!DOCTYPE html>
<html lang="en">

<head>
<?php
    // <head> tulis tangan melewatkan components-modern.css (lapisan komponen bersama).
    $pageTitle = 'RAF BOT - Ticket Management';
    $pageDescription = 'RAF BOT Ticket Management';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
?>
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />

    <link href="<?= rafAssetUrl('/css/tiket.css') ?>" rel="stylesheet">
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


    <script src="/js/tiket.js"></script>
</body>
</html>
