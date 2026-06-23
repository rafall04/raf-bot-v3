<!DOCTYPE html>
<html lang="id">

<head>
  <?php
  $pageTitle = 'Agen - Penagihan Pembayaran';
  $themeRole = 'admin';
  $pageDescription = 'Halaman Agen untuk mengajukan pembayaran pelanggan dan melihat fee.';
  include __DIR__ . '/_head.php';
  ?>
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
</head>

<body id="page-top">

  <div id="wrapper">
    <?php include '_navbar_agen.php'; ?>

    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>

        <div class="container-fluid">
          <div class="dashboard-header mb-4">
            <div class="d-flex align-items-center justify-content-between flex-wrap">
              <div>
                <h1 class="h3 mb-1">Penagihan Pembayaran</h1>
                <p class="text-muted mb-0">Selamat datang, <span id="loggedInAgenInfo">Agen</span>. Tagih pelanggan yang ditugaskan kepada Anda.</p>
              </div>
              <button id="refreshBtn" class="btn btn-primary"><i class="fas fa-sync-alt"></i> Refresh Data</button>
            </div>
          </div>

          <div id="agenAlerts"></div>

          <!-- Ringkasan -->
          <div class="row mb-4">
            <div class="col-xl-3 col-md-6 mb-3">
              <div class="card border-left-primary shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">Pelanggan Ditugaskan</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalCustomers">0</div>
                </div>
              </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-3">
              <div class="card border-left-success shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Sudah Lunas</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="paidCount">0</div>
                </div>
              </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-3">
              <div class="card border-left-warning shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-warning text-uppercase mb-1">Belum Bayar</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="unpaidCount">0</div>
                </div>
              </div>
            </div>
            <div class="col-xl-3 col-md-6 mb-3">
              <div class="card border-left-info shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-info text-uppercase mb-1">Fee Bulan Ini</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="feeThisMonth">Rp 0</div>
                  <div class="small text-muted mt-1"><span id="feeCustomerCount">0</span> pelanggan lunas</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Daftar Pelanggan -->
          <div class="card shadow mb-4">
            <div class="card-header py-3 d-flex align-items-center justify-content-between flex-wrap">
              <h6 class="m-0 font-weight-bold text-primary">Pelanggan Saya</h6>
              <div class="btn-group btn-group-sm" role="group">
                <button class="btn btn-outline-secondary filter-tab active" data-filter="all">Semua</button>
                <button class="btn btn-outline-secondary filter-tab" data-filter="unpaid">Belum Bayar</button>
                <button class="btn btn-outline-secondary filter-tab" data-filter="paid">Lunas</button>
              </div>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover" id="customerTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Nama</th>
                      <th>Paket</th>
                      <th>Tagihan</th>
                      <th>Status</th>
                      <th>Aksi</th>
                    </tr>
                  </thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Riwayat Pengajuan -->
          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <h6 class="m-0 font-weight-bold text-primary">Riwayat Pengajuan Saya</h6>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover" id="requestTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Pelanggan</th>
                      <th>Tgl Pengajuan</th>
                      <th>Status</th>
                      <th>Diproses</th>
                      <th>Aksi</th>
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
          <div class="copyright text-center my-auto"><span>RAF BOT WIFI &copy; 2026</span></div>
        </div>
      </footer>
    </div>
  </div>

  <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>

  <!-- Modal Request Pembayaran -->
  <div class="modal fade" id="requestPaymentModal" tabindex="-1" role="dialog" aria-hidden="true">
    <div class="modal-dialog" role="document">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">Ajukan Pembayaran</h5>
          <button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button>
        </div>
        <div class="modal-body">
          <div id="paymentCustomerSummary"></div>
          <div class="form-group mt-3">
            <label for="paymentNotes">Catatan (opsional)</label>
            <textarea class="form-control" id="paymentNotes" rows="2" placeholder="Catatan pembayaran..."></textarea>
          </div>
          <div class="alert alert-info small mb-0">
            <i class="fas fa-info-circle"></i> Pengajuan ini akan dikirim ke admin untuk disetujui. Pembayaran dicatat sebagai <strong>Tunai (CASH)</strong>.
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
          <button type="button" class="btn btn-success" id="confirmPaymentBtn"><i class="fas fa-paper-plane"></i> Kirim Pengajuan</button>
        </div>
      </div>
    </div>
  </div>

  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="<?php require_once __DIR__ . '/_asset.php'; echo rafAssetUrl('/js/agen-pembayaran.js'); ?>"></script>
</body>

</html>
