<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="RAF BOT Package Management">
  <meta name="author" content="RAF BOT">
  <title>RAF BOT - Package Management</title>

  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link href="/css/modal-lightweight.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
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
                <h1>Package Management</h1>
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
                <table class="table table-bordered table-hover" id="dataTable" width="100%" cellspacing="0">
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
            <input type="text" class="form-control" id="create-profile" name="profile" placeholder="Contoh: 10Mbps, 20Mbps" />
            <small class="text-muted">Profil teknis untuk MikroTik (nama profile di router)</small>
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
            <input type="text" class="form-control" id="profile" name="profile" placeholder="Contoh: 10Mbps, 20Mbps" />
            <small class="text-muted">Profil teknis untuk MikroTik (nama profile di router)</small>
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
  <script>
    // Handle create form submission
    $('#createForm').on('submit', function(e) {
      e.preventDefault();
      const submitBtn = $(this).find('.btn-primary');
      const originalText = submitBtn.html();
      
      // Add loading state
      submitBtn.addClass('btn-loading').prop('disabled', true);
      
      const formData = {
        name: $('#create-name').val(),
        price: $('#create-price').val(),
        profile: $('#create-profile').val(),
        displayProfile: $('#create-displayProfile').val(),
        description: $('#create-description').val(),
        showInMonthly: $('#create-showInMonthly').is(':checked'),
        whitelist: $('#create-whitelist').is(':checked')
      };
      
      $.ajax({
        url: '/api/packages',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify(formData),
        success: function(response) {
          $('#createModal').addClass('success');
          setTimeout(() => {
            $('#createModal').modal('hide').removeClass('success');
            $('#dataTable').DataTable().ajax.reload();
            // Reset form
            $('#createForm')[0].reset();
            $('#create-showInMonthly').prop('checked', true); // Default checked
          }, 500);
          
          // Modern toast notification
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: 'Paket berhasil ditambahkan',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
          });
        },
        error: function(xhr) {
          $('#createModal').addClass('error');
          setTimeout(() => $('#createModal').removeClass('error'), 500);
          
          Swal.fire({
            icon: 'error',
            title: 'Gagal!',
            text: xhr.responseJSON?.message || 'Gagal menambahkan paket',
            confirmButtonColor: '#667eea'
          });
        },
        complete: function() {
          submitBtn.removeClass('btn-loading').prop('disabled', false).html(originalText);
        }
      });
    });
    
    $(document).on('click', '.btn-edit', function() {
      const id = $(this).data('id');

      $('#editForm').data('package-id', id);
      $('#editModal input[name="name"]').val($(this).data('name'));
      $('#editModal input[name="price"]').val($(this).data('price'));
      $('#editModal input[name="profile"]').val($(this).data('profile'));
      $('#editModal input[name="displayProfile"]').val($(this).data('display-profile'));
      $('#editModal textarea[name="description"]').val($(this).data('description'));
      $('#editModal input[name="showInMonthly"]').prop('checked', $(this).data('show-in-monthly') !== false);
      $('#editModal input[name="whitelist"]').prop('checked', $(this).data('whitelist') == true);
    });
    
    // Handle edit form submission
    $('#editForm').on('submit', function(e) {
      e.preventDefault();
      const packageId = $(this).data('package-id');
      const submitBtn = $(this).find('.btn-primary');
      const originalText = submitBtn.html();
      
      // Add loading state
      submitBtn.addClass('btn-loading').prop('disabled', true);
      
      const formData = {
        name: $('#editModal input[name="name"]').val(),
        price: $('#editModal input[name="price"]').val(),
        profile: $('#editModal input[name="profile"]').val(),
        displayProfile: $('#editModal input[name="displayProfile"]').val(),
        description: $('#editModal textarea[name="description"]').val(),
        showInMonthly: $('#editModal input[name="showInMonthly"]').is(':checked'),
        whitelist: $('#editModal input[name="whitelist"]').is(':checked')
      };
      
      $.ajax({
        url: '/api/packages/' + packageId,
        type: 'PUT',
        contentType: 'application/json',
        data: JSON.stringify(formData),
        success: function(response) {
          $('#editModal').addClass('success');
          setTimeout(() => {
            $('#editModal').modal('hide').removeClass('success');
            $('#dataTable').DataTable().ajax.reload();
          }, 500);
          
          // Modern toast notification
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: 'Paket berhasil diperbarui',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
          });
        },
        error: function(xhr) {
          $('#editModal').addClass('error');
          setTimeout(() => $('#editModal').removeClass('error'), 500);
          
          Swal.fire({
            icon: 'error',
            title: 'Gagal!',
            text: xhr.responseJSON?.message || 'Gagal memperbarui paket',
            confirmButtonColor: '#667eea'
          });
        },
        complete: function() {
          submitBtn.removeClass('btn-loading').prop('disabled', false).html(originalText);
        }
      });
    });
  </script>

  <script>
    $(document).ready(function() {
      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: '/api/packages',
        columns: [{
            data: 'name'
          },
          {
            data: 'price',
            render: function(data) {
              return 'Rp ' + new Intl.NumberFormat('id-ID').format(data);
            }
          },
          {
            data: 'profile'
          },
          {
            data: 'description',
            render: function(data) {
              return data || '<span class="text-muted">Tidak ada deskripsi</span>';
            }
          },
          {
            data: null,
            render: function(data, type, row){
              const showInMonthly = row.showInMonthly !== false;
              return showInMonthly ? '<span class="badge badge-success">Ya</span>' : '<span class="badge badge-secondary">Tidak</span>';
            }
          },
          {
            data: null,
            render: function(data, type, row){
              return row.whitelist ? '<span class="badge badge-success">Ya</span>' : '<span class="badge badge-secondary">Tidak</span>';
            }
          },
          {
            data: null,
            render: function(data, type, row) {
              return `
                  <button class="btn btn-info btn-edit"
                          data-id="${row.id}"
                          data-name="${row.name}"
                          data-price="${row.price}"
                          data-profile="${row.profile}"
                          data-display-profile="${row.displayProfile}"
                          data-description="${row.description}"
                          data-show-in-monthly="${row.showInMonthly}"
                          data-whitelist="${row.whitelist}"
                          data-toggle="modal"
                          data-target="#editModal">Edit</button>
                  <button onclick="deleteData('${row.id}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      window.deleteData = function(id) {
        if (confirm('Are you sure you want to delete this')) $.ajax({
          url: '/api/packages/' + id,
          type: 'DELETE',
          success: function() {
            dataTable.ajax.reload();
          }
        });
      };
    });
  </script>

</body>

</html>