<?php
/**
 * Header Doc
 * Purpose: Halaman TEKNISI "Log Gangguan OLT" — wrapper tipis (head + navbar + topbar peran
 *          teknisi) yang meng-include konten BERSAMA `_olt-log-content.php` (sama dgn admin).
 * Caller: `routes/pages.js` path `/teknisi-olt-log`.
 * Deps: `_head.php`, `_role_aware_navbar.php`, `_role_aware_teknisi_topbar.php`, `_olt-log-content.php`.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Log Gangguan OLT';
    $themeRole = 'teknisi';
    $pageDescription = 'Riwayat kejadian OLT (LOS/Dying-Gasp/pulih) berikut pelanggan & durasi';
    include __DIR__ . '/_head.php';
    ?>
</head>
<body id="page-top">
  <div id="wrapper">
    <?php include '_role_aware_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include '_role_aware_teknisi_topbar.php'; ?>
        <div class="container-fluid">
          <?php include '_olt-log-content.php'; ?>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
