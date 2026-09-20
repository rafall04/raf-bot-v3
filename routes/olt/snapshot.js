/**
 * Header Doc
 * Purpose: Sub-router snapshot OLT — GET /status, /onus, /customer/:userId; POST /refresh-single, /scrape-now.
 * Caller: `routes/olt.js` (composer) — jangan mount langsung.
 * MainFuncs: GET `/status`, GET `/onus`, GET `/customer/:userId`, POST `/refresh-single`, POST `/scrape-now`.
 * SideEffects: sama seperti routes/olt.js asli (split #b395 — murni pemindahan kode).
 */
const log = require('../../lib/logger').logger.child('SNAPSHOT');
const express = require('express');
const router = express.Router();
const { assertBolehAksesPelanggan } = require('../api-route-helpers');
const { getSingleOnuDataWithCache, matchMAC, normalizeMAC } = require('../../lib/olt-hioso');
const oltLogScraper = require('../../lib/olt-log-scraper');
const oltManager = require('../../lib/olt-manager');
const { resolveDriver } = require('../../lib/olt-drivers');
const { isRxPowerValid } = require('../../lib/olt-optical-resolver');
const { getCachedOltData, getCachedOltDataByKey, getCachedPppoeData, lastCallerIdCache, loadConfig, resolveOnuDisplayStatus } = require('./shared');

/**
 * GET /api/olt/status
 * Get all ONT status from OLT
 */
