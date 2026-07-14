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

          <ul class="nav nav-tabs mb-0" role="tablist">
            <li class="nav-item">
              <a class="nav-link active" id="tab-gps" data-toggle="tab" href="#pane-gps" role="tab">
                <i class="fas fa-map-marker-alt fa-sm mr-1"></i>Ada GPS <span class="badge badge-warning ml-1" id="ro-count-gps">0</span>
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" id="tab-nogps" data-toggle="tab" href="#pane-nogps" role="tab">
                <i class="fas fa-question-circle fa-sm mr-1"></i>Tanpa GPS <span class="badge badge-secondary ml-1" id="ro-count-nogps">0</span>
              </a>
            </li>
          </ul>

          <div class="tab-content">
            <!-- Tab 1: punya titik → bot mengusulkan ODP terdekat -->
            <div class="tab-pane fade show active" id="pane-gps" role="tabpanel">
              <div class="card shadow mb-4" style="border-top-left-radius:0">
                <div class="card-header py-3 d-flex align-items-center justify-content-between">
                  <h6 class="m-0 font-weight-bold text-primary">Usulan dari jarak</h6>
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

            <!-- Tab 2: TAK punya titik → jarak tak bisa menolong; pilih ODP manual -->
            <div class="tab-pane fade" id="pane-nogps" role="tabpanel">
              <div class="card shadow mb-4" style="border-top-left-radius:0">
                <div class="card-header py-3">
                  <h6 class="m-0 font-weight-bold text-primary">Pelanggan tanpa titik GPS</h6>
                  <p class="mb-0 mt-1 small text-muted">
                    Tanpa koordinat, jarak tak bisa mengusulkan apa pun — pilih ODP-nya sendiri.
                    Atau minta teknisi kirim <code>#LOKASI &lt;nama&gt;</code> di WhatsApp saat di rumah pelanggan,
                    lalu titiknya masuk dan usulan otomatis jalan.
                  </p>
                </div>
                <div class="card-body">
                  <input type="text" id="ro-search" class="form-control form-control-sm mb-3"
                         placeholder="Cari nama atau nomor HP…">
                  <div class="table-responsive">
                    <table class="table table-bordered table-sm" width="100%" cellspacing="0">
                      <thead>
                        <tr>
                          <th>Pelanggan</th>
                          <th style="width:300px">Pilih ODP</th>
                          <th style="width:110px">Aksi</th>
                        </tr>
                      </thead>
                      <tbody id="ro-nogps-rows">
                        <tr><td colspan="3" class="text-center text-muted py-4">Memuat…</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
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
