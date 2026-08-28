<?php
/**
 * Header Doc
 * Purpose: Halaman admin untuk konfigurasi rule, scan manual, dry-run, dan broadcast auto outage berbasis PPPoE MikroTik.
 * Caller: `routes/pages.js` pada path `/auto-outage`.
 * Deps: `_navbar.php`, `topbar.php`, API `/api/admin/auto-outage/*`, Bootstrap, jQuery, SweetAlert2.
 * MainFuncs: Render form rule, tombol scan/dry-run/broadcast, tabel state offline, dan scan logs.
 * SideEffects: Memanggil API admin untuk menyimpan rule, membaca state, menjalankan scan, dan memulai broadcast WhatsApp.
 */
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php
    $pageTitle = 'RAF BOT - Auto Outage';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Auto Outage';
    include __DIR__ . '/_head.php';
    ?>

  <link href="<?= rafAssetUrl('/css/auto-outage.css') ?>" rel="stylesheet">

</head>
<body id="page-top">
  <div id="wrapper">
    <?php include '_navbar.php'; ?>
    <div id="content-wrapper" class="d-flex flex-column">
      <div id="content">
        <?php include 'topbar.php'; ?>
        <div class="container-fluid">
          <div class="dashboard-header">
            <div class="d-flex align-items-center justify-content-between flex-wrap">
              <div>
                <h1>Auto Outage Broadcast</h1>
                <p>Deteksi pelanggan offline dari PPPoE MikroTik, validasi ke database pelanggan, lalu broadcast interaktif.</p>
              </div>
              <div class="d-flex flex-wrap" style="gap:.5rem;">
                <button id="btnScan" class="btn btn-primary-custom"><i class="fas fa-sync"></i> Scan PPPoE</button>
                <button id="btnRefresh" class="btn btn-light"><i class="fas fa-list"></i> Refresh</button>
              </div>
            </div>
          </div>

          <div class="row mb-4">
            <div class="col-md-3 mb-3"><div class="ao-metric"><span>Offline</span><strong id="metricOffline">0</strong><small>state pelanggan DB</small></div></div>
            <div class="col-md-3 mb-3"><div class="ao-metric"><span>Eligible</span><strong id="metricEligible">0</strong><small>sesuai rule aktif</small></div></div>
            <div class="col-md-3 mb-3"><div class="ao-metric"><span>Online</span><strong id="metricOnline">0</strong><small>kembali aktif</small></div></div>
            <div class="col-md-3 mb-3"><div class="ao-metric"><span>Ignored PPP</span><strong id="metricIgnored">0</strong><small>tidak ada di DB</small></div></div>
          </div>

          <div class="ao-grid">
            <div class="ao-card">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Rule Deteksi dan Broadcast</h6></div>
              <div class="card-body">
                <form id="ruleForm">
                  <input type="hidden" id="ruleId" name="id">
                  <div class="form-row">
                    <div class="form-group col-md-8">
                      <label>Nama Rule</label>
                      <input class="form-control" name="name" value="Auto Outage Utama" required>
                    </div>
                    <div class="form-group col-md-4">
                      <label>Status</label>
                      <select class="form-control" name="enabled"><option value="true">Aktif</option><option value="false">Nonaktif</option></select>
                    </div>
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-4"><label>Router ID</label><input class="form-control" name="router_id" value="default"></div>
                    <div class="form-group col-md-4"><label>Offline Minimal (jam)</label><input type="number" min="1" class="form-control" name="offline_threshold_hours" value="3"></div>
                    <div class="form-group col-md-4"><label>Scan Interval (menit)</label><input type="number" min="5" class="form-control" name="scan_interval_minutes" value="30"></div>
                  </div>
                  <div class="form-row">
                    <div class="form-group col-md-4"><label>Cooldown Broadcast (menit)</label><input type="number" min="5" class="form-control" name="broadcast_cooldown_minutes" value="720"></div>
                    <div class="form-group col-md-4"><label>Maks Broadcast / Insiden</label><input type="number" min="1" class="form-control" name="max_broadcast_per_incident" value="1"></div>
                    <div class="form-group col-md-4">
                      <label>Target</label>
                      <select class="form-control" name="target_scope" id="targetScope">
                        <option value="all">Semua pelanggan DB</option>
                        <option value="area">Per Area</option>
                        <option value="odp">Per ODP</option>
                        <option value="profile">Per Profile</option>
                        <option value="router">Per Router</option>
                        <option value="custom">Custom JSON</option>
                      </select>
                    </div>
                  </div>
                  <div class="form-group">
                    <label>Filter Target JSON</label>
                    <textarea class="form-control" name="target_filter_json" rows="3" placeholder='{"area":"Area A"}'>{}</textarea>
                    <small class="text-muted">Contoh area: {"area":"Area A"}, ODP: {"odp":"ODP-01"}, profile: {"profile":"10M"}.</small>
                  </div>
                  <div class="form-group">
                    <label>Pesan Awal Custom</label>
                    <textarea class="form-control" name="template_initial" rows="4">Halo ${nama}, sistem kami mendeteksi koneksi PPPoE ${pppoe_username} tidak aktif sejak ${offline_since}. Apakah ada kendala pada WiFi-nya? Balas 1/AMAN jika aman, atau 2/ADA KENDALA jika butuh bantuan.</textarea>
                  </div>
                  <div class="form-group">
                    <label>Opsi Jawaban JSON</label>
                    <textarea class="form-control" name="options_json" rows="3">[{"key":"1","label":"Aman"},{"key":"2","label":"Ada kendala"},{"key":"lainnya","label":"Tulis keluhan bebas"}]</textarea>
                  </div>
                  <div class="d-flex flex-wrap" style="gap:.5rem;">
                    <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Simpan Rule</button>
                    <button type="button" id="btnDryRun" class="btn btn-info"><i class="fas fa-vial"></i> Dry Run</button>
                    <button type="button" id="btnBroadcast" class="btn btn-warning"><i class="fas fa-paper-plane"></i> Broadcast Eligible</button>
                  </div>
                </form>
              </div>
            </div>

            <div class="ao-card">
              <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Ringkasan Rule dan Scan</h6></div>
              <div class="card-body">
                <div id="rulesList" class="mb-3"><span class="text-muted">Memuat rule...</span></div>
                <pre id="lastResult" class="bg-light p-3 rounded" style="min-height:240px; max-height:420px; overflow:auto;">Belum ada proses.</pre>
              </div>
            </div>
          </div>

          <div class="ao-card mt-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">State Pelanggan</h6></div>
            <div class="card-body table-responsive">
              <table class="table table-bordered ao-table tabel-tumpuk-hp" id="statesTable">
                <thead><tr><th>Status</th><th>User ID</th><th>PPPoE</th><th>Router</th><th>Offline Since</th><th>Last Logout</th><th>Broadcast</th><th>Reason</th></tr></thead>
                <tbody></tbody>
              </table>
            </div>
          </div>

          <div class="ao-card mt-4 mb-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Scan Logs</h6></div>
            <div class="card-body table-responsive">
              <table class="table table-bordered ao-table" id="logsTable">
                <thead><tr><th>Started</th><th>Router</th><th>DB Users</th><th>PPP Active</th><th>Offline</th><th>Skipped</th><th>Error</th></tr></thead>
                <tbody></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
  <script src="<?= rafAssetUrl('/js/auto-outage.js') ?>"></script>

</body>
</html>
