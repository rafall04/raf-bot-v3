<?php
/**
 * Header Doc
 * Purpose: Halaman "Rapikan ODP" — sambungkan pelanggan LAMA (yang sudah punya titik GPS) ke ODP.
 *          Bot MENGUSULKAN ODP terdekat yang masih bersisa port; admin yang MEMUTUSKAN (per baris atau
 *          borongan untuk yang sangat dekat). Jarak garis lurus = TEBAKAN, bukan kebenaran — kabel drop
 *          bisa saja ditarik ke ODP lain — jadi tak ada penetapan otomatis diam-diam.
 *          Data: GET /api/map/odp-tidy. Penetapan: POST /api/users/:id (validasi ODP + hitung port ikut jalan).
 * Caller: routes/pages.js path `/rapikan-odp` (checkRole admin/owner/superadmin).
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, `static/js/rapikan-odp.js`, bundle sb-admin footer.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Rapikan ODP';
    $themeRole = 'admin';
    $pageDescription = 'Sambungkan pelanggan ber-GPS ke ODP terdekat — bot mengusulkan, admin memutuskan';
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

          <div class="d-sm-flex align-items-center justify-content-between mb-3">
            <div>
              <h1 class="h3 mb-1 text-gray-800">🔗 Rapikan ODP</h1>
              <p class="mb-0 text-muted small">
                Bot mengusulkan ODP terdekat dari titik rumah pelanggan. <strong>Jarak itu tebakan</strong> —
                periksa dulu sebelum menyimpan.
              </p>
            </div>
            <div class="text-sm-right mt-2 mt-sm-0">
              <label class="small text-muted mb-1 d-block">Radius usulan</label>
              <select id="ro-radius" class="form-control form-control-sm d-inline-block" style="width:auto">
                <option value="150">150 m</option>
                <option value="250" selected>250 m</option>
                <option value="500">500 m</option>
                <option value="1000">1 km</option>
              </select>
              <button id="ro-refresh" class="btn btn-sm btn-outline-secondary shadow-sm ml-1">
                <i class="fas fa-sync fa-sm"></i>
              </button>
            </div>
          </div>

          <div id="ro-summary" class="row mb-3"></div>

          <div id="ro-alert"></div>

          <div class="card shadow mb-4">
            <div class="card-header py-3 d-flex align-items-center justify-content-between">
              <h6 class="m-0 font-weight-bold text-primary">Pelanggan belum tersambung ke ODP</h6>
              <button id="ro-bulk" class="btn btn-sm btn-success" disabled>
                <i class="fas fa-bolt fa-sm mr-1"></i>Terapkan semua yang &lt; 50 m
              </button>
            </div>
            <div class="card-body">
              <div class="table-responsive">
                <table class="table table-bordered table-sm" width="100%" cellspacing="0">
                  <thead>
                    <tr>
                      <th>Pelanggan</th>
                      <th style="width:110px">Jarak</th>
                      <th style="width:280px">Usulan ODP</th>
                      <th style="width:110px">Aksi</th>
                    </tr>
                  </thead>
                  <tbody id="ro-rows">
                    <tr><td colspan="4" class="text-center text-muted py-4">Memuat…</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
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
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/rapikan-odp.js') : '/js/rapikan-odp.js'; ?>"></script>
</body>
</html>
