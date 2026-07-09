<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Konfirmasi Bayar';
    $themeRole = 'admin';
    $pageDescription = 'Konfirmasi / tolak bukti pembayaran yang dikirim pelanggan lewat WhatsApp';
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
                <h1>Konfirmasi Pembayaran</h1>
                <p>Bukti transfer yang dikirim pelanggan lewat WhatsApp. Periksa fotonya lalu konfirmasi lunas atau tolak.</p>
              </div>
              <div class="d-flex align-items-center" style="gap: 0.75rem;">
                <span class="text-muted small"><strong id="pending-count">0</strong> menunggu</span>
                <button type="button" id="refresh-btn" class="btn btn-sm btn-outline-primary">
                  <i class="fas fa-sync-alt"></i> Muat ulang
                </button>
              </div>
            </div>
          </div>

          <div id="proof-list">
            <div class="dashboard-card">
              <div class="card-body text-center text-muted p-4">Memuat bukti pembayaran…</div>
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

  <script src="/js/konfirmasi-bayar.js"></script>

</body>

</html>