router.get('/status', async (req, res) => {
    try {
        // Check if user is authenticated (admin or teknisi)
        if (!req.user) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }

        const config = loadConfig();
        const oltConfig = config.olt;

        if (!oltConfig || !oltConfig.enabled) {
            return res.json({ 
                status: 200, 
                message: 'OLT tidak diaktifkan',
                data: [],
                enabled: false
            });
        }

        if (!oltConfig.host) {
            return res.json({ 
                status: 200, 
                message: 'Host OLT belum dikonfigurasi',
                data: [],
                enabled: false
            });
        }

        log.info(`[OLT] Fetching ONT status from ${oltConfig.host}`);
        
        // Lewat driver merek — HIOSO dibaca via web (SNMP HIOSO dilarang, bikin OLT hang).
        const result = await resolveDriver({ host: oltConfig.host, brand: oltConfig.brand }).getOltData(oltConfig);

        if (result.status === 'success') {
            res.json({
                status: 200,
                message: 'OK',
                timestamp: result.timestamp,
                enabled: true,
                data: result.onus
            });
        } else {
            res.json({
                status: 200,
                message: result.message || 'Gagal mengambil data OLT',
                data: [],
                enabled: true,
                error: true
            });
        }
    } catch (error) {
        log.error('[OLT] Error getting status:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


router.get('/onus', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }

        const globalConfig = oltManager.getOltGlobalConfig();
        if (!globalConfig.enabled) {
            return res.json({ status: 200, message: 'OLT tidak diaktifkan', data: [], enabled: false });
        }

        let oltDevices = oltManager.getOltDevices();
        const deviceList = oltDevices.map(d => ({ id: d.id, name: d.name, host: d.host, brand: d.brand || 'auto' }));

        // Mode ringan: hanya kembalikan daftar OLT untuk isi dropdown (tanpa query ONU).
        // Dipakai dashboard agar "pilih OLT dulu, baru ambil data".
        if (req.query.devicesOnly === 'true') {
            return res.json({ status: 200, message: 'OK', enabled: true, data: [], oltDevices: deviceList });
        }

        if (oltDevices.length === 0) {
            return res.json({ status: 200, message: 'Tidak ada OLT yang dikonfigurasi', data: [], enabled: true, error: true });
        }

        // Pilih OLT tertentu → query OLT itu saja (cache per-OLT). 'all'/kosong → semua.
        const wantOltId = req.query.oltId && req.query.oltId !== 'all' ? String(req.query.oltId) : null;
        let targetDevices = oltDevices;
        let cacheKey = 'all';
        if (wantOltId) {
            const dev = oltDevices.find(d => d.id === wantOltId);
            if (!dev) {
                return res.json({ status: 200, message: 'OLT tidak ditemukan', data: [], enabled: true, oltDevices: deviceList });
            }
            targetDevices = [dev];
            cacheKey = wantOltId;
        }

        const forceRefresh = req.query.force === 'true';
        const { data: oltResult, freshness } = await getCachedOltDataByKey(cacheKey, targetDevices, forceRefresh);
        if (oltResult.status !== 'success') {
            return res.json({ status: 200, message: oltResult.message || 'Gagal mengambil data OLT', data: [], enabled: true, error: true });
        }

        // Segarkan cache MAC→PPPoE (last-caller-id) dari sesi PPPoE MikroTik SEBELUM matching.
        // ONU EPON (Hioso) tak membawa description/serial, jadi SATU-SATUNYA jalur match ke
        // pelanggan adalah MAC-prefix via lastCallerIdCache. Endpoint ini hanya MEMBACA cache
        // itu; kalau belum pernah dihangatkan (file last-caller-id-cache.json tak ada saat
        // startup DAN /matched belum pernah dibuka), cache kosong → matchedCount 0 → "nama
        // pelanggan tak terdeteksi" di Monitor OLT. Panggilan ini ber-cache 15 dtk & non-fatal
        // (getCachedPppoeData mengembalikan [] bila MikroTik down) — juga mem-persist file cache.
        let sesiPppoe = [];
        try {
            sesiPppoe = (await getCachedPppoeData()) || [];
        } catch (pppoeErr) {
            log.warn('[OLT-onus] Gagal segarkan PPPoE caller-id cache:', pppoeErr.message);
        }

        // Index pelanggan untuk anotasi (ONU → pelanggan).
        const users = global.users || [];
        const usersByPppoe = new Map();
        const usersBySerial = new Map();
        for (const u of users) {
            if (!u) continue;
            if (u.pppoe_username) usersByPppoe.set(String(u.pppoe_username).trim().toLowerCase(), u);
            if (u.olt_serial) usersBySerial.set(String(u.olt_serial).trim().toLowerCase(), u);
        }
        // MAC-prefix → pppoe (dari last-caller-id) untuk anotasi ONU EPON.
        const pppoeByMacPrefix = {};
        lastCallerIdCache.forEach((info, pppoe) => {
            if (info && info.mac) {
                const p = normalizeMAC(info.mac).substring(0, 10);
                if (p.length >= 10) pppoeByMacPrefix[p] = pppoe;
            }
        });

        // Sesi PPPoE MikroTik per prefix MAC — SUMBER IDENTITAS KEDUA.
        //
        // !! Sebelum #b284 nama PPPoE ini sudah berhasil di-resolve tapi DIBUANG kalau
        // pelanggannya tak terdaftar di bot, sehingga barisnya tampil tanpa nama sama sekali
        // (ONU EPON tak membawa description/serial). Terukur di produksi: 5 baris di Dander
        // + 1 di Tanjungharjo, tiga di antaranya redaman buruk (-26,2 · -28,54 · -26,58) —
        // justru pelanggan yang paling perlu diservis. Datanya ada, cuma tidak dioper.
        const sesiByMacPrefix = new Map();
        for (const sesi of sesiPppoe) {
            if (!sesi || !sesi.name || !sesi.caller_id) continue;
            const p = normalizeMAC(sesi.caller_id).substring(0, 10);
            if (p.length >= 10) sesiByMacPrefix.set(p, sesi);
        }
        const cariSesiMikrotik = (onu) => {
            const macNorm = normalizeMAC(onu.macAddress);
            if (!macNorm || macNorm.length < 10) return null;
            return sesiByMacPrefix.get(macNorm.substring(0, 10)) || null;
        };

        const findCustomer = (onu) => {
            if (onu.description) {
                const u = usersByPppoe.get(String(onu.description).trim().toLowerCase());
                if (u) return u;
            }
            if (onu.serial) {
                const u = usersBySerial.get(String(onu.serial).trim().toLowerCase());
                if (u) return u;
            }
            const macNorm = normalizeMAC(onu.macAddress);
            if (macNorm && macNorm.length >= 10) {
                const pppoe = pppoeByMacPrefix[macNorm.substring(0, 10)];
                if (pppoe) {
                    const u = usersByPppoe.get(String(pppoe).trim().toLowerCase());
                    if (u) return u;
                }
            }
            return null;
        };

        // === Klasifikasi LOS/DG dari LOG (SNMP Hioso tak bisa bedakan; lihat olt-log-scraper) ===
        // Ambil peta status per-OLT web-scrape (cached 60s, fetch paralel antar-OLT berbeda).
        // Non-fatal: kalau gagal, ONU offline tampil "Offline" (bukan LOS palsu dari SNMP).
        const statusByOlt = new Map();
        const webScrapeOltIds = new Set();
        await Promise.all(targetDevices.map(async (dev) => {
            let needsLog = true;
            try {
                const drv = resolveDriver(dev);
                needsLog = !drv || !drv.capabilities || drv.capabilities.needsWebScrape !== false;
            } catch (_e) { needsLog = true; }
            if (!needsLog) return; // ZTE GPON dll: LOS via SNMP, tak perlu log
            webScrapeOltIds.add(dev.id);
            try {
                statusByOlt.set(dev.id, await oltLogScraper.getOnuStatusMap(dev, { maxPages: 12 }));
            } catch (e) {
                log.warn(`[OLT-onus] klasifikasi log gagal utk ${dev.name}: ${e.message}`);
            }
        }));

        const rows = [];
        for (const onu of oltResult.onus) {
            // (oltResult sudah hanya berisi OLT terpilih bila wantOltId; cek ini jaring pengaman.)
            if (wantOltId && onu.olt_id !== wantOltId) continue;
            const u = findCustomer(onu);
            // Tak terdaftar di bot? Identitasnya mungkin masih ada di MikroTik. Jangan dibuang.
            const sesi = u ? null : cariSesiMikrotik(onu);
            const disp = resolveOnuDisplayStatus(onu, statusByOlt.get(onu.olt_id), webScrapeOltIds.has(onu.olt_id));
            rows.push({
                olt_id: onu.olt_id || null,
                olt_name: onu.olt_name || null,
                olt_host: onu.olt_host || null,
                olt_brand: onu.olt_brand || null,
                pon_name: onu.ponName || null,
                slot_id: onu.slotId,
                onu_id: onu.id,
                description: onu.description || null,
                serial: onu.serial || null,
                mac_olt: onu.macAddress,
                rx_power: onu.rxPower,
                // Redaman ONU yang tidak Online = pembacaan TERAKHIR yang masih tersimpan di OLT,
                // bukan kondisi kini. Lihat isRxPowerValid().
                rx_power_valid: isRxPowerValid(onu, disp.olt_status),
                status_known: onu.statusKnown !== false,
                tx_power: onu.txPower || 'N/A',       // ONU Tx upstream (GPON ZTE; HIOSO N/A)
                attenuation: onu.attenuation || 'N/A', // atenuasi downstream ≈ (GPON ZTE)
                olt_status: disp.olt_status,
                is_los: disp.is_los,
                is_dying_gasp: disp.is_dying_gasp,
                down_since: disp.down_since,          // waktu REAL (terkoreksi jam OLT) ONU mulai down
                status_source: disp.status_source,    // 'log' | 'snmp' | 'log-unclassified'
                last_down_cause: onu.lastDownCause || null, // penyebab granular ZTE (HIOSO pakai is_los/is_dying_gasp)
                // Anotasi pelanggan (null bila tak ke-match).
                matched: !!u,
                user_id: u ? u.id : null,
                customer_name: u ? u.name : null,
                account_type: u ? (u.account_type || 'pelanggan') : null,
                // PPPoE kini terisi dari MikroTik juga — bukan cuma dari pelanggan bot (#b284).
                pppoe_username: u ? u.pppoe_username : (sesi ? sesi.name : (onu.description || null)),
                // Dari MANA identitas baris ini berasal. Dipakai penyaring di halaman supaya
                // teknisi bisa memilih 'yang belum terdaftar' tanpa menebak dari baris kosong.
                //   'bot'      = pelanggan terdaftar
                //   'mikrotik' = ada sesi PPPoE aktif tapi TIDAK terdaftar di bot
                //   null       = tak ada identitas dari sumber mana pun
                identitas_sumber: u ? 'bot' : (sesi ? 'mikrotik' : null),
                // Konteks tambahan khusus baris 'mikrotik' — modal detail memakainya supaya
                // teknisi punya bahan kerja walau pelanggannya tak pernah didaftarkan admin.
                mikrotik_ip: sesi ? (sesi.address || null) : null,
                mikrotik_uptime: sesi ? (sesi.uptime || null) : null,
                mikrotik_service: sesi ? (sesi.service || null) : null,
                mikrotik_interface: sesi ? (sesi.interface_name || null) : null,
                customer_address: u ? (u.address || u.alamat || null) : null,
                customer_phone: u ? (u.phone_number || null) : null,
                customer_package: u ? (u.paket || u.package || null) : null,
            });
        }

        // Diagnostik: berapa baris yang DIKIRIM ke browser dengan redaman terisi.
        const rxFilled = rows.filter(r => r.rx_power && r.rx_power !== 'N/A').length;
        log.info(`[OLT-onus] oltId=${wantOltId || 'all'} → kirim ${rows.length} baris ke browser, rx terisi=${rxFilled}`);

        // Jangan biarkan browser meng-cache JSON ini (selalu data segar).
        res.set('Cache-Control', 'no-store');
        res.json({
            status: 200,
            message: 'OK',
            timestamp: oltResult.timestamp,
            // Kesegaran SNAPSHOT YANG DIKIRIM di respons ini (dipetik bersama datanya).
            freshness,
            incompleteWalks: oltResult.incompleteWalks || [],
            enabled: true,
            data: rows,
            totalOnu: rows.length,
            matchedCount: rows.filter(r => r.matched).length,
            // Rincian asal identitas — halaman memakainya untuk label penyaring, supaya
            // hitungan di layar dan di server tak bisa berbeda pendapat.
            identitas: {
                bot: rows.filter(r => r.identitas_sumber === 'bot').length,
                mikrotik: rows.filter(r => r.identitas_sumber === 'mikrotik').length,
                tanpa: rows.filter(r => !r.identitas_sumber).length,
            },
            oltDevices: deviceList,
            oltResults: oltResult.oltResults
        });
    } catch (error) {
        log.error('[OLT] Error getting all ONUs:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * GET /api/olt/customer/:userId
 * Get ONT status for specific customer - MENGGUNAKAN CACHE untuk performa
 */
router.get('/customer/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // GERBANG KEPEMILIKAN. Handler ini sengaja menerima `req.customer` (niatnya agar panel
        // pelanggan bisa cek redaman sendiri) tapi tak pernah membandingkan `userId` dengan
        // `req.customer.id`. Responsnya memuat `customer_name`, `pppoe_username`,
        // `mac_mikrotik`, `mac_olt`, `rx_power`, `slot_id`, `onu_id` — jadi pelanggan id 12
        // bisa memanggil /api/olt/customer/97 dan memetakan seluruh jaringan tetangganya.
        // Melanggar aturan "tampilan ke pelanggan tak boleh memuat PPPoE/identitas perangkat".
        const izin = assertBolehAksesPelanggan(req, userId);
        if (!izin.ok) {
            return res.status(izin.status).json({ status: izin.status, message: izin.message });
        }
        const forceRefresh = req.query.force === 'true';
        const config = loadConfig();
        const oltConfig = config.olt;

        if (!oltConfig || !oltConfig.enabled) {
            return res.json({ status: 200, message: 'OLT tidak diaktifkan', data: null, enabled: false });
        }

        const user = global.users.find(u => String(u.id) === String(userId));
        if (!user) {
            return res.status(404).json({ status: 404, message: 'Pelanggan tidak ditemukan' });
        }

        // Gunakan CACHE - jauh lebih cepat!
        const oltResult = await getCachedOltData(oltConfig, forceRefresh);

        if (oltResult.status !== 'success') {
            return res.json({ status: 200, message: oltResult.message, data: null, enabled: true, error: true });
        }

        // Gunakan cache PPPoE juga
        const pppoeActive = await getCachedPppoeData(forceRefresh);
        let userMac = null;
        if (pppoeActive && Array.isArray(pppoeActive)) {
            const session = pppoeActive.find(s => s.name === user.pppoe_username);
            if (session) userMac = session.caller_id;
        }

        let matchedOnu = null;
        if (userMac) {
            matchedOnu = oltResult.onus.find(onu => matchMAC(userMac, onu.macAddress));
        }

        if (matchedOnu) {
            res.json({
                status: 200, message: 'OK', enabled: true,
                data: {
                    user_id: user.id,
                    customer_name: user.name,
                    pppoe_username: user.pppoe_username,
                    mac_mikrotik: userMac,
                    mac_olt: matchedOnu.macAddress,
                    rx_power: matchedOnu.rxPower,
                    olt_status: matchedOnu.status,
                    is_dying_gasp: matchedOnu.isDyingGasp,
                    is_los: matchedOnu.isLos,
                    slot_id: matchedOnu.slotId,
                    onu_id: matchedOnu.id
                }
            });
        } else {
            res.json({ status: 200, message: 'Data ONT tidak ditemukan', enabled: true, data: null });
        }
    } catch (error) {
        log.error('[OLT] Error getting customer ONT:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * POST /api/olt/refresh-single
 * Refresh redaman untuk single ONT - query realtime dengan cache strategy
 * Cek cache dulu untuk tahu ONT ada di OLT mana, baru query specific OLT
 * Fallback ke query all OLT jika cache miss
 */
router.post('/refresh-single', async (req, res) => {
    try {
        // STAF saja. Dulu meloloskan `req.customer`, padahal parameternya slot/ONU — bukan
        // userId — sehingga pelanggan bisa menyisir seluruh ONU di OLT tanpa terikat miliknya
        // sendiri. Satu-satunya konsumen memang halaman staf (admin-olt.js, teknisi-olt.js).
        if (!req.user || !['admin', 'owner', 'superadmin', 'teknisi'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Akses ditolak.' });
        }

        const { slotId, onuId, mac } = req.body;

        if (!slotId || !onuId) {
            return res.status(400).json({ 
                status: 400, 
                message: 'Parameter slotId dan onuId diperlukan' 
            });
        }

        const globalConfig = oltManager.getOltGlobalConfig();

        if (!globalConfig.enabled) {
            return res.json({ 
                status: 200, 
                message: 'OLT tidak diaktifkan', 
                data: null, 
                enabled: false 
            });
        }

        const oltDevices = oltManager.getOltDevices();
        if (oltDevices.length === 0) {
            return res.json({ 
                status: 200, 
                message: 'Tidak ada OLT yang dikonfigurasi', 
                data: null, 
                enabled: false 
            });
        }

        log.info(`[OLT] Refresh single ONT: slot=${slotId}, onu=${onuId}, mac=${mac || 'N/A'}`);
        
        // Query dengan cache strategy jika MAC tersedia
        let result;
        if (mac) {
            result = await getSingleOnuDataWithCache(mac, slotId, onuId);
        } else {
            // Fallback: query all OLT jika MAC tidak tersedia
            log.info(`[OLT] No MAC provided, querying all OLTs...`);
            const promises = oltDevices.map(async (olt) => {
                const config = {
                    host: olt.host,
                    port: olt.snmpPort || 161,
                    community: olt.snmpCommunity || 'public',
                    timeout: olt.snmpTimeout || 10000,
                    retries: olt.snmpRetries || 1
                };
                
                try {
                    const r = await resolveDriver(olt).getSingleOnuData(config, slotId, onuId);
                    if (r.status === 'success' && r.data && r.data.rxPower !== 'N/A') {
                        return r;
                    }
                    return null;
                } catch (_error) {
                    return null;
                }
            });
            
            const results = await Promise.all(promises);
            result = results.find(r => r !== null) || {
                status: 'error',
                message: 'Data ONT tidak ditemukan di semua OLT',
                data: null
            };
        }

        if (result.status === 'success' && result.data) {
            // Klasifikasi HYBRID: SNMP Hioso tak bisa bedakan LOS vs DG → kalau ONU offline
            // dan MAC ada di log OLT web-scrape, ambil verdict + waktu down dari LOG (terkoreksi
            // jam OLT). Konsisten dengan halaman list /onus. Non-fatal.
            let dispStatus = result.data.status;
            let dispDg = result.data.isDyingGasp;
            let dispLos = result.data.isLos;
            let dispDownAt = result.data.lastDownAt;
            if (mac && dispStatus !== 'Online') {
                const normMac = normalizeMAC(mac);
                for (const dev of oltDevices) {
                    let needsLog = true;
                    try {
                        const drv = resolveDriver(dev);
                        needsLog = !drv || !drv.capabilities || drv.capabilities.needsWebScrape !== false;
                    } catch (_e) { needsLog = true; }
                    if (!needsLog) continue; // ZTE GPON: LOS via SNMP
                    try {
                        const entry = await oltLogScraper.getOnuStatusMap(dev, { maxPages: 12 });
                        const s = entry.map.get(normMac);
                        if (s) {
                            dispDg = s.event_type === 'dying-gasp';
                            dispLos = !dispDg;
                            dispStatus = dispDg ? 'Dying Gasp' : 'LOS';
                            if (Number.isFinite(s.realTs)) dispDownAt = new Date(s.realTs).toISOString();
                            break;
                        }
                    } catch (_e) { /* non-fatal: pertahankan status SNMP */ }
                }
            }
            // Selalu return data meskipun N/A (ONT offline)
            res.json({
                status: 200,
                message: 'OK',
                timestamp: result.timestamp,
                enabled: true,
                data: {
                    rx_power: result.data.rxPower,
                    olt_status: dispStatus,
                    is_dying_gasp: dispDg,
                    is_los: dispLos,
                    last_down_cause: result.data.lastDownCause,
                    last_up_at: result.data.lastUpAt,
                    last_down_at: dispDownAt,
                    down_since: dispDownAt // alias konsisten dgn /onus (renderCause pakai down_since)
                }
            });
        } else {
            // Error dari SNMP
            res.json({
                status: 200,
                message: result.message || 'Gagal mengambil data ONT',
                data: null,
                enabled: true,
                error: true
            });
        }

    } catch (error) {
        log.error('[OLT] Error refresh single ONT:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


/**
 * POST /api/olt/scrape-now
 * Trigger manual scrape untuk debugging
 */
router.post('/scrape-now', async (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        log.info('[OLT] Manual scrape triggered');
        
        // Set debug mode
        process.env.DEBUG_OLT_SCRAPER = 'true';
        
        // Trigger scrape
        await oltLogScraper.scrapeOltLog();
        
        // Get events
        const events = oltLogScraper.getAllEvents();
        const status = oltLogScraper.getScraperStatus();
        
        // Reset debug mode
        delete process.env.DEBUG_OLT_SCRAPER;
        
        res.json({
            status: 200,
            message: 'Scrape completed',
            data: {
                events: events,
                scraperStatus: status
            }
        });
    } catch (error) {
        log.error('[OLT] Error manual scrape:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});


module.exports = router;
