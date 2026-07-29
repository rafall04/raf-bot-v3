/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/pembayaran/teknisi.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/pembayaran/teknisi.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

    // Safeguard: keep <body>.modal-open while any modal is still shown (BS4 stacked-modal fix).
    $(document).on('hidden.bs.modal', function () {
      if ($('.modal.show').length) { $('body').addClass('modal-open'); }
    });

    $(document).ready(function() {
      const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 });
      let activeMonthFilter = 'this_month'; 
      let loggedInUserId = null; 

      fetch('/api/me', { credentials: 'include' }) 
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.json();
        })
        .then(apiResponse => {
          if (apiResponse && apiResponse.status === 200 && apiResponse.data) {
            $('#loggedInTechnicianInfo').text(apiResponse.data.username);
            loggedInUserId = String(apiResponse.data.id); // Simpan ID teknisi sebagai string untuk perbandingan
            console.log('[TEKNISI_AUTH] Logged in as:', apiResponse.data.username, 'ID:', apiResponse.data.id);
          } else {
            $('#loggedInTechnicianInfo').text('Teknisi'); 
            console.warn("[TEKNISI_AUTH] Unexpected response from /api/me", apiResponse);
          }
        })
        .catch(error => {
          $('#loggedInTechnicianInfo').text('Teknisi'); 
          console.error("[TEKNISI_AUTH] Error fetching /api/me:", error);
          // Show alert if authentication fails
          if (error.message.includes('401')) {
            displayGlobalTechnicianMessage('Sesi login telah berakhir. Silakan login kembali.', 'danger');
            setTimeout(() => window.location.href = '/login', 2000);
          }
        });

      function displayGlobalTechnicianMessage(message, type = 'info') {
        const globalMessageDiv = document.getElementById('globalTechnicianMessage');
        globalMessageDiv.innerHTML = `<div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="close" data-dismiss="alert" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        </div>`;
        setTimeout(() => { if (globalMessageDiv.querySelector('.alert')) $(globalMessageDiv.querySelector('.alert')).alert('close'); }, 7000);
      }
      
      function showMessageModal(title, message, type = 'info', autoHideDelay = 3000) {
        $('#messageModalTitle').text(title);
        // Sanitize HTML to prevent XSS - only allow safe tags
        const sanitizedMessage = DOMPurify ? DOMPurify.sanitize(message, {
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'br', 'ul', 'li', 'p'],
            ALLOWED_ATTR: []
        }) : $('<div>').text(message).html();
        $('#messageModalText').html(sanitizedMessage);
        const iconContainer = $('#messageModalIconContainer');
        iconContainer.empty(); 
        let iconClass = 'modal-icon ';
        let titleDefault = 'Pemberitahuan';
        switch (type) {
          case 'success': iconClass += 'fas fa-check-circle text-success'; titleDefault = 'Sukses!'; break;
          case 'error': iconClass += 'fas fa-times-circle text-danger'; titleDefault = 'Error!'; break;
          case 'warning': iconClass += 'fas fa-exclamation-triangle text-warning'; titleDefault = 'Peringatan!'; break;
          default: iconClass += 'fas fa-info-circle text-info';
        }
        $('#messageModalTitle').text(title || titleDefault);
        iconContainer.append($('<i>', { class: iconClass }));
        $('#messageModalOkBtn').removeClass('btn-success btn-danger btn-warning btn-info').addClass('btn-primary');
        $('#messageModalOkBtn').off('click').on('click', function() { $('#messageModal').modal('hide'); });
        $('#messageModal').modal('show');
        if (autoHideDelay > 0) {
          setTimeout(() => {
            if ($('#messageModal').hasClass('show')) { $('#messageModal').modal('hide'); }
          }, autoHideDelay);
        }
      }

      function showConfirmationModal(message, onConfirmCallback, onCancelCallback) {
        // Use text() instead of html() for confirmation messages to prevent XSS
        $('#confirmationModalMessage').text(message);
        $('#confirmationModalConfirmBtn').off('click').on('click', function() {
          $('#confirmationModal').modal('hide');
          if (typeof onConfirmCallback === 'function') { onConfirmCallback(); }
        });
        $('#confirmationModalCancelBtn').off('click').on('click', function() {
          $('#confirmationModal').modal('hide');
          if (typeof onCancelCallback === 'function') { onCancelCallback(); }
        });
        $('#confirmationModal').modal('show');
      }
      
      function calculateAndDisplayTechnicianApprovedIncome(api) {
        if (activeMonthFilter !== 'this_month') {
            $('#technicianMonthlyIncomeCard').hide();
            return;
        }

        const now = new Date();
        const periodMonth = now.getMonth() + 1;
        const periodYear = now.getFullYear();
        const incomePeriodDisplayStr = new Date(periodYear, periodMonth - 1, 1).toLocaleString('id-ID', { month: 'long', year: 'numeric' });

        fetch('/api/technician-settlement/summary?month=' + periodMonth + '&year=' + periodYear, { credentials: 'include' })
          .then((res) => res.json())
          .then((payload) => {
            const summary = payload && payload.data && payload.data.summary ? payload.data.summary : {};
            const commissionPerCustomer = payload && payload.data ? (payload.data.commission_per_customer || 0) : 0;
            const totalCredit = summary.total_credit || 0;
            const totalDebit = summary.total_debit || 0;
            const netTotal = summary.net_total || 0;
            const uniquePaidCustomers = summary.unique_paid_customers || 0;
            const entryCount = summary.entry_count || 0;

            $('#technicianIncomeCardTitle').text('Ringkasan Komisi Collection Anda (Bulan Ini)');
            $('#totalPositiveIncome').text(rupiah.format(totalCredit));
            $('#countSudahBayar').text(uniquePaidCustomers + ' pelanggan lunas @ ' + rupiah.format(commissionPerCustomer));
            $('#totalNegativeIncome').text(rupiah.format(totalDebit));
            $('#countBelumBayar').text(entryCount + ' entry settlement');

            const $netIncome = $('#totalTechnicianIncomeValue');
            $netIncome.text(rupiah.format(netTotal));
            $netIncome.removeClass('text-success text-danger text-muted');
            if (netTotal > 0) {
                $netIncome.addClass('text-success');
            } else if (netTotal < 0) {
                $netIncome.addClass('text-danger');
            } else {
                $netIncome.addClass('text-muted');
            }

            $('#technicianIncomePeriodText').text(incomePeriodDisplayStr);
            $('#technicianMonthlyIncomeCard').show();
          })
          .catch((error) => {
            console.error('[TEKNISI_SETTLEMENT_SUMMARY_ERROR]', error);
            $('#technicianMonthlyIncomeCard').hide();
          });
      }

      $.fn.dataTable.ext.search.push(
        function(settings, data, dataIndex) {
          if (settings.nTable.id !== 'dataTable') { return true; }
          if (activeMonthFilter === 'all_months') { return true; }
          
          const now = new Date();
          const currentMonth = now.getMonth();
          const currentYear = now.getFullYear();
          
          // Kolom 'Tgl Request' adalah kolom ke-2 (indeks 2)
          const createdAtString = data[2]; // Ambil data dari kolom 'Tgl Request' yang sudah diformat
          if (!createdAtString || createdAtString === '-') return false;

          // Perlu parsing manual karena formatnya 'DD Mmm YYYY, HH:mm'
          // Kita hanya butuh bulan dan tahun untuk filter 'this_month'
          const parts = createdAtString.split(' '); // ["DD", "Mmm", "YYYY,", "HH:mm"]
          if (parts.length < 3) return false;

          const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
          const requestMonth = monthNames.indexOf(parts[1]);
          const requestYear = parseInt(parts[2].replace(',', ''), 10);

          if (requestMonth !== -1 && !isNaN(requestYear) &&
              requestMonth === currentMonth &&
              requestYear === currentYear) {
            return true;
          }
          return false; 
        }
      );

      const dataTable = $('#dataTable').DataTable({
        ajax: {
            url: '/api/requests', 
            dataSrc: 'data',
            error: function (jqXHR, textStatus, errorThrown) {
                console.error("DataTables AJAX error (/api/requests):", textStatus, errorThrown, jqXHR.responseText);
                displayGlobalTechnicianMessage("Gagal memuat daftar pengajuan Anda. Silakan coba refresh halaman.", "danger");
            }
        },
        language: { 
            "sEmptyTable": "Tidak ada data pengajuan yang tersedia",
            "sProcessing": "Sedang memproses...",
            "sLengthMenu": "Tampilkan _MENU_ pengajuan",
            "sZeroRecords": "Tidak ditemukan pengajuan yang sesuai",
            "sInfo": "Menampilkan _START_ sampai _END_ dari _TOTAL_ pengajuan",
            "sInfoEmpty": "Menampilkan 0 sampai 0 dari 0 pengajuan",
            "sInfoFiltered": "(disaring dari _MAX_ total pengajuan)",
            "sSearch": "Cari:",
            "oPaginate": { "sFirst": "Pertama", "sPrevious": "Sebelumnya", "sNext": "Berikutnya", "sLast": "Terakhir" }
        },
        columns: [
          { data: 'userName', title: 'Nama Pelanggan', defaultContent: '-' }, 
          { data: null, title: 'Paket', defaultContent: '-', render: function(data, type, row) { return `${row.packageName || 'N/A'} (${rupiah.format(row.packagePrice || 0)})`; } },
          { data: 'created_at', title: 'Tgl Request', defaultContent: '-', render: function(data) { return data ? new Date(data).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour:'2-digit', minute:'2-digit' }) : '-'; } },
          { data: 'newStatus', title: 'Status Diajukan', defaultContent: '-', render: function(data){ return data === true ? 'Sudah Bayar' : (data === false ? 'Belum Bayar' : '-');}},
          { 
            data: 'status', title: 'Status Request',
            defaultContent: '-', 
            render: function(status) { 
                let statusClass = '', statusText = '';
                if (status === "approved") { statusClass = 'badge-success'; statusText = 'Disetujui'; }
                else if (status === "pending") { statusClass = 'badge-warning'; statusText = 'Menunggu'; }
                else if (status === "rejected") { statusClass = 'badge-danger'; statusText = 'Ditolak'; }
                else if (status === "cancelled_by_technician") { statusClass = 'badge-secondary'; statusText = 'Dibatalkan Anda'; }
                else if (status === "cancelled_by_system") { statusClass = 'badge-info'; statusText = 'Dibatalkan Sistem'; }
                else { statusClass = 'badge-dark'; statusText = status || '-'; }
                return `<span class="badge badge-pill ${statusClass}">${statusText}</span>`;
            } 
          },
          { data: 'updated_at', title: 'Diperbarui Pada', defaultContent: '-', render: function(data) { return data ? new Date(data).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'; } },
          { data: 'updated_by_name', title: 'Diperbarui Oleh', defaultContent: '-' },
          { 
            data: null, title: 'Aksi', orderable: false, className: 'action-buttons text-center',
            defaultContent: '-', 
            render: function(data, type, row) {
                if (row.status === 'pending' && loggedInUserId && String(row.requested_by_teknisi_id) === loggedInUserId) {
                    return `<button class="btn btn-sm btn-danger btn-cancel-request" data-id="${row.id}" title="Batalkan Pengajuan Ini"><i class="fas fa-times-circle"></i> Batalkan</button>`;
                }
                return '-';
            }
          }
        ],
        order: [[2, 'desc']], 
        processing: true,
        drawCallback: function(settings) {
            const api = this.api();
            calculateAndDisplayTechnicianApprovedIncome(api);
        }
      });

      $('#monthFilterSelect').on('change', function() {
        activeMonthFilter = $(this).val(); 
        dataTable.draw(); 
        const titleText = activeMonthFilter === 'this_month' ? 'Daftar Pengajuan Anda (Bulan Ini)' : 'Daftar Pengajuan Anda (Semua Bulan)';
        $('#dataTableCardTitle').text(titleText);
      });
      
      fetch("/api/users", { credentials: 'include' })
        .then(res => {
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          return res.json();
        })
        .then(response => {
            const users = response.data || response; 
            const select = document.getElementById('user-select');
            if (select && users && Array.isArray(users)) {
                select.innerHTML = '<option value="">-- Pilih Pelanggan --</option>'; // Placeholder
                // Filter dan sort users
                const validUsers = users.filter(u => u && u.id);
                validUsers.sort((a,b) => (a.name || '').localeCompare(b.name || '')).forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.id; 
                    const statusText = user.paid ? 'Sudah Bayar' : 'Belum Bayar';
                    const packageText = user.subscription ? ` - ${user.subscription}` : '';
                    option.textContent = `${user.name || `User ID ${user.id}`}${packageText} (${statusText})`; 
                    select.appendChild(option);
                });
                console.log(`[TEKNISI_USERS] Loaded ${validUsers.length} users`);
                $('#user-select').select2({
                    dropdownParent: $('#requestModal'),
                    placeholder: 'Cari nama atau paket pelanggan...',
                    width: '100%'
                });
            } else {
                if (select) select.innerHTML = '<option value="">Tidak ada data pelanggan</option>';
                console.warn('[TEKNISI_USERS] No users data or invalid format:', response);
            }
        })
        .catch(error => { 
            console.error("[TEKNISI_USERS] Error fetching users:", error);
            const select = document.getElementById('user-select');
            if (select) select.innerHTML = '<option value="">Error: Gagal memuat pelanggan</option>';
            displayGlobalTechnicianMessage('Gagal memuat daftar pelanggan. Silakan refresh halaman.', 'warning');
        });

      document.getElementById('request-form').addEventListener('submit', function(e) {
        e.preventDefault();
        const userId = document.getElementById('user-select').value;
        const newStatusIsPaid = document.getElementById('new-status').value === 'true'; 
        if (!userId) {
            showMessageModal("Peringatan", "Silakan pilih pelanggan terlebih dahulu.", "warning");
            return;
        }
        
        // Get selected user info for confirmation
        const selectedOption = document.getElementById('user-select').selectedOptions[0];
        const customerName = selectedOption ? selectedOption.textContent : 'Pelanggan';
        const statusText = newStatusIsPaid ? 'SUDAH BAYAR (CASH)' : 'BELUM BAYAR';
        
        // Show confirmation before submit
        const confirmMessage = `Anda akan mengajukan perubahan status pembayaran:\n\n` +
            `Pelanggan: ${customerName.split(' (')[0]}\n` +
            `Status Baru: ${statusText}\n\n` +
            (newStatusIsPaid ? '💵 Metode pembayaran akan dicatat sebagai CASH karena diterima langsung oleh teknisi.\n\n' : '') +
            `Lanjutkan pengajuan ini?`;
        
        showConfirmationModal(confirmMessage, function() {
            // User confirmed, proceed with submission
            const submitButton = $('#request-form button[type="submit"]');
            const originalButtonText = submitButton.html();
            submitButton.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Mengajukan...');
            
            fetch('/api/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }, 
                credentials: 'include',
                body: JSON.stringify({ userId: userId, newStatus: newStatusIsPaid }) 
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(errData => { throw new Error(errData.message || `Server error: ${response.status}`); })
                                     .catch(() => { throw new Error(`Server error: ${response.status}`); });
                }
                return response.json();
            })
            .then(data => {
                showMessageModal("Pengajuan Terkirim", data.message || "Permintaan perubahan status Anda telah diterima.", "success", 3500); 
                dataTable.ajax.reload(null, false); 
            })
            .catch(error => {
                showMessageModal("Error Pengajuan", error.message || 'Terjadi kesalahan saat mengajukan perubahan.', "error");
            })
            .finally(() => {
                submitButton.prop('disabled', false).html(originalButtonText);
                $('#requestModal').modal('hide');
                document.getElementById('request-form').reset();
                $('#user-select').val('').trigger('change');
            });
        });
      });

      $('#dataTable tbody').on('click', '.btn-cancel-request', function () {
        const requestId = $(this).data('id');
        const rowData = dataTable.row($(this).parents('tr')).data(); // Get data for the row

        let confirmationMsg = `Apakah Anda yakin ingin membatalkan pengajuan untuk pelanggan *${rowData.userName}*?`;
        if (rowData.newStatus === true) confirmationMsg += `\nStatus yang diajukan adalah: *Sudah Bayar*.`;
        else confirmationMsg += `\nStatus yang diajukan adalah: *Belum Bayar*.`;
        confirmationMsg += `\n\nTindakan ini tidak dapat diurungkan.`;


        showConfirmationModal(confirmationMsg, async function() {
            try {
                const response = await fetch('/api/requests/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify({ requestId: String(requestId) }) // Pastikan requestId adalah string
                });
                const result = await response.json();
                if (response.ok && result.status === 200) {
                    displayGlobalTechnicianMessage(result.message, 'success');
                    dataTable.ajax.reload(null, false); 
                } else {
                    displayGlobalTechnicianMessage(result.message || 'Gagal membatalkan pengajuan.', 'danger');
                }
            } catch (error) {
                console.error('Error cancelling request:', error);
                displayGlobalTechnicianMessage('Terjadi kesalahan koneksi saat membatalkan pengajuan.', 'danger');
            }
        });
      });
      
      $('#dataTableCardTitle').text('Daftar Pengajuan Anda (Bulan Ini)');
    });
  
