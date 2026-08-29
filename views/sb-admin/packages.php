<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - Paket Langganan';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Package Management';
    include __DIR__ . '/_head.php';
    ?>

  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link href="/css/modal-lightweight.css" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
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
                <h1>Paket Langganan</h1>
                <p>Kelola paket internet dan harga langganan</p>
              </div>
              <button data-toggle="modal" data-target="#createModal" class="btn btn-primary-custom">
                <i class="fas fa-box"></i> Tambah Paket
              </button>
            </div>
          </div>

          <!-- Data Table -->
          <h4 class="dashboard-section-title">Daftar Paket</h4>
          <div class="dashboard-card" style="height: auto;">
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="dataTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Harga</th>
                      <th>Profil</th>
                      <th>Deskripsi</th>
                      <th>Tampil di Bulanan</th>
                      <th>Whitelist</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tfoot>
                    <tr>
                      <th>Nama</th>
                      <th>Harga</th>
                      <th>Profil</th>
                      <th>Deskripsi</th>
                      <th>Tampil di Bulanan</th>
                      <th>Whitelist</th>
                      <th>Action</th>
                    </tr>
                  </tfoot>
                  <tbody></tbody>
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
            <span>Copyright &copy; RAF BOT 2024</span>
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

  <div class="modal fade modal-raf" id="createModal" data-backdrop="static" tabindex="-1">
    <div class="modal-dialog">
      <form class="modal-content" id="createForm">
        <div class="modal-header">
          <h5 class="modal-title" id="createModalTitle">
            <i class="fas fa-box mr-2"></i>
            Tambah Paket Baru
          </h5>
          <button type="button" class="close" data-dismiss="modal" aria-label="Close">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="create-name" class="form-label">Nama Paket</label>
            <input type="text" class="form-control" id="create-name" name="name" required />
          </div>
          <div class="mb-3">
            <label for="create-price" class="form-label">Harga</label>
            <input type="number" class="form-control" id="create-price" name="price" required />
          </div>
          <div class="mb-3">
            <label for="create-profile" class="form-label">Profil MikroTik</label>
            <select class="form-control" id="create-profile" name="profile" data-profil-select>
              <option value="">Memuat profil dari router…</option>
            </select>
            <input type="text" class="form-control mt-2 d-none" id="create-profile-manual" data-profil-manual placeholder="Ketik nama profil persis seperti di router" />
            <small class="text-muted" id="create-profile-note">Diambil langsung dari router — pilih, jangan diketik, supaya tak ada salah ketik.</small>
          </div>
          <div class="mb-3">
            <label for="create-displayProfile" class="form-label">Profil Display</label>
            <input type="text" class="form-control" id="create-displayProfile" name="displayProfile" placeholder="Contoh: Up to 10 Mbps" />
            <small class="text-muted">Kecepatan yang ditampilkan ke pelanggan</small>
          </div>
          <div class="mb-3">
            <label for="create-description" class="form-label">Deskripsi Paket</label>
            <textarea class="form-control" id="create-description" name="description" rows="3" placeholder="Contoh: Up to 20Mbps, Unlimited, Cocok untuk streaming HD"></textarea>
            <small class="text-muted">Deskripsi ini akan ditampilkan di command bulanan WhatsApp</small>
          </div>
          <div class="mb-3 form-check">
            <input type="checkbox" class="form-check-input" name="showInMonthly" id="create-showInMonthly" checked>
            <label class="form-check-label" for="create-showInMonthly">Tampilkan di Command Bulanan WhatsApp</label>
          </div>
          <div class="mb-3 form-check">
            <input type="checkbox" class="form-check-input" name="whitelist" id="create-whitelist">
            <label class="form-check-label" for="create-whitelist">Whitelist</label>
          </div>
          <div class="mb-3">
            <label for="create-isolir_day" class="form-label">Tanggal Isolir Khusus Paket (opsional)</label>
            <input type="number" min="1" max="28" class="form-control" id="create-isolir_day" name="isolir_day" placeholder="Kosongkan = ikut tanggal isolir global">
            <small class="text-muted">Isi 1&ndash;28 bila paket ini diisolir di tanggal berbeda dari setelan global. Perlu fitur &quot;Isolir per Paket&quot; diaktifkan.</small>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-dismiss="modal">
            <i class="fas fa-times mr-2"></i>Cancel
          </button>
          <button type="submit" class="btn btn-primary">
            <i class="fas fa-save mr-2"></i>Simpan Paket
          </button>
        </div>
      </form>
    </div>
  </div>

  <div class="modal fade modal-raf" id="editModal" data-backdrop="static" tabindex="-1">
    <div class="modal-dialog">
      <form class="modal-content" id="editForm">
        <div class="modal-header">
          <h5 class="modal-title" id="editModalTitle">
            <i class="fas fa-edit mr-2"></i>
            Edit Paket
          </h5>
          <button type="button" class="close" data-dismiss="modal" aria-label="Close">
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="name" class="form-label">Nama Paket</label>
            <input type="text" class="form-control" id="name" name="name" />
          </div>
          <div class="mb-3">
            <label for="price" class="form-label">Harga</label>
            <input type="number" class="form-control" id="price" name="price" />
          </div>
          <div class="mb-3">
            <label for="profile" class="form-label">Profil MikroTik</label>
            <select class="form-control" id="profile" name="profile" data-profil-select>
              <option value="">Memuat profil dari router…</option>
            </select>
            <input type="text" class="form-control mt-2 d-none" id="profile-manual" data-profil-manual placeholder="Ketik nama profil persis seperti di router" />
            <small class="text-muted" id="profile-note">Diambil langsung dari router — pilih, jangan diketik, supaya tak ada salah ketik.</small>
          </div>
          <div class="mb-3">
            <label for="displayProfile" class="form-label">Profil Display</label>
            <input type="text" class="form-control" id="displayProfile" name="displayProfile" placeholder="Contoh: Up to 10 Mbps" />
            <small class="text-muted">Kecepatan yang ditampilkan ke pelanggan</small>
          </div>
          <div class="mb-3">
            <label for="description" class="form-label">Deskripsi Paket</label>
            <textarea class="form-control" id="description" name="description" rows="3" placeholder="Contoh: Up to 20Mbps, Unlimited, Cocok untuk streaming HD"></textarea>
            <small class="text-muted">Deskripsi ini akan ditampilkan di command bulanan WhatsApp</small>
          </div>
          <div class="mb-3 form-check">
            <input type="checkbox" class="form-check-input" name="showInMonthly" id="showInMonthly" checked>
            <label class="form-check-label" for="showInMonthly">Tampilkan di Command Bulanan WhatsApp</label>
          </div>
          <div class="mb-3 form-check">
            <input type="checkbox" class="form-check-input" name="whitelist" id="whitelist">
            <label class="form-check-label" for="whitelist">Whitelist</label>
          </div>
          <div class="mb-3">
            <label for="isolir_day" class="form-label">Tanggal Isolir Khusus Paket (opsional)</label>
            <input type="number" min="1" max="28" class="form-control" id="isolir_day" name="isolir_day" placeholder="Kosongkan = ikut tanggal isolir global">
            <small class="text-muted">Isi 1&ndash;28 bila paket ini diisolir di tanggal berbeda dari setelan global. Perlu fitur &quot;Isolir per Paket&quot; diaktifkan.</small>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-dismiss="modal">
            <i class="fas fa-times mr-2"></i>Cancel
          </button>
          <button type="submit" class="btn btn-primary">
            <i class="fas fa-save mr-2"></i>Simpan Paket
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- Bootstrap core JavaScript-->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>

  <!-- Core plugin JavaScript-->
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>

  <!-- Custom scripts for all pages-->
  <script src="/js/sb-admin-2.js"></script>

  <!-- Page level plugins -->
  <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
  <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

  <!-- Page level custom scripts -->
  <!-- <script src="/js/demo/datatables-demo.js"></script> -->
  <script src="<?= rafAssetUrl('/js/packages-1.js') ?>"></script>


  <script src="<?= rafAssetUrl('/js/packages-2.js') ?>"></script>


</body>

</html>