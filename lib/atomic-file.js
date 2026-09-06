/**
 * Header Doc
 * Purpose: Tulis berkas secara ATOMIK (tmp + rename) supaya proses yang mati di tengah tulis
 *   (PM2 SIGKILL setelah kill_timeout / OOM max_memory_restart / listrik padam) TAK PERNAH
 *   meninggalkan berkas terpotong. Khusus config.json ini kritis: JSON rusak = bot gagal boot
 *   total (CONFIG_FATAL) sampai diperbaiki manual. Dipakai semua penulis config.json.
 * Caller: routes/*-config/*-routes, routes/invoice.js, routes/olt.js, routes/cctv-admin, dll +
 *   lib/env-config (saveConfigAtomic).
 * Deps: `fs`.
 * MainFuncs: `writeFileAtomicSync`.
 * SideEffects: Menulis berkas tujuan (via tmp+rename di direktori yang sama).
 */
"use strict";

const realFs = require("fs");

/**
 * Tulis `content` ke `filePath` secara atomik: tulis ke `<filePath>.tmp-<pid>` lalu `renameSync`.
 * `rename` dalam satu filesystem bersifat atomik, jadi pembaca hanya pernah melihat isi LAMA yang
 * utuh ATAU isi BARU yang utuh — tak pernah setengah jadi. Melempar bila gagal (caller balas 500).
 * @param {string} filePath
 * @param {string|Buffer} content
 * @param {object} [fsImpl] modul fs yang di-inject (untuk route ber-DI/uji); default `require('fs')`.
 */
function writeFileAtomicSync(filePath, content, fsImpl) {
    const fs = fsImpl || realFs;
    const tmp = `${filePath}.tmp-${process.pid}`;
    try {
        fs.writeFileSync(tmp, content, typeof content === "string" ? "utf8" : undefined);
        fs.renameSync(tmp, filePath);
    } catch (err) {
        try { if (fs.existsSync && fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_e) { /* abaikan sisa tmp */ }
        throw err;
    }
}

module.exports = { writeFileAtomicSync };
