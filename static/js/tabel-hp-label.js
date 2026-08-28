/**
 * Header Doc
 * Purpose : Menstempel `data-label` otomatis pada tiap <td> di tabel ber-kelas
 *           `tabel-tumpuk-hp`, supaya pola tumpuk-kartu di layar HP menampilkan nama
 *           kolomnya (`td::before { content: attr(data-label) }`, static/css/tabel-hp.css).
 * Caller  : views/sb-admin/_head.php (semua halaman panel, tanpa defer).
 * Deps    : tidak ada (DOM murni). Sengaja TIDAK bergantung jQuery/DataTables supaya
 *           tabel rakitan tangan lewat innerHTML ikut tertangani.
 * MainFuncs: stempel(), pantau()
 * SideEffects: menulis atribut data-label pada <td>; memasang MutationObserver per tabel.
 *
 * KENAPA BERSAMA, BUKAN DISALIN PER HALAMAN — pola lamanya ditulis ulang di tiap berkas JS
 * dengan selektor tabel tulis tangan (`document.querySelectorAll("#kasbonTable thead th")`).
 * Menyebarkannya ke 25 halaman berarti 25 salinan yang pasti melenceng saat kolom berubah.
 *
 * KENAPA MutationObserver, BUKAN `createdRow` DataTables:
 *   - separuh halaman daftar panel ini TIDAK memakai DataTables (18 dari 37 terukur) —
 *     barisnya dirakit sendiri lewat innerHTML, dan `createdRow` tak pernah jalan di sana;
 *   - halaman yang PUNYA `createdRow` sendiri akan menimpa default global kalau dipasang
 *     lewat $.fn.dataTable.defaults.
 * Observer menangkap keduanya, apa pun cara barisnya muncul.
 *
 * !! Label diambil dari <thead>, BUKAN daftar nama tulis tangan. Kolom bisa
 * disembunyikan/ditampilkan saat runtime, dan daftar tangan selalu ketinggalan.
 */
"use strict";

(function () {
    var KELAS = "tabel-tumpuk-hp";

    /** Judul tiap kolom dari <thead> baris terakhir (baris terdalam bila header bertingkat). */
    function judulKolom(tabel) {
        var baris = tabel.querySelectorAll("thead tr");
        if (!baris.length) return [];
        var th = baris[baris.length - 1].querySelectorAll("th");
        var out = [];
        for (var i = 0; i < th.length; i++) {
            // textContent ikut membawa teks tombol sortir/ikon; ambil barisnya saja lalu rapikan.
            out.push((th[i].textContent || "").replace(/\s+/g, " ").trim());
        }
        return out;
    }

    function stempel(tabel) {
        var judul = judulKolom(tabel);
        if (!judul.length) return;
        var baris = tabel.querySelectorAll("tbody tr");
        for (var i = 0; i < baris.length; i++) {
            var sel = baris[i].children;
            // Baris keadaan-kosong ("Belum ada data") memakai colspan — tak punya kolom untuk
            // dilabeli, dan memberinya label justru memunculkan judul palsu di kartunya.
            if (sel.length === 1 && sel[0].hasAttribute("colspan")) continue;
            for (var k = 0; k < sel.length && k < judul.length; k++) {
                if (sel[k].tagName !== "TD") continue;
                // Label tulis tangan menang: halaman boleh memberi nama lebih jelas
                // daripada judul kolomnya.
                if (sel[k].hasAttribute("data-label")) continue;
                if (judul[k]) sel[k].setAttribute("data-label", judul[k]);
            }
        }
    }

    function pantau(tabel) {
        if (tabel.__rafLabelDipantau) return;
        tabel.__rafLabelDipantau = true;
        stempel(tabel);
        var tbody = tabel.querySelector("tbody");
        if (!tbody || typeof MutationObserver !== "function") return;
        var jadwal = null;
        var obs = new MutationObserver(function () {
            // Digabung: DataTables & innerHTML mengganti banyak baris sekaligus, dan
            // menstempel ulang per mutasi akan mengulang kerja yang sama puluhan kali.
            if (jadwal) return;
            jadwal = setTimeout(function () { jadwal = null; stempel(tabel); }, 0);
        });
        obs.observe(tbody, { childList: true, subtree: true });
    }

    function sapu() {
        var tabel = document.querySelectorAll("table." + KELAS);
        for (var i = 0; i < tabel.length; i++) pantau(tabel[i]);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", sapu);
    } else {
        sapu();
    }

    // Tabel yang dibuat SETELAH halaman siap (mis. panel yang dirender belakangan).
    if (typeof MutationObserver === "function") {
        document.addEventListener("DOMContentLoaded", function () {
            new MutationObserver(function (mut) {
                for (var i = 0; i < mut.length; i++) {
                    for (var k = 0; k < mut[i].addedNodes.length; k++) {
                        var n = mut[i].addedNodes[k];
                        if (!n || n.nodeType !== 1) continue;
                        if (n.tagName === "TABLE" && n.classList.contains(KELAS)) pantau(n);
                        else if (n.querySelectorAll) {
                            var dalam = n.querySelectorAll("table." + KELAS);
                            for (var j = 0; j < dalam.length; j++) pantau(dalam[j]);
                        }
                    }
                }
            }).observe(document.body, { childList: true, subtree: true });
        });
    }

    // Dibuka untuk halaman yang perlu menstempel ulang secara eksplisit.
    window.rafStempelLabelTabel = stempel;
})();
