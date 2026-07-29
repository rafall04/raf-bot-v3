<?php
/**
 * Header Doc
 * Purpose: Halaman 404 panel. Sebelumnya masih template demo SB-Admin mentah —
 *          berisi data contoh ("Douglas McGee", pesan & notifikasi palsu),
 *          "Copyright Your Website 2020", dan tautan ke index.html yang tidak
 *          ada di aplikasi ini. Diganti layar error ringkas yang memakai token
 *          sadar-mode, seragam dengan layar 403 (lib/http-error-page.js).
 * Caller: routes/pages.js — res.status(404).render('sb-admin/404.php').
 * Deps: static/css/tokens.css + static/css/error-page.css (mount /css/).
 * SideEffects: Tidak ada; murni tampilan.
 */
?>
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Halaman tidak ditemukan · RAF BOT</title>
<link href="/css/tokens.css" rel="stylesheet">
<link href="/css/error-page.css" rel="stylesheet">
<script>
(function () {
    try {
        var s = localStorage.getItem('tkTheme');
        if (s === 'dark' || (!s && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-tk-pending-dark', '1');
        }
    } catch (e) { /* localStorage bisa diblokir — abaikan */ }
})();
</script>
</head>
<body class="rf-err-body">
<script>
(function () {
    if (document.documentElement.getAttribute('data-tk-pending-dark') === '1') {
        document.body.classList.add('tk-dark');
    }
})();
</script>
<main class="rf-err-card">
    <div class="rf-err-badge">404</div>
    <p class="rf-err-code">Kode 404</p>
    <h1 class="rf-err-title">Halaman tidak ditemukan</h1>
    <p class="rf-err-msg">Alamat yang kamu buka tidak ada, sudah dipindahkan, atau fiturnya sedang dimatikan lewat pengaturan.</p>
    <div class="rf-err-actions">
        <a class="rf-err-btn rf-err-btn-primary" href="/">Kembali ke Beranda</a>
        <a class="rf-err-btn rf-err-btn-ghost" href="/login">Masuk dengan akun lain</a>
    </div>
    <p class="rf-err-foot">RAF BOT — Panel Operasional</p>
</main>
</body>
</html>
