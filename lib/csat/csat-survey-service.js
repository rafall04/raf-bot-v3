/**
 * Header Doc
 * Purpose: Orkestrasi survei kepuasan (CSAT) — DUA peran: (1) state-machine penangkap balasan
 *   pelanggan yang DURABLE (dipanggil dari jalur inbound message/raf.js; tahan restart karena
 *   status disimpan di csat.sqlite, bukan conversation-state in-memory), dan (2) pembangun teks
 *   rekap bulanan untuk owner. Memisahkan PAHAM (parser fuzzy) dari AKSI (tulis DB + balas
 *   TEMPLATE) sesuai prinsip customer-assist. Never-throw: gagal apa pun → balik `false` supaya
 *   pesan pelanggan tetap mengalir ke pipeline normal (tak pernah menelan pesan sungguhan).
 * Caller: message/raf.js (handleInboundReply, hanya saat config.csatSurvey.enabled),
 *   lib/cron/jobs/rating-survey.js (buildOwnerDigest, getRepository).
 * Deps: ./rating-parser, ./csat-time, ../../repositories/csat.repository, ../templating (renderTemplate).
 * MainFuncs: getRepository, handleInboundReply, buildOwnerDigest, resetForTest.
 * SideEffects: Menulis csat.sqlite (via repo) & mengirim balasan WA (via `reply` yang diinjeksi
 *   dari raf.js — jalur sendReply yang tersanksi, BUKAN sendMessage mentah).
 */
"use strict";

const { parseRatingReply, isSkipWord, isCancelWord } = require("./rating-parser");
const { sqlNow, diffMinutes } = require("./csat-time");

let sharedRepo = null;

/** Singleton repo runtime (lazy). Bisa di-inject lewat argumen untuk test. */
function getRepository() {
    if (!sharedRepo) {
        const { createCsatRepository } = require("../../repositories/csat.repository");
        sharedRepo = createCsatRepository();
    }
    return sharedRepo;
}

function resetForTest() { sharedRepo = null; }

/** Render teks pelanggan dari template (message_templates.json). Fallback aman bila key hilang. */
function renderCustomerText(key, data, fallback) {
    try {
        const { renderTemplate } = require("../templating");
        const text = renderTemplate(key, data || {});
        if (text && !String(text).startsWith("Error:")) return text;
    } catch (_e) {
        // jatuh ke fallback
    }
    return fallback;
}

/** Kirim balasan tanpa pernah melempar (invariant: notif tak boleh menjatuhkan flow). */
async function safeReply(reply, text) {
    if (typeof reply !== "function" || !text) return;
    try {
        await Promise.resolve(reply(text));
    } catch (e) {
        console.error("[CSAT_REPLY_SEND_ERROR]", e && e.message);
    }
}

/**
 * P1 — kirim alert detractor (skor rendah) ke owner/admin via sendCritical (retry+dead-letter).
 * Notifikasi saja (bukan auto-tiket) — sesuai pilihan "rekap ke owner", hanya real-time. Never-throw.
 */
async function notifyOwnerDetractor(text, label) {
    try {
        const { getAdminJids } = require("../admin-recipients");
        const { sendCritical } = require("../whatsapp-critical-delivery");
        const jids = getAdminJids();
        if (!jids || !jids.length) { console.error("[CSAT_DETRACTOR] tak ada JID admin/owner"); return; }
        for (const jid of jids) {
            try { await sendCritical(jid, { text }, { label: label || "csat-detractor" }); }
            catch (e) { console.error(`[CSAT_DETRACTOR] gagal kirim ke ${jid}:`, e && e.message); }
        }
    } catch (e) {
        console.error("[CSAT_DETRACTOR_ERROR]", e && e.message);
    }
}

/** True bila alert detractor aktif utk skor ini (config gate + ambang, default ON & ≤2). */
function isDetractorAlert(cfg, score) {
    const c = cfg.csatSurvey || {};
    if (c.alertDetractor === false) return false;
    const maxScore = Number(c.detractorMaxScore) > 0 ? Number(c.detractorMaxScore) : 2;
    return typeof score === "number" && score <= maxScore;
}

