/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/teknisi-request-paket.php —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/teknisi-request-paket.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

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
                    userSelect.select2({ placeholder: 'Cari nama atau PPPoE pelanggan...', width: '100%', allowClear: true });
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
                    packageSelect.select2({ placeholder: 'Pilih paket baru', width: '100%' });
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
                                    $('#userSelect, #packageSelect').val('').trigger('change');
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
    
