/**
 * Header Doc
 * Purpose: Cron job pengingat pembayaran (reminder) — kirim notifikasi WhatsApp ke pelanggan unpaid pada `tanggal_pengingat` di config. State holder `cronTaskReminder` ter-encapsulasi di module ini.
 *   DI-HARDEN (2026-07-16): pengiriman lewat helper bersama `../wa-send-queue` → RETRY tahan blip
 *   koneksi (dulu `break` saat WA putus di tengah antrian → SISA pelanggan TAK dapat tagihan bulan
 *   itu, tanpa cara memulihkan) + laporan tak bisu (tiap skip dicatat + alasan + ringkasan).
 * Caller: `lib/cron.js` (composer) via `initReminderTask`.
 * Deps: `node-cron`, `../shared` (delay, isValidCron, loadCronConfig, safeSendMessage), `../wa-send-queue`
 *   (sendQueueWithRetry, buildJid, resolveRetryConfig), `../../templating` (renderTemplate),
 *   `../../myfunc` (getProfileBySubscription), `../../bill-pay-token` (buildBillPayUrl),
 *   `../../whatsapp-gateway` (isReady, getConnectionState), `../../account-classification`, `rupiah-format`.
 * MainFuncs: `initReminderTask(config)`, `runReminderCycle()`, `generateReminderData(user)`.
 * SideEffects: Jadwalkan job background, kirim WhatsApp (dengan retry), log progress + ringkasan.
 */
"use strict";

const cron = require('node-cron');
const formatRupiah = require('rupiah-format');

const { delay, isValidCron, loadCronConfig, safeSendMessage } = require('../shared');
const { sendQueueWithRetry, buildJid, resolveRetryConfig } = require('../wa-send-queue');
const { renderTemplate } = require('../../templating');
const { getProfileBySubscription } = require('../../myfunc');
const { buildBillPayUrl } = require('../../bill-pay-token');
const { isReady, getConnectionState } = require('../../whatsapp-gateway');
const { isInfrastructure } = require('../../account-classification');
// Harga efektif = SATU pemilik (`getEffectivePrice`): `subscription_price` per-pelanggan bila ada,
// selain itu harga paket, lalu dikurangi diskon aktif. Ledger pembayaran memakainya, jadi pesan
// penagihan WAJIB memakainya juga — kalau tidak, angka yang ditagih beda dari angka yang dicatat.
const { resolveBillingAmount } = require('../../payment-finance-service');

let cronTaskReminder = null;
let reminderRunning = false;

function generateReminderData(user) {
    // Harga efektif (subscription_price per-pelanggan + diskon aktif) — satu sumber dengan ledger,
    // sama seperti jalur reminder utama di bawah.
    const packageInfo = (global.packages || []).find(p => p.name === user.subscription) || {};
    const tagihan = resolveBillingAmount(user, packageInfo.price);
    const price = tagihan.amount > 0 ? formatRupiah.convert(tagihan.amount) : 'Tidak diketahui';

    const dueDate = new Date();
    dueDate.setDate(global.config.tanggal_batas_bayar || 10);
    const formattedDueDate = dueDate.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });

    return {
        nama: user.name,
        nama_layanan: global.config.nama || 'Layanan Kami',
        nama_paket: user.subscription,
        harga_paket: price,
        tanggal_jatuh_tempo: formattedDueDate,
    };
}

