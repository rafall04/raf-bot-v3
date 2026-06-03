<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Request Ubah Paket - Panel Teknisi</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        /* ===== MOBILE RESPONSIVE STYLES ===== */
        @media (max-width: 768px) {
            .container-fluid {
                padding: 0.75rem;
            }
            
            h1.h3 {
                font-size: 1.25rem;
            }
            
            p.mb-4 {
                font-size: 0.9rem;
            }
            
            /* Card adjustments */
            .card-body {
                padding: 1rem;
            }
            
            .card-header {
                padding: 0.75rem 1rem;
            }
            
            /* Form controls */
            .form-control, select, textarea {
                font-size: 16px !important; /* Prevents zoom on iOS */
            }
            
            /* Button */
            .btn {
                width: 100%;
            }
        }
        
        @media (max-width: 576px) {
            .container-fluid {
                padding: 0.5rem;
            }
            
            h1.h3 {
                font-size: 1.1rem;
            }
            
            .card-body {
                padding: 0.75rem;
            }
        }
    </style>
</head>
<body id="page-top">
    <div id="wrapper">
        <?php include '_role_aware_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include '_role_aware_teknisi_topbar.php'; ?>

                <div class="container-fluid">
                    <h1 class="h3 mb-2 text-gray-800">Request Perubahan Paket Pelanggan</h1>
                    <p class="mb-4">Gunakan form di bawah ini untuk mengajukan permintaan perubahan paket permanen untuk pelanggan.</p>

                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary">Form Permintaan</h6>
                        </div>
                        <div class="card-body">
                            <form id="requestPackageChangeForm">
                                <div class="form-group">
                                    <label for="userSelect">Pilih Pelanggan</label>
                                    <select class="form-control" id="userSelect" name="userId" required>
                                        <option value="">Memuat pelanggan...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="currentPackage">Paket Saat Ini</label>
                                    <input type="text" class="form-control" id="currentPackage" readonly>
                                </div>
                                <hr>
                                <div class="form-group">
                                    <label for="packageSelect">Pilih Paket Baru</label>
                                    <select class="form-control" id="packageSelect" name="newPackageName" required>
                                        <option value="">Memuat paket...</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="requestNotes">Catatan (Opsional)</label>
                                    <textarea class="form-control" id="requestNotes" name="notes" rows="3" placeholder="Tambahkan catatan atau alasan perubahan paket..."></textarea>
                                </div>
                                <button type="submit" class="btn btn-primary" id="submitBtn">
                                    <i class="fas fa-paper-plane"></i> Kirim Permintaan
                                </button>
                            </form>
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

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
        aria-hidden="true">
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

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="//cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script>
        // Fetch username for topbar
        fetch('/api/me', { credentials: 'include' }).then(res => res.json()).then(data => {
            if (data.data && data.data.username) {
                document.getElementById('loggedInTechnicianInfo').textContent = data.data.username;
            }
        }).catch(err => console.error("Gagal fetch data user:", err));

        $(document).ready(function() {
            let allUsers = [];

            // Fetch users
            $.ajax({
                url: '/api/list/users',
                type: 'GET',
                success: function(response) {
                    allUsers = response.data || [];
                    const userSelect = $('#userSelect');
                    userSelect.empty().append('<option value="">-- Pilih Pelanggan --</option>');
                    allUsers.forEach(user => {
                        userSelect.append(`<option value="${user.id}">${user.name} (${user.pppoe_username || 'No PPPoE'})</option>`);
                    });
                },
                error: function(xhr) {
                    Swal.fire('Gagal Memuat Pelanggan', xhr.responseJSON ? xhr.responseJSON.message : 'Tidak dapat mengambil daftar pelanggan.', 'error');
                }
            });

            // Fetch packages
            $.ajax({
                url: '/api/list/packages',
                type: 'GET',
                success: function(response) {
                    const packageSelect = $('#packageSelect');
                    packageSelect.empty().append('<option value="">-- Pilih Paket Baru --</option>');
                    (response.data || []).forEach(pkg => {
                        // Tampilkan SEMUA paket untuk request perubahan permanen
                        packageSelect.append(`<option value="${pkg.name}">${pkg.name} (Rp ${new Intl.NumberFormat('id-ID').format(pkg.price)})</option>`);
                    });
                },
                error: function(xhr) {
                    Swal.fire('Gagal Memuat Paket', xhr.responseJSON ? xhr.responseJSON.message : 'Tidak dapat mengambil daftar paket.', 'error');
                }
            });

            // Update current package when user is selected
            $('#userSelect').on('change', function() {
                const selectedUserId = $(this).val();
                const selectedUser = allUsers.find(u => u.id == selectedUserId);
                if (selectedUser) {
                    $('#currentPackage').val(selectedUser.subscription || 'Belum berlangganan');
                } else {
                    $('#currentPackage').val('');
                }
            });

            // Handle form submission
            $('#requestPackageChangeForm').on('submit', function(e) {
                e.preventDefault();
                
                const userId = $('#userSelect').val();
                const newPackageName = $('#packageSelect').val();
                const notes = $('#requestNotes').val().trim();
                const currentPackage = $('#currentPackage').val();
                const selectedUser = allUsers.find(u => u.id == userId);

                if (!userId || !newPackageName) {
                    Swal.fire('Data Tidak Lengkap', 'Silakan pilih pelanggan dan paket baru.', 'warning');
                    return;
                }

                // Konfirmasi sebelum submit
                Swal.fire({
                    title: 'Konfirmasi Permintaan',
                    html: `Anda akan mengajukan perubahan paket untuk:<br><br>` +
                          `<strong>Pelanggan:</strong> ${selectedUser ? selectedUser.name : 'Unknown'}<br>` +
                          `<strong>Paket Saat Ini:</strong> ${currentPackage}<br>` +
                          `<strong>Paket Baru:</strong> ${newPackageName}<br><br>` +
                          `Apakah Anda yakin?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: '#3085d6',
                    cancelButtonColor: '#d33',
                    confirmButtonText: 'Ya, Kirim!',
                    cancelButtonText: 'Batal'
                }).then((result) => {
                    if (result.isConfirmed) {
                        // Disable button dan tampilkan loading
                        const submitBtn = $('#submitBtn');
                        submitBtn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Mengirim...');

                        const formData = {
                            userId: userId,
                            newPackageName: newPackageName,
                            notes: notes
                        };

                        $.ajax({
                            url: '/api/request-package-change',
                            type: 'POST',
                            contentType: 'application/json',
                            data: JSON.stringify(formData),
                            success: function(response) {
                                Swal.fire({
                                    title: 'Berhasil!',
                                    text: response.message,
                                    icon: 'success',
                                    confirmButtonText: 'OK'
                                }).then(() => {
                                    // Reset form
                                    $('#requestPackageChangeForm')[0].reset();
                                    $('#currentPackage').val('');
                                    $('#requestNotes').val('');
                                });
                            },
                            error: function(xhr) {
                                Swal.fire('Gagal!', xhr.responseJSON ? xhr.responseJSON.message : 'Terjadi kesalahan saat mengirim permintaan.', 'error');
                            },
                            complete: function() {
                                // Re-enable button
                                submitBtn.prop('disabled', false).html('<i class="fas fa-paper-plane"></i> Kirim Permintaan');
                            }
                        });
                    }
                });
            });
        });
    </script>
</body>
</html>
