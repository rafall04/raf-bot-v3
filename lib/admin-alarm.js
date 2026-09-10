/**
 * Header Doc
 * Purpose: Alarm TERJAMIN ke admin/owner untuk kegagalan cron/jalur-uang yang dulu GAGAL DIAM-DIAM
 *   (hanya console.error). Satu titik: resolve JID admin (accounts.json via getAdminJids) → kirim via
 *   sendCritical (retry + dead-letter). Dipakai eskalasi isolir/set-unpaid gagal, backup Telegram gagal,
 *   dll — supaya kebocoran pendapatan / data-loss tak lagi ketahuan baru "saat kejadian".
 * Caller: lib/cron/jobs/isolir.js, set-unpaid.js, telegram-backup.js (dan cron lain yg butuh eskalasi).
 * Deps: ./admin-recipients (getAdminJids), ./whatsapp-critical-delivery (sendCritical) — di-require lazy.
 * MainFuncs: sendAdminAlarm(text, opts).
 * SideEffects: Kirim WA ke admin (dead-letter bila gagal). NEVER-THROW.
 */
"use strict";

/**
 * Kirim satu alarm ke semua admin/owner. Never-throw.
 * @param {string} text
 * @param {{label?:string, deps?:object}} [opts]
 * @returns {Promise<{sent:number, recipients:number}>}
 */
async function sendAdminAlarm(text, opts = {}) {
    try {
        const getAdminJids = (opts.deps && opts.deps.getAdminJids) || require("./admin-recipients").getAdminJids;
        const sendCritical = (opts.deps && opts.deps.sendCritical) || require("./whatsapp-critical-delivery").sendCritical;
        const jids = (await getAdminJids()) || [];
        let sent = 0;
        for (const jid of jids) {
            try {
                const r = await sendCritical(jid, { text }, { label: opts.label || "admin-alarm", waitForReadyMs: 8000 });
                if (r && r.delivered !== false) sent += 1;
            } catch (e) {
                console.error(`[ADMIN_ALARM] gagal kirim ke ${jid}:`, e && e.message);
            }
        }
        return { sent, recipients: jids.length };
    } catch (e) {
        console.error("[ADMIN_ALARM_ERROR]", e && e.message);
        return { sent: 0, recipients: 0 };
    }
}

module.exports = { sendAdminAlarm };
