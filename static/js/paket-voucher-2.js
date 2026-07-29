/*
 * Header Doc
 * Purpose: Perilaku halaman views/sb-admin/paket-voucher.php (blok 2 dari 2) —
 *          dipindahkan dari blok <script> inline (CLAUDE.md: JS halaman eksternal).
 * Caller : views/sb-admin/paket-voucher.php lewat <script src>, pada posisi yang sama dengan blok aslinya.
 * SideEffects: memanipulasi DOM halaman tsb + memanggil API internal.
 */

        $(document).ready(function() {
            function formatCurrency(amount) {
                return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount || 0);
            }

            function showVoucherAlert(message, variant) {
                const alertHtml = `
                    <div class="alert alert-${variant} alert-dismissible fade show voucher-alert" role="alert">
                        ${message}
                        <button type="button" class="close" data-dismiss="alert" aria-label="Tutup"><span aria-hidden="true">&times;</span></button>
                    </div>`;
                $('.container-fluid').find('.voucher-alert').remove();
                $(alertHtml).prependTo('.container-fluid');
            }

            // Ringkasan: jumlah paket + rentang harga.
            function updateStats(rows) {
                const list = Array.isArray(rows) ? rows : [];
                $('#statCount').text(list.length);
                const prices = list.map(r => parseInt(r.hargavc, 10)).filter(n => !isNaN(n) && n > 0);
                if (!prices.length) { $('#statMin').text('-'); $('#statMax').text('-'); return; }
                $('#statMin').text(formatCurrency(Math.min.apply(null, prices)));
                $('#statMax').text(formatCurrency(Math.max.apply(null, prices)));
            }

            async function submitVoucherForm(formElement, method) {
                const $form = $(formElement);
                const action = $form.attr('action');
                const submitButton = $form.find('button[type="submit"]');
                const payload = Object.fromEntries(new FormData(formElement).entries());
                submitButton.prop('disabled', true);
                try {
                    const response = await fetch(action, {
                        method,
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payload)
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(result.error || result.message || 'Gagal menyimpan paket voucher');
                    $form.closest('.modal').modal('hide');
                    formElement.reset();
                    dataTable.ajax.reload(null, false);
                    showVoucherAlert(result.message || 'Paket voucher berhasil disimpan.', 'success');
                } catch (error) {
                    showVoucherAlert(error.message || 'Gagal menyimpan paket voucher.', 'danger');
                } finally {
                    submitButton.prop('disabled', false);
                }
            }

            const dataTable = $('#dataTable').DataTable({
                // Bahasa inline (bukan language.url) — CSP admin memblokir fetch ke CDN datatables.
                language: {
                    search: 'Cari:',
                    lengthMenu: 'Tampilkan _MENU_ paket',
                    info: 'Menampilkan _START_–_END_ dari _TOTAL_ paket',
                    infoEmpty: 'Tidak ada paket',
                    infoFiltered: '(disaring dari _MAX_ total)',
                    zeroRecords: 'Paket tidak ditemukan',
                    emptyTable: 'Belum ada paket voucher',
                    paginate: { first: 'Awal', last: 'Akhir', next: '›', previous: '‹' }
                },
                order: [[3, 'asc']],
                ajax: {
                    url: '/api/voucher',
                    type: 'GET',
                    dataSrc: function(json) {
                        let arr = [];
                        if (Array.isArray(json)) arr = json;
                        else if (json && Array.isArray(json.data)) arr = json.data;
                        else if (json && json.error) console.error('[VOUCHER_DATATABLE] API Error:', json.error);
                        updateStats(arr);
                        return arr;
                    },
                    error: function(xhr, error, thrown) {
                        console.error('[VOUCHER_DATATABLE] AJAX Error:', error, thrown);
                        showVoucherAlert('Gagal memuat data paket voucher.', 'danger');
                    }
                },
                columns: [
                    { data: 'prof' },
                    { data: 'namavc' },
                    { data: 'durasivc' },
                    { data: 'hargavc', render: function(d, type) { const n = parseInt(d || 0) || 0; return (type === 'sort' || type === 'type') ? n : '<span class="price-cell">' + formatCurrency(n) + '</span>'; } },
                    { data: 'hargaReseller', render: function(d, type) { const n = parseInt(d || 0) || 0; return (type === 'sort' || type === 'type') ? n : (n ? formatCurrency(n) : '-'); } },
                    { data: 'margin', render: function(d, type) { const n = parseInt(d || 0) || 0; return (type === 'sort' || type === 'type') ? n : (n ? '<span class="margin-pos">' + formatCurrency(n) + '</span>' : '-'); } },
                    {
                        data: null, orderable: false, render: function(data, type, row) {
                            const p = String(row.prof || '').replace(/"/g, '&quot;');
                            return `
                                <button class="btn-act edit btn-edit" data-id="${p}" data-prof="${p}" data-namavc="${row.namavc || ''}" data-durasivc="${row.durasivc || ''}" data-hargavc="${row.hargavc || ''}" data-hargareseller="${row.hargaReseller || ''}" data-toggle="modal" data-target="#editModal"><i class="fas fa-edit mr-1"></i>Edit</button>
                                <button class="btn-act del" onclick="deleteData('${p}')"><i class="fas fa-trash mr-1"></i>Hapus</button>`;
                        }
                    }
                ]
            });

            window.deleteData = function(id) {
                if (!confirm('Hapus paket voucher ini?')) return;
                $.ajax({
                    url: '/api/voucher/' + encodeURIComponent(id),
                    type: 'DELETE',
                    success: function(response) {
                        dataTable.ajax.reload();
                        showVoucherAlert(response?.message || 'Paket voucher berhasil dihapus.', 'success');
                    },
                    error: function(xhr) {
                        const message = xhr?.responseJSON?.error || xhr?.responseJSON?.message || 'Gagal menghapus paket voucher.';
                        showVoucherAlert(message, 'danger');
                    }
                });
            };

            $('#createModal form').on('submit', async function(event) { event.preventDefault(); await submitVoucherForm(this, 'POST'); });
            $('#editModal form').on('submit', async function(event) { event.preventDefault(); await submitVoucherForm(this, 'PUT'); });
        });
    
