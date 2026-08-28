/**
 * Header Doc
 * Purpose: Cron job pengingat MASA TENGGANG — tahap penagihan antara jatuh tempo (tanggal_batas_bayar)
 *   dan isolir (tanggal_isolir). Kirim 1x peringatan ke pelanggan unpaid bahwa pembayaran sudah lewat
 *   jatuh tempo dan layanan akan dinonaktifkan bila tak dibayar sebelum tanggal isolir. TIDAK mengisolir
 *   (tak menyentuh MikroTik) — murni notifikasi. State holder `cronTaskGraceReminder` ter-encapsulasi di module ini.
 *   DI-HARDEN (2026-07-16): pengiriman lewat helper bersama `../wa-send-queue` → RETRY tahan blip
 *   koneksi (dulu `break` saat WA putus → SISA ANTRIAN hilang untuk bulan itu) + laporan tak bisu
 *   (tiap skip dicatat + alasan + ringkasan).
 * Caller: `lib/cron.js` (composer) via `initGraceReminderTask`.
 * Deps: `node-cron`, `../shared` (delay, isValidCron, loadCronConfig, safeSendMessage), `../wa-send-queue`
 *   (sendQueueWithRetry, buildJid, resolveRetryConfig), `../../templating` (renderTemplate),
 *   `../../bill-pay-token` (buildBillPayUrl),
 *   `../../whatsapp-gateway` (isReady), `../../account-classification` (isInfrastructure).
 * MainFuncs: `initGraceReminderTask(config)`, `resolveScheduleConfig(config)`, `runGraceReminderCycle()`.
 * SideEffects: Jadwalkan job background, kirim WhatsApp (dengan retry), log ringkasan.
 */
"use strict";

const cron = require('node-cron');
const formatRupiah = require('rupiah-format');

const { delay, isValidCron, loadCronConfig, safeSendMessage } = require('../shared');
const { sendQueueWithRetry, buildJid, resolveRetryConfig } = require('../wa-send-queue');
const { renderTemplate } = require('../../templating');
const { buildBillPayUrl } = require('../../bill-pay-token');
const { isReady, getConnectionState } = require('../../whatsapp-gateway');
const { isInfrastructure, getWhitelistedPackageNames, isEndOfMonthBillingActive } = require('../../account-classification');
// Sama seperti reminder.js: harga yang disebut ke pelanggan harus harga EFEKTIF (subscription_price
// per-pelanggan + diskon aktif), bukan harga paket mentah — satu sumber dengan ledger.
const { resolveBillingAmount } = require('../../payment-finance-service');

// Default opt-OUT: aktif kecuali config eksplisit men-set false. Jadwal default tgl 11 08:00.
// Ini sengaja beda dgn task lain (yang opt-in) supaya fitur staged-billing langsung jalan
// pasca-deploy tanpa wajib edit cron.json; tetap bisa dimatikan/diubah dari config.
const DEFAULT_SCHEDULE = '0 8 11 * *';

let cronTaskGraceReminder = null;
let graceRunning = false;

function resolveScheduleConfig(config) {
    const schedule = (config && typeof config.schedule_masa_tenggang === 'string' && config.schedule_masa_tenggang)
        ? config.schedule_masa_tenggang
        : DEFAULT_SCHEDULE;
    const enabled = !config || config.status_masa_tenggang !== false; // default true
    return { schedule, enabled };
}

