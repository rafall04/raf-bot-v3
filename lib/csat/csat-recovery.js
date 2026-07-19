/**
 * Header Doc
 * Purpose: Pemulihan balasan survei yang "bocor". Saat pengiriman survei ber-jeda anti-ban makan
 *   6–10 menit sementara baris survei baru ditandai 'sent' di akhir siklus (bug lama, kini sudah
 *   diperbaiki di rating-survey.js), pelanggan yang membalas SELAMA jendela itu balasannya tak
 *   dikenali survei-nya dan jatuh ke pipeline normal (rating hilang, keluhan malah ditawari reboot).
 *   Modul ini membaca balasan mentah dari database/message_logs.sqlite (inbound_messages),
 *   mencocokkan ke survei 'sent' TANPA skor, lalu MEMUTAR ULANG tiap balasan lewat
 *   csat-survey-service.handleInboundReply — sehingga rating tercatat, alert detractor menyala,
 *   opt-out diproses, dan pelanggan menerima balasan susulan PERSIS seperti alur normal. Hanya
 *   memproses balasan yang benar-benar rating/optout, dan komentar hanya bila datang dalam 15 menit
 *   dari rating aslinya (agar pesan lain yang jauh setelahnya tak salah tercatat sebagai komentar).
 *   Berjalan IN-PROCESS (butuh koneksi WA global) → dipicu dari endpoint admin, bukan skrip lepas.
 * Caller: routes/admin-csat-routes.js (POST /api/owner/csat/recover).
 * Deps: sqlite3 (baca message_logs read-only), ./csat-survey-service, ./rating-parser, ./csat-time,
 *   ../cron/shared (safeSendMessage/delay), ../env-config (getDatabasePath).
 * MainFuncs: recoverLostResponders({period, logger, spacingMs}).
 * SideEffects: menulis csat.sqlite (via service), kirim WA susulan ber-jeda, alert owner detractor.
 */
"use strict";

const csatService = require("./csat-survey-service");
const { parseRatingReply } = require("./rating-parser");
const { periodOf } = require("./csat-time");
const { safeSendMessage, delay } = require("../cron/shared");

const BURST_WINDOW_MS = 15 * 60 * 1000; // komentar dianggap satu rangkaian bila ≤15 menit dari rating

/** Kunci pencocokan JID: 10 digit terakhir nomor (tahan beda format @lid vs @s.whatsapp.net). */
function jkey(jid) {
    return String(jid || "").split("@")[0].replace(/\D/g, "").slice(-10);
}

/** Baca semua inbound satu hari (prefix 'YYYY-MM-DD') dari message_logs.sqlite. Never-throw. */
function readInboundForDay(dayPrefix, logger) {
    return new Promise((resolve) => {
        let sqlite3;
        try { sqlite3 = require("sqlite3"); }
        catch (e) { logger.error("[CSAT_RECOVERY] sqlite3 tak tersedia:", e && e.message); return resolve([]); }
        let dbPath;
        try { dbPath = require("../env-config").getDatabasePath("message_logs.sqlite"); }
        catch (e) { logger.error("[CSAT_RECOVERY] resolve path message_logs gagal:", e && e.message); return resolve([]); }
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) { logger.error("[CSAT_RECOVERY] buka message_logs gagal:", err.message); return resolve([]); }
            db.all(
                "SELECT canonical_jid, body, received_at FROM inbound_messages WHERE received_at LIKE ? ORDER BY received_at ASC",
                [String(dayPrefix) + "%"],
                (e2, rows) => {
                    db.close(() => {});
                    if (e2) { logger.error("[CSAT_RECOVERY] query inbound gagal:", e2.message); return resolve([]); }
                    resolve(Array.isArray(rows) ? rows : []);
                }
            );
        });
    });
}

function tsMs(v) {
    const n = new Date(v).getTime();
    return Number.isFinite(n) ? n : 0;
}

/**
 * Pulihkan balasan survei yang hilang untuk satu periode.
 * @param {{period?:string, logger?:object, spacingMs?:number, dryRun?:boolean}} [opts]
 *   dryRun=true → hanya RENCANAKAN (baca + cocokkan, tanpa tulis DB / kirim WA) untuk verifikasi.
 * @returns {Promise<{scanned:number, recovered:number, replayed:number, dryRun?:boolean, plan?:object[]}>}
 */
async function recoverLostResponders({ period, logger = console, spacingMs = 4000, dryRun = false } = {}) {
    const per = period || periodOf(new Date());
    const repo = csatService.getRepository();
    const lost = await repo.listLostForRecovery(per);
    if (!lost.length) {
        logger.log(`[CSAT_RECOVERY] Tak ada survei 'sent' tanpa skor periode ${per} — tidak ada yang dipulihkan.`);
        return { scanned: 0, recovered: 0, replayed: 0, plan: [] };
    }

    // Kumpulkan inbound untuk tiap tanggal kirim yang relevan (biasanya satu hari).
    const days = [...new Set(lost.map((s) => String(s.sent_at || "").slice(0, 10)).filter(Boolean))];
    let inbound = [];
    for (const day of days) inbound = inbound.concat(await readInboundForDay(day, logger));
    const byJid = {};
    for (const m of inbound) { const k = jkey(m.canonical_jid); if (k) (byJid[k] = byJid[k] || []).push(m); }

    let recovered = 0;
    let replayed = 0;
    const plan = [];
    for (const su of lost) {
        const msgs = (byJid[jkey(su.canonical_jid)] || [])
            .map((m) => ({ ...m, at: tsMs(m.received_at), p: parseRatingReply(m.body || "") }))
            .sort((a, b) => a.at - b.at);
        // Anchor = balasan pertama yang jelas rating/optout. Tanpa itu → bukan responden (lewati).
        const anchorIdx = msgs.findIndex((m) => m.p.kind === "rating" || m.p.kind === "optout");
        if (anchorIdx < 0) continue;
        const anchor = msgs[anchorIdx];
        const t0 = anchor.at;
        // Rangkaian balasan: anchor + pesan berikutnya dalam 15 menit (rating lalu komentar).
        const burst = msgs.slice(anchorIdx).filter((m) => m.at - t0 <= BURST_WINDOW_MS);
        plan.push({ name: su.name, jid: su.canonical_jid, kind: anchor.p.kind, score: anchor.p.score || null, msgs: burst.length, sample: String(anchor.body || "").slice(0, 30) });

        if (dryRun) continue;

        const user = { id: su.user_id, name: su.name };
        let handledAny = false;
        for (const m of burst) {
            const handled = await csatService.handleInboundReply({
                user,
                text: m.body,
                reply: (t) => safeSendMessage(su.canonical_jid, { text: t }, { skipDuplicateCheck: true }),
                config: (typeof global !== "undefined" && global.config) || undefined,
                logger,
            });
            if (handled) { handledAny = true; replayed += 1; await delay(spacingMs); }
        }
        if (handledAny) recovered += 1;
    }

    if (dryRun) {
        logger.log(`[CSAT_RECOVERY][DRY] periode=${per} kandidat=${lost.length} akan-dipulihkan=${plan.length}`);
        return { scanned: lost.length, recovered: 0, replayed: 0, dryRun: true, plan };
    }
    logger.log(`[CSAT_RECOVERY] periode=${per} kandidat=${lost.length} dipulihkan=${recovered} replay=${replayed}`);
    return { scanned: lost.length, recovered, replayed, plan };
}

module.exports = { recoverLostResponders };
