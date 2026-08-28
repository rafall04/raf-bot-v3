<?php
// Start session
session_start();

// Set default monitoring to disabled 
// User can enable it via process environment variable or config.json
$monitoringEnabled = false;
$monitoringReason = 'Monitoring default-off karena konfigurasi belum diaktifkan.';

function parseMonitoringBoolean($value) {
    if ($value === null || $value === false || $value === '') {
        return null;
    }

    $normalized = strtolower(trim((string) $value));
    if (in_array($normalized, ['1', 'true', 'yes', 'on'], true)) {
        return true;
    }
    if (in_array($normalized, ['0', 'false', 'no', 'off'], true)) {
        return false;
    }

    return null;
}

// Precedence:
// 1. Process environment variable MONITORING_ENABLED
// 2. config.json -> monitoring.enabled
$monitoringEnv = parseMonitoringBoolean(getenv('MONITORING_ENABLED'));
if ($monitoringEnv !== null) {
    $monitoringEnabled = $monitoringEnv;
    $monitoringReason = $monitoringEnabled
        ? 'Monitoring aktif dari environment variable proses MONITORING_ENABLED.'
        : 'Monitoring dimatikan oleh environment variable proses MONITORING_ENABLED.';
}

$configPath = __DIR__ . '/../../config.json';
if ($monitoringEnv === null && file_exists($configPath) && is_readable($configPath)) {
    $configContent = @file_get_contents($configPath);
    if ($configContent) {
        $config = @json_decode($configContent, true);
        if ($config && isset($config['monitoring']['enabled'])) {
            $monitoringEnabled = (bool) $config['monitoring']['enabled'];
            $monitoringReason = $monitoringEnabled
                ? 'Monitoring aktif dari config.json -> monitoring.enabled.'
                : 'Monitoring dimatikan oleh config.json -> monitoring.enabled.';
        }
    }
}

