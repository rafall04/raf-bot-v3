<?php
/**
 * Header Doc
 * Purpose: Halaman ADMIN "Log Gangguan OLT" — wrapper tipis (head admin + navbar + topbar) yang
 *          meng-include konten BERSAMA `_olt-log-content.php` (dipakai juga oleh halaman teknisi).
 * Caller: `routes/pages.js` path `/olt-log`.
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, `_olt-log-content.php`, bundle JS footer
 *       (jQuery + Bootstrap + sb-admin-2.js) — WAJIB agar toggle sidebar/dropdown/modal chrome jalan.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Log Gangguan OLT';
    $themeRole = 'admin';
    $pageDescription = 'Riwayat kejadian OLT (LOS/Dying-Gasp/pulih) berikut pelanggan & durasi';
    include __DIR__ . '/_head.php';
    ?>
</head>
<body id="page-top">
  <div id="wrapper">
    <?php include '_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>
        <div class="container-fluid">
          <?php $oltLogRole = 'admin'; include '_olt-log-content.php'; ?>
        </div>
      </div>
    </div>
  </div>

  <!-- Bundle chrome sb-admin (WAJIB): tanpa ini toggle sidebar (#sidebarToggleTop),
       dropdown user, & modal logout tidak berfungsi — handler-nya ada di sb-admin-2.js. -->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
</body>
</html>
