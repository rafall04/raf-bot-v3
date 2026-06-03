<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <title>RAF BOT - Otorisasi Pengajuan Pembaruan Status</title>

  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <!-- SweetAlert2 for modern popups -->
  <link href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css" rel="stylesheet">
  <style>
    /* Simplified modern popup styling */
    .swal2-popup {
      border-radius: 12px;
      font-family: 'Nunito', sans-serif;
    }
    .swal2-title {
      font-size: 1.5rem;
      font-weight: 600;
      color: #4a5568;
    }
    .swal2-confirm {
      background: #667eea;
      border-radius: 8px;
      font-weight: 600;
      padding: 10px 24px;
    }
    .swal2-confirm:hover {
      background: #5a67d8;
    }
    .swal2-cancel {
      background: #6c757d;
      border-radius: 8px;
      font-weight: 600;
      padding: 10px 24px;
    }
    .swal2-cancel:hover {
      background: #5a6268;
    }
    /* Loading overlay style */
    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      backdrop-filter: blur(5px);
    }
    .loading-content {
      background: white;
      padding: 30px;
      border-radius: 15px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    }
    .loading-spinner {
      width: 60px;
      height: 60px;
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    /* Simple transitions */
    .btn, .form-control {
      transition: background-color 0.2s ease;
    }
    /* Toast notification style */
    .toast-custom {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      min-width: 300px;
    }
    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      .swal2-popup {
        background: #2d3748;
        color: #e2e8f0;
      }
      .swal2-title {
        color: #e2e8f0;
      }
      .swal2-content {
        color: #cbd5e0;
      }
      .swal2-html-container {
        color: #cbd5e0;
      }
      .swal2-input {
        background: #1a202c;
        color: #e2e8f0;
        border-color: #4a5568;
      }
      .swal2-html-container::-webkit-scrollbar-track {
        background: #2d3748;
      }
    }
    
    /* Responsive adjustments */
    @media (max-width: 768px) {
      .swal2-popup {
        width: 95% !important;
        margin: 10px !important;
        max-width: 100% !important;
      }
      .swal2-title {
        font-size: 1.3rem;
      }
      .swal2-content {
        font-size: 0.95rem;
      }
      .swal2-confirm, .swal2-cancel {
        padding: 10px 20px;
        font-size: 0.85rem;
      }
      .swal2-actions {
        flex-direction: column;
        gap: 10px;
      }
      .swal2-confirm, .swal2-cancel {
        width: 100%;
      }
      .toast-custom {
        right: 10px;
        left: 10px;
        min-width: auto;
      }
    }
    
    @media (max-width: 480px) {
      .swal2-popup {
        border-radius: 15px;
      }
      .swal2-html-container {
        max-height: 50vh;
      }
    }
  </style>
</head>

