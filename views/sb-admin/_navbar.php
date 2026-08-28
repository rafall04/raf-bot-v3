<?php
/**
 * Header Doc
 * Purpose: Sidebar navigasi SB Admin dengan awareness role dan status halaman aktif.
 * Caller: Halaman PHP di `views/sb-admin/*`.
 * Deps: Cookie JWT, session PHP, helper `isActive`/`isParentActive` lokal.
 * MainFuncs: Render menu admin/teknisi, termasuk link Auto Outage.
 * SideEffects: Membaca cookie/session dan mengeluarkan markup navigasi.
 */
// Guard !headers_sent(): partial ini di-include di tengah body pada banyak
// halaman (output HTML sudah terkirim), jadi session_start() di sini akan
// memunculkan warning "headers already sent". Auth sebenarnya pakai JWT cookie
// (lihat di bawah); $_SESSION hanya fallback opsional.
if (session_status() === PHP_SESSION_NONE && !headers_sent()) {
    session_start();
}

$current_page = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
// php-express renders via PHP CLI and does not populate REQUEST_URI, so derive
// the route from the rendered script path. Dashboard (index.php) maps to '/'.
if ($current_page === '' && isset($GLOBALS['argv'][2])) {
    $filename = pathinfo($GLOBALS['argv'][2], PATHINFO_FILENAME);
    $current_page = ($filename === 'index') ? '/' : ('/' . $filename);
}
$current_page = strtok($current_page, '?');

// !! NAMA BERKAS TIDAK SELALU SAMA DENGAN RUTENYA, dan karena $current_page di atas
// diturunkan dari nama berkas, menu untuk halaman-halaman ini TIDAK PERNAH tersorot —
// admin kehilangan jejak posisinya di menu. TERUKUR di peramban sebelum perbaikan:
//   /admin/daftar-tiket -> tiket.php          -> current_page '/tiket'
//   /owner              -> owner-cockpit.php  -> current_page '/owner-cockpit'
//   /penyesuaian-bulk   -> bulk-ssid-diff.php -> current_page '/bulk-ssid-diff'
// ketiganya: item menu ADA tapi `active` = false dan sub-menunya tidak terbuka.
// Dipetakan balik ke rutenya di SATU tempat, bukan menambal tiap pemanggilan isActive().
$ALIAS_BERKAS_KE_RUTE = [
    '/tiket'           => '/admin/daftar-tiket',
    '/owner-cockpit'   => '/owner',
    '/bulk-ssid-diff'  => '/penyesuaian-bulk',
];
if (isset($ALIAS_BERKAS_KE_RUTE[$current_page])) {
    $current_page = $ALIAS_BERKAS_KE_RUTE[$current_page];
}

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

// CATATAN php-express: file ini (_navbar.php) adalah sidebar ADMIN — di-include langsung
// hanya pada halaman yang sudah di-gate role admin di layer Express (checkRole). php-express
// merender PHP lewat CLI dan TIDAK mengisi $_COOKIE, jadi deteksi role dari token di atas
// SELALU jatuh ke 'guest'. Semua grup menu lain dirender tanpa syarat role; dulu HANYA grup
// "Layanan" yang dibungkus kondisi berbasis role, jadi grup itu (berisi Kompensasi, Speed
// Boost, Rekap PSB) HILANG dari menu untuk semua admin. Karena file ini khusus admin, paksa
// konteks admin agar grup Layanan tampil konsisten dengan grup lain. Otorisasi sebenarnya
// tetap di layer Express (checkRole), bukan di sidebar ini.
$isAdminLikeRole = true;
$isTeknisiRole = false;

