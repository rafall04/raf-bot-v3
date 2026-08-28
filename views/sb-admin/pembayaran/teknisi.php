<!DOCTYPE html>
<html lang="en">

<head>
  <?php
  $pageTitle = 'Teknisi - Pengajuan & Manajemen Tiket';
  $themeRole = 'teknisi';
  $pageDescription = 'Halaman Teknisi untuk Pengajuan Pembayaran dan Manajemen Tiket';
  include __DIR__ . '/../_head.php';
  ?>
  <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link href="<?= rafAssetUrl('/css/pembayaran-teknisi.css') ?>" rel="stylesheet">
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
              <div class="table-responsive tabel-tumpuk-hp-wrap">
                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="dataTable" width="100%" cellspacing="0">
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


  <script src="/js/theme.js"></script>
  <script src="<?= rafAssetUrl('/js/pembayaran-teknisi.js') ?>"></script>
</body>
</html>