<!DOCTYPE html>
<html lang="en">

<head>

  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="">
  <meta name="author" content="">

  <title>RAF BOT - Voucher</title>

  <!-- Custom fonts for this template -->
  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

  <!-- Custom styles for this template -->
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">

  <!-- Custom styles for this page -->
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

          <!-- Page Heading -->
          <div class="dashboard-header">
            <h1>Voucher Management</h1>
            <p>Kelola voucher dan kode akses hotspot</p>
          </div>

          <!-- DataTales Example -->
          <div class="card shadow mb-4">
            <div class="card-header py-3">
              <div class="d-flex" style="justify-content: space-between;">
                <h6 class="m-0 font-weight-bold text-primary">Semua Voucher</h6>
                <button data-toggle="modal" data-target="#createModal" class="btn btn-success">Voucher +</button>
              </div>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered" id="dataTable" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Profil</th>
                      <th>Nama Voucher</th>
                      <th>Durasi</th>
                      <th>Harga Jual</th>
                      <th>Harga Reseller</th>
                      <th>Margin</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tfoot>
                    <tr>
                      <th>Profil</th>
                      <th>Nama Voucher</th>
                      <th>Durasi</th>
                      <th>Harga Jual</th>
                      <th>Harga Reseller</th>
                      <th>Margin</th>
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
      <form class="modal-content" method="post" action="/api/voucher">
        <div class="modal-header">
          <h5 class="modal-title" id="createModalTitle">Menambahkan Voucher</h5>
          <button type="button" class="btn btn-close" data-dismiss="modal" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x" viewBox="0 0 16 16">
              <path stroke="currentColor" stroke-width="2" d="M3.146 3.146a.5.5 0 0 1 .708 0L8 7.293l4.146-4.147a.5.5 0 0 1 .708.708L8.707 8l4.147 4.146a.5.5 0 0 1-.708.708L8 8.707l-4.146 4.147a.5.5 0 0 1-.708-.708L7.293 8 3.146 3.854a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="prof" class="form-label">Profil</label>
            <input type="text" class="form-control" id="prof" name="prof" />
          </div>
          <div class="mb-3">
            <label for="namavc" class="form-label">Nama Voucher</label>
            <input type="text" class="form-control" id="namavc" name="namavc" />
          </div>
          <div class="mb-3">
            <label for="durasivc" class="form-label">Durasi</label>
            <input type="text" class="form-control" id="durasivc" name="durasivc" />
          </div>
          <div class="mb-3">
            <label for="hargavc" class="form-label">Harga</label>
            <input type="number" class="form-control" id="hargavc" name="hargavc" />
          </div>
          <div class="mb-3">
            <label for="hargaReseller" class="form-label">Harga Reseller</label>
            <input type="number" class="form-control" id="hargaReseller" name="hargaReseller" />
            <small class="form-text text-muted">Harga khusus agent/reseller.</small>
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
      <form class="modal-content" method="POST" action="">
        <!-- <input type="hidden" name="_method" value="PUT"> -->
        <div class="modal-header">
          <h5 class="modal-title" id="editModalTitle">Edit Voucher</h5>
          <button type="button" class="btn btn-close" data-dismiss="modal" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x" viewBox="0 0 16 16">
              <path stroke="currentColor" stroke-width="2" d="M3.146 3.146a.5.5 0 0 1 .708 0L8 7.293l4.146-4.147a.5.5 0 0 1 .708.708L8.707 8l4.147 4.146a.5.5 0 0 1-.708.708L8 8.707l-4.146 4.147a.5.5 0 0 1-.708-.708L7.293 8 3.146 3.854a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label for="edit_prof" class="form-label">Profil</label>
            <input type="text" class="form-control" id="edit_prof" name="prof" />
          </div>
          <div class="mb-3">
            <label for="edit_namavc" class="form-label">Nama Voucher</label>
            <input type="text" class="form-control" id="edit_namavc" name="namavc" />
          </div>
          <div class="mb-3">
            <label for="edit_durasivc" class="form-label">Durasi</label>
            <input type="text" class="form-control" id="edit_durasivc" name="durasivc" />
          </div>
          <div class="mb-3">
            <label for="edit_hargavc" class="form-label">Harga Jual</label>
            <input type="number" class="form-control" id="edit_hargavc" name="hargavc" />
          </div>
          <div class="mb-3">
            <label for="edit_hargaReseller" class="form-label">Harga Reseller</label>
            <input type="number" class="form-control" id="edit_hargaReseller" name="hargaReseller" />
            <small class="form-text text-muted">Harga yang dijual ke agent (biasanya 20% lebih murah dari harga jual)</small>
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
  <script>
    $(document).on('click', '.btn-edit', function() {
      const id = $(this).data('id');
      $('#editModal form').attr('action', '/api/voucher/' + encodeURIComponent(id));
      $('#editModal input#edit_prof').val($(this).data('prof'));
      $('#editModal input#edit_namavc').val($(this).data('namavc'));
      $('#editModal input#edit_durasivc').val($(this).data('durasivc'));
      $('#editModal input#edit_hargavc').val($(this).data('hargavc'));
      $('#editModal input#edit_hargaReseller').val($(this).data('hargareseller') || '');
    });
  </script>

  <script>
    $(document).ready(function() {
      function showVoucherAlert(message, variant) {
        const alertHtml = `
          <div class="alert alert-${variant} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="close" data-dismiss="alert" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
        `;

        $('.container-fluid').find('.voucher-alert').remove();
        $(alertHtml).addClass('voucher-alert').prependTo('.container-fluid');
      }

      async function submitVoucherForm(formElement, method) {
        const $form = $(formElement);
        const action = $form.attr('action');
        const submitButton = $form.find('button[type="submit"]');
        const payload = Object.fromEntries(new FormData(formElement).entries());

        submitButton.prop('disabled', true);

        try {
          const response = await fetch(action, {
            method,
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(payload)
          });
          const result = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(result.error || result.message || 'Gagal menyimpan voucher');
          }

          $form.closest('.modal').modal('hide');
          formElement.reset();
          dataTable.ajax.reload(null, false);
          showVoucherAlert(result.message || 'Voucher berhasil disimpan.', 'success');
        } catch (error) {
          showVoucherAlert(error.message || 'Gagal menyimpan voucher.', 'danger');
        } finally {
          submitButton.prop('disabled', false);
        }
      }

      // Format currency
      function formatCurrency(amount) {
        return new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          minimumFractionDigits: 0
        }).format(amount);
      }
      
      // Inisialisasi DataTable
      const dataTable = $('#dataTable').DataTable({
        ajax: {
          url: '/api/voucher',
          type: 'GET',
          dataSrc: function(json) {
            // DataTable expects array directly
            if (Array.isArray(json)) {
              return json;
            }
            
            // If response is wrapped in data property
            if (json && json.data && Array.isArray(json.data)) {
              return json.data;
            }
            
            // If response is error
            if (json && json.error) {
              console.error('[VOUCHER_DATATABLE] API Error:', json.error);
              return [];
            }
            
            console.warn('[VOUCHER_DATATABLE] Unexpected response format:', json);
            return [];
          },
          error: function(xhr, error, thrown) {
            console.error('[VOUCHER_DATATABLE] AJAX Error:', error, thrown);
            showVoucherAlert('Gagal memuat data voucher.', 'danger');
          }
        },
        columns: [{
            data: 'prof'
          },
          {
            data: 'namavc'
          },
          {
            data: 'durasivc'
          },
          {
            data: 'hargavc',
            render: function(data) {
              return formatCurrency(parseInt(data || 0));
            }
          },
          {
            data: 'hargaReseller',
            render: function(data) {
              return data ? formatCurrency(parseInt(data)) : '-';
            }
          },
          {
            data: 'margin',
            render: function(data) {
              return data ? formatCurrency(parseInt(data)) : '-';
            }
          },
          {
            data: null,
            render: function(data, type, row) {
              return `
                  <button class="btn btn-info btn-edit" data-id="${row.prof}" data-prof="${row.prof}" data-namavc="${row.namavc}" data-durasivc="${row.durasivc}" data-hargavc="${row.hargavc}" data-hargareseller="${row.hargaReseller || ''}" data-toggle="modal" data-target="#editModal">Edit</button>
                  <button onclick="deleteData('${row.prof}')" class="btn btn-danger">Hapus</button>
                  `;
            }
          }
        ]
      });

      window.deleteData = function(id) {
        if (confirm('Are you sure you want to delete this')) $.ajax({
          url: '/api/voucher/' + encodeURIComponent(id),
          type: 'DELETE',
          success: function(response) {
            dataTable.ajax.reload();
            showVoucherAlert(response?.message || 'Voucher berhasil dihapus.', 'success');
          },
          error: function(xhr) {
            const message = xhr?.responseJSON?.error || xhr?.responseJSON?.message || 'Gagal menghapus voucher.';
            showVoucherAlert(message, 'danger');
          }
        });
      };

      $('#createModal form').on('submit', async function(event) {
        event.preventDefault();
        await submitVoucherForm(this, 'POST');
      });

      $('#editModal form').on('submit', async function(event) {
        event.preventDefault();
        await submitVoucherForm(this, 'PUT');
      });
    });
  </script>

</body>

</html>
