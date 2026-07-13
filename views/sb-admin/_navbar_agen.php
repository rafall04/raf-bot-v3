<?php
/**
 * Header Doc
 * Purpose: Sidebar khusus role "agen" (penagih pembayaran berbasis fee) — ramping, hanya
 *          menu yang relevan untuk agen. Disertakan langsung oleh halaman agen karena
 *          deteksi role via cookie tak andal di render php-express CLI (pola sama seperti
 *          _navbar_teknisi.php yang disertakan halaman teknisi).
 * Caller: views/sb-admin/agen-pembayaran.php.
 * Deps: argv[2] (derive current route), aset FontAwesome/sb-admin.
 * MainFuncs: render markup sidebar agen + skrip drawer mobile.
 * SideEffects: echo markup sidebar.
 */
$current_page = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
// php-express render via PHP CLI tak mengisi REQUEST_URI → turunkan dari argv[2].
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
            <strong>Menu Agen</strong>
            <span>Navigasi cepat agen</span>
        </div>
        <button type="button" class="mobile-sidebar-close" id="mobileSidebarClose" aria-label="Tutup menu agen">
            <i class="fas fa-times"></i>
        </button>
    </div>

    <!-- Sidebar - Brand -->
    <a class="sidebar-brand d-flex align-items-center justify-content-center" href="/agen-pembayaran">
        <div class="sidebar-brand-icon rotate-n-15">
            <i class="fas fa-robot"></i>
        </div>
        <div class="sidebar-brand-text mx-3">RAF BOT<sup>WIFI</sup></div>
    </a>

    <hr class="sidebar-divider my-0">

    <!-- Heading - Penagihan -->
    <div class="sidebar-heading">
        Penagihan
    </div>

    <!-- Nav Item - Penagihan Pembayaran -->
    <li class="nav-item <?php echo ($current_page == '/agen-pembayaran.php' || $current_page == '/agen-pembayaran') ? 'active' : ''; ?>">
        <a class="nav-link" href="/agen-pembayaran">
            <i class="fas fa-fw fa-money-bill-wave"></i>
            <span>Penagihan Pembayaran</span>
        </a>
    </li>

    <!-- Nav Item - Panduan -->
    <li class="nav-item <?php echo ($current_page == '/agen-tutorial.php' || $current_page == '/agen-tutorial') ? 'active' : ''; ?>">
        <a class="nav-link" href="/agen-tutorial">
            <i class="fas fa-fw fa-book-open"></i>
            <span>Panduan</span>
        </a>
    </li>

    <hr class="sidebar-divider d-none d-md-block">

    <!-- Sidebar Toggler (Sidebar) -->
    <div class="text-center d-none d-md-inline">
        <button class="rounded-circle border-0" id="sidebarToggle"></button>
    </div>
</ul>
<script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/sidebar.js') : '/js/sidebar.js'; ?>"></script>
