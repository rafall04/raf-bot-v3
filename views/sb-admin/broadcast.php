<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Broadcast Management';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Broadcast Management';
    include __DIR__ . '/_head.php';
    ?>

  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
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
                <h1>Broadcast Management</h1>
                <p>Kirim pesan broadcast / info gangguan massal (GAMAS) ke pelanggan</p>
              </div>
            </div>
          </div>

          <h4 class="dashboard-section-title">Komposisi Broadcast</h4>
          <div class="dashboard-card" style="height: auto;">
            <div class="card-body">
              <form id="broadcastForm">
                <div class="row">
                  <div class="col-md-6 mb-3">
                    <label for="template-preset" class="form-label">Template Pesan</label>
                    <select id="template-preset" class="form-control">
                      <option value="">-- Tulis manual --</option>
                      <option value="broadcast_gamas_kabel_putus">GAMAS — Kabel Fiber Putus</option>
                      <option value="broadcast_gamas_maintenance">GAMAS — Maintenance Terjadwal</option>
                      <option value="broadcast_gamas_listrik">GAMAS — Gangguan Listrik</option>
                      <option value="broadcast_gamas_umum">GAMAS — Pesan Umum</option>
                    </select>
                    <small class="form-text text-muted">Template bisa diedit di halaman <a href="/templates">Template Pesan</a> (tab Response).</small>
                  </div>
                  <div class="col-md-6 mb-3">
                    <label for="target-mode" class="form-label">Mode Penerima</label>
                    <select id="target-mode" class="form-control">
                      <option value="all">SEMUA pelanggan (kecuali yang opt-out)</option>
                      <option value="odp">Per ODP</option>
                      <option value="odc">Per ODC</option>
                      <option value="package">Per Paket</option>
                      <option value="notify_flagged">Hanya yang ditandai "Butuh info"</option>
                      <option value="manual">Pilih manual</option>
                    </select>
                  </div>
                </div>

                <div class="row" id="filter-row" style="display: none;">
                  <div class="col-md-6 mb-3">
                    <label for="target-filter" class="form-label">Pilih segmen</label>
                    <select id="target-filter" class="form-control"></select>
                  </div>
                </div>

                <div id="manual-target-section" class="mb-3" style="display: none;">
                  <label for="manual-target" class="form-label">Pilih penerima manual</label>
                  <select class="fstdropdown-select" id="manual-target">
                    <option selected disabled>Tambah penerima</option>
                  </select>
                  <div id="selected-target" class="d-flex flex-wrap mt-2"></div>
                </div>

                <div class="mb-3">
                  <label for="text" class="form-label">Pesan</label>
                  <textarea class="form-control" id="text" name="text" rows="6" placeholder="Pilih template di atas atau tulis pesan di sini..."></textarea>
                  <small class="form-text text-muted">
                    Placeholder per pelanggan: <code>${nama}</code>, <code>${paket}</code>, <code>${alamat}</code>, <code>${username_pppoe}</code>, <code>${odp}</code>, <code>${odc}</code>.
                  </small>
                </div>

                <div class="form-check mb-3">
                  <input type="checkbox" class="form-check-input" id="force-include-opt-out">
                  <label class="form-check-label" for="force-include-opt-out">
                    Kirim paksa (abaikan tanda "butuh info" — gunakan hanya saat darurat)
                  </label>
                </div>

                <div class="d-flex justify-content-end" style="gap: 0.5rem;">
                  <button type="button" id="preview-btn" class="btn btn-secondary">
                    <i class="fas fa-eye"></i> Preview Penerima
                  </button>
                  <button type="button" id="send-btn" class="btn btn-primary">
                    <i class="fas fa-paper-plane"></i> Kirim Broadcast
                  </button>
                </div>
              </form>
            </div>
          </div>

          <h4 class="dashboard-section-title mt-4">Riwayat Broadcast</h4>
          <div class="dashboard-card" style="height: auto;">
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-sm table-bordered" id="history-table" style="width:100%">
                  <thead>
                    <tr>
                      <th>Waktu</th>
                      <th>Operator</th>
                      <th>Mode</th>
                      <th>Filter</th>
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
            <span>Copyright &copy; Your Website 2020</span>
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

  <script src="/js/fstdropdown.min.js"></script>

  <!-- Page level plugins -->
  <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

  <!-- Custom scripts for all pages-->
  <script src="/js/sb-admin-2.js"></script>

  <!-- SweetAlert2 untuk popup konfirmasi -->
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

  <script src="/js/broadcast.js"></script>

</body>

</html>