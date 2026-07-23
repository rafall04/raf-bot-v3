/**
 * Header Doc
 * Purpose: Halaman RINGKASAN dompet — muat /api/keuangan-pribadi/ringkasan lalu render kartu
 *          statistik + tren, grafik batang per hari (dengan penanda hari terboros), dan
 *          rincian pengeluaran per kategori beserta pagunya.
 * Caller: views/sb-admin/keuangan-pribadi.php.
 * Deps: `window.KP` (static/js/keuangan-pribadi-common.js).
 * SideEffects: Pembaruan DOM saja; halaman ini tidak menulis apa pun.
 */
(function () {
    "use strict";
    var K = window.KP;
    if (!K || !document.getElementById("kp-masuk")) return;

    function el(id) {
        return document.getElementById(id);
    }

    // `membaik` sudah dihitung server (pengeluaran naik = memburuk) — warna di sini tinggal
    // mengikuti, supaya tak ada logika arah yang digandakan di dua tempat.
    function renderTren(id, t, label) {
        var e = el(id);
        if (!e) return;
        if (!t || t.arah === "tetap" || (!t.sebelumnya && !t.sekarang)) {
            e.textContent = "";
            e.removeAttribute("data-arah");
            return;
        }
        e.textContent = (t.arah === "naik" ? "▲ " : "▼ ") + (t.persen == null ? "baru" : Math.abs(t.persen) + "%") +
            " vs " + (label || "sebelumnya");
        e.setAttribute("data-arah", t.membaik === null ? "netral" : t.membaik ? "baik" : "buruk");
    }

    function renderHarian(perHari, terboros) {
        var wadah = el("kp-harian");
        var meta = el("kp-terboros");
        if (meta) {
            meta.textContent = terboros
                ? "Terboros " + terboros.tanggal.slice(8) + "/" + terboros.tanggal.slice(5, 7) +
                  " · " + K.rupiah(terboros.keluar)
                : "";
        }
        var maks = (perHari || []).reduce(function (m, d) {
            return Math.max(m, d.keluar, d.masuk);
        }, 0);
        if (!perHari || !perHari.length || !maks) {
            wadah.innerHTML = '<p class="kp-kosong">Belum ada catatan di periode ini.</p>';
            return;
        }
        wadah.innerHTML = perHari
            .map(function (d) {
                // Tinggi minimum 4% supaya hari yang ADA isinya tak tampak nol; hari kosong
                // benar-benar 0 (tak berbatang) agar "tanggal berapa boros" terbaca jujur.
                var tk = d.keluar ? Math.max(4, Math.round((d.keluar / maks) * 100)) : 0;
                var tm = d.masuk ? Math.max(4, Math.round((d.masuk / maks) * 100)) : 0;
                var puncak = terboros && d.tanggal === terboros.tanggal;
                return (
                    '<div class="kp-hari' + (puncak ? " kp-hari--puncak" : "") + '" title="' +
                    K.esc(d.tanggal + " — keluar " + K.rupiah(d.keluar) + ", masuk " + K.rupiah(d.masuk)) + '">' +
                    '<div class="kp-hari__batang">' +
                    '<span class="kp-hari__masuk" style="height:' + tm + '%"></span>' +
                    '<span class="kp-hari__keluar" style="height:' + tk + '%"></span>' +
                    "</div><span class=\"kp-hari__label\">" + d.hari + "</span></div>"
                );
            })
            .join("");
    }

    function renderKategori(kat) {
        var wadah = el("kp-kategori");
        if (!kat || !kat.length) {
            wadah.innerHTML = '<p class="kp-kosong">Belum ada pengeluaran di periode ini.</p>';
            return;
        }
        var maks = kat.reduce(function (m, k) {
            return Math.max(m, k.total, k.pagu || 0);
        }, 0) || 1;

        wadah.innerHTML = kat
            .map(function (k) {
                // Ada pagu → bar diukur terhadap PAGU (yang ingin dilihat: sudah berapa persen
                // terpakai). Tanpa pagu → terhadap kategori terbesar.
                var adaPagu = k.pagu > 0;
                var pct = adaPagu
                    ? Math.min(100, Math.max(2, Math.round((k.total / k.pagu) * 100)))
                    : Math.max(2, Math.round((k.total / maks) * 100));
                return (
                    '<div class="kp-kat' + (k.lewatPagu ? " kp-kat--lewat" : "") + '">' +
                    '<div class="kp-kat__kepala"><span>' + K.esc(k.category) +
                    " <small>(" + k.jumlah + "x)</small>" +
                    (k.lewatPagu ? '<span class="kp-tanda-lewat">lewat pagu</span>' : "") +
                    '</span><span class="kp-kat__nilai">' +
                    (adaPagu ? K.rupiah(k.total) + " / " + K.rupiah(k.pagu) + " · " + k.persenPagu + "%" : K.rupiah(k.total)) +
                    "</span></div>" +
                    '<div class="kp-kat__bar"><div class="kp-kat__isi" style="width:' + pct + '%"></div></div></div>'
                );
            })
            .join("");
    }

    function muat() {
        K.ambil("/api/keuangan-pribadi/ringkasan" + K.queryPeriode())
            .then(function (j) {
                var d = j.data || {};
                el("kp-masuk").textContent = K.rupiah(d.masuk);
                el("kp-keluar").textContent = K.rupiah(d.keluar);
                el("kp-selisih").textContent = K.rupiah(d.selisih);
                el("kp-selisih").setAttribute("data-negatif", Number(d.selisih) < 0 ? "1" : "0");
                el("kp-hariini").textContent = K.rupiah(d.hariIni ? d.hariIni.keluar : 0);
                el("kp-rata").textContent = "rata-rata " + K.rupiah(d.rataKeluarPerHari) + "/hari";

                var label = d.banding && d.banding.periode ? d.banding.periode.label : null;
                renderTren("kp-tren-masuk", d.banding && d.banding.masuk, label);
                renderTren("kp-tren-keluar", d.banding && d.banding.keluar, label);
                renderTren("kp-tren-selisih", d.banding && d.banding.selisih, label);

                renderHarian(d.perHari, d.hariTerboros);
                renderKategori(d.perKategoriKeluar);
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
            });
    }

    K.pasangToolbarPeriode(muat);
    muat();
})();
