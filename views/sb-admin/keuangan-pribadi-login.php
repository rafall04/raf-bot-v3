<?php
/**
 * Header Doc
 * Purpose: Halaman login TERPISAH untuk dompet keuangan pribadi. Berdiri sendiri — tanpa
 *          sidebar/topbar admin dan tanpa kaitan ke akun staf — karena kredensialnya memang
 *          terpisah (lib/personal-finance-auth, cookie `pf_session`).
 *          TIDAK menyebut nama bot/ISP: pengunjung nyasar tak perlu tahu sistem apa di baliknya.
 * Caller: routes/pages.js path `/keuangan-pribadi/login` (hanya bila personalFinance.enabled).
 * Deps: `_asset.php`, `static/css/keuangan-pribadi.css`,
 *       `static/js/keuangan-pribadi-theme.js` (anti-FOUC), `static/js/keuangan-pribadi-login.js`.
 */
require_once __DIR__ . '/_asset.php';
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex, nofollow">
    <title>Masuk</title>
    <link href="/vendor/fontawesome-free/css/all.min.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="<?= rafAssetUrl('/css/tokens.css') ?>">
    <link rel="stylesheet" href="<?= rafAssetUrl('/css/keuangan-pribadi.css') ?>">
    <script src="<?= rafAssetUrl('/js/keuangan-pribadi-theme.js') ?>"></script>
</head>
<body class="kp">
  <main class="kp-login">
    <section class="kp-login__kartu">
      <div class="kp-login__logo" aria-hidden="true"><i class="fas fa-lock"></i></div>
      <h1 class="kp-login__judul">Catatan Keuangan Pribadi</h1>
      <p class="kp-login__sub">Akses terpisah. Akun admin tidak berlaku di sini.</p>

      <div id="kp-alert" class="kp-alert" role="status" hidden></div>

      <form id="kp-form-login" autocomplete="off">
        <div class="kp-medan">
          <label class="kp-label" for="kp-username">Nama pengguna</label>
          <input type="text" id="kp-username" class="kp-input" autocomplete="username" required autofocus>
        </div>
        <div class="kp-medan">
          <label class="kp-label" for="kp-password">Sandi</label>
          <input type="password" id="kp-password" class="kp-input" autocomplete="current-password" required>
        </div>
        <button type="submit" class="kp-tombol kp-tombol--penuh" id="kp-login-submit">Masuk</button>
      </form>
    </section>
  </main>

  <script src="<?= rafAssetUrl('/js/keuangan-pribadi-login.js') ?>"></script>
</body>
</html>
