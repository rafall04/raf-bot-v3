/**
 * Header Doc
 * Purpose: Store DURABEL draft laporan gangguan pelanggan yang sudah "jadi" tapi masih menunggu
 *          foto. Wajib bertahan melewati `pm2 restart` (produksi restart 7-13x/hari) karena
 *          pelanggan SUDAH menerima balasan yang menyiratkan laporannya diproses.
 * Caller: `message/handlers/smart-report-handler.js` (simpan saat draft dibuat, buang saat
 *         dipromosikan/dibatalkan, pindai ulang saat boot & tick).
 * Deps: `fs`, `path`.
 * MainFuncs: `simpanDraft`, `hapusDraft`, `ambilDraft`, `listDraftKedaluwarsa`, `pruneDraft`.
 * SideEffects: Membaca & menulis `database/laporan-drafts.json`
 *              (atau `laporan-drafts_test.json` saat NODE_ENV=test).
 *
 * KENAPA ADA: draft hanya hidup di `stateStore` (objek memori) `conversation-handler.js`, dan
 * promosinya bergantung `setTimeout` 15 menit. Pelanggan lapor "internet mati", dibimbing
 * troubleshooting, menjawab "1" — bot menyiapkan `ticketData` LENGKAP berikut `ticketId` tapi
 * BELUM membuat tiketnya, lalu menunggu foto. Bila produksi restart 8 menit kemudian,
 * stateStore dan timernya lenyap: `promoteMatiDraftOnTimeout` tak pernah dipanggil, tak ada
 * tiket, teknisi tak tahu ada laporan, dan TIDAK ADA SATU BARIS LOG pun yang menandainya.
 */
"use strict";

const fs = require("fs");
const path = require("path");

// Batas atas supaya berkas tak tumbuh tanpa henti bila ada anomali.
const MAKS_DRAFT = 500;

// Selaras STATE_TIMEOUT conversation-handler (15 menit). Draft yang lebih tua dari ini
// dianggap ditinggalkan pelanggan dan layak dipromosikan jadi tiket.
const UMUR_KEDALUWARSA_MS = 15 * 60 * 1000;

function resolveFilePath() {
    const name =
        process.env.NODE_ENV === "test" ? "laporan-drafts_test.json" : "laporan-drafts.json";
    return path.join(__dirname, "..", "database", name);
}

function loadDrafts(filePath = resolveFilePath()) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const isi = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return Array.isArray(isi) ? isi : [];
    } catch (error) {
        // Berkas rusak tak boleh menjatuhkan bot — lebih baik kehilangan draft daripada mati.
        console.error("[LAPORAN_DRAFT] Gagal membaca store, dianggap kosong:", error.message);
        return [];
    }
}

function saveDrafts(drafts, filePath = resolveFilePath()) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(drafts.slice(-MAKS_DRAFT), null, 2), "utf8");
        return true;
    } catch (error) {
        console.error("[LAPORAN_DRAFT] Gagal menulis store:", error.message);
        return false;
    }
}

/**
 * Simpan/segarkan draft milik satu pengirim. Di-key `userId` (JID kanonik pengirim) — satu
 * pelanggan hanya punya satu draft aktif, persis seperti conversation state.
 */
function simpanDraft(userId, { step, ticketData, targetUser, deviceStatus }, filePath = resolveFilePath()) {
    if (!userId || !ticketData) return false;

    const drafts = loadDrafts(filePath).filter((d) => d.userId !== userId);
    drafts.push({
        userId,
        step: step || null,
        ticketData,
        targetUser: targetUser || null,
        deviceStatus: deviceStatus || null,
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now()
    });

    return saveDrafts(drafts, filePath);
}

function hapusDraft(userId, filePath = resolveFilePath()) {
    const drafts = loadDrafts(filePath);
    const sisa = drafts.filter((d) => d.userId !== userId);
    if (sisa.length === drafts.length) return false;
    return saveDrafts(sisa, filePath);
}

function ambilDraft(userId, filePath = resolveFilePath()) {
    return loadDrafts(filePath).find((d) => d.userId === userId) || null;
}

/**
 * Draft yang sudah melewati batas tunggu. Dipakai saat BOOT dan pada tick berkala — inilah
 * jaring pengaman yang menggantikan `setTimeout` yang hilang saat restart.
 */
function listDraftKedaluwarsa(now = Date.now(), filePath = resolveFilePath()) {
    return loadDrafts(filePath).filter(
        (d) => now - Number(d.createdAtMs || 0) >= UMUR_KEDALUWARSA_MS
    );
}

/** Buang draft sangat tua yang gagal dipromosikan berulang kali, agar store tak menumpuk. */
function pruneDraft(maxAgeMs = 24 * 60 * 60 * 1000, filePath = resolveFilePath()) {
    const now = Date.now();
    const drafts = loadDrafts(filePath);
    const sisa = drafts.filter((d) => now - Number(d.createdAtMs || 0) < maxAgeMs);
    if (sisa.length !== drafts.length) saveDrafts(sisa, filePath);
    return drafts.length - sisa.length;
}

module.exports = {
    simpanDraft,
    hapusDraft,
    ambilDraft,
    listDraftKedaluwarsa,
    pruneDraft,
    loadDrafts,
    saveDrafts,
    resolveFilePath,
    UMUR_KEDALUWARSA_MS,
    MAKS_DRAFT
};
