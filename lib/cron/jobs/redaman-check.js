/**
 * Header Doc
 * Purpose: Cron job redaman-check — poll GenieACS untuk device MILIK PELANGGAN BOT INI, refresh nilai redaman (RX power) agar segar, saring yang lebih buruk dari `rx_tolerance` DAN masih layak dipercaya umurnya, lalu kirim notifikasi WA ke penerima yang DIATUR pemilik (peran + nomor tambahan). State holder `checkTask` ter-encapsulasi di module ini. Function di-export sebagai `startCheck` (legacy name) untuk backward compat dengan `routes/admin-config-routes.js` dan composer.
 * Caller: `lib/cron.js` (composer) via `startCheck`.
 * Deps: `node-cron`, `../shared` (delay, loadCronConfig, safeSendMessage), `../../wifi` (REDAMAN_PATHS), `../../genieacs` (queryDevices, refreshObjects), `../../templating` (renderTemplate, templatesCache), `../../redaman-alert-recipients`, `../../redaman-alert-scope`, `../../redaman-alert-cooldown-store`.
 * MainFuncs: `startCheck()` — schedule/restart task redaman check; reload setiap kali dipanggil (idempotent).
 * SideEffects: Jadwalkan job background, panggil GenieACS API (refresh BERKELOMPOK + query devices), tulis `database/redaman-alert-cooldown.json`, kirim WhatsApp ke PENERIMA yang diatur di halaman Konfigurasi — lihat lib/redaman-alert-recipients.js & lib/redaman-alert-scope.js. Juga mengirim ALARM ke penerima yang sama bila cron gagal N kali beruntun (`redamanCronAlertAfter`), supaya pemantauan yang mati tidak lagi senyap.
 * Gate config: `genieacsRefreshConcurrency` (ukuran kelompok refresh), `genieacsRefreshDelay` (jeda antar-kelompok), `genieacsRefreshTimeoutMs` (tunggu per modem), `redamanCronAlertAfter` + `redamanCronAlertCooldownMs` (alarm cron mati).
 */
"use strict";

const cron = require('node-cron');

const { delay, loadCronConfig, safeSendMessage } = require('../shared');
const { REDAMAN_PATHS } = require('../../wifi');
const { queryDevices, refreshObjects } = require('../../genieacs');
const { DEFAULT_MAX_INFORM_MINUTES } = require('../../device-status');
const { renderTemplate, templatesCache } = require('../../templating');
const { resolvePenerimaRedaman } = require('../../redaman-alert-recipients');
const {
    ALASAN,
    bacaSetelanLingkup,
    bangunPetaDevicePelanggan,
    bacaNilaiRedaman,
    evaluasiDevice,
} = require('../../redaman-alert-scope');
const cooldownStore = require('../../redaman-alert-cooldown-store');

let checkTask = null;

// !! PEMANTAUAN YANG MATI HARUS BERTERIAK (#b251).
// Pada 2026-08-20 cron ini gagal 18 kali berturut-turut (04:00–21:00) di Tanjungharjo — pemantauan
// redaman buta seharian penuh dan TIDAK ADA seorang pun tahu, karena kegagalan cron cuma dicetak
// ke log. Pola "buta senyap" yang sama sudah pernah menggigit di sisi OLT. Sekarang: N kegagalan
// beruntun → satu pesan ke penerima alert redaman, lalu diam sampai cooldown supaya tidak spam.
// Penghitungnya sengaja IN-MEMORY: kegagalan seperti ini berulang tiap jam, jadi restart proses
// hanya menunda alarm satu-dua jam — tidak sepadan dengan risiko menambah berkas state baru.
let gagalBeruntun = 0;
let alarmTerakhirMs = 0;

