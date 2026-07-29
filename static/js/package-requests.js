/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/package-requests.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/package-requests.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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
    
