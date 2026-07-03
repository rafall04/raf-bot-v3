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
<script>
// Apply saved dark/light theme ASAP (before paint) to avoid a flash.
(function () { try { var s = localStorage.getItem('tkTheme'); if (s === 'dark' || (!s && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) { document.body.classList.add('tk-dark'); } } catch (e) {} })();
</script>
<style>
/* ============================================================
   RAF BOT · ADMIN SIDEBAR — Modern indigo glow
   Inline so it loads on every admin page (no extra link needed).
   ============================================================ */

#accordionSidebar {
    overscroll-behavior: contain;
}

/* premium gradient overrides sb-admin-2 .bg-gradient-primary */
#accordionSidebar.sidebar {
    background: linear-gradient(180deg, #1e1b4b 0%, #312e81 35%, #4338ca 75%, #5b21b6 100%) !important;
    box-shadow: 0 0 40px rgba(15, 23, 42, 0.18);
    padding-bottom: 1.2rem;
}
/* `position: relative` lives on the bare ID (same specificity as the mobile
   @media rule below, which then wins via later source order with position:fixed). */
#accordionSidebar { position: relative; }
/* very faint dotted pattern for premium feel */
#accordionSidebar.sidebar::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image: radial-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px);
    background-size: 14px 14px;
    opacity: 0.6;
    z-index: 0;
}
#accordionSidebar.sidebar > * { position: relative; z-index: 1; }

/* thin custom scrollbar */
#accordionSidebar.sidebar { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent; }
#accordionSidebar.sidebar::-webkit-scrollbar { width: 6px; }
#accordionSidebar.sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 999px; }
#accordionSidebar.sidebar::-webkit-scrollbar-track { background: transparent; }

/* ---------- Brand ---------- */
#accordionSidebar .sidebar-brand {
    padding: 1.35rem 1rem 1.15rem;
    gap: 0.7rem;
    letter-spacing: 0.01em;
    height: auto;
}
#accordionSidebar .sidebar-brand-icon {
    width: 2.6rem; height: 2.6rem;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.14);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
    display: inline-flex; align-items: center; justify-content: center;
    transform: none !important; /* kill .rotate-n-15 inherited from sb-admin-2 */
}
#accordionSidebar .sidebar-brand-icon i { font-size: 1.25rem; color: #fff; }
#accordionSidebar .sidebar-brand-text {
    display: flex; flex-direction: column; gap: 0.1rem;
    text-align: left; margin: 0 0 0 0.1rem !important;
}
#accordionSidebar .sidebar-brand-text .brand-name {
    font-weight: 800; font-size: 1rem; color: #fff; letter-spacing: 0.01em;
}
#accordionSidebar .sidebar-brand-text .brand-name sup { font-size: 0.55rem; opacity: 0.85; }
#accordionSidebar .sidebar-brand-text .brand-role {
    font-size: 0.62rem;
    color: rgba(255, 255, 255, 0.72);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
}

/* hide divider immediately after brand (we use spacing instead) */
#accordionSidebar > hr.sidebar-divider.my-0 { display: none; }
#accordionSidebar hr.sidebar-divider {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin: 0.4rem 1rem;
    opacity: 1;
}

