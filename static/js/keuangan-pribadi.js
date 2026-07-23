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

    // Deret batang per hari. Skala relatif terhadap hari terboros, dengan tinggi minimum
    // supaya hari yang ADA isinya tak tampak nol; hari kosong benar-benar 0 (tak berbatang).
    function renderHarian(perHari, terboros, rata) {
        var elHarian = document.getElementById("kp-harian");
        var elRata = document.getElementById("kp-rata");
        var elTerboros = document.getElementById("kp-terboros");
        if (!elHarian) return;

        if (elRata) elRata.textContent = rupiah(rata);
        if (elTerboros) {
            elTerboros.textContent = terboros
                ? "Terboros: " + terboros.tanggal.slice(8) + "/" + terboros.tanggal.slice(5, 7) + " (" + rupiah(terboros.keluar) + ")"
                : "";
        }

        if (!perHari || !perHari.length) {
            elHarian.innerHTML = '<p class="kp-empty">Belum ada catatan di periode ini.</p>';
            return;
        }
        var maks = perHari.reduce(function (m, d) { return Math.max(m, d.keluar, d.masuk); }, 0);
        if (!maks) {
            elHarian.innerHTML = '<p class="kp-empty">Belum ada catatan di periode ini.</p>';
            return;
        }

        elHarian.innerHTML = perHari
            .map(function (d) {
                var tk = d.keluar ? Math.max(4, Math.round((d.keluar / maks) * 100)) : 0;
                var tm = d.masuk ? Math.max(4, Math.round((d.masuk / maks) * 100)) : 0;
                var puncak = terboros && d.tanggal === terboros.tanggal;
                var judul = d.tanggal + " — keluar " + rupiah(d.keluar) + ", masuk " + rupiah(d.masuk);
                return (
                    '<div class="kp-hari' + (puncak ? " kp-hari--puncak" : "") + '" title="' + esc(judul) + '">' +
                    '<div class="kp-hari__batang">' +
                    '<span class="kp-hari__in" style="height:' + tm + '%"></span>' +
                    '<span class="kp-hari__out" style="height:' + tk + '%"></span>' +
                    "</div>" +
                    '<span class="kp-hari__label">' + d.hari + "</span>" +
                    "</div>"
                );
            })
            .join("");
    }

    function renderSubtotal(t) {
        var el = document.getElementById("kp-subtotal");
        var reset = document.getElementById("kp-f-reset");
        if (!el) return;
        if (!t || !t.aktif) {
            el.textContent = "";
            if (reset) reset.hidden = true;
            return;
        }
        el.textContent =
            t.jumlah + " catatan terpilih · keluar " + rupiah(t.keluar) + " · masuk " + rupiah(t.masuk);
        if (reset) reset.hidden = false;
    }

    function isiKategori(daftar) {
        var sel = document.getElementById("kp-f-kategori");
        if (!sel) return;
        var terpilih = sel.value;
        sel.innerHTML =
            '<option value="">Semua</option>' +
            (daftar || []).map(function (k) { return '<option value="' + esc(k) + '">' + esc(k) + "</option>"; }).join("");
        // Pertahankan pilihan pemakai walau daftar di-render ulang setiap muat.
        if (terpilih && (daftar || []).indexOf(terpilih) !== -1) sel.value = terpilih;
    }

    function renderCatatan(rows) {
        if (!rows.length) {
            elRows.innerHTML = '<tr><td colspan="7" class="kp-empty">Tidak ada catatan yang cocok.</td></tr>';
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

    function nilai(id) {
        var el = document.getElementById(id);
        return el ? String(el.value || "").trim() : "";
    }

    function muat() {
        var bulan = elBulan.value || bulanIni();
        var q = "?month=" + encodeURIComponent(bulan);
        // Filter hanya diikutkan ke daftar catatan; ringkasan + grafik harian tetap
        // menggambarkan SELURUH periode (lihat catatan di markup).
        var qFilter = q;
        if (nilai("kp-f-jenis")) qFilter += "&kind=" + encodeURIComponent(nilai("kp-f-jenis"));
        if (nilai("kp-f-kategori")) qFilter += "&category=" + encodeURIComponent(nilai("kp-f-kategori"));
        if (nilai("kp-f-cari")) qFilter += "&search=" + encodeURIComponent(nilai("kp-f-cari"));

        Promise.all([
            ambilJson("/api/keuangan-pribadi/ringkasan" + q),
            ambilJson("/api/keuangan-pribadi/catatan" + qFilter)
        ])
            .then(function (hasil) {
                var r = hasil[0].data || {};
                var c = hasil[1] || {};
                renderRingkasan(r);
                renderHarian(r.perHari, r.hariTerboros, r.rataKeluarPerHari);
                isiKategori(c.kategoriTersedia);
                renderSubtotal(c.terfilter);
                renderCatatan(c.data || []);
            })
            .catch(function (e) {
                pesan(e.message, "error");
                elRows.innerHTML = '<tr><td colspan="7" class="kp-empty">Gagal memuat.</td></tr>';
            });
    }

    // Ketikan pencarian ditunda 300 ms — tanpa itu setiap huruf memicu satu permintaan.
    var timerCari = null;
    function muatTertunda() {
        clearTimeout(timerCari);
        timerCari = setTimeout(muat, 300);
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

    var fJenis = document.getElementById("kp-f-jenis");
    var fKategori = document.getElementById("kp-f-kategori");
    var fCari = document.getElementById("kp-f-cari");
    var fReset = document.getElementById("kp-f-reset");
    if (fJenis) fJenis.addEventListener("change", muat);
    if (fKategori) fKategori.addEventListener("change", muat);
    if (fCari) fCari.addEventListener("input", muatTertunda);
    if (fReset) {
        fReset.addEventListener("click", function () {
            if (fJenis) fJenis.value = "";
            if (fKategori) fKategori.value = "";
            if (fCari) fCari.value = "";
            muat();
        });
    }

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
