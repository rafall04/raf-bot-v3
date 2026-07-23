/**
 * Header Doc
 * Purpose: Helper bersama SEMUA halaman dompet keuangan pribadi — pengambil JSON (dengan
 *          penanganan sesi habis), format rupiah, escape HTML, pemberitahuan, serta
 *          penyimpan/pembaca PERIODE yang dibagi antar halaman lewat localStorage sehingga
 *          berpindah tab tidak mengulang pilihan bulan.
 * Caller: `views/sb-admin/_kp-shell-end.php` (dimuat di semua halaman dompet), dipakai
 *         `keuangan-pribadi-{ringkasan,catatan,anggaran,pengaturan}.js`.
 * Deps: fetch API, localStorage.
 * MainFuncs: `window.KP` — { ambil, rupiah, esc, pesan, periode, setPeriode, queryPeriode }.
 * SideEffects: Menulis localStorage `kpPeriode`; bisa mengarahkan ke halaman masuk saat 401.
 */
(function () {
    "use strict";

    function esc(s) {
        var d = document.createElement("div");
        d.textContent = s == null ? "" : String(s);
        return d.innerHTML;
    }

    function rupiah(n) {
        return "Rp" + (Number(n) || 0).toLocaleString("id-ID");
    }

    function pesan(teks, tone) {
        var el = document.getElementById("kp-alert");
        if (!el) return;
        if (!teks) {
            el.hidden = true;
            return;
        }
        el.textContent = teks;
        el.setAttribute("data-tone", tone || "ok");
        el.hidden = false;
        if (tone === "ok") {
            setTimeout(function () {
                el.hidden = true;
            }, 3500);
        }
    }

    function ambil(url, opsi) {
        return fetch(url, opsi).then(function (r) {
            // Sesi dompet berumur 8 jam. Kalau habis di tengah pemakaian, antar langsung ke
            // halaman masuk — bukan menampilkan "gagal memuat" yang membingungkan.
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

    function bulanIni() {
        var d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    }

    function hariIni() {
        var d = new Date();
        return (
            d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
        );
    }

    /**
     * Periode dipakai bersama Ringkasan & Catatan. Disimpan supaya berpindah tab tidak
     * mereset pilihan bulan — dulu semuanya satu halaman jadi soal ini tak pernah muncul.
     */
    function periode() {
        var bawaan = { mode: "bulan", bulan: bulanIni(), dari: "", sampai: "" };
        try {
            var s = JSON.parse(window.localStorage.getItem("kpPeriode") || "null");
            if (s && typeof s === "object") return Object.assign(bawaan, s);
        } catch (_e) {
            /* localStorage diblokir → pakai bawaan */
        }
        return bawaan;
    }

    function setPeriode(p) {
        try {
            window.localStorage.setItem("kpPeriode", JSON.stringify(p));
        } catch (_e) {
            /* abaikan */
        }
    }

    /** Rentang Senin–Minggu (konvensi Indonesia), bukan "7 hari terakhir". */
    function rentangMinggu(geser) {
        var d = new Date();
        var hari = d.getDay(); // 0 = Minggu
        var mundur = hari === 0 ? 6 : hari - 1;
        var senin = new Date(d.getFullYear(), d.getMonth(), d.getDate() - mundur + (geser || 0) * 7);
        var minggu = new Date(senin.getFullYear(), senin.getMonth(), senin.getDate() + 6);
        var f = function (x) {
            return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
        };
        return { dari: f(senin), sampai: f(minggu) };
    }

    function queryPeriode(p) {
        var q = p || periode();
        if (q.mode === "minggu" || q.mode === "minggu-lalu") {
            var r = rentangMinggu(q.mode === "minggu-lalu" ? -1 : 0);
            return "?from=" + encodeURIComponent(r.dari) + "&to=" + encodeURIComponent(r.sampai);
        }
        if (q.mode === "rentang" && q.dari && q.sampai) {
            var dari = q.dari;
            var sampai = q.sampai;
            // Tanggal terbalik dibetulkan diam-diam — maksud pemakai jelas.
            if (dari > sampai) {
                var t = dari;
                dari = sampai;
                sampai = t;
            }
            return "?from=" + encodeURIComponent(dari) + "&to=" + encodeURIComponent(sampai);
        }
        return "?month=" + encodeURIComponent(q.bulan || bulanIni());
    }

    /** Rakit toolbar periode ke dalam elemen ber-id `kp-toolbar`. `onUbah` dipanggil tiap ganti. */
    function pasangToolbarPeriode(onUbah) {
        var wadah = document.getElementById("kp-toolbar");
        if (!wadah) return;
        var p = periode();

        wadah.innerHTML =
            '<div class="kp-toolbar__isi">' +
            '<select id="kp-mode" class="kp-pilih" aria-label="Mode periode">' +
            '<option value="bulan">Per bulan</option>' +
            '<option value="minggu">Minggu ini</option>' +
            '<option value="minggu-lalu">Minggu lalu</option>' +
            '<option value="rentang">Rentang tanggal</option>' +
            "</select>" +
            '<input type="month" id="kp-bulan" class="kp-input" aria-label="Bulan">' +
            '<span id="kp-rentang" class="kp-toolbar__isi" hidden>' +
            '<input type="date" id="kp-dari" class="kp-input" aria-label="Dari tanggal">' +
            '<span class="kp-sep">–</span>' +
            '<input type="date" id="kp-sampai" class="kp-input" aria-label="Sampai tanggal">' +
            "</span>" +
            "</div>";

        var elMode = document.getElementById("kp-mode");
        var elBulan = document.getElementById("kp-bulan");
        var elRentang = document.getElementById("kp-rentang");
        var elDari = document.getElementById("kp-dari");
        var elSampai = document.getElementById("kp-sampai");

        elMode.value = p.mode;
        elBulan.value = p.bulan || bulanIni();
        elDari.value = p.dari || (p.bulan || bulanIni()) + "-01";
        elSampai.value = p.sampai || hariIni();

        function terapkan() {
            var rentang = elMode.value === "rentang";
            // Preset minggu tak butuh kontrol apa pun — rentangnya dihitung sendiri.
            var preset = elMode.value === "minggu" || elMode.value === "minggu-lalu";
            elRentang.hidden = !rentang;
            elBulan.hidden = rentang || preset;
            var baru = {
                mode: elMode.value,
                bulan: elBulan.value || bulanIni(),
                dari: elDari.value,
                sampai: elSampai.value
            };
            setPeriode(baru);
            if (typeof onUbah === "function") onUbah(baru);
        }

        [elMode, elBulan, elDari, elSampai].forEach(function (el) {
            el.addEventListener("change", terapkan);
        });

        // Terapkan sekali di awal untuk menyembunyikan kontrol yang tak relevan.
        var rentangAwal = elMode.value === "rentang";
        var presetAwal = elMode.value === "minggu" || elMode.value === "minggu-lalu";
        elRentang.hidden = !rentangAwal;
        elBulan.hidden = rentangAwal || presetAwal;
    }

    window.KP = {
        esc: esc,
        rupiah: rupiah,
        pesan: pesan,
        ambil: ambil,
        bulanIni: bulanIni,
        hariIni: hariIni,
        periode: periode,
        setPeriode: setPeriode,
        queryPeriode: queryPeriode,
        pasangToolbarPeriode: pasangToolbarPeriode
    };
})();
