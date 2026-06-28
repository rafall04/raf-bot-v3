/**
 * Header Doc
 * Purpose: Cron job pengingat MASA TENGGANG — tahap penagihan antara jatuh tempo (tanggal_batas_bayar)
 *   dan isolir (tanggal_isolir). Kirim 1x peringatan ke pelanggan unpaid bahwa pembayaran sudah lewat
 *   jatuh tempo dan layanan akan dinonaktifkan bila tak dibayar sebelum tanggal isolir. TIDAK mengisolir
 *   (tak menyentuh MikroTik) — murni notifikasi. State holder `cronTaskGraceReminder` ter-encapsulasi di module ini.
 * Caller: `lib/cron.js` (composer) via `initGraceReminderTask`.
 * Deps: `node-cron`, `../shared` (delay, isValidCron, loadCronConfig, safeSendMessage), `../../templating` (renderTemplate),
 *   `../../myfunc` (getProfileBySubscription), `../../bill-pay-token` (buildBillPayUrl), `../../whatsapp-gateway` (isReady, getConnectionState), `../../account-classification` (isInfrastructure).
 * MainFuncs: `initGraceReminderTask(config)` — schedule/restart task masa-tenggang berdasarkan config.
 * SideEffects: Jadwalkan job background, kirim WhatsApp, log progress.
 */
"use strict";

const cron = require('node-cron');
const formatRupiah = require('rupiah-format');

const { delay, isValidCron, loadCronConfig, safeSendMessage } = require('../shared');
const { renderTemplate } = require('../../templating');
const { getProfileBySubscription } = require('../../myfunc');
const { buildBillPayUrl } = require('../../bill-pay-token');
const { isReady, getConnectionState } = require('../../whatsapp-gateway');
const { isInfrastructure } = require('../../account-classification');

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
            const whitelistedProfile = (global.packages || []).filter(v => v.whitelist).map(v => v.profile);
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
            let messagesSent = 0;

            for (const user of (global.users || [])) {
                // Akun infrastruktur (mis. modem CCTV/monitoring) tidak ditagih → lewati.
                if (isInfrastructure(user)) continue;
                if (user.paid) continue; // sudah bayar → tak perlu peringatan tenggang

                unpaidCount++;

                const userProfile = getProfileBySubscription(user.subscription);
                if (whitelistedProfile.includes(userProfile)) {
                    whitelistedCount++;
                    continue;
                }

                const packageInfo = (global.packages || []).find(p => p.name === user.subscription) || {};
                const hargaFormatted = packageInfo.price ? formatRupiah.convert(packageInfo.price) : 'Tidak diketahui';

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

                if (!messageText || messageText.startsWith('Error:')) {
                    console.error(`[CRON_GRACE_ERROR] Template render gagal untuk ${user.name}: ${messageText}`);
                    continue;
                }
                if (!user.phone_number) {
                    console.warn(`[CRON_GRACE_WARN] User ${user.name} tak punya nomor`);
                    continue;
                }
                if (!isReady()) {
                    console.error(`[CRON_GRACE_ERROR] WhatsApp tak terhubung (state: ${getConnectionState()})! Stop siklus.`);
                    break;
                }

                const phoneNumbers = user.phone_number.split('|');
                let shouldStopSending = false;
                for (const number of phoneNumbers) {
                    if (shouldStopSending) break;
                    const normalizedNumber = number.trim() + "@s.whatsapp.net";
                    if (normalizedNumber.length > 15) {
                        const result = await safeSendMessage(normalizedNumber, { text: messageText });
                        if (result.success) {
                            console.log(`[CRON_GRACE] ✅ Peringatan tenggang terkirim ke ${user.name} (${normalizedNumber})`);
                            messagesSent++;
                            await delay(messageDelay);
                        } else {
                            console.error(`[CRON_GRACE_ERROR] ❌ Gagal kirim ke ${normalizedNumber} (${user.name}):`, result.error);
                            if (result.shouldStop) {
                                console.warn(`[CRON_GRACE_WARN] Connection error, stop siklus tenggang.`);
                                shouldStopSending = true;
                            }
                        }
                    } else {
                        console.warn(`[CRON_GRACE_WARN] Panjang nomor invalid untuk ${user.name}: ${normalizedNumber}`);
                    }
                }
                if (shouldStopSending) break;
            }

            console.log(`[CRON_GRACE] === SUMMARY === unpaid=${unpaidCount} whitelisted=${whitelistedCount} sent=${messagesSent}`);
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
};
