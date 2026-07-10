/**
 * Header Doc
 * Purpose: Store DURABEL pekerjaan tindak-lanjut pasca-reboot modem pelanggan. Wajib bertahan
 *          melewati `pm2 restart` (prod restart 7-13x/hari) karena bot sudah menjanjikan
 *          "saya cek lagi beberapa menit lagi" ke pelanggan — janji itu tak boleh hilang.
 * Caller: `lib/reboot-followup-service.js` (penjadwal + tick), test.
 * Deps: `fs`, `path`.
 * MainFuncs: `loadJobs`, `saveJobs`, `addJob`, `updateJob`, `removeJob`, `listDueJobs`, `findJobByJid`.
 * SideEffects: Membaca & menulis `database/reboot-followups.json` (atau `*_test.json` saat NODE_ENV=test).
 */
"use strict";

const fs = require("fs");
const path = require("path");

const MAX_JOBS = 500;

// Status siklus hidup satu pekerjaan follow-up.
const STATUS = {
    SCHEDULED: "scheduled", // menunggu jatuh tempo verifikasi
    ASKED: "asked", // modem terbukti balik, pelanggan sudah ditanya
    ESCALATED: "escalated", // modem tak balik / masih bermasalah → teknisi
    CLOSED: "closed" // selesai (pelanggan bilang beres / ditutup halus)
};

function resolveFilePath() {
    const name = process.env.NODE_ENV === "test" ? "reboot-followups_test.json" : "reboot-followups.json";
    return path.join(__dirname, "..", "database", name);
}

function loadJobs(filePath = resolveFilePath()) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn(`[REBOOTFU_STORE] Gagal membaca ${path.basename(filePath)}: ${err.message}`);
        return [];
    }
}

function saveJobs(jobs, filePath = resolveFilePath()) {
    try {
        const trimmed = Array.isArray(jobs) ? jobs.slice(-MAX_JOBS) : [];
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2));
        return true;
    } catch (err) {
        console.error(`[REBOOTFU_STORE] Gagal menulis ${path.basename(filePath)}: ${err.message}`);
        return false;
    }
}

/**
 * @param {object} job - { jid, userId, name, deviceId, pppoeUsername, routerId, reason, dueAt }
 * @returns {object|null} job tersimpan (dengan id), atau null bila gagal.
 */
function addJob(job, filePath = resolveFilePath()) {
    if (!job || !job.jid || !job.deviceId) {
        console.warn("[REBOOTFU_STORE] addJob ditolak: jid/deviceId wajib.");
        return null;
    }
    const jobs = loadJobs(filePath);
    const now = new Date().toISOString();
    const record = {
        id: `RFU-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        jid: job.jid,
        userId: job.userId || null,
        name: job.name || null,
        deviceId: job.deviceId,
        pppoeUsername: job.pppoeUsername || null,
        routerId: job.routerId || "default",
        // IP remote PPPoE saat reboot dipicu — dipakai runDeepCheck untuk memetakan jalur upstream.
        remoteAddr: job.remoteAddr || null,
        reason: job.reason || "unknown",
        rebootAt: now,
        dueAt: job.dueAt || now,
        attempts: 0,
        status: STATUS.SCHEDULED,
        createdAt: now,
        updatedAt: now
    };
    jobs.push(record);
    saveJobs(jobs, filePath);
    return record;
}

function updateJob(id, patch, filePath = resolveFilePath()) {
    const jobs = loadJobs(filePath);
    const idx = jobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    jobs[idx] = { ...jobs[idx], ...patch, updatedAt: new Date().toISOString() };
    saveJobs(jobs, filePath);
    return jobs[idx];
}

function removeJob(id, filePath = resolveFilePath()) {
    const jobs = loadJobs(filePath);
    const next = jobs.filter((j) => j.id !== id);
    if (next.length === jobs.length) return false;
    saveJobs(next, filePath);
    return true;
}

/**
 * Pekerjaan yang sudah jatuh tempo diverifikasi. Karena tick memindai `dueAt` setiap siklus,
 * pekerjaan otomatis "hidup lagi" setelah restart — tidak ada timer in-memory yang perlu dibangun ulang.
 */
function listDueJobs(now = Date.now(), filePath = resolveFilePath()) {
    return loadJobs(filePath).filter(
        (j) => j.status === STATUS.SCHEDULED && new Date(j.dueAt).getTime() <= now
    );
}

/**
 * Pekerjaan aktif milik satu pelanggan (dipakai state handler untuk mengaitkan balasan).
 */
function findJobByJid(jid, filePath = resolveFilePath()) {
    const active = [STATUS.SCHEDULED, STATUS.ASKED];
    return loadJobs(filePath)
        .filter((j) => j.jid === jid && active.includes(j.status))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
}

/**
 * Buang pekerjaan tuntas yang sudah lewat `maxAgeMs` supaya file tidak menggelembung.
 */
function pruneJobs(maxAgeMs = 7 * 24 * 60 * 60 * 1000, filePath = resolveFilePath()) {
    const cutoff = Date.now() - maxAgeMs;
    const jobs = loadJobs(filePath);
    const kept = jobs.filter((j) => {
        const done = j.status === STATUS.CLOSED || j.status === STATUS.ESCALATED;
        return !(done && new Date(j.updatedAt).getTime() < cutoff);
    });
    if (kept.length !== jobs.length) saveJobs(kept, filePath);
    return jobs.length - kept.length;
}

module.exports = {
    STATUS,
    resolveFilePath,
    loadJobs,
    saveJobs,
    addJob,
    updateJob,
    removeJob,
    listDueJobs,
    findJobByJid,
    pruneJobs
};
