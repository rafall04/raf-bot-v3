/**
 * Header Doc
 * Purpose: Cron survei kepuasan pelanggan (CSAT) — DUA task bulanan: (1) KIRIM survei rating 1–5
 *   ke pelanggan aktif yang layak (kecuali infra/whitelist-gratis/isolir/sudah-disurvei), (2) DIGEST
 *   rekap bulanan ke owner setelah jendela balasan lewat. Kirim WAJIB lewat helper retry bersama
 *   (`../wa-send-queue`) supaya blip WA tak menghilangkan pelanggan + log tak bohong "sent"
 *   ([[wa-cron-send-retry]]). Master-switch fitur = `config.csatSurvey.enabled` (DEFAULT OFF →
 *   deploy gelap): saat OFF, kedua siklus no-op walau terjadwal.
 * Caller: `lib/cron.js` (composer) via `initRatingSurveyTask`.
 * Deps: `node-cron`, `../shared`, `../wa-send-queue`, `../../csat/csat-survey-service`,
 *   `../../csat/csat-time`, `../../templating`, `../../account-classification`, `../../myfunc`,
 *   `../../admin-recipients`, `../../whatsapp-gateway`.
 * MainFuncs: `initRatingSurveyTask(config)`; `runRatingSurveyCycle(deps)` & `runRatingDigestCycle(deps)`
 *   — inti, deps di-inject supaya bisa diuji.
 * SideEffects: Tulis csat.sqlite (via repo), kirim WhatsApp (dengan retry), log ringkasan.
 */
"use strict";

const cron = require("node-cron");

const { delay: sharedDelay, isValidCron, safeSendMessage: sharedSend } = require("../shared");
const { sendQueueWithRetry, buildJid, resolveRetryConfig } = require("../wa-send-queue");
const { renderTemplate: tplRender } = require("../../templating");
const { isInfrastructure: isInfra, getWhitelistedPackageNames } = require("../../account-classification");
const { getProfileBySubscription: profBySub } = require("../../myfunc");
const { getAdminJids } = require("../../admin-recipients");
const { isReady: waReady } = require("../../whatsapp-gateway");
const csatService = require("../../csat/csat-survey-service");
const { sqlNow, sqlDate, periodOf, addDays } = require("../../csat/csat-time");

let cronTaskSurvey = null;
let cronTaskDigest = null;
let surveyRunning = false;
let digestRunning = false;

function defaultDeps() {
    return {
        getUsers: () => global.users || [],
        getPackages: () => global.packages || [],
        getConfig: () => global.config || {},
        getRepository: () => csatService.getRepository(),
        buildOwnerDigest: (period, opts) => csatService.buildOwnerDigest(period, opts),
        getAdminJids: () => getAdminJids(),
        renderTemplate: tplRender,
        isReady: waReady,
        safeSendMessage: sharedSend,
        delay: sharedDelay,
        isInfrastructure: isInfra,
        getProfileBySubscription: profBySub,
        now: sqlNow,
        logger: console,
    };
}

/** Pelanggan dianggap aktif-bayar (proxy ringan tanpa panggil MikroTik). */
function isPaid(user) {
    const p = user && user.paid;
    return p === true || p === 1 || p === "1";
}

/**
 * Inti siklus KIRIM survei. Fase: (1) kumpulkan target + catat yang dilewati (never-silent),
 * (2) buat baris pending + kirim dengan RETRY, (3) tandai sent/undelivered + ringkasan.
 * @returns {Promise<object>}
 */
