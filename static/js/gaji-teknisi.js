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
        // `.alert-sesaat` WAJIB: penutup otomatis di bawah dulu menyapu SEMUA `.alert` di
        // halaman — termasuk spanduk payroll belum dibayar dan peringatan permanen lain, yang
        // memang berkelas `alert`. Bootstrap MENGHAPUS elemennya dari DOM, jadi satu notifikasi
        // membuat spanduk itu lenyap selamanya sampai halaman dimuat ulang.
        const alertHtml = `
            <div class="alert alert-${type} alert-dismissible alert-sesaat fade show" role="alert">
                ${message}
                <button type="button" class="close" data-dismiss="alert">&times;</button>
            </div>
        `;
        const el = $(alertHtml);
        $('.container-fluid').prepend(el);
        // Notifikasi dirender di PUNCAK halaman; kalau operator sedang menatap kartu di bawah,
        // pesan yang menjelaskan kenapa sesuatu gagal tak pernah terlihat — dan hasilnya
        // terbaca sebagai "tombolnya tidak melakukan apa-apa".
        if (el[0] && typeof el[0].scrollIntoView === 'function') {
            el[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setTimeout(() => $('.alert-sesaat').alert('close'), 6000);
    }

    /** Umpan balik DI TEMPAT operator menekan tombolnya, bukan hanya di puncak halaman. */
    function kabarGajiTetap(tipe, pesan) {
        $('#gajiTetapHasil')
            .removeClass('text-success text-danger text-warning')
            .addClass(tipe === 'success' ? 'text-success' : tipe === 'danger' ? 'text-danger' : 'text-warning')
            .text(pesan);
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
            const selectTertunda = $('#tertundaTeknisiId');
            select.empty().append('<option value="">-- Pilih Teknisi --</option>');
            selectTertunda.empty().append('<option value="">-- Pilih Teknisi --</option>');
            (response.data || []).forEach((teknisi) => {
                select.append(`<option value="${teknisi.id}">${teknisi.name}</option>`);
                selectTertunda.append(`<option value="${teknisi.id}">${teknisi.name}</option>`);
            });
            cariTeknisiBerkomisiTertunda(response.data || []);
        });
        muatRiwayatTutup();
        muatGajiTetap();
    }

    // ── Gaji pokok tetap ───────────────────────────────────────────────────────────────────
    // Nominalnya sama tiap bulan. Diisi sekali di sini, lalu draft bulan berjalan dibuat sendiri.

    let gajiTetapData = null;
    // Sisa hutang per teknisi, dipakai menandai baris payroll yang belum memotong kasbon.
    const kasbonPerTeknisi = {};

    function muatGajiTetap() {
        $.get('/api/gaji/gaji-tetap').done((response) => {
            if (response.status !== 200) return;
            gajiTetapData = response.data;
            renderGajiTetap();
            renderSpandukBelumDibayar(response.data.belum_dibayar || []);
        });
    }

    function renderGajiTetap() {
        const { teknisi, setelan } = gajiTetapData;
        const baris = teknisi.map((t) => `
            <div class="form-group row align-items-center mb-2" data-teknisi="${t.teknisi_id}">
                <label class="col-sm-4 col-form-label font-weight-bold mb-0">${t.name}</label>
                <div class="col-sm-8">
                    <div class="input-group">
                        <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                        <input type="text" class="form-control gaji-tetap-input" value="${formatNumber(t.gaji_pokok)}" placeholder="0">
                    </div>
                </div>
            </div>`).join('');
        $('#gajiTetapRows').html(baris || '<div class="text-muted">Belum ada akun teknisi.</div>');
        $('#gajiTetapOtomatis').prop('checked', setelan.autoDraft === true);
        $('#gajiTetapJadwalInfo').text(setelan.autoDraft
            ? `Draft bulan berjalan dibuat tiap tanggal ${setelan.draftDay}.`
            : `Kalau dinyalakan, draft bulan berjalan dibuat tiap tanggal ${setelan.draftDay}.`);
        perbaruiPeringatanOtomatisMati();
    }

    // Nilai tersimpan tapi sakelar mati = persis sama dengan hari ini: nol draft, selamanya.
    // Judul kartunya sendiri berjanji "isi sekali", jadi janji itu harus ditarik dengan jelas.
    function perbaruiPeringatanOtomatisMati() {
        if (!gajiTetapData) return;
        const adaNilai = (gajiTetapData.teknisi || []).some((t) => Number(t.gaji_pokok) > 0);
        const mati = !$('#gajiTetapOtomatis').is(':checked');
        $('#gajiTetapPeringatanMati').toggle(adaNilai && mati);
    }

    function renderSpandukBelumDibayar(rows) {
        if (!rows || rows.length === 0) {
            $('#spandukBelumDibayar').hide();
            return;
        }
        const teks = rows.map((r) =>
            `<a href="#" class="badge badge-light mr-1 spanduk-periode" data-bulan="${r.period_month}" data-tahun="${r.period_year}">
                ${bulanNames[r.period_month]} ${r.period_year} — ${r.teknisi_name} ${formatRupiah(r.net_amount)}
            </a>`).join(' ');
        $('#spandukIsi').html(' ' + teks);
        $('#spandukBelumDibayar').show();
    }

    // Klik periode di spanduk = setel filter ke bulan itu. Tanpa ini pemilik harus menebak
    // bulan mana yang harus dipilih untuk melihat payroll yang diberitahukan spanduk.
    $(document).on('click', '.spanduk-periode', function(e) {
        e.preventDefault();
        $('#selectMonth').val($(this).data('bulan'));
        $('#selectYear').val($(this).data('tahun'));
        loadData();
    });

    // initCurrencyInputs mengikat selector statis; baris gaji tetap dirender belakangan.
    $(document).on('input', '.gaji-tetap-input', function() {
        const bersih = $(this).val().replace(/\./g, '').replace(/[^0-9]/g, '');
        $(this).val(bersih ? formatNumber(bersih) : '');
    });

    $(document).on('click', '#simpanGajiTetap', function() {
        const semua = $('#gajiTetapRows [data-teknisi]').map(function() {
            return {
                teknisi_id: $(this).data('teknisi'),
                nama: $(this).find('label').text().trim(),
                mentah: String($(this).find('.gaji-tetap-input').val() || '').trim(),
                gaji_pokok: parseNumber($(this).find('.gaji-tetap-input').val())
            };
        }).get();

        // Tak ada jalur diam. Dulu daftar kosong berarti "return" tanpa permintaan apa pun dan
        // pesannya dirender di puncak halaman yang sedang tak dilihat operator — hasilnya
        // terbaca sebagai "tombolnya tidak melakukan apa-apa".
        if (semua.length === 0) {
            kabarGajiTetap('danger', 'Daftar teknisi belum termuat. Muat ulang halaman lalu coba lagi.');
            showAlert('danger', 'Daftar teknisi belum termuat — muat ulang halaman.');
            return;
        }
        const kosong = semua.filter((i) => i.gaji_pokok <= 0);
        if (kosong.length === semua.length) {
            const contoh = semua.map((i) => `${i.nama}: "${i.mentah}"`).join(', ');
            kabarGajiTetap('warning', `Belum ada nominal yang terbaca sebagai angka (${contoh}). Ketik angkanya saja, contoh: 250000.`);
            return;
        }

        const items = semua.filter((i) => i.gaji_pokok > 0).map((i) => ({ teknisi_id: i.teknisi_id, gaji_pokok: i.gaji_pokok }));
        const tombol = $(this).prop('disabled', true);
        kabarGajiTetap('warning', 'Menyimpan...');
        $.ajax({ url: '/api/gaji/gaji-tetap', method: 'PUT', contentType: 'application/json', data: JSON.stringify({ items }) })
            // Pesan sukses MENGULANG nominal terformat: kolom mata uang membuang huruf, jadi
            // "250rb" menjadi 250 dan tersimpan diam-diam sebagai Rp250.
            .done((r) => {
                const lewat = kosong.length ? ` (${kosong.map((i) => i.nama).join(', ')} dilewati karena kosong)` : '';
                kabarGajiTetap('success', r.message + lewat);
                showAlert('success', r.message + lewat);
                muatGajiTetap();
            })
            .fail((xhr) => {
                const pesan = (xhr.responseJSON && xhr.responseJSON.message) || `Gagal menyimpan (HTTP ${xhr.status || 'tak ada respons'})`;
                kabarGajiTetap('danger', pesan);
                showAlert('danger', pesan);
            })
            .always(() => tombol.prop('disabled', false));
    });

    $(document).on('change', '#gajiTetapOtomatis', function() {
        const nyala = $(this).is(':checked');
        const sakelar = $(this).prop('disabled', true);
        $.ajax({ url: '/api/gaji/gaji-tetap/otomatis', method: 'PUT', contentType: 'application/json', data: JSON.stringify({ enabled: nyala }) })
            .done((r) => { showAlert('success', r.message); muatGajiTetap(); })
            .fail(() => {
                showAlert('danger', 'Gagal mengubah sakelar');
                sakelar.prop('checked', !nyala); // kembalikan posisi — jangan tampilkan keadaan palsu
            })
            .always(() => { sakelar.prop('disabled', false); perbaruiPeringatanOtomatisMati(); });
    });

    $(document).on('click', '#buatDraftSekarang', function() {
        const tombol = $(this).prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Membuat...');
        kabarGajiTetap('warning', 'Membuat draft...');
        $.ajax({ url: '/api/gaji/gaji-tetap/buat-draft', method: 'POST', contentType: 'application/json', data: '{}' })
            .done((r) => {
                // Nol dibuat BUKAN kegagalan diam: sebutkan alasannya, kalau tidak operator
                // menekan tombolnya berulang kali sambil mengira tak terjadi apa-apa.
                const d = r.data || {};
                const rinci = d.dibuat === 0
                    ? (d.sudahAda > 0 ? 'Draft bulan ini memang sudah ada.' : 'Belum ada gaji pokok tetap yang tersimpan — isi nominalnya lalu Simpan dulu.')
                    : '';
                kabarGajiTetap(d.dibuat > 0 ? 'success' : 'warning', `${r.message}. ${rinci}`.trim());
                showAlert(d.dibuat > 0 ? 'success' : 'warning', `${r.message}. ${rinci}`.trim());
                loadData();
                muatGajiTetap();
            })
            .fail((xhr) => {
                const pesan = (xhr.responseJSON && xhr.responseJSON.message) || `Gagal membuat draft (HTTP ${xhr.status || 'tak ada respons'})`;
                kabarGajiTetap('danger', pesan);
                showAlert('danger', pesan);
            })
            .always(() => tombol.prop('disabled', false).html('<i class="fas fa-bolt"></i> Buat draft bulan ini sekarang'));
    });

    // ── Komisi periode lama ────────────────────────────────────────────────────────────────
    // Panel ini menyelesaikan satu masalah spesifik: komisi yang periodenya tak pernah
    // dibuatkan payroll tak muncul di layar mana pun, jadi tak akan pernah dibayar — DAN
    // sebagiannya ternyata bukan utang sama sekali (hasil backfill saat fitur dinyalakan,
    // uangnya sudah diserahkan duluan). Dua nasib itu butuh dua tindakan berbeda.

    let tertundaPeriodeSaatIni = [];
    let sedangMenutup = false;

    // Kartu hanya muncul kalau ada yang benar-benar menggantung — halaman tak perlu memamerkan
    // alat yang tak ada gunanya hari ini.
    function cariTeknisiBerkomisiTertunda(daftarTeknisi) {
        const now = new Date();
        const permintaan = daftarTeknisi.map((teknisi) =>
            $.get(`/api/gaji/kasbon-summary/${teknisi.id}`, { month: now.getMonth() + 1, year: now.getFullYear() })
                .then((r) => ({
                    id: teknisi.id,
                    tertunda: (r.data && r.data.komisi_tertunda) || [],
                    kasbon: (r.data && r.data.total_kasbon) || 0
                }))
                .catch(() => ({ id: teknisi.id, tertunda: [], kasbon: 0 }))
        );
        Promise.all(permintaan).then((hasil) => {
            hasil.forEach((h) => {
                kasbonPerTeknisi[String(h.id)] = h.kasbon || 0;
            });
            loadData(); // gambar ulang tabel supaya penanda hutangnya ikut muncul
            const adaYangMenggantung = hasil.some((h) => h.tertunda.length > 0);
            if (!adaYangMenggantung) return;
            $('#kartuKomisiTertunda').show();
            const pertama = hasil.find((h) => h.tertunda.length > 0);
            $('#tertundaTeknisiId').val(pertama.id).trigger('change');
        });
    }

    function muatPeriodeTertunda(teknisiId) {
        tertundaPeriodeSaatIni = [];
        const daftar = $('#tertundaDaftar');
        if (!teknisiId) {
            daftar.html('<div class="text-muted">Pilih teknisi untuk melihat periodenya.</div>');
            perbaruiTombolTutup();
            return;
        }
        const now = new Date();
        $.get(`/api/gaji/kasbon-summary/${teknisiId}`, { month: now.getMonth() + 1, year: now.getFullYear() })
            .done((response) => {
                tertundaPeriodeSaatIni = (response.data && response.data.komisi_tertunda) || [];
                if (tertundaPeriodeSaatIni.length === 0) {
                    daftar.html('<div class="text-success"><i class="fas fa-check"></i> Tidak ada komisi periode lama yang menggantung.</div>');
                    perbaruiTombolTutup();
                    return;
                }
                const baris = tertundaPeriodeSaatIni.map((p, i) => {
                    const [bulan, tahun] = p.periode.split('/');
                    return `<div class="form-check">
                        <input class="form-check-input tertunda-centang" type="checkbox" id="tertunda${i}"
                               data-bulan="${bulan}" data-tahun="${tahun}" data-total="${p.total}" checked>
                        <label class="form-check-label" for="tertunda${i}">
                            ${bulanNames[parseInt(bulan, 10)]} ${tahun} — <strong>${formatRupiah(p.total)}</strong>
                            <span class="text-muted">(${p.entries} penarikan)</span>
                        </label>
                    </div>`;
                }).join('');
                daftar.html(baris);
                perbaruiTombolTutup();
            })
            .fail(() => {
                daftar.html('<div class="text-danger">Gagal memuat periode.</div>');
                perbaruiTombolTutup();
            });
    }

    function periodeTercentang() {
        return $('.tertunda-centang:checked').map(function() {
            return {
                month: parseInt($(this).data('bulan'), 10),
                year: parseInt($(this).data('tahun'), 10),
                total: Number($(this).data('total')) || 0
            };
        }).get();
    }

    function perbaruiTombolTutup() {
        const dipilih = periodeTercentang();
        const keterangan = String($('#tertundaKeterangan').val() || '').trim();
        const boleh = dipilih.length > 0 && keterangan.length >= 10 && !sedangMenutup;
        $('#btnTutupKomisi').prop('disabled', !boleh);
        const total = dipilih.reduce((s, p) => s + p.total, 0);
        $('#btnTutupKomisi').html(total > 0
            ? `<i class="fas fa-file-signature"></i> Tandai ${formatRupiah(total)} sudah dibayar di luar sistem`
            : '<i class="fas fa-file-signature"></i> Tandai sudah dibayar di luar sistem');
    }

    $(document).on('change', '#tertundaTeknisiId', function() {
        muatPeriodeTertunda($(this).val());
    });
    $(document).on('change', '.tertunda-centang', perbaruiTombolTutup);
    $(document).on('input', '#tertundaKeterangan', perbaruiTombolTutup);

    $(document).on('click', '#btnTutupKomisi', function() {
        if (sedangMenutup) return;
        const teknisiId = $('#tertundaTeknisiId').val();
        const dipilih = periodeTercentang();
        const keterangan = String($('#tertundaKeterangan').val() || '').trim();
        if (!teknisiId || dipilih.length === 0 || keterangan.length < 10) return;

        const total = dipilih.reduce((s, p) => s + p.total, 0);
        const namaTeknisi = $('#tertundaTeknisiId option:selected').text();
        // Kalimat konfirmasi menyebut nominal, nama, DAN menegaskan bahwa bot tidak membayar —
        // di kalimat inilah beda "bayar sekarang" dan "tandai sudah dibayar" harus diucapkan.
        const pesan = `Tutup ${formatRupiah(total)} komisi ${namaTeknisi} di ${dipilih.length} periode?\n\n`
            + 'Bot TIDAK akan mentransfer apa pun dan TIDAK mengirim struk.\n'
            + 'Pakai ini HANYA kalau uangnya sudah Anda serahkan sendiri di luar sistem.\n\n'
            + 'Tindakan ini tidak bisa dibatalkan lewat halaman ini.';
        if (!window.confirm(pesan)) return;

        sedangMenutup = true;
        $('#btnTutupKomisi').prop('disabled', true);
        $.ajax({
            url: '/api/gaji/komisi-tertunda/tutup',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                teknisi_id: teknisiId,
                periods: dipilih.map((p) => ({ month: p.month, year: p.year })),
                keterangan,
                // Nominal yang DILIHAT operator. Server menolak kalau angkanya sudah berubah,
                // supaya yang tertutup tak pernah lebih besar dari yang disetujui mata.
                expected_total: total
            })
        }).done((response) => {
            showAlert('success', response.message || 'Komisi ditutup');
            $('#tertundaKeterangan').val('');
            muatPeriodeTertunda(teknisiId);
            muatRiwayatTutup();
            loadData();
        }).fail((xhr) => {
            const pesanGagal = (xhr.responseJSON && xhr.responseJSON.message) || 'Gagal menutup komisi';
            showAlert('danger', pesanGagal);
            if (xhr.status === 409) muatPeriodeTertunda(teknisiId);
        }).always(() => {
            sedangMenutup = false;
            perbaruiTombolTutup();
        });
    });

    function muatRiwayatTutup() {
        $.get('/api/gaji/komisi-tertunda/riwayat').done((response) => {
            const rows = (response && response.data) || [];
            if (rows.length === 0) return;
            const html = rows.map((r) => `<tr>
                <td>${String(r.closed_out_at || '').slice(0, 10)}</td>
                <td>${r.teknisi_name || ''}</td>
                <td>${r.period_month}/${r.period_year}</td>
                <td>${formatRupiah(r.total)}</td>
                <td>${r.closed_out_by || ''}</td>
                <td>${r.closed_out_note || ''}</td>
            </tr>`).join('');
            $('#tabelRiwayatTutup tbody').html(html);
            $('#kartuRiwayatTutup').show();
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
                actions += `<button class="btn btn-warning btn-sm" onclick="batalFinalisasi(${gaji.id})" title="Batalkan finalisasi (kembali ke draft)"><i class="fas fa-unlock"></i></button> `;
                actions += `<button class="btn btn-success btn-sm" onclick="payGaji(${gaji.id})" title="Bayar"><i class="fas fa-money-bill-wave"></i></button>`;
            } else if (gaji.status === 'paid' && gaji.struk_status !== 'terkirim') {
                // Uang sudah berpindah tapi rinciannya tak sampai — teknisi berhak atas struknya.
                actions += `<button class="btn btn-outline-danger btn-sm" onclick="kirimUlangStruk(${gaji.id})" title="Struk belum terkirim — kirim ulang"><i class="fas fa-paper-plane"></i></button>`;
            }

            const pendapatan = [];
            if ((gaji.bonus || 0) > 0) pendapatan.push(`<small class="d-block text-success">Bonus: ${formatRupiah(gaji.bonus)}</small>`);
            if ((gaji.komisi_collection || 0) !== 0) pendapatan.push(`<small class="d-block text-info">Collection: ${formatRupiah(gaji.komisi_collection)}</small>`);
            if ((gaji.komisi_marketing || 0) !== 0) pendapatan.push(`<small class="d-block text-info">Marketing PSB: ${formatRupiah(gaji.komisi_marketing)}</small>`);

            const potongan = [];
            if ((gaji.potongan_kasbon || 0) > 0) potongan.push(`<small class="d-block text-danger">Kasbon: ${formatRupiah(gaji.potongan_kasbon)}</small>`);
            if ((gaji.potongan_lain || 0) > 0) potongan.push(`<small class="d-block text-danger">Lain: ${formatRupiah(gaji.potongan_lain)}</small>`);
            // Hutang yang BELUM dipotong ditandai di baris, bukan cuma di dalam modal — dengan
            // draft otomatis, baris tabel inilah satu-satunya yang pasti dilihat operator.
            const hutang = Number(kasbonPerTeknisi[String(gaji.teknisi_id)] || 0);
            if (hutang > 0 && (gaji.potongan_kasbon || 0) <= 0 && gaji.status !== 'paid') {
                potongan.push(`<small class="d-block text-warning"><i class="fas fa-exclamation-triangle"></i> Hutang ${formatRupiah(hutang)} belum dipotong</small>`);
            }
            if ((gaji.status === 'paid') && gaji.struk_status && gaji.struk_status !== 'terkirim') {
                potongan.push('<small class="d-block text-danger">Struk BELUM terkirim</small>');
            }

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

            // Komisi yang menggantung di periode LAIN. Komisi hanya ikut terbayar kalau ADA
            // payroll untuk periode yang sama — bulan yang tak pernah dibuatkan payroll
            // menyimpan uang teknisi tanpa muncul di layar mana pun, jadi tak akan pernah
            // dibayar. Ditulis di sini supaya keputusannya sadar, bukan karena tak tahu.
            const tertunda = response.data.komisi_tertunda || [];
            const totalTertunda = tertunda.reduce((s, x) => s + Number(x.total || 0), 0);
            const jejakTertunda = $('#komisiTertundaInfo');
            if (totalTertunda > 0) {
                jejakTertunda
                    .text(`⚠️ ${formatRupiah(totalTertunda)} komisi di ${tertunda.length} periode belum pernah dibuatkan payroll (${tertunda.map((x) => x.periode).join(', ')}) — buat draft untuk periode itu, kalau tidak komisinya tak akan terbayar.`)
                    .show();
            } else {
                jejakTertunda.text('').hide();
            }

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
        // Peringatan komisi tertunda ikut dibersihkan. Tanpa ini ia tetap terpampang saat modal
        // dibuka lagi untuk teknisi LAIN — angka orang lain di layar orang ini.
        $('#komisiTertundaInfo').text('').hide();
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
            muatKasbonUntukEdit(gaji);
        });
    };

    /**
     * Saldo hutang teknisi di modal EDIT.
     *
     * Dulu angka ini HANYA ada di modal Buat Draft. Begitu draft dibuat otomatis tiap bulan,
     * operator tak pernah membuka modal itu lagi — jalurnya jadi "lihat tabel > Edit >
     * Finalisasi > Bayar", dan tak satu pun layar di situ menyebut hutang. Akibatnya teknisi
     * bisa mengambil kasbon lalu menerima gaji penuh berbulan-bulan tanpa terpotong sepeser pun.
     */
    function muatKasbonUntukEdit(gaji) {
        const jejak = $('#editKasbonInfo');
        jejak.text('Memeriksa saldo hutang...').removeClass('text-danger text-muted').addClass('text-muted');
        $.get(`/api/gaji/kasbon-summary/${gaji.teknisi_id}`, { month: gaji.period_month, year: gaji.period_year })
            .done((r) => {
                const sisa = Number((r.data && r.data.total_kasbon) || 0);
                const sudahDipotong = Number(gaji.potongan_kasbon || 0);
                if (sisa <= 0) {
                    jejak.removeClass('text-danger').addClass('text-muted').text('Tidak ada hutang kasbon aktif.');
                    $('#editKasbonIsiPenuh').hide();
                    return;
                }
                jejak.removeClass('text-muted').addClass('text-danger')
                    .text(`⚠️ Saldo hutang aktif: ${formatRupiah(sisa)}${sudahDipotong > 0 ? ` (sudah dipotong ${formatRupiah(sudahDipotong)} di draft ini)` : ' — belum dipotong sama sekali di draft ini'}`);
                $('#editKasbonIsiPenuh').data('sisa', sisa).show();
            })
            .fail(() => jejak.removeClass('text-muted').addClass('text-danger').text('Gagal memeriksa saldo hutang.'));
    }

    // Satu klik mengisi potongan sebesar sisa hutang. Mengetik ulang angka yang sudah
    // ditampilkan di sebelahnya hanya membuka peluang salah ketik.
    $(document).on('click', '#editKasbonIsiPenuh', function() {
        const sisa = Number($(this).data('sisa')) || 0;
        if (sisa <= 0) return;
        setInputValue('#editPotonganKasbon', sisa);
        calculateEditTotal();
    });

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

    window.kirimUlangStruk = function(id) {
        if (!window.confirm('Kirim ulang struk gaji ke teknisi?\n\nTidak ada uang yang berpindah — hanya rinciannya yang dikirim ulang lewat WhatsApp.')) return;
        $.ajax({ url: `/api/gaji/${id}/kirim-ulang-struk`, method: 'POST', contentType: 'application/json', data: '{}' })
            .done((r) => { showAlert('success', r.message); loadData(); })
            .fail((xhr) => showAlert('danger', (xhr.responseJSON && xhr.responseJSON.message) || 'Gagal mengirim ulang struk'));
    };

    window.batalFinalisasi = function(id) {
        // Finalisasi mengunci komisi ke payroll ini; pembatalannya harus melepaskan kunci itu
        // juga, kalau tidak komisinya menggantung di payroll yang tak jadi dibayar.
        if (!window.confirm('Batalkan finalisasi payroll ini?\n\nStatusnya kembali ke draft dan komisi yang terkunci dilepas supaya bisa dihitung ulang.\nBelum ada uang yang berpindah, jadi ini aman.')) return;
        $.ajax({ url: `/api/gaji/${id}/batal-finalisasi`, method: 'PUT', contentType: 'application/json', data: '{}' })
            .done((r) => { showAlert('success', r.message); loadData(); })
            .fail((xhr) => showAlert('danger', (xhr.responseJSON && xhr.responseJSON.message) || 'Gagal membatalkan finalisasi'));
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
