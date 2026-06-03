<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="RAF BOT Payment Status Management">
    <meta name="author" content="RAF BOT">
    <title>RAF BOT - Manajemen Status Pembayaran</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">
    <link href="/css/dashboard-modern.css" rel="stylesheet">
    <link href="/vendor/datatables/dataTables.bootstrap4.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" rel="stylesheet" />
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/select2-bootstrap-theme/0.1.0-beta.10/select2-bootstrap.min.css" />
    
    <style>
        :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --success: #10b981;
            --info: #3b82f6;
            --warning: #f59e0b;
            --danger: #ef4444;
            --dark: #1f2937;
            --light: #f9fafb;
            --border-radius: 12px;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: #f3f4f6;
            min-height: 100vh;
        }

        #content-wrapper {
            background: #ffffff;
            min-height: 100vh;
        }

        .topbar {
            background: #ffffff !important;
            border-bottom: 1px solid #e5e7eb;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important;
        }

        .container-fluid {
            padding: 1.5rem;
        }

        /* Section Headers */
        .dashboard-header {
            margin-bottom: 2rem;
        }

        .dashboard-header h1 {
            font-size: 1.875rem;
            font-weight: 700;
            color: var(--dark);
            margin-bottom: 0.25rem;
        }

        .dashboard-header p {
            color: #6b7280;
            font-size: 0.95rem;
        }

        .dashboard-section-title {
            font-weight: 600;
            font-size: 1.125rem;
            color: var(--dark);
            margin-top: 2rem;
            margin-bottom: 1rem;
            position: relative;
            padding-left: 12px;
        }

        .dashboard-section-title::before {
            content: '';
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            width: 3px;
            height: 20px;
            background: var(--primary);
            border-radius: 2px;
        }

        /* Modern Cards */
        .dashboard-card {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: var(--border-radius);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            overflow: hidden;
            position: relative;
            height: 100%;
        }

        .dashboard-card:hover {
            transform: translateY(-4px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .dashboard-card .card-body {
            padding: 1.25rem;
            position: relative;
        }

        .dashboard-card .card-content {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .dashboard-card .card-info {
            flex: 1;
        }

        .dashboard-card .card-title-text {
            font-weight: 500;
            font-size: 0.875rem;
            color: #6b7280;
            margin-bottom: 0.5rem;
        }

        .dashboard-card .card-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--dark);
            line-height: 1;
            margin-bottom: 0.25rem;
        }

        .dashboard-card .card-subtitle {
            font-size: 0.75rem;
            color: #9ca3af;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .dashboard-card .card-icon-container {
            width: 56px;
            height: 56px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 12px;
            background: #f3f4f6;
            transition: background 0.2s ease;
        }

        .dashboard-card:hover .card-icon-container {
            background: #e5e7eb;
        }

        .dashboard-card .card-icon-container i {
            font-size: 1.5rem;
            color: var(--primary);
        }

        /* Card color variants */
        .dashboard-card.card-primary .card-icon-container { background: rgba(99, 102, 241, 0.1); }
        .dashboard-card.card-primary .card-icon-container i { color: var(--primary); }
        
        .dashboard-card.card-success .card-icon-container { background: rgba(16, 185, 129, 0.1); }
        .dashboard-card.card-success .card-icon-container i { color: var(--success); }
        
        .dashboard-card.card-info .card-icon-container { background: rgba(59, 130, 246, 0.1); }
        .dashboard-card.card-info .card-icon-container i { color: var(--info); }
        
        .dashboard-card.card-warning .card-icon-container { background: rgba(245, 158, 11, 0.1); }
        .dashboard-card.card-warning .card-icon-container i { color: var(--warning); }
        
        .dashboard-card.card-danger .card-icon-container { background: rgba(239, 68, 68, 0.1); }
        .dashboard-card.card-danger .card-icon-container i { color: var(--danger); }

        /* Modern Button */
        .btn-primary-custom {
            background: var(--primary);
            color: white !important;
            border: none;
            border-radius: 8px;
            padding: 10px 24px;
            font-weight: 600;
            font-size: 0.95rem;
            box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
            transition: all 0.2s ease;
        }

        .btn-primary-custom:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
            color: white !important;
        }

        .btn-success-custom {
            background: var(--success);
            color: white !important;
            border: none;
            border-radius: 8px;
            padding: 10px 24px;
            font-weight: 600;
            font-size: 0.95rem;
            box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
            transition: all 0.2s ease;
        }

        .btn-success-custom:hover {
            background: #059669;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
            color: white !important;
        }

        .btn-warning-custom {
            background: var(--warning);
            color: white !important;
            border: none;
            border-radius: 8px;
            padding: 10px 24px;
            font-weight: 600;
            font-size: 0.95rem;
            box-shadow: 0 2px 8px rgba(245, 158, 11, 0.25);
            transition: all 0.2s ease;
        }

        .btn-warning-custom:hover {
            background: #d97706;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(245, 158, 11, 0.35);
            color: white !important;
        }

        /* Payment specific styles */
        .payment-card {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: var(--border-radius);
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
            margin-bottom: 1rem;
            overflow: hidden;
        }
        
        .payment-card.paid {
            border-left: 4px solid var(--success);
        }

        .payment-card.unpaid {
            border-left: 4px solid var(--danger);
        }
        
        .payment-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .status-badge {
            font-size: 0.875rem;
            padding: 0.375rem 0.75rem;
            border-radius: 6px;
            font-weight: 600;
        }

        .status-badge.paid {
            background: rgba(16, 185, 129, 0.1);
            color: var(--success);
        }

        .status-badge.unpaid {
            background: rgba(239, 68, 68, 0.1);
            color: var(--danger);
        }
        
        .bulk-select-checkbox {
            width: 20px;
            height: 20px;
            cursor: pointer;
        }
        
        .filter-section {
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: var(--border-radius);
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }
        
        .action-buttons {
            position: sticky;
            top: 0;
            background: white;
            z-index: 100;
            padding: 1rem 0;
            border-bottom: 1px solid #e3e6f0;
            margin-bottom: 1rem;
        }
        
        .customer-info {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .customer-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 1.2rem;
        }
        
        .search-highlight {
            background-color: #fff3cd;
            padding: 2px 4px;
            border-radius: 3px;
        }
        
        .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        }
        
        .loading-overlay.show {
            display: flex;
        }
        
        .loading-content {
            background: white;
            padding: 2rem;
            border-radius: 0.5rem;
            text-align: center;
        }
        
        .toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
        }
        
        .toast {
            min-width: 300px;
            margin-bottom: 1rem;
        }

        .filter-section .row {
            row-gap: 0.85rem;
        }

        .filter-section .d-flex.align-items-end {
            align-items: stretch !important;
            flex-wrap: wrap;
            gap: 0.75rem;
        }

        .customer-info {
            min-width: 0;
            flex-wrap: wrap;
        }

        @media (max-width: 768px) {
            .table-responsive {
                font-size: 0.875rem;
            }
            
            .quick-stats {
                grid-template-columns: 1fr 1fr;
            }

            .dashboard-header .d-flex {
                flex-direction: column;
                align-items: stretch !important;
                gap: 0.85rem;
            }

            .dashboard-header .btn {
                width: 100%;
                justify-content: center;
            }

            .action-buttons {
                top: 0.5rem;
                padding: 0.5rem 0;
            }

            .action-buttons .filter-section {
                padding: 1rem;
            }

            .action-buttons .filter-section > .d-flex {
                flex-direction: column;
                align-items: stretch !important;
                gap: 0.85rem;
            }

            .action-buttons .filter-section > .d-flex > div:last-child,
            .action-buttons .filter-section > .d-flex > div:last-child .btn {
                width: 100%;
            }

            .action-buttons .filter-section > .d-flex > div:last-child {
                display: grid;
                gap: 0.65rem;
            }

            .toast-container {
                left: 0.5rem;
                right: 0.5rem;
                top: 0.75rem;
            }

            .toast {
                min-width: 0;
                width: 100%;
            }
        }

        @media (max-width: 575.98px) {
            .container-fluid {
                padding: 0.75rem;
            }

            .dashboard-header h1 {
                font-size: 1.32rem;
            }

            .dashboard-header p {
                font-size: 0.875rem;
            }

            .filter-section {
                padding: 0.95rem;
            }

            .payment-card .card-body,
            .card .card-header,
            .card .card-body {
                padding-left: 0.95rem;
                padding-right: 0.95rem;
            }
        }

        #accordionSidebar .nav-item.active .nav-link {
            background-color: rgba(255, 255, 255, 0.1);
            font-weight: 600;
            border-left: 3px solid #4e73df;
            color: #ffffff;
        }
    </style>
