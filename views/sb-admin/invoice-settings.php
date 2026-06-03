<!DOCTYPE html>
<html lang="id">

<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <title>RAF BOT - Pengaturan Invoice</title>

  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">

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

  <script>
    $(document).ready(function() {
      const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' });
      
      // Default template
      const defaultTemplate = `🧾 *INVOICE PEMBAYARAN*
━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *Detail Invoice:*
• No. Invoice: \${invoiceNumber}
• Tanggal: \${issueDate}
• Status: ✅ LUNAS

👤 *Pelanggan:*
• Nama: \${customerName}
• Telepon: \${customerPhone}

🌐 *Layanan:*
• Paket: \${serviceName}

💰 *Rincian Biaya:*
• Subtotal: \${subtotal}
• Pajak: \${tax}
• *Total: \${total}*

🏢 *\${companyName}*
\${companyAddress}

━━━━━━━━━━━━━━━━━━━━━━━━━━
Terima kasih atas pembayaran Anda.

_Invoice ini dibuat secara otomatis oleh sistem._`;

      // Toggle tax rate field visibility
      function toggleTaxRate() {
        if ($('#enableTax').val() === 'true') {
          $('#taxRateGroup').show();
        } else {
          $('#taxRateGroup').hide();
        }
      }
      
      // Enable tax change handler
      $('#enableTax').change(function() {
        toggleTaxRate();
      });
      
      // Input validation
      function validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
      }
      
      function validatePhone(phone) {
        const re = /^\+?[0-9\s\-\(\)]+$/;
        return re.test(phone);
      }
      
      function validateNPWP(npwp) {
        const re = /^[0-9]{2}\.[0-9]{3}\.[0-9]{3}\.[0-9]-[0-9]{3}\.[0-9]{3}$/;
        return re.test(npwp);
      }
      
      // Real-time validation
      $('#companyEmail').on('blur', function() {
        const email = $(this).val();
        if (email && !validateEmail(email)) {
          $(this).addClass('is-invalid');
        } else {
          $(this).removeClass('is-invalid');
        }
      });
      
      $('#companyPhone').on('blur', function() {
        const phone = $(this).val();
        if (phone && !validatePhone(phone)) {
          $(this).addClass('is-invalid');
        } else {
          $(this).removeClass('is-invalid');
        }
      });
      
      $('#companyNpwp').on('blur', function() {
        const npwp = $(this).val();
        if (npwp && !validateNPWP(npwp)) {
          $(this).addClass('is-invalid');
        } else {
          $(this).removeClass('is-invalid');
        }
      });
      
      // Auto-format NPWP
      $('#companyNpwp').on('input', function() {
        let value = $(this).val().replace(/[^0-9]/g, '');
        if (value.length > 15) value = value.substr(0, 15);
        
        let formatted = '';
        if (value.length > 0) formatted += value.substr(0, 2);
        if (value.length > 2) formatted += '.' + value.substr(2, 3);
        if (value.length > 5) formatted += '.' + value.substr(5, 3);
        if (value.length > 8) formatted += '.' + value.substr(8, 1);
        if (value.length > 9) formatted += '-' + value.substr(9, 3);
        if (value.length > 12) formatted += '.' + value.substr(12, 3);
        
        $(this).val(formatted);
      });
      
      // Load current settings
      loadSettings();
      
      // Logo upload handler
      $('#logoUpload').on('change', function(e) {
        const file = e.target.files[0];
        if (file) {
          if (file.size > 2 * 1024 * 1024) { // 2MB limit
            alert('File terlalu besar. Maksimal 2MB.');
            $(this).val('');
            $('.custom-file-label').text('Pilih file...');
            return;
          }
          
          // Update file label
          $('.custom-file-label').text(file.name);
          
          const reader = new FileReader();
          reader.onload = function(e) {
            const img = $('<img>').attr('src', e.target.result).css({
              'max-width': '150px',
              'max-height': '80px',
              'border': '1px solid #ddd',
              'border-radius': '4px',
              'padding': '5px'
            });
            $('#logoPreview').html(img);
            $('#uploadLogoBtn').show();
          };
          reader.readAsDataURL(file);
        }
      });
      
      // Upload logo to server
      $('#uploadLogoBtn').on('click', function() {
        const file = $('#logoUpload')[0].files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('logo', file);
        
        $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Uploading...');
        
        $.ajax({
          url: '/api/upload-logo',
          method: 'POST',
          data: formData,
          processData: false,
          contentType: false,
          success: function(response) {
            $('#uploadLogoBtn').prop('disabled', false).html('<i class="fas fa-upload"></i> Upload Logo').hide();
            showAlert('success', 'Logo berhasil diupload');
            // Update logo preview with server path
            if (response.logoPath) {
              $('#logoPreview').html('<img src="' + response.logoPath + '" style="max-width: 150px; max-height: 80px; border: 1px solid #ddd; border-radius: 4px; padding: 5px;">');
            }
          },
          error: function(xhr) {
            $('#uploadLogoBtn').prop('disabled', false).html('<i class="fas fa-upload"></i> Upload Logo');
            let errorMsg = 'Gagal upload logo';
            if (xhr.responseJSON && xhr.responseJSON.message) {
              errorMsg = xhr.responseJSON.message;
            }
            showAlert('error', errorMsg);
          }
        });
      });
      
      // Show/hide notes container based on selection
      $('#showNotes').on('change', function() {
        if ($(this).val() === 'true') {
          $('#notesContainer').show();
        } else {
          $('#notesContainer').hide();
        }
      });
      
      // Real-time preview updates
      $('#pdfTheme, #headerText, #billingTitle, #serviceTitle').on('change input', function() {
        // Could add real-time preview update here
        console.log('PDF customization changed:', $(this).attr('id'), $(this).val());
      });


      // PDF Preview functionality
      $('#previewPDFBtn').on('click', function() {
        $('#invoicePreview').html('<div class="text-center"><i class="fas fa-spinner fa-spin"></i> Generating PDF preview...</div>');
        
        // Open preview in new tab for better visibility
        const newWindow = window.open('', '_blank');
        newWindow.document.write('<html><head><title>Preview Invoice PDF</title></head><body><div style="text-align: center; padding: 50px;"><i class="fas fa-spinner fa-spin"></i> Loading preview...</div></body></html>');
        
        // Get current form values for real-time preview
        const currentSettings = {
          pdfTheme: $('#pdfTheme').val(),
          headerText: $('#headerText').val(),
          footerText: $('#footerText').val(),
          billingTitle: $('#billingTitle').val(),
          serviceTitle: $('#serviceTitle').val(),
          showCustomerID: $('#showCustomerID').val(),
          showCustomerPhone: $('#showCustomerPhone').val(),
          showServiceSpeed: $('#showServiceSpeed').val(),
          showServiceDescription: $('#showServiceDescription').val(),
          showNPWP: $('#showNPWP').val(),
          paymentMethods: $('#paymentMethods').val(),
          showNotes: $('#showNotes').val(),
          additionalNotes: $('#additionalNotes').val()
        };
        
        $.ajax({
          url: '/api/preview-pdf-invoice',
          method: 'POST',
          contentType: 'application/json',
          data: JSON.stringify({ customization: currentSettings }),
          success: function(htmlContent) {
            // Write content to new window
            newWindow.document.open();
            newWindow.document.write(htmlContent);
            newWindow.document.close();
            
            $('#invoicePreview').html('<div class="alert alert-success"><i class="fas fa-external-link-alt"></i> <strong>Preview PDF dibuka di tab baru</strong><br>Silakan periksa tab baru untuk melihat preview invoice PDF dengan pengaturan terkini.</div>');
          },
          error: function(xhr) {
            let errorMsg = 'Gagal generate preview PDF';
            if (xhr.responseJSON && xhr.responseJSON.message) {
              errorMsg = xhr.responseJSON.message;
            }
            newWindow.close();
            $('#invoicePreview').html('<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> ' + errorMsg + '</div>');
          }
        });
      });

      // Save settings
      $('#saveSettings').click(function() {
        // Disable button to prevent double-click
        $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');
        
        const settings = {
          companyName: $('#companyName').val(),
          companyAddress: $('#companyAddress').val(),
          companyPhone: $('#companyPhone').val(),
          companyEmail: $('#companyEmail').val(),
          companyNpwp: $('#companyNpwp').val(),
          companyWebsite: $('#companyWebsite').val(),
          enableTax: $('#enableTax').val(),
          taxRate: $('#taxRate').val(),
          invoicePrefix: $('#invoicePrefix').val(),
          dueDays: $('#dueDays').val(),
          autoSend: $('#autoSend').val(),
          sendPDF: $('#sendPDF').val(),
          // Bank Account Details
          bankName: $('#bankName').val(),
          bankAccountNumber: $('#bankAccountNumber').val(),
          bankAccountName: $('#bankAccountName').val(),
          bankBranch: $('#bankBranch').val(),
          paymentInstructions: $('#paymentInstructions').val(),
          // PDF Customization Settings
          pdfTheme: $('#pdfTheme').val(),
          logoUrl: $('#logoUrl').val(),
          headerText: $('#headerText').val(),
          footerText: $('#footerText').val(),
          billingTitle: $('#billingTitle').val(),
          serviceTitle: $('#serviceTitle').val(),
          showCustomerID: $('#showCustomerID').val(),
          showCustomerPhone: $('#showCustomerPhone').val(),
          showServiceSpeed: $('#showServiceSpeed').val(),
          showServiceDescription: $('#showServiceDescription').val(),
          showNPWP: $('#showNPWP').val(),
          paymentMethods: $('#paymentMethods').val(),
          showNotes: $('#showNotes').val(),
          additionalNotes: $('#additionalNotes').val()
        };
        
        // Log settings being sent for debugging
        console.log('Settings being sent:', settings);

        // Show loading modal with timeout fallback
        $('#loadingModal').modal('show');
        
        // Fallback to force hide modal after 15 seconds
        setTimeout(function() {
          if ($('#loadingModal').hasClass('show')) {
            console.warn('Force hiding stuck modal after timeout');
            hideModal();
            resetButton();
            showAlert('warning', 'Operasi mungkin berhasil, silakan refresh halaman');
          }
        }, 15000);

        $.ajax({
          url: '/api/invoice-settings',
          method: 'POST',
          contentType: 'application/json',
          data: JSON.stringify(settings),
          timeout: 10000, // 10 second timeout
          success: function(response) {
            console.log('Success response:', response);
            resetButton();
            hideModal();
            showAlert('success', 'Pengaturan berhasil disimpan');
            
            // Reload settings to update UI with saved data
            setTimeout(function() {
              loadSettings();
            }, 500);
          },
          error: function(xhr, status, error) {
            console.error('AJAX Error:', status, error, xhr);
            resetButton();
            hideModal();
            let errorMsg = 'Gagal menyimpan pengaturan';
            if (xhr.responseJSON && xhr.responseJSON.message) {
              errorMsg = xhr.responseJSON.message;
            } else if (status === 'timeout') {
              errorMsg = 'Request timeout - coba lagi';
            } else if (status === 'error') {
              errorMsg = 'Koneksi error - periksa server';
            }
            showAlert('error', errorMsg);
          }
        });
        
        function resetButton() {
          $('#saveSettings').prop('disabled', false).html('<i class="fas fa-save fa-sm text-white-50"></i> Simpan Pengaturan');
        }
        
        function hideModal() {
          try {
            // Multiple approaches to ensure modal closes
            $('#loadingModal').modal('hide');
            
            // Force hide with direct manipulation
            setTimeout(function() {
              $('#loadingModal').removeClass('show').removeClass('fade').css('display', 'none');
              $('.modal-backdrop').remove();
              $('body').removeClass('modal-open').css({
                'padding-right': '',
                'overflow': ''
              });
            }, 100);
          } catch (e) {
            console.error('Error hiding modal:', e);
          }
        }
      });

      function loadSettings() {
        console.log('Loading settings...');
        $.get('/api/invoice-settings')
        .done(function(data) {
          console.log('API Response:', data);
          console.log('Company data:', data.company);
          console.log('Invoice data:', data.invoice);
          
          // Load company data with explicit logging
          if (data.company) {
            console.log('Setting company name:', data.company.name);
            $('#companyName').val(data.company.name || '');
            $('#companyAddress').val(data.company.address || '');
            $('#companyPhone').val(data.company.phone || '');
            $('#companyEmail').val(data.company.email || '');
            $('#companyNpwp').val(data.company.npwp || '');
            $('#companyWebsite').val(data.company.website || '');
          } else {
            console.warn('No company data found');
          }
          
          // Load invoice data with explicit logging
          if (data.invoice) {
            console.log('Setting invoice data...');
            $('#enableTax').val(data.invoice.enableTax === true ? 'true' : 'false');
            $('#taxRate').val(data.invoice.taxRate || 11);
            $('#invoicePrefix').val(data.invoice.prefix || 'INV');
            $('#dueDays').val(data.invoice.dueDays || 30);
            $('#autoSend').val(data.invoice.autoSend === true ? 'true' : 'false');
            $('#sendPDF').val(data.invoice.sendPDF === false ? 'false' : 'true');
          } else {
            console.warn('No invoice data found');
          }
          
          // Load bank account details
          if (data.bankAccount) {
            $('#bankName').val(data.bankAccount.bankName || '');
            $('#bankAccountNumber').val(data.bankAccount.accountNumber || '');
            $('#bankAccountName').val(data.bankAccount.accountName || '');
            $('#bankBranch').val(data.bankAccount.branch || '');
            $('#paymentInstructions').val(data.bankAccount.paymentInstructions || '');
          }
          
          // Load logo if exists
          if (data.company && data.company.logoPath) {
            $('#logoPreview').html('<img src="' + data.company.logoPath + '" style="max-width: 150px; max-height: 80px; border: 1px solid #ddd; border-radius: 4px; padding: 5px;">');
          }
          
          // Load PDF customization settings
          if (data.pdfCustomization) {
            $('#pdfTheme').val(data.pdfCustomization.theme || 'blue');
            $('#logoUrl').val(data.pdfCustomization.logoUrl || '');
            $('#headerText').val(data.pdfCustomization.headerText || 'INVOICE');
            $('#footerText').val(data.pdfCustomization.footerText || 'Terima kasih atas kepercayaan Anda.');
            $('#billingTitle').val(data.pdfCustomization.billingTitle || 'TAGIHAN KEPADA:');
            $('#serviceTitle').val(data.pdfCustomization.serviceTitle || 'DETAIL LAYANAN:');
            $('#showCustomerID').val(data.pdfCustomization.showCustomerID === false ? 'false' : 'true');
            $('#showCustomerPhone').val(data.pdfCustomization.showCustomerPhone === false ? 'false' : 'true');
            $('#showServiceSpeed').val(data.pdfCustomization.showServiceSpeed === false ? 'false' : 'true');
            $('#showServiceDescription').val(data.pdfCustomization.showServiceDescription === false ? 'false' : 'true');
            $('#showNPWP').val(data.pdfCustomization.showNPWP === false ? 'false' : 'true');
            $('#paymentMethods').val(data.pdfCustomization.paymentMethods || 'cash_transfer');
            $('#showNotes').val(data.pdfCustomization.showNotes === false ? 'false' : 'true');
            $('#additionalNotes').val(data.pdfCustomization.additionalNotes || '');
            
            // Show/hide notes container based on showNotes value
            if (data.pdfCustomization.showNotes !== false) {
              $('#notesContainer').show();
            } else {
              $('#notesContainer').hide();
            }
          } else {
            // Set default values for PDF customization
            $('#pdfTheme').val('blue');
            $('#headerText').val('INVOICE');
            $('#footerText').val('Terima kasih atas kepercayaan Anda.');
            $('#billingTitle').val('TAGIHAN KEPADA:');
            $('#serviceTitle').val('DETAIL LAYANAN:');
            $('#showCustomerID').val('true');
            $('#showCustomerPhone').val('false');
            $('#showServiceSpeed').val('true');
            $('#showServiceDescription').val('false');
            $('#showNPWP').val('false');
            $('#paymentMethods').val('cash_transfer');
            $('#showNotes').val('false');
            $('#additionalNotes').val('');
            $('#notesContainer').hide();
          }
          
          // Toggle tax rate visibility
          toggleTaxRate();
          
          // Verify values were set
          console.log('Form values after setting:');
          console.log('Company Name:', $('#companyName').val());
          console.log('Company Address:', $('#companyAddress').val());
          console.log('Enable Tax:', $('#enableTax').val());
        })
        .fail(function(xhr, status, error) {
          console.error('Failed to load invoice settings:', status, error);
          console.error('Response:', xhr.responseText);
        });
      }

      function showAlert(type, message) {
        const alertClass = type === 'success' ? 'alert-success' : 'alert-danger';
        const alert = `<div class="alert ${alertClass} alert-dismissible fade show" role="alert">
          ${message}
          <button type="button" class="close" data-dismiss="alert">
            <span>&times;</span>
          </button>
        </div>`;
        
        $('.container-fluid').prepend(alert);
        setTimeout(() => $('.alert').alert('close'), 5000);
      }
    });
  </script>
</body>
</html>
