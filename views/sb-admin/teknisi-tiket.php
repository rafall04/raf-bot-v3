<!DOCTYPE html>
<html lang="en">

<head>
<?php
    // <head> tulis tangan melewatkan components-modern.css (lapisan komponen bersama).
    $pageTitle = 'Manajemen Tiket Laporan - Teknisi';
    $themeRole = 'teknisi';
    include __DIR__ . '/_head.php';
?>
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/teknisi-tiket.css') ?>" rel="stylesheet">
    <style>
      .ticket-card { border:1px solid rgba(128,128,128,.22); border-radius:12px; padding:.75rem .85rem; margin-bottom:.6rem; }
      .ticket-card .tc-head { display:flex; justify-content:space-between; align-items:center; gap:.5rem; margin-bottom:.35rem; }
      .ticket-card .tc-cust { font-size:.9rem; margin:.15rem 0; }
      .ticket-card .tc-laporan { font-size:.82rem; opacity:.82; margin:.35rem 0; }
      .ticket-card .tc-stepper { margin:.45rem 0; overflow-x:auto; }
      .ticket-card .tc-actions { margin-top:.55rem; }
      .ticket-card .tc-actions .btn-group-vertical { width:100%; gap:.3rem; }
      .ticket-filter-bar .custom-switch { padding-left:2.25rem; }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_role_aware_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_role_aware_teknisi_topbar.php'; ?>
                <div class="container-fluid">
                    <div class="tk-page-head">
                        <div class="tk-title">
                            <span class="tk-title-icon"><i class="fas fa-headset"></i></span>
                            <div>
                                <h1>Manajemen Tiket Laporan</h1>
                                <p class="tk-subtitle">Kelola tiket gangguan & laporan pelanggan</p>
                            </div>
                        </div>
                        <div class="tk-actions">
                            <button class="btn btn-primary" data-toggle="modal" data-target="#createTicketModal">
                                <i class="fas fa-ticket-alt"></i> Buat Tiket Baru
                            </button>
                        </div>
                    </div>
                    <div id="globalMessage" class="mb-3"></div>

                    <div class="card shadow mb-4">
                        <div class="card-header py-3 d-flex flex-row align-items-center justify-content-between">
                            <h6 class="m-0 font-weight-bold text-primary">Daftar Tiket Aktif</h6>
                            <button class="btn btn-sm btn-primary" onclick="loadTickets()"><i class="fas fa-sync-alt"></i> Refresh</button>
                        </div>
                        <div class="card-body">
                            <div class="ticket-filter-bar mb-3 d-flex flex-wrap align-items-center" style="gap:.5rem;">
                                <div class="btn-group btn-group-sm" role="group" id="filterSource">
                                    <button type="button" class="btn btn-outline-primary active" data-value="">Semua</button>
                                    <button type="button" class="btn btn-outline-danger" data-value="los"><i class="fas fa-bolt"></i> LOS/Fiber</button>
                                    <button type="button" class="btn btn-outline-secondary" data-value="customer">Lapor pelanggan</button>
                                </div>
                                <select id="filterStatus" class="form-control form-control-sm" style="width:auto;">
                                    <option value="">Semua status</option>
                                    <option value="baru">Baru</option>
                                    <option value="process">Diproses</option>
                                    <option value="otw">OTW</option>
                                    <option value="arrived">Tiba</option>
                                    <option value="working">Bekerja</option>
                                </select>
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="filterHighPrio">
                                    <label class="custom-control-label" for="filterHighPrio">Prioritas tinggi</label>
                                </div>
                                <span class="text-muted small ml-auto" id="filterCount"></span>
                            </div>
                            <div class="d-none d-md-block">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="ticketsTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID Tiket</th>
                                            <th>Pelanggan</th>
                                            <th>Isi Laporan</th>
                                            <th>Status</th>
                                            <th style="min-width: 300px;">Progress</th>
                                            <th>Teknisi</th>
                                            <th style="min-width: 180px;">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        </tbody>
                                </table>
                            </div>
                            </div>
                            <div id="ticketCards" class="d-md-none"></div>
                        </div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; Raf BOT 2025</span>
                    </div>
                </div>
            </footer>
            </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Create Ticket Modal -->
    <div class="modal fade" id="createTicketModal" tabindex="-1" role="dialog" aria-labelledby="createTicketModalLabel" aria-modal="true">
        <div class="modal-dialog modal-dialog-centered modal-lg" role="document">
            <form id="createTicketForm">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="createTicketModalLabel">Buat Tiket Laporan Baru</h5>
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
                        
                        <div class="form-group">
                            <label for="createTicketPhotoInput">Upload Foto (Opsional):</label>
                            <input type="file" class="form-control-file" id="createTicketPhotoInput" name="photos" accept="image/*" multiple>
                            <small class="form-text text-muted">Maksimal 3 foto, ukuran maksimal 5MB per foto. Format: JPG, PNG, GIF, WebP</small>
                            <div id="photoPreview" class="mt-2"></div>
                        </div>
                        
                        <div class="alert alert-info" role="alert">
                            <strong>ℹ️ Info:</strong> Tiket akan otomatis dikirim ke pelanggan dan teknisi lain via WhatsApp
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

    <div class="modal fade" id="processTicketModal" tabindex="-1" role="dialog" aria-labelledby="processTicketModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="processTicketModalLabel">Konfirmasi Proses Tiket</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">
                    Apakah Anda yakin ingin mengambil dan memproses tiket ini? Tiket akan ditandai sedang Anda tangani.
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-primary" type="button" id="confirmProcessTicketBtn">Ya, Proses Tiket</button>
                </div>
            </div>
        </div>
    </div>

    <!-- OTP Display Modal REMOVED -->
    <!-- Teknisi should NOT see OTP - they must ask customer for it! -->
    <!-- This is the correct workflow per security requirements -->

    <!-- OTP Verification Modal -->
    <div class="modal fade" id="verifyOtpModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-check-circle"></i> Verifikasi OTP</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">
                    <p>Masukkan 6 digit kode OTP yang diberikan pelanggan:</p>
                    <input type="hidden" id="verifyOtpTicketId">
                    <div class="form-group">
                        <label for="otpInput">Kode OTP</label>
                        <input type="text" class="form-control form-control-lg text-center" 
                               id="otpInput" placeholder="000000" maxlength="6" 
                               style="letter-spacing: 5px; font-size: 1.5rem; font-family: 'Courier New', monospace;">
                    </div>
                    <div class="alert alert-info">
                        <i class="fas fa-lightbulb"></i> 
                        <small>Minta kode OTP langsung dari pelanggan saat Anda tiba di lokasi</small>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-primary" type="button" id="confirmVerifyOtpBtn">
                        <i class="fas fa-check"></i> Verifikasi
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Photo Upload Modal - GUIDED WITH CATEGORIES -->
    <div class="modal fade" id="uploadPhotoModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header" style="background: #5a67d8; color: white;">
                    <h5 class="modal-title"><i class="fas fa-camera"></i> Upload Foto Dokumentasi</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close" style="color: white; opacity: 0.9;">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="uploadPhotoTicketId">
                    
                    <!-- Step Progress Indicator -->
                    <div class="upload-progress-steps mb-4">
                        <div class="step active" id="step-problem" data-category="problem">
                            <div class="step-icon">1</div>
                            <div class="step-label">Penyebab Masalah</div>
                            <div class="step-status"><i class="fas fa-circle"></i></div>
                        </div>
                        <div class="step-connector"></div>
                        <div class="step" id="step-speedtest" data-category="speedtest">
                            <div class="step-icon">2</div>
                            <div class="step-label">Speedtest</div>
                            <div class="step-status"><i class="fas fa-circle"></i></div>
                        </div>
                        <div class="step-connector"></div>
                        <div class="step" id="step-result" data-category="result">
                            <div class="step-icon">3</div>
                            <div class="step-label">Hasil (Opsional)</div>
                            <div class="step-status"><i class="fas fa-circle"></i></div>
                        </div>
                        <div class="step-connector"></div>
                        <div class="step" id="step-extra" data-category="extra">
                            <div class="step-icon">+</div>
                            <div class="step-label">Tambahan</div>
                            <div class="step-status"><i class="fas fa-circle"></i></div>
                        </div>
                    </div>
                    
                    <!-- Current Step Guidance -->
                    <div class="current-step-guidance" id="stepGuidance">
                        <h5><i class="fas fa-info-circle"></i> <span id="guidanceTitle">Langkah 1: Foto Penyebab Masalah</span></h5>
                        <div id="guidanceContent">
                            <ul class="mb-2">
                                <li>Foto titik putus kabel atau area bermasalah</li>
                                <li>Foto konektor rusak atau komponen bermasalah</li>
                                <li>Kondisi awal sebelum perbaikan dimulai</li>
                            </ul>
                            <div class="alert alert-info mb-0">
                                <i class="fas fa-lightbulb"></i> <strong>Tips:</strong> Foto harus jelas, fokus, dan tunjukkan masalahnya dengan detail.
                            </div>
                        </div>
                    </div>
                    
                    <!-- Upload Controls -->
                    <div class="upload-controls mt-3">
                        <div class="form-group">
                            <label for="photoInput" class="btn btn-primary btn-block">
                                <i class="fas fa-camera"></i> Pilih Foto untuk <span id="currentCategoryLabel">Penyebab Masalah</span>
                            </label>
                            <input type="file" class="d-none" id="photoInput" accept="image/*">
                            <small class="form-text text-muted text-center">
                                Format: JPG, PNG, GIF. Maksimal 5MB per foto.
                            </small>
                        </div>
                        
                        <!-- Skip Button (only for optional steps) -->
                        <div class="text-center mb-3" id="skipButtonContainer" style="display: none;">
                            <button class="btn btn-outline-secondary btn-sm" id="skipCategoryBtn">
                                <i class="fas fa-forward"></i> Lewati Foto Ini (Opsional)
                            </button>
                        </div>
                    </div>
                    
                    <!-- Photo Preview with Grouping -->
                    <div class="mt-4">
                        <h6 class="font-weight-bold">
                            <i class="fas fa-images"></i> Foto Terupload: 
                            <span class="badge badge-info" id="photoCountBadge">0/5</span>
                            <span class="badge badge-success ml-2" id="requiredBadge">Wajib: 0/2</span>
                        </h6>
                        <div class="photo-preview-container" id="photoPreviewContainer">
                            <p class="text-muted text-center">Belum ada foto terupload</p>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">
                        <i class="fas fa-times"></i> Tutup
                    </button>
                    <button class="btn btn-success" type="button" id="completePhotoUploadBtn" disabled>
                        <i class="fas fa-check-circle"></i> Selesai Upload
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Complete Ticket Modal -->
    <div class="modal fade" id="completeTicketModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-check-circle"></i> Selesaikan Tiket</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="completeTicketId">
                    <div class="alert alert-success">
                        <i class="fas fa-info-circle"></i> 
                        Pastikan semua pekerjaan selesai sebelum menutup tiket.
                    </div>
                    <div class="form-group">
                        <label for="resolutionNotes">Catatan Penyelesaian</label>
                        <textarea class="form-control" id="resolutionNotes" rows="4" 
                                  placeholder="Jelaskan apa yang sudah dikerjakan dan masalah apa yang sudah diselesaikan..."></textarea>
                        <small class="form-text text-muted">
                            Catatan ini akan dikirim ke pelanggan via WhatsApp
                        </small>
                    </div>
                    <div class="mt-3">
                        <p class="font-weight-bold">Dokumentasi Foto:</p>
                        <div id="completedPhotosPreview" class="photo-preview-container">
                            <!-- Photos will be shown here -->
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-success" type="button" id="confirmCompleteTicketBtn">
                        <i class="fas fa-check-double"></i> Tandai Selesai
                    </button>
                </div>
            </div>
        </div>
    </div>


    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

    <script src="/js/teknisi-tiket.js"></script>
</body>
</html>
