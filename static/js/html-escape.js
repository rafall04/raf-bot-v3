/**
 * Header Doc
 * Purpose: Helper escaping bersama untuk seluruh halaman admin/teknisi/agen. Menyediakan
 *          `rafEscapeHtml` (teks & atribut) dan `rafEscapeJsString` (argumen string di dalam
 *          handler inline), plus `rafText` untuk menulis teks tanpa parsing HTML sama sekali.
 * Caller: Dimuat lewat `views/sb-admin/_head.php` sehingga tersedia di semua halaman yang
 *         memakai partial itu; dipakai `static/js/*.js` saat merender data dari API.
 * Deps: Tidak ada — sengaja tanpa dependensi agar bisa dimuat paling awal di <head>.
 * MainFuncs: `rafEscapeHtml`, `rafEscapeJsString`, `rafText`.
 * SideEffects: Mendaftarkan tiga fungsi di `window`.
 *
 * KENAPA ADA — dua pola lama yang keduanya salah:
 *
 *  1. `const div = document.createElement('div'); div.textContent = t; return div.innerHTML;`
 *     Trik ini disalin ke belasan berkas. Ia HANYA meloloskan `&`, `<`, `>` — TIDAK `"`
 *     maupun `'`. Dipakai untuk mengisi atribut (`value="..."`) atau argumen handler
 *     (`onclick="hapus(1,'...')"`), nama ber-apostrof seperti Ma'ruf/Nur'aini langsung
 *     memutus string JS: tombolnya DIAM TOTAL tanpa pesan galat, dan varian jahat
 *     `x'); fetch('/api/users/1',{method:'DELETE'}); //` benar-benar dieksekusi.
 *
 *  2. Meng-escape ke `&#39;` lalu "mengamankan" lagi dengan `.replace(/'/g, ...)`.
 *     Setelah escape tak ada lagi `'` mentah, jadi replace-nya tak pernah cocok — sementara
 *     parser HTML men-DECODE `&#39;` kembali menjadi `'` SEBELUM JS di-parse. Hasilnya sama:
 *     string handler putus.
 *
 * ATURAN PAKAI:
 *  - Teks & atribut HTML  -> `rafEscapeHtml(nilai)`
 *  - Argumen string di dalam `onclick="..."` -> JANGAN. Pindahkan ke `data-*` + event
 *    delegation. Bila benar-benar terpaksa, `rafEscapeHtml(rafEscapeJsString(nilai))`.
 *  - Teks murni ke elemen -> `rafText(el, nilai)` (memakai textContent, kebal injeksi).
 */
(function (global) {
    "use strict";

    var PETA_HTML = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
        "`": "&#96;"
    };

    /**
     * Escape untuk konteks HTML — aman untuk isi elemen MAUPUN nilai atribut ber-kutip.
     * Menutup `"` dan `'`, yang justru dilewatkan pola `textContent -> innerHTML`.
     */
    function rafEscapeHtml(nilai) {
        if (nilai === null || nilai === undefined) return "";
        return String(nilai).replace(/[&<>"'`]/g, function (c) {
            return PETA_HTML[c];
        });
    }

    /**
     * Escape untuk string literal JavaScript (di dalam kutip tunggal).
     * Backslash didahulukan supaya escape yang kita tambahkan sendiri tak ikut di-escape.
     */
    function rafEscapeJsString(nilai) {
        if (nilai === null || nilai === undefined) return "";
        return String(nilai)
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r");
    }

    /** Menulis teks apa adanya tanpa parsing HTML - pilihan paling aman bila tak butuh markup. */
    function rafText(el, nilai) {
        if (!el) return el;
        el.textContent = nilai === null || nilai === undefined ? "" : String(nilai);
        return el;
    }

    global.rafEscapeHtml = rafEscapeHtml;
    global.rafEscapeJsString = rafEscapeJsString;
    global.rafText = rafText;
})(typeof window !== "undefined" ? window : globalThis);

// Agar bisa diuji di Node (jest) tanpa DOM.
if (typeof module !== "undefined" && module.exports) {
    var _g = typeof window !== "undefined" ? window : globalThis;
    module.exports = {
        rafEscapeHtml: _g.rafEscapeHtml,
        rafEscapeJsString: _g.rafEscapeJsString,
        rafText: _g.rafText
    };
}
