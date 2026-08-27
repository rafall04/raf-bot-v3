/**
 * Header Doc
 * Purpose: Halaman /ganti-modem — pilih pelanggan, isi ID modem baru, jalankan, lalu
 *          tampilkan hasil LANGKAH DEMI LANGKAH. Bila server menjawab 428, artinya nama &
 *          sandi WiFi tak bisa dipastikan otomatis dan teknisi harus mengisinya — itu
 *          BUKAN error, jadi ditampilkan sebagai permintaan, bukan kegagalan merah.
 * Caller: views/sb-admin/ganti-modem.php
 * Deps: API GET /api/list/users, POST /api/users/:id/ganti-modem
 * MainFuncs: (IIFE)
 * SideEffects: memanggil API ganti modem (mengubah data pelanggan + setelan modem).
 */
(function () {
    "use strict";

    var pelangganTerpilih = null;
    var semua = [];

    function el(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function muatPelanggan() {
        fetch("/api/list/users", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var d = (j && (j.data || j.users)) || [];
                semua = Array.isArray(d) ? d : [];
            })
            .catch(function () { semua = []; });
    }

    function cari(q) {
        var k = String(q || "").trim().toLowerCase();
        if (k.length < 2) return [];
        return semua.filter(function (u) {
            return [u.name, u.pppoe_username, u.phone_number, u.address]
                .some(function (v) { return String(v || "").toLowerCase().indexOf(k) >= 0; });
        }).slice(0, 8);
    }

    function gambarSaran(daftar) {
        var box = el("gmSaran");
        if (!daftar.length) { box.innerHTML = ""; return; }
        box.innerHTML = daftar.map(function (u) {
            return '<div class="gm-saran-item" data-id="' + esc(u.id) + '">'
                + "<b>" + esc(u.name || "(tanpa nama)") + "</b>"
                + '<div class="gm-sub">' + esc(u.pppoe_username || "-") + " · " + esc(u.phone_number || "-") + "</div>"
                + "</div>";
        }).join("");
        Array.prototype.forEach.call(box.querySelectorAll(".gm-saran-item"), function (n) {
            n.addEventListener("click", function () { pilih(n.getAttribute("data-id")); });
        });
    }

    function pilih(id) {
        pelangganTerpilih = semua.find(function (u) { return String(u.id) === String(id); }) || null;
        el("gmSaran").innerHTML = "";
        el("gmCari").value = pelangganTerpilih ? (pelangganTerpilih.name || "") : "";
        var t = el("gmTerpilih");
        if (!pelangganTerpilih) { t.classList.add("d-none"); return; }
        t.classList.remove("d-none");
        t.innerHTML = "<b>" + esc(pelangganTerpilih.name || "-") + "</b>"
            + '<div class="gm-sub">PPPoE: ' + esc(pelangganTerpilih.pppoe_username || "-") + "</div>"
            + '<div class="gm-sub">Modem sekarang: <span class="mono">'
            + esc(pelangganTerpilih.device_id || "(belum ada)") + "</span></div>";
    }

    function gambarLangkah(langkah) {
        var box = el("gmLangkah");
        el("gmHasil").classList.remove("d-none");
        box.innerHTML = (langkah || []).map(function (l) {
            var ikon = l.ok ? "fa-check-circle" : "fa-times-circle";
            var kelas = l.ok ? "gm-ok" : "gm-gagal";
            return '<div class="gm-langkah ' + kelas + '">'
                + '<i class="fas ' + ikon + ' mr-2"></i>'
                + "<b>" + esc(l.langkah) + "</b> — " + esc(l.pesan)
                + "</div>";
        }).join("");
    }

    function jalankan() {
        if (!pelangganTerpilih) { el("gmStatus").textContent = "Pilih pelanggannya dulu."; return; }
        var baru = el("gmDeviceBaru").value.trim();
        if (!baru) { el("gmStatus").textContent = "Isi ID modem baru."; return; }

        var tombol = el("gmJalankan");
        tombol.disabled = true;
        el("gmStatus").textContent = "Sedang memasang WiFi ke modem baru…";

        var badan = { deviceIdBaru: baru };
        var ssid = el("gmSsid").value.trim();
        var pass = el("gmPassword").value;
        if (ssid) badan.ssid = ssid;
        if (pass) badan.password = pass;

        fetch("/api/users/" + encodeURIComponent(pelangganTerpilih.id) + "/ganti-modem", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(badan),
        })
            .then(function (r) { return r.json().then(function (j) { return { kode: r.status, j: j }; }); })
            .then(function (h) {
                tombol.disabled = false;
                gambarLangkah(h.j.langkah);
                if (h.j.butuhKredensial) {
                    // Permintaan, bukan kegagalan — tampilkan kolomnya lalu minta ulangi.
                    el("gmKredensial").classList.remove("d-none");
                    el("gmStatus").textContent = "Isi nama WiFi & sandi, lalu jalankan lagi.";
                    return;
                }
                el("gmStatus").textContent = h.j.message || "";
                if (h.kode === 200) {
                    pelangganTerpilih.device_id = baru;
                    pilih(pelangganTerpilih.id);
                    el("gmKredensial").classList.add("d-none");
                }
            })
            .catch(function (e) {
                tombol.disabled = false;
                el("gmStatus").textContent = "Gagal menghubungi server: " + e.message;
            });
    }

    document.addEventListener("DOMContentLoaded", function () {
        muatPelanggan();
        el("gmCari").addEventListener("input", function (e) { gambarSaran(cari(e.target.value)); });
        el("gmJalankan").addEventListener("click", jalankan);
    });
})();
