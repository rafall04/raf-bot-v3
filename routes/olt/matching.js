/**
 * Header Doc
 * Purpose: Sub-router pencocokan ONU↔pelanggan — GET /matched, /infra-status.
 * Caller: `routes/olt.js` (composer) — jangan mount langsung.
 * MainFuncs: GET `/matched`, GET `/infra-status`.
 * SideEffects: sama seperti routes/olt.js asli (split #b395 — murni pemindahan kode).
 */
const log = require('../../lib/logger').logger.child('MATCHING');
const express = require('express');
const router = express.Router();
const { normalizeMAC } = require('../../lib/olt-hioso');
const oltLogScraper = require('../../lib/olt-log-scraper');
const oltManager = require('../../lib/olt-manager');
const { buildOnuIndex, matchOnu, isRxPowerValid, isSnapshotReadableFor } = require('../../lib/olt-optical-resolver');
const { isInfrastructure } = require('../../lib/account-classification');
const { buildInfraRow } = require('../../lib/infra-status');
const { getCachedMultipleOltData, getCachedPppoeData, getMacForUser, lastCallerIdCache, saveLastCallerIdCache } = require('./shared');

/**
 * GET /api/olt/matched
 * Get ONT status matched with customer data
 * Matching berdasarkan MAC address (10 digit pertama)
 * Menggunakan last caller ID untuk pelanggan offline
 * Support multiple OLT - query semua OLT parallel
 */