async function alarmkanKegagalanBeruntun(pesanGalat) {
    try {
        gagalBeruntun += 1;
        const ambang = Math.max(1, parseInt(global.config?.redamanCronAlertAfter, 10) || 3);
        const cooldownMs = Math.max(0, parseInt(global.config?.redamanCronAlertCooldownMs, 10) || 6 * 60 * 60 * 1000);
        if (gagalBeruntun < ambang) return;
        if (Date.now() - alarmTerakhirMs < cooldownMs) return;

        // `resolvePenerimaRedaman` SINKRON dan memulangkan { aktif, jids, rincian }.
        const penerima = resolvePenerimaRedaman() || {};
        const daftar = Array.isArray(penerima.jids) ? penerima.jids : [];
        if (!penerima.aktif || !daftar.length) {
            console.warn('[CRON_REDAMAN_ALARM] gagal beruntun tapi tak ada penerima alert redaman yang aktif.');
            return;
        }
        const teks = [
            '🚨 *Pemantauan redaman MATI*',
            '',
            `Pengecekan redaman gagal *${gagalBeruntun} kali berturut-turut*.`,
            `Sebab terakhir: ${String(pesanGalat).slice(0, 200)}`,
            '',
            'Selama ini berlangsung, modem dengan redaman buruk TIDAK akan terdeteksi.',
        ].join("\n");
        // !! Cooldown 6 jam hanya boleh dipasang kalau alarmnya BENAR-BENAR terkirim.
        // Kalau WhatsApp sedang putus (dan itu justru sering barengan dengan gangguan lain),
        // menandai cooldown = membungkam alarm 6 jam berikutnya tanpa ada yang pernah diberi tahu.
        let terkirim = 0;
        for (const jid of daftar) {
            const hasil = await safeSendMessage(jid, { text: teks });
            if (hasil && hasil.success) terkirim += 1;
            if (hasil && hasil.shouldStop) break; // WA putus — tak ada gunanya meneruskan loop
        }
        if (terkirim === 0) {
            console.warn('[CRON_REDAMAN_ALARM] alarm GAGAL terkirim ke semua penerima — cooldown TIDAK dipasang, akan dicoba lagi run berikutnya.');
            return;
        }
        alarmTerakhirMs = Date.now();
        console.warn(`[CRON_REDAMAN_ALARM] alarm terkirim ke ${terkirim}/${daftar.length} penerima (gagal beruntun ${gagalBeruntun}).`);
    } catch (e) {
        // Alarm TIDAK BOLEH menjatuhkan cron — kegagalan kirim cukup dicatat.
        console.error('[CRON_REDAMAN_ALARM_ERROR]', e.message);
    }
}

