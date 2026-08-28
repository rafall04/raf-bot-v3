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
                                <table class="table tabel-tumpuk-hp" id="dataTable" width="100%" cellspacing="0">
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

    <script src="<?= rafAssetUrl('/js/paket-voucher-1.js') ?>"></script>

    <script src="<?= rafAssetUrl('/js/paket-voucher-2.js') ?>"></script>

</body>

</html>
