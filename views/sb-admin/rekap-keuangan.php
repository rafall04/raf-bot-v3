<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Rekap Keuangan Holistik';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/rekap-keuangan.css') ?>" rel="stylesheet">

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
                            <i class="fas fa-wallet text-primary"></i> Rekap Keuangan Holistik
                        </h1>
                        <div class="d-flex gap-2">
                            <button class="btn btn-outline-primary btn-sm mr-2" data-toggle="modal" data-target="#adjustmentModal">
                                <i class="fas fa-sliders-h"></i> Manual Adjustment
                            </button>
                            <button class="btn btn-success btn-sm mr-2" id="exportExcelBtn">
                                <i class="fas fa-file-export"></i> Export CSV
                            </button>
                            <button class="btn btn-primary btn-sm" id="refreshBtn">
                                <i class="fas fa-sync-alt"></i> Refresh
                            </button>
                        </div>
                    </div>

                    <div class="card filter-panel mb-4">
                        <div class="card-body">
                            <div class="row">
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Periode</label>
                                    <select class="form-control" id="periodType">
                                        <option value="month">Bulanan</option>
                                        <option value="year">Tahunan</option>
                                    </select>
                                </div>
                                <div class="col-md-2" id="monthSelector">
                                    <label class="font-weight-bold mb-1">Bulan</label>
                                    <select class="form-control" id="selectMonth"></select>
                                </div>
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Tahun</label>
                                    <select class="form-control" id="selectYear"></select>
                                </div>
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Domain</label>
                                    <select class="form-control" id="domainFilter">
                                        <option value="">Semua</option>
                                        <option value="customer_payment">Customer Payment</option>
                                        <option value="partial_payment">Partial Payment</option>
                                        <option value="topup_request_approved">Topup</option>
                                        <option value="voucher_purchase">Voucher</option>
                                        <option value="agent_transaction_confirmed">Agent</option>
                                        <option value="technician_collection_commission">Komisi Teknisi</option>
                                        <option value="technician_kasbon_credit">Kasbon Credit</option>
                                        <option value="technician_kasbon_debit">Kasbon Debit</option>
                                        <option value="technician_payroll_paid">Payroll</option>
                                        <option value="manual_adjustment">Adjustment</option>
                                    </select>
                                </div>
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Arah</label>
                                    <select class="form-control" id="directionFilter">
                                        <option value="">Semua</option>
                                        <option value="credit">Credit</option>
                                        <option value="debit">Debit</option>
                                    </select>
                                </div>
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Metode</label>
                                    <!-- Nilainya kini EMBER baku, bukan satu ejaan mentah.
                                         Route memekarkannya ke semua ejaan yang benar-benar
                                         tersimpan (CASH/cash/TUNAI, dst) — lihat
                                         lib/payment-method-vocab.js. Versi lama mengirim
                                         "CASH" dan mencocokkannya persis, sehingga sebagian
                                         besar baris ledger tak pernah ikut tersaring. -->
                                    <select class="form-control" id="methodFilter">
                                        <option value="">Semua</option>
                                        <option value="cash">Tunai</option>
                                        <option value="transfer">Transfer Bank</option>
                                        <option value="online">Pembayaran Online</option>
                                        <option value="topup">Topup</option>
                                        <option value="saldo">Saldo</option>
                                        <option value="agent">Agen</option>
                                        <option value="payroll">Payroll Internal</option>
                                        <option value="reversal">Pembalikan</option>
                                    </select>
                                </div>
                            </div>
                            <div class="row mt-3">
                                <div class="col-md-2">
                                    <label class="font-weight-bold mb-1">Sumber</label>
                                    <select class="form-control" id="sourceFilter">
                                        <option value="">Semua</option>
                                        <option value="admin">Admin</option>
                                        <option value="teknisi">Teknisi</option>
                                        <option value="system">System</option>
                                    </select>
                                </div>
                                <div class="col-md-2 d-flex align-items-end">
                                    <button class="btn btn-primary btn-block" id="applyPeriodBtn">
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
                                    <div class="summary-label">Total Pemasukan</div>
                                    <div class="summary-value text-success" id="totalIncome">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-lg-3 col-md-6 mb-3">
                            <div class="card summary-card">
                                <div class="card-body">
                                    <div class="summary-label">Total Pengeluaran</div>
                                    <div class="summary-value text-danger" id="totalExpense">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-lg-3 col-md-6 mb-3">
                            <div class="card summary-card">
                                <div class="card-body">
                                    <div class="summary-label">Nett</div>
                                    <div class="summary-value text-primary" id="netTotal">Rp 0</div>
                                </div>
                            </div>
                        </div>
                        <div class="col-lg-3 col-md-6 mb-3">
                            <div class="card summary-card">
                                <div class="card-body">
                                    <div class="summary-label">Total Transaksi</div>
                                    <div class="summary-value" id="totalTransactions">0</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row mb-4">
                        <div class="col-lg-5 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">Ringkasan Domain</h6>
                                </div>
                                <div class="card-body" id="domainSummary"></div>
                            </div>
                        </div>
                        <div class="col-lg-3 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">Metode Pembayaran</h6>
                                </div>
                                <div class="card-body" id="methodSummary"></div>
                            </div>
                        </div>
                        <div class="col-lg-4 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">Sumber Transaksi</h6>
                                </div>
                                <div class="card-body" id="sourceSummary"></div>
                            </div>
                        </div>
                    </div>

                    <div class="row mb-4">
                        <div class="col-lg-4 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">Tren Cashflow 6 Periode</h6>
                                </div>
                                <div class="card-body" id="monthlyTrend"></div>
                            </div>
                        </div>
                        <div class="col-lg-4 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">Kategori Pengeluaran</h6>
                                </div>
                                <div class="card-body" id="expenseCategorySummary"></div>
                            </div>
                        </div>
                        <div class="col-lg-4 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">Health Check</h6>
                                </div>
                                <div class="card-body">
                                    <div id="cashflowHealth" class="mb-3"></div>
                                    <div id="diagnosticsHealth"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row mb-4">
                        <div class="col-lg-4 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">Quick Actions</h6>
                                </div>
                                <div class="card-body">
                                    <div class="quick-action-grid">
                                        <a class="quick-action-card" href="/pengeluaran">
                                            <i class="fas fa-receipt text-danger"></i>
                                            <span>Input Pengeluaran</span>
                                        </a>
                                        <a class="quick-action-card" href="/gaji-teknisi">
                                            <i class="fas fa-money-bill-wave text-success"></i>
                                            <span>Lihat Payroll</span>
                                        </a>
                                        <a class="quick-action-card" href="/admin-kasbon">
                                            <i class="fas fa-hand-holding-usd text-warning"></i>
                                            <span>Lihat Kasbon</span>
                                        </a>
                                        <button type="button" class="quick-action-card bg-white" data-toggle="modal" data-target="#adjustmentModal" style="border:1px solid #eef2f7;">
                                            <i class="fas fa-sliders-h text-primary"></i>
                                            <span>Lihat Adjustment</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-lg-4 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">5 Pengeluaran Terbesar</h6>
                                </div>
                                <div class="card-body" id="largestExpenses"></div>
                            </div>
                        </div>
                        <div class="col-lg-4 mb-3">
                            <div class="card summary-panel h-100">
                                <div class="card-header bg-white border-0">
                                    <h6 class="m-0 font-weight-bold text-primary">7 Pengeluaran Terbaru</h6>
                                </div>
                                <div class="card-body" id="recentExpenses"></div>
                            </div>
                        </div>
                    </div>

                    <div class="card ledger-panel mb-4">
                        <div class="card-header bg-white border-0 d-flex justify-content-between align-items-center">
                            <h6 class="m-0 font-weight-bold text-primary">Financial Ledger</h6>
                            <div class="btn-group btn-group-sm">
                                <button class="btn btn-outline-secondary ledger-filter-btn active" data-filter="all">Semua</button>
                                <button class="btn btn-outline-success ledger-filter-btn" data-filter="credit">Credit</button>
                                <button class="btn btn-outline-danger ledger-filter-btn" data-filter="debit">Debit</button>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover tabel-tumpuk-hp" id="transactionTable" width="100%">
                                    <thead>
                                        <tr>
                                            <th>Tanggal</th>
                                            <th>Domain</th>
                                            <th>Referensi</th>
                                            <th>Arah</th>
                                            <th>Nominal</th>
                                            <th>Metode</th>
                                            <th>Sumber</th>
                                            <th>Catatan</th>
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

    <div class="modal fade" id="adjustmentModal" tabindex="-1" role="dialog" aria-labelledby="adjustmentModalLabel" aria-hidden="true">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="adjustmentModalLabel">Manual Adjustment</h5>
                    <button type="button" class="close" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">&times;</span>
                    </button>
                </div>
                <form id="adjustmentForm" onsubmit="return false;">
                    <div class="modal-body">
                        <div class="form-group">
                            <label>Arah</label>
                            <select class="form-control" id="adjustmentDirection">
                                <option value="credit">Credit</option>
                                <option value="debit">Debit</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Nominal</label>
                            <input type="number" class="form-control" id="adjustmentAmount" min="1" placeholder="Masukkan nominal">
                        </div>
                        <div class="form-group">
                            <label>Target Domain</label>
                            <select class="form-control" id="adjustmentDomainTarget">
                                <option value="general_cash">General Cash</option>
                                <option value="technician_kasbon">Technician Kasbon</option>
                                <option value="technician_payroll">Technician Payroll</option>
                                <option value="technician_collection_commission">Komisi Teknisi</option>
                                <option value="topup_request_approved">Topup</option>
                                <option value="voucher_purchase">Voucher</option>
                                <option value="agent_transaction_confirmed">Agent</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Alasan</label>
                            <input type="text" class="form-control" id="adjustmentReason" placeholder="Alasan adjustment">
                        </div>
                        <div class="form-group mb-0">
                            <label>Catatan</label>
                            <textarea class="form-control" id="adjustmentNotes" rows="3" placeholder="Catatan tambahan"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                        <button type="button" class="btn btn-primary" id="saveAdjustmentBtn">Simpan Adjustment</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <div class="toast-stack" id="toastContainer"></div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <?php include '_logout_modal.php'; ?>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="/vendor/datatables/jquery.dataTables.min.js"></script>
    <script src="/vendor/datatables/dataTables.bootstrap4.min.js"></script>
    <script src="/js/rekap-keuangan.js"></script>
</body>
</html>
