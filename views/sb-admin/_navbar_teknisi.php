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
        if (localStorage.getItem('tkTheme') === 'dark') {
            document.body.classList.add('tk-dark');
        }
    } catch (e) {}
})();
</script>
<style>
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

#accordionSidebar .collapse-inner .collapse-item {
    display: flex !important;
    align-items: center;
    gap: 0.6rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

#accordionSidebar .collapse-inner .collapse-item i {
    flex-shrink: 0;
}

#accordionSidebar .collapse-inner .collapse-item span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
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
    }

    #accordionSidebar .nav-item {
        margin-bottom: 0.18rem;
    }

    #accordionSidebar .nav-item .nav-link span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    #accordionSidebar .sidebar-heading {
        font-size: 0.68rem;
        padding: 0.6rem 1rem 0.3rem;
        margin-top: 0.4rem;
    }

    /* Force submenus to render INLINE inside the drawer on mobile.
       SB Admin 2 turns .sidebar.toggled submenus into absolute pop-outs, which
       on mobile shoot out past the drawer edge (visual bug). Neutralise that. */
    #accordionSidebar .nav-item .collapse,
    #accordionSidebar .nav-item .collapsing {
        position: static !important;
        float: none !important;
        top: auto !important;
        left: auto !important;
        margin: 0 !important;
        min-width: 0 !important;
        width: auto !important;
        box-shadow: none !important;
        background: transparent !important;
    }

    #accordionSidebar .collapse-inner {
        margin: 0.15rem 0.55rem 0.35rem;
        padding: 0.35rem 0.3rem;
    }

    #accordionSidebar .collapse-inner .collapse-item {
        min-height: 2.5rem;
        border-radius: 0.75rem;
        padding: 0.55rem 0.85rem;
    }

    body.sidebar-toggled::before {
        content: '';
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.28);
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

    <!-- Nav Item - Monitoring Pembayaran -->
    <li class="nav-item <?php echo ($current_page == '/teknisi-pembayaran.php' || $current_page == '/teknisi-pembayaran') ? 'active' : ''; ?>">
        <a class="nav-link" href="/teknisi-pembayaran">
            <i class="fas fa-fw fa-money-check-alt"></i>
            <span>Monitoring Pembayaran</span>
        </a>
    </li>

    <!-- Nav Item - Pasang Baru (PSB) -->
    <li class="nav-item <?php echo (strpos($current_page, '/teknisi-psb') !== false) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePSB" aria-expanded="<?php echo (strpos($current_page, '/teknisi-psb') !== false) ? 'true' : 'false'; ?>" aria-controls="collapsePSB">
            <i class="fas fa-fw fa-user-plus"></i>
            <span>Pasang Baru (PSB)</span>
        </a>
        <div id="collapsePSB" class="collapse <?php echo (strpos($current_page, '/teknisi-psb') !== false) ? 'show' : ''; ?>" aria-labelledby="headingPSB" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item <?php echo ($current_page == '/teknisi-psb') ? 'active' : ''; ?>" href="/teknisi-psb">
                    <i class="fas fa-fw fa-user-plus"></i> Daftar Pelanggan
                </a>
                <a class="collapse-item <?php echo ($current_page == '/teknisi-psb-installation') ? 'active' : ''; ?>" href="/teknisi-psb-installation">
                    <i class="fas fa-fw fa-tools"></i> Proses Instalasi
                </a>
                <a class="collapse-item <?php echo ($current_page == '/teknisi-psb-setup') ? 'active' : ''; ?>" href="/teknisi-psb-setup">
                    <i class="fas fa-fw fa-wifi"></i> Setup Pelanggan
                </a>
            </div>
        </div>
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
<script>
document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.getElementById('accordionSidebar');
    if (!sidebar) {
        return;
    }

    const closeMobileDrawerAndCollapse = function () {
        if (window.innerWidth > 767.98) {
            return;
        }
        document.body.classList.remove('sidebar-toggled');
        sidebar.classList.add('toggled');
    };

    const closeButton = document.getElementById('mobileSidebarClose');
    if (closeButton) {
        closeButton.addEventListener('click', closeMobileDrawerAndCollapse);
    }

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

        closeMobileDrawerAndCollapse();
    });

    sidebar.querySelectorAll('.collapse-item[href], .nav-link[href]:not([data-toggle="collapse"])').forEach(function (link) {
        link.addEventListener('click', function () {
            closeMobileDrawerAndCollapse();
        });
    });

    window.addEventListener('resize', handleResize);
    handleResize();
});
</script>
