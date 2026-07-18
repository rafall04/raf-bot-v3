<?php
/**
 * Header Doc
 * Purpose: Halaman "Survei Kepuasan" (CSAT) — rangkuman rating pelanggan untuk admin/owner: skor
 *          rata-rata, response rate, sebaran, detractor (skor <=2) + No HP + komentar, semua masukan,
 *          non-responder, dan tren per bulan. Data dari GET /api/owner/csat?period=YYYY-MM.
 * Caller: routes/pages.js path `/survei` (checkRole admin/owner/superadmin).
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/owner/csat`, `static/js/survei.js`,
 *       `static/css/survei.css`, bundle sb-admin footer.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Survei Kepuasan';
    $themeRole = 'admin';
    $pageDescription = 'Rangkuman survei kepuasan pelanggan: skor, detractor, komentar, tren';
    include __DIR__ . '/_head.php';
    ?>
    <link rel="stylesheet" href="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/css/survei.css') : '/css/survei.css'; ?>">
</head>
<body id="page-top">
  <div id="wrapper">
    <?php include '_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>
        <div class="container-fluid">

          <div class="d-sm-flex align-items-center justify-content-between mb-3">
            <div>
              <h1 class="h3 mb-1 text-gray-800">⭐ Survei Kepuasan Pelanggan</h1>
              <p class="mb-0 text-muted small">Rangkuman rating &amp; masukan pelanggan per bulan.</p>
            </div>
            <div class="text-sm-right mt-2 mt-sm-0">
              <label class="small text-muted mb-0 mr-1" for="csat-period">Periode</label>
              <select id="csat-period" class="form-control form-control-sm d-inline-block" style="width:auto"></select>
              <button id="csat-refresh" class="btn btn-sm btn-outline-secondary shadow-sm ml-1"><i class="fas fa-sync fa-sm"></i></button>
              <div class="text-muted small mt-1" id="csat-meta">memuat…</div>
            </div>
          </div>

          <div id="csat-summary" class="csat-tiles mb-3">
            <div class="csat-na">Memuat rangkuman…</div>
          </div>

          <div id="csat-content"></div>

        </div>
      </div>
    </div>
  </div>

  <!-- Bundle chrome sb-admin (WAJIB): toggle sidebar/dropdown ada di sb-admin-2.js. -->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/survei.js') : '/js/survei.js'; ?>"></script>
</body>
</html>