async function runRatingSurveyCycle(overrides = {}) {
    const d = { ...defaultDeps(), ...overrides };
    const cfg = d.getConfig();
    const csatCfg = cfg.csatSurvey || {};

    if (csatCfg.enabled !== true) {
        d.logger.log("[CRON_CSAT] Fitur survei OFF (config.csatSurvey.enabled != true) — siklus dilewati.");
        return { ok: false, reason: "disabled" };
    }

    const period = periodOf(new Date());
    const windowDays = Number(csatCfg.responseWindowDays) > 0 ? Number(csatCfg.responseWindowDays) : 3;
    const onlyPaid = csatCfg.onlyPaid !== false; // default true
    const messageDelay = parseInt(cfg.whatsapp_message_delay, 10) || 2000;
    const repo = d.getRepository();
    const sentAt = d.now();
    const expiresAt = sqlDate(addDays(new Date(), windowDays));
    const periodeLabel = new Date().toLocaleString("id-ID", { month: "long", year: "numeric" });
    // MODE TES (opsional): kirim HANYA ke satu nomor (uji alur end-to-end tanpa blast). Kosong = normal.
    const testJid = csatCfg.testPhone ? buildJid(String(csatCfg.testPhone)) : null;

    d.logger.log(`[CRON_CSAT] Mulai siklus survei periode ${period} @ ${new Date().toLocaleString("id-ID")}`);
    if (testJid) d.logger.log(`[CRON_CSAT] ⚠️ MODE TES aktif — hanya kirim ke ${testJid}, dedup dilewati.`);

    // Dikunci pada NAMA PAKET, bukan profil — lihat lib/account-classification.js.
    const paketWhitelist = getWhitelistedPackageNames(d.getPackages());
    const skipped = [];
    const items = []; // {jid, text, label, surveyId}

    // === FASE 1: kumpulkan target + buat baris pending ===
    for (const user of d.getUsers()) {
        if (d.isInfrastructure(user)) { continue; }              // akun infra, bukan pelanggan
        if (!user.pppoe_username) { continue; }                  // bukan pelanggan berlangganan
        if (user.id === undefined || user.id === null) { skipped.push({ name: user.name, reason: "user tanpa id" }); continue; }

        const userProfile = d.getProfileBySubscription(user.subscription);
        if (paketWhitelist.has(user.subscription)) { skipped.push({ name: user.name, reason: `paket whitelist/gratis (${user.subscription})` }); continue; }
        if (!user.phone_number) { skipped.push({ name: user.name, reason: "tanpa No HP" }); continue; }
        if (onlyPaid && !isPaid(user)) { skipped.push({ name: user.name, reason: "belum bayar/isolir (onlyPaid)" }); continue; }

        // Opt-out survei (pelanggan balas STOP) — HANYA survei; tagihan/isolir tak lewat sini.
        if (await repo.isSurveyOptedOut(user.id)) { skipped.push({ name: user.name, reason: "opt-out survei (balas STOP)" }); continue; }

        if (testJid) {
            // MODE TES: lewati semua kecuali nomor testPhone; dedup sengaja dilewati agar bisa kirim ulang.
            const userJids = String(user.phone_number || "").split("|").map((n) => buildJid(n)).filter(Boolean);
            if (!userJids.includes(testJid)) { continue; }
        } else if (await repo.hasSurveyForPeriod(user.id, period)) {
            skipped.push({ name: user.name, reason: "sudah disurvei periode ini" }); continue;
        }

        const message = d.renderTemplate("rating_survey", { nama_pelanggan: user.name, periode: periodeLabel });
        if (!message || String(message).startsWith("Error:")) { skipped.push({ name: user.name, reason: "render template rating_survey gagal" }); continue; }

        const firstJid = buildJid(String(user.phone_number).split("|")[0]);
        const { id } = await repo.upsertPending({
            user_id: user.id,
            canonical_jid: firstJid,
            phone: user.phone_number,
            name: user.name,
            pkg: user.subscription,
            period,
        });
        if (!id) { skipped.push({ name: user.name, reason: "gagal buat baris survei (duplikat?)" }); continue; }

        // Tandai 'sent' SEKETIKA (bukan menunggu FASE 3). Pengiriman ber-jeda anti-ban makan
        // 6–10 menit; kalau baris baru jadi 'sent' di akhir siklus, pelanggan yang membalas SELAMA
        // jendela itu tak dikenali survei-nya (getActiveByUserId hanya lihat 'sent'/'rated') →
        // balasannya bocor ke pipeline normal (rating hilang, keluhan malah ditawari reboot).
        // Kirim gagal total → di-revert 'undelivered' di FASE 3.
        await repo.markSent(id, { sent_at: sentAt, expires_at: expiresAt });

        for (const raw of String(user.phone_number).split("|")) {
            const jid = buildJid(raw);
            if (jid) items.push({ jid, text: message, label: user.name, surveyId: id });
            else skipped.push({ name: user.name, reason: `nomor tak valid: "${String(raw).trim()}"` });
        }
    }

    // === FASE 2: kirim + RETRY ===
    const res = await sendQueueWithRetry({
        items,
        safeSendMessage: d.safeSendMessage,
        isReady: d.isReady,
        delay: d.delay,
        messageDelayMs: messageDelay,
        retry: resolveRetryConfig(cfg),
        tag: "CRON_CSAT",
        logger: d.logger,
    });

    // === FASE 3: REVERT yang gagal kirim total → 'undelivered' + ringkasan ===
    // (Baris sudah 'sent' sejak FASE 1 agar aktif menangkap balasan sedini mungkin; di sini cukup
    //  turunkan yang GAGAL TOTAL supaya tak masuk denominator response-rate. markUndelivered aman:
    //  hanya menyentuh baris yang belum berskor, jadi pelanggan yang sempat membalas saat kirim
    //  berlangsung tak ikut ter-revert.)
    const failedSet = new Set(res.failed);
    const perSurvey = new Map(); // surveyId -> {total, failed}
    for (const it of items) {
        const s = perSurvey.get(it.surveyId) || { total: 0, failed: 0 };
        s.total += 1;
        if (failedSet.has(it)) s.failed += 1;
        perSurvey.set(it.surveyId, s);
    }
    let markedUndelivered = 0;
    for (const [surveyId, s] of perSurvey.entries()) {
        if (s.failed >= s.total) { await repo.markUndelivered(surveyId); markedUndelivered += 1; }
    }
    const markedSent = perSurvey.size - markedUndelivered;

    for (const s of skipped) d.logger.log(`[CRON_CSAT_SKIP] ${s.name}: ${s.reason}`);
    d.logger.log(`[CRON_CSAT] === SUMMARY === periode=${period} survei=${perSurvey.size} terkirim=${markedSent} gagal=${markedUndelivered} pesan=${res.sent}/${items.length} skipped=${skipped.length}`);

    return { ok: true, period, surveys: perSurvey.size, sent: markedSent, undelivered: markedUndelivered, messages: res.sent, skipped: skipped.length, skippedDetail: skipped };
}