router.get('/matched', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }

        const globalConfig = oltManager.getOltGlobalConfig();

        if (!globalConfig.enabled) {
            return res.json({ 
                status: 200, 
                message: 'OLT tidak diaktifkan',
                data: [],
                enabled: false
            });
        }

        // Get all OLT devices
        const oltDevices = oltManager.getOltDevices();
        
        if (oltDevices.length === 0) {
            return res.json({
                status: 200,
                message: 'Tidak ada OLT yang dikonfigurasi',
                data: [],
                enabled: true,
                error: true
            });
        }

        // Get OLT data dari semua OLT (parallel query, dengan cache 30 dtk)
        log.info(`[OLT] Fetching matched ONT data from ${oltDevices.length} OLT(s)`);
        const forceRefresh = req.query.force === 'true';
        const { data: oltResult, freshness } = await getCachedMultipleOltData(oltDevices, forceRefresh);

        if (oltResult.status !== 'success') {
            return res.json({
                status: 200,
                message: oltResult.message || 'Gagal mengambil data OLT',
                data: [],
                enabled: true,
                error: true
            });
        }

        // Get MikroTik PPPoE active sessions with MAC
        let pppoeActive = [];
        try {
            pppoeActive = await getCachedPppoeData();
            if (pppoeActive && Array.isArray(pppoeActive)) {
                log.info(`[OLT] Got ${pppoeActive.length} PPPoE active users`);
            }
        } catch (mikrotikError) {
            log.error('[OLT] Error getting MikroTik data:', mikrotikError.message);
        }

        // Get users from global
        const users = global.users || [];

        // Build matched data menggunakan last caller ID untuk offline users.
        // Indeks ONU + resolusi identitas brand-agnostik (PPPoE→serial→MAC) diekstrak
        // ke lib/olt-optical-resolver sebagai satu sumber kebenaran (dipakai bersama
        // bot Telegram teknisi). Perilaku identik dengan versi inline sebelumnya.
        const matchedData = [];
        const onuIndex = buildOnuIndex(oltResult.onus, { normalizeMAC });

        // Match setiap user dengan OLT data
        // PENTING: Jika user punya MAC (dari cache) tapi ONT tidak ada di OLT,
        // itu berarti ONT dalam kondisi DYING GASP (adaptor mati)
        for (const user of users) {
            if (!user.pppoe_username) continue;

            // MAC dari active session / last known (EPON). Bisa null untuk pelanggan GPON.
            const macInfo = getMacForUser(user.pppoe_username, pppoeActive);

            // Resolusi identitas brand-agnostik: PPPoE(deskripsi GPON) → serial → MAC(EPON).
            const { onu: matchedOnu } = matchOnu(user, { index: onuIndex, macInfo }, { normalizeMAC });

            // Tidak ada cara identifikasi sama sekali → lewati.
            if (!matchedOnu && !macInfo) continue;

            // Debug log untuk user tertentu
            if (user.pppoe_username.includes('tes@') || user.pppoe_username.includes('mbah')) {
                log.info(`[OLT DEBUG] User: ${user.pppoe_username}, MAC: ${macInfo.mac}, Source: ${macInfo.source}, Found in OLT: ${!!matchedOnu}`);
            }
            
            if (matchedOnu) {
                // ONT ditemukan di OLT - gunakan data dari OLT
                // Cek juga event dari log scraper untuk status LOS/Dying Gasp yang lebih akurat
                const logEvent = oltLogScraper.getEventByMAC(matchedOnu.macAddress);
                
                let finalStatus = matchedOnu.status;
                let isDyingGasp = matchedOnu.isDyingGasp;
                let isLos = matchedOnu.isLos;
                
                // Jika ONT offline dan ada event dari log scraper, gunakan data dari log
                if (matchedOnu.status !== 'Online' && logEvent) {
                    if (logEvent.event_type === 'dying-gasp') {
                        finalStatus = 'Dying Gasp';
                        isDyingGasp = true;
                        isLos = false;
                    } else if (logEvent.event_type === 'los') {
                        finalStatus = 'LOS';
                        isDyingGasp = false;
                        isLos = true;
                    }
                }
                
                // Simpan mapping MAC -> OLT supaya ONT yang sedang offline pun
                // tetap bisa diketahui ikut OLT mana di query berikutnya. (EPON saja;
                // GPON macAddress='N/A' jadi di-skip.)
                if (matchedOnu.macAddress && matchedOnu.macAddress !== 'N/A' && matchedOnu.olt_id) {
                    oltManager.updateMacCache(matchedOnu.macAddress, matchedOnu.olt_id, matchedOnu.olt_name, matchedOnu.olt_host);
                }

                matchedData.push({
                    user_id: user.id,
                    customer_name: user.name,
                    account_type: user.account_type || 'pelanggan',
                    pppoe_username: user.pppoe_username,
                    mac_mikrotik: macInfo ? macInfo.mac : null,
                    mac_source: macInfo ? macInfo.source : 'olt', // 'active'/'cached'/'olt' (GPON match by pppoe)
                    mac_olt: matchedOnu.macAddress,
                    serial: matchedOnu.serial || null,
                    description: matchedOnu.description || null,
                    pon_name: matchedOnu.ponName || null,
                    olt_brand: matchedOnu.olt_brand || null,
                    olt_id: matchedOnu.olt_id || null,
                    olt_name: matchedOnu.olt_name || null,
                    olt_host: matchedOnu.olt_host || null,
                    rx_power: matchedOnu.rxPower,
                    // Nilai di atas bisa jadi pembacaan TERAKHIR dari ONU yang sudah mati; dua
                    // penanda ini yang menentukan boleh tidaknya ia dibaca sebagai kondisi kini.
                    rx_power_valid: isRxPowerValid(matchedOnu, finalStatus),
                    status_known: matchedOnu.statusKnown !== false,
                    olt_status: finalStatus,
                    is_dying_gasp: isDyingGasp,
                    is_los: isLos,
                    last_down_cause: matchedOnu.lastDownCause,
                    slot_id: matchedOnu.slotId,
                    onu_id: matchedOnu.id,
                    log_event: logEvent ? logEvent.event_type : null,
                    log_timestamp: logEvent ? logEvent.timestamp : null
                });
            } else {
                // ONT TIDAK ditemukan di OLT
                // Cek event dari log scraper untuk status yang lebih akurat
                const userMacNormalized = oltLogScraper.normalizeMAC(macInfo.mac);
                const logEvent = oltLogScraper.getEventByMAC(userMacNormalized);
                
                // Coba ambil slot/onu dari cache jika ada
                const cachedInfo = lastCallerIdCache.get(user.pppoe_username);
                
                // ONT tidak ada di OLT saat ini; coba kenali OLT-nya dari cache MAC.
                const cachedOlt = oltManager.getOltFromMac(macInfo.mac);

                let finalStatus = 'Offline';
                let isDyingGasp = false;
                let isLos = false;
                // ABSENNYA ONU cuma bermakna kalau OLT-nya memang terbaca. Bila OLT pelanggan ini
                // bisu ronde ini, dia tidak hilang — kita yang tidak melihat, dan menuliskan
                // `status_known: true` di sini adalah persis kebohongan yang membuat 53 pelanggan
                // Dander tervonis Offline saat OLT-nya tak menjawab.
                let statusKnown = true;

                if (logEvent) {
                    if (logEvent.event_type === 'dying-gasp') {
                        finalStatus = 'Dying Gasp';
                        isDyingGasp = true;
                    } else if (logEvent.event_type === 'los') {
                        finalStatus = 'LOS';
                        isLos = true;
                    }
                } else if (!isSnapshotReadableFor(oltResult, cachedOlt)) {
                    // Syslog (logEvent di atas) bukti MANDIRI dan tetap dipercaya; tanpa itu kita
                    // tak punya pengamatan apa pun tentang pelanggan ini.
                    statusKnown = false;
                }

                log.info(`[OLT] User ${user.pppoe_username}: ONT not in OLT, status: ${finalStatus}`
                    + `${statusKnown ? '' : ' (OLT TIDAK TERBACA — bukan vonis)'}`
                    + ` (cached slot/onu: ${cachedInfo?.slot_id}/${cachedInfo?.onu_id})`);

                matchedData.push({
                    user_id: user.id,
                    customer_name: user.name,
                    account_type: user.account_type || 'pelanggan',
                    pppoe_username: user.pppoe_username,
                    mac_mikrotik: macInfo.mac,
                    mac_source: macInfo.source,
                    mac_olt: 'N/A',
                    serial: null,
                    description: null,
                    pon_name: null,
                    olt_brand: null,
                    olt_id: cachedOlt ? cachedOlt.oltId : null,
                    olt_name: cachedOlt ? cachedOlt.oltName : null,
                    olt_host: cachedOlt ? cachedOlt.oltHost : null,
                    rx_power: 'N/A',
                    rx_power_valid: false,
                    status_known: statusKnown,
                    olt_status: statusKnown ? finalStatus : 'Tidak terbaca',
                    is_dying_gasp: isDyingGasp,
                    is_los: isLos,
                    last_down_cause: null,
                    slot_id: cachedInfo?.slot_id || 'N/A',
                    onu_id: cachedInfo?.onu_id || 'N/A',
                    log_event: logEvent ? logEvent.event_type : null,
                    log_timestamp: logEvent ? logEvent.timestamp : null
                });
            }
        }

        // Create oltByMacPrefix for frontend
        const oltByMacPrefix = {};
        oltResult.onus.forEach(onu => {
            const normalizedMac = normalizeMAC(onu.macAddress);
            if (normalizedMac) {
                const prefix = normalizedMac.substring(0, 10);
                oltByMacPrefix[prefix] = {
                    mac_olt: onu.macAddress,
                    rx_power: onu.rxPower,
                    olt_status: onu.status,
                    is_dying_gasp: onu.isDyingGasp,
                    is_los: onu.isLos,
                    last_down_cause: onu.lastDownCause,
                    slot_id: onu.slotId,
                    onu_id: onu.id
                };
            }
        });

        log.info(`[OLT] Matched ${matchedData.length} customers with OLT data`);
        
        // Update cache dengan slot_id dan onu_id dari matched data
        matchedData.forEach(item => {
            if (item.slot_id && item.onu_id && item.slot_id !== 'N/A') {
                const existing = lastCallerIdCache.get(item.pppoe_username);
                if (existing && (!existing.slot_id || !existing.onu_id)) {
                    existing.slot_id = item.slot_id;
                    existing.onu_id = item.onu_id;
                    lastCallerIdCache.set(item.pppoe_username, existing);
                }
            }
        });
        saveLastCallerIdCache();

        res.json({
            status: 200,
            message: 'OK',
            timestamp: oltResult.timestamp,
            // Kesegaran SNAPSHOT YANG DIKIRIM di respons ini (dipetik bersama datanya).
            freshness,
            incompleteWalks: oltResult.incompleteWalks || [],
            // OLT yang tak terbaca ronde ini. Wajib ikut: tanpa ini pembaca tak punya cara tahu
            // bahwa sebagian barisnya bertanda "tidak diketahui" karena alat bacanya yang buta.
            failedOlts: oltResult.failedOlts || [],
            enabled: true,
            data: matchedData,
            oltByMacPrefix: oltByMacPrefix,
            totalOnu: oltResult.onus.length,
            matchedCount: matchedData.length,
            cachedMacCount: lastCallerIdCache.size,
            oltDevices: oltDevices.map(d => ({ id: d.id, name: d.name, host: d.host })),
            oltResults: oltResult.oltResults // Detail per OLT
        });

    } catch (error) {
        log.error('[OLT] Error getting matched data:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * GET /api/olt/onus?oltId=<id>
 * View OLT-centric: SEMUA ONU dari OLT (atau satu OLT bila oltId diberikan),
 * tiap ONU dianotasi pelanggan bila ke-match. TIDAK tergantung DB pelanggan —
 * berguna untuk laptop tes / OLT yang ONU-nya belum dipetakan ke pelanggan.
 * Matching ONU→pelanggan: deskripsi(PPPoE) → serial → MAC-prefix (via last-caller-id).
 */
/**
 * GET /api/olt/infra-status
 * Status modem INFRASTRUKTUR (account_type='infrastruktur', mis. modem CCTV/monitoring).
 * Berangkat dari SEMUA akun infra (tak pernah skip), pakai PPPoE active MikroTik sebagai sinyal
 * utama online/offline, lalu enrichment redaman/LOS dari OLT (best-effort). Robust saat OLT off /
 * MikroTik gagal — tiap modem infra tetap muncul dengan status PPPoE.
 */
router.get('/infra-status', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }

        const infraUsers = (global.users || []).filter(isInfrastructure);
        if (infraUsers.length === 0) {
            return res.json({ status: 200, message: 'Belum ada akun infrastruktur', data: [], count: 0, oltEnabled: false });
        }

        // Sinyal UTAMA: PPPoE active dari MikroTik ("internet hidup/mati"). Best-effort.
        let pppoeActive = [];
        try {
            pppoeActive = await getCachedPppoeData(req.query.force === 'true');
        } catch (mikrotikError) {
            log.warn('[OLT-INFRA] PPPoE active tidak tersedia:', mikrotikError.message);
        }
        const ipByPppoe = new Map();
        for (const session of Array.isArray(pppoeActive) ? pppoeActive : []) {
            if (session && session.name) ipByPppoe.set(String(session.name), session.address || null);
        }

        // Enrichment OLT (redaman/LOS) — opsional & TAK boleh memblok halaman. Cold-cache OLT
        // bisa lama (mis. satu OLT timeout 60s). Pakai timeout race: kalau OLT belum siap dalam
        // INFRA_OLT_ENRICH_TIMEOUT_MS, kembalikan baris berbasis PPPoE dulu; walk OLT tetap jalan di
        // belakang & menghangatkan cache untuk refresh berikutnya. Tiap baris tetap muncul.
        const INFRA_OLT_ENRICH_TIMEOUT_MS = 8000;
        let onuIndex = null;
        let oltEnabled = false;
        try {
            const globalConfig = oltManager.getOltGlobalConfig();
            if (globalConfig && globalConfig.enabled) {
                const oltDevices = oltManager.getOltDevices();
                if (oltDevices.length > 0) {
                    const cached = await Promise.race([
                        getCachedMultipleOltData(oltDevices, req.query.force === 'true'),
                        new Promise((resolve) => {
                            const t = setTimeout(() => resolve(null), INFRA_OLT_ENRICH_TIMEOUT_MS);
                            if (t && typeof t.unref === 'function') t.unref();
                        })
                    ]);
                    const oltResult = cached && cached.data;
                    if (oltResult && oltResult.status === 'success') {
                        onuIndex = buildOnuIndex(oltResult.onus, { normalizeMAC });
                        oltEnabled = true;
                    }
                }
            }
        } catch (oltError) {
            log.warn('[OLT-INFRA] Enrichment OLT tidak tersedia:', oltError.message);
        }

        const data = infraUsers.map((user) => {
            const pppoe = user.pppoe_username ? String(user.pppoe_username) : null;
            const pppoeOnline = pppoe ? ipByPppoe.has(pppoe) : false;
            const ip = pppoeOnline ? ipByPppoe.get(pppoe) : null;

            let onu = null;
            if (onuIndex && pppoe) {
                try {
                    const macInfo = getMacForUser(user.pppoe_username, pppoeActive);
                    const matched = matchOnu(user, { index: onuIndex, macInfo }, { normalizeMAC });
                    onu = matched && matched.onu ? matched.onu : null;
                } catch (__matchErr) {
                    onu = null; // enrichment best-effort
                }
            }

            return buildInfraRow(user, { pppoeOnline, ip, onu });
        });

        return res.json({ status: 200, message: 'OK', data, count: data.length, oltEnabled });
    } catch (error) {
        log.error('[OLT-INFRA] Error:', error.message);
        return res.status(500).json({ status: 500, message: error.message, data: [] });
    }
});


module.exports = router;