$layananPages = ['/admin/daftar-tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/papan-psb', '/laporan-marketing-psb'];
$ticketPagePath = '/admin/daftar-tiket';
$ticketPageLabel = 'Tiket Support Admin';

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
<script>
// Apply saved dark/light theme ASAP (before paint) to avoid a flash.
(function () { try { var s = localStorage.getItem('tkTheme'); if (s === 'dark' || (!s && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) { document.body.classList.add('tk-dark'); } } catch (e) {} })();
</script>
<link rel="stylesheet" href="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/css/sidebar.css') : '/css/sidebar.css'; ?>">
<ul class="navbar-nav bg-gradient-primary sidebar sidebar-dark accordion" id="accordionSidebar" aria-label="Navigasi cepat admin">
    <li class="mobile-sidebar-head d-md-none">
        <div class="mobile-sidebar-title">
            <strong>RAF BOT WIFI</strong>
            <span>Admin Panel</span>
        </div>
        <button type="button" class="mobile-sidebar-close" id="mobileSidebarClose" aria-label="Tutup navigasi">
            <i class="fas fa-times"></i>
        </button>
    </li>
    <a class="sidebar-brand d-flex align-items-center justify-content-center" href="/">
        <div class="sidebar-brand-icon">
            <i class="fas fa-robot"></i>
        </div>
        <div class="sidebar-brand-text mx-3">
            <span class="brand-name">RAF BOT<sup>WIFI</sup></span>
            <span class="brand-role">Admin Panel</span>
        </div>
    </a>

    <li class="sidebar-search">
        <div class="sidebar-search-wrap">
            <i class="fas fa-search sidebar-search-icon"></i>
            <input type="search" id="sidebarMenuSearch" class="sidebar-search-input"
                   placeholder="Cari menu..." autocomplete="off" aria-label="Cari menu sidebar">
            <button type="button" id="sidebarMenuSearchClear" class="sidebar-search-clear" hidden aria-label="Kosongkan pencarian">
                <i class="fas fa-times"></i>
            </button>
        </div>
        <div class="sidebar-search-empty" id="sidebarMenuSearchEmpty" hidden>
            <i class="fas fa-inbox"></i> Tidak ada menu yang cocok
        </div>
    </li>

    <li class="nav-item <?php echo isActive('/', $current_page) ? 'active' : ''; ?>">
        <a class="nav-link" href="/">
            <i class="fas fa-fw fa-tachometer-alt"></i>
            <span>Dashboard</span>
        </a>
    </li>

    <!-- Ditaruh TEPAT di bawah Dashboard, bukan di grup "Sistem" paling bawah: pembaca yang
         paling butuh halaman ini adalah admin yang baru pertama kali membuka panel, dan dia
         belum tahu grup mana yang harus dibuka. -->
    <li class="nav-item <?php echo isActive('/admin-tutorial', $current_page) ? 'active' : ''; ?>">
        <a class="nav-link" href="/admin-tutorial">
            <i class="fas fa-fw fa-book-open"></i>
            <span>Panduan Admin</span>
        </a>
    </li>

    <li class="nav-item <?php echo isActive('/owner', $current_page) ? 'active' : ''; ?>">
        <a class="nav-link" href="/owner">
            <i class="fas fa-fw fa-crown"></i>
            <span>Owner Cockpit</span>
        </a>
    </li>

    <li class="nav-item <?php echo isActive('/survei', $current_page) ? 'active' : ''; ?>">
        <a class="nav-link" href="/survei">
            <i class="fas fa-fw fa-star"></i>
            <span>Survei Kepuasan</span>
        </a>
    </li>

    <hr class="sidebar-divider">
    <div class="sidebar-heading">Operasional</div>

    <li class="nav-item <?php echo isParentActive(['/users', '/packages', '/package-requests', '/rubah-paket', '/buka-isolir', '/custom-isolir', '/import-mikrotik', '/sync-device-id', '/ganti-modem', '/penyesuaian-bulk', '/sisa-pppoe'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePelanggan" aria-expanded="<?php echo isParentActive(['/users', '/packages', '/package-requests', '/rubah-paket', '/buka-isolir', '/custom-isolir', '/import-mikrotik', '/sync-device-id', '/ganti-modem', '/penyesuaian-bulk', '/sisa-pppoe'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapsePelanggan">
            <i class="fas fa-fw fa-users"></i>
            <span>Pelanggan</span>
        </a>
        <div id="collapsePelanggan" class="collapse <?php echo isParentActive(['/users', '/packages', '/package-requests', '/rubah-paket', '/buka-isolir', '/custom-isolir', '/import-mikrotik', '/sync-device-id', '/ganti-modem', '/penyesuaian-bulk', '/sisa-pppoe'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingPelanggan" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/users', $current_page) ? 'active' : ''; ?>" href="/users">
                    <i class="fas fa-fw fa-user mr-2"></i>
                    <span>Data Pelanggan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/packages', $current_page) ? 'active' : ''; ?>" href="/packages">
                    <i class="fas fa-fw fa-box-open mr-2"></i>
                    <span>Paket Langganan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/package-requests', $current_page) ? 'active' : ''; ?>" href="/package-requests">
                    <i class="fas fa-fw fa-sync-alt mr-2"></i>
                    <span>Request Ubah Paket</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/rubah-paket', $current_page) ? 'active' : ''; ?>" href="/rubah-paket">
                    <i class="fas fa-fw fa-exchange-alt mr-2"></i>
                    <span>Rubah Paket</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/buka-isolir', $current_page) ? 'active' : ''; ?>" href="/buka-isolir">
                    <i class="fas fa-fw fa-unlock mr-2"></i>
                    <span>Buka Isolir</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/custom-isolir', $current_page) ? 'active' : ''; ?>" href="/custom-isolir">
                    <i class="fas fa-fw fa-user-lock mr-2"></i>
                    <span>Custom Isolir</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/import-mikrotik', $current_page) ? 'active' : ''; ?>" href="/import-mikrotik">
                    <i class="fas fa-fw fa-file-import mr-2"></i>
                    <span>Import MikroTik</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/ganti-modem', $current_page) ? 'active' : ''; ?>" href="/ganti-modem">
                    <i class="fas fa-fw fa-exchange-alt mr-2"></i>
                    <span>Ganti Modem</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/sync-device-id', $current_page) ? 'active' : ''; ?>" href="/sync-device-id">
                    <i class="fas fa-fw fa-sync mr-2"></i>
                    <span>Sync Device ID</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/penyesuaian-bulk', $current_page) ? 'active' : ''; ?>" href="/penyesuaian-bulk">
                    <i class="fas fa-fw fa-wifi mr-2"></i>
                    <span>Penyesuaian Bulk SSID</span>
                </a>
            
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/sisa-pppoe', $current_page) ? 'active' : ''; ?>" href="/sisa-pppoe">
                    <i class="fas fa-fw fa-broom mr-2"></i>
                    <span>Sisa PPPoE</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/payment-status', '/konfirmasi-bayar', '/gratis-bulan-ini', '/pembayaran/otorisasi', '/rekap-tunggakan', '/admin-diskon', '/payment-method', '/invoice-settings'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePembayaran" aria-expanded="<?php echo isParentActive(['/payment-status', '/konfirmasi-bayar', '/gratis-bulan-ini', '/pembayaran/otorisasi', '/rekap-tunggakan', '/admin-diskon', '/payment-method', '/invoice-settings'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapsePembayaran">
            <i class="fas fa-fw fa-money-bill-wave"></i>
            <span>Pembayaran</span>
        </a>
        <div id="collapsePembayaran" class="collapse <?php echo isParentActive(['/payment-status', '/konfirmasi-bayar', '/gratis-bulan-ini', '/pembayaran/otorisasi', '/rekap-tunggakan', '/admin-diskon', '/payment-method', '/invoice-settings'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingPembayaran" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/payment-status', $current_page) ? 'active' : ''; ?>" href="/payment-status">
                    <i class="fas fa-fw fa-money-check-alt mr-2"></i>
                    <span>Status Pembayaran</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/konfirmasi-bayar', $current_page) ? 'active' : ''; ?>" href="/konfirmasi-bayar">
                    <i class="fas fa-fw fa-receipt mr-2"></i>
                    <span>Konfirmasi Bayar</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/gratis-bulan-ini', $current_page) ? 'active' : ''; ?>" href="/gratis-bulan-ini">
                    <i class="fas fa-fw fa-gift mr-2"></i>
                    <span>Gratis Bulan Ini</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/pembayaran/otorisasi', $current_page) ? 'active' : ''; ?>" href="/pembayaran/otorisasi">
                    <i class="fas fa-fw fa-user-shield mr-2"></i>
                    <span>Otorisasi Pembayaran</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/rekap-tunggakan', $current_page) ? 'active' : ''; ?>" href="/rekap-tunggakan">
                    <i class="fas fa-fw fa-file-invoice-dollar mr-2"></i>
                    <span>Rekap Tunggakan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/admin-diskon', $current_page) ? 'active' : ''; ?>" href="/admin-diskon">
                    <i class="fas fa-fw fa-tags mr-2"></i>
                    <span>Diskon Pelanggan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/payment-method', $current_page) ? 'active' : ''; ?>" href="/payment-method">
                    <i class="fas fa-fw fa-credit-card mr-2"></i>
                    <span>Metode Pembayaran</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/invoice-settings', $current_page) ? 'active' : ''; ?>" href="/invoice-settings">
                    <i class="fas fa-fw fa-file-invoice mr-2"></i>
                    <span>Pengaturan Invoice</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/admin/daftar-tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/papan-psb', '/laporan-marketing-psb'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseLayanan" aria-expanded="<?php echo isParentActive(['/admin/daftar-tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/papan-psb', '/laporan-marketing-psb'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseLayanan">
            <i class="fas fa-fw fa-concierge-bell"></i>
            <span>Layanan</span>
        </a>
        <div id="collapseLayanan" class="collapse <?php echo isParentActive(['/admin/daftar-tiket', '/speed-requests', '/speed-boost-config', '/kompensasi', '/papan-psb', '/laporan-marketing-psb'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingLayanan" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <?php if (!empty($layananPages) && $ticketPagePath !== null): ?>
                <a class="collapse-item d-flex align-items-center <?php echo isActive($ticketPagePath, $current_page) ? 'active' : ''; ?>" href="<?php echo htmlspecialchars($ticketPagePath, ENT_QUOTES, 'UTF-8'); ?>">
                    <i class="fas fa-fw fa-headset mr-2"></i>
                    <span><?php echo htmlspecialchars($ticketPageLabel, ENT_QUOTES, 'UTF-8'); ?></span>
                </a>
                <?php endif; ?>
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
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/papan-psb', $current_page) ? 'active' : ''; ?>" href="/papan-psb">
                    <i class="fas fa-fw fa-clipboard-check mr-2"></i>
                    <span>Papan PSB</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/laporan-marketing-psb', $current_page) ? 'active' : ''; ?>" href="/laporan-marketing-psb">
                    <i class="fas fa-fw fa-hand-holding-usd mr-2"></i>
                    <span>Laporan Marketing PSB</span>
                </a>
            </div>
        </div>
    </li>

    <hr class="sidebar-divider">
    <div class="sidebar-heading">Keuangan &amp; Bisnis</div>

    <li class="nav-item <?php echo isParentActive(['/rekap-keuangan', '/pengeluaran', '/kas-usaha', '/transaction'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseKeuangan" aria-expanded="<?php echo isParentActive(['/rekap-keuangan', '/pengeluaran', '/kas-usaha', '/transaction'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseKeuangan">
            <i class="fas fa-fw fa-chart-line"></i>
            <span>Keuangan</span>
        </a>
        <div id="collapseKeuangan" class="collapse <?php echo isParentActive(['/rekap-keuangan', '/pengeluaran', '/kas-usaha', '/transaction'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingKeuangan" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/rekap-keuangan', $current_page) ? 'active' : ''; ?>" href="/rekap-keuangan">
                    <i class="fas fa-fw fa-chart-line mr-2"></i>
                    <span>Rekap Keuangan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/pengeluaran', $current_page) ? 'active' : ''; ?>" href="/pengeluaran">
                    <i class="fas fa-fw fa-receipt mr-2"></i>
                    <span>Pengeluaran</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/kas-usaha', $current_page) ? 'active' : ''; ?>" href="/kas-usaha">
                    <i class="fas fa-fw fa-building mr-2"></i>
                    <span>Kas Usaha</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/transaction', $current_page) ? 'active' : ''; ?>" href="/transaction">
                    <i class="fas fa-fw fa-exchange-alt mr-2"></i>
                    <span>Transaksi</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/gaji-teknisi', '/admin-kasbon', '/teknisi-working-hours'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseTeknisi" aria-expanded="<?php echo isParentActive(['/gaji-teknisi', '/admin-kasbon', '/teknisi-working-hours'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseTeknisi">
            <i class="fas fa-fw fa-hard-hat"></i>
            <span>Teknisi</span>
        </a>
        <div id="collapseTeknisi" class="collapse <?php echo isParentActive(['/gaji-teknisi', '/admin-kasbon', '/teknisi-working-hours'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingTeknisi" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/gaji-teknisi', $current_page) ? 'active' : ''; ?>" href="/gaji-teknisi">
                    <i class="fas fa-fw fa-money-bill-wave mr-2"></i>
                    <span>Gaji Teknisi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/admin-kasbon', $current_page) ? 'active' : ''; ?>" href="/admin-kasbon">
                    <i class="fas fa-fw fa-hand-holding-usd mr-2"></i>
                    <span>Kasbon Teknisi</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/teknisi-working-hours', $current_page) ? 'active' : ''; ?>" href="/teknisi-working-hours">
                    <i class="fas fa-fw fa-business-time mr-2"></i>
                    <span>Jam Kerja Teknisi</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/penugasan-agen', '/laporan-agen', '/agent-management', '/agent-voucher-management', '/saldo-management'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseAgen" aria-expanded="<?php echo isParentActive(['/penugasan-agen', '/laporan-agen', '/agent-management', '/agent-voucher-management', '/saldo-management'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseAgen">
            <i class="fas fa-fw fa-user-tag"></i>
            <span>Agen &amp; Reseller</span>
        </a>
        <div id="collapseAgen" class="collapse <?php echo isParentActive(['/penugasan-agen', '/laporan-agen', '/agent-management', '/agent-voucher-management', '/saldo-management'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingAgen" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/penugasan-agen', $current_page) ? 'active' : ''; ?>" href="/penugasan-agen">
                    <i class="fas fa-fw fa-user-tag mr-2"></i>
                    <span>Penugasan Agen</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/laporan-agen', $current_page) ? 'active' : ''; ?>" href="/laporan-agen">
                    <i class="fas fa-fw fa-hand-holding-usd mr-2"></i>
                    <span>Laporan Komisi Agen</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/agent-management', $current_page) ? 'active' : ''; ?>" href="/agent-management">
                    <i class="fas fa-fw fa-store mr-2"></i>
                    <span>Agent &amp; Outlet</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/agent-voucher-management', $current_page) ? 'active' : ''; ?>" href="/agent-voucher-management">
                    <i class="fas fa-fw fa-boxes mr-2"></i>
                    <span>Stok Voucher Agent</span>
                </a>
            
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/saldo-management', $current_page) ? 'active' : ''; ?>" href="/saldo-management">
                    <i class="fas fa-fw fa-wallet mr-2"></i>
                    <span>Saldo &amp; Voucher</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/paket-voucher', '/voucher-send', '/voucher-print', '/voucher-sales'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseVoucher" aria-expanded="<?php echo isParentActive(['/paket-voucher', '/voucher-send', '/voucher-print', '/voucher-sales'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseVoucher">
            <i class="fas fa-fw fa-ticket-alt"></i>
            <span>Voucher Hotspot</span>
        </a>
        <div id="collapseVoucher" class="collapse <?php echo isParentActive(['/paket-voucher', '/voucher-send', '/voucher-print', '/voucher-sales'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingVoucher" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/paket-voucher', $current_page) ? 'active' : ''; ?>" href="/paket-voucher">
                    <i class="fas fa-fw fa-list mr-2"></i>
                    <span>Paket Voucher</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/voucher-send', $current_page) ? 'active' : ''; ?>" href="/voucher-send">
                    <i class="fas fa-fw fa-paper-plane mr-2"></i>
                    <span>Kirim Voucher</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/voucher-print', $current_page) ? 'active' : ''; ?>" href="/voucher-print">
                    <i class="fas fa-fw fa-print mr-2"></i>
                    <span>Cetak Voucher</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/voucher-sales', $current_page) ? 'active' : ''; ?>" href="/voucher-sales">
                    <i class="fas fa-fw fa-chart-line mr-2"></i>
                    <span>Penjualan Voucher</span>
                </a>
            </div>
        </div>
    </li>

    <hr class="sidebar-divider">
    <div class="sidebar-heading">Jaringan</div>

    <li class="nav-item <?php echo isParentActive(['/map-viewer', '/network-assets', '/rapikan-odp', '/statik', '/admin-olt-provision'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseInfra" aria-expanded="<?php echo isParentActive(['/map-viewer', '/network-assets', '/rapikan-odp', '/statik', '/admin-olt-provision'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseInfra">
            <i class="fas fa-fw fa-network-wired"></i>
            <span>Infrastruktur</span>
        </a>
        <div id="collapseInfra" class="collapse <?php echo isParentActive(['/map-viewer', '/network-assets', '/rapikan-odp', '/statik', '/admin-olt-provision'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingInfra" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/map-viewer', $current_page) ? 'active' : ''; ?>" href="/map-viewer">
                    <i class="fas fa-fw fa-map-marked-alt mr-2"></i>
                    <span>Peta Jaringan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/network-assets', $current_page) ? 'active' : ''; ?>" href="/network-assets">
                    <i class="fas fa-fw fa-boxes mr-2"></i>
                    <span>Manajemen Aset</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/rapikan-odp', $current_page) ? 'active' : ''; ?>" href="/rapikan-odp">
                    <i class="fas fa-fw fa-link mr-2"></i>
                    <span>Rapikan ODP</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/statik', $current_page) ? 'active' : ''; ?>" href="/statik">
                    <i class="fas fa-fw fa-network-wired mr-2"></i>
                    <span>IP Statik</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/admin-olt-provision', $current_page) ? 'active' : ''; ?>" href="/admin-olt-provision">
                    <i class="fas fa-fw fa-plug mr-2"></i>
                    <span>Provisioning OLT</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/admin-olt', '/olt-log', '/upstream-quality', '/steering-pelanggan', '/cctv-monitor', '/infra-monitor'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseMonitorJar" aria-expanded="<?php echo isParentActive(['/admin-olt', '/olt-log', '/upstream-quality', '/steering-pelanggan', '/cctv-monitor', '/infra-monitor'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseMonitorJar">
            <i class="fas fa-fw fa-satellite-dish"></i>
            <span>Monitoring</span>
        </a>
        <div id="collapseMonitorJar" class="collapse <?php echo isParentActive(['/admin-olt', '/olt-log', '/upstream-quality', '/steering-pelanggan', '/cctv-monitor', '/infra-monitor'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingMonitorJar" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/admin-olt', $current_page) ? 'active' : ''; ?>" href="/admin-olt">
                    <i class="fas fa-fw fa-broadcast-tower mr-2"></i>
                    <span>Monitor OLT</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/olt-log', $current_page) ? 'active' : ''; ?>" href="/olt-log">
                    <i class="fas fa-fw fa-clipboard-list mr-2"></i>
                    <span>Log Gangguan OLT</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/upstream-quality', $current_page) ? 'active' : ''; ?>" href="/upstream-quality">
                    <i class="fas fa-fw fa-route mr-2"></i>
                    <span>Kualitas Jalur</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/steering-pelanggan', $current_page) ? 'active' : ''; ?>" href="/steering-pelanggan">
                    <i class="fas fa-fw fa-random mr-2"></i>
                    <span>Steering Pelanggan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/cctv-monitor', $current_page) ? 'active' : ''; ?>" href="/cctv-monitor">
                    <i class="fas fa-fw fa-video mr-2"></i>
                    <span>Monitor CCTV</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/infra-monitor', $current_page) ? 'active' : ''; ?>" href="/infra-monitor">
                    <i class="fas fa-fw fa-server mr-2"></i>
                    <span>Monitor Infrastruktur</span>
                </a>
            </div>
        </div>
    </li>

    <hr class="sidebar-divider">
    <div class="sidebar-heading">Komunikasi</div>

    <li class="nav-item <?php echo isParentActive(['/broadcast', '/broadcast-tagihan', '/auto-outage', '/los-broadcast', '/announcements', '/news'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseBroadcast" aria-expanded="<?php echo isParentActive(['/broadcast', '/broadcast-tagihan', '/auto-outage', '/los-broadcast', '/announcements', '/news'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseBroadcast">
            <i class="fas fa-fw fa-bullhorn"></i>
            <span>Broadcast &amp; Info</span>
        </a>
        <div id="collapseBroadcast" class="collapse <?php echo isParentActive(['/broadcast', '/broadcast-tagihan', '/auto-outage', '/los-broadcast', '/announcements', '/news'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingBroadcast" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/broadcast', $current_page) ? 'active' : ''; ?>" href="/broadcast">
                    <i class="fas fa-fw fa-bullhorn mr-2"></i>
                    <span>Broadcast WhatsApp</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/broadcast-tagihan', $current_page) ? 'active' : ''; ?>" href="/broadcast-tagihan">
                    <i class="fas fa-fw fa-paper-plane mr-2"></i>
                    <span>Broadcast Terarah</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/auto-outage', $current_page) ? 'active' : ''; ?>" href="/auto-outage">
                    <i class="fas fa-fw fa-satellite-dish mr-2"></i>
                    <span>Auto Outage</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/los-broadcast', $current_page) ? 'active' : ''; ?>" href="/los-broadcast">
                    <i class="fas fa-fw fa-bolt mr-2"></i>
                    <span>LOS Broadcast (Fiber)</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/announcements', $current_page) ? 'active' : ''; ?>" href="/announcements">
                    <i class="fas fa-fw fa-volume-up mr-2"></i>
                    <span>Pengumuman</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/news', $current_page) ? 'active' : ''; ?>" href="/news">
                    <i class="fas fa-fw fa-newspaper mr-2"></i>
                    <span>Berita &amp; Promo</span>
                </a>
            </div>
        </div>
    </li>

    <li class="nav-item <?php echo isParentActive(['/templates', '/wifi-templates'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseTemplate" aria-expanded="<?php echo isParentActive(['/templates', '/wifi-templates'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseTemplate">
            <i class="fas fa-fw fa-file-alt"></i>
            <span>Template</span>
        </a>
        <div id="collapseTemplate" class="collapse <?php echo isParentActive(['/templates', '/wifi-templates'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingTemplate" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
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

    <hr class="sidebar-divider">
    <div class="sidebar-heading">Sistem</div>

    <li class="nav-item <?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseLogAudit" aria-expanded="<?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseLogAudit">
            <i class="fas fa-fw fa-history"></i>
            <span>Log &amp; Audit</span>
        </a>
        <div id="collapseLogAudit" class="collapse <?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingLogAudit" data-parent="#accordionSidebar">
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

    <li class="nav-item <?php echo isParentActive(['/accounts', '/config', '/parameter-management', '/cron', '/migrate', '/telegram-teknisi'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseSistem" aria-expanded="<?php echo isParentActive(['/accounts', '/config', '/parameter-management', '/cron', '/migrate', '/telegram-teknisi'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseSistem">
            <i class="fas fa-fw fa-cogs"></i>
            <span>Pengaturan</span>
        </a>
        <div id="collapseSistem" class="collapse <?php echo isParentActive(['/accounts', '/config', '/parameter-management', '/cron', '/migrate', '/telegram-teknisi'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingSistem" data-parent="#accordionSidebar">
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
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/migrate', $current_page) ? 'active' : ''; ?>" href="/migrate">
                    <i class="fas fa-fw fa-database mr-2"></i>
                    <span>Migrasi Database</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/telegram-teknisi', $current_page) ? 'active' : ''; ?>" href="/telegram-teknisi">
                    <i class="fas fa-fw fa-telegram-plane mr-2"></i>
                    <span>Bot Teknisi (Telegram)</span>
                </a>
            </div>
        </div>
    </li>
</ul>
<script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/sidebar.js') : '/js/sidebar.js'; ?>"></script>
