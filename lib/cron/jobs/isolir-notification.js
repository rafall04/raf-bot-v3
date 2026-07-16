/**
 * Header Doc
 * Purpose: Cron notifikasi isolir — kirim WA ke pelanggan yang profil PPPoE LIVE-nya = `isolir_profile`.
 *   DI-HARDEN (akar: 2026-07-16 Achwan Fatoni tak terima notif karena WA putus TEPAT saat gilirannya,
 *   tapi log terlanjur bilang "sent"):
 *     1. **RETRY** via helper bersama `../wa-send-queue` — WA putus/kirim gagal → pesan MASUK ANTRIAN
 *        ULANG, tunggu koneksi pulih, kirim lagi (bounded). Antrian per-JID → tak dobel-kirim.
 *     2. **TIDAK BISU** — tiap pelanggan yang dilewati dicatat + ALASANNYA + ringkasan.
 *        (Dulu `if (phone && isReady())` melewati diam-diam tanpa jejak.)
 *     3. **LEWATI paket WHITELIST** — pelanggan gratis (mis. PAKET-VOUCHER) TAK boleh dapat notif isolir
 *        walau profil live-nya masih ISOLIR (sisa isolir lama). Cron isolir sendiri sudah melewati mereka.
 * Caller: `lib/cron.js` (composer) via `initIsolirNotificationTask`.
 * Deps: `node-cron`, `../shared`, `../wa-send-queue`, `../../mikrotik` (getPPPoEUserProfile,
 *   assertMikrotikResult), `../../templating`, `../../bill-pay-token`, `../../whatsapp-gateway`,
 *   `../../account-classification`, `../../myfunc` (getProfileBySubscription).
 * MainFuncs: `initIsolirNotificationTask(config)`; `runIsolirNotificationCycle(deps)` — inti, deps
 *   di-inject supaya bisa diuji.
 * SideEffects: Baca profil MikroTik per user, kirim WhatsApp (dengan retry), log ringkasan.
 */
"use strict";

const cron = require('node-cron');

const { delay: sharedDelay, isValidCron, safeSendMessage: sharedSend } = require('../shared');
const { sendQueueWithRetry, buildJid, resolveRetryConfig } = require('../wa-send-queue');
const { getPPPoEUserProfile: mtGetProfile, assertMikrotikResult: mtAssert } = require('../../mikrotik');
const { renderTemplate: tplRender } = require('../../templating');
const { buildBillPayUrl: billUrl } = require('../../bill-pay-token');
const { isReady: waReady } = require('../../whatsapp-gateway');
const { isInfrastructure: isInfra } = require('../../account-classification');
const { getProfileBySubscription: profBySub } = require('../../myfunc');

let cronTaskIsolirNotification = null;
let notifRunning = false;

function defaultDeps() {
    return {
        getUsers: () => global.users || [],
        getPackages: () => global.packages || [],
        getConfig: () => global.config || {},
        getPPPoEUserProfile: mtGetProfile,
        assertMikrotikResult: mtAssert,
        renderTemplate: tplRender,
        buildBillPayUrl: billUrl,
        isReady: waReady,
        safeSendMessage: sharedSend,
        delay: sharedDelay,
        isInfrastructure: isInfra,
        getProfileBySubscription: profBySub,
        logger: console,
    };
}

function buildMessage(d, user) {
    const nowDate = new Date();
    let linkBayar = '';
    try {
        linkBayar = d.buildBillPayUrl(user, { periodMonth: nowDate.getMonth() + 1, periodYear: nowDate.getFullYear() });
    } catch (linkErr) {
        d.logger.error(`[CRON_ISOLIR_NOTIF] Gagal buat link bayar untuk ${user.name}: ${linkErr.message}`);
    }
    const message = d.renderTemplate('isolir_notification', {
        nama_pelanggan: user.name,
        periode: nowDate.toLocaleString('id-ID', { month: 'long', year: 'numeric' }),
        link_bayar: linkBayar,
    });
    if (!message || String(message).startsWith('Error:')) return null;
    return message;
}

/**
 * Inti siklus notifikasi isolir. Fase: (1) kumpulkan target + catat yang dilewati,
 * (2) kirim dengan RETRY (helper bersama), (3) ringkasan. Never-silent.
 * @returns {Promise<{ok, target, sent, failed, skipped, skippedDetail}>}
 */
