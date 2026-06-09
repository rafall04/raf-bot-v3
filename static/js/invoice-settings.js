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
