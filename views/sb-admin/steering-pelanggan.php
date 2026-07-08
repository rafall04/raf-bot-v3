<?php
/**
 * Header Doc
 * Purpose: Halaman ADMIN "Steering Pelanggan" — daftar live pelanggan online + jalur ISP yang
 *          sedang dipakai (intended/actual dari address-list & route router), aksi arahkan
 *          per-pelanggan (GMDP/IH/MNI/SF/default), kelola entri pool (freedns/lokaldns), dan
 *          pemasangan rule override RAF-CUSTSTEER (sekali, idempoten).
 * Caller: `routes/pages.js` path `/steering-pelanggan`.
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/customer-steering/*`,
 *       `static/js/steering-pelanggan.js`, bundle sb-admin footer.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Steering Pelanggan';
    $themeRole = 'admin';
    $pageDescription = 'Pelanggan terkoneksi via ISP mana (live) + arahkan per-pelanggan/pool';
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
              <h1 class="h3 mb-1 text-gray-800">Steering Pelanggan</h1>
              <p class="mb-0 text-muted small">Jalur ISP per pelanggan dibaca LIVE dari address-list + route router — bukan tebakan config. Steering per-pelanggan memakai list override <code>RAF-STEER-*</code> (prioritas teratas, otomatis ikut saat IP berganti).</p>
            </div>
            <button id="btn-steer-refresh" class="btn btn-sm btn-outline-secondary shadow-sm"><i class="fas fa-sync fa-sm"></i></button>
          </div>

          <div id="steer-alert" class="alert d-none"></div>
          <div id="steer-setup-banner" class="alert alert-warning d-none">
            Rule override <b>RAF-CUSTSTEER</b> belum lengkap di router — steering per-pelanggan belum berfungsi.
            <button id="btn-steer-setup" class="btn btn-sm btn-warning ml-2">Pasang sekarang (aman, tidak mengubah trafik)</button>
          </div>

          <div id="steer-counts" class="mb-3"></div>

          <div class="card shadow mb-4">
            <div class="card-header py-2 d-flex justify-content-between align-items-center flex-wrap">
              <h6 class="m-0 font-weight-bold text-primary">👥 Pelanggan Online × Jalur ISP</h6>
              <input id="steer-search" class="form-control form-control-sm" style="max-width:240px" placeholder="Cari nama / PPPoE / IP…">
            </div>
            <div class="card-body p-0">
              <div class="table-responsive">
                <table class="table table-sm table-hover mb-0" style="font-size:.85rem">
                  <thead><tr>
                    <th>Pelanggan</th><th>Paket</th><th>IP</th>
                    <th>Jalur sekarang</th><th>Sumber</th><th style="min-width:190px">Arahkan</th>
                  </tr></thead>
                  <tbody id="steer-customers"><tr><td colspan="6" class="text-muted small p-3">Memuat…</td></tr></tbody>
                </table>
              </div>
            </div>
          </div>

          <div class="row">
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2"><h6 class="m-0 font-weight-bold text-primary">📌 Steering aktif (per-pelanggan)</h6></div>
                <div class="card-body p-2" id="steer-intents"><div class="small text-muted">Memuat…</div></div>
              </div>
            </div>
            <div class="col-lg-6 mb-4">
              <div class="card shadow">
                <div class="card-header py-2">
                  <h6 class="m-0 font-weight-bold text-primary">🗂️ Entri Pool (freedns / lokaldns)</h6>
                </div>
                <div class="card-body p-2">
                  <div class="alert alert-warning py-1 px-2 small mb-2">
                    ⚠️ Entri di sini menggeser <b>SATU POOL PENUH</b> (semua pelanggan pada subnet itu) —
                    ini mekanisme yang biasa Anda lakukan manual di Winbox. freedns = arah MNI (WA/game→IH), lokaldns = arah GMDP.
                  </div>
                  <div id="steer-pools"><div class="small text-muted">Memuat…</div></div>
                </div>
              </div>
            </div>
          </div>

          <p class="text-muted small mb-4" id="steer-meta"></p>

        </div>
      </div>
    </div>
  </div>

  <!-- Bundle chrome sb-admin (WAJIB): toggle sidebar/dropdown/modal ada di sb-admin-2.js. -->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/steering-pelanggan.js') : '/js/steering-pelanggan.js'; ?>"></script>
</body>
</html>