/**
 * Inti siklus DIGEST — rekap bulanan ke owner. Finalisasi survei kedaluwarsa dulu, lalu kirim
 * rekap ke admin/owner (getAdminJids). Tidak spam bila belum ada survei terkirim.
 * @returns {Promise<object>}
 */
async function runRatingDigestCycle(overrides = {}) {
    const d = { ...defaultDeps(), ...overrides };
    const cfg = d.getConfig();
    if ((cfg.csatSurvey || {}).enabled !== true) {
        return { ok: false, reason: "disabled" };
    }
    const period = periodOf(new Date());
    const repo = d.getRepository();

    await repo.finalizeExpired(d.now());

    const { text, report } = await d.buildOwnerDigest(period, { repo });
    if (!report || report.delivered === 0) {
        d.logger.log(`[CRON_CSAT_DIGEST] Belum ada survei terkirim periode ${period} — digest dilewati.`);
        return { ok: true, period, skipped: "no-data" };
    }

    const recipients = d.getAdminJids();
    if (!recipients || recipients.length === 0) {
        d.logger.warn("[CRON_CSAT_DIGEST] Tak ada penerima admin/owner — digest tak dikirim.");
        return { ok: false, reason: "no-recipients" };
    }

    const items = recipients.map((jid) => ({ jid, text, label: "owner" }));
    const res = await sendQueueWithRetry({
        items,
        safeSendMessage: d.safeSendMessage,
        isReady: d.isReady,
        delay: d.delay,
        messageDelayMs: parseInt(cfg.whatsapp_message_delay, 10) || 2000,
        retry: resolveRetryConfig(cfg),
        tag: "CRON_CSAT_DIGEST",
        logger: d.logger,
    });

    d.logger.log(`[CRON_CSAT_DIGEST] === SUMMARY === periode=${period} owner=${res.sent}/${recipients.length} avg=${report.avg} resp=${report.responded}/${report.delivered}`);
    return { ok: true, period, recipients: recipients.length, sent: res.sent };
}

function initRatingSurveyTask(config) {
    if (cronTaskSurvey) cronTaskSurvey.stop();
    if (cronTaskDigest) cronTaskDigest.stop();

    if (config.status_rating_survey === true && isValidCron(config.schedule_rating_survey)) {
        console.log("[CRON_CSAT] Menjadwalkan survei rating:", config.schedule_rating_survey);
        cronTaskSurvey = cron.schedule(config.schedule_rating_survey, async () => {
            if (surveyRunning) { console.warn("[CRON_CSAT_SKIPPED] Siklus survei sebelumnya masih jalan."); return; }
            surveyRunning = true;
            try { await runRatingSurveyCycle(); }
            catch (error) { console.error("[CRON_CSAT_ERROR] Siklus survei gagal:", error.message); }
            finally { surveyRunning = false; }
        });
    }

    if (config.status_rating_digest === true && isValidCron(config.schedule_rating_digest)) {
        console.log("[CRON_CSAT_DIGEST] Menjadwalkan digest rekap:", config.schedule_rating_digest);
        cronTaskDigest = cron.schedule(config.schedule_rating_digest, async () => {
            if (digestRunning) { console.warn("[CRON_CSAT_DIGEST_SKIPPED] Siklus digest sebelumnya masih jalan."); return; }
            digestRunning = true;
            try { await runRatingDigestCycle(); }
            catch (error) { console.error("[CRON_CSAT_DIGEST_ERROR] Siklus digest gagal:", error.message); }
            finally { digestRunning = false; }
        });
    }
}

module.exports = {
    initRatingSurveyTask,
    runRatingSurveyCycle,
    runRatingDigestCycle,
};
