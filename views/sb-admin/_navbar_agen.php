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

.mobile-sidebar-head {
    display: none;
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
}
</style>
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
