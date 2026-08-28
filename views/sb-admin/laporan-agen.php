<!DOCTYPE html>
<html lang="id">

<head>
  <?php
  $pageTitle = 'Laporan Komisi Agen';
  $themeRole = 'admin';
  $pageDescription = 'Laporan fee/komisi agen penagih per periode.';
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
            <h1 class="h3 mb-1">Laporan Komisi Agen</h1>
            <p class="text-muted mb-0">Fee yang terkumpul untuk tiap agen penagih per periode.</p>
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
                <div class="form-group col-md-4">
                  <label for="filterAgen" class="font-weight-bold">Agen</label>
                  <select class="form-control" id="filterAgen">
                    <option value="">Semua Agen</option>
                  </select>
                </div>
                <div class="form-group col-md-2">
                  <label class="d-block">&nbsp;</label>
                  <button class="btn btn-primary btn-block" id="applyFilterBtn"><i class="fas fa-search"></i> Tampilkan</button>
                </div>
              </div>
            </div>
          </div>

          <div class="row mb-4">
            <div class="col-md-4 mb-3">
              <div class="card border-left-success shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Total Fee (Credit)</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalCredit">Rp 0</div>
                </div>
              </div>
            </div>
            <div class="col-md-4 mb-3">
              <div class="card border-left-danger shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-danger text-uppercase mb-1">Pengurangan (Debit)</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalDebit">Rp 0</div>
                </div>
              </div>
            </div>
            <div class="col-md-4 mb-3">
              <div class="card border-left-primary shadow h-100 py-2">
                <div class="card-body">
                  <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">Fee Bersih (Net)</div>
                  <div class="h5 mb-0 font-weight-bold text-gray-800" id="totalNet">Rp 0</div>
                  <div class="small text-muted mt-1">Fee per pelanggan: <span id="commissionPer">Rp 0</span></div>
                </div>
              </div>
            </div>
          </div>

          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <h6 class="m-0 font-weight-bold text-primary">Ringkasan Per Agen</h6>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover" id="summaryTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Agen</th>
                      <th>Pelanggan Lunas</th>
                      <th>Fee (Credit)</th>
                      <th>Debit</th>
                      <th>Net</th>
                    </tr>
                  </thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <h6 class="m-0 font-weight-bold text-primary">Rincian Transaksi</h6>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="entryTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Agen</th>
                      <th>Pelanggan</th>
                      <th>Jenis</th>
                      <th>Nominal</th>
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
  <script src="<?php require_once __DIR__ . '/_asset.php'; echo rafAssetUrl('/js/laporan-agen.js'); ?>"></script>
</body>

</html>
