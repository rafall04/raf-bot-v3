<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Broadcast Tagihan';
    $themeRole = 'admin';
    $pageDescription = 'Kirim pesan tagihan / pengingat pembayaran ke pelanggan terpilih';
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
            <div class="d-flex align-items-center justify-content-between">
              <div>
                <h1>Broadcast Tagihan</h1>
                <p>Kirim pesan pembayaran (dengan link bayar mandiri) ke pelanggan terpilih</p>
              </div>
            </div>
          </div>

          <!-- 1. Pilih pelanggan -->
          <h4 class="dashboard-section-title">1. Pilih Pelanggan</h4>
          <div class="dashboard-card" style="height: auto;">
            <div class="card-body">
              <div class="d-flex align-items-center flex-wrap mb-2" style="gap: 0.5rem;">
                <label class="form-label mb-0 mr-2">Tampilkan:</label>
                <select id="status-filter" class="form-control form-control-sm" style="width: auto;">
                  <option value="unpaid">Belum bayar</option>
                  <option value="all">Semua pelanggan</option>
                </select>
                <input type="text" id="customer-search" class="form-control form-control-sm" placeholder="Cari nama / nomor / paket..." style="flex: 1; min-width: 180px;"/>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="check-all">Pilih semua hasil</button>
                <button type="button" class="btn btn-sm btn-outline-secondary" id="clear-all">Hapus pilihan</button>
              </div>
              <div id="customer-list" class="border rounded" style="max-height: 340px; overflow-y: auto; background: var(--white, #fff);">
                <div class="text-center text-muted p-3">Memuat daftar pelanggan…</div>
              </div>
              <small class="form-text text-muted mt-1">
                <strong id="selected-count">0</strong> dipilih dari <strong id="total-count">0</strong> pelanggan.
                <span class="text-warning" id="nophone-note"></span>
              </small>
            </div>
          </div>

          <!-- 2. Pesan -->
          <h4 class="dashboard-section-title mt-4">2. Pesan Tagihan</h4>
          <div class="dashboard-card" style="height: auto;">
            <div class="card-body">
              <div class="mb-2">
                <textarea class="form-control" id="text" name="text" rows="9" placeholder="Memuat template tagihan…"></textarea>
                <small class="form-text text-muted">
                  Placeholder per pelanggan:
                  <code>${nama_pelanggan}</code>, <code>${paket}</code>,
                  <code>${harga}</code>, <code>${periode}</code>, <code>${jatuh_tempo}</code>,
                  <code>${link_bayar}</code> (link bayar mandiri).
                  Template bisa diedit permanen di <a href="/templates">Template Pesan</a> (key <code>broadcast_tagihan</code>).
                </small>
              </div>

              <div id="preview-box" class="border rounded p-3 mb-3" style="display:none; background: var(--gray-100, #f8f9fc); white-space: pre-wrap;">
                <div class="text-muted small mb-1">Pratinjau untuk <strong id="preview-name"></strong>:</div>
                <div id="preview-text"></div>
              </div>

              <div class="d-flex justify-content-end" style="gap: 0.5rem;">
                <button type="button" id="preview-btn" class="btn btn-secondary">
                  <i class="fas fa-eye"></i> Pratinjau
                </button>
                <button type="button" id="send-btn" class="btn btn-primary">
                  <i class="fas fa-paper-plane"></i> Kirim Tagihan
                </button>
              </div>
            </div>
          </div>

          <!-- 3. Riwayat -->
          <h4 class="dashboard-section-title mt-4">Riwayat Broadcast</h4>
          <div class="dashboard-card" style="height: auto;">
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-sm table-bordered" style="width:100%">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Operator</th>
                      <th>Template</th>
                      <th class="text-right">Target</th>
                      <th class="text-right">Sukses</th>
                      <th class="text-right">Gagal</th>
                    </tr>
                  </thead>
                  <tbody id="history-tbody"></tbody>
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

  <script src="/js/broadcast-tagihan.js"></script>

</body>

</html>
