<!DOCTYPE html>
<html lang="en">

<head>
<?php
  // <head> tulis tangan melewatkan components-modern.css (lapisan komponen bersama).
  $pageTitle = 'RAF BOT - Account Management';
  $pageDescription = 'RAF BOT Account Management';
  $themeRole = 'admin';
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
                <h1>Account Management</h1>
                <p>Kelola akun admin, teknisi, dan agen sistem</p>
              </div>
              <button data-toggle="modal" data-target="#createModal" class="btn btn-primary-custom">
                <i class="fas fa-user-plus"></i> Tambah Akun
              </button>
            </div>
          </div>

          <!-- Data Table -->
          <h4 class="dashboard-section-title">Daftar Akun</h4>
          <div class="dashboard-card" style="height: auto;">
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="dataTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Id</th>
                      <th>Username</th>
                      <th>Nama</th>
                      <th>Nomor Telepon</th>
                      <th>Role</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tfoot>
                    <tr>
                      <th>Id</th>
                      <th>Username</th>
                      <th>Nama</th>
                      <th>Nomor Telepon</th>
                      <th>Role</th>
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

  <div class="modal fade" id="createModal" data-backdrop="static" tabindex="-1">
    <div class="modal-dialog">
      <form id="createAccountForm" class="modal-content" method="post" action="/api/accounts">
        <div class="modal-header">
          <h5 class="modal-title" id="createModalTitle">Menambahkan Akun</h5>
          <button type="button" class="btn btn-close" data-dismiss="modal" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x" viewBox="0 0 16 16">
              <path stroke="currentColor" stroke-width="2" d="M3.146 3.146a.5.5 0 0 1 .708 0L8 7.293l4.146-4.147a.5.5 0 0 1 .708.708L8.707 8l4.147 4.146a.5.5 0 0 1-.708.708L8 8.707l-4.146 4.147a.5.5 0 0 1-.708-.708L7.293 8 3.146 3.854a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="create-username" class="form-label">Username</label>
            <input type="text" class="form-control" id="create-username" name="username" required />
          </div>
          <div class="mb-3">
            <label for="create-name" class="form-label">Nama Lengkap</label>
            <input type="text" class="form-control" id="create-name" name="name" placeholder="Nama teknisi/admin" />
          </div>
          <div class="mb-3">
            <label for="create-password" class="form-label">Password</label>
            <input type="text" class="form-control" id="create-password" name="password" required />
          </div>
          <div class="mb-3">
            <label for="create-phone_number" class="form-label">Nomor Telepon</label>
            <input type="text" class="form-control" id="create-phone_number" name="phone_number" />
          </div>
          <div class="mb-3">
            <label for="create-role" class="form-label">Role</label>
            <select name="role" id="create-role" class="form-control" required>
              <option value="" disabled selected>Pilih Role</option>
              <option value="admin">Admin</option>
              <option value="teknisi">Teknisi</option>
              <option value="agen">Agen</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-dismiss="modal">
            Cancel
          </button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  </div>

  <div class="modal fade" id="editModal" data-backdrop="static" tabindex="-1">
    <div class="modal-dialog">
      <form id="editAccountForm" class="modal-content" method="POST" action="">
        <!-- <input type="hidden" name="_method" value="PUT"> -->
        <div class="modal-header">
          <h5 class="modal-title" id="editModalTitle">Edit User</h5>
          <button type="button" class="btn btn-close" data-dismiss="modal" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x" viewBox="0 0 16 16">
              <path stroke="currentColor" stroke-width="2" d="M3.146 3.146a.5.5 0 0 1 .708 0L8 7.293l4.146-4.147a.5.5 0 0 1 .708.708L8.707 8l4.147 4.146a.5.5 0 0 1-.708.708L8 8.707l-4.146 4.147a.5.5 0 0 1-.708-.708L7.293 8 3.146 3.854a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="edit-username" class="form-label">Username</label>
            <input type="text" class="form-control" id="edit-username" name="username" required />
          </div>
          <div class="mb-3">
            <label for="edit-name" class="form-label">Nama Lengkap</label>
            <input type="text" class="form-control" id="edit-name" name="name" placeholder="Nama teknisi/admin" />
          </div>
          <div class="mb-3">
            <label for="edit-password" class="form-label">Password Baru</label>
            <input type="text" class="form-control" id="edit-password" name="password" placeholder="Kosongkan jika tidak ingin mengubah" />
          </div>
          <div class="mb-3">
            <label for="edit-phone_number" class="form-label">Nomor Telepon</label>
            <input type="text" class="form-control" id="edit-phone_number" name="phone_number" />
          </div>
          <div class="mb-3">
            <label for="edit-role" class="form-label">Role</label>
            <select name="role" id="edit-role" class="form-control" required>
              <option value="" disabled selected>Pilih Role</option>
              <option value="admin">Admin</option>
              <option value="teknisi">Teknisi</option>
              <option value="agen">Agen</option>
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-outline-secondary" data-dismiss="modal">
            Cancel
          </button>
          <button type="submit" class="btn btn-primary">Save</button>
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
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <script src="<?= rafAssetUrl('/js/accounts.js') ?>"></script>


</body>

</html>