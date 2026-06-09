<!DOCTYPE html>
<html lang="en">

<head>
    <?php
    $pageTitle = 'RAF BOT - WiFi Command Templates';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>

    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="/css/wifi-templates.css" rel="stylesheet">
</head>

<body id="page-top">
    <div id="wrapper">
        <!-- Sidebar -->
        <?php include '_navbar.php'; ?>
        <!-- End of Sidebar -->

        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <!-- Topbar -->
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
                    <form class="form-inline">
                        <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                            <i class="fa fa-bars"></i>
                        </button>
                    </form>
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown">
                                <span id="username-placeholder" class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg" onerror="this.onerror=null; this.src='data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMTgiIGZpbGw9IiNlMGUwZTAiLz48Y2lyY2xlIGN4PSIyMCIgY3k9IjE1IiByPSI1IiBmaWxsPSIjYWFhIi8+PHBhdGggZD0iTTIwIDI0YzUgMCA5IDMgOSA2djZINDF2LTZjMC0zIDQtNiA5LTZ6IiBmaWxsPSIjYWFhIi8+PC9zdmc+'">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in" aria-labelledby="userDropdown">
                                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                                    Logout
                                </a>
                            </div>
                        </li>
                    </ul>
                </nav>
                <!-- End of Topbar -->

                <!-- Begin Page Content -->
                <div class="container-fluid">
                    <div class="d-sm-flex align-items-center justify-content-between mb-4">
                        <h1 class="h3 mb-0 text-gray-800">
                            <i class="fas fa-comments"></i> WiFi Command Templates
                        </h1>
                        <button class="btn btn-primary btn-icon-split" data-toggle="modal" data-target="#addTemplateModal">
                            <span class="icon text-white-50">
                                <i class="fas fa-plus"></i>
                            </span>
                            <span class="text">Tambah Template Baru</span>
                        </button>
                    </div>

                    <!-- Statistics Row -->
                    <div class="row mb-4">
                        <div class="col-xl-4 col-md-6 mb-4">
                            <div class="card dashboard-card card-primary">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-primary text-uppercase mb-1">Total Templates</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="total-templates">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-comments fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-4 col-md-6 mb-4">
                            <div class="card dashboard-card card-success">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-success text-uppercase mb-1">Total Keywords</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="total-keywords">-</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-key fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-4 col-md-6 mb-4">
                            <div class="card dashboard-card card-info">
                                <div class="card-body">
                                    <div class="row no-gutters align-items-center">
                                        <div class="col mr-2">
                                            <div class="text-xs font-weight-bold text-info text-uppercase mb-1">Active Category</div>
                                            <div class="h5 mb-0 font-weight-bold text-gray-800" id="active-category-name">All</div>
                                        </div>
                                        <div class="col-auto">
                                            <i class="fas fa-th-large fa-2x text-gray-300"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Category Tabs -->
                    <!-- Table Section -->
          <h4 class="dashboard-section-title">Filter by Category</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Filter by Category</h6>
                        </div>
                        <div class="card-body">
                            <ul class="nav nav-pills nav-fill mb-3" id="category-tabs" role="tablist">
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link active" id="tab-all" data-category="" href="#" role="tab">
                                        <i class="fas fa-list"></i> All
                                        <span class="badge badge-light ml-2" id="count-all">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-wifi" data-category="wifi" href="#" role="tab">
                                        📡 WiFi
                                        <span class="badge badge-light ml-2" id="count-wifi">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-customer" data-category="customer" href="#" role="tab">
                                        👤 Customer
                                        <span class="badge badge-light ml-2" id="count-customer">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-support" data-category="support" href="#" role="tab">
                                        🚨 Support
                                        <span class="badge badge-light ml-2" id="count-support">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-saldo" data-category="saldo" href="#" role="tab">
                                        💳 Saldo
                                        <span class="badge badge-light ml-2" id="count-saldo">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-agent" data-category="agent" href="#" role="tab">
                                        🏪 Agent
                                        <span class="badge badge-light ml-2" id="count-agent">0</span>
                                    </a>
                                </li>
                            </ul>
                            <ul class="nav nav-pills nav-fill" id="category-tabs-2" role="tablist">
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-admin" data-category="admin" href="#" role="tab">
                                        👨‍💼 Admin
                                        <span class="badge badge-light ml-2" id="count-admin">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-voucher" data-category="voucher" href="#" role="tab">
                                        🎫 Voucher
                                        <span class="badge badge-light ml-2" id="count-voucher">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-menu" data-category="menu" href="#" role="tab">
                                        📋 Menu
                                        <span class="badge badge-light ml-2" id="count-menu">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-speedboost" data-category="speedboost" href="#" role="tab">
                                        ⚡ Speed
                                        <span class="badge badge-light ml-2" id="count-speedboost">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-help" data-category="help" href="#" role="tab">
                                        ❓ Help
                                        <span class="badge badge-light ml-2" id="count-help">0</span>
                                    </a>
                                </li>
                                <li class="nav-item" role="presentation">
                                    <a class="nav-link" id="tab-greeting" data-category="greeting" href="#" role="tab">
                                        👋 Greeting
                                        <span class="badge badge-light ml-2" id="count-greeting">0</span>
                                    </a>
                                </li>
                            </ul>
                        </div>
                    </div>

                    <!-- Info Box -->
                    <div class="info-box">
                        <h6><i class="fas fa-info-circle"></i> Tentang WiFi Command Templates</h6>
                        <p>
                            Halaman ini memungkinkan Anda untuk mengatur keyword command yang digunakan pelanggan untuk berinteraksi dengan bot.
                            Templates diorganisir dalam <strong>11 kategori</strong> untuk memudahkan pengelolaan.
                            Gunakan <strong>tabs di atas</strong> untuk melihat template berdasarkan kategori tertentu. Statistik akan update otomatis sesuai kategori aktif.
                        </p>
                    </div>

                    <!-- Templates List -->
                    <!-- Table Section -->
          <h4 class="dashboard-section-title">Daftar Command Templates</h4>
          <div class="card table-card mb-4">
            <div class="card-header">
              <h6>Daftar Command Templates</h6>
                        </div>
                        <div class="card-body">
                            <div id="templatesContainer">
                                <div class="text-center">
                                    <div class="spinner-border text-primary" role="status">
                                        <span class="sr-only">Loading...</span>
                                    </div>
                                    <p>Memuat templates...</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <!-- /.container-fluid -->
            </div>
            <!-- End of Main Content -->

            <!-- Footer -->
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <span>Copyright &copy; RAF BOT 2025</span>
                    </div>
                </div>
            </footer>
        </div>
    </div>
    <!-- End of Page Wrapper -->

    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

    <!-- Logout Modal -->
    <div class="modal fade" id="logoutModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">Select "Logout" to end session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <!-- Add Template Modal -->
    <div class="modal fade" id="addTemplateModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <i class="fas fa-plus-circle"></i> Tambah Template Baru
                    </h5>
                    <button class="close" type="button" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="addTemplateForm">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="newIntent">Intent / Nama Command <span class="text-danger">*</span></label>
                                    <input type="text" class="form-control" id="newIntent" placeholder="Contoh: GANTI_SANDI_WIFI" required>
                                    <small class="form-text text-muted">
                                        Format: UPPERCASE_WITH_UNDERSCORE
                                    </small>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="newCategory">Category <span class="text-danger">*</span></label>
                                    <select class="form-control" id="newCategory" required>
                                        <option value="">Pilih Category</option>
                                        <option value="wifi">📡 WiFi Management</option>
                                        <option value="customer">👤 Customer Service</option>
                                        <option value="support">🚨 Support & Laporan</option>
                                        <option value="saldo">💳 Saldo & Payment</option>
                                        <option value="voucher">🎫 Voucher</option>
                                        <option value="help">❓ Help & Guide</option>
                                        <option value="greeting">👋 Greeting</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-md-8">
                                <div class="form-group">
                                    <label for="newDescription">Description</label>
                                    <input type="text" class="form-control" id="newDescription" placeholder="Brief description of this command">
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="form-group">
                                    <label for="newIcon">Icon (Emoji)</label>
                                    <input type="text" class="form-control" id="newIcon" placeholder="📡" maxlength="2">
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="newKeywords">Keywords (pisahkan dengan koma) <span class="text-danger">*</span></label>
                            <textarea class="form-control" id="newKeywords" rows="4" placeholder="Contoh: ganti sandi, ubah password, ganti password, reset password" required></textarea>
                            <small class="form-text text-muted">
                                Masukkan kata kunci yang akan memicu command ini, dipisahkan dengan koma (,)
                            </small>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-primary" type="button" id="saveNewTemplateBtn">
                        <i class="fas fa-save"></i> Simpan Template
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Edit Template Modal -->
    <div class="modal fade" id="editTemplateModal" tabindex="-1" role="dialog">
        <div class="modal-dialog modal-lg" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">
                        <i class="fas fa-edit"></i> Edit Template
                    </h5>
                    <button class="close" type="button" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <form id="editTemplateForm">
                        <div class="row">
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label>Intent / Nama Command</label>
                                    <input type="text" class="form-control" id="editIntent" readonly>
                                    <small class="form-text text-muted">
                                        Intent tidak bisa diubah. Buat template baru jika perlu intent berbeda.
                                    </small>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <div class="form-group">
                                    <label for="editCategory">Category <span class="text-danger">*</span></label>
                                    <select class="form-control" id="editCategory" required>
                                        <option value="">Pilih Category</option>
                                        <option value="wifi">📡 WiFi Management</option>
                                        <option value="customer">👤 Customer Service</option>
                                        <option value="support">🚨 Support & Laporan</option>
                                        <option value="saldo">💳 Saldo & Payment</option>
                                        <option value="voucher">🎫 Voucher</option>
                                        <option value="help">❓ Help & Guide</option>
                                        <option value="greeting">👋 Greeting</option>
                                        <option value="agent">🏪 Agent</option>
                                        <option value="admin">👨‍💼 Admin</option>
                                        <option value="menu">📋 Menu</option>
                                        <option value="speedboost">⚡ Speed Boost</option>
                                        <option value="teknisi">🔧 Teknisi</option>
                                        <option value="pelanggan">👤 Pelanggan</option>
                                        <option value="all">🌐 All</option>
                                        <option value="other">📝 Other</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div class="row">
                            <div class="col-md-8">
                                <div class="form-group">
                                    <label for="editDescription">Description</label>
                                    <input type="text" class="form-control" id="editDescription" placeholder="Brief description of this command">
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="form-group">
                                    <label for="editIcon">Icon (Emoji)</label>
                                    <input type="text" class="form-control" id="editIcon" placeholder="📡" maxlength="2">
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label for="editKeywords">Keywords (pisahkan dengan koma) <span class="text-danger">*</span></label>
                            <textarea class="form-control" id="editKeywords" rows="6" required></textarea>
                            <small class="form-text text-muted">
                                Masukkan kata kunci yang akan memicu command ini, dipisahkan dengan koma (,)
                            </small>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-primary" type="button" id="saveEditTemplateBtn">
                        <i class="fas fa-save"></i> Simpan Perubahan
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div class="modal fade" id="deleteTemplateModal" tabindex="-1" role="dialog">
        <div class="modal-dialog" role="document">
            <div class="modal-content">
                <div class="modal-header bg-danger text-white">
                    <h5 class="modal-title">
                        <i class="fas fa-exclamation-triangle"></i> Konfirmasi Hapus
                    </h5>
                    <button class="close text-white" type="button" data-dismiss="modal">
                        <span>&times;</span>
                    </button>
                </div>
                <div class="modal-body">
                    <p>Apakah Anda yakin ingin menghapus template ini?</p>
                    <p class="font-weight-bold" id="deleteIntentName"></p>
                    <p class="text-danger">
                        <i class="fas fa-exclamation-circle"></i> 
                        Tindakan ini tidak dapat dibatalkan!
                    </p>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-danger" type="button" id="confirmDeleteBtn">
                        <i class="fas fa-trash"></i> Ya, Hapus
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Toast container for notifications -->
    <div class="toast-container"></div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>

    <script src="/js/wifi-templates.js"></script>
</body>
</html>
