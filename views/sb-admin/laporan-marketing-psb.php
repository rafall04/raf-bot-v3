<!DOCTYPE html>
<html lang="id">

<head>
  <?php
  $pageTitle = 'RAF BOT - Laporan Marketing PSB';
  $themeRole = 'admin';
  $pageDescription = 'Laporan komisi marketing PSB per pemberi lead per periode.';
  include __DIR__ . '/_head.php';
  ?>
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
</head>

<body id="page-top">

  <div id="wrapper">
    <?php include '_navbar.php'; ?>

    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>

        <div class="container-fluid">
          <div class="dashboard-header mb-4">
            <h1 class="h3 mb-1"><i class="fas fa-hand-holding-usd"></i> Laporan Marketing PSB</h1>
            <p class="text-muted mb-0">Komisi pemberi lead (teknisi / makelar) per periode — siapa membawa berapa pemasangan &amp; berapa komisinya.</p>
          </div>

          <div id="laporanAlerts"></div>

          <div class="card shadow mb-4">
            <div class="card-body">
              <div class="form-row align-items-end">
                <div class="form-group col-md-3">
                  <label for="filterMonth" class="font-weight-bold">Bulan</label>
                  <select class="form-control" id="filterMonth"></select>
                </div>
                <div class="form-group col-md-3">
                  <label for="filterYear" class="font-weight-bold">Tahun</label>
                  <select class="form-control" id="filterYear"></select>
                </div>
                <div class="form-group col-md-3">
                  <label for="filterScope" class="font-weight-bold">Rentang</label>
                  <select class="form-control" id="filterScope">
                    <option value="period">Per periode terpilih</option>
                    <option value="all">Semua (all-time)</option>
                  </select>
                </div>
                <div class="form-group col-md-3">
                  <label class="d-block">&nbsp;</label>
                  <button class="btn btn-primary btn-block" id="applyFilterBtn"><i class="fas fa-search"></i> Tampilkan</button>
                </div>
              </div>
            </div>
          </div>

          <div class="row mb-4">
            <div class="col-md-3 mb-3">
              <div class="card border-left-primary shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">Total Komisi</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalFee">Rp 0</div>
                  <div class="small text-muted mt-1"><span id="totalCount">0</span> pemasangan</div>
                </div>
              </div>
            </div>
            <div class="col-md-3 mb-3">
              <div class="card border-left-secondary shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-secondary text-uppercase mb-1">Belum Dibayar</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalPending">Rp 0</div>
                </div>
              </div>
            </div>
            <div class="col-md-3 mb-3">
              <div class="card border-left-success shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Dibayar Kas (luar)</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalPaid">Rp 0</div>
                </div>
              </div>
            </div>
            <div class="col-md-3 mb-3">
              <div class="card border-left-info shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-info text-uppercase mb-1">Via Gaji (teknisi)</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalSettled">Rp 0</div>
                </div>
              </div>
            </div>
          </div>

          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <h6 class="m-0 font-weight-bold text-primary">Ringkasan Per Pemberi Lead</h6>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover" id="summaryTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Pemberi Lead</th>
                      <th>Tipe</th>
                      <th>Pemasangan</th>
                      <th>Total Komisi</th>
                      <th>Belum Dibayar</th>
                      <th>Sudah Dibayar</th>
                    </tr>
                  </thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <h6 class="m-0 font-weight-bold text-primary">Rincian Per Pemasangan</h6>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="entryTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Ref</th>
                      <th>Pelanggan</th>
                      <th>Pemberi Lead</th>
                      <th>Tipe</th>
                      <th>Komisi</th>
                      <th>Status</th>
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

  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="<?php require_once __DIR__ . '/_asset.php'; echo rafAssetUrl('/js/laporan-marketing-psb.js'); ?>"></script>
</body>

</html>
