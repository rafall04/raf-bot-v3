/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/speed-requests.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/speed-requests.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        window.speedRequestTable = null;

        function getSpeedRequestTable() {
            return window.speedRequestTable;
        }

        // Fetch username for topbar.
        // `#usernameTopbar` TIDAK ADA di markup halaman ini maupun di topbar.php —
        // kode ini selalu melempar "Cannot set properties of null" dan tertelan
        // .catch() sebagai "Gagal fetch data user", seolah API-nya yang bermasalah.
        // Bug lama (sudah ada sebelum blok ini dieksternalkan); baru terlihat saat
        // konsol diperiksa. Dijaga null supaya tidak menutupi kegagalan fetch ASLI.
        fetch('/api/me', { credentials: 'include' }).then(res => res.json()).then(data => {
            const el = document.getElementById('usernameTopbar');
            if (el && data.data && data.data.username) {
                el.textContent = data.data.username;
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
    
