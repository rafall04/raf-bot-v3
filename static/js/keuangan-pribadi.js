/**
 * Header Doc
 * Purpose: Frontend halaman /keuangan-pribadi — muat ringkasan + catatan periode dari
 *          /api/keuangan-pribadi/*, render kartu/kategori/tabel, dan tangani catat-cepat serta
 *          hapus. Nominal dikirim APA ADANYA ("50rb"/"2jt") supaya diterjemahkan penerjemah yang
 *          SAMA dengan jalur WhatsApp (lib/personal-finance-service.parseAmount) — satu aturan,
 *          dua permukaan.
 * Caller: views/sb-admin/keuangan-pribadi.php (butuh static/css/keuangan-pribadi.css).
 * Deps: fetch API, endpoint /api/keuangan-pribadi/{ringkasan,catatan}.
 * SideEffects: DOM update; POST/DELETE catatan keuangan pribadi.
 */
(function () {
    "use strict";

    var elBulan = document.getElementById("kp-bulan");
    var elRows = document.getElementById("kp-rows");
    if (!elBulan || !elRows) return;

    var elMasuk = document.getElementById("kp-masuk");
    var elKeluar = document.getElementById("kp-keluar");
    var elSelisih = document.getElementById("kp-selisih");
    var elHariIni = document.getElementById("kp-hariini");
    var elKategori = document.getElementById("kp-kategori");
    var elAlert = document.getElementById("kp-alert");
    var elForm = document.getElementById("kp-form");
    var elSubmit = document.getElementById("kp-submit");

    function esc(s) {
        var d = document.createElement("div");
        d.textContent = s == null ? "" : String(s);
        return d.innerHTML;
    }

    function rupiah(n) {
        return "Rp" + (Number(n) || 0).toLocaleString("id-ID");
    }

    function bulanIni() {
        var d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function hariIni() {
        var d = new Date();
        return (
            d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0") +
            "-" +
            String(d.getDate()).padStart(2, "0")
        );
    }

    function pesan(teks, tone) {
        if (!elAlert) return;
        if (!teks) {
            elAlert.hidden = true;
            return;
        }
        elAlert.textContent = teks;
        elAlert.setAttribute("data-tone", tone || "ok");
        elAlert.hidden = false;
        if (tone === "ok") {
            setTimeout(function () {
                elAlert.hidden = true;
            }, 3500);
        }
    }

    function ambilJson(url, opsi) {
        return fetch(url, opsi).then(function (r) {
            // Sesi dompet berumur 8 jam. Kalau habis di tengah pemakaian, jangan tampilkan
            // "gagal memuat" yang membingungkan — antar langsung ke halaman masuk.
            if (r.status === 401) {
                window.location.href = "/keuangan-pribadi/login";
                throw new Error("Sesi berakhir, mengarahkan ke halaman masuk…");
            }
            return r.json().then(function (j) {
                if (!r.ok || j.success === false) {
                    throw new Error(j.message || "Gagal memuat data (" + r.status + ").");
                }
                return j;
            });
        });
    }

    function renderRingkasan(d) {
        elMasuk.textContent = rupiah(d.masuk);
        elKeluar.textContent = rupiah(d.keluar);
        elSelisih.textContent = rupiah(d.selisih);
        elSelisih.setAttribute("data-negatif", Number(d.selisih) < 0 ? "1" : "0");
        elHariIni.textContent = rupiah(d.hariIni ? d.hariIni.keluar : 0);

        var kat = d.perKategoriKeluar || [];
        if (!kat.length) {
            elKategori.innerHTML = '<p class="kp-empty">Belum ada pengeluaran di periode ini.</p>';
            return;
        }
        var maks = kat[0].total || 1;
        elKategori.innerHTML = kat
            .map(function (k) {
                var pct = Math.max(2, Math.round((k.total / maks) * 100));
                return (
                    '<div class="kp-kat">' +
                    '<div class="kp-kat__head"><span>' +
                    esc(k.category) +
                    " <small>(" +
                    k.jumlah +
                    "x)</small></span>" +
                    '<span class="kp-kat__nilai">' +
                    rupiah(k.total) +
                    "</span></div>" +
                    '<div class="kp-kat__bar"><div class="kp-kat__fill" style="width:' +
                    pct +
                    '%"></div></div>' +
                    "</div>"
                );
            })
            .join("");
    }

    function renderCatatan(rows) {
        if (!rows.length) {
            elRows.innerHTML = '<tr><td colspan="7" class="kp-empty">Belum ada catatan di periode ini.</td></tr>';
            return;
        }
        elRows.innerHTML = rows
            .map(function (r) {
                var masuk = r.kind === "in";
                return (
                    "<tr>" +
                    "<td>" + esc(r.tanggal) + "</td>" +
                    '<td><span class="kp-badge kp-badge--' + (masuk ? "in" : "out") + '">' +
                    (masuk ? "masuk" : "keluar") + "</span></td>" +
                    '<td class="kp-num">' + rupiah(r.amount) + "</td>" +
                    "<td>" + esc(r.category) + "</td>" +
                    "<td>" + esc(r.note || "—") + "</td>" +
                    "<td>" + esc(r.source) + "</td>" +
                    '<td><button class="kp-hapus" data-id="' + r.id + '" title="Hapus catatan">&times;</button></td>' +
                    "</tr>"
                );
            })
            .join("");
    }

    function muat() {
        var bulan = elBulan.value || bulanIni();
        var q = "?month=" + encodeURIComponent(bulan);
        Promise.all([
            ambilJson("/api/keuangan-pribadi/ringkasan" + q),
            ambilJson("/api/keuangan-pribadi/catatan" + q)
        ])
            .then(function (hasil) {
                renderRingkasan(hasil[0].data || {});
                renderCatatan(hasil[1].data || []);
            })
            .catch(function (e) {
                pesan(e.message, "error");
                elRows.innerHTML = '<tr><td colspan="7" class="kp-empty">Gagal memuat.</td></tr>';
            });
    }

    elForm.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var body = {
            kind: document.getElementById("kp-kind").value,
            amount: document.getElementById("kp-amount").value,
            note: document.getElementById("kp-note").value,
            tanggal: document.getElementById("kp-tanggal").value || undefined
        };
        elSubmit.disabled = true;
        ambilJson("/api/keuangan-pribadi/catatan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        })
            .then(function (j) {
                pesan("Tercatat: " + rupiah(j.data.amount) + " (" + j.data.category + ").", "ok");
                document.getElementById("kp-amount").value = "";
                document.getElementById("kp-note").value = "";
                muat();
            })
            .catch(function (e) {
                pesan(e.message, "error");
            })
            .finally(function () {
                elSubmit.disabled = false;
            });
    });

    elRows.addEventListener("click", function (ev) {
        var btn = ev.target.closest(".kp-hapus");
        if (!btn) return;
        if (!window.confirm("Hapus catatan ini?")) return;
        ambilJson("/api/keuangan-pribadi/catatan/" + encodeURIComponent(btn.getAttribute("data-id")), {
            method: "DELETE"
        })
            .then(function () {
                pesan("Catatan dihapus.", "ok");
                muat();
            })
            .catch(function (e) {
                pesan(e.message, "error");
            });
    });

    elBulan.addEventListener("change", muat);

    var elLogout = document.getElementById("kp-logout");
    if (elLogout) {
        elLogout.addEventListener("click", function () {
            fetch("/api/keuangan-pribadi/logout", { method: "POST" }).finally(function () {
                window.location.href = "/keuangan-pribadi/login";
            });
        });
    }

    // Ingat apakah panel tutorial ditutup — supaya tak mengganggu setelah hafal, tapi tetap
    // terbuka secara default pada kunjungan pertama.
    var elTutorial = document.getElementById("kp-tutorial");
    if (elTutorial) {
        try {
            if (window.localStorage.getItem("kpTutorialTertutup") === "1") elTutorial.open = false;
            elTutorial.addEventListener("toggle", function () {
                window.localStorage.setItem("kpTutorialTertutup", elTutorial.open ? "0" : "1");
            });
        } catch (_e) {
            /* localStorage diblokir → biarkan default terbuka */
        }
    }

    elBulan.value = bulanIni();
    document.getElementById("kp-tanggal").value = hariIni();
    muat();
})();
