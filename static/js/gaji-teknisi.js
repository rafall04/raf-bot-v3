/**
 * Gaji Teknisi JavaScript
 */

$(document).ready(function() {
    const bulanNames = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    let gajiTable;
    let createCollectionPayable = 0;
    // Teknisi mana yang nilai prefill di kolom gaji pokok saat ini MILIKI. Dipakai untuk
    // membedakan "operator sedang mengetik untuk teknisi yang sama" dari "teknisinya berganti,
    // angka di kolom milik orang lain".
    let prefillUntukTeknisi = null;
    let editCollectionPayable = 0;
    let createMarketingPayable = 0; // komisi marketing PSB (pemberi lead teknisi) — Fase 2b
    let editMarketingPayable = 0;

    initSelectors();
    initCurrencyInputs();
    loadTeknisiList();
    loadData();

    function formatNumber(num) {
        if (!num && num !== 0) return '';
        return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    function parseNumber(str) {
        if (!str) return 0;
        return parseInt(String(str).replace(/\./g, ''), 10) || 0;
    }

    function formatRupiah(amount) {
        return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
    }

    function getInputValue(selector) {
        return parseNumber($(selector).val());
    }

    function setInputValue(selector, value) {
        $(selector).val(formatNumber(value || 0));
    }

    function showAlert(type, message) {
        const alertHtml = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="close" data-dismiss="alert">&times;</button>
            </div>
        `;
        $('.container-fluid').prepend(alertHtml);
        setTimeout(() => $('.alert').alert('close'), 5000);
    }

    function initSelectors() {
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        for (let month = 1; month <= 12; month += 1) {
            $('#selectMonth, #createMonth').append(`<option value="${month}" ${month === currentMonth ? 'selected' : ''}>${bulanNames[month]}</option>`);
        }

        for (let year = currentYear - 1; year <= currentYear + 1; year += 1) {
            $('#selectYear, #createYear').append(`<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`);
        }
    }

    function initCurrencyInputs() {
        [
            '#createGajiPokok', '#createBonus', '#createPotonganKasbon', '#createPotonganLain',
            '#editGajiPokok', '#editBonus', '#editPotonganKasbon', '#editPotonganLain'
        ].forEach((selector) => {
            $(selector).on('input', function() {
                const cleaned = $(this).val().replace(/\./g, '').replace(/[^0-9]/g, '');
                $(this).val(cleaned ? formatNumber(cleaned) : '');
                if (selector.startsWith('#create')) {
                    calculateCreateTotal();
                } else {
                    calculateEditTotal();
                }
            });
            $(selector).on('blur', function() {
                if (!$(this).val()) {
                    $(this).val('0');
                }
            });
        });
    }

    function loadTeknisiList() {
        $.get('/api/gaji/teknisi').done((response) => {
            if (response.status !== 200) return;
            const select = $('#createTeknisiId');
            select.empty().append('<option value="">-- Pilih Teknisi --</option>');
            (response.data || []).forEach((teknisi) => {
                select.append(`<option value="${teknisi.id}">${teknisi.name}</option>`);
            });
        });
    }

    function loadData() {
        const month = $('#selectMonth').val();
        const year = $('#selectYear').val();
        const status = $('#selectStatus').val();
        loadSummary(month, year);
        loadGajiTable(month, year, status);
    }

    function loadSummary(month, year) {
        $.get('/api/gaji/summary', { month, year }).done((response) => {
            if (response.status !== 200) return;
            const data = response.data;
            $('#totalGaji').text(formatRupiah(data.total_gaji));
            $('#totalRecords').text(`${data.total_records} teknisi`);
            $('#pendingAmount').text(formatRupiah((data.draft_amount || 0) + (data.finalized_amount || 0)));
            $('#pendingCount').text(`${(data.draft_count || 0) + (data.finalized_count || 0)} teknisi`);
            $('#paidAmount').text(formatRupiah(data.paid_amount));
            $('#paidCount').text(`${data.paid_count} teknisi`);
            $('#totalPotongan').text(formatRupiah(data.total_potongan));
        });
    }

    function loadGajiTable(month, year, status) {
        const params = { month, year };
        if (status) params.status = status;
        $.get('/api/gaji', params)
            .done((response) => {
                if (response.status === 200) {
                    renderTable(response.data || []);
                }
            })
            .fail(() => showAlert('danger', 'Gagal memuat data payroll teknisi'));
    }

    function getStatusBadge(status) {
        const badges = {
            draft: '<span class="badge badge-pending">Draft</span>',
            finalized: '<span class="badge badge-info">Finalized</span>',
            paid: '<span class="badge badge-paid">Sudah Dibayar</span>'
        };
        return badges[status] || `<span class="badge badge-secondary">${status}</span>`;
    }

    function renderTable(data) {
        if (gajiTable) {
            gajiTable.destroy();
        }
        const tbody = $('#gajiTable tbody');
        tbody.empty();

        data.forEach((gaji) => {
            let actions = `<button class="btn btn-info btn-sm" onclick="viewDetail(${gaji.id})" title="Detail"><i class="fas fa-eye"></i></button> `;
            if (gaji.status === 'draft') {
                actions += `<button class="btn btn-primary btn-sm" onclick="editGaji(${gaji.id})" title="Edit"><i class="fas fa-edit"></i></button> `;
                actions += `<button class="btn btn-warning btn-sm" onclick="finalizeGaji(${gaji.id})" title="Finalize"><i class="fas fa-lock"></i></button> `;
                actions += `<button class="btn btn-danger btn-sm" onclick="deleteGaji(${gaji.id})" title="Hapus"><i class="fas fa-trash"></i></button>`;
            } else if (gaji.status === 'finalized') {
                actions += `<button class="btn btn-success btn-sm" onclick="payGaji(${gaji.id})" title="Bayar"><i class="fas fa-money-bill-wave"></i></button>`;
            }

            const pendapatan = [];
            if ((gaji.bonus || 0) > 0) pendapatan.push(`<small class="d-block text-success">Bonus: ${formatRupiah(gaji.bonus)}</small>`);
            if ((gaji.komisi_collection || 0) !== 0) pendapatan.push(`<small class="d-block text-info">Collection: ${formatRupiah(gaji.komisi_collection)}</small>`);
            if ((gaji.komisi_marketing || 0) !== 0) pendapatan.push(`<small class="d-block text-info">Marketing PSB: ${formatRupiah(gaji.komisi_marketing)}</small>`);

            const potongan = [];
            if ((gaji.potongan_kasbon || 0) > 0) potongan.push(`<small class="d-block text-danger">Kasbon: ${formatRupiah(gaji.potongan_kasbon)}</small>`);
            if ((gaji.potongan_lain || 0) > 0) potongan.push(`<small class="d-block text-danger">Lain: ${formatRupiah(gaji.potongan_lain)}</small>`);

            tbody.append(`
                <tr>
                    <td><strong>${gaji.teknisi_name}</strong></td>
                    <td>${bulanNames[gaji.period_month]} ${gaji.period_year}</td>
                    <td>${formatRupiah(gaji.gaji_pokok)}</td>
                    <td>${pendapatan.join('') || '-'}</td>
                    <td>${potongan.join('') || '-'}</td>
                    <td><strong class="text-primary">${formatRupiah(gaji.total_gaji)}</strong></td>
                    <td>${getStatusBadge(gaji.status)}</td>
                    <td>${actions}</td>
                </tr>
            `);
        });

        gajiTable = $('#gajiTable').DataTable({
            order: [[1, 'desc']],
            language: { url: '//cdn.datatables.net/plug-ins/1.10.24/i18n/Indonesian.json' },
            pageLength: 25
        });
    }

    function calculateCreateTotal() {
        const total = getInputValue('#createGajiPokok')
            + getInputValue('#createBonus')
            + createCollectionPayable
            + createMarketingPayable
            - getInputValue('#createPotonganKasbon')
            - getInputValue('#createPotonganLain');
        $('#createTotalPreview').text(formatRupiah(total));
    }

    function calculateEditTotal() {
        const total = getInputValue('#editGajiPokok')
            + getInputValue('#editBonus')
            + editCollectionPayable
            + editMarketingPayable
            - getInputValue('#editPotonganKasbon')
            - getInputValue('#editPotonganLain');
        $('#editTotalPreview').text(formatRupiah(total));
    }

    $('#applyFilterBtn, #refreshBtn').click(loadData);

    $('#createTeknisiId').change(function() {
        const teknisiId = $(this).val();
        if (!teknisiId) {
            createCollectionPayable = 0;
            $('#kasbonInfo').text('Saldo hutang aktif: Rp 0');
            $('#collectionInfo').text('Komisi collection periode ini: Rp 0');
            calculateCreateTotal();
            return;
        }
        $.get(`/api/gaji/kasbon-summary/${teknisiId}`, {
            month: $('#createMonth').val(),
            year: $('#createYear').val()
        }).done((response) => {
            if (response.status !== 200) return;
            createCollectionPayable = response.data.komisi_collection || 0;
            createMarketingPayable = response.data.komisi_marketing || 0;
            $('#kasbonInfo').text(`Saldo hutang aktif: ${formatRupiah(response.data.total_kasbon || 0)}`);
            $('#collectionInfo').text(`Komisi collection: ${formatRupiah(createCollectionPayable)} · marketing PSB: ${formatRupiah(createMarketingPayable)}`);

            // Prefill gaji pokok dari payroll TERAKHIR teknisi ini.
            //
            // Kalau TEKNISINYA BERGANTI, kolom SELALU ditimpa — angka yang ada di sana milik
            // orang lain, dan mempertahankannya tak pernah benar. Dulu penjaganya
            // `!sekarang || Number(sekarang) === 0`, padahal nilainya sudah terformat
            // ("1.500.000") sehingga `Number()` memulangkan NaN dan kedua syarat gagal:
            // ganti teknisi setelah submit ditolak 409 meninggalkan gaji pokok teknisi
            // SEBELUMNYA, dengan baris keterangan yang justru menampilkan angka yang benar —
            // bertentangan dengan isi kolomnya. Draft tersimpan dengan gaji orang lain,
            // ikut ke finalisasi, struk, dan uang yang benar-benar ditransfer.
            //
            // Untuk teknisi yang SAMA, angka yang sedang diketik operator tetap dihormati.
            const terakhir = Number(response.data.gaji_pokok_terakhir) || 0;
            const jejak = $('#gajiPokokInfo');
            const gantiTeknisi = String(teknisiId) !== String(prefillUntukTeknisi);
            const kosong = !getInputValue('#createGajiPokok');

            if (gantiTeknisi || kosong) {
                setInputValue('#createGajiPokok', terakhir);
                jejak.text(terakhir > 0
                    ? `Diisi dari payroll ${response.data.periode_terakhir} (${formatRupiah(terakhir)}) — ubah kalau berbeda.`
                    : 'Belum ada payroll sebelumnya untuk teknisi ini — isi manual.');
            } else if (terakhir > 0) {
                jejak.text(`Payroll ${response.data.periode_terakhir}: ${formatRupiah(terakhir)}`);
            } else {
                jejak.text('Belum ada payroll sebelumnya untuk teknisi ini.');
            }
            prefillUntukTeknisi = teknisiId;
            calculateCreateTotal();
        });
    });

    $('#createMonth, #createYear').change(function() {
        $('#createTeknisiId').trigger('change');
    });

    $('#submitCreateGaji').click(function() {
        const teknisiId = $('#createTeknisiId').val();
        if (!teknisiId || !$('#createMonth').val() || !$('#createYear').val()) {
            showAlert('warning', 'Pilih teknisi, bulan, dan tahun');
            return;
        }

        const data = {
            teknisi_id: teknisiId,
            period_month: $('#createMonth').val(),
            period_year: $('#createYear').val(),
            gaji_pokok: getInputValue('#createGajiPokok'),
            bonus: getInputValue('#createBonus'),
            potongan_kasbon: getInputValue('#createPotonganKasbon'),
            potongan_lain: getInputValue('#createPotonganLain'),
            potongan_lain_keterangan: $('#createPotonganLainKet').val(),
            notes: $('#createNotes').val()
        };

        $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');
        $.ajax({
            url: '/api/gaji',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(data)
        }).done((response) => {
            if (response.status === 201) {
                showAlert('success', 'Draft payroll berhasil dibuat');
                $('#createGajiModal').modal('hide');
                resetCreateForm();
                loadData();
            } else {
                showAlert('danger', response.message || 'Gagal membuat draft payroll');
            }
        }).fail((xhr) => {
            showAlert('danger', xhr.responseJSON?.message || 'Terjadi kesalahan');
        }).always(() => {
            $('#submitCreateGaji').prop('disabled', false).html('<i class="fas fa-save"></i> Simpan');
        });
    });

    function resetCreateForm() {
        $('#createGajiForm')[0].reset();
        setInputValue('#createGajiPokok', 0);
        setInputValue('#createBonus', 0);
        setInputValue('#createPotonganKasbon', 0);
        setInputValue('#createPotonganLain', 0);
        $('#createTotalPreview').text('Rp 0');
        $('#kasbonInfo').text('Saldo hutang aktif: Rp 0');
        $('#collectionInfo').text('Komisi collection periode ini: Rp 0');
        createCollectionPayable = 0;
        createMarketingPayable = 0;
        // Lupakan pemilik prefill: form kosong tak lagi mewakili teknisi mana pun.
        prefillUntukTeknisi = null;
        $("#gajiPokokInfo").text("");
    }

    window.viewDetail = function(id) {
        $.get('/api/gaji', { id }).done((response) => {
            const gaji = (response.data || [])[0];
            if (!gaji) return;
            $('#detailGajiContent').html(`
                <div class="text-center mb-3">
                    <h5>${gaji.teknisi_name}</h5>
                    <p class="text-muted">${bulanNames[gaji.period_month]} ${gaji.period_year}</p>
                </div>
                <table class="table table-sm">
                    <tr><td>Gaji Pokok</td><td class="text-right">${formatRupiah(gaji.gaji_pokok)}</td></tr>
                    <tr><td>Bonus Manual</td><td class="text-right text-success">${formatRupiah(gaji.bonus)}</td></tr>
                    <tr><td>Komisi Collection</td><td class="text-right text-info">${formatRupiah(gaji.komisi_collection || 0)}</td></tr>
                    <tr><td>Komisi Marketing PSB</td><td class="text-right text-info">${formatRupiah(gaji.komisi_marketing || 0)}</td></tr>
                    <tr><td>Gross</td><td class="text-right">${formatRupiah(gaji.gross_amount || 0)}</td></tr>
                    <tr><td>Potongan Kasbon</td><td class="text-right text-danger">-${formatRupiah(gaji.potongan_kasbon || 0)}</td></tr>
                    <tr><td>Potongan Lain</td><td class="text-right text-danger">-${formatRupiah(gaji.potongan_lain || 0)}</td></tr>
                    ${gaji.potongan_lain_keterangan ? `<tr><td colspan="2"><small class="text-muted">Ket: ${gaji.potongan_lain_keterangan}</small></td></tr>` : ''}
                    <tr class="font-weight-bold"><td>Nett Gaji</td><td class="text-right text-primary">${formatRupiah(gaji.total_gaji)}</td></tr>
                </table>
                <hr>
                <small class="text-muted">
                    Status: ${getStatusBadge(gaji.status)}<br>
                    Dibuat oleh: ${gaji.created_by_name || '-'}<br>
                    Tanggal dibuat: ${gaji.created_at ? new Date(gaji.created_at).toLocaleString('id-ID') : '-'}
                    ${gaji.finalized_at ? `<br>Finalized pada: ${new Date(gaji.finalized_at).toLocaleString('id-ID')}` : ''}
                    ${gaji.finalized_by_name ? `<br>Finalized oleh: ${gaji.finalized_by_name}` : ''}
                    ${gaji.paid_at ? `<br>Dibayar pada: ${new Date(gaji.paid_at).toLocaleString('id-ID')}` : ''}
                    ${gaji.paid_by_name ? `<br>Dibayar oleh: ${gaji.paid_by_name}` : ''}
                </small>
                ${gaji.notes ? `<hr><small><strong>Catatan:</strong> ${gaji.notes}</small>` : ''}
            `);
            $('#detailGajiModal').modal('show');
        });
    };

    window.editGaji = function(id) {
        $.get('/api/gaji', { id }).done((response) => {
            const gaji = (response.data || [])[0];
            if (!gaji) return;
            editCollectionPayable = gaji.komisi_collection || 0;
            editMarketingPayable = gaji.komisi_marketing || 0;
            $('#editGajiId').val(gaji.id);
            $('#editTeknisiName').val(gaji.teknisi_name);
            $('#editPeriode').val(`${bulanNames[gaji.period_month]} ${gaji.period_year}`);
            setInputValue('#editGajiPokok', gaji.gaji_pokok);
            setInputValue('#editBonus', gaji.bonus);
            setInputValue('#editPotonganKasbon', gaji.potongan_kasbon);
            setInputValue('#editPotonganLain', gaji.potongan_lain);
            $('#editPotonganLainKet').val(gaji.potongan_lain_keterangan || '');
            $('#editNotes').val(gaji.notes || '');
            $('#editCollectionInfo').text(`Komisi collection terkunci: ${formatRupiah(editCollectionPayable)}`);
            calculateEditTotal();
            $('#editGajiModal').modal('show');
        });
    };

    $('#submitEditGaji').click(function() {
        const id = $('#editGajiId').val();
        const data = {
            gaji_pokok: getInputValue('#editGajiPokok'),
            bonus: getInputValue('#editBonus'),
            potongan_kasbon: getInputValue('#editPotonganKasbon'),
            potongan_lain: getInputValue('#editPotonganLain'),
            potongan_lain_keterangan: $('#editPotonganLainKet').val(),
            notes: $('#editNotes').val()
        };

        $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');
        $.ajax({
            url: `/api/gaji/${id}`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify(data)
        }).done((response) => {
            if (response.status === 200) {
                showAlert('success', 'Draft payroll berhasil diupdate');
                $('#editGajiModal').modal('hide');
                loadData();
            } else {
                showAlert('danger', response.message || 'Gagal update draft payroll');
            }
        }).fail((xhr) => {
            showAlert('danger', xhr.responseJSON?.message || 'Terjadi kesalahan');
        }).always(() => {
            $('#submitEditGaji').prop('disabled', false).html('<i class="fas fa-save"></i> Simpan Perubahan');
        });
    });

    // Finalisasi mengunci komisi ke payroll ini dan TIDAK bisa dibatalkan lewat halaman.
    // Kunci di sisi klien supaya klik ganda tak mengirim dua permintaan sebelum tabel
    // sempat menyembunyikan tombolnya — dulu permintaan kedua mengosongkan komisi.
    const finalisasiBerjalan = new Set();
    window.finalizeGaji = function(id) {
        if (finalisasiBerjalan.has(id)) return;
        if (!window.confirm('Finalisasi payroll ini? Komisi penarikan & marketing akan dikunci ke payroll ini dan tidak bisa diubah lagi.')) return;
        finalisasiBerjalan.add(id);
        $(`button[onclick="finalizeGaji(${id})"]`).prop('disabled', true);
        $.ajax({
            url: `/api/gaji/${id}/finalize`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({})
        }).done((response) => {
            if (response.status === 200) {
                showAlert('success', 'Payroll berhasil difinalisasi');
                loadData();
            } else {
                showAlert('danger', response.message || 'Gagal memfinalisasi payroll');
            }
        }).fail((xhr) => {
            showAlert('danger', xhr.responseJSON?.message || 'Terjadi kesalahan');
        }).always(() => {
            finalisasiBerjalan.delete(id);
        });
    };

    window.payGaji = function(id) {
        $.get('/api/gaji', { id }).done((response) => {
            const gaji = (response.data || [])[0];
            if (!gaji) return;
            $('#payGajiId').val(gaji.id);
            $('#payTeknisiName').text(gaji.teknisi_name);
            $('#payPeriode').text(`${bulanNames[gaji.period_month]} ${gaji.period_year}`);
            $('#payTotalGaji').text(formatRupiah(gaji.total_gaji));
            $('#payDeductKasbon').prop('checked', gaji.potongan_kasbon > 0).prop('disabled', true);
            $('#payNotes').val('');
            $('#payGajiModal').modal('show');
        });
    };

    $('#submitPayGaji').click(function() {
        const id = $('#payGajiId').val();
        $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Memproses...');
        $.ajax({
            url: `/api/gaji/${id}/pay`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({ notes: $('#payNotes').val() })
        }).done((response) => {
            if (response.status === 200) {
                showAlert('success', 'Payroll berhasil dibayar');
                $('#payGajiModal').modal('hide');
                loadData();
            } else {
                showAlert('danger', response.message || 'Gagal membayar payroll');
            }
        }).fail((xhr) => {
            showAlert('danger', xhr.responseJSON?.message || 'Terjadi kesalahan');
        }).always(() => {
            $('#submitPayGaji').prop('disabled', false).html('<i class="fas fa-check"></i> Konfirmasi Pembayaran');
        });
    });

    window.deleteGaji = function(id) {
        if (!confirm('Yakin ingin menghapus draft payroll ini?')) return;
        $.ajax({ url: `/api/gaji/${id}`, method: 'DELETE' })
            .done((response) => {
                if (response.status === 200) {
                    showAlert('success', 'Draft payroll berhasil dihapus');
                    loadData();
                } else {
                    showAlert('danger', response.message || 'Gagal menghapus draft payroll');
                }
            })
            .fail((xhr) => showAlert('danger', xhr.responseJSON?.message || 'Terjadi kesalahan'));
    };
});
