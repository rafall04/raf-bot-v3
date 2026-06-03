<?php
/**
 * Header Doc
 * Purpose: Sidebar navigasi SB Admin dengan awareness role dan status halaman aktif.
 * Caller: Halaman PHP di `views/sb-admin/*`.
 * Deps: Cookie JWT, session PHP, helper `isActive`/`isParentActive` lokal.
 * MainFuncs: Render menu admin/teknisi, termasuk link Auto Outage.
 * SideEffects: Membaca cookie/session dan mengeluarkan markup navigasi.
 */
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$current_page = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
$current_role = 'guest';

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
                if ($payload && is_array($payload) && isset($payload['role']) && !empty(trim($payload['role']))) {
                    $current_role = trim($payload['role']);
                }
            }
        }
    } catch (Exception $e) {
        // Fall back to session role.
    }
}

if ($current_role === 'guest' && isset($_SESSION['role']) && !empty(trim($_SESSION['role']))) {
    $current_role = trim($_SESSION['role']);
}

$isAdminLikeRole = in_array($current_role, ['admin', 'owner', 'superadmin'], true);
$isTeknisiRole = $current_role === 'teknisi';

$layananPages = $isAdminLikeRole
    ? ['/admin/daftar-tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/psb-rekap']
    : ($isTeknisiRole ? ['/teknisi-tiket'] : []);
$ticketPagePath = $isAdminLikeRole ? '/admin/daftar-tiket' : ($isTeknisiRole ? '/teknisi-tiket' : null);
$ticketPageLabel = $isAdminLikeRole ? 'Tiket Support Admin' : 'Tiket Teknisi';

function isActive($page, $current) {
    $pages = is_array($page) ? $page : [$page];
    foreach ($pages as $p) {
        if ($current == $p || $current == $p . '.php') {
            return true;
        }
    }
    return false;
}

function isParentActive($pages, $current) {
    foreach ($pages as $page) {
        if (isActive($page, $current)) {
            return true;
        }
    }
    return false;
}
?>
<style>
#accordionSidebar {
    overscroll-behavior: contain;
}

#accordionSidebar .collapse-inner .collapse-item {
    display: flex !important;
    align-items: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
#accordionSidebar .collapse-inner .collapse-item span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#accordionSidebar .collapse-inner .collapse-item i {
    flex-shrink: 0;
}

#wrapper,
#content-wrapper,
#content {
    min-width: 0;
}

#content-wrapper {
    flex: 1 1 auto;
    width: 100%;
}

.container-fluid,
.row > [class*="col-"],
.card,
.modal-content,
.dataTables_wrapper,
.table-responsive {
    min-width: 0;
}

.table-responsive {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
}

.topbar .dropdown-menu,
.topbar .dropdown-list {
    max-width: calc(100vw - 1rem);
}

.select2-container {
    max-width: 100%;
}

.mobile-sidebar-head {
    display: none;
}

@media (max-width: 991.98px) {
    .container-fluid {
        padding: 1rem !important;
    }
}

