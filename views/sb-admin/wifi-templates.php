<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <title>RAF BOT - WiFi Command Templates</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
  <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <style>
        #accordionSidebar .nav-item.active .nav-link {
            background-color: rgba(255, 255, 255, 0.1);
            font-weight: 600;
            border-left: 3px solid #4e73df;
            color: #ffffff;
        }
        .keyword-badge {
            display: inline-block;
            margin: 2px;
            padding: 5px 10px;
            background-color: #4e73df;
            color: white;
            border-radius: 15px;
            font-size: 0.85rem;
        }
        .keyword-badge .remove-keyword {
            margin-left: 8px;
            cursor: pointer;
            font-weight: bold;
        }
        .keyword-badge .remove-keyword:hover {
            color: #ff4444;
        }
        .keywords-container {
            min-height: 60px;
            padding: 10px;
            border: 1px solid #d1d3e2;
            border-radius: 0.35rem;
            background-color: #f8f9fc;
            margin-bottom: 10px;
        }
        .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 1050;
        }
        .intent-badge {
            font-size: 0.9rem;
            padding: 6px 12px;
        }
        .card-header-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .info-box {
            background-color: #d1ecf1;
            border: 1px solid #bee5eb;
            border-radius: 0.35rem;
            padding: 15px;
            margin-bottom: 20px;
        }
        .info-box h6 {
            color: #0c5460;
            font-weight: bold;
        }
        .info-box p {
            color: #0c5460;
            margin-bottom: 0;
        }
        /* Category Tabs Styling */
        .nav-pills .nav-link {
            border-radius: 0.35rem;
            padding: 0.75rem 1rem;
            margin: 0.25rem;
            transition: all 0.3s ease;
            color: #6c757d;
            border: 2px solid transparent;
        }
        .nav-pills .nav-link:hover {
            background-color: #f8f9fc;
            border-color: #4e73df;
            color: #4e73df;
        }
        .nav-pills .nav-link.active {
            background-color: #4e73df;
            color: white;
            border-color: #4e73df;
        }
        .nav-pills .nav-link .badge {
            background-color: rgba(255, 255, 255, 0.3);
            color: inherit;
            font-weight: 600;
        }
        .nav-pills .nav-link.active .badge {
            background-color: rgba(255, 255, 255, 0.9);
            color: #4e73df;
        }
        /* Smooth template transitions */
        .card[data-category] {
            transition: opacity 0.3s ease, transform 0.3s ease;
        }
        .card[data-category].hidden {
            display: none;
            opacity: 0;
            transform: scale(0.95);
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

    <script>
        $(document).ready(function() {
            let currentEditIntent = null;
            let currentDeleteIntent = null;

            // Fetch username
            fetch('/api/me', { credentials: 'include' })
                .then(response => response.json())
                .then(data => {
                    if (data.status === 200 && data.data && data.data.username) {
                        $('#username-placeholder').text(data.data.username);
                    }
                }).catch(err => console.warn("Could not fetch user data: ", err));

            // Toast notification function
            function showToast(message, type = 'success') {
                const toastId = 'toast-' + new Date().getTime();
                const bgClass = type === 'success' ? 'bg-success' : 'bg-danger';
                const toastHtml = `
                    <div id="${toastId}" class="toast ${bgClass} text-white" role="alert" aria-live="assertive" aria-atomic="true" data-delay="5000">
                        <div class="toast-header ${bgClass} text-white">
                            <strong class="mr-auto">${type === 'success' ? 'Berhasil' : 'Error'}</strong>
                            <button type="button" class="ml-2 mb-1 close text-white" data-dismiss="toast" aria-label="Close">
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

            // Category color mapping
            const categoryColors = {
                'wifi': 'primary',
                'customer': 'success',
                'support': 'danger',
                'saldo': 'warning',
                'voucher': 'info',
                'help': 'secondary',
                'greeting': 'dark',
                'agent': 'success',
                'admin': 'danger',
                'menu': 'info',
                'speedboost': 'warning'
            };

            const categoryLabels = {
                'wifi': '📡 WiFi',
                'customer': '👤 Customer',
                'support': '🚨 Support',
                'saldo': '💳 Saldo',
                'voucher': '🎫 Voucher',
                'help': '❓ Help',
                'greeting': '👋 Greeting',
                'agent': '🏪 Agent',
                'admin': '👨‍💼 Admin',
                'menu': '📋 Menu',
                'speedboost': '⚡ Speed'
            };

            // Load templates
            function loadTemplates() {
                const container = $('#templatesContainer');
                container.html('<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="sr-only">Loading...</span></div><p>Memuat templates...</p></div>');
                
                fetch('/api/wifi-templates', { credentials: 'include' })
                    .then(response => {
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        return response.json();
                    })
                    .then(result => {
                        if (result.status !== 200) {
                            throw new Error(result.message || 'Gagal memuat templates');
                        }
                        
                        const templates = result.data;
                        container.empty();

                        if (!templates || templates.length === 0) {
                            container.html('<div class="alert alert-info"><i class="fas fa-info-circle"></i> Belum ada template. Silakan tambah template baru.</div>');
                            return;
                        }

                        // Calculate statistics
                        const totalTemplates = templates.length;
                        const totalKeywords = templates.reduce((sum, t) => sum + t.keywords.length, 0);
                        const categories = [...new Set(templates.map(t => t.category || 'other'))];
                        const totalCategories = categories.length;

                        $('#total-templates').text(totalTemplates);
                        $('#total-keywords').text(totalKeywords);

                        // Update category counters
                        const categoryCounts = {};
                        templates.forEach(t => {
                            const cat = t.category || 'other';
                            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
                        });

                        // Update tab counters
                        $('#count-all').text(totalTemplates);
                        Object.keys(categoryCounts).forEach(cat => {
                            $(`#count-${cat}`).text(categoryCounts[cat] || 0);
                        });

                        // Set all undefined counters to 0
                        ['wifi', 'customer', 'support', 'saldo', 'agent', 'admin', 'voucher', 'menu', 'speedboost', 'help', 'greeting'].forEach(cat => {
                            if (!categoryCounts[cat]) {
                                $(`#count-${cat}`).text(0);
                            }
                        });

                        templates.forEach(template => {
                            const category = template.category || 'other';
                            const categoryColor = categoryColors[category] || 'secondary';
                            const icon = template.icon || '📝';
                            const description = template.description || '';

                            const keywordBadges = template.keywords.map(keyword => 
                                `<span class="badge badge-primary mr-1 mb-1">${keyword}</span>`
                            ).join('');

                            const cardHtml = `
                                <div class="card mb-3 shadow-sm" data-intent="${template.intent}" data-category="${category}">
                                    <div class="card-header card-header-actions">
                                        <div>
                                            ${icon} 
                                            <span class="badge badge-${categoryColor} mr-2">${category}</span>
                                            <span class="badge badge-info intent-badge">${template.intent}</span>
                                        </div>
                                        <div>
                                            <button class="btn btn-sm btn-warning edit-template-btn" data-intent="${template.intent}">
                                                <i class="fas fa-edit"></i> Edit
                                            </button>
                                            <button class="btn btn-sm btn-danger delete-template-btn" data-intent="${template.intent}">
                                                <i class="fas fa-trash"></i> Hapus
                                            </button>
                                        </div>
                                    </div>
                                    <div class="card-body">
                                        ${description ? `<p class="text-muted small mb-2"><em>${description}</em></p>` : ''}
                                        <h6 class="font-weight-bold mb-2">Keywords:</h6>
                                        <div class="keywords-display">
                                            ${keywordBadges}
                                        </div>
                                        <small class="text-muted">Total: ${template.keywords.length} keyword(s)</small>
                                    </div>
                                </div>
                            `;
                            container.append(cardHtml);
                        });

                        // Attach event handlers
                        $('.edit-template-btn').on('click', function() {
                            const intent = $(this).data('intent');
                            openEditModal(intent, templates);
                        });

                        $('.delete-template-btn').on('click', function() {
                            const intent = $(this).data('intent');
                            openDeleteModal(intent);
                        });
                    })
                    .catch(error => {
                        console.error('Error loading templates:', error);
                        container.html('<div class="alert alert-danger"><i class="fas fa-exclamation-triangle"></i> Gagal memuat templates. Silakan refresh halaman.</div>');
                    });
            }

            // Tab click handler
            $('#category-tabs .nav-link, #category-tabs-2 .nav-link').on('click', function(e) {
                e.preventDefault();
                
                // Remove active from all tabs
                $('#category-tabs .nav-link, #category-tabs-2 .nav-link').removeClass('active');
                
                // Add active to clicked tab
                $(this).addClass('active');
                
                const selectedCategory = $(this).data('category');
                
                // Update active category name
                const categoryName = selectedCategory === '' ? 'All' : categoryLabels[selectedCategory] || selectedCategory;
                $('#active-category-name').text(categoryName);
                
                // Update template count in statistics
                const visibleCount = selectedCategory === '' ? 
                    $('.card[data-category]').length : 
                    $(`.card[data-category="${selectedCategory}"]`).length;
                $('#total-templates').text(visibleCount);
                
                // Update keywords count for visible templates
                let visibleKeywords = 0;
                if (selectedCategory === '') {
                    $('.card[data-category]').each(function() {
                        const keywordCount = $(this).find('.badge-primary').length;
                        visibleKeywords += keywordCount;
                    });
                } else {
                    $(`.card[data-category="${selectedCategory}"]`).each(function() {
                        const keywordCount = $(this).find('.badge-primary').length;
                        visibleKeywords += keywordCount;
                    });
                }
                $('#total-keywords').text(visibleKeywords);
                
                // Filter templates with smooth animation
                if (selectedCategory === '') {
                    // Show all
                    $('.card[data-category]').removeClass('hidden').show();
                } else {
                    // Hide non-matching, show matching
                    $('.card[data-category]').each(function() {
                        if ($(this).data('category') === selectedCategory) {
                            $(this).removeClass('hidden').show();
                        } else {
                            $(this).addClass('hidden').hide();
                        }
                    });
                }
                
                // Smooth scroll to templates container
                $('html, body').animate({
                    scrollTop: $('#templatesContainer').offset().top - 100
                }, 300);
            });

            // Open edit modal
            function openEditModal(intent, templates) {
                const template = templates.find(t => t.intent === intent);
                if (!template) return;

                currentEditIntent = intent;
                $('#editIntent').val(intent);
                $('#editKeywords').val(template.keywords.join(', '));
                $('#editCategory').val(template.category || 'other');
                $('#editDescription').val(template.description || '');
                $('#editIcon').val(template.icon || '📝');
                $('#editTemplateModal').modal('show');
            }

            // Open delete modal
            function openDeleteModal(intent) {
                currentDeleteIntent = intent;
                $('#deleteIntentName').text(intent);
                $('#deleteTemplateModal').modal('show');
            }

            // Save new template
            $('#saveNewTemplateBtn').on('click', function() {
                const intent = $('#newIntent').val().trim();
                const category = $('#newCategory').val();
                const description = $('#newDescription').val().trim();
                const icon = $('#newIcon').val().trim();
                const keywordsText = $('#newKeywords').val().trim();

                if (!intent || !category || !keywordsText) {
                    showToast('Intent, category, dan keywords wajib diisi!', 'error');
                    return;
                }

                const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k !== '');

                if (keywords.length === 0) {
                    showToast('Minimal harus ada 1 keyword!', 'error');
                    return;
                }

                const button = $(this);
                const originalText = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

                const templateData = {
                    intent,
                    keywords,
                    category,
                    description,
                    icon
                };

                fetch('/api/wifi-templates', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(templateData)
                })
                .then(response => response.json())
                .then(result => {
                    if (result.status === 201) {
                        showToast('Template berhasil ditambahkan!', 'success');
                        $('#addTemplateModal').modal('hide');
                        $('#addTemplateForm')[0].reset();
                        loadTemplates();
                    } else {
                        throw new Error(result.message || 'Gagal menambahkan template');
                    }
                })
                .catch(error => {
                    console.error('Error adding template:', error);
                    showToast(`Error: ${error.message}`, 'error');
                })
                .finally(() => {
                    button.prop('disabled', false).html(originalText);
                });
            });

            // Save edited template
            $('#saveEditTemplateBtn').on('click', function() {
                const intent = currentEditIntent;
                const keywordsText = $('#editKeywords').val().trim();
                const category = $('#editCategory').val().trim();
                const description = $('#editDescription').val().trim();
                const icon = $('#editIcon').val().trim();

                if (!keywordsText) {
                    showToast('Keywords wajib diisi!', 'error');
                    return;
                }

                if (!category) {
                    showToast('Category wajib dipilih!', 'error');
                    return;
                }

                const keywords = keywordsText.split(',').map(k => k.trim()).filter(k => k !== '');

                if (keywords.length === 0) {
                    showToast('Minimal harus ada 1 keyword!', 'error');
                    return;
                }

                const button = $(this);
                const originalText = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menyimpan...');

                const updateData = {
                    keywords: keywords,
                    category: category,
                    description: description || '',
                    icon: icon || '📝'
                };

                fetch(`/api/wifi-templates/${intent}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include', // ✅ Fixed by script
                    body: JSON.stringify(updateData)
                })
                .then(response => response.json())
                .then(result => {
                    if (result.status === 200) {
                        showToast('Template berhasil diupdate!', 'success');
                        $('#editTemplateModal').modal('hide');
                        loadTemplates();
                    } else {
                        throw new Error(result.message || 'Gagal mengupdate template');
                    }
                })
                .catch(error => {
                    console.error('Error updating template:', error);
                    showToast(`Error: ${error.message}`, 'error');
                })
                .finally(() => {
                    button.prop('disabled', false).html(originalText);
                });
            });

            // Confirm delete
            $('#confirmDeleteBtn').on('click', function() {
                const intent = currentDeleteIntent;

                const button = $(this);
                const originalText = button.html();
                button.prop('disabled', true).html('<i class="fas fa-spinner fa-spin"></i> Menghapus...');

                fetch(`/api/wifi-templates/${intent}`, {
                    method: 'DELETE',
                    credentials: 'include' // ✅ Fixed by script
                })
                .then(response => response.json())
                .then(result => {
                    if (result.status === 200) {
                        showToast('Template berhasil dihapus!', 'success');
                        $('#deleteTemplateModal').modal('hide');
                        loadTemplates();
                    } else {
                        throw new Error(result.message || 'Gagal menghapus template');
                    }
                })
                .catch(error => {
                    console.error('Error deleting template:', error);
                    showToast(`Error: ${error.message}`, 'error');
                })
                .finally(() => {
                    button.prop('disabled', false).html(originalText);
                });
            });

            // Initial load
            loadTemplates();
        });
    </script>
</body>
</html>
