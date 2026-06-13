<!DOCTYPE html>
<html lang="id">

<head>
    <?php
    $pageTitle = 'RAF BOT - Kirim Voucher';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT - Kirim Voucher via WhatsApp';
    include __DIR__ . '/_head.php';
    ?>

    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    <link href="<?= rafAssetUrl('/css/voucher-send.css') ?>" rel="stylesheet">
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
                        <h1><i class="fas fa-paper-plane mr-2"></i>Kirim Voucher</h1>
                        <p>Generate dan kirim voucher hotspot via WhatsApp</p>
                    </div>

                    <div class="row">
                        <!-- Form -->
                        <div class="col-lg-7 mb-4">
                            <div class="card-modern">
                                <div class="card-header">
                                    <i class="fas fa-edit mr-2 text-primary"></i>Form Kirim Voucher
                                </div>
                                <div class="card-body">
                                    <!-- Use Case -->
                                    <div class="form-section">
                                        <div class="form-section-title"><i class="fas fa-project-diagram"></i> Use Case</div>
                                        <div class="type-selector">
                                            <div class="type-btn active" data-use-case="direct_customer_sale" onclick="setUseCase('direct_customer_sale')">
                                                <i class="fas fa-user"></i>End User<br>
                                                <small class="text-muted">Jual langsung ke pelanggan</small>
                                            </div>
                                            <div class="type-btn" data-use-case="agent_purchase" onclick="setUseCase('agent_purchase')">
                                                <i class="fas fa-store"></i>Agent Purchase<br>
                                                <small class="text-muted">Stok agent harga reseller</small>
                                            </div>
                                            <div class="type-btn" data-use-case="delivery_resend" onclick="setUseCase('delivery_resend')">
                                                <i class="fas fa-redo"></i>Resend Existing<br>
                                                <small class="text-muted">Kirim ulang tanpa transaksi baru</small>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Tipe Voucher -->
                                    <div class="form-section" id="voucherTypeSection">
                                        <div class="form-section-title"><i class="fas fa-tags"></i> Tipe Voucher</div>
                                        <div class="type-selector">
                                            <div class="type-btn active" data-type="random" onclick="setVoucherType('random')">
                                                <i class="fas fa-random"></i>Random<br>
                                                <small class="text-muted">Kode acak 6 karakter</small>
                                            </div>
                                            <div class="type-btn" data-type="custom" onclick="setVoucherType('custom')">
                                                <i class="fas fa-edit"></i>Custom<br>
                                                <small class="text-muted">Username & Password</small>
                                            </div>
                                        </div>
                                    </div>

                                    <div class="form-section" id="agentPurchaseSection" style="display: none;">
                                        <div class="form-section-title"><i class="fas fa-user-tie"></i> Agent Purchase</div>
                                        <div class="form-group mb-2">
                                            <select class="form-control form-control-sm" id="agentSelect">
                                                <option value="">-- Pilih agent --</option>
                                            </select>
                                        </div>
                                        <div class="form-group mb-0">
                                            <select class="form-control form-control-sm" id="agentPaymentMethod">
                                                <option value="saldo">Saldo Agent</option>
                                                <option value="cash">Cash</option>
                                                <option value="transfer">Transfer</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div class="form-section" id="resendSection" style="display: none;">
                                        <div class="form-section-title"><i class="fas fa-history"></i> Referensi Resend</div>
                                        <select class="form-control form-control-sm" id="resendReference">
                                            <option value="">-- Pilih history voucher --</option>
                                        </select>
                                        <small class="text-muted d-block mt-2">Jika nomor tujuan dikosongkan, sistem memakai nomor dari history asli.</small>
                                    </div>

                                    <!-- Pilih Paket -->
                                    <div class="form-section">
                                        <div class="form-section-title"><i class="fas fa-box"></i> Pilih Paket</div>
                                        <div class="voucher-grid" id="voucherList">
                                            <div class="text-center py-3 text-muted" style="grid-column: 1/-1;">
                                                <i class="fas fa-spinner fa-spin"></i> Memuat...
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Custom Credentials (hidden by default) -->
                                    <div class="form-section" id="customCredsSection" style="display: none;">
                                        <div class="form-section-title"><i class="fas fa-key"></i> Kredensial Custom</div>
                                        <div class="custom-creds-row">
                                            <div class="form-group">
                                                <input type="text" class="form-control form-control-sm" id="customUsername" placeholder="Username">
                                            </div>
                                            <div class="form-group">
                                                <input type="text" class="form-control form-control-sm" id="customPassword" placeholder="Password">
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Jumlah (only for random) -->
                                    <div class="form-section" id="qtySection">
                                        <div class="form-section-title"><i class="fas fa-sort-numeric-up"></i> Jumlah Voucher</div>
                                        <div class="qty-selector">
                                            <button type="button" class="qty-btn selected" data-qty="1">1</button>
                                            <button type="button" class="qty-btn" data-qty="2">2</button>
                                            <button type="button" class="qty-btn" data-qty="3">3</button>
                                            <button type="button" class="qty-btn" data-qty="5">5</button>
                                            <button type="button" class="qty-btn" data-qty="10">10</button>
                                            <input type="number" class="form-control form-control-sm" id="customQty" placeholder="Lainnya" min="1" max="50" style="width: 80px;">
                                        </div>
                                    </div>

                                    <!-- Nomor Tujuan -->
                                    <div class="form-section" id="phoneSection">
                                        <div class="form-section-title"><i class="fas fa-phone"></i> Nomor Tujuan</div>
                                        <select class="form-control form-control-sm mb-2" id="customerSearch" style="width: 100%;">
                                            <option value="">-- Cari pelanggan --</option>
                                        </select>
                                        <div id="phoneContainer">
                                            <div class="phone-item">
                                                <input type="text" class="form-control form-control-sm phone-input" placeholder="08xxxxxxxxxx">
                                                <button type="button" class="btn-remove-phone" onclick="removePhone(this)" disabled><i class="fas fa-times"></i></button>
                                            </div>
                                        </div>
                                        <button type="button" class="btn-add-phone mt-2" onclick="addPhone()">
                                            <i class="fas fa-plus mr-1"></i>Tambah
                                        </button>
                                    </div>

                                    <!-- Catatan -->
                                    <div class="form-section">
                                        <div class="form-section-title"><i class="fas fa-sticky-note"></i> Catatan (Opsional)</div>
                                        <textarea class="form-control form-control-sm" id="notes" rows="2" placeholder="Catatan untuk penerima..."></textarea>
                                    </div>

                                    <!-- Actions -->
                                    <div class="text-center mt-3">
                                        <button type="button" class="btn-action btn-send mr-2" onclick="generateAndSend()">
                                            <i class="fas fa-paper-plane mr-1"></i>Kirim WhatsApp
                                        </button>
                                        <button type="button" class="btn-action btn-generate" id="btnGenerateOnly" onclick="generateOnly()">
                                            <i class="fas fa-ticket-alt mr-1"></i>Generate Saja
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Preview & Stats -->
                        <div class="col-lg-5 mb-4">
                            <!-- Preview -->
                            <div class="card-modern mb-3">
                                <div class="card-header">
                                    <i class="fas fa-eye mr-2 text-primary"></i>Preview Pesan
                                </div>
                                <div class="card-body">
                                    <div class="preview-box" id="messagePreview">Pilih paket untuk melihat preview...</div>
                                </div>
                            </div>

                            <!-- Stats -->
                            <div class="stats-row">
                                <div class="stat-card">
                                    <div class="value" id="statToday">0</div>
                                    <div class="label">Hari Ini</div>
                                </div>
                                <div class="stat-card">
                                    <div class="value" id="statTotal">0</div>
                                    <div class="label">Total</div>
                                </div>
                            </div>

                            <!-- History -->
                            <div class="card-modern">
                                <div class="card-header d-flex justify-content-between align-items-center">
                                    <span><i class="fas fa-history mr-2 text-primary"></i>Riwayat</span>
                                </div>
                                <div class="card-body p-0">
                                    <div class="table-responsive">
                                        <table class="table history-table mb-0">
                                            <thead>
                                                <tr><th>Waktu</th><th>Paket</th><th>Status</th></tr>
                                            </thead>
                                            <tbody id="historyBody">
                                                <tr><td colspan="3" class="text-center py-3 text-muted">Belum ada</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <?php include __DIR__ . '/footer.php'; ?>
        </div>
    </div>

    <!-- Result Modal -->
    <div class="modal fade" id="resultModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-check-circle text-success mr-2"></i>Berhasil</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body" id="resultContent"></div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary btn-sm" data-dismiss="modal">Tutup</button>
                    <button type="button" class="btn btn-primary btn-sm" onclick="copyAllCodes()">
                        <i class="fas fa-copy mr-1"></i>Salin Kode
                    </button>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>

    <script src="/js/voucher-send.js"></script>
</body>
</html>
