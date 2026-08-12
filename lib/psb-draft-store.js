/**
 * Header Doc
 * Purpose: Store DURABEL draft wizard PSB (data pelanggan + jejak bukti + lokasi) supaya kerja
 *          teknisi TIDAK hangus. Wizard PSB memakai conversation state in-memory yang mati sendiri
 *          setelah 15 menit dan ikut hilang tiap `pm2 restart` (prod restart 7-13x/hari) — padahal
 *          langkah yang paling sering MENUNGGU justru langkah terakhirnya: modem yang masih tertaut
 *          pelanggan lama hanya bisa dibebaskan ADMIN, dan itu praktis tak pernah selesai di bawah
 *          15 menit. Akibatnya rancangan lama menjamin satu hal: begitu teknisi kena ⛔, foto KTP,
 *          7 kolom data, foto rumah, dan share lokasi yang sudah dikirimnya PASTI hangus
 *          (insiden Tanjungharjo 2026-08-12). Foto fisiknya sendiri sudah aman di `uploads/psb/...`,
 *          jadi yang perlu diselamatkan cuma metadatanya — itulah isi store ini.
 * Caller: `message/handlers/state-domains/psb.state.js` (simpan tiap langkah, tawarkan LANJUT,
 *          hapus saat selesai/batal), test.
 * Deps: `fs`, `path`.
 * MainFuncs: `loadDrafts`, `saveDrafts`, `putDraft`, `getDraft`, `removeDraft`, `purgeExpired`.
 * SideEffects: Membaca & menulis `database/psb-drafts.json` (atau `*_test.json` saat NODE_ENV=test).
 */
"use strict";

const fs = require("fs");
const path = require("path");

// Batas atas jumlah draft tersimpan — jaring pengaman, bukan kuota operasional: satu area
// realistis hanya punya segelintir PSB berjalan bersamaan.
const MAX_DRAFTS = 200;

// Umur maksimal draft. Dipilih 48 jam supaya PSB yang tertahan menunggu admin (mis. dilaporkan
// sore, baru dibereskan besok pagi) TETAP bisa dilanjutkan, tapi draft basi tak menumpuk selamanya.
const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

function resolveFilePath() {
    const name = process.env.NODE_ENV === "test" ? "psb-drafts_test.json" : "psb-drafts.json";
    return path.join(__dirname, "..", "database", name);
}

function loadDrafts(filePath = resolveFilePath()) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn(`[PSB_DRAFT_STORE] Gagal membaca ${path.basename(filePath)}: ${err.message}`);
        return [];
    }
}

function saveDrafts(drafts, filePath = resolveFilePath()) {
    try {
        const trimmed = Array.isArray(drafts) ? drafts.slice(-MAX_DRAFTS) : [];
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(trimmed, null, 2));
        return true;
    } catch (err) {
        console.error(`[PSB_DRAFT_STORE] Gagal menulis ${path.basename(filePath)}: ${err.message}`);
        return false;
    }
}

/**
 * Buang draft yang lewat TTL. Dipanggil tiap baca supaya store tak perlu cron sendiri.
 * @returns {Array} draft yang masih hidup
 */
function purgeExpired(drafts, nowMs = Date.now()) {
    return (Array.isArray(drafts) ? drafts : []).filter((d) => {
        const t = Date.parse((d && d.updatedAt) || "");
        return Number.isFinite(t) ? (nowMs - t) <= DRAFT_TTL_MS : false;
    });
}

/**
 * Simpan/timpa draft milik satu teknisi. `ownerKey` WAJIB sender kanonik (bukan `@lid`) —
 * sama dengan key conversation state, supaya draft dan state selalu menunjuk orang yang sama.
 *
 * @param {string} ownerKey - stateSender kanonik.
 * @param {object} draft - { step, tempId, dir, data, ktpSaved, rumahSaved, lokasi, scheduleId, staff }
 * @returns {object|null} draft tersimpan, atau null bila ditolak/gagal.
 */
function putDraft(ownerKey, draft, filePath = resolveFilePath(), nowMs = Date.now()) {
    if (!ownerKey || !draft || !draft.data) {
        console.warn("[PSB_DRAFT_STORE] putDraft ditolak: ownerKey & draft.data wajib.");
        return null;
    }

    const nowIso = new Date(nowMs).toISOString();
    const others = purgeExpired(loadDrafts(filePath), nowMs).filter((d) => d && d.ownerKey !== ownerKey);
    const previous = loadDrafts(filePath).find((d) => d && d.ownerKey === ownerKey);

    const record = {
        ownerKey,
        step: draft.step || null,
        tempId: draft.tempId || null,
        dir: draft.dir || null,
        data: draft.data,
        ktpSaved: !!draft.ktpSaved,
        rumahSaved: !!draft.rumahSaved,
        lokasi: draft.lokasi || null,
        scheduleId: draft.scheduleId || null,
        staff: draft.staff || null,
        // `createdAt` dipertahankan dari draft lama supaya umur asli sesi tetap terbaca,
        // sementara TTL dihitung dari `updatedAt` (aktivitas terakhir).
        createdAt: (previous && previous.createdAt) || nowIso,
        updatedAt: nowIso
    };

    saveDrafts([...others, record], filePath);
    return record;
}

function getDraft(ownerKey, filePath = resolveFilePath(), nowMs = Date.now()) {
    if (!ownerKey) return null;
    const alive = purgeExpired(loadDrafts(filePath), nowMs);
    return alive.find((d) => d && d.ownerKey === ownerKey) || null;
}

function removeDraft(ownerKey, filePath = resolveFilePath(), nowMs = Date.now()) {
    if (!ownerKey) return false;
    const alive = purgeExpired(loadDrafts(filePath), nowMs);
    const next = alive.filter((d) => d && d.ownerKey !== ownerKey);
    if (next.length === alive.length) return false;
    saveDrafts(next, filePath);
    return true;
}

module.exports = {
    DRAFT_TTL_MS,
    MAX_DRAFTS,
    resolveFilePath,
    loadDrafts,
    saveDrafts,
    purgeExpired,
    putDraft,
    getDraft,
    removeDraft
};