/** Inti siklus masa tenggang: kumpulkan target → kirim (retry) → ringkasan. */
async function runGraceReminderCycle() {
    // Dikunci pada NAMA PAKET, bukan profil — lihat lib/account-classification.js.
    const paketWhitelist = getWhitelistedPackageNames();
    const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay)) || 2000;

    const now = new Date();
    const periode = now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    // Jatuh tempo = tanggal_batas_bayar bulan ini; isolir = tanggal_isolir bulan ini.
    const batasBayar = parseInt(global.config && global.config.tanggal_batas_bayar) || 10;
    const tglIsolir = parseInt(global.config && global.config.tanggal_isolir) || 16;
    const jatuhTempoDate = new Date(now.getFullYear(), now.getMonth(), batasBayar);
    const isolirDate = new Date(now.getFullYear(), now.getMonth(), tglIsolir);
    const fmt = (d) => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    const jatuh_tempo = fmt(jatuhTempoDate);
    const tanggal_isolir = fmt(isolirDate);

    console.log(`[CRON_GRACE] Task executed at: ${now.toLocaleString('id-ID')}. jatuh_tempo=${jatuh_tempo} isolir=${tanggal_isolir}`);

    let unpaidCount = 0;
    let whitelistedCount = 0;
    const items = [];
    const skipped = [];

    // === FASE 1: kumpulkan target (tak ada I/O kirim di sini) ===
    for (const user of (global.users || [])) {
        // Akun infrastruktur (mis. modem CCTV/monitoring) tidak ditagih → lewati.
        if (isInfrastructure(user)) continue;
        // Kohort siklus AKHIR BULAN ditangani cron billing-akhir-bulan → kecualikan di sini.
        if (isEndOfMonthBillingActive(user)) continue;
        if (user.paid) continue; // sudah bayar → tak perlu peringatan tenggang

        unpaidCount++;

        if (paketWhitelist.has(user.subscription)) {
            whitelistedCount++;
            continue;
        }

        // Nol yang SAH (diskon penuh / paket Rp0) → jangan kirim surat peringatan isolir ke orang
        // yang tidak berutang. Nol karena katalog tak terbaca → JANGAN diam: pakai harga paket.
        // Ini juga menutup jalur teks rusak — string non-angka pada slot `harga` dilewatkan
        // `convertRupiah.convert()` di lib/templating.js dan keluar sebagai
        // "Rp. Tid.ak .dik.eta.hui,00" di dalam surat peringatan isolir.
        const packageInfo = (global.packages || []).find(p => p.name === user.subscription) || {};
        const tagihan = resolveBillingAmount(user, packageInfo.price);
        if (tagihan.zeroIsReal) {
            skipped.push({ name: user.name, reason: `tak ada yang ditagih (${tagihan.reason})` });
            continue;
        }
        if (tagihan.reason === 'katalog-tak-terbaca') {
            console.warn(`[CRON_GRACE] Harga efektif tak terbaca untuk ${user.name} — pakai harga paket.`);
        }
        const hargaFormatted = tagihan.amount > 0 ? formatRupiah.convert(tagihan.amount) : 'Tidak diketahui';

        // Link bayar mandiri (QRIS/VA/retail) — token bertanda-tangan, tanpa login.
        let linkBayar = '';
        try {
            linkBayar = buildBillPayUrl(user, { periodMonth: now.getMonth() + 1, periodYear: now.getFullYear() });
        } catch (linkErr) {
            console.error(`[CRON_GRACE] Gagal buat link bayar untuk ${user.name}: ${linkErr.message}`);
        }

        const messageText = renderTemplate('masa_tenggang_reminder', {
            nama_pelanggan: user.name,
            nama_paket: user.subscription,
            harga: hargaFormatted,
            jatuh_tempo,
            tanggal_isolir,
            periode,
            link_bayar: linkBayar
        });

        if (!messageText || String(messageText).startsWith('Error:')) {
            skipped.push({ name: user.name, reason: 'render template masa_tenggang_reminder gagal' });
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
        console.warn(`[CRON_GRACE] WhatsApp belum siap (state: ${getConnectionState()}) — antrian ${items.length} pesan akan menunggu & di-retry.`);
    }
    const res = await sendQueueWithRetry({
        items,
        safeSendMessage,
        isReady,
        delay,
        messageDelayMs: messageDelay,
        retry: resolveRetryConfig(global.config),
        tag: 'CRON_GRACE',
        logger: console,
    });

    // === FASE 3: ringkasan — JANGAN BISU ===
    for (const s of skipped) console.log(`[CRON_GRACE_SKIP] ${s.name}: ${s.reason}`);
    console.log(`[CRON_GRACE] === SUMMARY === unpaid=${unpaidCount} whitelisted=${whitelistedCount} target=${items.length} sent=${res.sent} gagal=${res.failed.length} skipped=${skipped.length}`);
    return { unpaid: unpaidCount, whitelisted: whitelistedCount, target: items.length, sent: res.sent, failed: res.failed.length, skipped: skipped.length };
}

function initGraceReminderTask(config) {
    if (cronTaskGraceReminder) cronTaskGraceReminder.stop();

    const { schedule, enabled } = resolveScheduleConfig(config);
    if (!enabled) {
        // Task masa tenggang dinonaktifkan (silent).
        return;
    }
    if (!isValidCron(schedule)) {
        console.error(`[CRON_GRACE] Jadwal tidak valid: "${schedule}". Task tidak dijalankan.`);
        return;
    }

    console.log("[CRON_GRACE] Starting/Restarting grace (masa tenggang) task with schedule:", schedule);
    cronTaskGraceReminder = cron.schedule(schedule, async () => {
        // Overlap guard — cegah dua siklus jalan bersamaan.
        if (graceRunning) {
            console.warn("[CRON_GRACE_SKIPPED] Previous grace cycle still running, skipping this tick.");
            return;
        }

        const currentConfig = loadCronConfig();
        if (resolveScheduleConfig(currentConfig).enabled === false) return;

        graceRunning = true;
        try {
            await runGraceReminderCycle();
        } catch (err) {
            console.error('[CRON_GRACE_ERROR] Siklus masa tenggang gagal:', err.message);
        } finally {
            graceRunning = false;
        }
    });
}

module.exports = {
    initGraceReminderTask,
    resolveScheduleConfig,
    runGraceReminderCycle,
};
