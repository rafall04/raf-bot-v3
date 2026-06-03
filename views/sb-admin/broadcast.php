<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
  <meta name="description" content="RAF BOT Broadcast Management">
  <meta name="author" content="RAF BOT">
  <title>RAF BOT - Broadcast Management</title>

  <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
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
                <h1>Broadcast Management</h1>
                <p>Kirim pesan broadcast ke pelanggan</p>
              </div>
              <button data-toggle="modal" data-target="#createModal" class="btn btn-primary-custom">
                <i class="fas fa-broadcast-tower"></i> Kirim Broadcast
              </button>
            </div>
          </div>

          <!-- Data Table -->
          <h4 class="dashboard-section-title">Riwayat Broadcast</h4>
          <div class="dashboard-card" style="height: auto;">
            <div class="card-header py-3" style="background: transparent; border-bottom: 1px solid #e5e7eb;">
              <h6 class="m-0 font-weight-bold" style="color: var(--dark);">Daftar Broadcast</h6>
            </div>
            <div class="card-body">
              <form action="/api/broadcast" method="post">
                <div class="mb-3">
                  <label for="text" class="form-label">Pesan</label>
                  <textarea class="form-control" id="text" required name="text" rows="5"></textarea>
                </div>
                <div class="mb-2">
                    <small class="text-muted">Gunakan placeholder berikut untuk personalisasi: <code>${nama}</code>, <code>${paket}</code>, <code>${alamat}</code>, <code>${username_pppoe}</code></small>
                </div>
                <div class="mb-3">
                  <div class="form-check">
                    <input type="checkbox" name="all" id="all-user" class="form-check-input" checked>
                    <label for="all-user" class="form-check-label">semua orang</label>
                  </div>
                </div>
                <div id="select-target" class="mb-3" style="display: none;">
                  <div class="mb-3">
                    <label for="target" class="form-label">Pilih penerima</label>
                    <select class="fstdropdown-select" id="target">
                      <option selected disabled>Pilih penerima</option>
                      <!-- Users name here -->
                    </select>
                  </div>
                  <div id="selected-target" class="d-flex">

                  </div>
                </div>
                
                <div class="d-flex w-100" style="justify-content: end;">
                  <button type="submit" class="btn btn-primary">Kirim</button>
                </div>
              </form>
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

  <script>
    document.querySelector('#all-user').addEventListener('change', function(e) {
      const select = document.getElementById('select-target');
      if (e.target.checked) {
        select.style.display = 'none';
      } else {
        select.style.display = 'block';
      }
    });

    document.querySelector('#target').addEventListener('change', function(e) {
      const selectedTarget = document.getElementById('selected-target');
      const option = document.querySelector(`option[value="${e.target.value}"]`);
      const div = document.createElement('div');
      div.className = 'd-flex align-items-center badge bg-primary text-white';
      div.style.marginRight = '0.10rem';
      div.innerHTML = `
      <span>${option.innerText}</span>
      <input type="hidden" name="users[]" value="${option.value}">
      <button type="button" class="btn btn-none text-white btn-xs ml-2" style="padding: 0;">X</button>
      `;
      div.querySelector('button').addEventListener('click', function() {
        div.remove();
      });
      selectedTarget.appendChild(div);
    });
    fetch('/api/users', {
      credentials: 'include' // ✅ Send cookies for authentication
    })
      .then(res => res.json())
      .then(res => {
        const select = document.getElementById('target');
        res.data.forEach(user => {
          const option = document.createElement('option');
          option.value = user.id;
          option.innerText = user.name;
          select.appendChild(option);
        });
        select.fstdropdown.rebind()
      });
  </script>

  <!-- SweetAlert2 for modern popups -->
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

  <script>
    // Handle form submission with Fetch API and SweetAlert
    document.querySelector('form[action="/api/broadcast"]').addEventListener('submit', async function(e) {
      e.preventDefault();

      const form = e.target;
      const formData = new FormData(form);
      const submitButton = form.querySelector('button[type="submit"]');

      // Create a plain object from FormData
      const data = {};
      // Handle the 'all' checkbox specifically
      data.all = formData.has('all') ? 'on' : 'off';
      data.text = formData.get('text');
      // Handle multiple users
      data.users = formData.getAll('users[]');

      // Disable button and show spinner
      submitButton.disabled = true;
      submitButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Mengirim...`;

      try {
        const response = await fetch('/api/broadcast', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // ✅ CRITICAL: Send cookies with request
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (response.ok) {
          Swal.fire({
            icon: 'success',
            title: 'Berhasil!',
            text: result.message || 'Broadcast telah dimulai.',
            timer: 2500,
            showConfirmButton: false,
          });
          // Optionally clear the form
          form.reset();
          document.getElementById('selected-target').innerHTML = ''; // Clear selected users UI
        } else {
          throw new Error(result.message || 'Gagal mengirim broadcast.');
        }
      } catch (error) {
        Swal.fire({
          icon: 'error',
          title: 'Oops...',
          text: error.message || 'Terjadi kesalahan yang tidak diketahui.',
        });
      } finally {
        // Re-enable button
        submitButton.disabled = false;
        submitButton.innerHTML = 'Kirim';
      }
    });
  </script>

</body>

</html>