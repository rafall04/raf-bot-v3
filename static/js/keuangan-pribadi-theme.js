/**
 * Header Doc
 * Purpose: Init tema anti-FOUC untuk halaman keuangan pribadi yang BERDIRI SENDIRI (login +
 *          dompet). Halaman-halaman itu sengaja tidak memuat `_navbar.php` — sidebar admin
 *          tak boleh muncul untuk sesi yang hanya punya akses dompet — padahal di sanalah
 *          snippet penerap `body.tk-dark` biasanya hidup. Tanpa berkas ini, halaman dompet
 *          akan selalu terang meski pemakainya memilih mode gelap di halaman lain.
 * Caller: <head> `views/sb-admin/keuangan-pribadi.php` dan `keuangan-pribadi-login.php`
 *         (WAJIB sebelum body dirender agar tak ada kedipan terang→gelap).
 * Deps: localStorage key `tkTheme` (dibagi dengan seluruh panel admin/teknisi),
 *       `prefers-color-scheme` sebagai cadangan, kelas `body.tk-dark` di tokens.css.
 * MainFuncs: -
 * SideEffects: Menambah kelas `tk-dark` pada <body> (atau <html> bila body belum ada).
 */
(function () {
    "use strict";
    try {
        var s = localStorage.getItem("tkTheme");
        var gelap = s === "dark" || (!s && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
        if (!gelap) return;

        // Skrip di <head> berjalan sebelum <body> ada. Tandai <html> dulu, lalu pindahkan
        // ke <body> begitu terbentuk — tokens.css meng-hook `body.tk-dark`.
        if (document.body) {
            document.body.classList.add("tk-dark");
            return;
        }
        document.documentElement.classList.add("tk-dark-pending");
        document.addEventListener("DOMContentLoaded", function () {
            document.body.classList.add("tk-dark");
            document.documentElement.classList.remove("tk-dark-pending");
        });
    } catch (_e) {
        /* localStorage diblokir (mode privat) → biarkan mode terang */
    }
})();
