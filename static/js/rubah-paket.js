/**
 * Rubah Paket Pelanggan JavaScript
 * Simple approach: Select2 dropdown for user selection
 */

$(document).ready(function() {
    let packages = [];
    let selectedUser = null;

    // Initialize
    loadPackages();
    initUserSelect();
    loadHistory();

    // Initialize Select2 for user selection
    function initUserSelect() {
        $('#userSelect').select2({
            theme: 'bootstrap4',
            placeholder: 'Ketik nama atau ID pelanggan...',
            allowClear: true,
            minimumInputLength: 1,
            ajax: {
                url: '/api/users',
                dataType: 'json',
                delay: 250,
                data: function(params) {
                    return { search: params.term };
                },
                processResults: function(response) {
                    if (response.status !== 200 || !response.data) {
                        return { results: [] };
                    }
                    
                    const term = ($('#userSelect').data('select2').$dropdown.find('input').val() || '').toLowerCase();
                    
                    // Filter users based on search term
                    const filtered = response.data.filter(function(user) {
                        const name = (user.name || '').toLowerCase();
                        const id = String(user.id);
                        const pppoe = (user.pppoe_username || '').toLowerCase();
                        return name.includes(term) || id.includes(term) || pppoe.includes(term);
                    }).slice(0, 20);
                    
                    return {
                        results: filtered.map(function(user) {
                            const isPaid = user.paid === true || user.paid === 1;
                            return {
                                id: user.id,
                                text: user.name + ' (ID: ' + user.id + ')',
                                user: user,
                                paid: isPaid
                            };
                        })
                    };
                },
                cache: true
            },
            templateResult: function(data) {
                if (data.loading) return 'Mencari...';
                if (!data.user) return data.text;
                
                const user = data.user;
                const isPaid = data.paid;
                return $('<div class="d-flex justify-content-between align-items-center">' +
                    '<div><strong>' + user.name + '</strong><br><small class="text-muted">ID: ' + user.id + ' | ' + (user.subscription || 'Tanpa Paket') + '</small></div>' +
                    '<span class="badge badge-' + (isPaid ? 'success' : 'warning') + '">' + (isPaid ? 'Lunas' : 'Belum') + '</span>' +
                    '</div>');
            }
        });

        // On user select
        $('#userSelect').on('select2:select', function(e) {
            selectedUser = e.params.data.user;
            showUserInfo(selectedUser);
        });

        // On clear
        $('#userSelect').on('select2:clear', function() {
            selectedUser = null;
            hideUserInfo();
        });
    }

    // Show selected user info
    function showUserInfo(user) {
        $('#currentPackage').val(user.subscription || '-');
        $('#userInfoContent').html(
            '<div class="row">' +
            '<div class="col-6"><small class="text-muted">ID:</small> <strong>' + user.id + '</strong></div>' +
            '<div class="col-6"><small class="text-muted">PPPoE:</small> <strong>' + (user.pppoe_username || '-') + '</strong></div>' +
            '</div>' +
            '<div class="row mt-1">' +
            '<div class="col-6"><small class="text-muted">Telepon:</small> <strong>' + (user.phone_number || '-') + '</strong></div>' +
            '<div class="col-6"><small class="text-muted">Harga:</small> <strong>Rp ' + formatNumber(user.subscription_price || 0) + '</strong></div>' +
            '</div>'
        );
        $('#selectedUserInfo').show();
        validateForm();
    }

    // Hide user info
    function hideUserInfo() {
        $('#currentPackage').val('');
        $('#selectedUserInfo').hide();
        validateForm();
    }

    // Load packages
    function loadPackages() {
        $.get('/api/change-package/packages')
            .done(function(response) {
                if (response.status === 200) {
                    packages = response.data;
                    var select = $('#newPackage');
                    select.empty().append('<option value="">-- Pilih Paket Baru --</option>');
                    packages.forEach(function(p) {
                        select.append('<option value="' + p.name + '" data-price="' + p.price + '">' + p.name + ' - Rp ' + formatNumber(p.price) + '</option>');
                    });
                }
            });
    }

    // Format number
    function formatNumber(num) {
        return (num || 0).toLocaleString('id-ID');
    }

    // Package change handler
    $('#newPackage').change(function() {
        var price = $(this).find(':selected').data('price');
        if (price) {
            $('#packagePriceInfo').html('<i class="fas fa-tag"></i> Harga: <strong>Rp ' + formatNumber(price) + '/bulan</strong>');
        } else {
            $('#packagePriceInfo').text('');
        }
        validateForm();
    });

    // Validate form
    function validateForm() {
        var hasUser = selectedUser !== null;
        var newPackage = $('#newPackage').val();
        var currentPackage = $('#currentPackage').val();
        var isValid = hasUser && newPackage && newPackage !== currentPackage;
        $('#submitBtn').prop('disabled', !isValid);
    }

    // Submit form
    $('#changePackageForm').submit(function(e) {
        e.preventDefault();
        if (!selectedUser) return;

        var newPackage = $('#newPackage').val();
        var syncMikrotik = $('#syncMikrotik').is(':checked');
        var notes = $('#changeNotes').val();

        Swal.fire({
            title: 'Konfirmasi Perubahan',
            html: '<p>Ubah paket untuk <strong>' + selectedUser.name + '</strong>?</p>' +
                  '<p>Paket Lama: ' + (selectedUser.subscription || '-') + '<br>Paket Baru: ' + newPackage + '</p>',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Ya, Ubah',
            cancelButtonText: 'Batal'
        }).then(function(result) {
            if (result.isConfirmed) {
                $('#submitBtn').prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');
                
                $.ajax({
                    url: '/api/change-package/' + selectedUser.id,
                    method: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify({
                        new_package: newPackage,
                        sync_mikrotik: syncMikrotik,
                        notes: notes
                    })
                })
                .done(function(response) {
                    if (response.status === 200) {
                        const data = response.data || {};
                        const syncStatus = data.sync_status || response.sync_status;
                        const syncMessage = data.sync_message || response.sync_message;
                        const syncDetails = syncMessage
                            ? `<br><small class="text-muted">${syncMessage}</small>`
                            : '';
                        const title = syncStatus === 'applied_locally_sync_disabled'
                            ? 'Tersimpan Lokal'
                            : 'Berhasil!';

                        // Status notifikasi WhatsApp ke pelanggan.
                        let notifyLine = '';
                        const notify = data.notify;
                        if (notify) {
                            if (notify.skipped === 'no_phone') {
                                notifyLine = '<br><small class="text-warning"><i class="fas fa-exclamation-triangle"></i> Pelanggan tidak punya nomor WA — tidak dinotifikasi.</small>';
                            } else if (notify.notified && (notify.queued || 0) === 0) {
                                notifyLine = '<br><small class="text-success"><i class="fas fa-check-circle"></i> Pelanggan sudah diberi tahu via WhatsApp.</small>';
                            } else if ((notify.delivered || 0) > 0) {
                                notifyLine = `<br><small class="text-success"><i class="fas fa-check-circle"></i> ${notify.delivered}/${notify.total} nomor diberi tahu via WhatsApp.</small>`;
                            } else {
                                notifyLine = '<br><small class="text-warning"><i class="fas fa-clock"></i> Notifikasi WA masuk antrian — akan dikirim ulang otomatis saat WhatsApp tersambung.</small>';
                            }
                        }

                        Swal.fire({
                            icon: syncStatus === 'failed_sync' ? 'warning' : 'success',
                            title,
                            html: `Paket berhasil diubah${syncDetails}${notifyLine}`
                        });
                        resetForm();
                        loadHistory();
                    } else {
                        Swal.fire('Gagal', response.message || 'Gagal mengubah paket', 'error');
                    }
                })
                .fail(function(xhr) {
                    Swal.fire('Error', xhr.responseJSON?.message || 'Terjadi kesalahan', 'error');
                })
                .always(function() {
                    $('#submitBtn').prop('disabled', false).html('<i class="fas fa-save mr-1"></i> Simpan Perubahan');
                    validateForm();
                });
            }
        });
    });

    // Reset form
    function resetForm() {
        selectedUser = null;
        $('#userSelect').val(null).trigger('change');
        $('#changePackageForm')[0].reset();
        $('#currentPackage').val('');
        $('#selectedUserInfo').hide();
        $('#packagePriceInfo').text('');
        $('#submitBtn').prop('disabled', true);
    }

    // Load history
    function loadHistory() {
        $.get('/api/activity-logs', { resource_type: 'package_change', limit: 50 })
            .done(function(response) {
                if (response.status === 200) {
                    renderHistory(response.data || []);
                }
            });
    }
    window.loadHistory = loadHistory;

    // Render history
    function renderHistory(data) {
        var tbody = $('#historyTable tbody');
        tbody.empty();

        if (data.length === 0) {
            tbody.append('<tr><td colspan="5" class="text-center text-muted">Belum ada riwayat</td></tr>');
            return;
        }

        data.forEach(function(log) {
            var oldPkg = '-', newPkg = '-';
            try {
                if (log.old_value) {
                    var old = typeof log.old_value === 'string' ? JSON.parse(log.old_value) : log.old_value;
                    oldPkg = old.subscription || '-';
                }
                if (log.new_value) {
                    var newVal = typeof log.new_value === 'string' ? JSON.parse(log.new_value) : log.new_value;
                    newPkg = newVal.subscription || '-';
                }
            } catch (_e) {}

            var time = log.created_at ? new Date(log.created_at).toLocaleString('id-ID') : '-';
            tbody.append(
                '<tr>' +
                '<td><small>' + time + '</small></td>' +
                '<td><strong>' + (log.resource_name || '-') + '</strong></td>' +
                '<td><span class="badge badge-secondary">' + oldPkg + '</span></td>' +
                '<td><span class="badge badge-primary">' + newPkg + '</span></td>' +
                '<td><small>' + (log.username || '-') + '</small></td>' +
                '</tr>'
            );
        });

        if ($.fn.DataTable.isDataTable('#historyTable')) {
            $('#historyTable').DataTable().destroy();
        }
        $('#historyTable').DataTable({
            order: [[0, 'desc']],
            pageLength: 10
        });
    }
});
