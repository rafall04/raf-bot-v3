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
              <button id="csat-run" class="btn btn-sm btn-success shadow-sm mr-1"><i class="fas fa-paper-plane fa-sm mr-1"></i>Kirim Survei Sekarang</button>
              <button id="csat-recover" class="btn btn-sm btn-outline-warning shadow-sm mr-1" title="Tangkap ulang balasan pelanggan yang sempat terlewat saat pengiriman berlangsung"><i class="fas fa-undo fa-sm mr-1"></i>Pulihkan Terlewat</button>
              <label class="small text-muted mb-0 mr-1 ml-1" for="csat-period">Periode</label>
              <select id="csat-period" class="form-control form-control-sm d-inline-block" style="width:auto"></select>
              <button id="csat-refresh" class="btn btn-sm btn-outline-secondary shadow-sm ml-1"><i class="fas fa-sync fa-sm"></i></button>
              <div class="text-muted small mt-1" id="csat-meta">memuat…</div>
            </div>
          </div>

          <div class="card shadow mb-3">
            <div class="card-header py-2" style="cursor:pointer" onclick="var b=document.getElementById('csat-settings-body'); if(b) b.classList.toggle('d-none');">
              <b>⚙️ Pengaturan Survei &amp; Anti-ban</b> <small class="text-muted">— klik untuk buka/tutup</small>
            </div>
            <div id="csat-settings-body" class="card-body d-none">
              <div class="row">
                <div class="col-md-6 mb-2">
                  <h6 class="text-muted small text-uppercase">Survei Kepuasan</h6>
                  <div class="custom-control custom-switch mb-2"><input type="checkbox" class="custom-control-input" id="set-csat-enabled"><label class="custom-control-label" for="set-csat-enabled">Fitur survei aktif</label></div>
                  <div class="custom-control custom-switch mb-2"><input type="checkbox" class="custom-control-input" id="set-csat-onlyPaid"><label class="custom-control-label" for="set-csat-onlyPaid">Hanya pelanggan sudah bayar</label></div>
                  <div class="custom-control custom-switch mb-2"><input type="checkbox" class="custom-control-input" id="set-csat-alert"><label class="custom-control-label" for="set-csat-alert">Alert detractor real-time ke owner</label></div>
                  <label class="small mb-0">Ambang detractor (skor ≤)</label>
                  <input type="number" min="1" max="5" class="form-control form-control-sm" id="set-csat-maxscore" style="width:90px">
                </div>
                <div class="col-md-6 mb-2">
                  <h6 class="text-muted small text-uppercase">Anti-ban Broadcast</h6>
                  <div class="custom-control custom-switch mb-2"><input type="checkbox" class="custom-control-input" id="set-bg-enabled"><label class="custom-control-label" for="set-bg-enabled">Guard anti-ban aktif</label></div>
                  <div class="custom-control custom-switch mb-2"><input type="checkbox" class="custom-control-input" id="set-bg-validate"><label class="custom-control-label" for="set-bg-validate">Validasi nomor onWhatsApp sebelum kirim</label></div>
                  <div class="form-row">
                    <div class="col"><label class="small mb-0">Jitter maks (ms)</label><input type="number" min="0" class="form-control form-control-sm" id="set-bg-jitter"></div>
                    <div class="col"><label class="small mb-0">Ukuran batch</label><input type="number" min="0" class="form-control form-control-sm" id="set-bg-batch"></div>
                  </div>
                  <div class="form-row mt-1">
                    <div class="col"><label class="small mb-0">Jeda batch (ms)</label><input type="number" min="0" class="form-control form-control-sm" id="set-bg-pause"></div>
                    <div class="col"><label class="small mb-0">Ambang breaker</label><input type="number" min="0" class="form-control form-control-sm" id="set-bg-breaker"></div>
                  </div>
                </div>
              </div>
              <button id="csat-settings-save" class="btn btn-sm btn-primary mt-2"><i class="fas fa-save fa-sm mr-1"></i>Simpan Setelan</button>
              <span id="csat-settings-msg" class="small ml-2"></span>
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
