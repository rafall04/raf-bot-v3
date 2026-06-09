<!DOCTYPE html>
<html lang="en">
<!--
Header Doc
Purpose: Halaman admin untuk load, edit, dan save kategori template pesan WhatsApp runtime.
Caller: `routes/pages.js` saat admin membuka `/templates`.
Deps: `/api/templates`, jQuery, Bootstrap tabs/toast, `routes/admin-content-routes.js`.
MainFuncs: `loadTemplates`, `categorizeTemplates`, `renderTemplateCard`, `extractTemplatePlaceholders`, `buildTemplatePayloadEntry`.
SideEffects: POST perubahan template ke `/api/templates` dan memicu reload cache server.
-->

<head>
    <?php
    $pageTitle = 'RAF BOT - Message Templates';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/css/templates.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
    <!-- Sidebar -->
    <?php include '_navbar.php'; ?>
    <!-- End of Sidebar -->

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <!-- Topbar -->
                <?php include 'topbar.php'; ?>
                <!-- End of Topbar -->

                <!-- Begin Page Content -->
                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <!-- Page Header -->
          <div class="dashboard-header">
            <h1>Message Templates Editor</h1>
            <p>Kelola dan monitor message templates editor</p>
          </div>
                        <div class="template-search position-relative" style="width: 300px;">
                            <i class="fas fa-search search-icon"></i>
                            <input type="text" class="form-control" id="templateSearch" placeholder="Search templates...">
                        </div>
                    </div>

                    <!-- Placeholder Documentation Card -->
                    <div class="card shadow mb-4">
                        <div class="card-header py-3" style="background-color: #f8f9fa;">
                            <h6 class="m-0 font-weight-bold text-info">
                                <i class="fas fa-info-circle"></i> Standar Placeholder untuk Template
                            </h6>
                        </div>
                        <div class="card-body">
                            <div class="row">
                                <div class="col-md-3">
                                    <h6 class="font-weight-bold text-primary">🏢 System</h6>
                                    <ul class="small list-unstyled">
                                        <li><code>${nama_wifi}</code> - Nama layanan WiFi</li>
                                        <li><code>${nama_bot}</code> - Nama bot WhatsApp</li>
                                    </ul>
                                </div>
                                <div class="col-md-3">
                                    <h6 class="font-weight-bold text-primary">👤 User</h6>
                                    <ul class="small list-unstyled">
                                        <li><code>${nama_pelanggan}</code> - Nama pelanggan</li>
                                        <li><code>${pushname}</code> - Nama WhatsApp</li>
                                        <li><code>${username}</code> - Username sistem</li>
                                        <li><code>${phone}</code> - Nomor telepon</li>
                                    </ul>
                                </div>
                                <div class="col-md-3">
                                    <h6 class="font-weight-bold text-primary">💳 Billing</h6>
                                    <ul class="small list-unstyled">
                                        <li><code>${nama_paket}</code> - Nama paket</li>
                                        <li><code>${harga_formatted}</code> - Harga (Rp)</li>
                                        <li><code>${periode}</code> - Periode tagihan</li>
                                        <li><code>${jatuh_tempo}</code> - Jatuh tempo</li>
                                    </ul>
                                </div>
                                <div class="col-md-3">
                                    <h6 class="font-weight-bold text-primary">🔧 Technical</h6>
                                    <ul class="small list-unstyled">
                                        <li><code>${ticket_id}</code> - ID tiket</li>
                                        <li><code>${nama_teknisi}</code> - Nama teknisi</li>
                                        <li><code>${ssid}</code> - Nama WiFi (SSID)</li>
                                        <li><code>${tanggal}</code> - Tanggal</li>
                                    </ul>
                                </div>
                            </div>
                            <div class="alert alert-warning mt-3 mb-0 small">
                                <i class="fas fa-exclamation-triangle"></i> <strong>PENTING:</strong> 
                                Jangan gunakan <code>${nama}</code> saja (ambigu), gunakan <code>${nama_pelanggan}</code> atau <code>${nama_wifi}</code> sesuai konteks.
                                Jangan gunakan <code>${namabot}</code>, gunakan <code>${nama_bot}</code>.
                                Jangan gunakan <code>${paket}</code>, gunakan <code>${nama_paket}</code>.
                            </div>
                        </div>
                    </div>
                    
                    <div class="row">
                        <div class="col-lg-9">
                            <form id="templatesForm">
                                <!-- Tab Navigation -->
                                <ul class="nav nav-tabs" id="templateTabs" role="tablist">
                                    <li class="nav-item">
                                        <a class="nav-link active" id="notification-tab" data-toggle="tab" href="#notification" role="tab">
                                            <i class="fas fa-bell"></i> Notifications
                                            <span class="badge badge-primary badge-category" id="notification-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="wifi-tab" data-toggle="tab" href="#wifi" role="tab">
                                            <i class="fas fa-wifi"></i> WiFi Menu
                                            <span class="badge badge-primary badge-category" id="wifi-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="response-tab" data-toggle="tab" href="#response" role="tab">
                                            <i class="fas fa-comment-dots"></i> Bot Responses
                                            <span class="badge badge-primary badge-category" id="response-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="customer-tab" data-toggle="tab" href="#customer" role="tab">
                                            <i class="fas fa-user"></i> Customer
                                            <span class="badge badge-primary badge-category" id="customer-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="payment-tab" data-toggle="tab" href="#payment" role="tab">
                                            <i class="fas fa-money-bill-wave"></i> Payment
                                            <span class="badge badge-primary badge-category" id="payment-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="ticket-tab" data-toggle="tab" href="#ticket" role="tab">
                                            <i class="fas fa-ticket-alt"></i> Tickets
                                            <span class="badge badge-primary badge-category" id="ticket-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="command-tab" data-toggle="tab" href="#command" role="tab">
                                            <i class="fas fa-terminal"></i> Template Teks Bot
                                            <span class="badge badge-primary badge-category" id="command-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="error-tab" data-toggle="tab" href="#error" role="tab">
                                            <i class="fas fa-exclamation-triangle"></i> Errors
                                            <span class="badge badge-primary badge-category" id="error-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="success-tab" data-toggle="tab" href="#success" role="tab">
                                            <i class="fas fa-check-circle"></i> Success
                                            <span class="badge badge-primary badge-category" id="success-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="system-tab" data-toggle="tab" href="#system" role="tab">
                                            <i class="fas fa-cog"></i> System Messages
                                            <span class="badge badge-primary badge-category" id="system-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="menu-tab" data-toggle="tab" href="#menu" role="tab">
                                            <i class="fas fa-list"></i> Menu
                                            <span class="badge badge-primary badge-category" id="menu-count">0</span>
                                        </a>
                                    </li>
                                    <li class="nav-item">
                                        <a class="nav-link" id="report-tab" data-toggle="tab" href="#report" role="tab">
                                            <i class="fas fa-chart-line"></i> Laporan
                                            <span class="badge badge-primary badge-category" id="report-count">0</span>
                                        </a>
                                    </li>
                                </ul>

                                <!-- Tab Content -->
                                <div class="tab-content" id="templateTabContent">
                                    <div class="tab-pane fade show active" id="notification" role="tabpanel">
                                        <div class="template-grid" id="notificationTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading notification templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="wifi" role="tabpanel">
                                        <div class="template-grid" id="wifiTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading WiFi menu templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="response" role="tabpanel">
                                        <div class="template-grid" id="responseTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading response templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="customer" role="tabpanel">
                                        <div class="template-grid" id="customerTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading customer templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="payment" role="tabpanel">
                                        <div class="template-grid" id="paymentTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading payment templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="ticket" role="tabpanel">
                                        <div class="template-grid" id="ticketTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading ticket templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="command" role="tabpanel">
                                        <div class="alert alert-info">
                                            <i class="fas fa-info-circle"></i>
                                            Bagian ini hanya untuk <strong>teks/menu bot</strong> yang dirender runtime.
                                            <strong>Keyword command bot aktif</strong> seperti <code>gantisandi</code> atau <code>ganti sandi</code>
                                            dikelola di halaman <strong>WiFi Templates</strong>, bukan di sini.
                                        </div>
                                        <div class="template-grid" id="commandTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading command templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="error" role="tabpanel">
                                        <div class="template-grid" id="errorTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading error templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="success" role="tabpanel">
                                        <div class="template-grid" id="successTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading success templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="system" role="tabpanel">
                                        <div class="template-grid" id="systemTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading system messages...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="menu" role="tabpanel">
                                        <div class="template-grid" id="menuTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading menu templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="tab-pane fade" id="report" role="tabpanel">
                                        <div class="template-grid" id="reportTemplates">
                                            <div class="text-center p-5">
                                                <div class="spinner-border text-primary" role="status">
                                                    <span class="sr-only">Loading...</span>
                                                </div>
                                                <p class="mt-3">Loading report templates...</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Save Button -->
                                <div class="save-button-container">
                                    <button type="submit" class="btn btn-primary btn-lg">
                                        <i class="fas fa-save"></i> Save All Templates
                                    </button>
                                    <button type="button" class="btn btn-secondary btn-lg ml-2" onclick="loadTemplates()">
                                        <i class="fas fa-sync-alt"></i> Reload
                                    </button>
                                </div>
                            </form>
                        </div>
                        
                        <!-- Sidebar with Placeholders -->
                        <div class="col-lg-3">
                            <div class="card shadow mb-4">
                                <div class="card-header py-3">
                                    <h6 class="m-0 font-weight-bold text-primary">
                                        <i class="fas fa-lightbulb"></i> Quick Reference
                                    </h6>
                                </div>
                                <div class="card-body">
                                    <div class="alert alert-info" style="font-size: 0.85rem;">
                                        <i class="fas fa-info-circle"></i> Gunakan placeholder standar ini di template Anda.
                                    </div>

                                    <div class="accordion" id="placeholderAccordion">
                                        <!-- General Placeholders -->
                                        <div class="card">
                                            <div class="card-header p-2" id="headingGeneral">
                                                <h6 class="mb-0">
                                                    <button class="btn btn-link btn-sm text-left" type="button" data-toggle="collapse" data-target="#collapseGeneral">
                                                        <i class="fas fa-globe"></i> Umum & Pengguna
                                                    </button>
                                                </h6>
                                            </div>
                                            <div id="collapseGeneral" class="collapse show" data-parent="#placeholderAccordion">
                                                <div class="card-body p-2">
                                                    <ul class="placeholder-list">
                                                        <li><code>${nama_pelanggan}</code> - Nama pelanggan</li>
                                                        <li><code>${pushname}</code> - Nama WhatsApp</li>
                                                        <li><code>${username}</code> - Username untuk login</li>
                                                        <li><code>${password}</code> - Password untuk login</li>
                                                        <li><code>${portal_url}</code> - URL portal pelanggan</li>
                                                        <li><code>${nama_wifi}</code> - Nama WiFi</li>
                                                        <li><code>${nama_bot}</code> - Nama bot</li>
                                                        <li><code>${phone}</code> - No. telepon</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                            </div>

                                            <!-- Billing Placeholders -->
                                            <div class="card">
                                                <div class="card-header p-2" id="headingBilling">
                                                    <h6 class="mb-0">
                                                        <button class="btn btn-link btn-sm text-left collapsed" type="button" data-toggle="collapse" data-target="#collapseBilling">
                                                            <i class="fas fa-file-invoice-dollar"></i> Tagihan & Paket
                                                        </button>
                                                    </h6>
                                                </div>
                                                <div id="collapseBilling" class="collapse" data-parent="#placeholderAccordion">
                                                    <div class="card-body p-2">
                                                        <ul class="placeholder-list">
                                                            <li><code>${paket}</code> - Nama paket</li>
                                                            <li><code>${harga}</code> - Harga (Rupiah)</li>
                                                            <li><code>${periode}</code> - Periode</li>
                                                            <li><code>${jatuh_tempo}</code> - Jatuh tempo</li>
                                                            <li><code>${rekening}</code> - Rekening</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>

                                            <!-- Voucher Placeholders -->
                                            <div class="card">
                                                <div class="card-header p-2" id="headingVoucher">
                                                    <h6 class="mb-0">
                                                        <button class="btn btn-link btn-sm text-left collapsed" type="button" data-toggle="collapse" data-target="#collapseVoucher">
                                                            <i class="fas fa-ticket-alt"></i> Voucher & Saldo
                                                        </button>
                                                    </h6>
                                                </div>
                                                <div id="collapseVoucher" class="collapse" data-parent="#placeholderAccordion">
                                                    <div class="card-body p-2">
                                                        <ul class="placeholder-list">
                                                            <li><code>${voucherListString}</code> - List voucher</li>
                                                            <li><code>${formattedSaldo}</code> - Saldo</li>
                                                            <li><code>${contoh_harga_voucher}</code> - Contoh harga</li>
                                                            <li><code>${sisaSaldo}</code> - Sisa saldo</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>

                                            <!-- Dynamic Placeholders -->
                                            <div class="card">
                                                <div class="card-header p-2" id="headingDynamic">
                                                    <h6 class="mb-0">
                                                        <button class="btn btn-link btn-sm text-left collapsed" type="button" data-toggle="collapse" data-target="#collapseDynamic">
                                                            <i class="fas fa-code"></i> Dinamis
                                                        </button>
                                                    </h6>
                                                </div>
                                                <div id="collapseDynamic" class="collapse" data-parent="#placeholderAccordion">
                                                    <div class="card-body p-2">
                                                        <ul class="placeholder-list">
                                                            <li><code>${list}</code> - Daftar dinamis</li>
                                                            <li><code>${adminWaLink}</code> - Link WA admin (https://wa.me/628xxxx)</li>
                                                            <li><code>${nomor_admin}</code> - Nomor admin WhatsApp (089685645956)</li>
                                                            <li><code>${targetUserName}</code> - Target user</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- /.container-fluid -->
            </div>
            <!-- End of Main Content -->

            <!-- Footer -->
            <footer class="sticky-footer bg-white"><div class="container my-auto"><div class="copyright text-center my-auto"><span>Copyright &copy; RAF BOT 2025</span></div></div></footer>
        </div>
    </div>
    <!-- End of Page Wrapper -->

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>
    <div class="modal fade" id="logoutModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h5 class="modal-title">Ready to Leave?</h5><button class="close" type="button" data-dismiss="modal">&times;</button></div><div class="modal-body">Select "Logout" to end session.</div><div class="modal-footer"><button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button><a class="btn btn-primary" href="/logout">Logout</a></div></div></div></div>

    <!-- Toast container for notifications -->
    <div class="toast-container"></div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>

    <script src="/js/templates.js"></script>
</body>
</html>
