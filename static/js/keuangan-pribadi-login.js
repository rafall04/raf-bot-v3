/**
 * Header Doc
 * Purpose: Halaman login dompet — kirim kredensial ke POST /api/keuangan-pribadi/login lalu
 *          masuk ke /keuangan-pribadi bila sah. Juga memeriksa sesi saat halaman dibuka:
 *          bila ternyata masih login, langsung diarahkan masuk. Tanpa itu, halaman ini yang
 *          tersaji dari bfcache saat menekan tombol BACK terlihat seperti "ter-logout".
 * Caller: views/sb-admin/keuangan-pribadi-login.php.
 * Deps: fetch API. Sengaja TIDAK memakai keuangan-pribadi-common.js — halaman ini harus tetap
 *       berfungsi tanpa sesi, sementara helper di sana mengarahkan ke sini saat 401.
 * SideEffects: Cookie sesi diset oleh server; redirect.
 */
(function () {
    "use strict";

    var form = document.getElementById("kp-form-login");
    if (!form) return;

    var alertBox = document.getElementById("kp-alert");
    var submit = document.getElementById("kp-login-submit");

    function pesan(teks, tone) {
        if (!alertBox) return;
        if (!teks) {
            alertBox.hidden = true;
            return;
        }
        alertBox.textContent = teks;
        alertBox.setAttribute("data-tone", tone || "error");
        alertBox.hidden = false;
    }

    // Sudah punya sesi? Jangan tampilkan form. Menutupi kasus halaman ini disajikan dari
    // cache/bfcache (tombol BACK) padahal pemakainya masih masuk.
    function cekSesi() {
        fetch("/api/keuangan-pribadi/sesi", { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.data && j.data.masuk) window.location.replace("/keuangan-pribadi");
            })
            .catch(function () { /* biarkan form tampil */ });
    }
    cekSesi();
    // pageshow menangkap kembalinya halaman dari bfcache, yang TIDAK memicu load ulang skrip.
    window.addEventListener("pageshow", function (ev) {
        if (ev.persisted) cekSesi();
    });

    form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        pesan("");
        submit.disabled = true;

        fetch("/api/keuangan-pribadi/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: document.getElementById("kp-username").value,
                password: document.getElementById("kp-password").value
            })
        })
            .then(function (r) {
                return r.json().then(function (j) {
                    if (!r.ok || j.success === false) throw new Error(j.message || "Gagal masuk.");
                    return j;
                });
            })
            .then(function () {
                window.location.href = "/keuangan-pribadi";
            })
            .catch(function (e) {
                pesan(e.message, "error");
                document.getElementById("kp-password").value = "";
                document.getElementById("kp-password").focus();
            })
            .finally(function () {
                submit.disabled = false;
            });
    });
})();
