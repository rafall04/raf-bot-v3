<!DOCTYPE html>
<html lang="id">

<head>
<?php require_once __DIR__ . '/_asset.php'; ?>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="description" content="LOGIN RAF NET">
    <meta name="author" content="">

    <title>Masuk · RAF BOT WIFI</title>

    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet" type="text/css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link href="/css/sb-admin-2.min.css" rel="stylesheet">

    <link href="<?= rafAssetUrl('/css/login.css') ?>" rel="stylesheet">
</head>

<body>

    <div class="login-shell">
        <!-- Brand panel -->
        <div class="login-brand">
            <div class="brand-logo">
                <span class="logo-mark"><i class="fas fa-robot"></i></span>
                <span>RAF BOT<sup>WIFI</sup></span>
            </div>
            <div class="brand-copy">
                <h2>Panel Manajemen Jaringan WiFi</h2>
                <p>Kelola pelanggan, pembayaran, instalasi, dan jaringan dalam satu dasbor terpadu.</p>
                <ul class="brand-features">
                    <li><i class="fas fa-users"></i> Manajemen pelanggan &amp; PSB</li>
                    <li><i class="fas fa-money-check-alt"></i> Monitoring pembayaran</li>
                    <li><i class="fas fa-broadcast-tower"></i> Pantau OLT &amp; peta jaringan</li>
                </ul>
            </div>
        </div>

        <!-- Form panel -->
        <div class="login-form-wrap">
            <div class="form-head">
                <h1>Selamat datang 👋</h1>
                <p>Masuk untuk melanjutkan ke dasbor Anda.</p>
            </div>

            <form id="loginForm" class="user">
                <div class="field">
                    <label for="loginUsername">Username</label>
                    <div class="input-wrap">
                        <i class="fas fa-user lead-icon"></i>
                        <input type="text" id="loginUsername" name="username"
                               placeholder="Masukkan username Anda" autocomplete="username" required>
                    </div>
                </div>
                <div class="field">
                    <label for="loginPassword">Password</label>
                    <div class="input-wrap">
                        <i class="fas fa-lock lead-icon"></i>
                        <input type="password" id="loginPassword" name="password"
                               placeholder="Masukkan password" autocomplete="current-password" required>
                        <button type="button" class="toggle-pass" id="togglePassword" aria-label="Tampilkan password">
                            <i class="fas fa-eye"></i>
                        </button>
                    </div>
                </div>
                <button type="submit" class="btn-login">Masuk</button>
            </form>

            <div class="form-foot">&copy; <span id="yearNow"></span> RAF BOT WIFI</div>
        </div>
    </div>

    <div class="modal fade" id="loginErrorModal" tabindex="-1" aria-labelledby="loginErrorModalLabel" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="loginErrorModalLabel"><i class="fas fa-times-circle mr-2"></i>Login Gagal</h5>
            <button type="button" class="close" data-dismiss="modal" aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div class="modal-body" id="loginErrorModalBody">
            {Pesan error akan ditampilkan di sini}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-dismiss="modal">Coba Lagi</button>
          </div>
        </div>
      </div>
    </div>

    <script src="/vendor/jquery/jquery.min.js"></script>
    <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"></script>
    <script src="/vendor/jquery-easing/jquery.easing.min.js"></script>

    <script src="<?= rafAssetUrl('/js/login.js') ?>"></script>

</body>
</html>
