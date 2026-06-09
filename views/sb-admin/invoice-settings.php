<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Pengaturan Invoice';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

  <style>
    .preview-card {
      background: #f8f9fc;
      border: 1px solid #e3e6f0;
      border-radius: 0.35rem;
      padding: 1rem;
      font-family: 'Courier New', monospace;
      white-space: pre-wrap;
      max-height: 600px;
      overflow-y: auto;
    }
    
    .template-editor {
      font-family: 'Courier New', monospace;
      min-height: 300px;
    }
    
    .variable-tag {
      background: #4e73df;
      color: white;
      padding: 0.2rem 0.4rem;
      border-radius: 0.25rem;
      font-size: 0.8rem;
      cursor: pointer;
      margin: 0.1rem;
      display: inline-block;
    }
  </style>
</head>

<body id="page-top">

  <div id="wrapper">
    <?php include '_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
          <form class="form-inline"> 
            <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3"> 
              <i class="fa fa-bars"></i> 
            </button> 
          </form>
          <ul class="navbar-nav ml-auto">
            <li class="nav-item dropdown no-arrow">
              <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                <span class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span> 
                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
              </a>
              <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal"> 
                  <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i> Logout 
                </a>
              </div>
            </li>
          </ul>
        </nav>
        
        <div class="container-fluid">
          <div class="d-sm-flex align-items-center justify-content-between mb-4">
            <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Pengaturan Invoice</h1>
            <p>Kelola dan monitor pengaturan invoice</p>
          </div>
            <div>
              <button class="btn btn-success btn-sm" id="saveSettings">
                <i class="fas fa-save fa-sm text-white-50"></i> Simpan Pengaturan
              </button>
            </div>
          </div>

          <div class="row">
            <!-- Company Information -->
            <div class="col-lg-6">
              <!-- Table Section -->
          <h4 class="dashboard-section-title">Informasi Perusahaan</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Informasi Perusahaan</h6>
                </div>
                <div class="card-body">
                  <form id="companyForm">
                    <div class="form-group">
                      <label for="companyName">Nama Perusahaan</label>
                      <input type="text" class="form-control" id="companyName" placeholder="Nama perusahaan Anda">
                    </div>
                    <div class="form-group">
                      <label for="companyAddress">Alamat</label>
                      <textarea class="form-control" id="companyAddress" rows="3" placeholder="Alamat lengkap perusahaan"></textarea>
                    </div>
                    <div class="form-group">
                      <label for="autoSend">Auto-send Invoice</label>
                      <select class="form-control" id="autoSend" name="autoSend">
                        <option value="true">Ya, kirim otomatis</option>
                        <option value="false">Tidak, manual saja</option>
                      </select>
                      <small class="form-text text-muted">Kirim invoice otomatis saat pembayaran disetujui</small>
                    </div>
                    <div class="form-group">
                      <label for="sendPDF">Kirim Invoice PDF</label>
                      <select class="form-control" id="sendPDF" name="sendPDF">
                        <option value="true">Ya, kirim PDF</option>
                        <option value="false">Tidak</option>
                      </select>
                      <small class="form-text text-muted">Kirim invoice PDF otomatis via WhatsApp saat pembayaran dikonfirmasi</small>
                    </div>
                    <div class="form-group">
                      <label for="companyNpwp">NPWP</label>
                      <input type="text" class="form-control" id="companyNpwp" placeholder="12.345.678.9-012.000" 
                             pattern="[0-9]{2}\.[0-9]{3}\.[0-9]{3}\.[0-9]-[0-9]{3}\.[0-9]{3}" maxlength="20">
                      <div class="invalid-feedback">Format NPWP: 12.345.678.9-012.000</div>
                    </div>
                    <div class="form-group">
                      <label for="companyPhone">Telepon</label>
                      <input type="text" class="form-control" id="companyPhone" placeholder="+62xxx" pattern="^\+?[0-9\s\-\(\)]+$">
                      <div class="invalid-feedback">Format telepon tidak valid</div>
                    </div>
                    <div class="form-group">
                      <label for="companyEmail">Email</label>
                      <input type="email" class="form-control" id="companyEmail" placeholder="info@perusahaan.com">
                      <div class="invalid-feedback">Format email tidak valid</div>
                    </div>
                    <div class="form-group">
                      <label for="companyWebsite">Website</label>
                      <input type="url" class="form-control" id="companyWebsite" placeholder="https://website.com">
                    </div>
                  </form>
                </div>
              </div>

              <!-- Bank Account Details -->
              <!-- Table Section -->
          <h4 class="dashboard-section-title">Informasi Rekening Bank</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Informasi Rekening Bank</h6>
                </div>
                <div class="card-body">
                  <div class="form-group">
                    <label for="bankName">Nama Bank</label>
                    <input type="text" class="form-control" id="bankName" placeholder="Bank BCA">
                  </div>
                  <div class="form-group">
                    <label for="bankAccountNumber">Nomor Rekening</label>
                    <input type="text" class="form-control" id="bankAccountNumber" placeholder="1234567890">
                  </div>
                  <div class="form-group">
                    <label for="bankAccountName">Atas Nama</label>
                    <input type="text" class="form-control" id="bankAccountName" placeholder="PT. Nama Perusahaan">
                  </div>
                  <div class="form-group">
                    <label for="bankBranch">Cabang</label>
                    <input type="text" class="form-control" id="bankBranch" placeholder="KCP Jakarta Pusat">
                  </div>
                  <div class="form-group">
                    <label for="paymentInstructions">Instruksi Pembayaran</label>
                    <textarea class="form-control" id="paymentInstructions" rows="3" placeholder="Mohon transfer ke rekening di atas dan konfirmasi pembayaran via WhatsApp"></textarea>
                  </div>
                </div>
              </div>

              <!-- Invoice Settings -->
              <!-- Table Section -->
          <h4 class="dashboard-section-title">Pengaturan Invoice</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Pengaturan Invoice</h6>
                </div>
                <div class="card-body">
                  <div class="form-group">
                    <label for="enableTax">Penggunaan Pajak</label>
                    <select class="form-control" id="enableTax" name="enableTax">
                      <option value="true">Ya, gunakan pajak</option>
                      <option value="false">Tidak, tanpa pajak</option>
                    </select>
                    <small class="form-text text-muted">Aktifkan atau nonaktifkan perhitungan pajak</small>
                  </div>
                  <div class="form-group" id="taxRateGroup">
                    <label for="taxRate">Tarif Pajak (%)</label>
                    <input type="number" class="form-control" id="taxRate" min="0" max="100" step="0.01" value="11">
                    <small class="form-text text-muted">Default: 11% (PPN)</small>
                  </div>
                  <div class="form-group">
                    <label for="invoicePrefix">Prefix Nomor Invoice</label>
                    <input type="text" class="form-control" id="invoicePrefix" value="INV" maxlength="10">
                    <small class="form-text text-muted">Format: PREFIX-YYYYMMDD-XXXX</small>
                  </div>
                  <div class="form-group">
                    <label for="dueDays">Jatuh Tempo (hari)</label>
                    <input type="number" class="form-control" id="dueDays" min="1" max="365" value="30">
                    <small class="form-text text-muted">Berapa hari dari tanggal invoice</small>
                  </div>
                  <div class="form-group">
                    <div class="custom-control custom-checkbox">
                      <input type="checkbox" class="custom-control-input" id="autoSendInvoice" checked>
                      <label class="custom-control-label" for="autoSendInvoice">Kirim invoice otomatis via WhatsApp</label>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- PDF Template Customization -->
            <div class="col-lg-6">
              <!-- PDF Layout Settings -->
              <!-- Table Section -->
          <h4 class="dashboard-section-title">Kustomisasi Layout PDF</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Kustomisasi Layout PDF</h6>
                </div>
                <div class="card-body">
                  <div class="form-group">
                    <label for="pdfTheme">Tema Warna</label>
                    <select class="form-control" id="pdfTheme">
                      <option value="blue">Biru Profesional (Default)</option>
                      <option value="green">Hijau Bisnis</option>
                      <option value="red">Merah Corporate</option>
                      <option value="purple">Ungu Modern</option>
                      <option value="dark">Gelap Elegan</option>
                    </select>
                  </div>
                  
                  <div class="form-group">
                    <label for="logoUrl">URL Logo</label>
                    <input type="url" class="form-control" id="logoUrl" placeholder="https://example.com/logo.png">
                    <small class="form-text text-muted">Gunakan URL publik ke file gambar logo Anda.</small>
                  </div>

                  <div class="form-group">
                    <label for="logoUpload">atau Upload Logo Perusahaan</label>
                    <div class="custom-file">
                      <input type="file" class="custom-file-input" id="logoUpload" accept="image/*">
                      <label class="custom-file-label" for="logoUpload">Pilih file...</label>
                    </div>
                    <small class="form-text text-muted">Format: JPG, PNG, GIF, SVG maksimal 2MB. Jika URL Logo diisi, ini akan diabaikan.</small>
                    <div id="logoPreview" class="mt-2"></div>
                    <button type="button" class="btn btn-sm btn-primary mt-2" id="uploadLogoBtn" style="display:none;">
                      <i class="fas fa-upload"></i> Upload Logo
                    </button>
                  </div>
                  
                  <div class="form-group">
                    <label for="headerText">Teks Header Kustom</label>
                    <input type="text" class="form-control" id="headerText" placeholder="INVOICE" maxlength="20">
                    <small class="form-text text-muted">Teks yang muncul di header invoice</small>
                  </div>
                  
                  <div class="form-group">
                    <label for="footerText">Footer Kustom</label>
                    <textarea class="form-control" id="footerText" rows="2" placeholder="Terima kasih atas kepercayaan Anda."></textarea>
                  </div>
                </div>
              </div>
              
              <!-- PDF Content Customization -->
              <!-- Table Section -->
          <h4 class="dashboard-section-title">Kustomisasi Konten</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Kustomisasi Konten</h6>
                </div>
                <div class="card-body">
                  <div class="form-group">
                    <label for="billingTitle">Judul Bagian Tagihan</label>
                    <input type="text" class="form-control" id="billingTitle" value="TAGIHAN KEPADA:" maxlength="30">
                  </div>
                  
                  <div class="form-group">
                    <label for="serviceTitle">Judul Bagian Layanan</label>
                    <input type="text" class="form-control" id="serviceTitle" value="DETAIL LAYANAN:" maxlength="30">
                  </div>
                  
                  <div class="form-group">
                    <label for="showCustomerID">Tampilkan ID Pelanggan</label>
                    <select class="form-control" id="showCustomerID">
                      <option value="true">Ya, tampilkan</option>
                      <option value="false">Tidak</option>
                    </select>
                  </div>
                  
                  <div class="form-group">
                    <label for="showCustomerPhone">Tampilkan Nomor Telepon Pelanggan</label>
                    <select class="form-control" id="showCustomerPhone" name="showCustomerPhone">
                      <option value="false">Tidak (Hanya Nama & Alamat)</option>
                      <option value="true">Ya, tampilkan</option>
                    </select>
                  </div>
                  
                  <div class="form-group">
                    <label for="showServiceSpeed">Tampilkan Kecepatan Internet</label>
                    <select class="form-control" id="showServiceSpeed" name="showServiceSpeed">
                      <option value="true">Ya, tampilkan sesuai profil</option>
                      <option value="false">Tidak</option>
                    </select>
                  </div>
                  
                  <div class="form-group">
                    <label for="showServiceDescription">Tampilkan Deskripsi Layanan Detail</label>
                    <select class="form-control" id="showServiceDescription" name="showServiceDescription">
                      <option value="false">Hanya nama paket</option>
                      <option value="true">Ya, tampilkan</option>
                    </select>
                  </div>
                  
                  <div class="form-group">
                    <label for="showNPWP">Tampilkan NPWP</label>
                    <select class="form-control" id="showNPWP" name="showNPWP">
                      <option value="false">Tidak</option>
                      <option value="true">Ya, tampilkan</option>
                    </select>
                  </div>
                  
                  <div class="form-group">
                    <label for="paymentMethods">Metode Pembayaran yang Ditampilkan</label>
                    <select class="form-control" id="paymentMethods" name="paymentMethods">
                      <option value="cash_transfer">Cash atau Transfer</option>
                      <option value="all">Semua Metode</option>
                    </select>
                  </div>
                  
                  <div class="form-group">
                    <label for="showNotes">Tampilkan Catatan</label>
                    <select class="form-control" id="showNotes" name="showNotes">
                      <option value="false">Tidak, hilangkan catatan</option>
                      <option value="true">Ya, tampilkan catatan</option>
                    </select>
                  </div>
                  
                  <div class="form-group" id="notesContainer" style="display:none;">
                    <label for="additionalNotes">Catatan Tambahan</label>
                    <textarea class="form-control" id="additionalNotes" rows="3" placeholder="Catatan khusus yang akan muncul di invoice"></textarea>
                  </div>
                </div>
              </div>
              
              <!-- PDF Preview -->
              <div class="card shadow mb-4">
                <div class="card-header py-3 d-flex justify-content-between align-items-center">
                  <h6 class="m-0 font-weight-bold text-primary">Preview Invoice PDF</h6>
                  <button class="btn btn-info btn-sm" id="previewPDFBtn">
                    <i class="fas fa-file-pdf"></i> Preview PDF
                  </button>
                </div>
                <div class="card-body">
                  <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i>
                    <strong>Preview Real-time</strong><br>
                    Klik "Preview PDF" untuk melihat hasil kustomisasi Anda secara real-time.
                  </div>
                  <div id="invoicePreview">
                    <p class="text-muted">Klik "Preview PDF" untuk melihat contoh invoice dengan pengaturan saat ini.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer class="sticky-footer bg-white">
        <div class="container my-auto">
          <div class="copyright text-center my-auto">
            <span>Copyright &copy; RAF BOT 2024</span>
          </div>
        </div>
      </footer>
    </div>
  </div>

  <!-- Logout Modal -->
  <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog">
    <div class="modal-dialog modal-dialog-centered" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Ready to Leave?</h5>
          <button class="close" type="button" data-dismiss="modal">
            <span>&times;</span>
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

  <!-- Loading Modal -->
  <div class="modal fade" id="loadingModal" tabindex="-1" role="dialog" data-backdrop="static" data-keyboard="false">
    <div class="modal-dialog modal-dialog-centered" role="document">
      <div class="modal-content">
        <div class="modal-body text-center">
          <div class="spinner-border text-primary" role="status">
            <span class="sr-only">Loading...</span>
          </div>
          <h5 class="mt-3">Menyimpan pengaturan...</h5>
        </div>
      </div>
    </div>
  </div>

  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script src="/js/invoice-settings.js"></script>
</body>
</html>
