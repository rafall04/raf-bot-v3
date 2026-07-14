<?php
/**
 * Header Doc
 * Purpose: Halaman "Owner Cockpit" — beranda ringkasan sekali-baca untuk owner: kartu Pemasukan,
 *          Status ISP, PSB (belum kepasang), Tiket aktif, dan Outage OLT, tiap kartu klik → panel detail.
 *          Data dari GET /api/owner/cockpit (lib/owner-cockpit-service). Auto-refresh 60 detik.
 * Caller: routes/pages.js path `/owner` (checkRole admin/owner/superadmin).
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/owner/cockpit`,
 *       `static/js/owner-cockpit.js`, bundle sb-admin footer.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Owner Cockpit';
    $themeRole = 'admin';
    $pageDescription = 'Ringkasan sekali-baca owner: pemasukan, status ISP, tiket, PSB, outage OLT';
    include __DIR__ . '/_head.php';
    ?>
    <link rel="stylesheet" href="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/css/owner-cockpit.css') : '/css/owner-cockpit.css'; ?>">
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
              <h1 class="h3 mb-1 text-gray-800">👑 Owner Cockpit</h1>
              <p class="mb-0 text-muted small">Ringkasan operasional sekali-baca — klik kartu untuk detail.</p>
            </div>
            <div class="text-sm-right mt-2 mt-sm-0">
              <button id="oc-refresh" class="btn btn-sm btn-outline-secondary shadow-sm"><i class="fas fa-sync fa-sm mr-1"></i>Segarkan</button>
              <div class="text-muted small mt-1" id="oc-meta">memuat…</div>
            </div>
          </div>

          <div id="oc-cards" class="oc-grid">
            <div class="oc-na">Memuat cockpit…</div>
          </div>

        </div>
      </div>
    </div>
  </div>

  <!-- Bundle chrome sb-admin (WAJIB): toggle sidebar/dropdown ada di sb-admin-2.js. -->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/owner-cockpit.js') : '/js/owner-cockpit.js'; ?>"></script>
</body>
</html>
