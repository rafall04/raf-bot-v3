/**
 * Header Doc
 * Purpose: SATU sumber kebenaran penyaringan halaman Monitor OLT — asal identitas baris dan
 *          kelas mutu redaman. Dipakai halaman admin DAN teknisi supaya keduanya tak bisa
 *          berbeda pendapat, dan bisa diuji tanpa DOM.
 * Caller: `static/js/admin-olt.js`, `static/js/teknisi-olt.js` (via window.OltFilterCore),
 *         `static/js/__tests__/olt-filter-core.test.js` (via module.exports).
 * Deps: tidak ada (murni).
 * MainFuncs: `saringIdentitas`, `kelasRedaman`, `cocokRedaman`.
 * SideEffects: tidak ada.
 *
 * KENAPA ADA: ONU EPON (HIOSO) tidak membawa description/serial, jadi satu-satunya identitas
 * baris berasal dari luar. Sebelum #b284 hanya pelanggan TERDAFTAR di bot yang dikenali —
 * pelanggan yang PPPoE-nya ada di MikroTik tapi belum didaftarkan admin tampil sebagai baris
 * kosong dan tak bisa dikerjakan teknisi. Terukur di produksi: 5 baris di Dander + 1 di
 * Tanjungharjo, tiga di antaranya redaman buruk (-26,2 · -28,54 · -26,58).
 */
(function () {
    "use strict";

    // Ambang HARUS sama dengan renderRxPower() di halaman; kalau berbeda, penyaring dan warna
    // di layar akan saling bertentangan dan teknisi tak tahu mana yang benar.
    var AMBANG_KRITIS = -25;
    var AMBANG_PERINGATAN = -20;

    /**
     * Saring baris menurut ASAL identitasnya.
     * @param {Array<Object>} rows baris dari /api/olt/onus
     * @param {string} mode 'all' | 'bot' | 'mikrotik' | 'tanpa' | 'matched' (kompat lama)
     * @returns {Array<Object>}
     */
    function saringIdentitas(rows, mode) {
        if (!Array.isArray(rows)) return [];
        switch (mode) {
            case "bot":
                return rows.filter(function (r) { return r && r.identitas_sumber === "bot"; });
            case "mikrotik":
                return rows.filter(function (r) { return r && r.identitas_sumber === "mikrotik"; });
            case "tanpa":
                return rows.filter(function (r) { return r && !r.identitas_sumber; });
            // Nilai lama dari tombol yang digantikan dropdown — jangan dipatahkan.
            case "matched":
                return rows.filter(function (r) { return r && r.matched; });
            default:
                return rows;
        }
    }

    /**
     * Kelas mutu redaman satu baris.
     *
     * !! Redaman ONU yang TIDAK online adalah pembacaan TERAKHIR sebelum putus, bukan kondisi
     * sekarang (OLT tetap memamerkan angka lama). Angka begitu masuk 'takterbaca', BUKAN
     * 'kritis'/'baik' — kalau tidak, daftar "kritis" akan penuh modem yang sudah lama mati.
     *
     * @param {Object} row baris dari /api/olt/onus
     * @returns {string} 'kritis' | 'peringatan' | 'baik' | 'takterbaca'
     */
    function kelasRedaman(row) {
        if (!row) return "takterbaca";
        if (row.status_known === false) return "takterbaca";
        if (row.rx_power_valid === false) return "takterbaca";
        if (row.rx_power === null || row.rx_power === undefined || row.rx_power === "" || row.rx_power === "N/A") {
            return "takterbaca";
        }
        var v = parseFloat(row.rx_power);
        if (isNaN(v)) return "takterbaca";
        if (v < AMBANG_KRITIS) return "kritis";
        if (v < AMBANG_PERINGATAN) return "peringatan";
        return "baik";
    }

    /**
     * @param {Object} row baris
     * @param {string} pilihan '' (semua) | 'kritis' | 'peringatan' | 'baik' | 'takterbaca'
     * @returns {boolean}
     */
    function cocokRedaman(row, pilihan) {
        if (!pilihan) return true;
        return kelasRedaman(row) === pilihan;
    }

    var api = {
        AMBANG_KRITIS: AMBANG_KRITIS,
        AMBANG_PERINGATAN: AMBANG_PERINGATAN,
        saringIdentitas: saringIdentitas,
        kelasRedaman: kelasRedaman,
        cocokRedaman: cocokRedaman
    };

    if (typeof window !== "undefined") window.OltFilterCore = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