// Load monitoring API wrapper if enabled
// OPTIMASI: Jangan blocking render dengan API call - load secara async di JavaScript
if ($monitoringEnabled) {
    $wrapperPath = __DIR__ . '/../api-monitoring-wrapper.php';
    if (file_exists($wrapperPath)) {
        require_once $wrapperPath;
        // Jangan panggil getSystemHealth() di sini - ini blocking render!
        // Biarkan JavaScript yang memanggil setelah page load
        $systemHealth = ['error' => false, 'loading' => true];
    } else {
        $systemHealth = ['error' => false];
    }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>

<?php
    // Dulu <head> ditulis tangan dan sengaja TIDAK memuat dashboard-modern.css —
    // index.css adalah FORK-nya (727 vs 671 baris). Akibatnya dashboard jadi
    // satu-satunya halaman yang bisa menyimpang dari sistem tanpa ketahuan.
    // Kini ikut partial bersama; index.css disisakan HANYA untuk yang khas
    // dashboard (widget monitoring, workspace keuangan, riwayat login).
    $pageTitle = 'RAF BOT - Ringkasan Dashboard';
    $pageDescription = 'RAF BOT Dashboard - Premium Edition';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
?>
    <link href="<?= rafAssetUrl('/css/monitoring.css') ?>" rel="stylesheet">
    <link href="<?= rafAssetUrl('/css/index.css') ?>" rel="stylesheet">

</head>

<body id="page-top">

    <div id="wrapper">
    <?php include '_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
        <div id="content">
            <!-- Topbar dengan alerts custom untuk dashboard -->
            <nav class="navbar navbar-expand navbar-light bg-white topbar mb-4 static-top shadow-sm">
                <button type="button" id="sidebarToggleTop" class="btn btn-link d-md-none rounded-circle mr-3">
                    <i class="fa fa-bars"></i>
                </button>
                <ul class="navbar-nav ml-auto align-items-center">

                    <!-- Nav Item - Dark / light mode toggle -->
                    <li class="nav-item mx-1">
                        <button type="button" id="tkThemeToggle" class="tk-theme-toggle" title="Mode gelap / terang" aria-label="Ganti mode gelap/terang">
                            <i class="fas fa-moon"></i>
                        </button>
                    </li>

                    <!-- Nav Item - Alerts/Pengumuman -->
                    <li class="nav-item dropdown no-arrow mx-1">
                        <a class="nav-link dropdown-toggle" href="#" id="alertsDropdown" role="button"
                            data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                            <i class="fas fa-bell fa-fw"></i>
                            <!-- Counter - Alerts -->
                            <span class="badge badge-danger badge-counter" id="alertCount">0</span>
                        </a>
                        <!-- Dropdown - Pengumuman -->
                        <div class="dropdown-list dropdown-menu dropdown-menu-right shadow animated--grow-in"
                            aria-labelledby="alertsDropdown">
                            <h6 class="dropdown-header">
                                <i class="fas fa-bullhorn"></i> Pengumuman & Notifikasi
                            </h6>
                            <div id="alertsContainer">
                                <!-- Alerts akan di-load via JavaScript -->
                                <a class="dropdown-item text-center small text-gray-500" href="#">
                                    <i class="fas fa-spinner fa-spin"></i> Loading...
                                </a>
                            </div>
                            <a class="dropdown-item text-center small text-gray-500" href="/announcements">
                                <i class="fas fa-eye"></i> Lihat Semua Pengumuman
                            </a>
                        </div>
                    </li>

                    <div class="topbar-divider d-none d-sm-block"></div>
                    
                    <!-- Nav Item - User (menggunakan logic dari topbar.php) -->
                    <?php
                    // Include topbar logic untuk mendapatkan userName
                    if (session_status() === PHP_SESSION_NONE) {
                        session_start();
                    }
                    $userName = 'User';
                    $role = 'user';
                    $debugInfo = [];
                    
                    // Prioritas 1: Coba ambil dari JWT token (cookie)
                    if (isset($_COOKIE['token']) && !empty($_COOKIE['token'])) {
                        try {
                            $token = $_COOKIE['token'];
                            $parts = explode('.', $token);
                            if (count($parts) === 3 && !empty($parts[1])) {
                                $payloadBase64 = str_replace(['-', '_'], ['+', '/'], $parts[1]);
                                $padding = strlen($payloadBase64) % 4;
                                if ($padding > 0) {
                                    $payloadBase64 .= str_repeat('=', 4 - $padding);
                                }
                                $decoded = base64_decode($payloadBase64, true);
                                if ($decoded !== false) {
                                    $payload = json_decode($decoded, true);
                                    if ($payload && is_array($payload)) {
                                        if (isset($payload['name']) && !empty(trim($payload['name']))) {
                                            $userName = trim($payload['name']);
                                        } elseif (isset($payload['username']) && !empty(trim($payload['username']))) {
                                            $userName = trim($payload['username']);
                                        }
                                        if (isset($payload['role']) && !empty(trim($payload['role']))) {
                                            $role = trim($payload['role']);
                                        }
                                    }
                                }
                            }
                        } catch (Exception $e) {
                            // Fallback ke session
                        }
                    }
                    
                    // Prioritas 2: Ambil dari session
                    if ($userName === 'User' && isset($_SESSION['name']) && !empty(trim($_SESSION['name']))) {
                        $userName = trim($_SESSION['name']);
                    } elseif ($userName === 'User' && isset($_SESSION['username']) && !empty(trim($_SESSION['username']))) {
                        $userName = trim($_SESSION['username']);
                    }
                    ?>
                    <li class="nav-item dropdown no-arrow">
                        <a class="nav-link dropdown-toggle" href="#" id="userDropdown" role="button"
                            data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
                            <span class="mr-2 d-none d-lg-inline text-gray-600 small" id="topbarUserName"><?php echo htmlspecialchars($userName); ?></span>
                            <img class="img-profile rounded-circle" src="/img/undraw_profile.svg">
                        </a>
                        <div class="dropdown-menu dropdown-menu-right shadow animated--grow-in"
                            aria-labelledby="userDropdown">
                            <a class="dropdown-item" href="#" data-toggle="modal" data-target="#logoutModal">
                                <i class="fas fa-sign-out-alt fa-sm fa-fw mr-2 text-gray-400"></i>
                                Logout
                            </a>
                        </div>
                    </li>
                </ul>
            </nav>
            <script src="<?= rafAssetUrl('/js/index-page.js') ?>"></script>
            <div class="container-fluid">
                <div class="dashboard-header">
                    <div class="d-flex align-items-center justify-content-between">
                        <div>
                            <h1>Ringkasan Dashboard</h1>
                            <p>Selamat datang di RAF BOT Premium Dashboard</p>
                        </div>
                        <button id="start_btn" type="button" class="btn btn-primary-custom">
                            <i class="fas fa-rocket"></i> Connect BOT
                        </button>
                    </div>
                </div>

                <?php if ($monitoringEnabled): ?>
                    <div id="monitoring-section">
                        <?php 
                        $widgetPath = __DIR__ . '/../monitoring-widget.php';
                        if (file_exists($widgetPath)) {
                            include $widgetPath;
                        } else {
                            echo '<!-- Monitoring widget not found at: ' . $widgetPath . ' -->';
                        }
                        ?>
                    </div>
                <?php else: ?>
                    <div class="alert alert-secondary mb-4" role="alert">
                        <strong>Monitoring dashboard dinonaktifkan.</strong>
                        <?php echo htmlspecialchars($monitoringReason); ?>
                        Aktifkan lewat environment variable proses/service <code>MONITORING_ENABLED=true</code>
                        atau file <code>config.json</code> pada key <code>monitoring.enabled</code>.
                    </div>
                <?php endif; ?>

                <h4 class="dashboard-section-title">Core Status</h4>
                <div class="row match-height dashboard-kpi-row">
                    <div class="col-xl-4 col-lg-4 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-primary" id="card-bot-status">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">Bot Status</div>
                                        <div class="card-value" id="bot_status_value"></div>
                                        <div class="card-subtitle">
                                            <i class="fas fa-circle" style="font-size: 8px;"></i>
                                            <span>WhatsApp Connection</span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-robot"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-4 col-lg-4 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-info" id="card-mikrotik-status">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">Mikrotik Status</div>
                                        <div class="card-value" id="mikrotik_status_value"></div>
                                        <div class="card-subtitle">
                                            <i class="fas fa-circle" style="font-size: 8px;"></i>
                                            <span>Network Router</span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-network-wired"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-4 col-lg-4 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-dark" id="card-genieacs-status">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">GenieACS Status</div>
                                        <div class="card-value" id="genieacs_status_value"></div>
                                        <div class="card-subtitle">
                                            <i class="fas fa-circle" style="font-size: 8px;"></i>
                                            <span>Device Manager</span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-server"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-4 col-lg-4 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-success" id="card-users-total">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">Total Users</div>
                                        <div class="card-value" id="users_total_value"></div>
                                        <div class="card-subtitle">
                                            <span class="card-change positive">
                                                <i class="fas fa-arrow-up"></i> Active
                                            </span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-users"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-4 col-lg-4 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-info" id="card-users-paid">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">Paid Users</div>
                                        <div class="card-value" id="users_paid_value"></div>
                                        <div class="card-subtitle">
                                            <span class="card-change positive">
                                                <i class="fas fa-check-circle"></i> Lunas
                                            </span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-user-check"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-4 col-lg-4 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-warning" id="card-users-unpaid">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">Unpaid Users</div>
                                        <div class="card-value" id="users_unpaid_value"></div>
                                        <div class="card-subtitle">
                                            <span class="card-change negative">
                                                <i class="fas fa-clock"></i> Pending
                                            </span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-user-clock"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <h4 class="dashboard-section-title">Access & Connectivity</h4>
                <div class="row match-height dashboard-kpi-row">
                    <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-success" id="card-ppp-online">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">PPPoE Online</div>
                                        <div class="card-value" id="ppp_online_value"></div>
                                        <div class="card-subtitle">
                                            <i class="fas fa-circle text-success" style="font-size: 8px;"></i>
                                            <span>Connected</span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-plug"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-dark" id="card-ppp-offline">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">PPPoE Offline</div>
                                        <div class="card-value" id="ppp_offline_value"></div>
                                        <div class="card-subtitle">
                                            <i class="fas fa-circle text-secondary" style="font-size: 8px;"></i>
                                            <span>Disconnected</span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-user-slash"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-primary" id="card-hotspot-total">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">Hotspot Users</div>
                                        <div class="card-value" id="hotspot_total_value"></div>
                                        <div class="card-subtitle">
                                            <i class="fas fa-wifi" style="font-size: 10px;"></i>
                                            <span>Total Registered</span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-wifi"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-3 col-lg-6 col-md-6 col-sm-12 mb-4">
                        <div class="card dashboard-card card-danger" id="card-hotspot-active">
                            <div class="card-body">
                                <div class="card-content">
                                    <div class="card-info">
                                        <div class="card-title-text">Hotspot Online</div>
                                        <div class="card-value" id="hotspot_active_value"></div>
                                        <div class="card-subtitle">
                                            <i class="fas fa-signal" style="font-size: 10px;"></i>
                                            <span>Active Now</span>
                                        </div>
                                    </div>
                                    <div class="card-icon-container">
                                        <i class="fas fa-broadcast-tower"></i>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <h4 class="dashboard-section-title">Finance Workspace</h4>
                <div class="row match-height">
                    <div class="col-xl-8 col-lg-12 mb-4">
                        <div class="card workspace-panel h-100">
                            <div class="card-header">
                                <h6 class="m-0 font-weight-bold text-primary">Finance Workspace</h6>
                                <div class="workspace-panel-subtitle">Pendapatan, cashflow, dan tekanan pengeluaran pada periode aktif.</div>
                            </div>
                            <div class="card-body">
                                <div class="finance-workspace-grid">
                                    <div class="card dashboard-card card-danger finance-hero-card mb-0" id="card-total-revenue">
                                        <div class="card-body">
                                            <div class="card-content">
                                                <div class="card-info">
                                                    <div class="card-title-text">Pendapatan PPPoE Bulanan</div>
                                                    <div class="card-value" id="total_revenue_value"></div>
                                                    <div class="card-subtitle">
                                                        <span class="card-change positive">
                                                            <i class="fas fa-chart-line"></i> Revenue
                                                        </span>
                                                    </div>
                                                </div>
                                                <div class="card-icon-container">
                                                    <i class="fas fa-coins"></i>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="finance-secondary-grid">
                                        <div class="card dashboard-card card-success mb-0">
                                            <div class="card-body">
                                                <div class="card-content">
                                                    <div class="card-info">
                                                        <div class="card-title-text">Pemasukan</div>
                                                        <div class="card-value" id="finance_income_value">Rp 0</div>
                                                        <div class="card-subtitle"><span>Cash-in ledger</span></div>
                                                    </div>
                                                    <div class="card-icon-container">
                                                        <i class="fas fa-arrow-up"></i>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="card dashboard-card card-danger mb-0">
                                            <div class="card-body">
                                                <div class="card-content">
                                                    <div class="card-info">
                                                        <div class="card-title-text">Pengeluaran</div>
                                                        <div class="card-value" id="finance_expense_value">Rp 0</div>
                                                        <div class="card-subtitle"><span>Cash-out ledger</span></div>
                                                    </div>
                                                    <div class="card-icon-container">
                                                        <i class="fas fa-arrow-down"></i>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="card dashboard-card card-primary mb-0">
                                            <div class="card-body">
                                                <div class="card-content">
                                                    <div class="card-info">
                                                        <div class="card-title-text">Nett</div>
                                                        <div class="card-value" id="finance_net_value">Rp 0</div>
                                                        <div class="card-subtitle"><span>Pemasukan - Pengeluaran</span></div>
                                                    </div>
                                                    <div class="card-icon-container">
                                                        <i class="fas fa-balance-scale"></i>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="card dashboard-card card-warning mb-0">
                                            <div class="card-body">
                                                <div class="card-content">
                                                    <div class="card-info">
                                                        <div class="card-title-text">Pengeluaran Terbesar</div>
                                                        <div class="card-value" id="finance_largest_expense_value">Rp 0</div>
                                                        <div class="card-subtitle"><span id="finance_largest_expense_label">Belum ada data</span></div>
                                                    </div>
                                                    <div class="card-icon-container">
                                                        <i class="fas fa-receipt"></i>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="row mt-3">
                                    <div class="col-md-6 mb-3 mb-md-0">
                                        <div class="snapshot-panel">
                                            <div class="snapshot-panel-header">Top Kategori Pengeluaran</div>
                                            <div class="snapshot-panel-body snapshot-panel-body--scroll" id="finance_expense_categories">
                                                <div class="text-muted small">Loading...</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="snapshot-panel">
                                            <div class="snapshot-panel-header">Cashflow Alert</div>
                                            <div class="snapshot-panel-body snapshot-panel-body--scroll" id="finance_health_alerts">
                                                <div class="text-muted small">Loading...</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="col-xl-4 col-lg-12 mb-4">
                        <div class="card workspace-panel h-100">
                            <div class="card-header">
                                <h6 class="m-0 font-weight-bold text-primary">Quick Actions</h6>
                                <div class="workspace-panel-subtitle">Shortcut operasional untuk finance, payroll, dan kasbon.</div>
                            </div>
                            <div class="card-body">
                                <div class="action-list">
                                    <a href="/pengeluaran" class="action-link">
                                        <div>
                                            <div class="action-link-title">Input Pengeluaran</div>
                                            <div class="action-link-meta">Catat cash-out dan dokumentasi biaya.</div>
                                        </div>
                                        <span class="action-link-icon"><i class="fas fa-receipt"></i></span>
                                    </a>
                                    <a href="/rekap-keuangan" class="action-link">
                                        <div>
                                            <div class="action-link-title">Buka Rekap Keuangan</div>
                                            <div class="action-link-meta">Audit cashflow dan health panel lengkap.</div>
                                        </div>
                                        <span class="action-link-icon"><i class="fas fa-chart-line"></i></span>
                                    </a>
                                    <a href="/gaji-teknisi" class="action-link">
                                        <div>
                                            <div class="action-link-title">Lihat Payroll</div>
                                            <div class="action-link-meta">Cek komisi, settlement, dan payout teknisi.</div>
                                        </div>
                                        <span class="action-link-icon"><i class="fas fa-money-bill-wave"></i></span>
                                    </a>
                                    <a href="/admin-kasbon" class="action-link">
                                        <div>
                                            <div class="action-link-title">Lihat Kasbon</div>
                                            <div class="action-link-meta">Pantau outstanding kasbon dan approval cepat.</div>
                                        </div>
                                        <span class="action-link-icon"><i class="fas fa-hand-holding-usd"></i></span>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <h4 class="dashboard-section-title">Access Snapshot</h4>
                <div class="row">
                    <div class="col-12 mb-4">
                        <div class="card shadow login-history-card">
                            <div class="card-header py-3 d-flex flex-row align-items-center justify-content-between">
                                <div>
                                    <h6 class="m-0 font-weight-bold text-primary">
                                    <i class="fas fa-history me-2"></i>Riwayat Login & Logout
                                    </h6>
                                    <div class="login-history-header-meta">Snapshot operasional singkat. Riwayat penuh tetap ada di halaman detail.</div>
                                </div>
                                <a href="/login-logs" class="btn btn-sm btn-primary">
                                    <i class="fas fa-external-link-alt me-1"></i>Lihat Semua
                                </a>
                            </div>
                            <div class="card-body">
                                <div class="login-history-toolbar d-flex align-items-center justify-content-between">
                                    <div class="small text-muted">Menampilkan aktivitas login/logout terbaru yang paling relevan untuk dashboard.</div>
                                    <div class="small text-muted font-weight-bold" id="recentLoginLogsMeta">Loading...</div>
                                </div>
                                <div class="table-responsive login-history-table-wrap">
                                    <table class="table table-sm table-hover login-history-table tabel-tumpuk-hp" id="recentLoginLogsTable">
                                        <thead>
                                            <tr>
                                                <th>Action</th>
                                                <th>Waktu</th>
                                                <th>Username</th>
                                                <th>Role</th>
                                                <th>Status</th>
                                                <th>IP Address</th>
                                            </tr>
                                        </thead>
                                        <tbody id="recentLoginLogsBody">
                                            <tr>
                                                <td colspan="6" class="text-center">
                                                    <div class="spinner-border spinner-border-sm text-primary" role="status">
                                                        <span class="sr-only">Loading...</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="row d-none mt-4" id="qr_container_parent">
                    <div class="col-xl-4 col-lg-5">
                        <div class="card qr-card mb-4">
                            <div class="card-header py-3 d-flex flex-row align-items-center justify-content-between">
                                <h6 class="m-0 font-weight-bold">Scan QR to Connect WhatsApp</h6>
                            </div>
                            <div class="card-body text-center">
                                <img src="" alt="WhatsApp QR Code" class="img-fluid" id="qr_img" style="max-height: 300px;">
                                <p class="mt-3 text-muted">Arahkan kamera WhatsApp Anda ke layar ini</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <footer class="sticky-footer bg-white">
                <div class="container my-auto">
                    <div class="copyright text-center my-auto">
                        <!-- Dulu `document.write(new Date().getFullYear())` inline. Tidak
                             dieksternalkan: Chrome bisa MEMBLOKIR document.write dari skrip
                             eksternal yang menghalangi parser. Halaman ini PHP, jadi tahunnya
                             dirender di server saja — nol JavaScript. -->
                        <span>Copyright &copy; RAF BOT <?= date('Y') ?></span>
                    </div>
                </div>
            </footer>
        </div>
    </div>

    <a class="scroll-to-top rounded" href="#page-top"><i class="fas fa-angle-up"></i></a>

    <div class="modal fade" id="logoutModal" tabindex="-1" role="dialog" aria-labelledby="exampleModalLabel"
        aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered" role="document">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="exampleModalLabel">Ready to Leave?</h5>
                    <button class="close" type="button" data-dismiss="modal" aria-label="Close">
                        <span aria-hidden="true">×</span>
                    </button>
                </div>
                <div class="modal-body">Select "Logout" below if you are ready to end your current session.</div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" type="button" data-dismiss="modal">Cancel</button>
                    <a class="btn btn-primary" href="/logout">Logout</a>
                </div>
            </div>
        </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
    <script src="/js/sb-admin-2.js"></script>
    <script src="/socket.io/socket.io.js"></script>

    <script src="/js/theme.js"></script>

    <script src="/js/index.js"></script>
    
    <?php if ($monitoringEnabled): ?>
    <!-- Monitoring Dashboard Scripts -->
<script src="/static/vendor/chart.js/Chart.min.js"></script>
<script src="/static/js/monitoring-helpers.js"></script>
<script src="/static/js/monitoring-state.js"></script>
<script src="/static/js/monitoring-transport.js"></script>
    <script src="/static/js/monitoring-modals.js"></script>
    <script src="/static/js/monitoring-alerts.js"></script>
    <script src="/static/js/monitoring-controller.js"></script>
    <?php endif; ?>
    
    </body>
</html>