function startCheck() {
    // Always stop the existing task first to prevent duplicates or zombies.
    if (checkTask) {
        // Stopping redaman task (silent)
        checkTask.stop();
        checkTask = null;
    }

    try {
        // Get schedule from cron config (moved from config.json to cron.json)
        const cronConfig = loadCronConfig();
        const schedule = cronConfig.check_schedule || '0 */6 * * *'; // Default: every 6 hours
        const isEnabled = cronConfig.status_check_schedule !== false; // Default enabled if not specified

        // Check if disabled
        if (!isEnabled || schedule.startsWith('#')) {
            console.log(`[CRON_REDAMAN] Redaman check task is DISABLED (status: ${isEnabled}, schedule: ${schedule})`);
            return;
        }

        // Validate the schedule
        if (!cron.validate(schedule)) {
            console.error(`[CRON_REDAMAN_ERROR] Invalid cron expression: "${schedule}". Job not started.`);
            return;
        }

        // If we reach here, the schedule is valid, so we create a new task.
        checkTask = cron.schedule(schedule, async () => {
            try {
                const setelanLingkup = bacaSetelanLingkup(global.config);
                const petaPelanggan = bangunPetaDevicePelanggan(global.users);

                // 1. Get all device IDs from GenieACS. Nilai redaman ikut diminta di panggilan
                //    yang SAMA (tanpa round-trip tambahan) semata untuk remah-remah pada langkah
                //    1c — nilai ini BELUM disegarkan dan tak pernah dipakai memutuskan alert.
                const allDevicesResult = await queryDevices({
                    projection: ['_id', '_lastInform', ...REDAMAN_PATHS].join(','),
                    timeoutMs: 30000,
                    operation: 'cron.redaman.listDevices',
                });
                if (!allDevicesResult.ok) {
                    throw new Error(allDevicesResult.message);
                }
                const allDevices = allDevicesResult.data;
                if (!allDevices || allDevices.length === 0) {
                    // Silent skip if no devices
                    return;
                }

                // 1b. Saring ke modem MILIK bot ini SEBELUM di-refresh. ACS dipakai bersama dua
                //     bot, jadi tanpa saringan ini tiap bot menyegarkan & menilai modem bot lain
                //     (terukur: 160 device di ACS, hanya 58 milik Dander / 96 milik Tanjungharjo).
                //     Menyaring lebih awal sekaligus memangkas beban connection-request ke ACS.
                let deviceIDs = allDevices.map(d => d._id);
                const totalDiAcs = deviceIDs.length;
                if (setelanLingkup.hanyaPelangganSendiri) {
                    deviceIDs = deviceIDs.filter(id => petaPelanggan.has(id));
                }
                const dilewatiBukanMilik = totalDiAcs - deviceIDs.length;

                // 1c. Remah-remah anti-bisu. Menyaring per kepemilikan menciptakan jalur gagal
                //     BARU: kalau `device_id` seorang pelanggan basi (mis. ganti modem tapi
                //     record tak diperbarui), modemnya diam-diam berhenti terpantau selamanya.
                //     Sebelum ada saringan, ia setidaknya masih muncul (walau sebagai
                //     "(Tidak Terdaftar)"). Jadi modem asing yang redamannya buruk tetap
                //     DIHITUNG dan dicetak — cukup untuk ketahuan, tanpa mengirimi teknisi
                //     modem yang bukan urusannya. Nilai di sini sengaja TIDAK disegarkan.
                let asingRedamanBuruk = 0;
                if (dilewatiBukanMilik > 0) {
                    const ambangCepat = parseInt(global.config.rx_tolerance, 10);
                    if (!isNaN(ambangCepat)) {
                        const milik = new Set(deviceIDs);
                        for (const d of allDevices) {
                            if (milik.has(d._id)) continue;
                            const n = bacaNilaiRedaman(d, REDAMAN_PATHS);
                            if (n && n.angka < ambangCepat) asingRedamanBuruk++;
                        }
                    }
                }

                // 1d. JANGAN me-refresh modem yang sedang DIAM. Tugas `refreshObject` untuk modem
                //     yang tak menyapa ACS TIDAK PERNAH dieksekusi — ia mengendap di antrean
                //     selamanya, karena GenieACS tak punya kedaluwarsa tugas.
                //
                //     !! TERUKUR DI PRODUKSI (#b260): satu modem yang DIGANTI pada 6 Juli
                //     mengumpulkan **3.797 tugas** sampai 23 Agustus — cron ini menambah ~48/hari
                //     (2 path x 24 jam) ke record yang tak akan pernah menjawab lagi. Kalau modem
                //     itu suatu saat dipasang ulang di rumah pelanggan lain, ia langsung dihantam
                //     ribuan refresh sekaligus.
                //
                //     Melewatinya tidak menghilangkan informasi: redaman modem yang mati memang
                //     tak bisa dibaca, dan kematiannya sendiri sudah ditangani jalur LOS/OLT.
                //     Ambangnya SATU pemilik bersama `device-status` — lihat #b257: inform periodik
                //     900 detik, jadi ambang di bawah itu memvonis mati modem yang sehat.
                const batasInformMs = DEFAULT_MAX_INFORM_MINUTES * 60 * 1000;
                const umurInform = new Map();
                for (const d of allDevices) {
                    const t = Date.parse(d && d._lastInform);
                    if (Number.isFinite(t)) umurInform.set(d._id, Date.now() - t);
                }
                const sebelumSaringDiam = deviceIDs.length;
                deviceIDs = deviceIDs.filter((id) => {
                    const umur = umurInform.get(id);
                    return umur === undefined || umur <= batasInformMs;
                });
                const dilewatiDiam = sebelumSaringDiam - deviceIDs.length;
                if (dilewatiDiam > 0) {
                    // Anti-bisu: kalau tak dicetak, "dilewati karena diam" terlihat sama persis
                    // dengan "diperiksa dan sehat".
                    console.log(`[CRON_REDAMAN_LEWAT_DIAM] ${dilewatiDiam} modem dilewati — tak menyapa ACS > ${DEFAULT_MAX_INFORM_MINUTES} menit (refresh-nya hanya akan mengendap di antrean).`);
                }

                if (deviceIDs.length === 0) {
                    // JANGAN BISU: tak ada device milik sendiri terlihat sama persis dengan
                    // "semua modem sehat" kalau tidak dicetak.
                    console.warn(`[CRON_REDAMAN_WARN] Tak ada modem pelanggan bot ini di ACS (${totalDiAcs} device asing dilewati) — tidak ada yang diperiksa.`);
                    return;
                }

                // 2. Refresh BERKELOMPOK — JANGAN serentak.
                //
                // !! Versi lama melepas SEMUA device sekaligus lewat `Promise.allSettled`:
                // 96 modem x 2 REDAMAN_PATHS = 192 connection-request dalam satu tick, lewat kolam
                // koneksi 20 jalur, masing-masing menunggu 30 detik. Modem yang mati tak menjawab,
                // dan (sebelum perbaikan di `recordCircuitFailure`) tiap timeout dihitung sebagai
                // "GenieACS down" sehingga breaker GLOBAL terbuka dan SELURUH run mati di detik
                // ~36. Terbukti di produksi 2026-08-20: pemantauan redaman Tanjungharjo buta 18 jam
                // berturut-turut, tanpa satu pun alarm. Lihat #b251.
                //
                // `genieacsRefreshDelay` DULU setelan hantu — ada di config kedua bot tapi tak
                // dibaca satu baris kode pun. Sekarang benar-benar dipakai sebagai jeda antar-kelompok.
                const ukuranKelompok = Math.max(1, parseInt(global.config.genieacsRefreshConcurrency, 10) || 8);
                const jedaAntarKelompok = Math.max(0, parseInt(global.config.genieacsRefreshDelay, 10) || 2000);
                const timeoutRefresh = Math.max(1000, parseInt(global.config.genieacsRefreshTimeoutMs, 10) || 10000);

                let refreshOk = 0;
                let refreshGagal = 0;
                const contohGagal = [];
                for (let i = 0; i < deviceIDs.length; i += ukuranKelompok) {
                    const kelompok = deviceIDs.slice(i, i + ukuranKelompok);
                    const hasil = await Promise.allSettled(kelompok.map((deviceId) =>
                        refreshObjects(deviceId, REDAMAN_PATHS, {
                            operation: 'cron.redaman.refresh',
                            // Modem yang bisu 10 detik juga tak akan menjawab di detik ke-30 —
                            // menunggu lebih lama hanya menahan antrean dan memperbesar risiko.
                            timeoutMs: timeoutRefresh,
                        })
                    ));
                    // BUKTI, bukan tebakan: hasil 192 permintaan DULU dibuang seluruhnya, sehingga
                    // 18 jam kegagalan tak menyisakan satu pun nama modem yang timeout.
                    hasil.forEach((h, idx) => {
                        const ok = h.status === 'fulfilled' && h.value && h.value.ok !== false;
                        if (ok) { refreshOk += 1; return; }
                        refreshGagal += 1;
                        if (contohGagal.length < 5) {
                            const sebab = h.status === 'rejected'
                                ? (h.reason && h.reason.message) || 'rejected'
                                : (h.value && (h.value.errorCode || h.value.message)) || 'gagal';
                            contohGagal.push(`${kelompok[idx]}=${String(sebab).slice(0, 40)}`);
                        }
                    });
                    if (i + ukuranKelompok < deviceIDs.length) await delay(jedaAntarKelompok);
                }
                console.log(
                    `[CRON_REDAMAN_REFRESH] terkirim ${refreshOk}/${deviceIDs.length} · gagal ${refreshGagal}` +
                    ` · kelompok ${ukuranKelompok} · jeda ${jedaAntarKelompok}ms · timeout ${timeoutRefresh}ms` +
                    (contohGagal.length ? ` · contoh: ${contohGagal.join(' | ')}` : '')
                );

                const delayAfterRefresh = global.config.genieacsRefreshBatchDelay || 5000;
                await delay(delayAfterRefresh);

                // 3. Batch Fetch: Get only redaman data for all devices in one call.
                //    `_id` diminta eksplisit karena dipakai memetakan device → pelanggan.
                const projectionFields = ['_id', ...REDAMAN_PATHS].join(',');
                const devicesWithRedamanResult = await queryDevices({
                    query: { "_id": { "$in": deviceIDs } },
                    projection: projectionFields,
                    timeoutMs: 30000,
                    operation: 'cron.redaman.fetchMetrics',
                });
                if (!devicesWithRedamanResult.ok) {
                    throw new Error(devicesWithRedamanResult.message);
                }
                const devicesWithRedaman = devicesWithRedamanResult.data || [];

                // console.log(`[CRON_REDAMAN] Fetched data for ${devicesWithRedaman.length} devices. Analyzing...`);

                // 4. Process and notify
                const rxTolerance = parseInt(global.config.rx_tolerance, 10);
                if (isNaN(rxTolerance)) {
                    console.error("[CRON_REDAMAN_ERROR] `rx_tolerance` in config.json is not a valid number. Skipping checks.");
                    return;
                }

                // Cooldown agar device buruk yang sama tidak di-alert tiap cycle. Kini DURABEL
                // (ditulis ke disk) — versi Map in-memory-nya kosong tiap `pm2 restart`, sehingga
                // jeda 12 jam sebenarnya cuma "sejak restart terakhir". Lihat store-nya.
                const cooldownMs = setelanLingkup.cooldownMs;
                const cooldown = cooldownStore.muat();
                let cooldownBerubah = false;
                const nowMs = Date.now();

                let devicesWithBadRedaman = 0;
                let devicesChecked = 0;
                let devicesSkipped = 0;
                let devicesAlertedSkippedByCooldown = 0;
                let devicesBukanMilik = 0;
                let devicesNilaiBasi = 0;

                for (const device of devicesWithRedaman) {
                    // Satu tempat memutuskan: kepemilikan → nilai terbaca → sehat/buruk →
                    // masih layak dipercaya umurnya. Fail-closed: buta bukan berarti buruk.
                    const putusan = evaluasiDevice(device, {
                        petaPelanggan,
                        paths: REDAMAN_PATHS,
                        rxTolerance,
                        maksUmurMs: setelanLingkup.maksUmurMs,
                        hanyaPelangganSendiri: setelanLingkup.hanyaPelangganSendiri,
                        sekarang: nowMs,
                    });

                    if (putusan.alasan === ALASAN.BUKAN_PELANGGAN) { devicesBukanMilik++; continue; }
                    if (putusan.alasan === ALASAN.TANPA_NILAI) { devicesSkipped++; continue; }

                    devicesChecked++;

                    if (putusan.alasan === ALASAN.NILAI_BASI) {
                        // Modem tak menjawab refresh — yang kita pegang cuma pembacaan lama.
                        // Mengalert dari sini akan mengulang vonis yang sama selamanya.
                        devicesNilaiBasi++;
                        devicesWithBadRedaman++;
                        continue;
                    }

                    if (putusan.alasan === ALASAN.ALERT) {
                        const redamanInt = putusan.angka;
                        devicesWithBadRedaman++; // Increment counter

                        // Cooldown: lewati notifikasi jika alert untuk device ini baru dikirim.
                        if (cooldownStore.masihDalamCooldown(cooldown, device._id, cooldownMs, nowMs)) {
                            devicesAlertedSkippedByCooldown++;
                            continue;
                        }

                        // Simplified log - only show device ID and redaman value
                        // Only log errors, not individual device checks

                        const findUser = putusan.pelanggan;

                        const templateData = {
                            nama_pelanggan: findUser?.name?.split("|")[0] || "(Tidak Terdaftar)",
                            no_hp: findUser?.phone_number?.split("|")[0] || "(Tidak Terdaftar)",
                            alamat: findUser?.address?.split("|")[0] || "(Tidak Diketahui)",
                            pppoe: findUser?.pppoe_username?.split("|")[0] || "(Tidak Diketahui)",
                            redaman: `${redamanInt} dBm`
                        };

                        // --- Defensive templating with diagnostics ---

                        // 1. Check if the template exists in the cache first
                        if (!templatesCache.notificationTemplates?.redaman_alert?.template) {
                            console.error(`[CRON_REDAMAN_ERROR] Template 'redaman_alert' tidak ditemukan. Skip device ${device._id}.`);
                            continue; // Skip to the next device in the loop
                        }

                        // 2. Render the template
                        const notificationText = renderTemplate('redaman_alert', templateData);

                        // 3. Check if rendering was successful
                        if (!notificationText || notificationText.startsWith('Error:')) {
                            console.error(`[CRON_REDAMAN_ERROR] Gagal render template untuk device ${device._id}. Skip notifikasi.`);
                            continue; // Skip to the next device in the loop
                        }

                        // Send notification to all accounts with a phone number
                        // Use skipDuplicateCheck: true because each alert is for a different device
                        // Notification tracker blocks alerts with similar content, but each redaman alert
                        // is unique (different device, different customer, different redaman value)
                        const messageDelay = (global.config && parseInt(global.config.whatsapp_message_delay)) || 2000;
                        let alertedAtLeastOnce = false;

                        // Penerima kini DIATUR dari halaman Konfigurasi (per peran + nomor
                        // tambahan), bukan di-hardcode "semua akun berponsel". Lihat alasan
                        // lengkap & bawaannya di lib/redaman-alert-recipients.js.
                        const penerima = resolvePenerimaRedaman();
                        if (!penerima.aktif) {
                            console.log('[CRON_REDAMAN_NOTIF] Alert redaman dimatikan dari konfigurasi — tak ada yang dikirimi.');
                        } else if (penerima.rincian.length === 0) {
                            // JANGAN BISU: setelan yang menghasilkan NOL penerima terlihat sama
                            // dengan "tak ada device bermasalah" kalau tak dicetak.
                            console.warn('[CRON_REDAMAN_NOTIF_WARN] Setelan penerima menghasilkan NOL penerima — alert tidak terkirim ke siapa pun.');
                        }

                        for (const target of penerima.rincian) {
                            // Gunakan safeSendMessage untuk pengecekan koneksi yang aman
                            const result = await safeSendMessage(target.jid, { text: notificationText }, { skipDuplicateCheck: true });

                            if (result.success) {
                                alertedAtLeastOnce = true;
                                // Add delay between notifications to same account
                                await delay(messageDelay);
                            } else {
                                console.error(`[CRON_REDAMAN_NOTIF_ERROR] Gagal kirim ke ${target.label} (${target.jid}):`, result.error);
                                // Jika error adalah connection error, stop sending ke account lain
                                if (result.shouldStop) {
                                    console.warn(`[CRON_REDAMAN_NOTIF_WARN] Connection error detected, stopping notifications for this cycle.`);
                                    break;
                                }
                            }
                        }

                        // Tandai cooldown hanya jika minimal satu account berhasil menerima.
                        // Jika WA mati total, jangan masukin cooldown supaya cycle berikutnya retry.
                        if (alertedAtLeastOnce) {
                            cooldownStore.tandaiTerkirim(cooldown, device._id, Date.now());
                            cooldownBerubah = true;
                        }

                        // Add delay between devices to prevent overwhelming the system
                        // This ensures proper spacing between different device alerts
                        if (messageDelay > 0) {
                            await delay(messageDelay);
                        }
                    }
                }

                // Satu tulis per siklus, bukan satu IO per device.
                if (cooldownBerubah) {
                    cooldownStore.simpan(cooldownStore.prune(cooldown, undefined, nowMs));
                }

                // Only log if there are issues
                if (devicesWithBadRedaman > 0) {
                    const cooldownNote = devicesAlertedSkippedByCooldown > 0
                        ? ` (${devicesAlertedSkippedByCooldown} ditahan cooldown)`
                        : '';
                    const basiNote = devicesNilaiBasi > 0
                        ? ` (${devicesNilaiBasi} DILEWATI: nilainya basi, modem tak menjawab refresh)`
                        : '';
                    console.log(`[CRON] Redaman: ${devicesWithBadRedaman}/${devicesChecked} device buruk${cooldownNote}${basiNote}`);
                }

                // Ringkasan cakupan — dicetak walau semua sehat, supaya penyaringan tak pernah
                // tak terlihat. Tanpa ini, "0 device buruk" tak bisa dibedakan dari
                // "tak ada yang diperiksa karena tersaring habis".
                const asingBurukNote = asingRedamanBuruk > 0
                    ? ` (${asingRedamanBuruk} di antaranya redamannya BURUK — cek apakah device_id pelanggan basi atau modem belum terdaftar)`
                    : '';
                console.log(
                    `[CRON_REDAMAN_CAKUPAN] ACS ${totalDiAcs} device · diperiksa ${devicesChecked}`
                    + ` · bukan pelanggan bot ini ${dilewatiBukanMilik + devicesBukanMilik}${asingBurukNote}`
                    + ` · tanpa nilai ${devicesSkipped}`
                    + ` · nilai basi ${devicesNilaiBasi}`
                );

                // Reset penghitung gagal-beruntun HANYA di sini — satu-satunya titik yang
                // membuktikan SELURUH siklus tuntas. Sempat salah taruh (setelah fase refresh),
                // dan itu membuat alarm tak akan pernah berbunyi untuk insiden yang justru
                // melahirkannya: pada 2026-08-20 fase refresh SELESAI lalu langkah berikutnya
                // yang melempar, jadi penghitungnya direset tiap jam dan tak pernah capai ambang.
                gagalBeruntun = 0;

            } catch (error) {
                const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
                console.error(`[CRON_REDAMAN_ERROR] Error: ${errorMessage}`);
                await alarmkanKegagalanBeruntun(errorMessage);
            }
        });
        // Redaman check scheduled (silent)
    } catch (e) {
        console.error("[CRON_REDAMAN_SETUP_ERROR] Error setting up redaman check cron job:", e);
    }
}

module.exports = {
    startCheck
};