/**
 * Tangkap balasan survei. Dipanggil untuk SETIAP pesan pelanggan saat fitur aktif, TAPI hanya
 * bertindak bila pelanggan ini memang punya survei aktif; kalau tidak → balik `false` cepat.
 *
 * Tahap:
 *  - status 'sent'  (menunggu rating): balasan yang jelas rating/optout ditangkap; kalau `unclear`
 *    (mis. pelanggan malah tanya lain) → JANGAN dibajak, balik false (survei dibiarkan kedaluwarsa).
 *  - status 'rated' (menunggu komentar, jendela pendek): teks jadi komentar; skip/cancel → selesai
 *    tanpa komentar; di luar jendela → finalisasi & lepaskan pesan ke pipeline normal.
 *
 * @returns {Promise<boolean>} true bila pesan sudah ditangani (pipeline harus berhenti).
 */
async function handleInboundReply({ user, text, reply, logger = console, repo, config, now, notifyOwner } = {}) {
    try {
        const cfg = config || (typeof global !== "undefined" ? global.config : null) || {};
        const alertFn = typeof notifyOwner === "function" ? notifyOwner : notifyOwnerDetractor;
        const brand = cfg.nama || (typeof global !== "undefined" && global.config && global.config.nama) || "RAF Net";
        const repository = repo || getRepository();
        const nowIso = typeof now === "function" ? now() : sqlNow();

        const userId = user && user.id !== undefined && user.id !== null ? String(user.id) : null;
        if (!userId) return false;

        const active = await repository.getActiveByUserId(userId, nowIso);
        if (!active) return false;

        const raw = String(text || "").trim();
        if (!raw) return false;

        const displayName = active.name || (user && user.name) || "Kak";
        const parsed = parseRatingReply(raw);

        // ── TAHAP 1: menunggu rating ──
        if (active.status === "sent") {
            if (parsed.kind === "optout") {
                await repository.setOptout(active.id, nowIso);
                await safeReply(reply, renderCustomerText("rating_optout", { nama_pelanggan: displayName },
                    "Baik Kak, survei tidak akan kami kirim lagi 🙏 Terima kasih."));
                logger.log(`[CSAT_REPLY] optout dari ${displayName} (survey#${active.id})`);
                return true;
            }
            if (parsed.kind === "rating") {
                await repository.recordRating(active.id, { score: parsed.score, sentiment: parsed.sentiment, rated_at: nowIso });
                // P1: alert detractor real-time ke owner (heads-up cepat, bukan nunggu digest bulanan).
                if (isDetractorAlert(cfg, parsed.score)) {
                    await alertFn(`⚠️ *Survei — skor rendah* (${brand})\n\nPelanggan *${displayName}*${active.phone ? ` (${active.phone})` : ""} memberi nilai *${parsed.score}⭐*.\n_Menunggu keterangan pelanggan..._`, "csat-detractor-rating");
                }
                const key = parsed.score <= 3 ? "rating_followup_low" : "rating_followup_high";
                const fallback = parsed.score <= 3
                    ? "Terima kasih penilaiannya, Kak 🙏 Mohon maaf kalau ada yang kurang nyaman. Boleh cerita sedikit kendalanya? Masukan Kakak sangat kami butuhkan untuk perbaikan."
                    : "Alhamdulillah, terima kasih Kak 🙏 Kalau ada saran biar makin oke, kami siap dengar 😊";
                await safeReply(reply, renderCustomerText(key, { nama_pelanggan: displayName, skor: parsed.score }, fallback));
                logger.log(`[CSAT_REPLY] rating=${parsed.score} dari ${displayName} (survey#${active.id})`);
                return true;
            }
            // unclear → biarkan pesan lanjut ke pipeline normal (jangan membajak).
            return false;
        }

        // ── TAHAP 2: menunggu komentar ──
        if (active.status === "rated") {
            const windowMin = Number(cfg.csatSurvey && cfg.csatSurvey.commentWindowMinutes) || 60;
            const withinWindow = active.rated_at ? diffMinutes(active.rated_at, nowIso) <= windowMin : true;

            if (!withinWindow) {
                // Jendela komentar habis → jangan menelan keluhan baru berhari-hari kemudian.
                await repository.finalizeDone(active.id);
                return false;
            }
            if (parsed.kind === "optout") {
                await repository.setOptout(active.id, nowIso);
                await safeReply(reply, renderCustomerText("rating_optout", { nama_pelanggan: displayName },
                    "Baik Kak, survei tidak akan kami kirim lagi 🙏 Terima kasih."));
                return true;
            }
            if (isSkipWord(raw) || isCancelWord(raw)) {
                await repository.finalizeDone(active.id);
                await safeReply(reply, renderCustomerText("rating_thanks", { nama_pelanggan: displayName },
                    "Terima kasih sudah berbagi, Kak 🙏"));
                return true;
            }
            await repository.recordComment(active.id, { comment: raw.slice(0, 1000), commented_at: nowIso });
            // P1: teruskan komentar detractor ke owner (skor rendah) — inilah "why"-nya, real-time.
            if (isDetractorAlert(cfg, active.score)) {
                await alertFn(`💬 *Keluhan pelanggan* — *${displayName}*${active.phone ? ` (${active.phone})` : ""} — ${active.score}⭐:\n"${raw.slice(0, 300)}"`, "csat-detractor-comment");
            }
            await safeReply(reply, renderCustomerText("rating_thanks", { nama_pelanggan: displayName },
                "Terima kasih sudah berbagi, Kak 🙏 Semua masukan kami catat sebagai bahan evaluasi."));
            logger.log(`[CSAT_REPLY] komentar dari ${displayName} (survey#${active.id}): "${raw.slice(0, 60)}"`);
            return true;
        }

        return false;
    } catch (err) {
        console.error("[CSAT_REPLY_ERROR]", err && err.message);
        return false; // fail-open: pesan pelanggan tetap diproses pipeline normal
    }
}

