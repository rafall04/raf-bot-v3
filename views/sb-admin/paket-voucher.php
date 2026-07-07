<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Paket Voucher';
    $themeRole = 'admin';
    $pageDescription = 'Kelola daftar paket & harga voucher hotspot';
    include __DIR__ . '/_head.php';
    ?>
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/paket-voucher.css') ?>" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include __DIR__ . '/_navbar.php'; ?>

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include __DIR__ . '/topbar.php'; ?>

                <div class="container-fluid">
                    <!-- Header -->
                    <div class="page-header">
                        <h1><i class="fas fa-ticket-alt mr-2"></i>Paket Voucher</h1>
                        <p>Kelola daftar paket &amp; harga voucher hotspot</p>
                    </div>

                    <!-- Ringkasan -->
                    <div class="stats-row">
                        <div class="stat-card">
                            <div class="value" id="statCount">0</div>
                            <div class="label">Total Paket</div>
                        </div>
                        <div class="stat-card">
                            <div class="value" id="statMin">-</div>
                            <div class="label">Harga Terendah</div>
                        </div>
                        <div class="stat-card">
                            <div class="value" id="statMax">-</div>
                            <div class="label">Harga Tertinggi</div>
                        </div>
                    </div>

                    <!-- Tabel katalog -->
                    <div class="card-modern">
                        <div class="card-header d-flex justify-content-between align-items-center">
                            <span><i class="fas fa-list mr-2 text-primary"></i>Semua Paket</span>
                            <button data-toggle="modal" data-target="#createModal" class="btn btn-primary btn-sm">
                                <i class="fas fa-plus mr-1"></i>Tambah Paket
                            </button>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table" id="dataTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th>Profil</th>
                                            <th>Nama Paket</th>
                                            <th>Durasi</th>
                                            <th>Harga Jual</th>
                                            <th>Harga Reseller</th>
                                            <th>Margin</th>
                                            <th>Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody></tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <?php include __DIR__ . '/footer.php'; ?>
        </div>
    </div>

    <!-- Modal Tambah -->
    <div class="modal fade" id="createModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog">
            <form class="modal-content" method="post" action="/api/voucher">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-plus-circle text-primary mr-2"></i>Tambah Paket Voucher</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Tutup"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="prof" class="form-label">Profil (MikroTik)</label>
                        <input type="text" class="form-control" id="prof" name="prof" placeholder="mis. Paket-2Jam" required />
                    </div>
                    <div class="form-group">
                        <label for="namavc" class="form-label">Nama Paket</label>
                        <input type="text" class="form-control" id="namavc" name="namavc" placeholder="mis. Paket 2 Jam" required />
                    </div>
                    <div class="form-group">
                        <label for="durasivc" class="form-label">Durasi</label>
                        <input type="text" class="form-control" id="durasivc" name="durasivc" placeholder="mis. 2 Jam / 1 Hari / 1 Bulan" required />
                    </div>
                    <div class="form-row">
                        <div class="form-group col">
                            <label for="hargavc" class="form-label">Harga Jual</label>
                            <input type="number" class="form-control" id="hargavc" name="hargavc" placeholder="1000" required />
                        </div>
                        <div class="form-group col">
                            <label for="hargaReseller" class="form-label">Harga Reseller</label>
                            <input type="number" class="form-control" id="hargaReseller" name="hargaReseller" placeholder="800" />
                        </div>
                    </div>
                    <small class="form-text text-muted">Harga reseller = harga khusus agent (biasanya lebih murah dari harga jual).</small>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button>
                    <button type="submit" class="btn btn-primary btn-sm"><i class="fas fa-save mr-1"></i>Simpan</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Modal Edit -->
    <div class="modal fade" id="editModal" data-backdrop="static" tabindex="-1">
        <div class="modal-dialog">
            <form class="modal-content" method="POST" action="">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-edit text-primary mr-2"></i>Edit Paket Voucher</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Tutup"><span aria-hidden="true">&times;</span></button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label for="edit_prof" class="form-label">Profil (MikroTik)</label>
                        <input type="text" class="form-control" id="edit_prof" name="prof" required />
                    </div>
                    <div class="form-group">
                        <label for="edit_namavc" class="form-label">Nama Paket</label>
                        <input type="text" class="form-control" id="edit_namavc" name="namavc" required />
                    </div>
                    <div class="form-group">
                        <label for="edit_durasivc" class="form-label">Durasi</label>
                        <input type="text" class="form-control" id="edit_durasivc" name="durasivc" required />
                    </div>
                    <div class="form-row">
                        <div class="form-group col">
                            <label for="edit_hargavc" class="form-label">Harga Jual</label>
                            <input type="number" class="form-control" id="edit_hargavc" name="hargavc" required />
                        </div>
                        <div class="form-group col">
                            <label for="edit_hargaReseller" class="form-label">Harga Reseller</label>
                            <input type="number" class="form-control" id="edit_hargaReseller" name="hargaReseller" />
                        </div>
                    </div>
                    <small class="form-text text-muted">Harga reseller = harga khusus agent (biasanya ~20% lebih murah dari harga jual).</small>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Batal</button>
                    <button type="submit" class="btn btn-primary btn-sm"><i class="fas fa-save mr-1"></i>Simpan Perubahan</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Bootstrap core JavaScript -->
    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>

    <!-- DataTables -->
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>

    <script>
        $(document).on('click', '.btn-edit', function() {
            const id = $(this).data('id');
            $('#editModal form').attr('action', '/api/voucher/' + encodeURIComponent(id));
            $('#editModal input#edit_prof').val($(this).data('prof'));
            $('#editModal input#edit_namavc').val($(this).data('namavc'));
            $('#editModal input#edit_durasivc').val($(this).data('durasivc'));
            $('#editModal input#edit_hargavc').val($(this).data('hargavc'));
            $('#editModal input#edit_hargaReseller').val($(this).data('hargareseller') || '');
        });
    </script>

    <script>
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
    </script>

</body>

</html>
