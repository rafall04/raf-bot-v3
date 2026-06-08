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

    <style>
        #accordionSidebar .nav-item.active .nav-link {
            background-color: rgba(255, 255, 255, 0.1);
            font-weight: 600;
            border-left: 3px solid #4e73df;
            color: #ffffff;
        }
        .placeholder-list {
            list-style-type: none;
            padding-left: 0;
            font-size: 0.85rem;
        }
        .placeholder-list li {
            background-color: #f8f9fc;
            border: 1px solid #e3e6f0;
            padding: 6px 10px;
            margin-bottom: 4px;
            border-radius: .25rem;
        }
        .placeholder-list code {
            font-family: 'Courier New', Courier, monospace;
            background-color: #e3e6f0;
            padding: 2px 5px;
            border-radius: 3px;
            color: #4e73df;
            font-size: 0.9em;
        }
        .template-card {
            margin-bottom: 1.5rem;
            border: 1px solid #e3e6f0;
        }
        .template-card .card-header {
            font-weight: 600;
            background-color: #f8f9fc;
            border-bottom: 1px solid #e3e6f0;
            padding: 0.75rem 1.25rem;
        }
        .template-card .card-body {
            padding: 1rem;
        }
        .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1050;
        }
        .nav-tabs {
            border-bottom: 2px solid #e3e6f0;
            margin-bottom: 1.5rem;
        }
        .nav-tabs .nav-link {
            color: #858796;
            border: none;
            border-bottom: 3px solid transparent;
            padding: 0.75rem 1.5rem;
            font-weight: 500;
            transition: all 0.2s;
        }
        .nav-tabs .nav-link:hover {
            color: #4e73df;
            border-bottom-color: #d1d3e2;
        }
        .nav-tabs .nav-link.active {
            color: #4e73df;
            background-color: transparent;
            border: none;
            border-bottom: 3px solid #4e73df;
            font-weight: 600;
        }
        .tab-content {
            min-height: 400px;
        }
        .template-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
            gap: 1.5rem;
        }
        .template-card textarea {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9rem;
            line-height: 1.5;
        }
        .placeholder-sidebar {
            position: sticky;
            top: 20px;
            max-height: calc(100vh - 40px);
            overflow-y: auto;
        }
        .placeholder-sidebar::-webkit-scrollbar {
            width: 6px;
        }
        .placeholder-sidebar::-webkit-scrollbar-track {
            background: #f1f1f1;
        }
        .placeholder-sidebar::-webkit-scrollbar-thumb {
            background: #888;
            border-radius: 3px;
        }
        .placeholder-sidebar::-webkit-scrollbar-thumb:hover {
            background: #555;
        }
        .save-button-container {
            position: sticky;
            bottom: 0;
            background: white;
            padding: 1rem 0;
            border-top: 2px solid #e3e6f0;
            margin-top: 2rem;
            z-index: 10;
        }
        .template-search {
            margin-bottom: 1rem;
        }
        .template-search input {
            border-radius: 20px;
            padding-left: 2.5rem;
        }
        .template-search .search-icon {
            position: absolute;
            left: 1rem;
            top: 50%;
            transform: translateY(-50%);
            color: #858796;
        }
        .badge-category {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
            margin-left: 0.5rem;
        }
        @media (max-width: 768px) {
            .template-grid {
                grid-template-columns: 1fr;
            }
            .nav-tabs .nav-link {
                padding: 0.5rem 1rem;
                font-size: 0.9rem;
            }
        }
    </style>
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

    <script>
        $(document).ready(function() {
            // Fetch username
            fetch('/api/me', { credentials: 'include' })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200 && data.data && data.data.username) {
                        $('#username-placeholder').text(data.data.username);
                    }
                }).catch(err => console.warn("Could not fetch user data: ", err));

            const form = $('#templatesForm');
            let allTemplatesData = {};
            let templateCounts = {
                notification: 0,
                wifi: 0,
                response: 0,
                customer: 0,
                payment: 0,
                ticket: 0,
                command: 0,
                error: 0,
                success: 0,
                system: 0,
                menu: 0,
                report: 0
            };

            function showToast(message, type = 'success') {
                const toastId = 'toast-' + new Date().getTime();
                const toastHtml = `
                    <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-delay="5000">
                        <div class="toast-header">
                            <strong class="mr-auto">${type === 'success' ? 'Success' : 'Error'}</strong>
                            <button type="button" class="ml-2 mb-1 close" data-dismiss="toast" aria-label="Close">
                                <span aria-hidden="true">&times;</span>
                            </button>
                        </div>
                        <div class="toast-body">
                            ${message}
                        </div>
                    </div>`;
                $('.toast-container').append(toastHtml);
                $(`#${toastId}`).toast('show');
                $(`#${toastId}`).on('hidden.bs.toast', function () {
                    $(this).remove();
                });
            }

            function extractTemplatePlaceholders(templateText) {
                const matches = String(templateText || '').match(/\$\{([^}]+)\}/g) || [];
                return [...new Set(matches
                    .map(match => match.slice(2, -1).trim())
                    .filter(Boolean))];
            }

            function renderTemplateCard(key, templateData, groupName) {
                const cardId = `card-${groupName}-${key}`;
                const templateValue = typeof templateData === 'string' ? templateData : (templateData.template || '');
                const templateName = typeof templateData === 'string' ? key : (templateData.name || key);
                const placeholders = extractTemplatePlaceholders(templateValue);
                const placeholderText = placeholders.join(', ');
                const placeholderHint = placeholders.length > 0
                    ? `<div class="small text-muted mt-2" data-template-placeholders="${placeholderText}">
                        <i class="fas fa-code"></i> Placeholder: ${placeholders.map(placeholder => `<code>\${${placeholder}}</code>`).join(' ')}
                    </div>`
                    : `<div class="small text-muted mt-2" data-template-placeholders="">
                        <i class="fas fa-code"></i> Placeholder: -
                    </div>`;
                
                return `
                    <div class="card shadow template-card" id="${cardId}" data-template-key="${key}">
                        <div class="card-header">
                            <div class="d-flex justify-content-between align-items-center">
                                <span class="font-weight-bold">${templateName}</span>
                                <small class="text-muted">${key}</small>
                            </div>
                        </div>
                        <div class="card-body">
                            <div class="form-group mb-0">
                                <textarea class="form-control" 
                                    id="template-${groupName}-${key}" 
                                    data-group="${groupName}" 
                                    name="${key}" 
                                    rows="5"
                                    placeholder="Enter template content here...">${templateValue}</textarea>
                                ${placeholderHint}
                            </div>
                        </div>
                    </div>`;
            }

            function categorizeTemplates(templates) {
                const categorized = {
                    notification: {},
                    wifi: {},
                    response: {},
                    customer: {},
                    payment: {},
                    ticket: {},
                    command: {},
                    error: {},
                    success: {},
                    system: {},
                    menu: {},
                    report: {}
                };

                // Reset counts
                Object.keys(templateCounts).forEach(key => templateCounts[key] = 0);

                // Categorize notification templates
                // IMPORTANT: Templates are only categorized for display, they remain in notificationTemplates
                if (templates.notificationTemplates) {
                    for (const [key, value] of Object.entries(templates.notificationTemplates)) {
                        // Check for payment/invoice keywords first (more specific)
                        if (key.includes('payment') || key.includes('invoice') || key.includes('tagihan') || key.includes('bayar')) {
                            categorized.payment[key] = value;
                            templateCounts.payment++;
                        } 
                        // Check for ticket/lapor keywords
                        else if (key.includes('ticket') || key.includes('lapor') || key.includes('report')) {
                            categorized.ticket[key] = value;
                            templateCounts.ticket++;
                        } 
                        // Default to notification category
                        else {
                            categorized.notification[key] = value;
                            templateCounts.notification++;
                        }
                    }
                }

                // WiFi menu templates
                if (templates.wifiMenuTemplates) {
                    categorized.wifi = templates.wifiMenuTemplates;
                    templateCounts.wifi = Object.keys(templates.wifiMenuTemplates).length;
                }

                // Response templates
                // IMPORTANT: Templates are only categorized for display, they remain in responseTemplates
                if (templates.responseTemplates) {
                    for (const [key, value] of Object.entries(templates.responseTemplates)) {
                        // Check for customer/pelanggan/user keywords first (most specific)
                        if (key.includes('customer') || key.includes('pelanggan') || key.includes('user') || key.includes('welcome')) {
                            categorized.customer[key] = value;
                            templateCounts.customer++;
                        } 
                        // Check for payment/bayar/tagihan keywords
                        else if (key.includes('payment') || key.includes('bayar') || key.includes('tagihan') || key.includes('invoice')) {
                            categorized.payment[key] = value;
                            templateCounts.payment++;
                        } 
                        // Check for ticket/lapor keywords
                        else if (key.includes('ticket') || key.includes('lapor') || key.includes('report')) {
                            categorized.ticket[key] = value;
                            templateCounts.ticket++;
                        } 
                        // Default to response category
                        else {
                            categorized.response[key] = value;
                            templateCounts.response++;
                        }
                    }
                }

                // Command templates
                if (templates.commandTemplates) {
                    categorized.command = templates.commandTemplates;
                    templateCounts.command = Object.keys(templates.commandTemplates).length;
                }

                // Error templates
                if (templates.errorTemplates) {
                    categorized.error = templates.errorTemplates;
                    templateCounts.error = Object.keys(templates.errorTemplates).length;
                }

                // Success templates
                if (templates.successTemplates) {
                    categorized.success = templates.successTemplates;
                    templateCounts.success = Object.keys(templates.successTemplates).length;
                }

                // System templates
                if (templates.systemTemplates) {
                    categorized.system = templates.systemTemplates;
                    templateCounts.system = Object.keys(templates.systemTemplates).length;
                }

                // Menu templates
                if (templates.menuTemplates) {
                    categorized.menu = templates.menuTemplates;
                    templateCounts.menu = Object.keys(templates.menuTemplates).length;
                }

                // Report templates
                if (templates.reportTemplates) {
                    categorized.report = templates.reportTemplates;
                    templateCounts.report = Object.keys(templates.reportTemplates).length;
                }

                return categorized;
            }

            function renderTemplates(category, templates) {
                const container = $(`#${category}Templates`);
                container.empty();

                if (Object.keys(templates).length === 0) {
                    container.html(`
                        <div class="col-12">
                            <div class="alert alert-info">
                                <i class="fas fa-info-circle"></i> No templates found in this category.
                            </div>
                        </div>
                    `);
                    return;
                }

                for (const [key, value] of Object.entries(templates)) {
                    container.append(renderTemplateCard(key, value, category));
                }
            }

            function updateBadges() {
                Object.keys(templateCounts).forEach(category => {
                    $(`#${category}-count`).text(templateCounts[category]);
                });
            }

            function loadTemplates() {
                // Show loading in all tabs
                $('.template-grid').each(function() {
                    $(this).html(`
                        <div class="text-center p-5">
                            <div class="spinner-border text-primary" role="status">
                                <span class="sr-only">Loading...</span>
                            </div>
                            <p class="mt-3">Loading templates...</p>
                        </div>
                    `);
                });

                fetch('/api/templates', { credentials: 'include' })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(result => {
                        if (result.status !== 200 || typeof result.data !== 'object') {
                            throw new Error(result.message || 'Invalid data format from server.');
                        }
                        
                        allTemplatesData = result.data;
                        const categorized = categorizeTemplates(allTemplatesData);
                        
                        // Render each category
                        Object.keys(categorized).forEach(category => {
                            renderTemplates(category, categorized[category]);
                        });
                        
                        // Update badges
                        updateBadges();
                    })
                    .catch(error => {
                        console.error('Error loading templates:', error);
                        $('.template-grid').html('<div class="alert alert-danger">Failed to load templates. Please try refreshing the page.</div>');
                    });
            }

            // Search functionality
            $('#templateSearch').on('input', function() {
                const searchTerm = $(this).val().toLowerCase();
                
                if (searchTerm === '') {
                    $('.template-card').show();
                } else {
                    $('.template-card').each(function() {
                        const card = $(this);
                        const key = card.data('template-key');
                        const headerText = card.find('.card-header').text().toLowerCase();
                        const textareaContent = card.find('textarea').val().toLowerCase();
                        
                        if (key.includes(searchTerm) || headerText.includes(searchTerm) || textareaContent.includes(searchTerm)) {
                            card.show();
                        } else {
                            card.hide();
                        }
                    });
                }
            });

            // Load templates on page load
            loadTemplates();
            
            // Make loadTemplates available globally for reload button
            window.loadTemplates = loadTemplates;

            function buildTemplatePayloadEntry(sourceEntry, headerText, templateText) {
                if (sourceEntry && typeof sourceEntry === 'object' && !Array.isArray(sourceEntry)) {
                    return {
                        ...sourceEntry,
                        name: sourceEntry.name || headerText,
                        template: templateText
                    };
                }

                return {
                    name: headerText,
                    template: templateText
                };
            }

            // Form submission
            form.on('submit', function(event) {
                event.preventDefault();
                const submitButton = $(this).find('button[type="submit"]');
                const originalButtonText = submitButton.html();
                submitButton.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Saving...');

                const payload = {
                    notificationTemplates: {},
                    wifiMenuTemplates: {},
                    responseTemplates: {},
                    commandTemplates: {},
                    errorTemplates: {},
                    successTemplates: {},
                    systemTemplates: {},
                    menuTemplates: {},
                    reportTemplates: {}
                };

                // Collect all textarea values
                // IMPORTANT: Map categories back to original source files to prevent duplication
                const processedKeys = new Set(); // Track target file + key to prevent same-source duplicates
                
                $('.template-card').each(function() {
                    const card = $(this);
                    const textarea = card.find('textarea');
                    const key = textarea.attr('name');
                    const group = textarea.data('group');
                    const value = textarea.val();
                    
                    if (!key || !value) return;
                    
                    // Map categories back to original source files
                    // Templates are categorized for display only, but saved to their original source
                    let targetGroup = null;
                    if (group === 'notification' || group === 'ticket' || group === 'payment') {
                        // Check if key exists in original notificationTemplates
                        if (allTemplatesData.notificationTemplates && allTemplatesData.notificationTemplates[key]) {
                            targetGroup = 'notificationTemplates';
                        } else if (allTemplatesData.responseTemplates && allTemplatesData.responseTemplates[key]) {
                            targetGroup = 'responseTemplates';
                        } else {
                            // Default: if categorized as notification/ticket/payment, save to notificationTemplates
                            targetGroup = 'notificationTemplates';
                        }
                    } else if (group === 'wifi') {
                        targetGroup = 'wifiMenuTemplates';
                    } else if (group === 'response' || group === 'customer') {
                        // Check if key exists in original responseTemplates
                        if (allTemplatesData.responseTemplates && allTemplatesData.responseTemplates[key]) {
                            targetGroup = 'responseTemplates';
                        } else if (allTemplatesData.notificationTemplates && allTemplatesData.notificationTemplates[key]) {
                            targetGroup = 'notificationTemplates';
                        } else {
                            // Default: if categorized as response/customer, save to responseTemplates
                            targetGroup = 'responseTemplates';
                        }
                    } else if (group === 'command') {
                        targetGroup = 'commandTemplates';
                    } else if (group === 'error') {
                        targetGroup = 'errorTemplates';
                    } else if (group === 'success') {
                        targetGroup = 'successTemplates';
                    } else if (group === 'system') {
                        targetGroup = 'systemTemplates';
                    } else if (group === 'menu') {
                        targetGroup = 'menuTemplates';
                    } else if (group === 'report') {
                        targetGroup = 'reportTemplates';
                    }
                    
                    if (targetGroup) {
                        const processedKey = `${targetGroup}:${key}`;
                        if (processedKeys.has(processedKey)) {
                            console.warn(`[TEMPLATES] Duplicate key detected: ${key} in ${targetGroup}. Skipping duplicate.`);
                            return;
                        }
                        processedKeys.add(processedKey);

                        if (targetGroup === 'wifiMenuTemplates') {
                            payload[targetGroup][key] = value;
                        } else {
                            const headerText = card.find('.card-header span.font-weight-bold').text().trim();
                            const originalEntry = allTemplatesData[targetGroup] && allTemplatesData[targetGroup][key];
                            payload[targetGroup][key] = buildTemplatePayloadEntry(originalEntry, headerText, value);
                        }
                    }
                });

                fetch('/api/templates', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(payload)
                })
                .then(response => response.json().then(data => ({ ok: response.ok, data })))
                .then(result => {
                    if (result.ok) {
                        showToast('Templates saved successfully!', 'success');
                    } else {
                        throw new Error(result.data.message || 'An unknown error occurred.');
                    }
                })
                .catch(error => {
                    console.error('Error saving templates:', error);
                    showToast(`Error saving templates: ${error.message}`, 'danger');
                })
                .finally(() => {
                    submitButton.prop('disabled', false).html(originalButtonText);
                });
            });
        });
    </script>
</body>
</html>
