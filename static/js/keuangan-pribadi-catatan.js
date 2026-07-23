/**
 * Header Doc
 * Purpose: Halaman CATATAN dompet — simpan catatan baru, saring (jenis/kategori/cari), render
 *          tabel + subtotal terfilter, hapus catatan, dan menjaga tautan unduh CSV tetap
 *          mengikuti filter yang sedang aktif.
 * Caller: views/sb-admin/keuangan-pribadi-catatan.php.
 * Deps: `window.KP` (static/js/keuangan-pribadi-common.js).
 * SideEffects: POST/DELETE catatan keuangan pribadi; pembaruan DOM.
 */
(function () {
    "use strict";
    var K = window.KP;
    var tbody = document.getElementById("kp-baris-tabel");
    if (!K || !tbody) return;

    function el(id) {
        return document.getElementById(id);
    }
    function nilai(id) {
        var e = el(id);
        return e ? String(e.value || "").trim() : "";
    }

    function queryFilter() {
        var q = "";
        if (nilai("kp-f-jenis")) q += "&kind=" + encodeURIComponent(nilai("kp-f-jenis"));
        if (nilai("kp-f-kategori")) q += "&category=" + encodeURIComponent(nilai("kp-f-kategori"));
        if (nilai("kp-f-cari")) q += "&search=" + encodeURIComponent(nilai("kp-f-cari"));
        return q;
    }

    function renderTabel(rows) {
        if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="kp-kosong">Tidak ada catatan yang cocok.</td></tr>';
            return;
        }
        tbody.innerHTML = rows
            .map(function (r) {
                var masuk = r.kind === "in";
                return (
                    "<tr><td>" + K.esc(r.tanggal) + "</td>" +
                    '<td><span class="kp-badge kp-badge--' + (masuk ? "masuk" : "keluar") + '">' +
                    (masuk ? "masuk" : "keluar") + "</span></td>" +
                    '<td class="kp-angka">' + K.rupiah(r.amount) + "</td>" +
                    "<td>" + K.esc(r.category) + "</td>" +
                    "<td>" + K.esc(r.note || "—") + "</td>" +
                    "<td>" + K.esc(r.source) + "</td>" +
                    '<td><button class="kp-hapus" data-id="' + r.id + '" title="Hapus catatan" aria-label="Hapus catatan">&times;</button></td></tr>'
                );
            })
            .join("");
    }

    function renderSubtotal(t) {
        var e = el("kp-subtotal");
        var reset = el("kp-f-reset");
        if (!e) return;
        if (!t || !t.aktif) {
            e.textContent = "";
            if (reset) reset.hidden = true;
            return;
        }
        e.textContent = t.jumlah + " terpilih · keluar " + K.rupiah(t.keluar) + " · masuk " + K.rupiah(t.masuk);
        if (reset) reset.hidden = false;
    }

    function isiKategori(daftar) {
        var sel = el("kp-f-kategori");
        if (!sel) return;
        var terpilih = sel.value;
        sel.innerHTML =
            '<option value="">Semua</option>' +
            (daftar || [])
                .map(function (k) {
                    return '<option value="' + K.esc(k) + '">' + K.esc(k) + "</option>";
                })
                .join("");
        // Pertahankan pilihan pemakai walau daftar dirender ulang tiap muat.
        if (terpilih && (daftar || []).indexOf(terpilih) !== -1) sel.value = terpilih;
    }

    function muat() {
        var q = K.queryPeriode() + queryFilter();
        var ekspor = el("kp-ekspor");
        if (ekspor) ekspor.setAttribute("href", "/api/keuangan-pribadi/ekspor" + q);

        K.ambil("/api/keuangan-pribadi/catatan" + q)
            .then(function (j) {
                isiKategori(j.kategoriTersedia);
                renderSubtotal(j.terfilter);
                renderTabel(j.data || []);
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
                tbody.innerHTML = '<tr><td colspan="7" class="kp-kosong">Gagal memuat.</td></tr>';
            });
    }

    // Ketikan pencarian ditunda 300 ms — tanpa itu tiap huruf memicu satu permintaan.
    var timer = null;
    function muatTertunda() {
        clearTimeout(timer);
        timer = setTimeout(muat, 300);
    }

    el("kp-form").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var tombol = el("kp-simpan");
        tombol.disabled = true;
        K.ambil("/api/keuangan-pribadi/catatan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                kind: nilai("kp-jenis"),
                amount: nilai("kp-nominal"),
                note: nilai("kp-catatan"),
                tanggal: nilai("kp-tanggal") || undefined
            })
        })
            .then(function (j) {
                K.pesan("Tercatat " + K.rupiah(j.data.amount) + " (" + j.data.category + ").", "ok");
                el("kp-nominal").value = "";
                el("kp-catatan").value = "";
                el("kp-nominal").focus();
                muat();
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
            })
            .finally(function () {
                tombol.disabled = false;
            });
    });

    tbody.addEventListener("click", function (ev) {
        var btn = ev.target.closest(".kp-hapus");
        if (!btn || !window.confirm("Hapus catatan ini?")) return;
        K.ambil("/api/keuangan-pribadi/catatan/" + encodeURIComponent(btn.getAttribute("data-id")), { method: "DELETE" })
            .then(function () {
                K.pesan("Catatan dihapus.", "ok");
                muat();
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
            });
    });

    el("kp-f-jenis").addEventListener("change", muat);
    el("kp-f-kategori").addEventListener("change", muat);
    el("kp-f-cari").addEventListener("input", muatTertunda);
    el("kp-f-reset").addEventListener("click", function () {
        el("kp-f-jenis").value = "";
        el("kp-f-kategori").value = "";
        el("kp-f-cari").value = "";
        muat();
    });

    el("kp-tanggal").value = K.hariIni();
    K.pasangToolbarPeriode(muat);
    muat();
})();
