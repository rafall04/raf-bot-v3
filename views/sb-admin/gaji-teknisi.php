<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Gaji Teknisi';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/gaji-teknisi.css') ?>" rel="stylesheet">

</head>
<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <?php include 'topbar.php'; ?>
                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <h1 class="h3 mb-0 text-gray-800">
                            <i class="fas fa-money-bill-wave text-success"></i> Gaji Teknisi
                        </h1>
                        <div>
                            <button class="btn btn-success btn-sm" data-toggle="modal" data-target="#createGajiModal">
                                <i class="fas fa-plus"></i> Buat Draft Payroll
                            </button>
                            <button class="btn btn-primary btn-sm" id="refreshBtn">
                                <i class="fas fa-sync-alt"></i> Refresh
                            </button>
                        </div>
                    </div>

                    <!-- Period Selector -->
                    <div class="period-selector shadow-sm">
                        <div class="row align-items-center">
                            <div class="col-md-3">
                                <label class="font-weight-bold mb-1">Bulan</label>
                                <select class="form-control" id="selectMonth"></select>
                            </div>
                            <div class="col-md-3">
                                <label class="font-weight-bold mb-1">Tahun</label>
                                <select class="form-control" id="selectYear"></select>
                            </div>
                            <div class="col-md-3">
                                <label class="font-weight-bold mb-1">Status</label>
                                <select class="form-control" id="selectStatus">
                                    <option value="">Semua</option>
                                    <option value="draft">Draft</option>
                                    <option value="finalized">Finalized</option>
                                    <option value="paid">Sudah Dibayar</option>
                                </select>
                            </div>
                            <div class="col-md-3 d-flex align-items-end">
                                <button class="btn btn-primary btn-block" id="applyFilterBtn">
                                    <i class="fas fa-filter"></i> Terapkan
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Summary Cards -->
                    <div class="row mb-4">
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-primary shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label">Total Gaji</div>
                                            <div class="stats-value text-primary" id="totalGaji">Rp 0</div>
                                            <small class="text-muted" id="totalRecords">0 teknisi</small>
                                        </div>
                                        <div class="stats-icon bg-primary text-white"><i class="fas fa-wallet"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-warning shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label">Draft + Finalized</div>
                                            <div class="stats-value text-warning" id="pendingAmount">Rp 0</div>
                                            <small class="text-muted" id="pendingCount">0 teknisi</small>
                                        </div>
                                        <div class="stats-icon bg-warning text-white"><i class="fas fa-clock"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-success shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label">Sudah Dibayar</div>
                                            <div class="stats-value text-success" id="paidAmount">Rp 0</div>
                                            <small class="text-muted" id="paidCount">0 teknisi</small>
                                        </div>
                                        <div class="stats-icon bg-success text-white"><i class="fas fa-check"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-md-6 mb-3">
                            <div class="card stats-card border-left-danger shadow h-100">
                                <div class="card-body">
                                    <div class="d-flex justify-content-between align-items-center">
                                        <div>
                                            <div class="stats-label">Total Potongan</div>
                                            <div class="stats-value text-danger" id="totalPotongan">Rp 0</div>
                                            <small class="text-muted">Kasbon + Lainnya</small>
                                        </div>
                                        <div class="stats-icon bg-danger text-white"><i class="fas fa-minus-circle"></i></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Gaji Table -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3">
                            <h6 class="m-0 font-weight-bold text-primary">
                                <i class="fas fa-list"></i> Daftar Gaji Teknisi
                            </h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="gajiTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>Teknisi</th>
                                            <th>Periode</th>
                                            <th>Gaji Pokok</th>
                                            <th>Pendapatan Tambahan</th>
                                            <th>Potongan</th>
                                            <th>Nett Gaji</th>
                                            <th>Status</th>
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
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; RAF BOT 2025</span>
                    </div>
                </div>
            </footer>
        </div>
    </div>

    <!-- Create Gaji Modal -->
    <div class="modal fade" id="createGajiModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header bg-success text-white">
                    <h5 class="modal-title"><i class="fas fa-plus"></i> Buat Draft Payroll</h5>
                    <button type="button" class="close text-white" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="createGajiForm">
                        <div class="row">
                            <div class="col-md-4">
                                <div class="form-group">
                                    <label class="font-weight-bold">Teknisi <span class="text-danger">*</span></label>
                                    <select class="form-control" id="createTeknisiId" required>
                                        <option value="">-- Pilih Teknisi --</option>
                                    </select>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="form-group">
                                    <label class="font-weight-bold">Bulan <span class="text-danger">*</span></label>
                                    <select class="form-control" id="createMonth" required></select>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="form-group">
                                    <label class="font-weight-bold">Tahun <span class="text-danger">*</span></label>
                                    <select class="form-control" id="createYear" required></select>
                                </div>
                            </div>
                        </div>
                        
                        <div class="form-section">
                            <div class="form-section-title"><i class="fas fa-plus-circle text-success"></i> Pendapatan</div>
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Gaji Pokok</label>
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                            <input type="text" class="form-control currency-input" id="createGajiPokok" value="0">
                                        </div>
                                        <!-- Menyebut ASALNYA: angka yang muncul sendiri tanpa penjelasan
                                             bikin orang ragu apakah itu benar untuk bulan ini. -->
                                        <small class="text-info" id="gajiPokokInfo"></small>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Bonus Manual</label>
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                            <input type="text" class="form-control currency-input" id="createBonus" value="0">
                                        </div>
                                        <small class="text-info" id="collectionInfo">Komisi collection periode ini: Rp 0</small>
                                        <!-- Komisi periode lain yang belum pernah masuk payroll:
                                             uang teknisi yang terutang tapi tak terlihat. -->
                                        <small class="text-danger d-block" id="komisiTertundaInfo" style="display:none"></small>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="form-section">
                            <div class="form-section-title"><i class="fas fa-minus-circle text-danger"></i> Potongan</div>
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Potongan Kasbon</label>
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                            <input type="text" class="form-control currency-input" id="createPotonganKasbon" value="0">
                                        </div>
                                        <small class="text-muted" id="kasbonInfo">Saldo hutang aktif: Rp 0</small>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Potongan Lain</label>
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                            <input type="text" class="form-control currency-input" id="createPotonganLain" value="0">
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Keterangan Potongan Lain</label>
                                <input type="text" class="form-control" id="createPotonganLainKet" placeholder="Contoh: Denda keterlambatan">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Catatan</label>
                            <textarea class="form-control" id="createNotes" rows="2" placeholder="Catatan tambahan (opsional)"></textarea>
                        </div>
                        
                        <div class="alert alert-info">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="font-weight-bold">Estimasi Nett Gaji:</span>
                                <span class="h4 mb-0 text-primary" id="createTotalPreview">Rp 0</span>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-success" id="submitCreateGaji">
                        <i class="fas fa-save"></i> Simpan
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Gaji Modal -->
    <div class="modal fade" id="editGajiModal" tabindex="-1">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header bg-primary text-white">
                    <h5 class="modal-title"><i class="fas fa-edit"></i> Edit Gaji</h5>
                    <button type="button" class="close text-white" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="editGajiForm">
                        <input type="hidden" id="editGajiId">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label class="font-weight-bold">Teknisi</label>
                                    <input type="text" class="form-control" id="editTeknisiName" readonly>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label class="font-weight-bold">Periode</label>
                                    <input type="text" class="form-control" id="editPeriode" readonly>
                                </div>
                            </div>
                        </div>
                        
                        <div class="form-section">
                            <div class="form-section-title"><i class="fas fa-plus-circle text-success"></i> Pendapatan</div>
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Gaji Pokok</label>
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                            <input type="text" class="form-control currency-input" id="editGajiPokok" value="0">
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Bonus Manual</label>
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                            <input type="text" class="form-control currency-input" id="editBonus" value="0">
                                        </div>
                                        <small class="text-info" id="editCollectionInfo">Komisi collection terkunci: Rp 0</small>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div class="form-section">
                            <div class="form-section-title"><i class="fas fa-minus-circle text-danger"></i> Potongan</div>
                            <div class="row">
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Potongan Kasbon</label>
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                            <input type="text" class="form-control currency-input" id="editPotonganKasbon" value="0">
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-group">
                                        <label>Potongan Lain</label>
                                        <div class="input-group">
                                            <div class="input-group-prepend"><span class="input-group-text">Rp</span></div>
                                            <input type="text" class="form-control currency-input" id="editPotonganLain" value="0">
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="form-group">
                                <label>Keterangan Potongan Lain</label>
                                <input type="text" class="form-control" id="editPotonganLainKet">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>Catatan</label>
                            <textarea class="form-control" id="editNotes" rows="2"></textarea>
                        </div>
                        
                        <div class="alert alert-info">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="font-weight-bold">Estimasi Nett Gaji:</span>
                                <span class="h4 mb-0 text-primary" id="editTotalPreview">Rp 0</span>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" id="submitEditGaji">
                        <i class="fas fa-save"></i> Simpan Perubahan
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Pay Gaji Modal -->
    <div class="modal fade" id="payGajiModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header bg-success text-white">
                    <h5 class="modal-title"><i class="fas fa-money-bill-wave"></i> Bayar Payroll</h5>
                    <button type="button" class="close text-white" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="payGajiId">
                    <div class="text-center mb-4">
                        <h5 id="payTeknisiName">-</h5>
                        <p class="text-muted mb-0" id="payPeriode">-</p>
                    </div>
                    <div class="alert alert-success text-center">
                        <div class="h3 mb-0" id="payTotalGaji">Rp 0</div>
                        <small>Total yang akan dibayarkan</small>
                    </div>
                    <div class="form-group">
                        <div class="custom-control custom-checkbox">
                            <input type="checkbox" class="custom-control-input" id="payDeductKasbon" checked>
                            <label class="custom-control-label" for="payDeductKasbon">
                                Potongan kasbon akan dieksekusi sesuai nominal payroll
                            </label>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Catatan Pembayaran</label>
                        <textarea class="form-control" id="payNotes" rows="2" placeholder="Catatan tambahan (opsional)"></textarea>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-success" id="submitPayGaji">
                        <i class="fas fa-check"></i> Konfirmasi Pembayaran
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Detail Gaji Modal -->
    <div class="modal fade" id="detailGajiModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header bg-info text-white">
                    <h5 class="modal-title"><i class="fas fa-info-circle"></i> Detail Gaji</h5>
                    <button type="button" class="close text-white" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body" id="detailGajiContent">
                    <!-- Content will be loaded dynamically -->
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Tutup</button>
                </div>
            </div>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <?php include '_logout_modal.php'; ?>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="/js/gaji-teknisi.js"></script>
</body>
</html>
