<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>Speed on Demand Requests - Admin Panel</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/admin-theme.css" rel="stylesheet">
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
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <h1>Speed on Demand Requests</h1>
                                <p>Kelola permintaan penambahan kecepatan sementara dari pelanggan</p>
                            </div>
                            <button class="btn btn-warning-custom" onclick="cleanupExpiredRequests()">
                                <i class="fas fa-broom"></i> Cleanup Expired
                            </button>
                        </div>
                    </div>

                    <!-- Table Section -->
                    <h4 class="dashboard-section-title">Daftar Permintaan</h4>
                    <div class="card table-card mb-4">
                        <div class="card-header">
                            <h6>Permintaan Speed Boost</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered" id="speedRequestTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>ID</th>
                                            <th>Nama Pelanggan</th>
                                            <th>Paket Diminta</th>
                                            <th>Durasi</th>
                                            <th>Harga</th>
                                            <th>Metode Bayar</th>
                                            <th>Status Bayar</th>
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

    <!-- Approve Modal -->
    <div class="modal fade" id="approveModal" tabindex="-1" role="dialog" aria-labelledby="approveModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="approveModalLabel">Setujui Permintaan Penambahan Kecepatan</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <form id="approveForm">
                    <div class="modal-body">
                        <input type="hidden" id="approveRequestId" name="requestId">
                        <p>Anda akan menyetujui permintaan untuk pelanggan: <strong id="modalCustomerName"></strong>.</p>
                        <p>Paket akan diubah ke <strong id="modalRequestedPackage"></strong> untuk durasi <strong id="modalDuration"></strong> dengan harga <strong id="modalPrice"></strong>.</p>
                        <hr>
                         <div class="form-group">
                            <label for="notes">Catatan (Opsional)</label>
                            <textarea class="form-control" id="notes" name="notes" rows="2"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                        <button type="submit" class="btn btn-success"><i class="fas fa-check"></i> Ya, Setujui</button>
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
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>

    <script>
        window.speedRequestTable = null;

        function getSpeedRequestTable() {
            return window.speedRequestTable;
        }

        // Fetch username for topbar
        fetch('/api/me', { credentials: 'include' }).then(res => res.json()).then(data => {
            if (data.data && data.data.username) {
                document.getElementById('usernameTopbar').textContent = data.data.username;
            }
        }).catch(err => console.error("Gagal fetch data user:", err));

        $(document).ready(function() {
            window.speedRequestTable = $('#speedRequestTable').DataTable({
                "processing": true,
                "serverSide": false,
                "ajax": {
                    "url": "/api/speed-requests",
                    "dataSrc": "data",
                    "error": function(xhr, error, thrown) {
                        Swal.fire('Gagal Memuat Data', 'Tidak dapat mengambil daftar permintaan. Coba lagi nanti.', 'error');
                    }
                },
                "columns": [
                    { "data": "id" },
                    { "data": "userName" },
                    { "data": "requestedPackageName" },
                    {
                        "data": "durationKey",
                        "render": function(data) {
                            if (!data) return '-';
                            return data.replace('_', ' ');
                        }
                    },
                    {
                        "data": "price",
                        "render": function(data) {
                            return data ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(data) : '-';
                        }
                    },
                    {
                        "data": "paymentMethod",
                        "render": function(data) {
                            if (!data) return '-';
                            const methods = {
                                'cash': '<span class="badge badge-info">Cash</span>',
                                'transfer': '<span class="badge badge-primary">Transfer</span>',
                                'double_billing': '<span class="badge badge-warning">Double Billing</span>',
                                'free': '<span class="badge badge-success">Gratis</span>'
                            };
                            return methods[data] || data;
                        }
                    },
                    {
                        "data": "paymentStatus",
                        "render": function(data, type, row) {
                            if (!data) return '-';
                            const statuses = {
                                'unpaid': '<span class="badge badge-danger">Belum Bayar</span>',
                                'pending': '<span class="badge badge-warning">Menunggu Verifikasi</span>',
                                'verified': '<span class="badge badge-success">Terverifikasi</span>',
                                'paid': '<span class="badge badge-success">Lunas</span>',
                                'rejected': '<span class="badge badge-danger">Ditolak</span>'
                            };
                            let html = statuses[data] || data;
                            
                            // Add link to payment proof if exists
                            if (row.paymentProof) {
                                html += ` <a href="${row.paymentProof}" target="_blank" class="btn btn-xs btn-info" title="Lihat Bukti">
                                    <i class="fas fa-image"></i>
                                </a>`;
                            }
                            
                            return html;
                        }
                    },
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
                            else if (data === 'active') badgeClass = 'badge-success';
                            else if (data === 'rejected') badgeClass = 'badge-danger';
                            else if (data === 'completed' || data === 'expired') badgeClass = 'badge-info';
                            else if (data && data.startsWith('error')) badgeClass = 'badge-dark';
                            return `<span class="badge ${badgeClass}">${data}</span>`;
                        }
                    },
                    {
                        "data": null,
                        "orderable": false,
                        "render": function(data, type, row) {
                            let buttons = '';
                            
                            // Show verify payment button if payment is pending verification
                            if (row.paymentStatus === 'pending' && row.paymentProof) {
                                buttons += `
                                    <button class="btn btn-sm btn-primary verify-payment-btn" title="Verifikasi Pembayaran"
                                        data-id="${row.id}"
                                        data-customer-name="${row.userName}">
                                        <i class="fas fa-money-check"></i>
                                    </button> `;
                            }
                            
                            // Show approve/reject for pending requests
                            if (row.status === 'pending') {
                                // Only show approve if payment is verified or double billing
                                if (row.paymentStatus === 'verified' || row.paymentMethod === 'double_billing') {
                                    buttons += `
                                        <button class="btn btn-sm btn-success approve-btn" title="Setujui"
                                            data-id="${row.id}"
                                            data-customer-name="${row.userName}"
                                            data-requested-package="${row.requestedPackageName}"
                                            data-duration="${row.durationKey.replace('_', ' ')}"
                                            data-price="${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(row.price)}">
                                            <i class="fas fa-check"></i>
                                        </button> `;
                                }
                                
                                buttons += `
                                    <button class="btn btn-sm btn-danger reject-btn" title="Tolak" data-id="${row.id}">
                                        <i class="fas fa-times"></i>
                                    </button>`;
                            }
                            
                            return buttons || '<span class="text-muted">N/A</span>';
                        }
                    }
                ],
                "order": [[7, "desc"]] // Order by request date
            });

            $('#speedRequestTable tbody').on('click', '.approve-btn', function() {
                var data = $(this).data();
                $('#approveRequestId').val(data.id);
                $('#modalCustomerName').text(data.customerName);
                $('#modalRequestedPackage').text(data.requestedPackage);
                $('#modalDuration').text(data.duration);
                $('#modalPrice').text(data.price);
                $('#approveModal').modal('show');
            });

            $('#approveForm').on('submit', function(e) {
                e.preventDefault();
                var formData = {
                    requestId: $('#approveRequestId').val(),
                    notes: $('#notes').val(),
                    action: 'approve'
                };

                Swal.fire({
                    title: 'Anda yakin?',
                    text: `Anda akan menyetujui permintaan ini. Profil pelanggan akan diubah.`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#28a745',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: 'Ya, setujui!',
                    cancelButtonText: 'Batal'
                }).then((result) => {
                    if (result.isConfirmed) {
                        $.ajax({
                            url: '/api/speed-requests/action',
                            type: 'POST',
                            contentType: 'application/json',
                            data: JSON.stringify(formData),
                            success: function(response) {
                                $('#approveModal').modal('hide');
                                Swal.fire('Berhasil!', response.message, 'success');
                                getSpeedRequestTable()?.ajax.reload();
                            },
                            error: function(xhr) {
                                Swal.fire('Gagal!', xhr.responseJSON.message, 'error');
                            }
                        });
                    }
                });
            });

            $('#speedRequestTable tbody').on('click', '.reject-btn', function() {
                var requestId = $(this).data('id');
                Swal.fire({
                    title: 'Tolak Permintaan?',
                    input: 'text',
                    inputLabel: 'Alasan Penolakan (Opsional)',
                    inputPlaceholder: 'Masukkan alasan penolakan di sini...',
                    showCancelButton: true,
                    confirmButtonText: 'Ya, Tolak',
                    cancelButtonText: 'Batal',
                    confirmButtonColor: '#d33',
                    showLoaderOnConfirm: true,
                    preConfirm: (notes) => {
                        return $.ajax({
                            url: '/api/speed-requests/action',
                            type: 'POST',
                            contentType: 'application/json',
                            data: JSON.stringify({ requestId: requestId, action: 'reject', notes: notes }),
                        }).fail(function(xhr) {
                            Swal.showValidationMessage(`Gagal: ${xhr.responseJSON.message}`);
                        });
                    },
                    allowOutsideClick: () => !Swal.isLoading()
                }).then((result) => {
                    if (result.isConfirmed) {
                        Swal.fire('Ditolak!', 'Permintaan telah ditolak.', 'success');
                        getSpeedRequestTable()?.ajax.reload();
                    }
                });
            });
            
            // Handler for verify payment button
            $('#speedRequestTable tbody').on('click', '.verify-payment-btn', function() {
                var requestId = $(this).data('id');
                var customerName = $(this).data('customer-name');
                
                Swal.fire({
                    title: 'Verifikasi Pembayaran',
                    html: `
                        <p>Verifikasi pembayaran untuk <strong>${customerName}</strong>?</p>
                        <div class="form-group text-left">
                            <label>Catatan (Opsional):</label>
                            <textarea id="payment-notes" class="form-control" rows="2" placeholder="Catatan verifikasi..."></textarea>
                        </div>
                    `,
                    icon: 'question',
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: 'Verifikasi',
                    denyButtonText: 'Tolak',
                    cancelButtonText: 'Batal',
                    confirmButtonColor: '#28a745',
                    denyButtonColor: '#dc3545',
                    preConfirm: () => {
                        const notes = document.getElementById('payment-notes').value;
                        return { verified: true, notes: notes };
                    },
                    preDeny: () => {
                        const notes = document.getElementById('payment-notes').value;
                        if (!notes) {
                            Swal.showValidationMessage('Harap masukkan alasan penolakan');
                            return false;
                        }
                        return { verified: false, notes: notes };
                    }
                }).then((result) => {
                    if (result.isConfirmed || result.isDenied) {
                        const data = result.value || result.deny;
                        
                        $.ajax({
                            url: '/api/speed-requests/verify-payment',
                            type: 'POST',
                            contentType: 'application/json',
                            data: JSON.stringify({
                                requestId: requestId,
                                verified: data.verified,
                                notes: data.notes
                            }),
                            success: function(response) {
                                Swal.fire({
                                    icon: 'success',
                                    title: data.verified ? 'Pembayaran Terverifikasi!' : 'Pembayaran Ditolak',
                                    text: response.message
                                });
                                getSpeedRequestTable()?.ajax.reload();
                            },
                            error: function(xhr) {
                                Swal.fire({
                                    icon: 'error',
                                    title: 'Gagal!',
                                    text: xhr.responseJSON?.message || 'Terjadi kesalahan'
                                });
                            }
                        });
                    }
                });
            });
        });
        
        // Function to cleanup expired requests
        function cleanupExpiredRequests() {
            Swal.fire({
                title: 'Cleanup Expired Requests?',
                text: 'Ini akan membersihkan semua request yang expired dan pending lama (>7 hari)',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Ya, Cleanup!',
                cancelButtonText: 'Batal'
            }).then((result) => {
                if (result.isConfirmed) {
                    $.ajax({
                        url: '/api/speed-requests/cleanup',
                        type: 'POST',
                        success: function(response) {
                            Swal.fire({
                                icon: 'success',
                                title: 'Cleanup Berhasil!',
                                text: response.message || 'Expired requests telah dibersihkan'
                            });
                            getSpeedRequestTable()?.ajax.reload();
                        },
                        error: function(xhr) {
                            Swal.fire({
                                icon: 'error',
                                title: 'Gagal!',
                                text: xhr.responseJSON?.message || 'Terjadi kesalahan saat cleanup'
                            });
                        }
                    });
                }
            });
        }
    </script>
</body>
</html>
