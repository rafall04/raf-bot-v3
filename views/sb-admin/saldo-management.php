<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="">
  <meta name="author" content="">

  <title>RAF BOT - Saldo & Voucher Management</title>

  <!-- Custom fonts for this template -->
  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<?php require_once __DIR__ . '/_asset.php'; ?>
  <link href="<?= rafAssetUrl('/css/sb-admin-2.min.css') ?>" rel="stylesheet">
  <link href="<?= rafAssetUrl('/css/admin-theme.css') ?>" rel="stylesheet">
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link href="<?= rafAssetUrl('/css/dashboard-modern.css') ?>" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css" rel="stylesheet">

  <style>
    .topup-request-card {
      border-left: 3px solid var(--primary);
      margin-bottom: 15px;
      transition: all 0.3s;
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    .topup-request-card:hover {
      box-shadow: 0 5px 15px rgba(0,0,0,0.15);
      transform: translateY(-2px);
    }
    
    .credit { color: var(--success); font-weight: bold; }
    .debit { color: var(--danger); font-weight: bold; }
  </style>
</head>

<body id="page-top">

  <!-- Page Wrapper -->
  <div id="wrapper">

    <!-- Sidebar -->
    <?php include '_navbar.php'; ?>
    <!-- End of Sidebar -->

    <!-- Content Wrapper -->
    <div id="content-wrapper" class="d-flex flex-column">

      <!-- Main Content -->
      <div id="content">

        <!-- Topbar -->
        <?php include 'topbar.php'; ?>
        <!-- End of Topbar -->

        <!-- Begin Page Content -->
        <div class="container-fluid">

          <!-- Page Heading -->
          <div class="dashboard-header">
            <div class="d-flex align-items-center justify-content-between">
              <div>
                <h1>Manajemen Saldo & Voucher</h1>
                <p>Kelola saldo user, voucher, dan transaksi</p>
              </div>
              <button class="btn btn-success-custom" id="btnAddSaldoManual" data-action="showAddSaldoModal">
                <i class="fas fa-plus-circle"></i> Tambah Saldo Manual
              </button>
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
                      <div class="card-title-text">Total Saldo Sistem</div>
                      <div class="card-value" id="totalSaldo">Rp 0</div>
                      <div class="card-subtitle">
                        <i class="fas fa-circle" style="font-size: 8px;"></i>
                        <span>Keseluruhan</span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-wallet"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card dashboard-card card-success">
                <div class="card-body">
                  <div class="card-content">
                    <div class="card-info">
                      <div class="card-title-text">User Aktif (Saldo > 0)</div>
                      <div class="card-value" id="activeUsers">0</div>
                      <div class="card-subtitle">
                        <span class="card-change positive">
                          <i class="fas fa-check-circle"></i> Active
                        </span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-users"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="col-xl-3 col-md-6 mb-4">
              <div class="card dashboard-card card-info">
                <div class="card-body">
                  <div class="card-content">
                    <div class="card-info">
                      <div class="card-title-text">Topup Pending</div>
                      <div class="card-value" id="pendingTopups">0</div>
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
              <div class="card dashboard-card card-warning">
                <div class="card-body">
                  <div class="card-content">
                    <div class="card-info">
                      <div class="card-title-text">Transaksi Hari Ini</div>
                      <div class="card-value" id="todayTransactions">0</div>
                      <div class="card-subtitle">
                        <i class="fas fa-circle" style="font-size: 8px;"></i>
                        <span>Today</span>
                      </div>
                    </div>
                    <div class="card-icon-container">
                      <i class="fas fa-exchange-alt"></i>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Tabs -->
          <ul class="nav nav-tabs" role="tablist">
            <li class="nav-item">
              <a class="nav-link active" data-toggle="tab" href="#topupRequests">
                <i class="fas fa-hand-holding-usd"></i> Request Topup
                <span class="badge badge-danger" id="pendingBadge">0</span>
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" data-toggle="tab" href="#userSaldo">
                <i class="fas fa-users"></i> Saldo User
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" data-toggle="tab" href="#agentSaldo">
                <i class="fas fa-store"></i> Saldo Agent
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" data-toggle="tab" href="#transactions">
                <i class="fas fa-history"></i> Riwayat Transaksi
              </a>
            </li>
          </ul>

          <!-- Tab Content -->
          <div class="tab-content">
            <!-- Topup Requests Tab -->
            <div id="topupRequests" class="tab-pane fade show active">
              <div class="card shadow mb-4">
                <div class="card-header py-3">
                  <h6 class="m-0 font-weight-bold text-primary">
                    Request Topup Pending
                  </h6>
                </div>
                <div class="card-body">
                  <div id="topupRequestsList"></div>
                </div>
              </div>
            </div>

            <!-- User Saldo Tab -->
            <div id="userSaldo" class="tab-pane fade">
              <div class="card shadow mb-4">
                <div class="card-header py-3">
                  <h6 class="m-0 font-weight-bold text-primary">
                    Daftar Saldo User
                  </h6>
                </div>
                <div class="card-body">
                  <div class="table-responsive">
                    <table class="table table-bordered" id="saldoTable" width="100%">
                      <thead>
                        <tr>
                          <th>No</th>
                          <th>User ID</th>
                          <th>Nama</th>
                          <th>Saldo</th>
                          <th>Last Update</th>
                          <th>Aksi</th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- Agent Saldo Tab -->
            <div id="agentSaldo" class="tab-pane fade">
              <div class="card shadow mb-4">
                <div class="card-header py-3 d-flex justify-content-between align-items-center">
                  <h6 class="m-0 font-weight-bold text-primary">
                    Daftar Saldo Agent
                  </h6>
                  <button class="btn btn-sm btn-success" id="btnAddAgentSaldo" data-action="showAddAgentSaldoModal">
                    <i class="fas fa-plus-circle"></i> Topup Saldo Agent
                  </button>
                </div>
                <div class="card-body">
                  <div class="table-responsive">
                    <table class="table table-bordered" id="agentSaldoTable" width="100%">
                      <thead>
                        <tr>
                          <th>No</th>
                          <th>Nama Agent</th>
                          <th>Area</th>
                          <th>Phone</th>
                          <th>Saldo</th>
                          <th>Last Update</th>
                          <th>Aksi</th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <!-- Transactions Tab -->
            <div id="transactions" class="tab-pane fade">
              <div class="card shadow mb-4">
                <div class="card-header py-3">
                  <h6 class="m-0 font-weight-bold text-primary">
                    Riwayat Transaksi
                  </h6>
                </div>
                <div class="card-body">
                  <div class="table-responsive">
                    <table class="table table-bordered" id="transactionTable" width="100%">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Tanggal</th>
                          <th>User</th>
                          <th>Tipe</th>
                          <th>Jumlah</th>
                          <th>Keterangan</th>
                          <th>Saldo Akhir</th>
                          <th>Bukti</th>
                        </tr>
                      </thead>
                      <tbody></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

          </div>

        </div>
        <!-- /.container-fluid -->

      </div>
      <!-- End of Main Content -->

      <!-- Footer -->
      <?php include '_footer.php'; ?>
      <!-- End of Footer -->

    </div>
    <!-- End of Content Wrapper -->

  </div>
  <!-- End of Page Wrapper -->

  <!-- Scroll to Top Button-->
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
          <a class="btn btn-primary" href="/api/logout">Logout</a>
        </div>
      </div>
    </div>
  </div>

  <!-- Add Saldo Modal -->
  <div class="modal fade" id="addSaldoModal" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Tambah Saldo Manual</h5>
          <button type="button" class="close" data-dismiss="modal">
            <span>&times;</span>
          </button>
        </div>
        <div class="modal-body">
          <form id="addSaldoForm">
            <div class="form-group">
              <label>User ID / No WhatsApp</label>
              <input type="text" class="form-control" id="addSaldoUserId" required>
              <small class="form-text text-muted">Format: 628xxx atau 628xxx@s.whatsapp.net</small>
            </div>
            <div class="form-group">
              <label>Jumlah Saldo</label>
              <input type="number" class="form-control" id="addSaldoAmount" min="1000" required>
            </div>
            <div class="form-group">
              <label>Keterangan</label>
              <input type="text" class="form-control" id="addSaldoDescription" value="Topup manual by admin">
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
          <button type="button" class="btn btn-success" id="btnSubmitAddSaldo" data-action="addSaldoManual">
            <i class="fas fa-plus-circle"></i> Tambah Saldo
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Add Agent Saldo Modal -->
  <div class="modal fade" id="addAgentSaldoModal" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Topup Saldo Agent</h5>
          <button type="button" class="close" data-dismiss="modal">
            <span>&times;</span>
          </button>
        </div>
        <div class="modal-body">
          <form id="addAgentSaldoForm">
            <div class="form-group">
              <label>Pilih Agent</label>
              <select class="form-control" id="addAgentSaldoAgentId" required>
                <option value="">-- Pilih Agent --</option>
              </select>
            </div>
            <div class="form-group">
              <label>Jumlah Saldo</label>
              <input type="number" class="form-control" id="addAgentSaldoAmount" min="1000" required>
            </div>
            <div class="form-group">
              <label>Keterangan</label>
              <input type="text" class="form-control" id="addAgentSaldoDescription" value="Topup saldo agent by admin">
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
          <button type="button" class="btn btn-success" id="btnSubmitAddAgentSaldo" data-action="addAgentSaldoManual">
            <i class="fas fa-plus-circle"></i> Topup Saldo
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Bootstrap core JavaScript-->
  <script src="/static/vendor/jquery/jquery.min.js"></script>
  <script src="/static/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>

  <!-- Core plugin JavaScript-->
  <script src="/static/vendor/jquery-easing/jquery.easing.min.js"></script>

  <!-- Custom scripts for all pages-->
  <script src="/static/js/sb-admin-2.min.js"></script>

  <!-- Page level plugins -->
  <script src="/static/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/static/vendor/datatables/dataTables.bootstrap4.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

  <!-- Page level custom scripts -->
  <script src="/static/js/saldo-management.js"></script>

    <script src="/js/saldo-management.js"></script>

</body>

</html>
