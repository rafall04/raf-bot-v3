/**
 * Header Doc
 * Purpose: Store DURABEL jeda antar-alert redaman per device. Harus bertahan melewati
 *          `pm2 restart` — kalau tidak, jeda 12 jam yang disetel pemilik sebenarnya cuma
 *          "sejak restart terakhir".
 * Caller: `lib/cron/jobs/redaman-check.js`, test.
 * Deps: `fs`, `path`.
 * MainFuncs: `resolveFilePath`, `muat`, `simpan`, `masihDalamCooldown`, `tandaiTerkirim`, `prune`.
 * SideEffects: Membaca & menulis `database/redaman-alert-cooldown.json`
 *          (atau `*_test.json` saat NODE_ENV=test).
 *
 * KENAPA ADA — cooldown-nya dulu `Map` in-memory:
 *
 *     const lastAlertSentByDeviceId = new Map();   // hilang tiap proses mati
 *
 * Terukur di produksi 2026-08-16: cron redaman berjadwal `0 * * * *` (TIAP JAM, bukan tiap
 * 6 jam seperti dikira bawaannya), dan PM2 mencatat 27 restart pada kedua bot. Tiap restart
 * mengosongkan Map, jadi modem yang kronis buruk bisa mengalert kembali pada siklus jam
 * berikutnya — jauh lebih sering daripada 12 jam yang dimaksudkan. Menulisnya ke disk membuat
 * jeda itu berarti apa adanya.
 *
 * Bentuk file sengaja rata (deviceId → epoch ms) supaya murah dibaca sekali per siklus dan
 * ditulis sekali di akhir — bukan satu IO per device.
 */
"use strict";

const fs = require("fs");
const path = require("path");

/** Batas atas entri supaya file tak menggelembung kalau device datang-pergi. */
const MAKS_ENTRI = 5000;

function resolveFilePath() {
    const nama = process.env.NODE_ENV === "test"
        ? "redaman-alert-cooldown_test.json"
        : "redaman-alert-cooldown.json";
    return path.join(__dirname, "..", "database", nama);
}

/** @returns {Object<string, number>} peta deviceId → epoch ms alert terakhir. */
function muat(filePath = resolveFilePath()) {
    try {
        if (!fs.existsSync(filePath)) return {};
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const bersih = {};
        for (const [id, ts] of Object.entries(parsed)) {
            const n = Number(ts);
            if (id && Number.isFinite(n) && n > 0) bersih[id] = n;
        }
        return bersih;
    } catch (err) {
        // File rusak tak boleh mematikan cron — mulai dari kosong (paling buruk: satu alert ekstra).
        console.warn(`[REDAMAN_COOLDOWN] Gagal membaca ${path.basename(filePath)}: ${err.message}`);
        return {};
    }
}

function simpan(peta, filePath = resolveFilePath()) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Tulis atomik: file separuh-tertulis akan terbaca sebagai rusak pada siklus berikutnya.
        const tmp = `${filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(peta || {}, null, 2));
        fs.renameSync(tmp, filePath);
        return true;
    } catch (err) {
        console.error(`[REDAMAN_COOLDOWN] Gagal menulis ${path.basename(filePath)}: ${err.message}`);
        return false;
    }
}

/** @param {number} cooldownMs 0 = tanpa jeda (selalu boleh kirim). */
function masihDalamCooldown(peta, deviceId, cooldownMs, sekarang = Date.now()) {
    if (!cooldownMs || cooldownMs <= 0) return false;
    const terakhir = peta && peta[deviceId];
    if (!Number.isFinite(terakhir)) return false;
    return sekarang - terakhir < cooldownMs;
}

/** Mutasi `peta` di memori; penulisan ke disk dilakukan sekali di akhir siklus. */
function tandaiTerkirim(peta, deviceId, sekarang = Date.now()) {
    if (!peta || !deviceId) return peta;
    peta[deviceId] = sekarang;
    return peta;
}

/**
 * Buang catatan yang sudah jauh melewati masa jeda (default 30 hari) dan potong bila
 * melebihi batas, menyisakan yang paling baru.
 */
function prune(peta, maxAgeMs = 30 * 24 * 3600000, sekarang = Date.now()) {
    if (!peta || typeof peta !== "object") return {};
    let entri = Object.entries(peta).filter(([, ts]) => sekarang - ts < maxAgeMs);
    if (entri.length > MAKS_ENTRI) {
        entri = entri.sort((a, b) => b[1] - a[1]).slice(0, MAKS_ENTRI);
    }
    return Object.fromEntries(entri);
}

module.exports = {
    MAKS_ENTRI,
    resolveFilePath,
    muat,
    simpan,
    masihDalamCooldown,
    tandaiTerkirim,
    prune,
};
