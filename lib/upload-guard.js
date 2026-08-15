/**
 * Header Doc
 * Purpose: Penjaga BERSAMA untuk seluruh `multer.diskStorage` — memastikan segmen path yang
 *          berasal dari request tak bisa keluar dari direktori upload, dan ekstensi berkas tak
 *          bisa ditentukan pengunggah.
 * Caller: `routes/api-psb-routes.js`, `routes/tickets-shared.js`, `routes/public.js`.
 * Deps: `fs`, `path`, `./path-helper` (`isSegmenPathAman`, `assertDiDalamDirektori`).
 * MainFuncs: `ekstensiGambarAman`, `buatDestinationAman`.
 * SideEffects: `mkdirSync` pada direktori tujuan yang SUDAH divalidasi.
 *
 * KENAPA ADA: #b229 menutup traversal `ticketId` pada SATU jalur upload (tickets-shared storage
 * pertama) dengan menambal di tempat. Audit ulang menemukan cacat yang PERSIS SAMA masih ada di:
 *   - `routes/api-psb-routes.js`  — `tempId` mentah dari body/query/header, TANPA penjaga apa pun
 *   - `routes/tickets-shared.js`  — storage KEDUA memanggil helper yang melempar, tapi tanpa
 *                                   try/catch, jadi lemparannya tak tertangani
 *   - `routes/public.js`          — pola sama
 * Menambal instans, bukan kelasnya, adalah alasan lubang yang sama muncul lagi tiga kali.
 * Modul ini menjadikannya SATU implementasi.
 *
 * DAMPAK yang membuatnya kritis: penulisan berkas sembarang oleh peran STAF TERENDAH (teknisi)
 * bisa menimpa `static/js/html-escape.js` — dimuat `views/sb-admin/_head.php` di SETIAP halaman
 * admin/teknisi — sehingga skrip penyerang berjalan di sesi admin. Varian `.php` bisa menimpa
 * `views/sb-admin/404.php` yang dieksekusi PHP CLI lewat `res.render`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
// Diambil MALAS (lazy) di dalam fungsi, bukan destructure saat impor. Alasannya bukan gaya:
// suite yang mem-`jest.mock` lib/path-helper secara PARSIAL akan membuat destructure di puncak
// modul membeku jadi `undefined` selamanya, dan galatnya muncul jauh dari penyebabnya
// ("isSegmenPathAman is not a function" di dalam multer). Dengan lazy, mock parsial tetap
// terbaca dan seam-nya tetap satu.
const pathHelper = require("./path-helper");

// Ekstensi yang boleh mendarat di disk. Ekstensi TIDAK diambil dari `originalname` begitu saja:
// `fileFilter` multer hanya memeriksa `file.mimetype`, dan mimetype itu dikirim KLIEN — jadi
// `pwn.php` bertipe `image/png` lolos filter dan tersimpan sebagai `.php`.
const EKSTENSI_GAMBAR_AMAN = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"]);

/**
 * Ekstensi aman untuk sebuah nama berkas unggahan. Yang tak dikenal dipaksa `.jpg`.
 * Sengaja MEMAKSA, bukan menolak: berkasnya memang gambar, hanya namanya yang tak dipercaya.
 */
function ekstensiGambarAman(originalname, bawaan = ".jpg") {
    const ext = String(path.extname(originalname || "") || "").toLowerCase();
    return EKSTENSI_GAMBAR_AMAN.has(ext) ? ext : bawaan;
}

/**
 * Membangun fungsi `destination` multer yang aman.
 *
 * @param {object} opsi
 * @param {string} opsi.namespace     Sub-folder di bawah `uploads/` (mis. "psb", "reports").
 * @param {Function} opsi.ambilSegmen (req) => string — segmen milik-request (tempId/ticketId).
 * @param {Function} [opsi.ambilTahunBulan] (req, segmen) => {tahun, bulan}.
 * @param {string} opsi.currentDir    `__dirname` pemanggil.
 * @param {Function} [opsi.saatDitolak] (req, segmen) => void — hook log.
 * @returns {Function} destination(req, file, cb) siap dipakai multer.
 */
function buatDestinationAman({ namespace, ambilSegmen, ambilTahunBulan, currentDir, saatDitolak }) {
    // Base dir lewat helper yang SAMA dengan jalur upload lain — itu satu-satunya seam yang
    // bisa dialihkan tes ke direktori sementara. Menghitungnya sendiri di sini membuat tes
    // menulis ke uploads/ SUNGGUHAN.
    const baseDir = pathHelper.getUploadsPath(namespace, currentDir);

    return function destination(req, file, cb) {
        let segmen;
        try {
            segmen = ambilSegmen(req);
        } catch (_e) {
            segmen = null;
        }

        // MENOLAK, bukan membersihkan diam-diam. Nilai tak aman berarti pemanggilnya salah
        // atau sedang menyerang — membersihkannya hanya menyembunyikan keduanya.
        if (!pathHelper.isSegmenPathAman(segmen)) {
            if (typeof saatDitolak === "function") saatDitolak(req, segmen);
            console.warn(
                `[UPLOAD_GUARD] Tujuan upload ditolak — segmen tak aman pada namespace "${namespace}": ${String(segmen)}`
            );
            return cb(new Error("Identitas unggahan tidak valid."), null);
        }

        let tahun;
        let bulan;
        try {
            const tb = typeof ambilTahunBulan === "function" ? ambilTahunBulan(req, segmen) : null;
            const sekarang = new Date();
            tahun = String((tb && tb.tahun) || sekarang.getFullYear()).replace(/[^0-9]/g, "");
            bulan = String((tb && tb.bulan) || String(sekarang.getMonth() + 1).padStart(2, "0")).replace(/[^0-9]/g, "");
        } catch (_e) {
            const sekarang = new Date();
            tahun = String(sekarang.getFullYear());
            bulan = String(sekarang.getMonth() + 1).padStart(2, "0");
        }
        if (!tahun) tahun = "tanpa-tahun";
        if (!bulan) bulan = "tanpa-bulan";

        let uploadDir;
        try {
            // Sabuk pengaman kedua: sekalipun validasi segmen di atas suatu saat dilonggarkan,
            // ini tetap menolak hasil yang keluar dari `uploads/<namespace>`.
            uploadDir = pathHelper.assertDiDalamDirektori(baseDir, path.join(baseDir, tahun, bulan, segmen));
        } catch (error) {
            console.error(`[UPLOAD_GUARD] Path keluar dari direktori upload: ${error.message}`);
            return cb(new Error("Identitas unggahan tidak valid."), null);
        }

        try {
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        } catch (error) {
            console.error("[UPLOAD_GUARD] Gagal menyiapkan folder upload:", error.message);
            return cb(new Error("Gagal menyiapkan folder upload."), null);
        }

        return cb(null, uploadDir);
    };
}

module.exports = {
    EKSTENSI_GAMBAR_AMAN,
    ekstensiGambarAman,
    buatDestinationAman
};
