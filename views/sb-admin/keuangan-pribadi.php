<?php
/**
 * Header Doc
 * Purpose: Halaman "Keuangan Pribadi" — dompet PRIBADI pemilik yang menumpang instance bot ini.
 *          Kartu ringkas (masuk/keluar/selisih), form catat cepat, rincian per kategori, dan
 *          daftar catatan periode. TIDAK menyisipkan data apa pun dari server: seluruh angka
 *          diambil via /api/keuangan-pribadi/* yang punya gate allowlist sendiri (berlapis,
 *          karena handler generik '/:type' di routes/pages.js merender halaman tanpa cek role).
 * Caller: routes/pages.js path `/keuangan-pribadi` (gate allowlist config.personalFinance.webUsers).
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/keuangan-pribadi/*`,
 *       `static/css/keuangan-pribadi.css`, `static/js/keuangan-pribadi.js`.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'RAF BOT - Keuangan Pribadi';
    $themeRole = 'admin';
    $pageDescription = 'Catatan keuangan pribadi: pemasukan, pengeluaran, dan rekap per kategori';
    include __DIR__ . '/_head.php';
    ?>
    <link rel="stylesheet" href="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/css/keuangan-pribadi.css') : '/css/keuangan-pribadi.css'; ?>">
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
              <h1 class="h3 mb-1 text-gray-800">💰 Keuangan Pribadi</h1>
              <p class="mb-0 text-muted small">Catatan pribadi — terpisah dari saldo pelanggan dan pembukuan ISP.</p>
            </div>
            <div class="kp-periode mt-2 mt-sm-0">
              <label for="kp-bulan" class="mb-0 mr-2 small text-muted">Periode</label>
              <input type="month" id="kp-bulan" class="form-control form-control-sm kp-input-bulan">
            </div>
          </div>

          <div id="kp-alert" class="kp-alert" hidden></div>

          <!-- Ringkasan periode -->
          <div class="kp-stats" id="kp-stats">
            <div class="kp-stat kp-stat--in">
              <span class="kp-stat__label">Pemasukan</span>
              <span class="kp-stat__value" id="kp-masuk">—</span>
            </div>
            <div class="kp-stat kp-stat--out">
              <span class="kp-stat__label">Pengeluaran</span>
              <span class="kp-stat__value" id="kp-keluar">—</span>
            </div>
            <div class="kp-stat kp-stat--net">
              <span class="kp-stat__label">Selisih</span>
              <span class="kp-stat__value" id="kp-selisih">—</span>
            </div>
            <div class="kp-stat kp-stat--today">
              <span class="kp-stat__label">Hari ini (keluar)</span>
              <span class="kp-stat__value" id="kp-hariini">—</span>
            </div>
          </div>

          <div class="kp-grid">
            <!-- Catat cepat -->
            <section class="kp-card">
              <h2 class="kp-card__title">Catat cepat</h2>
              <form id="kp-form" class="kp-form" autocomplete="off">
                <div class="kp-form__row">
                  <div class="kp-field kp-field--kind">
                    <label for="kp-kind">Jenis</label>
                    <select id="kp-kind" class="form-control form-control-sm">
                      <option value="out">Keluar</option>
                      <option value="in">Masuk</option>
                    </select>
                  </div>
                  <div class="kp-field">
                    <label for="kp-amount">Nominal</label>
                    <input type="text" id="kp-amount" class="form-control form-control-sm" placeholder="50rb / 2jt / 50000" required>
                  </div>
                </div>
                <div class="kp-form__row">
                  <div class="kp-field kp-field--wide">
                    <label for="kp-note">Catatan</label>
                    <input type="text" id="kp-note" class="form-control form-control-sm" placeholder="bensin, makan siang, gaji…">
                  </div>
                  <div class="kp-field">
                    <label for="kp-tanggal">Tanggal</label>
                    <input type="date" id="kp-tanggal" class="form-control form-control-sm">
                  </div>
                </div>
                <button type="submit" class="kp-btn" id="kp-submit">Simpan catatan</button>
                <p class="kp-hint">Kategori ditebak otomatis dari catatan. Di WhatsApp: <code>#U keluar 50rb bensin</code></p>
              </form>
            </section>

            <!-- Rincian kategori -->
            <section class="kp-card">
              <h2 class="kp-card__title">Pengeluaran per kategori</h2>
              <div id="kp-kategori" class="kp-kategori">
                <p class="kp-empty">Memuat…</p>
              </div>
            </section>
          </div>

          <!-- Daftar catatan -->
          <section class="kp-card kp-card--full">
            <h2 class="kp-card__title">Catatan periode ini</h2>
            <div class="kp-tabel-wrap">
              <table class="kp-tabel">
                <thead>
                  <tr>
                    <th>Tanggal</th><th>Jenis</th><th class="kp-num">Nominal</th>
                    <th>Kategori</th><th>Catatan</th><th>Asal</th><th></th>
                  </tr>
                </thead>
                <tbody id="kp-rows">
                  <tr><td colspan="7" class="kp-empty">Memuat…</td></tr>
                </tbody>
              </table>
            </div>
          </section>

        </div>
      </div>
    </div>
  </div>

  <!-- Bundle chrome sb-admin (WAJIB): toggle sidebar/dropdown ada di sb-admin-2.js. -->
  <script src="/vendor/jquery/jquery.min.js"></script>
  <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
  <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>
  <script src="/js/sb-admin-2.js"></script>
  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/keuangan-pribadi.js') : '/js/keuangan-pribadi.js'; ?>"></script>
</body>
</html>
