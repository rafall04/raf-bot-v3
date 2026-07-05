<?php
/**
 * Header Doc
 * Purpose: Halaman ADMIN "Log Gangguan OLT" — wrapper tipis (head admin + navbar + topbar) yang
 *          meng-include konten BERSAMA `_olt-log-content.php` (dipakai juga oleh halaman teknisi).
 * Caller: `routes/pages.js` path `/olt-log`.
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, `_olt-log-content.php`.
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
</body>
</html>
