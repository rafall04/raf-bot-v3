<?php
/**
 * Header Doc
 * Purpose: Halaman ADMIN "Kualitas Jalur Upstream" — kartu status per jalur (GMDP/IH/MNI/SF)
 *          + grafik loss & RTT dari probe policy-routed router gateway, auto-refresh.
 * Caller: `routes/pages.js` path `/upstream-quality`.
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/upstream-quality/*`,
 *       `vendor/chart.js/Chart.min.js`, `static/js/upstream-quality.js`, bundle sb-admin footer.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Kualitas Jalur Upstream';
    $themeRole = 'admin';
    $pageDescription = 'Monitor loss/RTT per jalur upstream (GMDP/IH/MNI/SF) + deteksi failover';
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
              <h1 class="h3 mb-1 text-gray-800">Kualitas Jalur Upstream</h1>
              <p class="mb-0 text-muted small">Probe policy-routed dari router gateway per jalur — jawaban "lemot dari sisi mana". Auto-refresh tiap 60 detik.</p>
            </div>
            <div>
              <button id="btn-poll-now" class="btn btn-sm btn-primary shadow-sm mr-1">
                <i class="fas fa-bolt fa-sm mr-1"></i>Probe Sekarang
              </button>
              <button id="btn-refresh" class="btn btn-sm btn-outline-secondary shadow-sm">
                <i class="fas fa-sync fa-sm"></i>
              </button>
            </div>
          </div>

          <div id="upq-alert-failover" class="alert alert-warning d-none"></div>
          <div id="upq-cards" class="row"></div>

          <div id="upq-switch-section" class="card shadow mb-4 d-none">
            <div class="card-header py-2 d-flex justify-content-between align-items-center">
              <h6 class="m-0 font-weight-bold text-primary">🔀 Switch Koneksi (alihkan jalur antar-ISP)</h6>
              <span class="small text-muted">khusus admin/owner · perubahan langsung ke router</span>
            </div>
            <div class="card-body p-2" id="upq-switch-list">
              <div class="small text-muted">Memuat…</div>
            </div>
          </div>

          <div class="row">
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Packet Loss (%) — 6 jam terakhir</h6></div>
                <div class="card-body" style="height:320px"><canvas id="chart-loss"></canvas></div>
              </div>
            </div>
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">RTT rata-rata (ms) — 6 jam terakhir</h6></div>
                <div class="card-body" style="height:320px"><canvas id="chart-rtt"></canvas></div>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-12 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Throughput per WAN (Mbps, rata-rata per menit) — 6 jam terakhir</h6></div>
                <div class="card-body" style="height:280px"><canvas id="chart-wan"></canvas></div>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2 d-flex justify-content-between align-items-center">
                  <h6 class="m-0 font-weight-bold text-primary">Rapor ISP — 7 hari</h6>
                  <span class="small text-muted">availability = % probe non-putus</span>
                </div>
                <div class="card-body p-2">
                  <div class="table-responsive">
                    <table class="table table-sm mb-0">
                      <thead><tr><th>ISP/Jalur</th><th>Avail</th><th>Loss</th><th>RTT</th><th>Sakit</th><th>Flap</th></tr></thead>
                      <tbody id="upq-report"><tr><td colspan="6" class="text-muted">Memuat…</td></tr></tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">Insiden Terakhir (alert / flap / traceroute bukti)</h6></div>
                <div class="card-body p-2" id="upq-incidents" style="max-height:300px;overflow-y:auto">
                  <div class="small text-muted">Memuat…</div>
                </div>
              </div>
            </div>
          </div>

          <p class="text-muted small mb-4" id="upq-meta"></p>

        </div>
      </div>
    </div>
  </div>

  <!-- Bundle chrome sb-admin (WAJIB): toggle sidebar/dropdown/modal ada di sb-admin-2.js. -->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="/vendor/chart.js/Chart.min.js"></script>
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/upstream-quality.js') : '/js/upstream-quality.js'; ?>"></script>
</body>
</html>
