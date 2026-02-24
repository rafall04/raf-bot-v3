<?php
$current_page = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';

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
</style>
<ul class="navbar-nav bg-gradient-primary sidebar sidebar-dark accordion" id="accordionSidebar">
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

    <li class="nav-item <?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/sync-device-id', '/rubah-paket'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePelanggan" aria-expanded="<?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/sync-device-id', '/rubah-paket'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapsePelanggan">
            <i class="fas fa-fw fa-users"></i>
            <span>Pelanggan</span>
        </a>
        <div id="collapsePelanggan" class="collapse <?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/sync-device-id', '/rubah-paket'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingPelanggan" data-parent="#accordionSidebar">
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

    <li class="nav-item <?php echo isParentActive(['/payment-status', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePembayaran" aria-expanded="<?php echo isParentActive(['/payment-status', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapsePembayaran">
            <i class="fas fa-fw fa-money-bill-wave"></i>
            <span>Pembayaran</span>
        </a>
        <div id="collapsePembayaran" class="collapse <?php echo isParentActive(['/payment-status', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingPembayaran" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/payment-status', $current_page) ? 'active' : ''; ?>" href="/payment-status">
                    <i class="fas fa-fw fa-money-check-alt mr-2"></i>
                    <span>Status Pembayaran</span>
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

    <li class="nav-item <?php echo isParentActive(['/tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/psb-rekap'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseLayanan" aria-expanded="<?php echo isParentActive(['/tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/psb-rekap'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseLayanan">
            <i class="fas fa-fw fa-headset"></i>
            <span>Layanan</span>
        </a>
        <div id="collapseLayanan" class="collapse <?php echo isParentActive(['/tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/psb-rekap'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingLayanan" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/tiket', $current_page) ? 'active' : ''; ?>" href="/tiket">
                    <i class="fas fa-fw fa-headset mr-2"></i>
                    <span>Tiket Support</span>
                </a>
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
            </div>
        </div>
    </li>

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

    <li class="nav-item <?php echo isParentActive(['/broadcast', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseKomunikasi" aria-expanded="<?php echo isParentActive(['/broadcast', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseKomunikasi">
            <i class="fas fa-fw fa-comments"></i>
            <span>Komunikasi</span>
        </a>
        <div id="collapseKomunikasi" class="collapse <?php echo isParentActive(['/broadcast', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingKomunikasi" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/broadcast', $current_page) ? 'active' : ''; ?>" href="/broadcast">
                    <i class="fas fa-fw fa-bullhorn mr-2"></i>
                    <span>Broadcast WhatsApp</span>
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
