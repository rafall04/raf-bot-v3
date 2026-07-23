<?php
/**
 * Header Doc
 * Purpose: Halaman login TERPISAH untuk dompet keuangan pribadi. Sengaja berdiri sendiri —
 *          tanpa sidebar/topbar admin dan tanpa kaitan ke akun staf — karena kredensialnya
 *          memang terpisah (lib/personal-finance-auth, cookie `pf_session`). Sesi admin tidak
 *          memberi akses ke sini.
 *          TIDAK menyebut nama bot/ISP: halaman ini tak perlu memberi tahu pengunjung nyasar
 *          sistem apa yang ada di baliknya.
 * Caller: routes/pages.js path `/keuangan-pribadi/login` (hanya bila personalFinance.enabled).
 * Deps: `_head.php`, `static/css/keuangan-pribadi.css`, `static/js/keuangan-pribadi-login.js`,
 *       API POST /api/keuangan-pribadi/login.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <?php
    $pageTitle = 'Masuk';
    $themeRole = 'admin';
    include __DIR__ . '/_head.php';
    ?>
    <link rel="stylesheet" href="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/css/keuangan-pribadi.css') : '/css/keuangan-pribadi.css'; ?>">
</head>
<body class="kp-login-body">
  <main class="kp-login-wrap">
    <section class="kp-login-card">
      <div class="kp-login-ikon">🔒</div>
      <h1 class="kp-login-judul">Catatan Keuangan Pribadi</h1>
      <p class="kp-login-sub">Akses terpisah. Akun admin tidak berlaku di sini.</p>

      <div id="kp-login-alert" class="kp-alert" hidden></div>

      <form id="kp-login-form" autocomplete="off">
        <div class="kp-field">
          <label for="kp-username">Nama pengguna</label>
          <input type="text" id="kp-username" class="form-control" autocomplete="username" required autofocus>
        </div>
        <div class="kp-field">
          <label for="kp-password">Sandi</label>
          <input type="password" id="kp-password" class="form-control" autocomplete="current-password" required>
        </div>
        <button type="submit" class="kp-btn kp-login-btn" id="kp-login-submit">Masuk</button>
      </form>
    </section>
  </main>

  <script src="<?php echo function_exists('rafAssetUrl') ? rafAssetUrl('/js/keuangan-pribadi-login.js') : '/js/keuangan-pribadi-login.js'; ?>"></script>
</body>
</html>
