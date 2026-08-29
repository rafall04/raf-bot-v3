<!DOCTYPE html>
<html lang="id">

<head>
  <?php
  $pageTitle = 'RAF BOT - Penugasan Agen';
  $themeRole = 'admin';
  $pageDescription = 'Tugaskan pelanggan ke agen penagih.';
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
            <h1 class="h3 mb-1">Penugasan Agen</h1>
            <p class="text-muted mb-0">Tugaskan pelanggan ke agen penagih. Agen hanya bisa menagih pelanggan miliknya.</p>
          </div>

          <div id="penugasanAlerts"></div>

          <div class="card shadow mb-4">
            <div class="card-body">
              <div class="form-row align-items-end">
                <div class="form-group col-md-5">
                  <label for="agenSelect" class="font-weight-bold">Pilih Agen</label>
                  <select class="form-control" id="agenSelect">
                    <option value="">-- Pilih Agen --</option>
                  </select>
                </div>
                <div class="form-group col-md-7">
                  <label class="d-block">&nbsp;</label>
                  <button class="btn btn-success" id="assignBtn" disabled><i class="fas fa-user-check"></i> Tugaskan Terpilih ke Agen</button>
                  <button class="btn btn-outline-danger" id="unassignBtn" disabled><i class="fas fa-user-slash"></i> Lepas Penugasan Terpilih</button>
                </div>
              </div>
              <p class="small text-muted mb-0">Centang pelanggan di tabel, pilih agen, lalu klik tugaskan. "Lepas penugasan" mengosongkan agen pelanggan terpilih (tidak butuh memilih agen).</p>
            </div>
          </div>

          <div class="card shadow mb-4">
            <div class="card-header py-3 d-flex flex-wrap align-items-center justify-content-between">
              <h6 class="m-0 font-weight-bold text-primary">Daftar Pelanggan</h6>
              <div class="form-inline mt-2 mt-sm-0">
                <label class="small text-muted mr-2 mb-0" for="filterAgen">Tampilkan</label>
                <select class="form-control form-control-sm" id="filterAgen" style="min-width:210px">
                  <option value="__all__">Semua pelanggan</option>
                  <option value="__none__">Belum ditugaskan</option>
                </select>
              </div>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover" id="assignTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th style="width:36px;"><input type="checkbox" id="selectAll"></th>
                      <th>ID</th>
                      <th>Nama</th>
                      <th>Paket</th>
                      <th>Agen Saat Ini</th>
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
  <script src="<?php require_once __DIR__ . '/_asset.php'; echo rafAssetUrl('/js/penugasan-agen.js'); ?>"></script>
</body>

</html>
