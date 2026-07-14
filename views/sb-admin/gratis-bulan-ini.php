<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Gratis Bulan Ini';
    $themeRole = 'admin';
    $pageDescription = 'Bebaskan tagihan bulan ini (waiver) untuk pelanggan yang baru dipasang — lunas tanpa masuk pemasukan';
    include __DIR__ . '/_head.php';
    ?>
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
          <!-- Page Header -->
          <div class="dashboard-header">
            <div class="d-flex align-items-center justify-content-between flex-wrap" style="gap: 0.5rem;">
              <div>
                <h1>Gratis Bulan Ini</h1>
                <p>Bebaskan tagihan (waiver) untuk pelanggan yang <strong>baru dipasang</strong> — pemasangan &amp; bulan pertama gratis. Periode ditandai <strong>lunas</strong> (kebal isolir) <strong>tanpa masuk pemasukan</strong>, dan pelanggan mulai bayar bulan depan.</p>
              </div>
            </div>
          </div>

          <div class="dashboard-card mb-3">
            <div class="card-body">
              <div class="d-flex align-items-end flex-wrap" style="gap: 0.75rem;">
                <div>
                  <label class="small text-muted mb-1 d-block" for="filter-month">Periode</label>
                  <div class="d-flex" style="gap: 0.5rem;">
                    <select id="filter-month" class="form-control form-control-sm" style="width: auto;"></select>
                    <select id="filter-year" class="form-control form-control-sm" style="width: auto;"></select>
                  </div>
                </div>
                <div style="flex: 1 1 220px; min-width: 200px;">
                  <label class="small text-muted mb-1 d-block" for="search-input">Cari pelanggan</label>
                  <input type="text" id="search-input" class="form-control form-control-sm" placeholder="Nama / nomor HP…" autocomplete="off">
                </div>
                <div class="form-check mb-2">
                  <input class="form-check-input" type="checkbox" id="only-unpaid" checked>
                  <label class="form-check-label small" for="only-unpaid">Hanya yang belum lunas</label>
                </div>
                <div class="ml-auto d-flex align-items-center" style="gap: 0.75rem;">
                  <span class="text-muted small"><strong id="selected-count">0</strong> dipilih</span>
                  <button type="button" id="bulk-free-btn" class="btn btn-sm btn-success" disabled>
                    <i class="fas fa-gift"></i> Bebaskan Terpilih
                  </button>
                  <button type="button" id="refresh-btn" class="btn btn-sm btn-outline-primary">
                    <i class="fas fa-sync-alt"></i> Muat ulang
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div class="dashboard-card">
            <div class="card-body p-0">
              <div class="table-responsive">
                <table class="table table-hover mb-0" id="free-table">
                  <thead>
                    <tr>
                      <th style="width: 36px;"><input type="checkbox" id="select-all" title="Pilih semua"></th>
                      <th>Pelanggan</th>
                      <th>Paket</th>
                      <th>Tagihan</th>
                      <th>Status</th>
                      <th class="text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody id="free-tbody">
                    <tr><td colspan="6" class="text-center text-muted p-4">Memuat data pelanggan…</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
        <!-- /.container-fluid -->

      </div>
      <!-- End of Main Content -->

      <!-- Footer -->
      <footer class="sticky-footer bg-white">
        <div class="container my-auto">
          <div class="copyright text-center my-auto">
            <span>RAF NET</span>
          </div>
        </div>
      </footer>
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
          <a class="btn btn-primary" href="/logout">Logout</a>
        </div>
      </div>
    </div>
  </div>

  <!-- Bootstrap core JavaScript-->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>

  <!-- Core plugin JavaScript-->
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>

  <!-- Custom scripts for all pages-->
  <script src="/js/sb-admin-2.js"></script>

  <!-- SweetAlert2 untuk popup konfirmasi -->
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

  <script src="/js/gratis-bulan-ini.js"></script>

</body>

</html>
