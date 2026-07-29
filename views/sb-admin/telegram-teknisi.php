<?php
/**
 * Header Doc
 * Purpose: Halaman admin bot Telegram teknisi — status runtime bot, konfigurasi (enable/token/
 *          poll), dan manajemen whitelist chat_id (tambah/hapus/aktif-nonaktif). READ-ONLY bot
 *          (fase 1): teknisi cek redaman/koneksi/modem/olt/pelanggan via Telegram.
 * Caller: `routes/pages.js` pada path `/telegram-teknisi`.
 * Deps: `_head.php`, `_navbar.php`, `topbar.php`, API `/api/admin/telegram-teknisi/*`,
 *       Bootstrap, jQuery, SweetAlert2.
 * MainFuncs: Render kartu status (termasuk banner "token ditolak"/galat poll dari status.terminal
 *            & status.lastError), form config, form tambah + tabel whitelist.
 * SideEffects: Memanggil API admin untuk baca/tulis whitelist & config.
 */
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <?php
    $pageTitle = 'RAF BOT - Bot Teknisi (Telegram)';
    $themeRole = 'admin';
    $pageDescription = 'RAF BOT Telegram Teknisi';
    include __DIR__ . '/_head.php';
    ?>
  <link href="<?= rafAssetUrl('/css/telegram-teknisi.css') ?>" rel="stylesheet">
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
                <h1><i class="fab fa-telegram-plane"></i> Bot Teknisi (Telegram)</h1>
                <p>Teknisi cek <strong>redaman (modem + OLT)</strong>, koneksi PPPoE, modem, dan status OLT lewat Telegram. Hanya <strong>chat_id</strong> yang di-whitelist di bawah yang bisa memakai bot.</p>
              </div>
              <div class="d-flex flex-wrap" style="gap:.5rem;">
                <button id="btnRefresh" class="btn btn-light"><i class="fas fa-sync"></i> Refresh</button>
              </div>
            </div>
          </div>

          <div class="alert alert-info" role="alert" style="border-radius:12px;">
            <i class="fas fa-info-circle"></i>
            Cara teknisi mendaftar: minta teknisi kirim apa saja ke bot, bot membalas <strong>chat_id</strong>-nya. Masukkan chat_id itu di tabel whitelist. Token bot <strong>WAJIB berbeda</strong> dari bot backup database.
          </div>

          <div class="row mb-2">
            <div class="col-md-3 mb-3"><div class="tg-metric"><span>Status Bot</span><strong id="mStatus">-</strong><small id="mStatusSub">&nbsp;</small></div></div>
            <div class="col-md-3 mb-3"><div class="tg-metric"><span>Token</span><strong id="mToken">-</strong><small>config.telegramTeknisi</small></div></div>
            <div class="col-md-3 mb-3"><div class="tg-metric"><span>Teknisi Terdaftar</span><strong id="mCount">0</strong><small>whitelist chat_id</small></div></div>
            <div class="col-md-3 mb-3"><div class="tg-metric"><span>Poll Terakhir</span><strong id="mPoll" style="font-size:.95rem;">-</strong><small>long-poll getUpdates</small></div></div>
          </div>

          <div id="tgStatusAlert" class="alert" role="alert" style="display:none;border-radius:12px;"></div>

          <div class="tg-card mb-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Konfigurasi Bot</h6></div>
            <div class="card-body">
              <form id="cfgForm">
                <div class="form-row">
                  <div class="form-group col-md-4">
                    <label>Status</label>
                    <select class="form-control" name="enabled"><option value="false">Nonaktif</option><option value="true">Aktif</option></select>
                  </div>
                  <div class="form-group col-md-5">
                    <label>Bot Token <small class="text-muted">(kosongkan = pertahankan token lama)</small></label>
                    <input type="text" class="form-control" name="botToken" placeholder="paste token dari @BotFather" autocomplete="off">
                  </div>
                  <div class="form-group col-md-3">
                    <label>Poll Timeout (detik)</label>
                    <input type="number" min="1" max="300" class="form-control" name="pollTimeoutSec" value="50">
                  </div>
                </div>
                <button type="submit" class="btn btn-primary"><i class="fas fa-save"></i> Simpan &amp; Restart Bot</button>
                <small class="text-muted ml-2">Menyimpan akan me-restart loop bot agar perubahan token/status langsung berlaku.</small>
              </form>
            </div>
          </div>

          <div class="tg-card mb-4">
            <div class="card-header py-3"><h6 class="m-0 font-weight-bold text-dark">Whitelist Teknisi</h6></div>
            <div class="card-body">
              <form id="addForm" class="form-inline mb-3">
                <input type="text" class="form-control mr-2 mb-2" name="chatId" placeholder="chat_id (mis. 878008307)" required>
                <input type="text" class="form-control mr-2 mb-2" name="name" placeholder="nama teknisi (opsional)">
                <button type="submit" class="btn btn-success mb-2"><i class="fas fa-plus"></i> Tambah</button>
              </form>
              <div class="table-responsive">
                <table class="table table-bordered tg-table" id="waTable">
                  <thead><tr><th>chat_id</th><th>Nama</th><th>Ditambah oleh</th><th>Waktu</th><th>Status</th><th>Aksi</th></tr></thead>
                  <tbody></tbody>
                </table>
              </div>
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
  <script src="<?= rafAssetUrl('/js/telegram-teknisi.js') ?>"></script>
</body>
</html>