<body id="page-top">
  <div id="wrapper">
    <?php include '../_navbar.php'; ?>
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
          <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Otorisasi Pembayaran</h1>
            <p>Setujui atau tolak pengajuan perubahan status pembayaran dari teknisi</p>
          </div>
          
          <!-- Income Summary by Teknisi (Only shown when filtered) -->
          <div id="incomeByTeknisiCard" class="card table-card mb-4" style="display: none;">
            <div class="card-header">
              <h6>Settlement Komisi Teknisi <span id="incomeFilterPeriod"></span></h6>
              <small class="text-muted">
                <i class="fas fa-info-circle"></i> 
                Kredit komisi bertambah saat pelanggan periode berjalan final lunas, dan reversal otomatis membuat debit saat status dikembalikan ke belum bayar.
              </small>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-sm table-hover">
                  <thead>
                    <tr>
                      <th>Teknisi</th>
                      <th class="text-right">Total Nett</th>
                      <th class="text-center text-success">Tambah (+)</th>
                      <th class="text-center text-danger">Kurang (-)</th>
                      <th class="text-center">Detail Request</th>
                    </tr>
                  </thead>
                  <tbody id="incomeByTeknisiBody">
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          
          <!-- Statistics Cards -->
          <h4 class="dashboard-section-title">Statistik</h4>
          <div class="row match-height mb-4">
            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card dashboard-card card-primary">
                <div class="card-body">
                  <div class="card-content">
                    <div class="card-info">
                      <div class="card-title-text">Total Requests</div>
                      <div class="card-value" id="totalRequests">0</div>
                      <div class="card-subtitle">
                        <i class="fas fa-circle" style="font-size: 8px;"></i>
                        <span>Semua</span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-clipboard-list"></i>
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
                      <div class="card-title-text">Pending</div>
                      <div class="card-value" id="pendingRequests">0</div>
                      <div class="card-subtitle">
                        <span class="card-change warning">
                          <i class="fas fa-clock"></i> Waiting
                        </span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-clock"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card dashboard-card card-success">
                <div class="card-body">
                  <div class="row no-gutters align-items-center">
                    <div class="col mr-2">
                      <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Approved</div>
                      <div class="h5 mb-0 font-weight-bold text-gray-800" id="approvedRequests">0</div>
                    </div>
                    <div class="col-auto">
                      <i class="fas fa-check-circle fa-2x text-gray-300"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card border-left-danger shadow h-100 py-2">
                <div class="card-body">
                  <div class="row no-gutters align-items-center">
                    <div class="col mr-2">
                      <div class="text-xs font-weight-bold text-danger text-uppercase mb-1">Rejected</div>
                      <div class="h5 mb-0 font-weight-bold text-gray-800" id="rejectedRequests">0</div>
                    </div>
                    <div class="col-auto">
                      <i class="fas fa-times-circle fa-2x text-gray-300"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Filter Card -->
          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <h6 class="m-0 font-weight-bold text-primary">Filter & Actions</h6>
            </div>
            <div class="card-body">
              <div class="row">
                <div class="col-md-2">
                  <label for="filterStatus">Status:</label>
                  <select id="filterStatus" class="form-control">
                    <option value="">Semua Status</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
                <div class="col-md-2">
                  <label for="filterTeknisi">Teknisi:</label>
                  <select id="filterTeknisi" class="form-control">
                    <option value="">Semua Teknisi</option>
                  </select>
                </div>
                <div class="col-md-2">
                  <label for="filterMonth">Bulan:</label>
                  <input type="month" id="filterMonth" class="form-control">
                </div>
                <div class="col-md-2">
                  <label for="filterDateFrom">Dari Tanggal:</label>
                  <input type="date" id="filterDateFrom" class="form-control">
                </div>
                <div class="col-md-2">
                  <label for="filterDateTo">Sampai Tanggal:</label>
                  <input type="date" id="filterDateTo" class="form-control">
                </div>
                <div class="col-md-2">
                  <label for="autoRefresh">Auto Refresh:</label>
                  <select id="autoRefresh" class="form-control">
                    <option value="0">Disabled</option>
                    <option value="10">10 detik</option>
                    <option value="30">30 detik</option>
                    <option value="60">1 menit</option>
                  </select>
                </div>
              </div>
              <div class="row mt-3">
                <div class="col-md-12">
                  <button id="applyFilter" class="btn btn-primary">
                    <i class="fas fa-filter"></i> Apply Filter
                  </button>
                  <button id="clearFilter" class="btn btn-secondary">
                    <i class="fas fa-undo"></i> Clear Filter
                  </button>
                  <button id="bulkApprove" class="btn btn-success" disabled style="display: none;">
                    <i class="fas fa-check-double"></i> Approve All Pending Bulan Ini (<span id="pendingCount">0</span>)
                  </button>
                  <button id="exportData" class="btn btn-info">
                    <i class="fas fa-download"></i> Export to CSV
                  </button>
                </div>
              </div>
              <div class="row mt-3">
                <div class="col-md-12">
                  <div class="alert alert-info mb-0">
                    <strong>Total Nilai Nett:</strong> 
                    <span id="totalValue">Rp 0</span> | 
                    <strong>Pending (Potensi):</strong> <span id="pendingValue">Rp 0</span> | 
                    <strong>Settlement (Nett):</strong> <span id="approvedValue">Rp 0</span>
                    <br>
                    <small class="text-muted">
                      <i class="fas fa-info-circle"></i> 
                      Settlement Nett = kredit komisi teknisi dikurangi debit reversal pada periode filter aktif
                    </small>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <h6 class="m-0 font-weight-bold text-primary">Semua pengajuan</h6>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered" id="dataTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Nama Teknisi (Requestor)</th>
                      <th>Nama Pelanggan</th>
                      <th>Paket</th>
                      <th>Tanggal Request</th>
                      <th>Status Pengajuan</th>
                      <th>Diperbarui Pada</th>
                      <th>Diperbarui Oleh (Admin)</th>
                      <th>Action</th>
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
        <div class="container my-auto">
          <div class="copyright text-center my-auto">
            <span>Copyright &copy; RAF BOT 2024</span>
          </div>
        </div>
      </footer>
    </div>
  </div>

  <a class="scroll-to-top rounded" href="#page-top">
    <i class="fas fa-angle-up"></i>
  </a>

  <!-- Logout Modal-->
  <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
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

  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
  <!-- SweetAlert2 -->
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

  <script>
  $(document).ready(async function() {
    console.log("[FIXED] Document ready");
    
    // Global config variable for tanggal_isolir
    let tanggalIsolir = 10; // Default value
    
    async function loadApprovalConfig() {
      try {
        const response = await $.ajax({
          url: '/api/config',
          type: 'GET'
        });
        if (response && response.tanggal_isolir) {
          tanggalIsolir = parseInt(response.tanggal_isolir, 10);
          console.log('[CONFIG] tanggal_isolir loaded:', tanggalIsolir);
        }
      } catch (err) {
        console.warn('[CONFIG] Failed to load config, using default tanggal_isolir:', tanggalIsolir);
      }
    }
    
    await loadApprovalConfig();
    
    // Function to check if current date is on or after isolation date
    function isAfterIsolationDate() {
      const currentDate = new Date().getDate();
      return currentDate >= tanggalIsolir;
    }

    function getRequestScopeMonth(row) {
      const periodMonth = parseInt(row.period_month, 10);
      const periodYear = parseInt(row.period_year, 10);
      if (Number.isInteger(periodMonth) && Number.isInteger(periodYear)) {
        return periodYear + '-' + String(periodMonth).padStart(2, '0');
      }

      const requestDate = new Date(row.updated_at || row.created_at || Date.now());
      return requestDate.getFullYear() + '-' + String(requestDate.getMonth() + 1).padStart(2, '0');
    }
    
    // Configure SweetAlert2 defaults
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      didOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
      }
    });
    
    // Custom confirm dialog
    function showConfirm(title, text, icon = 'question', confirmText = 'Ya', cancelText = 'Batal') {
      return Swal.fire({
        title: title,
        text: text,
        icon: icon,
        showCancelButton: true,
        confirmButtonText: confirmText,
        cancelButtonText: cancelText,
        reverseButtons: true
      });
    }
    
    // Show success notification
    function showSuccess(message, title = 'Berhasil!') {
      Toast.fire({
        icon: 'success',
        title: title,
        text: message
      });
    }
    
    // Show error notification
    function showError(message, title = 'Gagal!') {
      Swal.fire({
        icon: 'error',
        title: title,
        text: message,
        confirmButtonText: 'OK'
      });
    }
    
    const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' });
    let allData = [];
    let filteredData = [];
    let autoRefreshInterval = null;
    let teknisiList = new Set();
    
    // Initialize DataTable with AJAX
    const dataTable = $('#dataTable').DataTable({
      ajax: {
        url: '/api/requests',
        type: 'GET',
        dataSrc: function(json) {
          allData = json.data || [];
          updateStatistics(allData);
          updateTeknisiList(allData);
          return allData;
        },
        error: function(xhr, error, thrown) {
          console.error('DataTable ajax error:', error, thrown);
          Swal.fire({
            icon: 'error',
            title: 'Gagal Memuat Data',
            text: 'Error: ' + thrown,
            confirmButtonText: 'OK'
          });
        }
      },
      columns: [
        { data: 'requestorName', defaultContent: '-' },
        { data: 'userName', defaultContent: '-' },
        { 
          data: null,
          render: function(data, type, row) {
            return (row.packageName || 'N/A') + ' (' + rupiah.format(row.packagePrice || 0) + ')';
          }
        },
        { 
          data: 'created_at',
          render: function(data) {
            if (!data) return '-';
            return new Date(data).toLocaleDateString('id-ID');
          }
        },
        { 
          data: 'status',
          render: function(status, type, row) {
            let badgeClass = 'badge-secondary';
            let statusText = status || 'N/A';
            
            if (status === 'pending') {
              badgeClass = 'badge-warning';
              statusText = 'Menunggu';
              if (row.newStatus !== undefined) {
                statusText += ' (Target: ' + (row.newStatus ? 'Sudah Bayar' : 'Belum Bayar') + ')';
              }
            } else if (status === 'approved') {
              badgeClass = 'badge-success';
              statusText = 'Disetujui';
            } else if (status === 'rejected') {
              badgeClass = 'badge-danger';
              statusText = 'Ditolak';
            }
            
            return '<span class="badge ' + badgeClass + '">' + statusText + '</span>';
          }
        },
        { 
          data: 'updated_at',
          render: function(data) {
            if (!data) return '-';
            return new Date(data).toLocaleString('id-ID');
          }
        },
        { data: 'updated_by_name', defaultContent: '-' },
        { 
          data: null,
          orderable: false,
          render: function(data, type, row) {
            if (row.status !== 'pending') {
              return '-';
            }
            return '<button onclick="approveRequest(\'' + row.id + '\', true)" class="btn btn-success btn-sm" title="Setujui"><i class="fas fa-check"></i></button> ' +
                   '<button onclick="approveRequest(\'' + row.id + '\', false)" class="btn btn-danger btn-sm" title="Tolak"><i class="fas fa-times"></i></button>';
          }
        }
      ],
      order: [[3, 'desc']],
      processing: true,
      language: {
        url: "//cdn.datatables.net/plug-ins/1.10.25/i18n/Indonesian.json"
      }
    });
    
    async function fetchSettlementSummary() {
      const filterMonth = $('#filterMonth').val();
      const filterDateFrom = $('#filterDateFrom').val();
      const filterDateTo = $('#filterDateTo').val();
      const params = new URLSearchParams();

      if (filterMonth) {
        const [year, month] = filterMonth.split('-');
        params.set('month', String(parseInt(month, 10)));
        params.set('year', String(parseInt(year, 10)));
      }
      if (filterDateFrom) params.set('dateFrom', filterDateFrom);
      if (filterDateTo) params.set('dateTo', filterDateTo);

      const response = await fetch('/api/technician-settlement/summary?' + params.toString(), { credentials: 'include' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message || 'Gagal mengambil settlement teknisi');
      }
      return payload.data || { totals: { total_credit: 0, total_debit: 0, net_total: 0 }, summary: [], commission_per_customer: 0 };
    }

    // Update statistics
    function updateStatistics(data, isFiltered = false) {
      const total = data.length;
      const pending = data.filter(d => d.status === 'pending');
      const approved = data.filter(d => d.status === 'approved');
      const rejected = data.filter(d => d.status === 'rejected');
      
      $('#totalRequests').text(total);
      $('#pendingRequests').text(pending.length);
      $('#approvedRequests').text(approved.length);
      $('#rejectedRequests').text(rejected.length);
      $('#pendingCount').text(pending.length);
      
      const pendingValue = pending.reduce((sum, d) => sum + (d.packagePrice || 0), 0);
      $('#pendingValue').text(rupiah.format(pendingValue));

      fetchSettlementSummary()
        .then((settlement) => {
          const totals = settlement.totals || { total_credit: 0, total_debit: 0, net_total: 0 };
          const totalValue = pendingValue + (totals.net_total || 0);

          $('#approvedValue').text(rupiah.format(totals.net_total || 0));
          $('#totalValue').text(rupiah.format(totalValue));

          if (isFiltered) {
            updateIncomeByTeknisi(settlement);
          }
        })
        .catch((error) => {
          console.error('[SETTLEMENT_STATISTICS_ERROR]', error);
          $('#approvedValue').text(rupiah.format(0));
          $('#totalValue').text(rupiah.format(pendingValue));
          if (isFiltered) {
            updateIncomeByTeknisi({ summary: [], commission_per_customer: 0, totals: { total_credit: 0, total_debit: 0, net_total: 0 } });
          }
        });
      
      const currentMonth = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
      const filterMonth = $('#filterMonth').val();
      
      if (filterMonth === currentMonth && pending.length > 0) {
        $('#bulkApprove').show().prop('disabled', false);
        if (pending.length > 5) {
          $('#bulkApprove').addClass('btn-pulse');
        } else {
          $('#bulkApprove').removeClass('btn-pulse');
        }
      } else {
        $('#bulkApprove').hide().prop('disabled', true);
      }
    }

    // Update teknisi list for filter
    function updateTeknisiList(data) {
      teknisiList.clear();
      data.forEach(d => {
        if (d.requestorName) {
          teknisiList.add(d.requestorName);
        }
      });
      
      // Update teknisi dropdown
      const $filterTeknisi = $('#filterTeknisi');
      const currentValue = $filterTeknisi.val();
      $filterTeknisi.empty();
      $filterTeknisi.append('<option value="">Semua Teknisi</option>');
      
      Array.from(teknisiList).sort().forEach(teknisi => {
        $filterTeknisi.append(`<option value="${teknisi}">${teknisi}</option>`);
      });
      
      // Restore previous selection if exists
      if (currentValue) {
        $filterTeknisi.val(currentValue);
      }
    }
    
    // Filter functions
    $('#applyFilter').click(function() {
      const status = $('#filterStatus').val();
      const teknisi = $('#filterTeknisi').val();
      const month = $('#filterMonth').val();
      const dateFrom = $('#filterDateFrom').val();
      const dateTo = $('#filterDateTo').val();
      
      // Clear existing search
      dataTable.search('').columns().search('');
      
      // Apply custom filtering
      $.fn.dataTable.ext.search.push(function(settings, data, dataIndex) {
        const row = dataTable.row(dataIndex).data();
        
        // Status filter
        if (status && row.status !== status) {
          return false;
        }
        
        // Teknisi filter
        if (teknisi && row.requestorName !== teknisi) {
          return false;
        }
        
        // Date filters
        if (month) {
          if (getRequestScopeMonth(row) !== month) {
            return false;
          }
        }

        if (row.created_at) {
          const rowDate = new Date(row.created_at);
          
          // Date range filter
          if (dateFrom && rowDate < new Date(dateFrom)) {
            return false;
          }
          if (dateTo && rowDate > new Date(dateTo + ' 23:59:59')) {
            return false;
          }
        }
        
        return true;
      });
      
      dataTable.draw();
      
      // Update statistics for filtered data
      const visibleData = [];
      dataTable.rows({search: 'applied'}).every(function() {
        visibleData.push(this.data());
      });
      updateStatistics(visibleData, true);
    });
    
    // Clear filter
    $('#clearFilter').click(function() {
      $('#filterStatus').val('');
      $('#filterTeknisi').val('');
      $('#filterMonth').val('');
      $('#filterDateFrom').val('');
      $('#filterDateTo').val('');
      
      $.fn.dataTable.ext.search.pop();
      dataTable.draw();
      updateStatistics(allData);
    });
    
    // Bulk approve - only for current month
    $('#bulkApprove').click(function() {
      const currentMonth = $('#filterMonth').val();
      const now = new Date();
      const expectedMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      
      if (currentMonth !== expectedMonth) {
        Swal.fire({
          icon: 'warning',
          title: 'Tidak Dapat Melanjutkan',
          text: 'Bulk approve hanya tersedia untuk bulan berjalan',
          confirmButtonText: 'Mengerti'
        });
        return;
      }
      
      const pendingRequests = [];
      dataTable.rows({search: 'applied'}).every(function() {
        const data = this.data();
        if (data.status === 'pending') {
          if (getRequestScopeMonth(data) === expectedMonth) {
            pendingRequests.push(data.id);
          }
        }
      });
      
      if (pendingRequests.length === 0) {
        Swal.fire({
          icon: 'info',
          title: 'Tidak Ada Data',
          text: 'Tidak ada request pending yang terfilter',
          confirmButtonText: 'OK'
        });
        return;
      }
      
      Swal.fire({
        title: `Konfirmasi Bulk Approve`,
        html: `
          <div class="text-left">
            <p class="mb-3">Anda akan menyetujui <strong>${pendingRequests.length} request</strong> untuk bulan ini.</p>
            ${isAfterIsolationDate() ? `
            <div class="alert alert-warning" style="border-radius: 10px;">
              <h6 class="font-weight-bold"><i class="fas fa-exclamation-triangle"></i> PERHATIAN:</h6>
              <ul class="mb-0" style="padding-left: 20px;">
                <li>Pelanggan yang terisolir akan otomatis dipulihkan</li>
                <li>Profile PPPoE akan dikembalikan ke normal</li>
                <li>Router akan di-reboot otomatis</li>
                <li>Invoice akan dikirim ke pelanggan (jika diaktifkan)</li>
              </ul>
            </div>
            ` : `
            <div class="alert alert-info" style="border-radius: 10px;">
              <i class="fas fa-info-circle"></i> Tanggal saat ini belum melewati tanggal isolir (${tanggalIsolir}). Pelanggan belum diisolir, hanya status pembayaran yang akan diupdate.
            </div>
            `}
          </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-check"></i> Ya, Setujui Semua',
        cancelButtonText: '<i class="fas fa-times"></i> Batal',
        reverseButtons: true
      }).then((result) => {
        if (!result.isConfirmed) {
          return;
        }
      
        // Show loading
        $('#bulkApprove').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Processing...');
        
        // Show loading overlay
        Swal.fire({
          title: 'Memproses Request',
          html: `
            <div class="mb-3">
              <div class="loading-spinner mx-auto"></div>
              <p>Sedang memproses maksimal 20 request...</p>
              <small class="text-muted">Mohon tunggu sebentar</small>
            </div>
          `,
          allowOutsideClick: false,
          showConfirmButton: false,
          didOpen: () => {
            Swal.showLoading();
          }
        });
        
        $.ajax({
        url: '/api/requests/bulk-approve',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({ requestIds: pendingRequests }),
          success: function(response) {
            const results = response.results || {};
            const approved = results.approved ? results.approved.length : 0;
            const failed = results.failed ? results.failed.length : 0;
            const remaining = results.remaining || 0;
            
            let htmlContent = `<p>✅ <strong>${approved}</strong> request berhasil disetujui</p>`;
            if (failed > 0) {
              htmlContent += `<p>❌ <strong>${failed}</strong> request gagal</p>`;
            }
            if (remaining > 0) {
              htmlContent += `<hr><p class="text-info"><i class="fas fa-info-circle"></i> Masih ada <strong>${remaining}</strong> request pending.</p>`;
              htmlContent += `<p class="text-muted small">Klik tombol "Approve All Pending" lagi untuk memproses batch berikutnya.</p>`;
            }
            
            Swal.fire({
              icon: 'success',
              title: 'Batch Selesai!',
              html: htmlContent,
              confirmButtonText: remaining > 0 ? 'OK, Lanjutkan Nanti' : 'OK',
              showCancelButton: remaining > 0,
              cancelButtonText: remaining > 0 ? 'Approve Batch Berikutnya' : undefined
            }).then((result) => {
              dataTable.ajax.reload();
              // If user clicks "Approve Batch Berikutnya", trigger bulk approve again
              if (result.dismiss === Swal.DismissReason.cancel && remaining > 0) {
                setTimeout(() => $('#bulkApprove').click(), 500);
              }
            });
          },
          error: function(xhr) {
            Swal.fire({
              icon: 'error',
              title: 'Gagal!',
              text: 'Error: ' + (xhr.responseJSON ? xhr.responseJSON.message : 'Unknown error'),
              confirmButtonText: 'OK'
            });
            dataTable.ajax.reload();
          },
          complete: function() {
            $('#bulkApprove').prop('disabled', false).html('<i class="fas fa-check-double"></i> Approve All Pending Bulan Ini (<span id="pendingCount">0</span>)');
          }
        });
      });
    });
    
    // Export to CSV
    $('#exportData').click(function() {
      const visibleData = [];
      dataTable.rows({search: 'applied'}).every(function() {
        visibleData.push(this.data());
      });
      
      if (visibleData.length === 0) {
        Swal.fire({
          icon: 'info',
          title: 'Tidak Ada Data',
          text: 'Tidak ada data untuk di-export',
          confirmButtonText: 'OK'
        });
        return;
      }
      
      // Create CSV content
      let csv = 'Teknisi,Pelanggan,Paket,Harga,Tanggal Request,Status,Diperbarui Pada,Diperbarui Oleh\n';
      
      visibleData.forEach(row => {
        csv += '"' + (row.requestorName || '') + '","';
        csv += (row.userName || '') + '","';
        csv += (row.packageName || '') + '","';
        csv += (row.packagePrice || 0) + '","';
        csv += (row.created_at ? new Date(row.created_at).toLocaleString('id-ID') : '') + '","';
        csv += (row.status || '') + '","';
        csv += (row.updated_at ? new Date(row.updated_at).toLocaleString('id-ID') : '') + '","';
        csv += (row.updated_by_name || '') + '"\n';
      });
      
      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', 'requests_' + new Date().toISOString().slice(0, 10) + '.csv');
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Show success toast
      Swal.fire({
        icon: 'success',
        title: 'Export Berhasil!',
        text: `${visibleData.length} data berhasil di-export`,
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true
      });
    });
    
    // Global function for approve/reject
    window.approveRequest = function(requestId, approved) {
      const action = approved ? 'menyetujui' : 'menolak';
      const icon = approved ? 'question' : 'warning';
      const confirmButtonColor = approved ? '#28a745' : '#dc3545';
      const confirmButtonText = approved ? '<i class="fas fa-check"></i> Setujui' : '<i class="fas fa-times"></i> Tolak';
      
      // Find the request data to check if it's from teknisi
      const requestData = allData.find(d => d.id === requestId);
      const isFromTeknisi = requestData && requestData.requested_by_teknisi_id;
      const originalPaymentMethod = requestData ? requestData.payment_method : null;
      
      // Determine if this is a CASH payment from teknisi
      // Teknisi requests for "Sudah Bayar" (newStatus=true) are always CASH
      // because teknisi receives cash directly from customer in the field
      const isCashFromTeknisi = isFromTeknisi && requestData.newStatus === true;
      
      // Build HTML content - show payment method selector only for approve action
      let htmlContent = `<p>Apakah Anda yakin ingin <strong>${action}</strong> permintaan ini?</p>`;
      
      if (approved) {
        if (isCashFromTeknisi) {
          // Request from teknisi for "Sudah Bayar" - payment method is CASH (fixed)
          // This applies even for old requests without payment_method field
          htmlContent += `
            <div class="alert alert-info mt-3" style="border-radius: 8px;">
              <i class="fas fa-money-bill-wave"></i> Request dari teknisi - Metode pembayaran: <strong>Tunai (Cash)</strong>
            </div>
          `;
        } else {
          // Request from admin or "Belum Bayar" request - allow selection
          htmlContent += `
            <div class="form-group mt-3 text-left">
              <label for="paymentMethodSelect"><strong>Metode Pembayaran:</strong></label>
              <select id="paymentMethodSelect" class="form-control">
                <option value="CASH">Tunai (Cash)</option>
                <option value="TRANSFER_BANK">Transfer Bank</option>
              </select>
            </div>
          `;
        }
        
        // Show isolation warning only if current date >= tanggal_isolir
        if (isAfterIsolationDate()) {
          htmlContent += `
            <div class="alert alert-warning mt-3" style="border-radius: 8px; font-size: 0.85rem;">
              <i class="fas fa-exclamation-triangle"></i> <strong>Perhatian:</strong> Pelanggan yang terisolir akan dipulihkan dan router akan di-reboot.
            </div>
          `;
        }
        
        htmlContent += '<small class="text-muted">Pelanggan akan diupdate statusnya dan notifikasi akan dikirim</small>';
      } else {
        htmlContent += '<small class="text-muted">Request akan ditandai sebagai ditolak</small>';
      }
      
      Swal.fire({
        title: `Konfirmasi ${approved ? 'Persetujuan' : 'Penolakan'}`,
        html: htmlContent,
        icon: icon,
        showCancelButton: true,
        confirmButtonText: confirmButtonText,
        cancelButtonText: '<i class="fas fa-arrow-left"></i> Batal',
        reverseButtons: true,
        preConfirm: () => {
          // Get selected payment method if approve
          if (approved) {
            const selectEl = document.getElementById('paymentMethodSelect');
            if (selectEl) {
              return { payment_method: selectEl.value };
            } else if (isCashFromTeknisi) {
              // Teknisi request for "Sudah Bayar" is always CASH
              return { payment_method: 'CASH' };
            }
          }
          return {};
        }
      }).then((result) => {
        if (!result.isConfirmed) {
          return;
        }
        
        // Show loading
        Swal.fire({
          title: 'Memproses...',
          html: 'Sedang memproses permintaan Anda',
          allowOutsideClick: false,
          showConfirmButton: false,
          didOpen: () => {
            Swal.showLoading();
          }
        });
        
        // Build request data
        const requestPayload = { 
          requestId: requestId, 
          approved: approved 
        };
        
        // Add payment method if available
        if (result.value && result.value.payment_method) {
          requestPayload.payment_method = result.value.payment_method;
        }
        
        $.ajax({
          url: '/api/requests/approve-paid-change',
          type: 'POST',
          contentType: 'application/json',
          data: JSON.stringify(requestPayload),
          success: function(response) {
            Swal.fire({
              icon: 'success',
              title: 'Berhasil!',
              html: `Permintaan berhasil <strong>di${approved ? 'setujui' : 'tolak'}</strong>!`,
              confirmButtonText: 'OK',
              timer: 2500,
              timerProgressBar: true
            });
            dataTable.ajax.reload();
          },
          error: function(xhr) {
            Swal.fire({
              icon: 'error',
              title: 'Gagal!',
              text: 'Error: ' + (xhr.responseJSON ? xhr.responseJSON.message : 'Unknown error'),
              confirmButtonText: 'OK'
            });
          }
        });
      });
    };
    
    // Function to update income by teknisi
    function updateIncomeByTeknisi(settlement) {
      const filterMonth = $('#filterMonth').val();
      const filterDateFrom = $('#filterDateFrom').val();
      const filterDateTo = $('#filterDateTo').val();
      
      if (!filterMonth && !filterDateFrom && !filterDateTo) {
        $('#incomeByTeknisiCard').hide();
        return;
      }

      const summary = settlement && Array.isArray(settlement.summary) ? settlement.summary : [];
      const commissionPerCustomer = settlement && settlement.commission_per_customer ? settlement.commission_per_customer : 0;
      
      let periodText = '';
      if (filterMonth) {
        const [year, month] = filterMonth.split('-');
        const monthName = new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        periodText = '(' + monthName + ')';
      } else if (filterDateFrom || filterDateTo) {
        periodText = '(' + (filterDateFrom || '...') + ' s/d ' + (filterDateTo || '...') + ')';
      }
      $('#incomeFilterPeriod').text(periodText);
      
      const tbody = $('#incomeByTeknisiBody');
      tbody.empty();
      
      const sortedTeknisi = summary.slice().sort((a, b) => b.net_total - a.net_total || (a.teknisi_name || '').localeCompare(b.teknisi_name || ''));
      
      if (sortedTeknisi.length === 0) {
        tbody.append('<tr><td colspan="5" class="text-center text-muted">Tidak ada data settlement teknisi</td></tr>');
      } else {
        sortedTeknisi.forEach((item) => {
          let totalClass = 'text-muted';
          if (item.net_total > 0) totalClass = 'text-success font-weight-bold';
          else if (item.net_total < 0) totalClass = 'text-danger font-weight-bold';

          tbody.append(`
            <tr>
              <td>${item.teknisi_name || '-'}</td>
              <td class="text-right ${totalClass}">${rupiah.format(item.net_total || 0)}</td>
              <td class="text-center">
                <span class="text-success font-weight-bold">${rupiah.format(item.total_credit || 0)}</span>
                <br><small class="text-muted">kredit</small>
              </td>
              <td class="text-center">
                <span class="text-danger font-weight-bold">${rupiah.format(item.total_debit || 0)}</span>
                <br><small class="text-muted">debit</small>
              </td>
              <td class="text-center">
                <span class="badge badge-primary">${item.unique_paid_customers || 0} pelanggan</span>
                <br><small class="text-muted">@ ${rupiah.format(commissionPerCustomer)}</small>
              </td>
            </tr>
          `);
        });

        const grandCredit = sortedTeknisi.reduce((sum, item) => sum + (item.total_credit || 0), 0);
        const grandDebit = sortedTeknisi.reduce((sum, item) => sum + (item.total_debit || 0), 0);
        const grandNet = sortedTeknisi.reduce((sum, item) => sum + (item.net_total || 0), 0);
        const totalUniqueCustomers = sortedTeknisi.reduce((sum, item) => sum + (item.unique_paid_customers || 0), 0);
        const grandTotalClass = grandNet > 0 ? 'text-success' : (grandNet < 0 ? 'text-danger' : 'text-muted');

        tbody.append(`
          <tr class="font-weight-bold bg-light">
            <td>TOTAL</td>
            <td class="text-right ${grandTotalClass}">${rupiah.format(grandNet)}</td>
            <td class="text-center"><span class="text-success">${rupiah.format(grandCredit)}</span><br><small class="text-muted">kredit</small></td>
            <td class="text-center"><span class="text-danger">${rupiah.format(grandDebit)}</span><br><small class="text-muted">debit</small></td>
            <td class="text-center"><span class="badge badge-dark">${totalUniqueCustomers} pelanggan</span><br><small class="text-muted">final lunas</small></td>
          </tr>
        `);
      }
      
      $('#incomeByTeknisiCard').show();
    }

    // Auto refresh functionality
    $('#autoRefresh').change(function() {
      const seconds = parseInt($(this).val());
      
      // Clear existing interval
      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
      }
      
      // Set new interval if needed
      if (seconds > 0) {
        autoRefreshInterval = setInterval(function() {
          dataTable.ajax.reload(null, false); // false = keep current page
        }, seconds * 1000);
        
        console.log('Auto refresh enabled: every ' + seconds + ' seconds');
      } else {
        console.log('Auto refresh disabled');
      }
    });
    
    // Set current month as default filter
    const now = new Date();
    const currentMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    $('#filterMonth').val(currentMonth);
    
    // Auto apply filter on page load with current month
    setTimeout(function() {
      $('#applyFilter').click();
    }, 500);
    
    // Add keyboard shortcuts
    $(document).keydown(function(e) {
      // Ctrl + E for Export
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault();
        $('#exportData').click();
      }
      // Ctrl + F for Filter (focus on filter)
      if (e.ctrlKey && e.key === 'f') {
        e.preventDefault();
        $('#filterStatus').focus();
      }
      // Ctrl + B for Bulk Approve
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        if (!$('#bulkApprove').prop('disabled')) {
          $('#bulkApprove').click();
        }
      }
    });
    
    // Add vibration feedback for mobile devices
    function vibrateDevice(pattern = [50]) {
      if ('vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    }
    
    // Enhanced button click feedback
    $('.btn').on('click', function() {
      vibrateDevice([30]);
    });
    
    // Request notification permission for important updates
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    
    // Function to show browser notification
    function showBrowserNotification(title, body, icon = '/img/logo.png') {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
          body: body,
          icon: icon,
          badge: icon,
          vibrate: [200, 100, 200],
          tag: 'raf-bot-notification',
          requireInteraction: false
        });
      }
    }
    
    // Check for pending requests on load
    setTimeout(function() {
      const pendingCount = parseInt($('#pendingRequests').text());
      if (pendingCount > 0) {
        showBrowserNotification(
          'Ada Request Pending!',
          `Terdapat ${pendingCount} request yang menunggu persetujuan Anda.`
        );
      }
    }, 2000);
    
    // Add smooth scroll to top
    $('.scroll-to-top').on('click', function(e) {
      e.preventDefault();
      $('html, body').animate({scrollTop: 0}, 'smooth');
    });
    
    // Initialize tooltips if any
    $('[data-toggle="tooltip"]').tooltip();
    
    // Add loading state to DataTable buttons
    $('.dt-button').on('click', function() {
      $(this).addClass('disabled').html('<i class="fas fa-spinner fa-spin"></i> Loading...');
    });
  });
  </script>
</body>
</html>
