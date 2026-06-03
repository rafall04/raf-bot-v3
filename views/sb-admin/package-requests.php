<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-t">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Permintaan Ubah Paket - Admin Panel</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
</head>
<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>

                <div class="container-fluid">
                    <!-- Page Header -->
                    <div class="dashboard-header">
                        <h1>Permintaan Ubah Paket</h1>
                        <p>Kelola permintaan perubahan paket langganan dari pelanggan</p>
                    </div>

                    <!-- Table Section -->
                    <h4 class="dashboard-section-title">Daftar Permintaan</h4>
                    <div class="card table-card mb-4">
                        <div class="card-header">
                            <h6>Permintaan Perubahan Paket</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered" id="packageRequestTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID Permintaan</th>
                                            <th>Nama Pelanggan</th>
                                            <th>Paket Saat Ini</th>
                                            <th>Paket Diminta</th>
                                            <th>Tgl Permintaan</th>
                                            <th>Status</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; RAF BOT 2025</span>
                    </div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

    <!-- Logout Modal-->
    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Yakin ingin Logout?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">Pilih "Logout" di bawah jika Anda siap untuk mengakhiri sesi Anda saat ini.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Action Modal (for both Approve and Reject) -->
    <div class="modal fade" id="actionModal" tabindex="-1" role="dialog" aria-labelledby="actionModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="actionModalLabel">Konfirmasi Aksi</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <form id="actionForm">
                    <div class="modal-body">
                        <input type="hidden" id="actionRequestId" name="requestId">
                        <input type="hidden" id="actionType" name="action">
                        <p id="actionModalText"></p>
                        <hr>
                         <div class="form-group">
                            <label for="notes">Catatan (Wajib jika menolak)</label>
                            <textarea class="form-control" id="notes" name="notes" rows="2"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                        <button type="submit" class="btn" id="actionSubmitButton">Ya, Lanjutkan</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="//cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script>
        // User name sudah di-handle oleh topbar.php via /api/me

        $(document).ready(function() {
            var table = $('#packageRequestTable').DataTable({
                "processing": true,
                "serverSide": false,
                "ajax": {
                    "url": "/api/package-change-requests",
                    "dataSrc": "data",
                    "xhrFields": {
                        "withCredentials": true
                    },
                    "error": function(xhr, error, thrown) {
                        console.error('[PACKAGE_REQUESTS] AJAX Error:', xhr.status, error, thrown);
                        Swal.fire('Gagal Memuat Data', 'Tidak dapat mengambil daftar permintaan. Coba lagi nanti.', 'error');
                    }
                },
                "columns": [
                    { "data": "id" },
                    { "data": "userName" },
                    { "data": "currentPackageName" },
                    { "data": "requestedPackageName" },
                    {
                        "data": "createdAt",
                        "render": function(data) {
                            return data ? new Date(data).toLocaleString('id-ID') : '-';
                        }
                    },
                    {
                        "data": "status",
                        "render": function(data) {
                            let badgeClass = 'badge-secondary';
                            if (data === 'pending') badgeClass = 'badge-warning';
                            else if (data === 'approved') badgeClass = 'badge-success';
                            else if (data === 'rejected') badgeClass = 'badge-danger';
                            return `<span class="badge ${badgeClass}">${data}</span>`;
                        }
                    },
                    {
                        "data": null,
                        "orderable": false,
                        "render": function(data, type, row) {
                            if (row.status === 'pending') {
                                return `
                                    <button class="btn btn-sm btn-success action-btn" title="Setujui"
                                        data-id="${row.id}" data-action="approve" data-user="${row.userName}" data-package="${row.requestedPackageName}">
                                        <i class="fas fa-check"></i>
                                    </button>
                                    <button class="btn btn-sm btn-danger action-btn" title="Tolak"
                                        data-id="${row.id}" data-action="reject" data-user="${row.userName}" data-package="${row.requestedPackageName}">
                                        <i class="fas fa-times"></i>
                                    </button>
                                `;
                            }
                            return '<span class="text-muted">N/A</span>';
                        }
                    }
                ],
                "order": [[4, "desc"]] // Order by request date
            });

            $('#packageRequestTable tbody').on('click', '.action-btn', function() {
                var data = $(this).data();
                $('#actionRequestId').val(data.id);
                $('#actionType').val(data.action);

                if (data.action === 'approve') {
                    $('#actionModalLabel').text('Setujui Permintaan Ubah Paket');
                    $('#actionModalText').html(`Anda akan menyetujui permintaan dari <strong>${data.user}</strong> untuk mengubah paket menjadi <strong>${data.package}</strong>. Ini akan mengubah profil di Mikrotik.`);
                    $('#actionSubmitButton').removeClass('btn-danger').addClass('btn-success').html('<i class="fas fa-check"></i> Ya, Setujui');
                } else {
                    $('#actionModalLabel').text('Tolak Permintaan Ubah Paket');
                    $('#actionModalText').html(`Anda akan menolak permintaan dari <strong>${data.user}</strong> untuk mengubah paket menjadi <strong>${data.package}</strong>.`);
                    $('#actionSubmitButton').removeClass('btn-success').addClass('btn-danger').html('<i class="fas fa-times"></i> Ya, Tolak');
                }

                $('#actionModal').modal('show');
            });

            $('#actionForm').on('submit', function(e) {
                e.preventDefault();
                var action = $('#actionType').val();
                var formData = {
                    requestId: $('#actionRequestId').val(),
                    notes: $('#notes').val(),
                    action: action
                };

                if (action === 'reject' && !formData.notes) {
                    Swal.fire('Gagal!', 'Alasan penolakan wajib diisi.', 'error');
                    return;
                }

                $.ajax({
                    url: '/api/approve-package-change',
                    type: 'POST',
                    contentType: 'application/json',
                    xhrFields: {
                        withCredentials: true
                    },
                    data: JSON.stringify(formData),
                    success: function(response) {
                        $('#actionModal').modal('hide');
                        Swal.fire('Berhasil!', response.message, 'success');
                        table.ajax.reload();
                    },
                    error: function(xhr) {
                        Swal.fire('Gagal!', xhr.responseJSON ? xhr.responseJSON.message : 'Terjadi kesalahan.', 'error');
                    }
                });
            });
        });
    </script>
</body>
</html>