@media (max-width: 767.98px) {
    body {
        overflow-x: hidden;
    }

    #accordionSidebar {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: min(78vw, 15rem) !important;
        min-height: 100vh;
        transform: translateX(-105%);
        transition: transform 0.25s ease, box-shadow 0.25s ease;
        z-index: 1055;
        overflow-y: auto;
        box-shadow: none;
        backdrop-filter: saturate(1.1);
    }

    body.sidebar-toggled #accordionSidebar {
        transform: translateX(0);
        box-shadow: 0 20px 48px rgba(15, 23, 42, 0.18);
    }

    #accordionSidebar.toggled,
    body.sidebar-toggled #accordionSidebar {
        width: min(78vw, 15rem) !important;
    }

    #accordionSidebar.toggled .sidebar-brand .sidebar-brand-text,
    #accordionSidebar.toggled .nav-item .nav-link span,
    #accordionSidebar.toggled .sidebar-heading,
    body.sidebar-toggled #accordionSidebar .sidebar-brand .sidebar-brand-text,
    body.sidebar-toggled #accordionSidebar .nav-item .nav-link span,
    body.sidebar-toggled #accordionSidebar .sidebar-heading {
        display: inline;
    }

    #accordionSidebar .mobile-sidebar-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.8rem 0.95rem 0.65rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        position: sticky;
        top: 0;
        z-index: 2;
    }

    #accordionSidebar .mobile-sidebar-head .mobile-sidebar-title {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    #accordionSidebar .mobile-sidebar-head .mobile-sidebar-title strong {
        color: #fff;
        font-size: 0.92rem;
        line-height: 1.1;
        letter-spacing: 0.01em;
    }

    #accordionSidebar .mobile-sidebar-head .mobile-sidebar-title span {
        color: rgba(255, 255, 255, 0.72);
        font-size: 0.72rem;
        margin-top: 0.12rem;
    }

    #accordionSidebar .mobile-sidebar-close {
        border: 0;
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        width: 2rem;
        height: 2rem;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
    }

    #accordionSidebar .sidebar-brand {
        height: auto;
        padding: 0.8rem 0.95rem;
        justify-content: flex-start !important;
        text-align: left;
        gap: 0.7rem;
    }

    #accordionSidebar .sidebar-brand .sidebar-brand-icon {
        width: 2rem;
        display: inline-flex;
        justify-content: center;
    }

    #accordionSidebar .sidebar-brand .sidebar-brand-icon i {
        font-size: 1.35rem;
    }

    #accordionSidebar .sidebar-brand .sidebar-brand-text {
        font-size: 0.9rem;
        margin: 0 !important;
    }

    #accordionSidebar hr.sidebar-divider {
        margin: 0.35rem 0.95rem 0.55rem;
        opacity: 0.45;
    }

    #accordionSidebar.toggled .nav-item .nav-link,
    body.sidebar-toggled #accordionSidebar .nav-item .nav-link {
        width: 100%;
        padding: 0.78rem 0.95rem;
        justify-content: flex-start;
        text-align: left;
        display: flex;
        align-items: center;
        gap: 0.7rem;
        min-height: 2.9rem;
        border-radius: 0.85rem;
        margin: 0 0.55rem;
    }

    #accordionSidebar.toggled .nav-item .nav-link i,
    body.sidebar-toggled #accordionSidebar .nav-item .nav-link i {
        margin-right: 0;
        width: 1rem;
        font-size: 0.92rem;
        text-align: center;
        flex: 0 0 auto;
    }

    #accordionSidebar .nav-item {
        margin-bottom: 0.12rem;
    }

    #accordionSidebar .nav-item.active > .nav-link,
    #accordionSidebar .nav-item .nav-link:hover,
    #accordionSidebar .nav-item .nav-link:focus {
        background: rgba(255, 255, 255, 0.1);
    }

    #accordionSidebar .nav-item .nav-link span {
        font-size: 0.82rem;
        line-height: 1.2;
        min-width: 0;
        flex: 1 1 auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    #accordionSidebar .nav-item .nav-link[data-toggle=collapse]::after {
        margin-left: auto;
        opacity: 0.72;
        font-size: 0.72rem;
    }

    #accordionSidebar .nav-item .collapse,
    #accordionSidebar .nav-item .collapsing {
        margin: 0.18rem 0.55rem 0.45rem;
        position: relative;
        left: 0;
        top: 0;
    }

    #accordionSidebar .nav-item .collapse .collapse-inner,
    #accordionSidebar .nav-item .collapsing .collapse-inner {
        border-radius: 1rem;
        box-shadow: none;
        background: rgba(255, 255, 255, 0.92) !important;
        padding: 0.38rem 0;
    }

    #accordionSidebar .collapse-inner .collapse-item {
        margin: 0 0.38rem;
        padding: 0.58rem 0.72rem;
        min-height: 2.45rem;
        border-radius: 0.78rem;
        font-size: 0.79rem;
    }

    #accordionSidebar .collapse-inner .collapse-item i {
        width: 0.95rem;
        margin-right: 0.6rem !important;
        font-size: 0.82rem;
    }

    #accordionSidebar .collapse-inner .collapse-item.active {
        background: #eff6ff;
        color: #1d4ed8;
    }

    #accordionSidebar .collapse-inner .collapse-item.active i {
        color: #1d4ed8;
    }

    #accordionSidebar .sidebar-heading,
    #accordionSidebar #sidebarToggle,
    #accordionSidebar .text-center.d-none.d-md-inline,
    #accordionSidebar .sidebar-card {
        display: none !important;
    }

    body.sidebar-toggled::before {
        content: '';
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.18);
        z-index: 1050;
    }

    .container-fluid {
        padding: 0.875rem !important;
    }

    .topbar {
        padding-left: 0.25rem;
        padding-right: 0.25rem;
    }

    .topbar .navbar-nav {
        flex-direction: row;
        align-items: center;
    }

    .topbar .nav-item .nav-link {
        padding: 0.5rem 0.35rem;
    }

    .topbar .topbar-divider {
        display: none !important;
    }

    .topbar .dropdown-menu,
    .topbar .dropdown-list {
        width: min(22rem, calc(100vw - 1rem)) !important;
        right: 0.5rem !important;
        left: auto !important;
    }

    .card .card-header,
    .workspace-panel .card-header,
    .modern-panel .panel-header {
        flex-direction: column;
        align-items: flex-start !important;
        gap: 0.75rem;
    }

    .dataTables_wrapper .row {
        margin-left: 0;
        margin-right: 0;
    }

    .dataTables_wrapper .col-sm-12,
    .dataTables_wrapper .col-md-6,
    .dataTables_wrapper .col-lg-12 {
        padding-left: 0;
        padding-right: 0;
    }

    .modal-dialog,
    .modal-dialog.modal-lg,
    .modal-dialog.modal-xl {
        width: calc(100vw - 1rem);
        max-width: calc(100vw - 1rem);
        margin: 0.75rem auto;
    }
}

