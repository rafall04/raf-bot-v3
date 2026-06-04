<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="Halaman Teknisi untuk Pengajuan Pembayaran dan Manajemen Tiket">
  <meta name="author" content="RAF BOT">
  <title>Teknisi - Pengajuan & Manajemen Tiket</title>

  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
  <link href="/css/teknisi-theme.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <style>
    body {
      background-color: #f8f9fc;
      font-family: 'Nunito', sans-serif;
    }
    .btn, button, a.dropdown-item {
      transition: all 0.2s ease-in-out;
    }
    .topbar {
      box-shadow: 0 0.1rem 0.5rem rgba(0, 0, 0, 0.075) !important;
    }
    .img-profile {
      border: 2px solid #e3e6f0;
    }
    .container-fluid > .h1.mb-2,
    .container-fluid > .h3.mb-2 {
      font-weight: 700;
      color: #3a3b45;
      margin-bottom: 2rem !important;
    }
    .filter-controls {
      margin-bottom: 1.5rem;
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .filter-controls .form-group {
        flex: 1;
        min-width: 200px;
    }
    .filter-controls .form-label {
      margin-bottom: .5rem;
      font-size: 0.9em;
      font-weight: 600;
      color: #5a5c69;
    }
    .filter-controls .form-control-sm {
      border-radius: 0.5rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.04);
      border: 1px solid #d1d3e2;
      font-size: 0.875rem;
      padding: 0.4rem 0.75rem;
    }
    .filter-controls .form-control-sm:focus {
      border-color: #4e73df;
      box-shadow: 0 0 0 0.2rem rgba(78, 115, 223, 0.15);
    }
    /* Cards, card headers, modals & tables are governed by teknisi-theme.css
       for cross-page consistency (was a divergent blue-gradient header here). */
    #dataTable td, #dataTable th { vertical-align: middle; font-size: 0.85rem; }
    .badge-pill { padding: 0.5em 0.8em; font-size: 0.78em; font-weight: 500; }
    .custom-modal-body { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2.5rem; min-height: 180px; text-align: center; }
    .custom-modal-body .modal-icon { font-size: 4rem; margin-bottom: 1.25rem; }
    .custom-modal-body #messageModalTitle { font-size: 1.4rem; font-weight: 600; color: #3a3b45; }
    .custom-modal-body #messageModalText { font-size: 1rem; color: #5a5c69; margin-bottom: 1.5rem; }
    .custom-modal-body #messageModalOkBtn { min-width: 100px; }
    .scroll-to-top { background-color: rgba(78,115,223,0.9); border-radius: 0.5rem; }
    .scroll-to-top:hover { background-color: #4e73df; }
    .action-buttons .btn {
        margin-right: 5px;
        margin-bottom: 5px; /* Tambahkan margin bawah jika tombol bisa wrap */
    }
  </style>
</head>

<body id="page-top">
  <div id="wrapper">
        <?php include '../_navbar_teknisi.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
          <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
              <i class="fa fa-bars"></i>
          </button>
          <ul class="navbar-nav ml-auto align-items-center">
            <li class="nav-item mr-1">
              <button type="button" id="tkThemeToggle" class="tk-theme-toggle" title="Mode gelap / terang" aria-label="Ganti mode gelap/terang">
                <i class="fas fa-moon"></i>
              </button>
            </li>
            <li class="nav-item dropdown no-arrow">
              <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                <span id="loggedInTechnicianInfo" class="mr-2 text-gray-600 small">Memuat nama...</span>
                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
              </a>
              <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                  <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                  Logout
                </a>
              </div>
            </li>
          </ul>
        </nav>

        <div class="container-fluid">
          <div class="tk-page-head">
            <div class="tk-title">
              <span class="tk-title-icon"><i class="fas fa-file-invoice-dollar"></i></span>
              <div>
                <h1>Request Pembayaran</h1>
                <p class="tk-subtitle">Ajukan perubahan status pembayaran pelanggan & lihat riwayat pengajuan</p>
              </div>
            </div>
          </div>
          <div id="globalTechnicianMessage" class="mb-3"></div>


          <div class="row filter-controls">
            <div class="form-group col-md-4">
              <label for="monthFilterSelect" class="form-label">Filter Bulan Pengajuan:</label>
              <select id="monthFilterSelect" class="form-control form-control-sm">
                <option value="this_month" selected>Bulan Ini</option>
                <option value="all_months">Semua Bulan</option>
              </select>
            </div>
          </div>

          <div class="card shadow mb-4" id="technicianMonthlyIncomeCard" style="display: none;">
            <div class="card-header py-3">
              <h6 id="technicianIncomeCardTitle" class="m-0 font-weight-bold">Ringkasan Komisi Collection Anda (Bulan Ini)</h6>
            </div>
            <div class="card-body">
              <p class="mb-1">Periode: <strong id="technicianIncomePeriodText">Bulan Ini</strong></p>
              <div class="row">
                <div class="col-md-4">
                  <p class="mb-1 text-success">Total Kredit Komisi:</p>
                  <p class="h6 text-success font-weight-bold" id="totalPositiveIncome">Rp 0</p>
                  <small class="text-muted" id="countSudahBayar">0 request</small>
                </div>
                <div class="col-md-4">
                  <p class="mb-1 text-danger">Total Debit Reversal:</p>
                  <p class="h6 text-danger font-weight-bold" id="totalNegativeIncome">Rp 0</p>
                  <small class="text-muted" id="countBelumBayar">0 request</small>
                </div>
                <div class="col-md-4">
                  <p class="mb-1 text-primary">Nett Komisi:</p>
                  <p class="h5 font-weight-bold" id="totalTechnicianIncomeValue">Rp 0</p>
                  <small class="text-muted">Settlement final</small>
                </div>
              </div>
            </div>
          </div>

          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <div class="d-flex" style="justify-content: space-between; align-items: center;">
                <h6 class="m-0 font-weight-bold" id="dataTableCardTitle">Daftar Pengajuan Anda (Bulan Ini)</h6>
                <button data-toggle="modal" data-target="#requestModal" class="btn btn-light"> <i class="fas fa-plus-circle mr-1"></i> Buat Pengajuan Baru</button>
              </div>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover" id="dataTable" width="100%" cellspacing="0">
                  <thead>
                    <tr> 
                        <th>Nama Pelanggan</th> 
                        <th>Paket</th> 
                        <th>Tgl Request</th> 
                        <th>Status Diajukan</th>
                        <th>Status Request</th> 
                        <th>Diperbarui Pada</th> 
                        <th>Diperbarui Oleh</th>
                        <th style="min-width: 100px;">Aksi</th>
                    </tr>
                  </thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
      <footer class="sticky-footer bg-white"> <div class="container my-auto"> <div class="copyright text-center my-auto"> <span>Copyright &copy; RAF BOT WIFI 2025</span> </div> </div> </footer>
    </div>
  </div>
  <a class="scroll-to-top rounded" href="#page-top"> <i class="fas fa-angle-up"></i> </a>

  <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true"> <div class="modal-dialog modal-dialog-centered" role="document"> <div class="modal-content"> <div class="modal-header"> <h5 class="modal-title" id="exampleModalLabel">Siap untuk Keluar?</h5> <button class="close" type="button" data-dismiss="modal" aria-label="Close"> <span aria-hidden="true">&times;</span> </button> </div> <div class="modal-body">Pilih "Logout" di bawah ini jika Anda siap untuk mengakhiri sesi Anda saat ini.</div> <div class="modal-footer"> <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button> <a class="btn btn-primary" href="/logout">Logout</a> </div> </div> </div> </div>
  <div class="modal fade" id="requestModal" data-backdrop="static" tabindex="-1"> <div class="modal-dialog modal-dialog-centered"> <form class="modal-content" id="request-form"> <div class="modal-header"> <h5 class="modal-title" id="createModalTitle">Buat Pengajuan Perubahan Status Pembayaran</h5> <button type="button" class="close" data-dismiss="modal" aria-label="Close"> <span aria-hidden="true">&times;</span> </button> </div> <div class="modal-body"> <div class="mb-3"> <label for="user-select" class="form-label">Pilih Pelanggan:</label> <select name="user-select" id="user-select" class="form-control" required></select> </div> <div class="mb-3"> <label for="new-status" class="form-label">Status Pembayaran yang Diajukan:</label> <select name="new-status" id="new-status" class="form-control" required> <option value="true">Sudah Bayar</option> <option value="false">Belum Bayar</option> </select> </div> </div> <div class="modal-footer"> <button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Batal</button> <button type="submit" class="btn btn-primary">Ajukan Perubahan</button> </div> </form> </div> </div>
  <div class="modal fade" id="confirmationModal" tabindex="-1" role="dialog" aria-labelledby="confirmationModalLabel" aria-hidden="true"> <div class="modal-dialog modal-dialog-centered" role="document"> <div class="modal-content"> <div class="modal-header"> <h5 class="modal-title" id="confirmationModalLabel">Konfirmasi Tindakan</h5> <button type="button" class="close" data-dismiss="modal" aria-label="Close"> <span aria-hidden="true">&times;</span> </button> </div> <div class="modal-body"> <p id="confirmationModalMessage">Apakah Anda yakin?</p> </div> <div class="modal-footer"> <button type="button" class="btn btn-secondary" data-dismiss="modal" id="confirmationModalCancelBtn">Batal</button> <button type="button" class="btn btn-primary" id="confirmationModalConfirmBtn">Yakin</button> </div> </div> </div> </div>
  <div class="modal fade" id="messageModal" tabindex="-1" role="dialog" aria-labelledby="messageModalLabel" aria-hidden="true"> <div class="modal-dialog modal-dialog-centered" role="document"> <div class="modal-content"> <div class="modal-body custom-modal-body"> <div id="messageModalIconContainer" class="modal-icon"></div> <h5 id="messageModalTitle" class="mt-2 mb-1">Pemberitahuan</h5> <p id="messageModalText"></p> <button type="button" class="btn btn-primary mt-3" data-dismiss="modal" id="messageModalOkBtn">OK</button> </div> </div> </div> </div>

  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>


  <script>
    // Dark / light mode toggle (shared behaviour; this page has a custom topbar)
    (function () {
      function syncIcon() {
        var icon = document.querySelector('#tkThemeToggle i');
        if (icon) { icon.className = document.body.classList.contains('tk-dark') ? 'fas fa-sun' : 'fas fa-moon'; }
      }
      syncIcon();
      document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('#tkThemeToggle');
        if (!btn) { return; }
        var isDark = document.body.classList.toggle('tk-dark');
        try { localStorage.setItem('tkTheme', isDark ? 'dark' : 'light'); } catch (err) {}
        syncIcon();
      });
    })();

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
  </script>
</body>
</html>