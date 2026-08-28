<!DOCTYPE html>
<html lang="id">
<head>
<?php
  // Dulu <head> ditulis tangan dan HANYA memuat dashboard-modern.css — tanpa
  // admin-theme.css, sehingga tokens.css (yang di-@import tema) tidak pernah
  // termuat: SELURUH var(--…) kosong dan halaman ini punya 19 permukaan terang
  // yang tak ikut membalik di mode gelap. Sekarang ikut partial bersama.
  $pageTitle = 'RAF BOT - Otorisasi Pengajuan Pembaruan Status';
  $themeRole = 'admin';
  include __DIR__ . '/../_head.php';
?>
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <!-- SweetAlert2 for modern popups -->
  <link href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css" rel="stylesheet">
    <link href="/css/otorisasi.css" rel="stylesheet">
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
              <h6>Rekap Teknisi — Total Ditarik &amp; Komisi <span id="incomeFilterPeriod"></span></h6>
              <small class="text-muted">
                <i class="fas fa-info-circle"></i>
                <strong>Total Ditarik</strong> = uang yang benar-benar ditarik dari pelanggan (untuk totalan kas dengan admin). <strong>Nett Komisi</strong> = kredit komisi dikurangi debit reversal. Entri lama sebelum pencatatan nominal ditandai "nominal lama tak tercatat".
              </small>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-sm table-hover">
                  <thead>
                    <tr>
                      <th>Teknisi</th>
                      <th class="text-right text-primary">Total Ditarik</th>
                      <th class="text-right">Nett Komisi</th>
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
          
          <!-- Log otorisasi.
               Pengganti spinner: pekerjaan berjalan di latar, operator boleh menutup dialognya,
               dan tiap kegagalan tercatat dengan NAMA pelanggan + alasannya — bukan pesan yang
               lewat sekali lalu hilang. Tersembunyi sampai ada pekerjaan yang pernah jalan. -->
          <div class="card shadow mb-4" id="kartuLogOtorisasi" style="display:none">
            <div class="card-header py-3 d-flex justify-content-between align-items-center">
              <h6 class="m-0 font-weight-bold text-primary">
                <i class="fas fa-list-check"></i> Log Otorisasi
              </h6>
              <span class="badge badge-secondary" id="logOtorisasiStatus">-</span>
            </div>
            <div class="card-body">
              <div class="progress mb-2" style="height: 20px">
                <div class="progress-bar" id="logOtorisasiBar" role="progressbar" style="width: 0%">0%</div>
              </div>
              <div class="mb-3" id="logOtorisasiRingkas"></div>
              <div class="table-responsive" style="max-height: 340px; overflow-y: auto">
                <table class="table table-sm table-bordered mb-0" id="tabelLogOtorisasi" width="100%">
                  <thead>
                    <tr><th>Pelanggan</th><th>Hasil</th><th>Keterangan</th></tr>
                  </thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <h6 class="m-0 font-weight-bold text-primary">Semua pengajuan</h6>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered tabel-tumpuk-hp" id="dataTable" width="100%" cellspacing="0">
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

    <script src="/js/otorisasi.js"></script>
</body>
</html>