</head>

<body id="page-top">
    <div id="wrapper">
        <?php include '_navbar.php'; ?>
        
        <div id="content-wrapper" class="d-flex flex-column">
            <div id="content">
                <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow">
                    <button id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                        <i class="fa fa-bars"></i>
                    </button>
                    
                    <ul class="navbar-nav ml-auto">
                        <li class="nav-item dropdown no-arrow">
                            <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button" data-toggle="dropdown">
                                <span class="mr-2 d-none d-lg-inline text-gray-600 small">Admin</span>
                                <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
                            </a>
                            <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in">
                                <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                    <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                                    Logout
                                </a>
                            </div>
                        </li>
                    </ul>
                </nav>

                <div class="container-fluid">
                    <div class="dashboard-header">
                        <div class="d-flex align-items-center justify-content-between">
                            <div>
                                <h1>Manajemen Status Pembayaran</h1>
                                <p>Kelola status pembayaran pelanggan untuk periode tagihan aktif yang dipilih.</p>
                            </div>
                            <button class="btn btn-primary-custom" onclick="location.reload()">
                                <i class="fas fa-sync-alt"></i> Refresh Data
                            </button>
                        </div>
                    </div>

                    <div class="alert alert-info mb-4">
                        <div class="font-weight-bold">Status pembayaran berbasis periode</div>
                        <div class="small mb-0">
                            Angka dan aksi di halaman ini merepresentasikan status bayar untuk periode tagihan yang dipilih, bukan status pelanggan sepanjang waktu.
                        </div>
                    </div>

                    <h4 class="dashboard-section-title">Statistik Pembayaran</h4>
                    <div class="row match-height">
                        <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                            <div class="card dashboard-card card-primary">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Total Pelanggan</div>
                                            <div class="card-value" id="totalCustomers">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-circle" style="font-size: 8px;"></i>
                                                <span id="paymentPeriodStatsLabel">Periode aktif</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-users"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                            <div class="card dashboard-card card-success">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Sudah Bayar</div>
                                            <div class="card-value" id="paidCustomers">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-check-circle text-success" style="font-size: 10px;"></i>
                                                <span id="paymentPeriodPaidLabel">Lunas periode aktif</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-user-check"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                            <div class="card dashboard-card card-danger">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Belum Bayar</div>
                                            <div class="card-value" id="unpaidCustomers">0</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-clock text-danger" style="font-size: 10px;"></i>
                                                <span id="paymentPeriodUnpaidLabel">Belum lunas periode aktif</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-user-clock"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                            <div class="card dashboard-card card-warning">
                                <div class="card-body">
                                    <div class="card-content">
                                        <div class="card-info">
                                            <div class="card-title-text">Persentase Bayar</div>
                                            <div class="card-value" id="paidPercentage">0%</div>
                                            <div class="card-subtitle">
                                                <i class="fas fa-chart-pie" style="font-size: 10px;"></i>
                                                <span id="paymentPeriodCompletionLabel">Periode aktif</span>
                                            </div>
                                        </div>
                                        <div class="card-icon-container">
                                            <i class="fas fa-percentage"></i>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <h4 class="dashboard-section-title">Filter & Pencarian</h4>
                    <div class="filter-section">
                            <div class="row">
                                <div class="col-md-2 mb-3">
                                    <label for="periodMonthFilter" class="form-label">Bulan Tagihan</label>
                                    <select id="periodMonthFilter" class="form-control"></select>
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="periodYearFilter" class="form-label">Tahun Tagihan</label>
                                    <select id="periodYearFilter" class="form-control"></select>
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="statusFilter" class="form-label">Status Pembayaran</label>
                                    <select id="statusFilter" class="form-control">
                                        <option value="">Semua Status</option>
                                        <option value="unpaid">Belum Bayar</option>
                                        <option value="paid">Sudah Bayar</option>
                                    </select>
                                </div>
                                <div class="col-md-2 mb-3">
                                    <label for="subscriptionFilter" class="form-label">Paket Langganan</label>
                                    <select id="subscriptionFilter" class="form-control">
                                        <option value="">Semua Paket</option>
                                    </select>
                                </div>
                                <div class="col-md-3 mb-3">
                                    <label for="searchInput" class="form-label">Cari Pelanggan</label>
                                    <div class="input-group">
                                        <input type="text" id="searchInput" class="form-control" 
                                               placeholder="Nama, No. Telepon, atau Device ID...">
                                        <div class="input-group-append">
                                            <button class="btn btn-outline-secondary" type="button" id="searchBtn">
                                                <i class="fas fa-search"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-1 mb-3 d-flex align-items-end">
                                    <button id="clearFilters" class="btn btn-outline-secondary btn-block" style="border-radius: 8px;">
                                        <i class="fas fa-times"></i> Clear Filter
                                    </button>
                                </div>
                            </div>
                            <div class="row">
                                <div class="col-md-4 mb-3">
                                    <label for="defaultAdminPaymentMethod" class="form-label">Default Metode Pembayaran Admin</label>
                                    <select id="defaultAdminPaymentMethod" class="form-control">
                                        <option value="TRANSFER_BANK" selected>Transfer Bank</option>
                                        <option value="CASH">Cash</option>
                                    </select>
                                    <small class="form-text text-muted">Berlaku untuk aksi admin tandai bayar, termasuk bulk action.</small>
                                </div>
                                <div class="col-md-8 mb-3 d-flex align-items-end">
                                    <div class="small text-muted">
                                        Nilai default ini hanya untuk metode pembayaran yang dicatat ke histori pembayaran admin. Metode pembayaran pada invoice tetap diatur terpisah saat kirim atau cetak invoice.
                                    </div>
                                </div>
                            </div>
                            <div class="small text-muted">
                                Perubahan status bayar dan bulk action akan dicatat ke periode <span id="paymentPeriodContextText" class="font-weight-bold">-</span>.
                            </div>
                    </div>

                    <div class="action-buttons" id="bulkActions" style="display: none;">
                        <div class="filter-section" style="background: #fef3c7; border-color: var(--warning);">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <span class="font-weight-bold" style="color: var(--dark); font-size: 1rem;">
                                        <i class="fas fa-check-square" style="color: var(--warning);"></i>
                                        <span id="selectedCount">0</span> pelanggan dipilih
                                    </span>
                                    <div class="small text-muted mt-1">
                                        Bulk bayar akan dicatat sebagai:
                                        <span id="bulkDefaultMethodLabel" class="font-weight-bold">Transfer Bank</span>
                                    </div>
                                </div>
                                <div>
                                    <button id="markPaidBtn" class="btn btn-success-custom btn-sm">
                                        <i class="fas fa-check-circle"></i> Tandai Sudah Bayar
                                    </button>
                                    <button id="markUnpaidBtn" class="btn btn-warning-custom btn-sm">
                                        <i class="fas fa-times-circle"></i> Tandai Belum Bayar
                                    </button>
                                    <button id="sendInvoiceBtn" class="btn btn-primary-custom btn-sm">
                                        <i class="fas fa-file-invoice"></i> Kirim Invoice
                                    </button>
                                    <button id="deselectAllBtn" class="btn btn-outline-secondary btn-sm" style="border-radius: 6px;">
                                        <i class="fas fa-minus-square"></i> Batal Pilih
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <h4 class="dashboard-section-title">Daftar Pelanggan</h4>
                    <div class="dashboard-card" style="height: auto;">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center mb-3">
                                <div>
                                    <span class="font-weight-600" style="color: var(--dark); font-size: 1.1rem;">Data Pelanggan</span>
                                </div>
                                <div>
                                    <div class="form-check form-check-inline">
                                        <input class="form-check-input" type="checkbox" id="selectAllCheckbox">
                                        <label class="form-check-label" for="selectAllCheckbox" style="font-weight: 500;">
                                            Pilih Semua di Halaman Ini
                                        </label>
                                    </div>
                                </div>
                            </div>
                            <div class="table-responsive">
                                <table class="table table-bordered table-hover" id="paymentTable" width="100%" cellspacing="0">
                                    <thead>
                                        <tr>
                                            <th width="5%">
                                                <input type="checkbox" id="selectAllHeader" class="bulk-select-checkbox">
                                            </th>
                                            <th width="5%">ID</th>
                                            <th width="20%">Nama Pelanggan</th>
                                            <th width="15%">No. Telepon</th>
                                            <th width="15%">Paket</th>
                                            <th width="15%">Device ID</th>
                                            <th width="10%">Status</th>
                                            <th width="15%">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody id="paymentTableBody">
                                    </tbody>
                                </table>
                            </div>
                            
                            <div class="d-flex justify-content-between align-items-center mt-3">
                                <div>
                                    Menampilkan <span id="showingFrom">0</span> - <span id="showingTo">0</span> 
                                    dari <span id="totalRecords">0</span> data
                                </div>
                                <nav>
                                    <ul class="pagination" id="pagination">
                                    </ul>
                                </nav>
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

    <a class="scroll-to-top rounded" href="#page-top">
        <i class="fas fa-angle-up"></i>
    </a>

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

    <div class="modal fade" id="confirmStatusModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Konfirmasi Perubahan Status</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <input type="hidden" id="confirmStatusUserId">
                    <input type="hidden" id="confirmStatusNewStatus">
                    <input type="hidden" id="confirmStatusSendInvoice">
                    <input type="hidden" id="confirmStatusPhoneNumber">
                    <p>Apakah Anda yakin ingin mengubah status pembayaran <strong id="confirmStatusUserName"></strong> menjadi <strong id="confirmStatusText"></strong>?</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" id="confirmStatusBtn">Ya, Ubah Status</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="paymentMethodModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="paymentMethodModalTitle">Pilih Metode Pembayaran</h5>
                    <button type="button" class="close" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="text-muted mb-3" id="paymentMethodModalContextText">Pilih metode pembayaran yang akan dipakai pada aksi ini.</p>
                    <div class="form-group">
                        <label for="paymentMethodSelect">Metode Pembayaran:</label>
                        <select class="form-control" id="paymentMethodSelect">
                            <option value="TRANSFER_BANK" selected>Transfer Bank</option>
                            <option value="CASH">Cash</option>
                        </select>
                        <small class="form-text text-muted" id="paymentMethodHelpText">Pilih metode pembayaran yang akan dipakai pada aksi ini.</small>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-dismiss="modal">Batal</button>
                    <button type="button" class="btn btn-primary" id="confirmPaymentMethodBtn">Konfirmasi</button>
                </div>
            </div>
        </div>
    </div>

    <div class="modal fade" id="confirmModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="confirmModalTitle">Konfirmasi</h5>
                    <button class="close" type="button" data-dismiss="modal">&times;</button>
                </div>
                <div class="modal-body" id="confirmModalBody">
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Batal</button>
                    <button class="btn btn-primary" id="confirmActionBtn">Ya, Lanjutkan</button>
                </div>
            </div>
        </div>
    </div>

    <div class="loading-overlay" id="loadingOverlay">
        <div class="loading-content">
            <div class="spinner-border text-primary mb-3" role="status">
                <span class="sr-only">Loading...</span>
            </div>
            <div id="loadingText">Memproses...</div>
        </div>
    </div>

    <div class="toast-container" id="toastContainer"></div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js"></script>
    <script src="/js/payment-status.js"></script>
</body>
</html>