function line(label, value) { return `${label}: ${value}`; }

/**
 * Bangun teks rekap bulanan untuk owner (INTERNAL, bukan pesan pelanggan). Deterministik — daftar
 * dinamis (detractor/komentar) dibentuk di sini; ringkasan-tema berbasis AI menyusul (opsional).
 * @returns {Promise<{text:string, report:object}>}
 */
async function buildOwnerDigest(period, { repo, namaWifi } = {}) {
    const repository = repo || getRepository();
    const rep = await repository.getReport(period);
    const detractors = await repository.listDetractors(period);
    const comments = await repository.listComments(period, { limit: 30 });
    const nonResp = await repository.listNonResponders(period);

    const brand = namaWifi || (typeof global !== "undefined" && global.config && global.config.nama) || "RAF Net";
    const d = rep.distribution || {};
    const parts = [];
    parts.push(`📊 *Rekap Survei Pelanggan — ${brand}*`);
    parts.push(`Periode: ${period}`);
    parts.push("");
    parts.push(line("Terkirim", rep.delivered));
    parts.push(line("Menjawab", `${rep.responded} (${rep.responseRate}%)`));
    parts.push(line("Rata-rata skor", rep.avg !== null ? `${rep.avg} / 5` : "-"));
    parts.push(`Sebaran: 5⭐×${d[5] || 0}  4⭐×${d[4] || 0}  3⭐×${d[3] || 0}  2⭐×${d[2] || 0}  1⭐×${d[1] || 0}`);
    if (rep.optout) parts.push(line("Minta stop survei", rep.optout));
    if (rep.undelivered) parts.push(line("Gagal terkirim", rep.undelivered));

    if (detractors.length) {
        parts.push("");
        parts.push(`⚠️ *Perlu perhatian (skor ≤ 2): ${detractors.length}*`);
        detractors.slice(0, 15).forEach((r) => {
            const who = `${r.name || "-"}${r.phone ? ` (${r.phone})` : ""}`; // P2: sertakan No HP agar owner bisa langsung hubungi
            parts.push(`• ${who} — ${r.score}⭐${r.comment ? `: ${String(r.comment).slice(0, 120)}` : ""}`);
        });
    }

    const withComments = comments.filter((c) => c.comment && String(c.comment).trim());
    if (withComments.length) {
        parts.push("");
        parts.push(`💬 *Masukan pelanggan (${withComments.length}):*`);
        withComments.slice(0, 20).forEach((c) => {
            const who = `${c.name || "-"}${c.phone ? ` (${c.phone})` : ""}`; // P2: sertakan No HP
            parts.push(`• ${who} (${c.score ? `${c.score}⭐` : "?"}): ${String(c.comment).slice(0, 140)}`);
        });
    }

    if (nonResp.length) {
        parts.push("");
        parts.push(`🔕 Belum menjawab: ${nonResp.length} pelanggan`);
    }

    return { text: parts.join("\n"), report: rep };
}

module.exports = {
    getRepository,
    handleInboundReply,
    buildOwnerDigest,
    resetForTest,
    // diekspor untuk test
    _internal: { renderCustomerText, safeReply, notifyOwnerDetractor, isDetractorAlert },
};
