<?php
$current_page = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '';
?>
<ul class="navbar-nav bg-gradient-primary sidebar sidebar-dark accordion" id="accordionSidebar">
    <!-- Sidebar - Brand -->
    <a class="sidebar-brand d-flex align-items-center justify-content-center" href="/">
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
        <a class="nav-link collapsed" href="#" data-toggle="collapse" data-target="#collapsePSB" aria-expanded="false" aria-controls="collapsePSB">
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
