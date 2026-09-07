/**
 * Header Doc
 * Purpose: Store DURABEL pemantauan redaman live saat perbaikan (RONDE 5 Fase 4, #b353). Teknisi
 *   minta `pantau redaman <plg/#tiket>` → 1 watch tersimpan; cron 1-menit membacanya & push update
 *   ke WA teknisi (smart: hanya saat berubah/target BAIK/heartbeat). WAJIB bertahan `pm2 restart`
 *   (prod 7-13x/hari) — kalau in-memory, pemantauan hilang di tengah perbaikan. Tulis ATOMIK
 *   (writeFileAtomicSync, #b345) + karantina berkas rusak (bukan [] senyap).
 * Caller: `message/handlers/redaman-check-handler.js` (daftar/stop), `lib/cron/jobs/redaman-watch.js` (tick).
 * Deps: `fs`, `path`, `lib/atomic-file`.
 * MainFuncs: loadWatches, saveWatches, addWatch, updateWatch, removeWatch, removeByRequester,
 *   listActive, countActive, pruneExpired.
 * SideEffects: Baca/tulis `database/redaman-watches.json` (atau `*_test.json` saat NODE_ENV=test).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { writeFileAtomicSync } = require("./atomic-file");

const MAX_STORE = 100; // jaring pengaman berkas (cap AKTIF dijaga di handler)

function resolveFilePath() {
    const name = process.env.NODE_ENV === "test" ? "redaman-watches_test.json" : "redaman-watches.json";
    return path.join(__dirname, "..", "database", name);
}

function loadWatches(filePath = resolveFilePath()) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn(`[REDAMAN_WATCH] Gagal baca ${path.basename(filePath)}: ${err.message}`);
        try {
            if (fs.existsSync(filePath)) {
                const cap = new Date().toISOString().replace(/[:.]/g, "-");
                fs.renameSync(filePath, `${filePath}.rusak-${cap}`);
                console.error(`[REDAMAN_WATCH] Berkas rusak DIKARANTINA (.rusak-${cap}) — jangan hapus sebelum diperiksa.`);
            }
        } catch (e2) { console.error(`[REDAMAN_WATCH] Gagal karantina: ${e2.message}`); }
        return [];
    }
}

function saveWatches(watches, filePath = resolveFilePath()) {
    try {
        const trimmed = Array.isArray(watches) ? watches.slice(-MAX_STORE) : [];
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        writeFileAtomicSync(filePath, JSON.stringify(trimmed, null, 2));
        return true;
    } catch (err) {
        console.error(`[REDAMAN_WATCH] Gagal tulis ${path.basename(filePath)}: ${err.message}`);
        return false;
    }
}

function countActive(now = Date.now(), filePath = resolveFilePath()) {
    return loadWatches(filePath).filter((w) => w && w.status === "active" && new Date(w.expiresAt).getTime() > now).length;
}

/**
 * @param {object} watch - { requesterJid, userId, name, pppoe, deviceId, ticketId?, intervalMs,
 *   changeThresholdDb?, targetDbm?, expiresAt, baseline?:{rx,status,at} }
 * @returns {object|null} watch tersimpan (dengan id) atau null.
 */
function addWatch(watch, filePath = resolveFilePath()) {
    if (!watch || !watch.requesterJid || watch.userId == null) return null;
    const watches = loadWatches(filePath);
    const now = new Date().toISOString();
    const record = {
        id: `RW-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        requesterJid: watch.requesterJid,
        userId: watch.userId,
        name: watch.name || null,
        pppoe: watch.pppoe || null,
        deviceId: watch.deviceId || null,
        ticketId: watch.ticketId || null,
        intervalMs: watch.intervalMs || 60000,
        // Override pribadi (#b356 prefs.pantau) — null = pakai config/default global saat decideNotify.
        changeThresholdDb: Number.isFinite(watch.changeThresholdDb) ? watch.changeThresholdDb : null,
        targetDbm: Number.isFinite(watch.targetDbm) ? watch.targetDbm : null,
        createdAt: now,
        expiresAt: watch.expiresAt || new Date(Date.now() + 30 * 60000).toISOString(),
        baseline: watch.baseline || null,
        lastRx: watch.baseline ? watch.baseline.rx : null,
        lastStatus: watch.baseline ? watch.baseline.status : null,
        lastReportAt: now,
        lastHeartbeatAt: now,
        targetAnnounced: false,
        status: "active",
    };
    watches.push(record);
    saveWatches(watches, filePath);
    return record;
}

function updateWatch(id, patch, filePath = resolveFilePath()) {
    const watches = loadWatches(filePath);
    const i = watches.findIndex((w) => w.id === id);
    if (i === -1) return null;
    watches[i] = { ...watches[i], ...patch };
    saveWatches(watches, filePath);
    return watches[i];
}

function removeWatch(id, filePath = resolveFilePath()) {
    const watches = loadWatches(filePath);
    const next = watches.filter((w) => w.id !== id);
    if (next.length === watches.length) return false;
    saveWatches(next, filePath);
    return true;
}

/** Hentikan semua watch aktif milik satu requester. @returns {number} jumlah dihentikan. */
function removeByRequester(requesterJid, filePath = resolveFilePath()) {
    const watches = loadWatches(filePath);
    const kept = watches.filter((w) => !(w.requesterJid === requesterJid && w.status === "active"));
    const stopped = watches.length - kept.length;
    if (stopped > 0) saveWatches(kept, filePath);
    return stopped;
}

function listActive(now = Date.now(), filePath = resolveFilePath()) {
    return loadWatches(filePath).filter((w) => w && w.status === "active" && new Date(w.expiresAt).getTime() > now + 1);
}

/** Buang watch selesai/kedaluwarsa lama (housekeeping). */
function pruneExpired(now = Date.now(), filePath = resolveFilePath()) {
    const watches = loadWatches(filePath);
    const kept = watches.filter((w) => w && w.status === "active" && new Date(w.expiresAt).getTime() > now);
    if (kept.length !== watches.length) saveWatches(kept, filePath);
    return watches.length - kept.length;
}

module.exports = {
    resolveFilePath, loadWatches, saveWatches, addWatch, updateWatch,
    removeWatch, removeByRequester, listActive, countActive, pruneExpired,
};