async function runIsolirNotificationCycle(overrides = {}) {
    const d = { ...defaultDeps(), ...overrides };
    const cfg = d.getConfig();
    const isolirProfile = cfg.isolir_profile;
    if (!isolirProfile) {
        d.logger.error("[CRON_ISOLIR_NOTIF_ERROR] `isolir_profile` is not defined in config.json. Cannot send notifications.");
        return { ok: false, reason: 'no_isolir_profile' };
    }
    const messageDelay = parseInt(cfg.whatsapp_message_delay, 10) || 2000;

    d.logger.log(`[CRON_ISOLIR_NOTIF] Task executed at: ${new Date().toLocaleString('id-ID')}. Checking for isolated users.`);

    const whitelistedProfile = d.getPackages().filter((p) => p && p.whitelist).map((p) => p.profile);
    const skipped = [];
    const items = []; // {jid, text, label} — 1 item per nomor → retry tak dobel-kirim

    // === FASE 1: kumpulkan target ===
    for (const user of d.getUsers()) {
        if (d.isInfrastructure(user)) continue;   // akun infra bukan pelanggan ditagih
        if (!user.pppoe_username) continue;       // tanpa PPPoE → bukan target isolir

        // Pelanggan paket WHITELIST (gratis) TAK boleh dapat notif isolir, walau profil live-nya
        // masih ISOLIR (sisa isolir lama yang belum dilepas).
        const userProfile = d.getProfileBySubscription(user.subscription);
        if (whitelistedProfile.includes(userProfile)) {
            skipped.push({ name: user.name, reason: `paket whitelist/gratis (${user.subscription}) — tak pernah ditagih` });
            continue;
        }

        let liveProfile = null;
        try {
            const res = await d.getPPPoEUserProfile(user.pppoe_username, { caller: 'cron.isolir-notification' });
            const data = d.assertMikrotikResult(res);
            liveProfile = data && data.data ? data.data.profile : null;
        } catch (error) {
            skipped.push({ name: user.name, reason: `gagal baca profil MikroTik: ${error.message}` });
            d.logger.error(`[CRON_ISOLIR_NOTIF_FETCH_ERROR] Could not get profile for user ${user.name} (${user.pppoe_username}): ${error.message}`);
            continue;
        }
        if (liveProfile !== isolirProfile) continue; // tidak terisolir → bukan target (normal)

        if (!user.phone_number) {
            skipped.push({ name: user.name, reason: 'TERISOLIR tapi tanpa No HP → tak bisa diberi tahu' });
            continue;
        }
        const message = buildMessage(d, user);
        if (!message) {
            skipped.push({ name: user.name, reason: 'render template isolir_notification gagal' });
            continue;
        }
        for (const raw of String(user.phone_number).split('|')) {
            const jid = buildJid(raw);
            if (jid) items.push({ jid, text: message, label: user.name });
            else skipped.push({ name: user.name, reason: `nomor tak valid: "${String(raw).trim()}"` });
        }
    }

    // === FASE 2: kirim + RETRY (helper bersama) ===
    const res = await sendQueueWithRetry({
        items,
        safeSendMessage: d.safeSendMessage,
        isReady: d.isReady,
        delay: d.delay,
        messageDelayMs: messageDelay,
        retry: resolveRetryConfig(cfg),
        tag: 'CRON_ISOLIR_NOTIF',
        logger: d.logger,
    });

    // === FASE 3: ringkasan — JANGAN BISU ===
    for (const s of skipped) d.logger.log(`[CRON_ISOLIR_NOTIF_SKIP] ${s.name}: ${s.reason}`);
    d.logger.log(`[CRON_ISOLIR_NOTIF] === SUMMARY === target=${items.length} sent=${res.sent} gagal=${res.failed.length} skipped=${skipped.length}`);

    return { ok: true, target: items.length, sent: res.sent, failed: res.failed.length, skipped: skipped.length, skippedDetail: skipped };
}

function initIsolirNotificationTask(config) {
    if (cronTaskIsolirNotification) cronTaskIsolirNotification.stop();
    if (config.status_message_isolir_notification === true && isValidCron(config.schedule_isolir_notification)) {
        console.log("[CRON_ISOLIR_NOTIF] Starting/Restarting isolir notification task with schedule:", config.schedule_isolir_notification);
        cronTaskIsolirNotification = cron.schedule(config.schedule_isolir_notification, async () => {
            if (notifRunning) {
                console.warn("[CRON_ISOLIR_NOTIF_SKIPPED] Previous notification cycle still running, skipping this tick.");
                return;
            }
            notifRunning = true;
            try {
                await runIsolirNotificationCycle();
            } catch (error) {
                console.error('[CRON_ISOLIR_NOTIF_ERROR] Siklus notifikasi isolir gagal:', error.message);
            } finally {
                notifRunning = false;
            }
        });
    } else {
        // Isolir notification task disabled (silent)
    }
}

module.exports = {
    initIsolirNotificationTask,
    runIsolirNotificationCycle,
};
