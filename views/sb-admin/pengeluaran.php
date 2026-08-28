<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Pengeluaran';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/pengeluaran.css') ?>" rel="stylesheet">

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
                            <i class="fas fa-receipt text-danger"></i> Manajemen Pengeluaran
                        </h1>
                        <div>
                            <button class="btn btn-success btn-sm mr-2" data-toggle="modal" data-target="#expenseModal" id="newExpenseBtn">
                                <i class="fas fa-plus"></i> Input Pengeluaran
                            </button>
                            <button class="btn btn-primary btn-sm" id="refreshExpensesBtn">
                                <i class="fas fa-sync-alt"></i> Refresh
                            </button>
                        </div>
                    </div>

                    <div class="card panel-card mb-4">
                        <div class="card-body">
                            <div class="row">
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Bulan</label>
                                    <select class="form-control" id="expenseMonth"></select>
                                </div>
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Tahun</label>
                                    <select class="form-control" id="expenseYear"></select>
                                </div>
                                <div class="col-md-3">
                                    <label class="font-weight-bold mb-1">Kategori</label>
                                    <select class="form-control" id="expenseCategoryFilter">
                                        <option value="">Semua</option>
                                    </select>
                                </div>
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Status</label>
                                    <select class="form-control" id="expenseStatusFilter">
                                        <option value="">Semua</option>
                                        <option value="active">Aktif</option>
                                        <option value="revised">Revised</option>
                                        <option value="cancelled">Cancelled</option>
                                    </select>
                                </div>
                                <div class="col-md-3 d-flex align-items-end">
                                    <button class="btn btn-primary btn-block" id="applyExpenseFilterBtn">
                                        <i class="fas fa-filter"></i> Terapkan
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row mb-4">
                        <div class="col-lg-3 col-md-6 mb-3">
                            <div class="card summary-card">
                                <div class="card-body">
                                    <div class="summary-label">Total Pengeluaran Aktif</div>
                                    <div class="summary-value text-danger" id="expenseTotalAmount">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-lg-3 col-md-6 mb-3">
                            <div class="card summary-card">
                                <div class="card-body">
                                    <div class="summary-label">Total Record</div>
                                    <div class="summary-value" id="expenseTotalRecords">0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-lg-3 col-md-6 mb-3">
                            <div class="card summary-card">
                                <div class="card-body">
                                    <div class="summary-label">Pengeluaran Terbesar</div>
                                    <div class="summary-value text-warning" id="largestExpenseAmount">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-lg-3 col-md-6 mb-3">
                            <div class="card summary-card">
                                <div class="card-body">
                                    <div class="summary-label">Kategori Dominan</div>
                                    <div class="summary-value text-primary" id="dominantExpenseCategory">-</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="card panel-card mb-4">
                        <div class="card-header bg-white border-0">
                            <h6 class="m-0 font-weight-bold text-primary">Daftar Pengeluaran</h6>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="expenseTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>Tanggal</th>
                                            <th>Judul</th>
                                            <th>Kategori</th>
                                            <th>Nominal</th>
                                            <th>Metode</th>
                                            <th>Vendor</th>
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
                        <span>Copyright &copy; RAF BOT 2026</span>
                    </div>
                </div>
            </footer>
        </div>
    </div>

    <div class="modal fade" id="expenseModal" tabindex="-1" role="dialog" aria-hidden="true">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title" id="expenseModalTitle">Input Pengeluaran</h5>
                    <button type="button" class="close text-white" data-dismiss="modal"><span>&times;</span></button>
                </div>
                <div class="modal-body">
                    <form id="expenseForm" onsubmit="return false;">
                        <input type="hidden" id="expenseId">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label>Judul <span class="text-danger">*</span></label>
                                    <input type="text" class="form-control" id="expenseTitle" required>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label>Kategori <span class="text-danger">*</span></label>
                                    <select class="form-control" id="expenseCategory" required></select>
                                </div>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-md-4">
                                <div class="form-group">
                                    <label>Nominal <span class="text-danger">*</span></label>
                                    <input type="number" class="form-control" id="expenseAmount" min="1" required>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="form-group">
                                    <label>Tanggal <span class="text-danger">*</span></label>
                                    <input type="date" class="form-control" id="expenseDate" required>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="form-group">
                                    <label>Metode Bayar <span class="text-danger">*</span></label>
                                    <select class="form-control" id="expensePaymentMethod" required>
                                        <option value="CASH">Cash</option>
                                        <option value="TRANSFER_BANK">Transfer Bank</option>
                                        <option value="SALDO">Saldo</option>
                                        <option value="INTERNAL_PAYROLL">Internal Payroll</option>
                                        <option value="OTHER">Other</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Vendor / Counterparty</label>
                            <input type="text" class="form-control" id="expenseVendor">
                        </div>
                        <div class="form-group mb-0">
                            <label>Catatan</label>
                            <textarea class="form-control" id="expenseNotes" rows="3"></textarea>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-danger" id="saveExpenseBtn">Simpan</button>
                </div>
            </div>
        </div>
    </div>

    <div class="toast-stack" id="expenseToastContainer"></div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <?php include '_logout_modal.php'; ?>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="/static/js/pengeluaran.js"></script>
</body>
</html>
