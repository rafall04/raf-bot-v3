/**
 * Header Doc
 * Purpose: Merender halaman error (403/404) BER-TEMA untuk permukaan HTML. Sebelumnya
 *          penolakan akses dibalas `res.send("Akses ditolak…")` — teks polos tanpa tema,
 *          tanpa judul, dan tanpa jalan kembali; itu satu-satunya layar di panel yang
 *          sama sekali tidak ikut sistem desain. Halaman ini berdiri sendiri (tanpa
 *          sidebar) karena peran pemakai justru sedang TIDAK berhak atas shell-nya,
 *          tetapi tetap memakai token sadar-mode sehingga benar di terang & gelap.
 * Caller: routes/pages.js (checkRole) dan pemanggil lain yang perlu menolak akses HTML.
 * Deps: static/css/tokens.css + static/css/error-page.css (di-serve lewat mount /css/,
 *       lihat lib/http-security.js). Tanpa dependensi npm.
 * MainFuncs: renderErrorPage(), sendErrorPage()
 * SideEffects: sendErrorPage() menulis status + body ke response.
 */

'use strict';

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/**
 * Bangun HTML halaman error.
 * @param {object} opts
 * @param {number} opts.status      Kode HTTP (403/404).
 * @param {string} opts.title       Judul singkat, bahasa manusia.
 * @param {string} opts.message     Penjelasan + apa yang bisa dilakukan pemakai.
 * @param {string} [opts.backHref]  Tujuan tombol utama (default '/').
 * @param {string} [opts.backLabel] Label tombol utama.
 * @returns {string} dokumen HTML lengkap.
 */
function renderErrorPage(opts) {
    const status = Number(opts && opts.status) || 500;
    const title = escapeHtml((opts && opts.title) || 'Terjadi kesalahan');
    const message = escapeHtml((opts && opts.message) || '');
    const backHref = escapeHtml((opts && opts.backHref) || '/');
    const backLabel = escapeHtml((opts && opts.backLabel) || 'Kembali ke Beranda');

    // Penerap mode gelap ditulis inline & sebelum <body> dirender supaya tidak ada
    // kedipan terang (FOUC). Halaman ini tak memuat _navbar.php yang biasanya
    // memegang skrip itu, jadi harus membawanya sendiri.
    return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · RAF BOT</title>
<link href="/css/tokens.css" rel="stylesheet">
<link href="/css/error-page.css" rel="stylesheet">
<script>
(function () {
    try {
        var s = localStorage.getItem('tkTheme');
        if (s === 'dark' || (!s && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.setAttribute('data-tk-pending-dark', '1');
        }
    } catch (e) { /* localStorage bisa diblokir — abaikan, tetap mode terang */ }
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
    <div class="rf-err-badge">${status}</div>
    <p class="rf-err-code">Kode ${status}</p>
    <h1 class="rf-err-title">${title}</h1>
    <p class="rf-err-msg">${message}</p>
    <div class="rf-err-actions">
        <a class="rf-err-btn rf-err-btn-primary" href="${backHref}">${backLabel}</a>
        <a class="rf-err-btn rf-err-btn-ghost" href="/login">Masuk dengan akun lain</a>
    </div>
    <p class="rf-err-foot">RAF BOT — Panel Operasional</p>
</main>
</body>
</html>`;
}

/** Kirim halaman error ber-tema sebagai respons HTML. */
function sendErrorPage(res, opts) {
    const status = Number(opts && opts.status) || 500;
    return res.status(status).type('html').send(renderErrorPage(opts));
}

module.exports = { renderErrorPage, sendErrorPage, escapeHtml };
