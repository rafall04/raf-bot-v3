/**
 * Header Doc
 * Purpose : Toggle tema gelap/terang bersama untuk seluruh halaman admin & teknisi.
 *           Mengikat satu listener delegasi pada document (idempoten) + sinkron ikon.
 * Caller  : Dimuat via <script src="/js/theme.js"> dari topbar partial
 *           (topbar.php, _role_aware_teknisi_topbar.php) dan halaman ber-topbar inline
 *           (index.php, pembayaran/teknisi.php).
 * Deps    : Tombol #tkThemeToggle (opsional <i> di dalamnya untuk ikon FontAwesome),
 *           kelas body.tk-dark (admin-theme.css / teknisi-theme.css),
 *           localStorage key 'tkTheme'. Init anti-FOUC ada inline di _navbar*.php.
 * MainFuncs: syncIcon()
 * SideEffects: tulis localStorage 'tkTheme'; toggle kelas body.tk-dark;
 *              set window.__tkThemeToggleBound (guard idempoten).
 */
(function () {
    // Guard idempoten: aman bila skrip ter-include lebih dari sekali dalam satu halaman
    // (mis. topbar bersama + topbar inline) — listener document hanya terpasang sekali.
    if (window.__tkThemeToggleBound) {
        return;
    }
    window.__tkThemeToggleBound = true;

    function syncIcon() {
        var icon = document.querySelector("#tkThemeToggle i");
        if (icon) {
            icon.className = document.body.classList.contains("tk-dark") ? "fas fa-sun" : "fas fa-moon";
        }
    }

    // Sinkron saat skrip dimuat, lalu sekali lagi setelah DOM siap — sebagian topbar
    // memuat skrip ini sebelum markup tombol ter-parse, jadi syncIcon pertama bisa no-op.
    syncIcon();
    document.addEventListener("DOMContentLoaded", syncIcon);

    document.addEventListener("click", function (e) {
        var btn = e.target.closest && e.target.closest("#tkThemeToggle");
        if (!btn) {
            return;
        }
        var isDark = document.body.classList.toggle("tk-dark");
        try {
            localStorage.setItem("tkTheme", isDark ? "dark" : "light");
        } catch (_err) {
            /* localStorage tidak tersedia (mode privat) — abaikan, toggle tetap jalan */
        }
        syncIcon();
    });
})();