/* ---------- Search ---------- */
#accordionSidebar .sidebar-search { list-style: none; padding: 0.1rem 0.85rem 0.55rem; }
#accordionSidebar .sidebar-search-wrap { position: relative; display: flex; align-items: center; }
#accordionSidebar .sidebar-search-icon {
    position: absolute; left: 0.7rem; top: 50%; transform: translateY(-50%);
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.78rem;
    pointer-events: none;
}
#accordionSidebar .sidebar-search-input {
    width: 100%;
    background: rgba(255, 255, 255, 0.09);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 999px;
    color: #fff;
    font-size: 0.82rem;
    padding: 0.46rem 2rem 0.46rem 2rem;
    line-height: 1.2;
    transition: background 0.15s ease, border-color 0.15s ease;
    -webkit-appearance: none;
}
#accordionSidebar .sidebar-search-input::placeholder { color: rgba(255, 255, 255, 0.55); }
#accordionSidebar .sidebar-search-input:focus {
    outline: none;
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.28);
}
#accordionSidebar .sidebar-search-input::-webkit-search-cancel-button,
#accordionSidebar .sidebar-search-input::-webkit-search-decoration { -webkit-appearance: none; display: none; }
#accordionSidebar .sidebar-search-clear {
    position: absolute; right: 0.4rem; top: 50%; transform: translateY(-50%);
    border: 0; background: transparent;
    color: rgba(255, 255, 255, 0.7);
    width: 1.5rem; height: 1.5rem; border-radius: 999px;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 0.72rem; cursor: pointer;
}
#accordionSidebar .sidebar-search-clear:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
#accordionSidebar .sidebar-search-empty {
    display: flex; align-items: center; gap: 0.45rem;
    padding: 0.6rem 0.5rem 0.2rem;
    font-size: 0.74rem;
    color: rgba(255, 255, 255, 0.6);
}
#accordionSidebar .sidebar-search-empty i { font-size: 0.85rem; opacity: 0.75; }

/* filtered-out items hidden via JS-added class */
#accordionSidebar .nav-item.is-filtered,
#accordionSidebar .collapse-item.is-filtered,
#accordionSidebar .sidebar-heading.is-filtered { display: none !important; }
body.sidebar-search-active #accordionSidebar > hr.sidebar-divider { display: none !important; }
/* keep submenus open during search to expose matches */
body.sidebar-search-active #accordionSidebar .nav-item .collapse { display: block !important; height: auto !important; }
body.sidebar-search-active #accordionSidebar .nav-item .collapse .collapse-inner { padding: 0.32rem; }

/* ---------- Section headings ---------- */
#accordionSidebar .sidebar-heading {
    color: rgba(255, 255, 255, 0.55);
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    padding: 0.45rem 1.2rem 0.25rem;
    text-transform: uppercase;
}

/* ---------- Nav items ---------- */
#accordionSidebar .nav-item { margin: 0.12rem 0.6rem; }
#accordionSidebar .nav-item .nav-link {
    color: rgba(255, 255, 255, 0.78);
    font-size: 0.84rem;
    font-weight: 500;
    border-radius: 12px;
    padding: 0.62rem 0.85rem;
    display: flex; align-items: center; gap: 0.7rem;
    min-height: 2.6rem;
    transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
    /* sb-admin-2 hard-codes `.sidebar .nav-link { width: 14rem }` (224px) which
       overflows the sidebar by ~18px because the parent .nav-item has 0.6rem
       horizontal margin. Force the link to size to its container instead. */
    width: auto !important;
    text-align: left;
}
#accordionSidebar .nav-item .nav-link i {
    width: 1.2rem;
    flex: 0 0 1.2rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.72);
    font-size: 0.95rem;
    margin: 0;
}
#accordionSidebar .nav-item .nav-link span {
    flex: 1 1 0; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: inherit;
}
/* chevron sits flush next to the span (no auto margin so the span actually grows) */
#accordionSidebar .nav-link[data-toggle="collapse"]::after {
    margin-left: 0.35rem !important;
}
#accordionSidebar .nav-item .nav-link:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    transform: translateX(2px);
}
#accordionSidebar .nav-item .nav-link:hover i { color: #fff; }

/* expanded parent (submenu open) */
#accordionSidebar .nav-item .nav-link[aria-expanded="true"] {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
}
#accordionSidebar .nav-item .nav-link[aria-expanded="true"] i { color: #fff; }

/* active item — pill with left indicator */
#accordionSidebar .nav-item.active > .nav-link {
    background: rgba(255, 255, 255, 0.18) !important;
    color: #fff !important;
    box-shadow: inset 3px 0 0 #fff;
}
#accordionSidebar .nav-item.active > .nav-link i { color: #fff !important; }