/** Inti siklus reminder: kumpulkan target → kirim (retry) → ringkasan. */
async function runReminderCycle() {
    const whitelistedProfile = (global.packages || []).filter(v => v.whitelist).map(v => v.profile);
    const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay)) || 2000;

    console.log(`[CRON_REMINDER] Total users: ${global.users ? global.users.length : 0}`);
    console.log(`[CRON_REMINDER] Whitelisted profiles: ${whitelistedProfile.join(', ') || 'none'}`);

    // Periode adalah bulan ini (bukan bulan depan)
    const currentMonth = new Date();
    const periode = currentMonth.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    // Jatuh tempo adalah tanggal batas bayar di bulan ini
    const dueDate = new Date();
    const batasBayar = (global.config && global.config.tanggal_batas_bayar) || 10;
    dueDate.setDate(batasBayar);
    const jatuh_tempo = dueDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

    let unpaidCount = 0;
    let whitelistedCount = 0;
    const items = [];
    const skipped = [];

    // === FASE 1: kumpulkan target (tak ada I/O kirim di sini) ===
    for (const user of (global.users || [])) {
        // Akun infrastruktur (mis. modem CCTV/monitoring) tidak ditagih → lewati reminder.
        if (isInfrastructure(user)) continue;
        if (user.paid) continue; // sudah bayar → skip

        unpaidCount++;

        const userProfile = getProfileBySubscription(user.subscription);
        if (whitelistedProfile.includes(userProfile)) {
            whitelistedCount++;
            continue;
        }

        // Nol yang SAH (diskon penuh / paket Rp0) → jangan menagih orang yang tidak berutang.
        // Nol karena katalog paket tak terbaca oleh price-owner → JANGAN diam-diam berhenti
        // menagih: pakai harga paket dan catat peringatannya.
        const packageInfo = (global.packages || []).find(p => p.name === user.subscription) || {};
        const tagihan = resolveBillingAmount(user, packageInfo.price);
        if (tagihan.zeroIsReal) {
            skipped.push({ name: user.name, reason: `tak ada yang ditagih (${tagihan.reason})` });
            continue;
        }
        if (tagihan.reason === 'katalog-tak-terbaca') {
            console.warn(`[CRON_REMINDER] Harga efektif tak terbaca untuk ${user.name} — pakai harga paket.`);
        }

        // Link bayar mandiri (QRIS/VA/retail) — token bertanda-tangan, tanpa login.
        let linkBayar = '';
        try {
            linkBayar = buildBillPayUrl(user, { periodMonth: currentMonth.getMonth() + 1, periodYear: currentMonth.getFullYear() });
        } catch (linkErr) {
            console.error(`[CRON_REMINDER] Gagal buat link bayar untuk ${user.name}: ${linkErr.message}`);
        }

        const messageText = renderTemplate('unpaid_reminder', {
            nama_pelanggan: user.name,
            nama_paket: user.subscription,
            // Harga EFEKTIF, satu sumber dengan ledger. Nol yang sah sudah disaring di gerbang di
            // atas, jadi yang sampai ke sini selalu nominal yang benar-benar ditagih.
            harga: tagihan.amount,
            jatuh_tempo,
            periode,
            link_bayar: linkBayar
        });

        if (!messageText || String(messageText).startsWith('Error:')) {
            skipped.push({ name: user.name, reason: 'render template unpaid_reminder gagal' });
            continue;
        }
        if (!user.phone_number) {
            skipped.push({ name: user.name, reason: 'tanpa No HP' });
            continue;
        }
        for (const raw of String(user.phone_number).split('|')) {
            const jid = buildJid(raw);
            if (jid) items.push({ jid, text: messageText, label: user.name });
            else skipped.push({ name: user.name, reason: `nomor tak valid: "${String(raw).trim()}"` });
        }
    }

    // === FASE 2: kirim + RETRY (blip koneksi tak boleh menghilangkan pelanggan) ===
    if (items.length > 0 && !isReady()) {
        console.warn(`[CRON_REMINDER] WhatsApp belum siap (state: ${getConnectionState()}) — antrian ${items.length} pesan akan menunggu & di-retry.`);
    }
    const res = await sendQueueWithRetry({
        items,
        safeSendMessage,
        isReady,
        delay,
        messageDelayMs: messageDelay,
        retry: resolveRetryConfig(global.config),
        tag: 'CRON_REMINDER',
        logger: console,
    });

    // === FASE 3: ringkasan — JANGAN BISU ===
    for (const s of skipped) console.log(`[CRON_REMINDER_SKIP] ${s.name}: ${s.reason}`);
    console.log(`[CRON_REMINDER] === SUMMARY === unpaid=${unpaidCount} whitelisted=${whitelistedCount} target=${items.length} sent=${res.sent} gagal=${res.failed.length} skipped=${skipped.length}`);
    return { unpaid: unpaidCount, whitelisted: whitelistedCount, target: items.length, sent: res.sent, failed: res.failed.length, skipped: skipped.length };
}

function initReminderTask(config) {
    if (cronTaskReminder) cronTaskReminder.stop();
    if (config.status_schedule === true && isValidCron(config.schedule)) {
        console.log("[CRON_REMINDER] Starting/Restarting reminder task with schedule:", config.schedule);
        cronTaskReminder = cron.schedule(config.schedule, async () => {
            const currentConfig = loadCronConfig();
            if (currentConfig.status_schedule !== true) return;

            if (reminderRunning) {
                console.warn("[CRON_REMINDER_SKIPPED] Previous reminder cycle still running, skipping this tick.");
                return;
            }

            // Cron schedule (`cron.json`) adalah satu-satunya sumber waktu firing reminder.
            // `tanggal_pengingat` di config.json tetap dipakai untuk rendering template
            // (mis. `jatuh_tempo`), bukan untuk gating cron.
            const reminderDayInfo = (global.config && parseInt(global.config.tanggal_pengingat)) || 1;
            console.log(`[CRON_REMINDER] Task executed at: ${new Date().toLocaleString('id-ID')}. tanggal_pengingat config: ${reminderDayInfo} (for template only, schedule is authoritative).`);

            reminderRunning = true;
            try {
                await runReminderCycle();
            } catch (err) {
                console.error('[CRON_REMINDER_ERROR] Siklus reminder gagal:', err.message);
            } finally {
                reminderRunning = false;
            }
        });
    } else {
        // Reminder task disabled (silent)
    }
}

module.exports = {
    initReminderTask,
    generateReminderData,
    runReminderCycle,
};
