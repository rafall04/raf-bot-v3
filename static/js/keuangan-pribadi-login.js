/**
 * Header Doc
 * Purpose: Frontend halaman login dompet keuangan pribadi — kirim kredensial ke
 *          POST /api/keuangan-pribadi/login, lalu masuk ke /keuangan-pribadi bila sah.
 *          Pesan galat dibiarkan seragam (tak membedakan username vs sandi salah) mengikuti
 *          balasan server.
 * Caller: views/sb-admin/keuangan-pribadi-login.php.
 * Deps: fetch API.
 * SideEffects: Set cookie sesi (httpOnly, oleh server) + redirect.
 */
(function () {
    "use strict";

    var form = document.getElementById("kp-login-form");
    if (!form) return;

    var alertBox = document.getElementById("kp-login-alert");
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