@media (max-width: 575.98px) {
    #accordionSidebar {
        width: min(80vw, 14.5rem) !important;
    }

    .container-fluid {
        padding: 0.75rem !important;
    }

    .topbar .dropdown-menu,
    .topbar .dropdown-list {
        width: calc(100vw - 1rem) !important;
    }

    .dashboard-header .d-flex,
    .card-header .d-flex,
    .panel-header .d-flex {
        flex-direction: column;
        align-items: flex-start !important;
        gap: 0.75rem;
    }
}
</style>
<ul class="navbar-nav bg-gradient-primary sidebar sidebar-dark accordion" id="accordionSidebar">
    <li class="mobile-sidebar-head d-md-none">
        <div class="mobile-sidebar-title">
            <strong>RAF BOT WIFI</strong>
            <span>Navigasi cepat admin</span>
        </div>
        <button type="button" class="mobile-sidebar-close" id="mobileSidebarClose" aria-label="Tutup navigasi">
            <i class="fas fa-times"></i>
        </button>
    </li>
    <a class="sidebar-brand d-flex align-items-center justify-content-center" href="/">
        <div class="sidebar-brand-icon rotate-n-15">
            <i class="fas fa-robot"></i>
        </div>
        <div class="sidebar-brand-text mx-3">RAF BOT<sup>WIFI</sup></div>
    </a>

    <hr class="sidebar-divider my-0">

    <li class="nav-item <?php echo isActive('/', $current_page) ? 'active' : ''; ?>">
        <a class="nav-link" href="/">
            <i class="fas fa-fw fa-tachometer-alt"></i>
            <span>Dashboard</span>
        </a>
    </li>

    <hr class="sidebar-divider">

    <li class="nav-item <?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/custom-isolir', '/sync-device-id', '/rubah-paket'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePelanggan" aria-expanded="<?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/custom-isolir', '/sync-device-id', '/rubah-paket'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapsePelanggan">
            <i class="fas fa-fw fa-users"></i>
            <span>Pelanggan</span>
        </a>
        <div id="collapsePelanggan" class="collapse <?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/custom-isolir', '/sync-device-id', '/rubah-paket'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingPelanggan" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/users', $current_page) ? 'active' : ''; ?>" href="/users">
                    <i class="fas fa-fw fa-user mr-2"></i>
                    <span>Data Pelanggan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/rubah-paket', $current_page) ? 'active' : ''; ?>" href="/rubah-paket">
                    <i class="fas fa-fw fa-exchange-alt mr-2"></i>
                    <span>Rubah Paket</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/import-mikrotik', $current_page) ? 'active' : ''; ?>" href="/import-mikrotik">
                    <i class="fas fa-fw fa-file-import mr-2"></i>
                    <span>Import MikroTik</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/buka-isolir', $current_page) ? 'active' : ''; ?>" href="/buka-isolir">
                    <i class="fas fa-fw fa-unlock mr-2"></i>
                    <span>Buka Isolir</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/custom-isolir', $current_page) ? 'active' : ''; ?>" href="/custom-isolir">
                    <i class="fas fa-fw fa-user-lock mr-2"></i>
                    <span>Custom Isolir</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/sync-device-id', $current_page) ? 'active' : ''; ?>" href="/sync-device-id">
                    <i class="fas fa-fw fa-sync mr-2"></i>
                    <span>Sync Device ID</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/packages', $current_page) ? 'active' : ''; ?>" href="/packages">
                    <i class="fas fa-fw fa-box-open mr-2"></i>
                    <span>Paket Langganan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/package-requests', $current_page) ? 'active' : ''; ?>" href="/package-requests">
                    <i class="fas fa-fw fa-sync-alt mr-2"></i>
                    <span>Request Ubah Paket</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/payment-status', '/rekap-tunggakan', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi', '/pengeluaran'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePembayaran" aria-expanded="<?php echo isParentActive(['/payment-status', '/rekap-tunggakan', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi', '/pengeluaran'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapsePembayaran">
            <i class="fas fa-fw fa-money-bill-wave"></i>
            <span>Pembayaran</span>
        </a>
        <div id="collapsePembayaran" class="collapse <?php echo isParentActive(['/payment-status', '/rekap-tunggakan', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingPembayaran" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/payment-status', $current_page) ? 'active' : ''; ?>" href="/payment-status">
                    <i class="fas fa-fw fa-money-check-alt mr-2"></i>
                    <span>Status Pembayaran</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/rekap-tunggakan', $current_page) ? 'active' : ''; ?>" href="/rekap-tunggakan">
                    <i class="fas fa-fw fa-file-invoice-dollar mr-2"></i>
                    <span>Rekap Tunggakan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/saldo-management', $current_page) ? 'active' : ''; ?>" href="/saldo-management">
                    <i class="fas fa-fw fa-wallet mr-2"></i>
                    <span>Saldo & Voucher</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/transaction', $current_page) ? 'active' : ''; ?>" href="/transaction">
                    <i class="fas fa-fw fa-exchange-alt mr-2"></i>
                    <span>Transaksi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/payment-method', $current_page) ? 'active' : ''; ?>" href="/payment-method">
                    <i class="fas fa-fw fa-credit-card mr-2"></i>
                    <span>Metode Pembayaran</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/invoice-settings', $current_page) ? 'active' : ''; ?>" href="/invoice-settings">
                    <i class="fas fa-fw fa-file-invoice mr-2"></i>
                    <span>Pengaturan Invoice</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/pembayaran/otorisasi', $current_page) ? 'active' : ''; ?>" href="/pembayaran/otorisasi">
                    <i class="fas fa-fw fa-user-shield mr-2"></i>
                    <span>Otorisasi Pembayaran</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/admin-kasbon', $current_page) ? 'active' : ''; ?>" href="/admin-kasbon">
                    <i class="fas fa-fw fa-hand-holding-usd mr-2"></i>
                    <span>Kasbon Teknisi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/gaji-teknisi', $current_page) ? 'active' : ''; ?>" href="/gaji-teknisi">
                    <i class="fas fa-fw fa-money-bill-wave mr-2"></i>
                    <span>Gaji Teknisi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/admin-diskon', $current_page) ? 'active' : ''; ?>" href="/admin-diskon">
                    <i class="fas fa-fw fa-tags mr-2"></i>
                    <span>Diskon Pelanggan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/rekap-keuangan', $current_page) ? 'active' : ''; ?>" href="/rekap-keuangan">
                    <i class="fas fa-fw fa-chart-line mr-2"></i>
                    <span>Rekap Keuangan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/pengeluaran', $current_page) ? 'active' : ''; ?>" href="/pengeluaran">
                    <i class="fas fa-fw fa-receipt mr-2"></i>
                    <span>Pengeluaran</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/agent-management', '/agent-voucher-management'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseAgent" aria-expanded="<?php echo isParentActive(['/agent-management', '/agent-voucher-management'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseAgent">
            <i class="fas fa-fw fa-store"></i>
            <span>Agent & Reseller</span>
        </a>
        <div id="collapseAgent" class="collapse <?php echo isParentActive(['/agent-management', '/agent-voucher-management'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingAgent" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/agent-management', $current_page) ? 'active' : ''; ?>" href="/agent-management">
                    <i class="fas fa-fw fa-store mr-2"></i>
                    <span>Agent & Outlet</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/agent-voucher-management', $current_page) ? 'active' : ''; ?>" href="/agent-voucher-management">
                    <i class="fas fa-fw fa-boxes mr-2"></i>
                    <span>Stok Voucher Agent</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/voucher', '/voucher-send'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseVoucher" aria-expanded="<?php echo isParentActive(['/voucher', '/voucher-send'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseVoucher">
            <i class="fas fa-fw fa-ticket-alt"></i>
            <span>Voucher Hotspot</span>
        </a>
        <div id="collapseVoucher" class="collapse <?php echo isParentActive(['/voucher', '/voucher-send'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingVoucher" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/voucher', $current_page) ? 'active' : ''; ?>" href="/voucher">
                    <i class="fas fa-fw fa-list mr-2"></i>
                    <span>Paket Voucher</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/voucher-send', $current_page) ? 'active' : ''; ?>" href="/voucher-send">
                    <i class="fas fa-fw fa-paper-plane mr-2"></i>
                    <span>Kirim Voucher</span>
                </a>
            </div>
        </div>
    </li>

    <?php if (!empty($layananPages) && $ticketPagePath !== null): ?>
    <li class="nav-item <?php echo isParentActive($layananPages, $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseLayanan" aria-expanded="<?php echo isParentActive($layananPages, $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseLayanan">
            <i class="fas fa-fw fa-headset"></i>
            <span>Layanan</span>
        </a>
        <div id="collapseLayanan" class="collapse <?php echo isParentActive($layananPages, $current_page) ? 'show' : ''; ?>" aria-labelledby="headingLayanan" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive($ticketPagePath, $current_page) ? 'active' : ''; ?>" href="<?php echo htmlspecialchars($ticketPagePath, ENT_QUOTES, 'UTF-8'); ?>">
                    <i class="fas fa-fw fa-headset mr-2"></i>
                    <span><?php echo htmlspecialchars($ticketPageLabel, ENT_QUOTES, 'UTF-8'); ?></span>
                </a>
                <?php if ($isAdminLikeRole): ?>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/speed-requests', $current_page) ? 'active' : ''; ?>" href="/speed-requests">
                    <i class="fas fa-fw fa-rocket mr-2"></i>
                    <span>Speed Boost Request</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/speed-boost-config', $current_page) ? 'active' : ''; ?>" href="/speed-boost-config">
                    <i class="fas fa-fw fa-tachometer-alt mr-2"></i>
                    <span>Speed Boost Config</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/kompensasi', $current_page) ? 'active' : ''; ?>" href="/kompensasi">
                    <i class="fas fa-fw fa-gift mr-2"></i>
                    <span>Kompensasi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/psb-rekap', $current_page) ? 'active' : ''; ?>" href="/psb-rekap">
                    <i class="fas fa-fw fa-clipboard-list mr-2"></i>
                    <span>Rekap PSB</span>
                </a>
                <?php endif; ?>
            </div>
        </div>
    </li>
    <?php endif; ?>

    <li class="nav-item <?php echo isParentActive(['/map-viewer', '/network-assets', '/statik'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseJaringan" aria-expanded="<?php echo isParentActive(['/map-viewer', '/network-assets', '/statik'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseJaringan">
            <i class="fas fa-fw fa-network-wired"></i>
            <span>Jaringan</span>
        </a>
        <div id="collapseJaringan" class="collapse <?php echo isParentActive(['/map-viewer', '/network-assets', '/statik'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingJaringan" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/map-viewer', $current_page) ? 'active' : ''; ?>" href="/map-viewer">
                    <i class="fas fa-fw fa-map-marked-alt mr-2"></i>
                    <span>Peta Jaringan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/network-assets', $current_page) ? 'active' : ''; ?>" href="/network-assets">
                    <i class="fas fa-fw fa-boxes mr-2"></i>
                    <span>Manajemen Aset</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/statik', $current_page) ? 'active' : ''; ?>" href="/statik">
                    <i class="fas fa-fw fa-network-wired mr-2"></i>
                    <span>IP Statik</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/broadcast', '/auto-outage', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseKomunikasi" aria-expanded="<?php echo isParentActive(['/broadcast', '/auto-outage', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseKomunikasi">
            <i class="fas fa-fw fa-comments"></i>
            <span>Komunikasi</span>
        </a>
        <div id="collapseKomunikasi" class="collapse <?php echo isParentActive(['/broadcast', '/auto-outage', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingKomunikasi" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/broadcast', $current_page) ? 'active' : ''; ?>" href="/broadcast">
                    <i class="fas fa-fw fa-bullhorn mr-2"></i>
                    <span>Broadcast WhatsApp</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/auto-outage', $current_page) ? 'active' : ''; ?>" href="/auto-outage">
                    <i class="fas fa-fw fa-satellite-dish mr-2"></i>
                    <span>Auto Outage</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/announcements', $current_page) ? 'active' : ''; ?>" href="/announcements">
                    <i class="fas fa-fw fa-volume-up mr-2"></i>
                    <span>Pengumuman</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/news', $current_page) ? 'active' : ''; ?>" href="/news">
                    <i class="fas fa-fw fa-newspaper mr-2"></i>
                    <span>Berita & Promo</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/templates', $current_page) ? 'active' : ''; ?>" href="/templates">
                    <i class="fas fa-fw fa-file-alt mr-2"></i>
                    <span>Template Pesan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/wifi-templates', $current_page) ? 'active' : ''; ?>" href="/wifi-templates">
                    <i class="fas fa-fw fa-comments mr-2"></i>
                    <span>Template Command WiFi</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseMonitoring" aria-expanded="<?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseMonitoring">
            <i class="fas fa-fw fa-chart-line"></i>
            <span>Monitoring</span>
        </a>
        <div id="collapseMonitoring" class="collapse <?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingMonitoring" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/wifi-logs', $current_page) ? 'active' : ''; ?>" href="/wifi-logs">
                    <i class="fas fa-fw fa-wifi mr-2"></i>
                    <span>Log Perubahan WiFi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/login-logs', $current_page) ? 'active' : ''; ?>" href="/login-logs">
                    <i class="fas fa-fw fa-sign-in-alt mr-2"></i>
                    <span>Log Login</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/activity-logs', $current_page) ? 'active' : ''; ?>" href="/activity-logs">
                    <i class="fas fa-fw fa-history mr-2"></i>
                    <span>Log Aktivitas</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/accounts', '/config', '/parameter-management', '/cron', '/teknisi-working-hours', '/migrate'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseSistem" aria-expanded="<?php echo isParentActive(['/accounts', '/config', '/parameter-management', '/cron', '/teknisi-working-hours', '/migrate'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseSistem">
            <i class="fas fa-fw fa-cogs"></i>
            <span>Sistem</span>
        </a>
        <div id="collapseSistem" class="collapse <?php echo isParentActive(['/accounts', '/config', '/parameter-management', '/cron', '/teknisi-working-hours', '/migrate'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingSistem" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/accounts', $current_page) ? 'active' : ''; ?>" href="/accounts">
                    <i class="fas fa-fw fa-users-cog mr-2"></i>
                    <span>Akun Admin</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/config', $current_page) ? 'active' : ''; ?>" href="/config">
                    <i class="fas fa-fw fa-cogs mr-2"></i>
                    <span>Konfigurasi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/parameter-management', $current_page) ? 'active' : ''; ?>" href="/parameter-management">
                    <i class="fas fa-fw fa-sliders-h mr-2"></i>
                    <span>Parameter Management</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/cron', $current_page) ? 'active' : ''; ?>" href="/cron">
                    <i class="fas fa-fw fa-clock mr-2"></i>
                    <span>Cron Jobs</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/teknisi-working-hours', $current_page) ? 'active' : ''; ?>" href="/teknisi-working-hours">
                    <i class="fas fa-fw fa-business-time mr-2"></i>
                    <span>Jam Kerja Teknisi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/migrate', $current_page) ? 'active' : ''; ?>" href="/migrate">
                    <i class="fas fa-fw fa-database mr-2"></i>
                    <span>Migrasi Database</span>
                </a>
            </div>
        </div>
    </li>

    <hr class="sidebar-divider d-none d-md-block">

    <div class="text-center d-none d-md-inline">
        <button class="rounded-circle border-0" id="sidebarToggle"></button>
    </div>
</ul>
<script>
document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('accordionSidebar');
    const closeButton = document.getElementById('mobileSidebarClose');
    if (!sidebar) {
        return;
    }

    const closeMobileSidebar = function () {
        if (window.innerWidth > 767.98) {
            return;
        }
        document.body.classList.remove('sidebar-toggled');
        sidebar.classList.add('toggled');
    };

    const closeMobileDrawerAndCollapse = function () {
        closeMobileSidebar();
        const openPanels = sidebar.querySelectorAll('.collapse.show');
        openPanels.forEach(function (panel) {
            const trigger = sidebar.querySelector('[data-target="#' + panel.id + '"]');
            if (trigger && trigger.getAttribute('aria-expanded') === 'true' && !trigger.closest('.nav-item.active')) {
                $(panel).collapse('hide');
            }
        });
    };

    const handleResize = function () {
        if (window.innerWidth > 767.98) {
            document.body.classList.remove('sidebar-toggled');
        } else if (!document.body.classList.contains('sidebar-toggled')) {
            sidebar.classList.add('toggled');
        }
    };

    document.addEventListener('click', function (event) {
        if (window.innerWidth > 767.98 || !document.body.classList.contains('sidebar-toggled')) {
            return;
        }

        const topToggle = document.getElementById('sidebarToggleTop');
        const sideToggle = document.getElementById('sidebarToggle');
        const clickedToggle = (topToggle && topToggle.contains(event.target)) || (sideToggle && sideToggle.contains(event.target));

        if (clickedToggle || sidebar.contains(event.target)) {
            return;
        }

        closeMobileSidebar();
    });

    if (closeButton) {
        closeButton.addEventListener('click', closeMobileSidebar);
    }

    sidebar.querySelectorAll('.collapse-item[href], .nav-link[href]:not([data-toggle="collapse"])').forEach(function (link) {
        link.addEventListener('click', function () {
            closeMobileDrawerAndCollapse();
        });
    });

    window.addEventListener('resize', handleResize);
    handleResize();
});
</script>