/* collapse arrow */
#accordionSidebar .nav-link[data-toggle="collapse"]::after {
    content: '\f078';
    font-family: 'Font Awesome 5 Free'; font-weight: 900;
    margin-left: auto;
    font-size: 0.62rem;
    opacity: 0.65;
    transition: transform 0.2s ease;
}
#accordionSidebar .nav-link[data-toggle="collapse"][aria-expanded="true"]::after {
    transform: rotate(180deg);
    opacity: 1;
}

/* ---------- Submenu ---------- */
#accordionSidebar .collapse-inner,
#accordionSidebar .collapsing .collapse-inner {
    background: rgba(0, 0, 0, 0.20) !important;
    border-radius: 14px;
    margin: 0.18rem 0.6rem 0.3rem;
    padding: 0.32rem;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}
#accordionSidebar .collapse-inner .collapse-item {
    display: flex !important;
    align-items: center;
    color: rgba(255, 255, 255, 0.75) !important;
    background: transparent !important;
    font-size: 0.78rem;
    font-weight: 500;
    border-radius: 10px;
    padding: 0.46rem 0.7rem 0.46rem 1.55rem;
    min-height: 2.1rem;
    margin: 0.06rem 0;
    position: relative;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
#accordionSidebar .collapse-inner .collapse-item::before {
    content: '';
    position: absolute; left: 0.85rem; top: 50%;
    width: 4px; height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.35);
    transform: translateY(-50%);
    transition: background 0.18s ease;
}
#accordionSidebar .collapse-inner .collapse-item span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: inherit;
}
#accordionSidebar .collapse-inner .collapse-item i {
    width: 1rem; flex: 0 0 1rem; flex-shrink: 0;
    font-size: 0.78rem;
    color: rgba(255, 255, 255, 0.6) !important;
    margin-right: 0.45rem !important;
    text-align: center;
}
#accordionSidebar .collapse-inner .collapse-item:hover {
    background: rgba(255, 255, 255, 0.1) !important;
    color: #fff !important;
}
#accordionSidebar .collapse-inner .collapse-item:hover::before { background: #fff; }
#accordionSidebar .collapse-inner .collapse-item:hover i { color: #fff !important; }
#accordionSidebar .collapse-inner .collapse-item.active {
    background: #fff !important;
    color: #4338ca !important;
    font-weight: 600;
}
#accordionSidebar .collapse-inner .collapse-item.active::before { background: #4338ca; }
#accordionSidebar .collapse-inner .collapse-item.active i { color: #4338ca !important; }

