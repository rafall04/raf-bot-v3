/**
 * Header Doc
 * Purpose: Halaman ANGGARAN dompet — tampilkan tiap kategori beserta realisasi bulan berjalan
 *          dan pagunya dalam satu tabel yang bisa diedit langsung; simpan per baris.
 *          Menggantikan rangkaian `prompt()` yang tak memperlihatkan keadaan keseluruhan.
 * Caller: views/sb-admin/keuangan-pribadi-anggaran.php.
 * Deps: `window.KP` (static/js/keuangan-pribadi-common.js).
 * SideEffects: PUT /api/keuangan-pribadi/pagu; pembaruan DOM.
 */
(function () {
    "use strict";
    var K = window.KP;
    var tbody = document.getElementById("kp-baris-pagu");
    if (!K || !tbody) return;

    function baris(kat, terpakai, pagu, lewat) {
        return (
            '<tr data-kategori="' + K.esc(kat) + '">' +
            "<td>" + K.esc(kat) +
            (lewat ? '<span class="kp-tanda-lewat">lewat pagu</span>' : "") + "</td>" +
            '<td class="kp-angka">' + K.rupiah(terpakai) + "</td>" +
            '<td><input type="text" class="kp-input kp-pagu-input" value="' + (pagu ? K.esc(String(pagu)) : "") +
            '" placeholder="belum ada pagu" aria-label="Pagu ' + K.esc(kat) + '"></td>' +
            '<td><button type="button" class="kp-tombol kp-tombol--halus kp-pagu-simpan">Simpan</button></td></tr>'
        );
    }

    function muat() {
        // Realisasi diambil dari ringkasan BULAN BERJALAN, bukan periode tersimpan: pagu ini
        // bersifat bulanan, jadi membandingkannya dengan rentang bebas akan menyesatkan.
        K.ambil("/api/keuangan-pribadi/ringkasan?month=" + encodeURIComponent(K.bulanIni()))
            .then(function (j) {
                var d = j.data || {};
                var kat = d.perKategoriKeluar || [];
                if (!kat.length) {
                    tbody.innerHTML =
                        '<tr><td colspan="4" class="kp-kosong">Belum ada kategori. Catat beberapa pengeluaran dulu, atau tambahkan di bawah.</td></tr>';
                    return;
                }
                tbody.innerHTML = kat
                    .map(function (k) {
                        return baris(k.category, k.total, k.pagu, k.lewatPagu);
                    })
                    .join("");
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
                tbody.innerHTML = '<tr><td colspan="4" class="kp-kosong">Gagal memuat.</td></tr>';
            });
    }

    function simpan(kategori, nominal, tombol) {
        if (tombol) tombol.disabled = true;
        return K.ambil("/api/keuangan-pribadi/pagu", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: kategori, amount: nominal })
        })
            .then(function (j) {
                K.pesan(
                    j.data.dihapus ? "Pagu " + kategori + " dicabut." : "Pagu " + kategori + " = " + K.rupiah(j.data.amount),
                    "ok"
                );
                muat();
            })
            .catch(function (e) {
                K.pesan(e.message, "error");
            })
            .finally(function () {
                if (tombol) tombol.disabled = false;
            });
    }

    tbody.addEventListener("click", function (ev) {
        var btn = ev.target.closest(".kp-pagu-simpan");
        if (!btn) return;
        var tr = btn.closest("tr");
        simpan(tr.getAttribute("data-kategori"), tr.querySelector(".kp-pagu-input").value, btn);
    });

    // Enter di dalam input = simpan baris itu; mengetik lalu menekan Enter adalah refleks.
    tbody.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" || !ev.target.classList.contains("kp-pagu-input")) return;
        ev.preventDefault();
        var tr = ev.target.closest("tr");
        simpan(tr.getAttribute("data-kategori"), ev.target.value, tr.querySelector(".kp-pagu-simpan"));
    });

    document.getElementById("kp-form-pagu").addEventListener("submit", function (ev) {
        ev.preventDefault();
        var kat = document.getElementById("kp-pagu-kategori");
        var nom = document.getElementById("kp-pagu-nominal");
        simpan(kat.value.trim().toLowerCase(), nom.value, document.getElementById("kp-pagu-simpan")).then(function () {
            kat.value = "";
            nom.value = "";
        });
    });

    muat();
})();
