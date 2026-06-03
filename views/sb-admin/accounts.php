<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="RAF BOT Account Management">
  <meta name="author" content="RAF BOT">
  <title>RAF BOT - Account Management</title>

  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
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
                <p>Kelola akun admin dan teknisi sistem</p>
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
                <table class="table table-bordered table-hover" id="dataTable" width="100%" cellspacing="0">
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
  <script>
    $(document).ready(function() {
      // Check if SweetAlert2 is loaded
      if (typeof Swal === 'undefined') {
        console.error('[ACCOUNTS_PAGE] SweetAlert2 not loaded!');
        // Fallback: try to load again with explicit HTTPS
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11';
        script.onload = function() {
          console.log('[ACCOUNTS_PAGE] SweetAlert2 loaded successfully');
          initializeHandlers();
        };
        script.onerror = function() {
          console.error('[ACCOUNTS_PAGE] Failed to load SweetAlert2');
          alert('Warning: Popup library tidak dapat dimuat. Beberapa fitur mungkin tidak berfungsi dengan baik.');
        };
        document.head.appendChild(script);
      } else {
        console.log('[ACCOUNTS_PAGE] SweetAlert2 already loaded');
        initializeHandlers();
      }
    });

    // Helper function to ensure Swal is available
    function safeSwalFire(options) {
      if (typeof Swal === 'undefined') {
        console.error('[SAFE_SWAL] SweetAlert2 not available, using fallback');
        // Fallback to native alert/confirm
        if (options.showCancelButton) {
          // For confirm dialogs
          const confirmed = confirm((options.title || 'Konfirmasi') + '\n\n' + (options.text || ''));
          return Promise.resolve({ isConfirmed: confirmed, isDenied: false, isDismissed: !confirmed });
        } else {
          // For alert dialogs
          if (options.title && options.text) {
            alert(options.title + ': ' + options.text);
          } else if (options.text) {
            alert(options.text);
          } else if (options.title) {
            alert(options.title);
          }
          return Promise.resolve({ isConfirmed: true });
        }
      }
      return Swal.fire(options);
    }

    function initializeHandlers() {
      console.log('[ACCOUNTS_PAGE] Initializing handlers');
      
      // Setup edit button click handler (use event delegation for dynamic content)
      $(document).off('click', '.btn-edit').on('click', '.btn-edit', function() {
        const id = $(this).data('id');
        console.log('[BTN_EDIT] Button clicked, ID:', id);
        
        if (!id) {
          console.error('[BTN_EDIT] No ID found in button data');
          safeSwalFire({
            title: 'Error!',
            text: 'ID akun tidak ditemukan. Silakan refresh halaman.',
            icon: 'error'
          });
          return;
        }
        
        // Clear the password field every time the modal is opened
        $('#editModal input#edit-password').val('');

        // Set form action with account ID
        const actionUrl = '/api/accounts/' + id;
        const form = $('#editAccountForm');
        form.attr('action', actionUrl);
        console.log('[BTN_EDIT] Form action set to:', actionUrl);
        console.log('[BTN_EDIT] Form element:', form.length > 0 ? 'Found' : 'NOT FOUND');
        
        // Note: There is no input with id="id" in the modal, so this line is ineffective but harmless.
        // $('#editModal input#id').val($(this).data('id'));
        $('#editModal input#edit-username').val($(this).data('username') || '');
        $('#editModal input#edit-name').val($(this).data('name') || '');
        $('#editModal input#edit-phone_number').val($(this).data('phone_number') || '');
        $('#editModal select#edit-role').val($(this).data('role') || '');
        
        console.log('[BTN_EDIT] Form fields populated');
      });
      // Handle Create Account Form Submission
      $('#createAccountForm').on('submit', function(e) {
        e.preventDefault(); // Prevent default form submission

        const form = $(this);
        const url = form.attr('action');
        const method = form.attr('method');
        const data = form.serialize();
        const submitBtn = form.find('button[type="submit"]');
        const originalBtnText = submitBtn.html();

        // Disable submit button
        submitBtn.prop('disabled', true);
        submitBtn.html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

        $.ajax({
          url: url,
          type: method,
          data: data,
          success: function(response) {
            // Check if response has success field or status field
            const isSuccess = (response.success === true) || (response.status === 200 || response.status === 201);
            const message = response.message || 'Akun baru telah berhasil ditambahkan.';

            if (isSuccess) {
              $('#createModal').modal('hide');
              // Clear the form fields
              form.trigger('reset');
              safeSwalFire({
                title: 'Berhasil!',
                text: message,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
              });
              dataTable.ajax.reload();
            } else {
              // Response tidak sukses meskipun status 200
              safeSwalFire({
                title: 'Gagal!',
                text: message || 'Terjadi kesalahan saat menambahkan akun.',
                icon: 'error'
              });
            }
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error('Error creating account:', jqXHR, textStatus, errorThrown);
            // Extract error message from server response if available
            const errorMessage = (jqXHR.responseJSON && jqXHR.responseJSON.message) 
              ? jqXHR.responseJSON.message 
              : 'Terjadi kesalahan saat menambahkan akun.';
            safeSwalFire({
              title: 'Gagal!',
              text: errorMessage,
              icon: 'error'
            });
          },
          complete: function() {
            // Re-enable submit button
            submitBtn.prop('disabled', false);
            submitBtn.html(originalBtnText);
          }
        });
      });

      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: '/api/accounts',
        columns: [{
            data: 'id'
          },
          {
            data: 'username'
          },
          {
            data: 'name',
            defaultContent: '-'
          },
          {
            data: 'phone_number'
          },
          {
            data: 'role'
          },
          {
            data: null,
            render: function(data, type, row) {
              // Remove data-password attribute from the button
              return `
                  <button class="btn btn-info btn-edit" data-id="${row.id}" data-username="${row.username}" data-name="${row.name || ''}" data-phone_number="${row.phone_number}" data-role="${row.role}" data-toggle="modal" data-target="#editModal">Edit</button>
                  <button onclick="deleteData('${row.id}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      // Handle Edit Account Form Submission
      // Remove any existing handler first to prevent duplicates
      $(document).off('submit', '#editAccountForm');
      // Use event delegation to ensure handler is always attached
      $(document).on('submit', '#editAccountForm', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[EDIT_ACCOUNT_FORM] Form submitted - Handler triggered');

        const form = $(this);
        const url = form.attr('action');
        const data = form.serialize();
        const submitBtn = form.find('button[type="submit"]');
        const originalBtnText = submitBtn.html();

        // Validate URL
        if (!url || url === '' || url === '/api/accounts/') {
          console.error('[EDIT_ACCOUNT_FORM] Invalid URL:', url);
          safeSwalFire({
            title: 'Gagal!',
            text: 'URL tidak valid. Silakan tutup modal dan coba lagi.',
            icon: 'error'
          });
          return;
        }

        console.log('[EDIT_ACCOUNT_FORM] Submitting to:', url);
        console.log('[EDIT_ACCOUNT_FORM] Data:', data);

        // Disable submit button
        submitBtn.prop('disabled', true);
        submitBtn.html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

        $.ajax({
          url: url,
          type: 'POST',
          data: data,
          success: function(response) {
            console.log('[EDIT_ACCOUNT_FORM] Success response:', response);
            // Check if response has success field or status field
            const isSuccess = (response.success === true) || (response.status === 200 || response.status === 201);
            const message = response.message || 'Akun telah berhasil diperbarui.';

            if (isSuccess) {
              $('#editModal').modal('hide');
              form.trigger('reset');
              // Clear form action to prevent accidental resubmit
              form.attr('action', '');
              safeSwalFire({
                title: 'Berhasil!',
                text: message,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
              }).then(() => {
                dataTable.ajax.reload();
              });
            } else {
              // Response tidak sukses meskipun status 200
              console.warn('[EDIT_ACCOUNT_FORM] Response not successful:', response);
              safeSwalFire({
                title: 'Gagal!',
                text: message || 'Terjadi kesalahan saat memperbarui akun.',
                icon: 'error'
              });
            }
          },
          error: function(jqXHR, textStatus, errorThrown) {
            console.error('[EDIT_ACCOUNT_FORM] Error updating account:', {
              status: jqXHR.status,
              statusText: jqXHR.statusText,
              responseText: jqXHR.responseText,
              responseJSON: jqXHR.responseJSON,
              textStatus: textStatus,
              errorThrown: errorThrown
            });
            const errorMessage = (jqXHR.responseJSON && jqXHR.responseJSON.message) 
              ? jqXHR.responseJSON.message 
              : 'Terjadi kesalahan saat memperbarui akun.';
            safeSwalFire({
              title: 'Gagal!',
              text: errorMessage,
              icon: 'error'
            });
          },
          complete: function() {
            console.log('[EDIT_ACCOUNT_FORM] Request completed');
            // Re-enable submit button
            submitBtn.prop('disabled', false);
            submitBtn.html(originalBtnText);
          }
        });
      });

      window.deleteData = function(id) {
        safeSwalFire({
          title: 'Anda yakin?',
          text: "Anda tidak akan dapat mengembalikan ini!",
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#3085d6',
          cancelButtonColor: '#d33',
          confirmButtonText: 'Ya, hapus!',
          cancelButtonText: 'Batal'
        }).then((result) => {
          if (result.isConfirmed) {
            $.ajax({
              url: '/api/accounts/' + id,
              type: 'DELETE',
              success: function(result) {
                safeSwalFire({
                  title: 'Dihapus!',
                  text: 'Akun telah berhasil dihapus.',
                  icon: 'success'
                }).then(() => {
                  dataTable.ajax.reload();
                });
              },
              error: function (jqXHR, textStatus, errorThrown) {
                safeSwalFire({
                  title: 'Gagal!',
                  text: 'Terjadi kesalahan saat menghapus akun.',
                  icon: 'error'
                });
              }
            });
          }
        })
      };
    } // End of initializeHandlers function
  </script>

</body>

</html>