/**
 * Header Doc
 * Purpose: Halaman PENGATURAN dompet — muat/simpan grup WhatsApp tujuan, ganti sandi
 *          (verifikasi sandi lama di server), dan keluar dari sesi dompet.
 * Caller: views/sb-admin/keuangan-pribadi-pengaturan.php.
 * Deps: `window.KP` (static/js/keuangan-pribadi-common.js).
 * SideEffects: PUT grup (menulis config.json di server), POST ganti sandi & logout.
 */
(function () {
    "use strict";
    var K = window.KP;
    if (!K || !document.getElementById("kp-grup")) return;

    function el(id) {
        return document.getElementById(id);
    }

    // ── Sesi ────────────────────────────────────────────────────────────────────
    K.ambil("/api/keuangan-pribadi/sesi")
        .then(function (j) {
            var u = (j.data && j.data.username) || "";
            var info = el("kp-sesi-info");
            if (info && u) info.textContent = "Masuk sebagai " + u;
            var hidden = el("kp-sandi-user");
            // Isi username tersembunyi supaya pengelola sandi memperbarui entri yang BENAR,
            // bukan membuat entri baru terpisah.
            if (hidden) hidden.value = u;
        })
        .catch(function () {
            /* tak fatal */
        });

    // ── Grup WhatsApp ───────────────────────────────────────────────────────────
    function muatGrup() {
        var tombol = el("kp-grup-muat");
        tombol.disabled = true;
        K.ambil("/api/keuangan-pribadi/grup")
            .then(function (j) {
                var sel = el("kp-grup");
                var terpilih = j.terpilih || "";
                sel.innerHTML =
                    '<option value="">— tidak ada / pakai DM —</option>' +
                    (j.data || [])
                        .map(function (g) {
                            return '<option value="' + K.esc(g.id) + '">' + K.esc(g.subject) + " (" + g.size + " anggota)</option>";
                        })
                        .join("");
                // Grup tersimpan yang tak ada di daftar (bot dikeluarkan) tetap dipasang
                // sebagai opsi bertanda — kalau tidak, pilihan lama hilang senyap.
                if (terpilih && !Array.prototype.some.call(sel.options, function (o) { return o.value === terpilih; })) {
                    var o = document.createElement("option");
                    o.value = terpilih;
                    o.textContent = terpilih + " (tersimpan — bot tidak lagi di grup ini?)";
                    sel.appendChild(o);
                }
                sel.value = terpilih;
                if (j.waSiap === false) {
                    K.pesan(j.message || "WhatsApp belum terkoneksi — daftar grup tak bisa dimuat.", "error");
                } else {
                    K.pesan((j.data || []).length + " grup dimuat.", "ok");
                }
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
            })
            .finally(function () {
                tombol.disabled = false;
            });
    }

    el("kp-grup-muat").addEventListener("click", muatGrup);

    el("kp-grup-simpan").addEventListener("click", function () {
        var tombol = el("kp-grup-simpan");
        tombol.disabled = true;
        K.ambil("/api/keuangan-pribadi/grup", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ groupId: el("kp-grup").value })
        })
            .then(function (j) {
                K.pesan(j.message || "Grup disimpan.", "ok");
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
            })
            .finally(function () {
                tombol.disabled = false;
            });
    });

    // Muat daftar sekali di awal supaya pilihan yang tersimpan langsung terlihat.
    muatGrup();

    // ── Ganti sandi ─────────────────────────────────────────────────────────────
    el("kp-form-sandi").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var lama = el("kp-sandi-lama").value;
        var baru = el("kp-sandi-baru").value;
        var ulang = el("kp-sandi-ulang").value;

        // Dicek di sini DULU supaya salah ketik tak membakar jatah percobaan di server.
        if (baru !== ulang) return K.pesan("Sandi baru dan ulangannya tidak sama.", "error");
        if (baru.length < 8) return K.pesan("Sandi baru minimal 8 karakter.", "error");

        var tombol = el("kp-sandi-simpan");
        tombol.disabled = true;
        K.ambil("/api/keuangan-pribadi/ganti-sandi", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sandiLama: lama, sandiBaru: baru })
        })
            .then(function (j) {
                K.pesan(j.message || "Sandi diganti.", "ok");
                el("kp-form-sandi").reset();
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
            })
            .finally(function () {
                tombol.disabled = false;
            });
    });

    // ── Keluar ──────────────────────────────────────────────────────────────────
    el("kp-logout").addEventListener("click", function () {
        if (!window.confirm("Keluar dari dompet?")) return;
        fetch("/api/keuangan-pribadi/logout", { method: "POST" }).finally(function () {
            window.location.href = "/keuangan-pribadi/login";
        });
    });
})();