/* sidebar toggler footer */
#accordionSidebar #sidebarToggle {
    background: rgba(255, 255, 255, 0.16);
}
#accordionSidebar #sidebarToggle::before { color: rgba(255, 255, 255, 0.85); }

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

    /* Submenu on mobile keeps the desktop dark/glass treatment for consistency. */
    #accordionSidebar .nav-item .collapse .collapse-inner,
    #accordionSidebar .nav-item .collapsing .collapse-inner {
        padding: 0.35rem;
    }
    #accordionSidebar .collapse-inner .collapse-item {
        padding: 0.58rem 0.72rem 0.58rem 1.55rem;
        min-height: 2.45rem;
        font-size: 0.8rem;
    }

    /* On mobile, the .mobile-sidebar-head already shows branding —
       hide the regular .sidebar-brand to avoid duplication & wasted space. */
    #accordionSidebar .sidebar-brand { display: none !important; }
    /* show the role badge inside mobile head instead */
    #accordionSidebar .mobile-sidebar-head .mobile-sidebar-title strong { white-space: nowrap; }

    /* Tighter nav-link on mobile so longer labels like
       "Agent & Reseller", "Voucher Hotspot" don't get clipped. */
    #accordionSidebar.toggled .nav-item .nav-link,
    body.sidebar-toggled #accordionSidebar .nav-item .nav-link {
        padding: 0.7rem 0.7rem;
        gap: 0.55rem;
    }
    #accordionSidebar.toggled .nav-item .nav-link i,
    body.sidebar-toggled #accordionSidebar .nav-item .nav-link i {
        width: 1rem; flex: 0 0 1rem; font-size: 0.88rem;
    }
    #accordionSidebar.toggled .nav-item .nav-link[data-toggle="collapse"]::after,
    body.sidebar-toggled #accordionSidebar .nav-item .nav-link[data-toggle="collapse"]::after {
        font-size: 0.56rem;
        margin-left: 0.3rem;
    }
    #accordionSidebar.toggled .nav-item,
    body.sidebar-toggled #accordionSidebar .nav-item {
        margin: 0.1rem 0.5rem;
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

    <hr class="sidebar-divider">

    <li class="nav-item <?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/custom-isolir', '/sync-device-id', '/penyesuaian-bulk', '/rubah-paket'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePelanggan" aria-expanded="<?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/custom-isolir', '/sync-device-id', '/penyesuaian-bulk', '/rubah-paket'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapsePelanggan">
            <i class="fas fa-fw fa-users"></i>
            <span>Pelanggan</span>
        </a>
        <div id="collapsePelanggan" class="collapse <?php echo isParentActive(['/users', '/packages', '/package-requests', '/import-mikrotik', '/buka-isolir', '/custom-isolir', '/sync-device-id', '/penyesuaian-bulk', '/rubah-paket'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingPelanggan" data-parent="#accordionSidebar">
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
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/penyesuaian-bulk', $current_page) ? 'active' : ''; ?>" href="/penyesuaian-bulk">
                    <i class="fas fa-fw fa-wifi mr-2"></i>
                    <span>Penyesuaian Bulk SSID</span>
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

    <li class="nav-item <?php echo isParentActive(['/payment-status', '/rekap-tunggakan', '/broadcast-tagihan', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi', '/penugasan-agen', '/laporan-agen', '/pengeluaran'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePembayaran" aria-expanded="<?php echo isParentActive(['/payment-status', '/rekap-tunggakan', '/broadcast-tagihan', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi', '/penugasan-agen', '/laporan-agen', '/pengeluaran'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapsePembayaran">
            <i class="fas fa-fw fa-money-bill-wave"></i>
            <span>Pembayaran</span>
        </a>
        <div id="collapsePembayaran" class="collapse <?php echo isParentActive(['/payment-status', '/rekap-tunggakan', '/broadcast-tagihan', '/saldo-management', '/transaction', '/payment-method', '/invoice-settings', '/pembayaran/otorisasi', '/admin-kasbon', '/admin-diskon', '/rekap-keuangan', '/gaji-teknisi', '/penugasan-agen', '/laporan-agen'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingPembayaran" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/payment-status', $current_page) ? 'active' : ''; ?>" href="/payment-status">
                    <i class="fas fa-fw fa-money-check-alt mr-2"></i>
                    <span>Status Pembayaran</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/rekap-tunggakan', $current_page) ? 'active' : ''; ?>" href="/rekap-tunggakan">
                    <i class="fas fa-fw fa-file-invoice-dollar mr-2"></i>
                    <span>Rekap Tunggakan</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/broadcast-tagihan', $current_page) ? 'active' : ''; ?>" href="/broadcast-tagihan">
                    <i class="fas fa-fw fa-paper-plane mr-2"></i>
                    <span>Broadcast Tagihan</span>
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
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/penugasan-agen', $current_page) ? 'active' : ''; ?>" href="/penugasan-agen">
                    <i class="fas fa-fw fa-user-tag mr-2"></i>
                    <span>Penugasan Agen</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/laporan-agen', $current_page) ? 'active' : ''; ?>" href="/laporan-agen">
                    <i class="fas fa-fw fa-hand-holding-usd mr-2"></i>
                    <span>Laporan Komisi Agen</span>
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

    <li class="nav-item <?php echo isParentActive(['/voucher', '/voucher-send', '/voucher-print'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseVoucher" aria-expanded="<?php echo isParentActive(['/voucher', '/voucher-send', '/voucher-print'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseVoucher">
            <i class="fas fa-fw fa-ticket-alt"></i>
            <span>Voucher Hotspot</span>
        </a>
        <div id="collapseVoucher" class="collapse <?php echo isParentActive(['/voucher', '/voucher-send', '/voucher-print'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingVoucher" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/voucher', $current_page) ? 'active' : ''; ?>" href="/voucher">
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

    <li class="nav-item <?php echo isParentActive(['/map-viewer', '/network-assets', '/statik', '/admin-olt', '/admin-olt-provision', '/cctv-monitor', '/infra-monitor'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseJaringan" aria-expanded="<?php echo isParentActive(['/map-viewer', '/network-assets', '/statik', '/admin-olt', '/admin-olt-provision', '/cctv-monitor', '/infra-monitor'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseJaringan">
            <i class="fas fa-fw fa-network-wired"></i>
            <span>Jaringan</span>
        </a>
        <div id="collapseJaringan" class="collapse <?php echo isParentActive(['/map-viewer', '/network-assets', '/statik', '/admin-olt', '/admin-olt-provision', '/infra-monitor'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingJaringan" data-parent="#accordionSidebar">
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
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/admin-olt', $current_page) ? 'active' : ''; ?>" href="/admin-olt">
                    <i class="fas fa-fw fa-broadcast-tower mr-2"></i>
                    <span>Monitor OLT</span>
                </a>
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/admin-olt-provision', $current_page) ? 'active' : ''; ?>" href="/admin-olt-provision">
                    <i class="fas fa-fw fa-plug mr-2"></i>
                    <span>Provisioning OLT</span>
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

    <li class="nav-item <?php echo isParentActive(['/broadcast', '/auto-outage', '/los-broadcast', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseKomunikasi" aria-expanded="<?php echo isParentActive(['/broadcast', '/auto-outage', '/los-broadcast', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseKomunikasi">
            <i class="fas fa-fw fa-comments"></i>
            <span>Komunikasi</span>
        </a>
        <div id="collapseKomunikasi" class="collapse <?php echo isParentActive(['/broadcast', '/auto-outage', '/los-broadcast', '/announcements', '/news', '/templates', '/wifi-templates'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingKomunikasi" data-parent="#accordionSidebar">
            <div class="bg-white py-2 collapse-inner rounded">
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/broadcast', $current_page) ? 'active' : ''; ?>" href="/broadcast">
                    <i class="fas fa-fw fa-bullhorn mr-2"></i>
                    <span>Broadcast WhatsApp</span>
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

    <li class="nav-item <?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs', '/telegram-teknisi'], $current_page) ? 'active' : ''; ?>">
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapseMonitoring" aria-expanded="<?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs', '/telegram-teknisi'], $current_page) ? 'true' : 'false'; ?>" aria-controls="collapseMonitoring">
            <i class="fas fa-fw fa-chart-line"></i>
            <span>Monitoring</span>
        </a>
        <div id="collapseMonitoring" class="collapse <?php echo isParentActive(['/wifi-logs', '/login-logs', '/activity-logs', '/telegram-teknisi'], $current_page) ? 'show' : ''; ?>" aria-labelledby="headingMonitoring" data-parent="#accordionSidebar">
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
                <a class="collapse-item d-flex align-items-center <?php echo isActive('/telegram-teknisi', $current_page) ? 'active' : ''; ?>" href="/telegram-teknisi">
                    <i class="fab fa-fw fa-telegram-plane mr-2"></i>
                    <span>Bot Teknisi (Telegram)</span>
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
            // Desktop: just clean up the mobile-drawer body class. Do NOT touch
            // sidebar.toggled here because the user may have manually collapsed it
            // (sb-admin-2's #sidebarToggle button toggles that class).
            document.body.classList.remove('sidebar-toggled');
        } else if (!document.body.classList.contains('sidebar-toggled')) {
            sidebar.classList.add('toggled');
        }
    };

    // One-time cleanup on initial load: sb-admin-2.js auto-adds `.toggled` at
    // <480px during render and never restores it on desktop. Wipe the stuck
    // state so a fresh desktop load always shows an expanded sidebar. (We don't
    // do this on resize events to preserve user manual collapse.)
    const cleanupInitialToggleStuck = function () {
        if (window.innerWidth > 767.98) {
            document.body.classList.remove('sidebar-toggled');
            sidebar.classList.remove('toggled');
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
    // Initial-load cleanup (separate from resize) — wins the race against
    // sb-admin-2.js which may add `.toggled` at <480px during early render.
    cleanupInitialToggleStuck();
    setTimeout(cleanupInitialToggleStuck, 50);
    setTimeout(cleanupInitialToggleStuck, 250);

    // -------------------------------------------------------------
    // Live menu search filter (>=50 menus on admin sidebar).
    // -------------------------------------------------------------
    const searchInput = document.getElementById('sidebarMenuSearch');
    const searchClear = document.getElementById('sidebarMenuSearchClear');
    const searchEmpty = document.getElementById('sidebarMenuSearchEmpty');
    if (searchInput) {
        // Open submenus during search so matches are visible immediately.
        const navItems = Array.from(sidebar.querySelectorAll('li.nav-item:not(.sidebar-search)'));
        const headings = Array.from(sidebar.querySelectorAll('.sidebar-heading'));

        function normalise(s) { return (s || '').toLowerCase().trim(); }

        function applyFilter(q) {
            q = normalise(q);
            const active = q.length > 0;
            document.body.classList.toggle('sidebar-search-active', active);
            searchClear.hidden = !active;

            // headings always hidden during search (we lift items into a flat list visually)
            headings.forEach(h => h.classList.toggle('is-filtered', active));

            let totalVisible = 0;
            navItems.forEach(item => {
                const link = item.querySelector(':scope > .nav-link');
                const linkText = normalise(link ? link.textContent : '');
                const childItems = Array.from(item.querySelectorAll('.collapse-item'));

                if (!active) {
                    item.classList.remove('is-filtered');
                    childItems.forEach(ci => ci.classList.remove('is-filtered'));
                    return;
                }

                const parentMatch = linkText.includes(q);
                let childMatchCount = 0;
                childItems.forEach(ci => {
                    const m = normalise(ci.textContent).includes(q);
                    ci.classList.toggle('is-filtered', !m && !parentMatch);
                    if (m || parentMatch) childMatchCount++;
                });

                const itemHasChildren = childItems.length > 0;
                const itemVisible = parentMatch || childMatchCount > 0;
                item.classList.toggle('is-filtered', !itemVisible);
                if (itemVisible) totalVisible++;
                // If parent itself matched, reveal all its children too
                if (itemVisible && parentMatch && itemHasChildren) {
                    childItems.forEach(ci => ci.classList.remove('is-filtered'));
                }
            });

            searchEmpty.hidden = !(active && totalVisible === 0);
        }

        let debounceId = null;
        searchInput.addEventListener('input', function () {
            const v = searchInput.value;
            clearTimeout(debounceId);
            debounceId = setTimeout(() => applyFilter(v), 60);
        });
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { searchInput.value = ''; applyFilter(''); searchInput.blur(); }
        });
        searchClear.addEventListener('click', function () {
            searchInput.value = ''; applyFilter(''); searchInput.focus();
        });
    }
});
</script>
