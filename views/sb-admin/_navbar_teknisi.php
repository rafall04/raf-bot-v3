<?php
$current_page = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
// php-express renders via PHP CLI and does not populate REQUEST_URI,
// so derive the route from the rendered script path (argv[2] = full .php path).
if ($current_page === '' && isset($GLOBALS['argv'][2])) {
    $current_page = '/' . pathinfo($GLOBALS['argv'][2], PATHINFO_FILENAME);
}
$current_page = strtok($current_page, '?');
?>
<script>
// Apply saved dark/light theme ASAP to avoid a flash of the wrong theme.
(function () {
    try {
        var s = localStorage.getItem('tkTheme');
        if (s === 'dark' || (!s && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.body.classList.add('tk-dark');
        }
    } catch (e) {}
})();
</script>
<link rel="stylesheet" href="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/css/sidebar.css') : '/css/sidebar.css'; ?>">
<ul class="navbar-nav bg-gradient-primary sidebar sidebar-dark accordion" id="accordionSidebar">
    <div class="mobile-sidebar-head d-md-none">
        <div class="mobile-sidebar-title">
            <strong>Menu Teknisi</strong>
            <span>Navigasi cepat teknisi</span>
        </div>
        <button type="button" class="mobile-sidebar-close" id="mobileSidebarClose" aria-label="Tutup menu teknisi">
            <i class="fas fa-times"></i>
        </button>
    </div>
    <!-- Sidebar - Brand -->
    <a class="sidebar-brand d-flex align-items-center justify-content-center" href="/teknisi-pelanggan">
        <div class="sidebar-brand-icon rotate-n-15">
            <i class="fas fa-robot"></i>
        </div>
        <div class="sidebar-brand-text mx-3">RAF BOT<sup>WIFI</sup></div>
    </a>

    <!-- Divider -->
    <hr class="sidebar-divider my-0">

    <!-- REMOVED: Dashboard link for security reasons - teknisi should NOT access admin dashboard -->

    <!-- Divider -->
    <hr class="sidebar-divider">

    <!-- Heading - Operasional -->
    <div class="sidebar-heading">
        Operasional
    </div>

    <!-- Nav Item - Kelola Pelanggan -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-pelanggan.php' || $current_page == '/teknisi-pelanggan') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-pelanggan">
            <i class="fas fa-fw fa-users"></i>
            <span>Kelola Pelanggan</span>
        </a>
    </li>

    <!-- Nav Item - Ganti Modem (pekerjaan lapangan) -->
    <li class="nav-item <?php echo ($current_page == '/ganti-modem.php' || $current_page == '/ganti-modem') ? 'active' : ''; ?>">
        <a class="nav-link" href="/ganti-modem">
            <i class="fas fa-fw fa-exchange-alt"></i>
            <span>Ganti Modem</span>
        </a>
    </li>

    <!-- Nav Item - Monitoring Pembayaran -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-pembayaran.php' || $current_page == '/teknisi-pembayaran') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-pembayaran">
            <i class="fas fa-fw fa-money-check-alt"></i>
            <span>Monitoring Pembayaran</span>
        </a>
    </li>

    <!-- Nav Item - Pasang Baru (PSB) -->
    <!-- Pasang Baru (PSB): jalur 3-fase legacy dipensiunkan (S3) → Papan PSB terpadu + wizard WA #PSB -->
    <li class="nav-item <?php echo ($current_page == '/papan-psb') ? 'active' : ''; ?>">
        <a class="nav-link" href="/papan-psb">
            <i class="fas fa-fw fa-clipboard-check"></i>
            <span>Papan PSB</span>
        </a>
    </li>

    <!-- Nav Item - Pembayaran Teknisi -->
    <li class="nav-item <?php echo ($current_page == '/pembayaran/teknisi.php' || $current_page == '/pembayaran/teknisi') ? 'active' : ''; ?>">
        <a class="nav-link" href="/pembayaran/teknisi">
            <i class="fas fa-fw fa-file-invoice-dollar"></i>
            <span>Request Pembayaran</span>
        </a>
    </li>

    <!-- Nav Item - Request Ubah Paket -->
    <li class="nav-item <?php echo (strpos($current_page, '/admin/teknisi-request-paket') !== false) ? 'active' : ''; ?>">
        <a class="nav-link" href="/admin/teknisi-request-paket">
            <i class="fas fa-fw fa-exchange-alt"></i>
            <span>Request Ubah Paket</span>
        </a>
    </li>

    <!-- Nav Item - Kasbon Teknisi -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-kasbon.php' || $current_page == '/teknisi-kasbon') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-kasbon">
            <i class="fas fa-fw fa-hand-holding-usd"></i>
            <span>Kasbon</span>
        </a>
    </li>

    <!-- Divider -->
    <hr class="sidebar-divider">

    <!-- Heading - Support -->
    <div class="sidebar-heading">
        Support
    </div>

    <!-- Nav Item - Manajemen Tiket -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-tiket.php' || $current_page == '/teknisi-tiket') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-tiket">
            <i class="fas fa-fw fa-headset"></i>
            <span>Manajemen Tiket</span>
        </a>
    </li>

    <!-- Nav Item - Panduan Teknisi -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-tutorial.php' || $current_page == '/teknisi-tutorial') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-tutorial">
            <i class="fas fa-fw fa-book-open"></i>
            <span>Panduan</span>
        </a>
    </li>

    <!-- Divider -->
    <hr class="sidebar-divider">

    <!-- Heading - Jaringan -->
    <div class="sidebar-heading">
        Jaringan
    </div>

    <!-- Nav Item - Monitor OLT -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-olt.php' || $current_page == '/teknisi-olt') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-olt">
            <i class="fas fa-fw fa-broadcast-tower"></i>
            <span>Monitor OLT</span>
        </a>
    </li>

    <!-- Nav Item - Log Gangguan OLT -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-olt-log.php' || $current_page == '/teknisi-olt-log') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-olt-log">
            <i class="fas fa-fw fa-clipboard-list"></i>
            <span>Log Gangguan OLT</span>
        </a>
    </li>

    <!-- Nav Item - Peta Jaringan -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-map-viewer.php' || $current_page == '/teknisi-map-viewer') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-map-viewer">
            <i class="fas fa-fw fa-map-marked-alt"></i>
            <span>Peta Jaringan</span>
        </a>
    </li>

    <!-- Divider -->
    <hr class="sidebar-divider d-none d-md-block">

    <!-- Sidebar Toggler (Sidebar) -->
    <div class="text-center d-none d-md-inline">
        <button class="rounded-circle border-0" id="sidebarToggle"></button>
    </div>
</ul>
<script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/sidebar.js') : '/js/sidebar.js'; ?>"></script>
