/**
 * OLT Routes
 * API endpoints untuk monitoring OLT HIOSO
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Import OLT library
const { getOltData, getSingleOnuData: _getSingleOnuData, getMultipleOltData, getSingleOnuDataWithCache, matchOltWithCustomers: _matchOltWithCustomers, matchMAC, normalizeMAC } = require('../lib/olt-hioso');
const { getActivePPPoEUsers } = require('../lib/mikrotik');

// Import OLT Log Scraper
const oltLogScraper = require('../lib/olt-log-scraper');

// Import OLT Manager
const oltManager = require('../lib/olt-manager');

// Import driver registry (multi-merk OLT). Dispatch per device.brand.
const { resolveDriver, getDriver, listDrivers, detectBrand } = require('../lib/olt-drivers');
// Inti matching pelanggan→ONU optik (1 sumber kebenaran, dipakai bersama bot Telegram teknisi).
const { buildOnuIndex, matchOnu } = require('../lib/olt-optical-resolver');
// Pemisahan akun infrastruktur (CCTV/monitoring) + penyusun baris status infra (PPPoE + OLT).
const { isInfrastructure } = require('../lib/account-classification');
const { buildInfraRow } = require('../lib/infra-status');

// ============================================
// CACHE SYSTEM untuk performa lebih baik
// ============================================
const oltCache = {
    data: null,           // Data OLT terakhir
    timestamp: 0,         // Waktu cache dibuat
    ttl: 30000,           // Cache valid 30 detik
    loading: false        // Flag untuk mencegah multiple request
};

const pppoeCache = {
    data: null,
    timestamp: 0,
    ttl: 15000,           // Cache valid 15 detik
    loading: false
};

// Cache hasil query OLT, PER-KEY. Penting untuk GPON ZTE yang walk-nya lama
// (~30 dtk untuk 608 ONU). Key: 'all' (semua OLT) atau oltId tertentu — supaya
// "pilih 1 OLT" hanya query OLT itu (tak ikut walk OLT lain yang lambat).
const OLT_CACHE_TTL = 30000;
const oltDataCacheMap = new Map(); // key -> { data, timestamp, loading, refreshPromise }

/**
 * Refresh satu entry cache (query OLT). Dedup: jika sudah ada refresh berjalan,
 * pakai promise yang sama (tidak walk dobel).
 */
function refreshOltEntry(entry, devices) {
    if (entry.loading && entry.refreshPromise) return entry.refreshPromise;
    entry.loading = true;
    entry.refreshPromise = (async () => {
        try {
            const result = await getMultipleOltData(devices);
            if (result.status === 'success') {
                entry.data = result;
                entry.timestamp = Date.now();
            }
            return result;
        } finally {
            entry.loading = false;
            entry.refreshPromise = null;
        }
    })();
    return entry.refreshPromise;
}

/**
 * getMultipleOltData dengan cache per-key + STALE-WHILE-REVALIDATE.
 * Walk ZTE ~24 dtk; agar dashboard tak nunggu tiap kali: setelah data pertama ada,
 * sajikan data lama SEKETIKA dan refresh di background. Hanya load pertama (belum
 * ada data) atau forceRefresh (tombol Refresh) yang menunggu walk.
 * @param {string} key 'all' atau oltId
 * @param {Array} devices device(s)
 * @param {boolean} forceRefresh tunggu data segar (abaikan cache)
 */
async function getCachedOltDataByKey(key, devices, forceRefresh = false) {
    const now = Date.now();
    let entry = oltDataCacheMap.get(key);
    if (!entry) { entry = { data: null, timestamp: 0, loading: false, refreshPromise: null }; oltDataCacheMap.set(key, entry); }

    if (forceRefresh) {
        return refreshOltEntry(entry, devices); // tunggu segar
    }
    const fresh = entry.data && (now - entry.timestamp) < OLT_CACHE_TTL;
    if (fresh) return entry.data;
    if (entry.data) {
        // Basi tapi ada → sajikan seketika + refresh di background (tak ditunggu).
        if (!entry.loading) refreshOltEntry(entry, devices).catch(() => {});
        return entry.data;
    }
    return refreshOltEntry(entry, devices); // load pertama → tunggu
}

// Kompat: /matched tetap pakai key 'all' (semua OLT).
async function getCachedMultipleOltData(oltDevices, forceRefresh = false) {
    return getCachedOltDataByKey('all', oltDevices, forceRefresh);
}

// ============================================
// LAST CALLER ID CACHE - Menyimpan MAC terakhir per PPPoE username
// Ini memungkinkan matching meskipun pelanggan offline
// ============================================
const lastCallerIdCache = new Map(); // Map<pppoe_username, {mac, timestamp}>
const LAST_CALLER_ID_FILE = path.join(__dirname, '..', 'database', 'last-caller-id-cache.json');

// Load last caller ID cache dari file saat startup
function loadLastCallerIdCache() {
    try {
        if (fs.existsSync(LAST_CALLER_ID_FILE)) {
            const data = JSON.parse(fs.readFileSync(LAST_CALLER_ID_FILE, 'utf8'));
            Object.entries(data).forEach(([username, info]) => {
                lastCallerIdCache.set(username, info);
            });
            console.log(`[OLT] Loaded ${lastCallerIdCache.size} last caller IDs from cache`);
        }
    } catch (e) {
        console.error('[OLT] Error loading last caller ID cache:', e.message);
    }
}

// Save last caller ID cache ke file
function saveLastCallerIdCache() {
    try {
        const data = {};
        lastCallerIdCache.forEach((info, username) => {
            data[username] = info;
        });
        fs.writeFileSync(LAST_CALLER_ID_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[OLT] Error saving last caller ID cache:', e.message);
    }
}

// Update last caller ID dari PPPoE active data dan OLT data
function updateLastCallerIdCache(pppoeActiveData, oltMatchedData = null) {
    if (!Array.isArray(pppoeActiveData)) return;
    
    let updated = 0;
    pppoeActiveData.forEach(session => {
        if (session.name && session.caller_id) {
            const existing = lastCallerIdCache.get(session.name);
            // Update jika belum ada atau MAC berbeda
            if (!existing || existing.mac !== session.caller_id) {
                const cacheEntry = {
                    mac: session.caller_id,
                    timestamp: Date.now()
                };
                
                // Jika ada OLT matched data, simpan juga slot_id dan onu_id
                if (oltMatchedData) {
                    const oltMatch = oltMatchedData.find(m => m.pppoe_username === session.name);
                    if (oltMatch && oltMatch.slot_id && oltMatch.onu_id) {
                        cacheEntry.slot_id = oltMatch.slot_id;
                        cacheEntry.onu_id = oltMatch.onu_id;
                    }
                }
                
                lastCallerIdCache.set(session.name, cacheEntry);
                updated++;
            }
        }
    });
    
    if (updated > 0) {
        console.log(`[OLT] Updated ${updated} last caller IDs`);
        saveLastCallerIdCache(); // Persist ke file
    }
}

// Get MAC untuk user (dari active session atau last known)
function getMacForUser(pppoeUsername, pppoeActiveData) {
    // Coba dari active session dulu
    if (Array.isArray(pppoeActiveData)) {
        const activeSession = pppoeActiveData.find(s => s.name === pppoeUsername);
        if (activeSession && activeSession.caller_id) {
            return { mac: activeSession.caller_id, source: 'active' };
        }
    }
    
    // Fallback ke last known MAC
    const lastKnown = lastCallerIdCache.get(pppoeUsername);
    if (lastKnown && lastKnown.mac) {
        return { mac: lastKnown.mac, source: 'cached' };
    }
    
    return null;
}

// Load cache saat module di-load
loadLastCallerIdCache();

/**
 * Get cached OLT data atau fetch baru jika expired
 */
async function getCachedOltData(oltConfig, forceRefresh = false) {
    const now = Date.now();
    
    // Return cache jika masih valid dan tidak force refresh
    if (!forceRefresh && oltCache.data && (now - oltCache.timestamp) < oltCache.ttl) {
        return oltCache.data;
    }
    
    // Jika sedang loading, tunggu atau return cache lama
    if (oltCache.loading) {
        if (oltCache.data) return oltCache.data;
        // Tunggu loading selesai (max 5 detik)
        await new Promise(resolve => setTimeout(resolve, 100));
        return oltCache.data;
    }
    
    oltCache.loading = true;
    try {
        const result = await getOltData(oltConfig);
        if (result.status === 'success') {
            oltCache.data = result;
            oltCache.timestamp = now;
        }
        return result;
    } finally {
        oltCache.loading = false;
    }
}

/**
 * Get cached PPPoE data atau fetch baru jika expired
 * Juga update last caller ID cache
 */
async function getCachedPppoeData(forceRefresh = false) {
    const now = Date.now();
    
    if (!forceRefresh && pppoeCache.data && (now - pppoeCache.timestamp) < pppoeCache.ttl) {
        return pppoeCache.data;
    }
    
    if (pppoeCache.loading) {
        if (pppoeCache.data) return pppoeCache.data;
        await new Promise(resolve => setTimeout(resolve, 100));
        return pppoeCache.data;
    }
    
    pppoeCache.loading = true;
    try {
        const result = await getPPPoEActiveUsers();
        pppoeCache.data = result;
        pppoeCache.timestamp = now;
        
        // Update last caller ID cache dari active sessions
        updateLastCallerIdCache(result);
        
        return result;
    } finally {
        pppoeCache.loading = false;
    }
}

/**
 * Get PPPoE active users from MikroTik via gateway final
 * @returns {Promise<Array>} Array of {name, address, caller_id}
 */
async function getPPPoEActiveUsers() {
    const result = await getActivePPPoEUsers({ caller: 'olt.ppp-active-users' });
    if (!result.ok) {
        console.warn('[OLT] PPP active users unavailable:', result.message);
        return [];
    }

    return Array.isArray(result.data) ? result.data : [];
}

// Helper to load config
function loadConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        console.error('[OLT] Error loading config:', error.message);
        return {};
    }
}

// Helper to save config
function saveConfig(config) {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
        // Update global config
        global.config = config;
        return true;
    } catch (error) {
        console.error('[OLT] Error saving config:', error.message);
        return false;
    }
}

/**
 * GET /api/olt/config
 * Get OLT configuration
 */
router.get('/config', (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const config = loadConfig();
        const oltConfig = config.olt || {
            enabled: false,
            host: '',
            port: 161,
            community: 'public',
            timeout: 15000,
            retries: 2,
            webEnabled: false,
            webUsername: '',
            webPassword: ''
        };

        res.json({
            status: 200,
            data: oltConfig
        });
    } catch (error) {
        console.error('[OLT] Error getting config:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * POST /api/olt/config
 * Save OLT global configuration (interval, timeWindow, etc)
 */
router.post('/config', (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { enabled, webEnabled, timeWindow, scrapeInterval, maxLogPages } = req.body;

        const config = loadConfig();
        
        // Preserve devices array if exists
        const existingDevices = config.olt?.devices || [];
        
        config.olt = {
            enabled: enabled === true || enabled === 'true',
            webEnabled: webEnabled === true || webEnabled === 'true',
            timeWindow: parseInt(timeWindow) || 10,
            scrapeInterval: parseInt(scrapeInterval) || 1,
            maxLogPages: parseInt(maxLogPages) || 3,
            devices: existingDevices
        };

        if (saveConfig(config)) {
            // Restart log scraper jika config berubah
            const { restartLogScraper } = require('../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            // Restart juga poller SNMP-LOS (mis. ZTE) supaya device baru langsung dipantau.
            try {
                const { restartSnmpLosPoller } = require('../lib/olt-snmp-los-poller');
                if (typeof restartSnmpLosPoller === 'function') restartSnmpLosPoller();
            } catch (__e) { /* ignore */ }
            
            res.json({
                status: 200,
                message: 'Konfigurasi OLT berhasil disimpan',
                data: config.olt
            });
        } else {
            res.status(500).json({ status: 500, message: 'Gagal menyimpan konfigurasi' });
        }
    } catch (error) {
        console.error('[OLT] Error saving config:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * GET /api/olt/test
 * Test OLT connection
 */
router.get('/test', async (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const config = loadConfig();
        const oltConfig = config.olt;

        if (!oltConfig || !oltConfig.enabled) {
            return res.status(400).json({ 
                status: 400, 
                message: 'OLT tidak diaktifkan. Aktifkan terlebih dahulu di konfigurasi.' 
            });
        }

        if (!oltConfig.host) {
            return res.status(400).json({ 
                status: 400, 
                message: 'Host OLT belum dikonfigurasi' 
            });
        }

        console.log(`[OLT] Testing connection to ${oltConfig.host}:${oltConfig.port}`);
        
        const result = await getOltData(oltConfig);

        if (result.status === 'success') {
            res.json({
                status: 200,
                message: `Koneksi berhasil! Ditemukan ${result.onus.length} ONT`,
                data: {
                    timestamp: result.timestamp,
                    onuCount: result.onus.length
                }
            });
        } else {
            res.status(500).json({
                status: 500,
                message: result.message || 'Gagal koneksi ke OLT'
            });
        }
    } catch (error) {
        console.error('[OLT] Error testing connection:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * POST /api/olt/test-web
 * Test OLT Web connection for log scraping
 */
router.post('/test-web', async (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { host, username, password } = req.body;

        if (!host || !username || !password) {
            return res.status(400).json({ 
                status: 400, 
                message: 'Host, username, dan password diperlukan' 
            });
        }

        console.log(`[OLT] Testing web connection to ${host}`);
        
        const result = await oltLogScraper.testWebConnection(host, username, password);

        if (result.success) {
            res.json({
                status: 200,
                message: result.message
            });
        } else {
            res.status(400).json({
                status: 400,
                message: result.message
            });
        }
    } catch (error) {
        console.error('[OLT] Error testing web connection:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * GET /api/olt/scraper-status
 * Get OLT log scraper status
 */
router.get('/scraper-status', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const status = oltLogScraper.getScraperStatus();
        res.json({
            status: 200,
            data: status
        });
    } catch (error) {
        console.error('[OLT] Error getting scraper status:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * GET /api/olt/events
 * Get all OLT events (LOS/Dying Gasp)
 */
router.get('/events', (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }

        const events = oltLogScraper.getAllEvents();
        res.json({
            status: 200,
            data: events
        });
    } catch (error) {
        console.error('[OLT] Error getting events:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

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

        console.log(`[OLT] Fetching ONT status from ${oltConfig.host}`);
        
        const result = await getOltData(oltConfig);

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
        console.error('[OLT] Error getting status:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

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
        console.log(`[OLT] Fetching matched ONT data from ${oltDevices.length} OLT(s)`);
        const forceRefresh = req.query.force === 'true';
        const oltResult = await getCachedMultipleOltData(oltDevices, forceRefresh);

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
                console.log(`[OLT] Got ${pppoeActive.length} PPPoE active users`);
            }
        } catch (mikrotikError) {
            console.error('[OLT] Error getting MikroTik data:', mikrotikError.message);
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
                console.log(`[OLT DEBUG] User: ${user.pppoe_username}, MAC: ${macInfo.mac}, Source: ${macInfo.source}, Found in OLT: ${!!matchedOnu}`);
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
                
                let finalStatus = 'Offline';
                let isDyingGasp = false;
                let isLos = false;
                
                if (logEvent) {
                    if (logEvent.event_type === 'dying-gasp') {
                        finalStatus = 'Dying Gasp';
                        isDyingGasp = true;
                    } else if (logEvent.event_type === 'los') {
                        finalStatus = 'LOS';
                        isLos = true;
                    }
                }
                
                console.log(`[OLT] User ${user.pppoe_username}: ONT not in OLT, status: ${finalStatus} (cached slot/onu: ${cachedInfo?.slot_id}/${cachedInfo?.onu_id})`);

                // ONT tidak ada di OLT saat ini; coba kenali OLT-nya dari cache MAC.
                const cachedOlt = oltManager.getOltFromMac(macInfo.mac);

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
                    olt_status: finalStatus,
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

        console.log(`[OLT] Matched ${matchedData.length} customers with OLT data`);
        
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
        console.error('[OLT] Error getting matched data:', error);
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
            console.warn('[OLT-INFRA] PPPoE active tidak tersedia:', mikrotikError.message);
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
                    const oltResult = await Promise.race([
                        getCachedMultipleOltData(oltDevices, req.query.force === 'true'),
                        new Promise((resolve) => {
                            const t = setTimeout(() => resolve(null), INFRA_OLT_ENRICH_TIMEOUT_MS);
                            if (t && typeof t.unref === 'function') t.unref();
                        })
                    ]);
                    if (oltResult && oltResult.status === 'success') {
                        onuIndex = buildOnuIndex(oltResult.onus, { normalizeMAC });
                        oltEnabled = true;
                    }
                }
            }
        } catch (oltError) {
            console.warn('[OLT-INFRA] Enrichment OLT tidak tersedia:', oltError.message);
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
        console.error('[OLT-INFRA] Error:', error.message);
        return res.status(500).json({ status: 500, message: error.message, data: [] });
    }
});

/**
 * Tentukan status TAMPILAN ONU. SNMP Hioso TIDAK bisa membedakan LOS vs DG (semua
 * phaseState=2 → "LOS" mentah), jadi untuk ONU offline pada OLT web-scrape (Hioso),
 * klasifikasi diambil dari LOG (statusEntry, terkoreksi jam OLT). Tanpa sinyal log →
 * "Offline" (jujur, BUKAN LOS palsu). OLT yang LOS-via-SNMP (ZTE GPON) pakai status SNMP.
 */
function resolveOnuDisplayStatus(onu, statusEntry, isWebScrape) {
    if (onu.status === 'Online') {
        return { olt_status: 'Online', is_los: false, is_dying_gasp: false, down_since: null, status_source: 'snmp' };
    }
    if (isWebScrape) {
        const logStat = statusEntry && statusEntry.map.get(normalizeMAC(onu.macAddress));
        if (logStat) {
            const dg = logStat.event_type === 'dying-gasp';
            return {
                olt_status: dg ? 'Dying Gasp' : 'LOS',
                is_los: !dg,
                is_dying_gasp: dg,
                down_since: Number.isFinite(logStat.realTs) ? new Date(logStat.realTs).toISOString() : null,
                status_source: 'log',
            };
        }
        // Offline per SNMP tapi tak ada sinyal log → jangan vonis LOS dari SNMP.
        return { olt_status: 'Offline', is_los: false, is_dying_gasp: false, down_since: null, status_source: 'log-unclassified' };
    }
    // OLT non-web-scrape (ZTE GPON): status SNMP sahih (LOS-via-SNMP didukung).
    return { olt_status: onu.status, is_los: onu.isLos, is_dying_gasp: onu.isDyingGasp, down_since: null, status_source: 'snmp' };
}

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
        const oltResult = await getCachedOltDataByKey(cacheKey, targetDevices, forceRefresh);
        if (oltResult.status !== 'success') {
            return res.json({ status: 200, message: oltResult.message || 'Gagal mengambil data OLT', data: [], enabled: true, error: true });
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
                console.warn(`[OLT-onus] klasifikasi log gagal utk ${dev.name}: ${e.message}`);
            }
        }));

        const rows = [];
        for (const onu of oltResult.onus) {
            // (oltResult sudah hanya berisi OLT terpilih bila wantOltId; cek ini jaring pengaman.)
            if (wantOltId && onu.olt_id !== wantOltId) continue;
            const u = findCustomer(onu);
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
                pppoe_username: u ? u.pppoe_username : (onu.description || null),
                customer_address: u ? (u.address || u.alamat || null) : null,
                customer_phone: u ? (u.phone_number || null) : null,
                customer_package: u ? (u.paket || u.package || null) : null,
            });
        }

        // Diagnostik: berapa baris yang DIKIRIM ke browser dengan redaman terisi.
        const rxFilled = rows.filter(r => r.rx_power && r.rx_power !== 'N/A').length;
        console.log(`[OLT-onus] oltId=${wantOltId || 'all'} → kirim ${rows.length} baris ke browser, rx terisi=${rxFilled}`);

        // Jangan biarkan browser meng-cache JSON ini (selalu data segar).
        res.set('Cache-Control', 'no-store');
        res.json({
            status: 200,
            message: 'OK',
            timestamp: oltResult.timestamp,
            enabled: true,
            data: rows,
            totalOnu: rows.length,
            matchedCount: rows.filter(r => r.matched).length,
            oltDevices: deviceList,
            oltResults: oltResult.oltResults
        });
    } catch (error) {
        console.error('[OLT] Error getting all ONUs:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * GET /api/olt/customer/:userId
 * Get ONT status for specific customer - MENGGUNAKAN CACHE untuk performa
 */
router.get('/customer/:userId', async (req, res) => {
    try {
        if (!req.user && !req.customer) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }

        const { userId } = req.params;
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
        console.error('[OLT] Error getting customer ONT:', error);
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
        if (!req.user && !req.customer) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
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

        console.log(`[OLT] Refresh single ONT: slot=${slotId}, onu=${onuId}, mac=${mac || 'N/A'}`);
        
        // Query dengan cache strategy jika MAC tersedia
        let result;
        if (mac) {
            result = await getSingleOnuDataWithCache(mac, slotId, onuId);
        } else {
            // Fallback: query all OLT jika MAC tidak tersedia
            console.log(`[OLT] No MAC provided, querying all OLTs...`);
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
        console.error('[OLT] Error refresh single ONT:', error);
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

        console.log('[OLT] Manual scrape triggered');
        
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
        console.error('[OLT] Error manual scrape:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * GET /api/olt/devices
 * Get all OLT devices
 */
router.get('/devices', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const devices = oltManager.getOltDevices();
        const globalConfig = oltManager.getOltGlobalConfig();

        res.json({
            status: 200,
            data: {
                devices: devices,
                globalConfig: globalConfig,
                brands: listDrivers() // daftar merk OLT yang didukung (untuk dropdown UI)
            }
        });
    } catch (error) {
        console.error('[OLT] Error getting devices:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * POST /api/olt/devices
 * Add new OLT device
 */
router.post('/devices', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { name, host, brand, snmpPort, snmpCommunity, snmpTimeout, snmpRetries, webUsername, webPassword, sshPort, sshUsername, sshPassword } = req.body;

        if (!name || !host) {
            return res.status(400).json({
                status: 400,
                message: 'Nama dan host OLT diperlukan'
            });
        }

        const config = loadConfig();
        
        if (!config.olt) {
            config.olt = {
                enabled: true,
                webEnabled: true,
                scrapeInterval: 1,
                timeWindow: 10,
                maxLogPages: 3,
                devices: []
            };
        }
        
        if (!config.olt.devices) {
            config.olt.devices = [];
        }

        // Generate ID
        const newId = `olt${config.olt.devices.length + 1}`;

        // Add new device
        const newDevice = {
            id: newId,
            name: name,
            host: host,
            brand: brand || 'auto',
            snmpPort: parseInt(snmpPort) || 161,
            snmpCommunity: snmpCommunity || 'public',
            snmpTimeout: parseInt(snmpTimeout) || 30000,
            snmpRetries: parseInt(snmpRetries) || 2,
            webUsername: webUsername || '',
            webPassword: webPassword || '',
            // Kredensial SSH untuk provisioning ONU & backup config (ZTE C320 dkk).
            sshPort: parseInt(sshPort) || 22,
            sshUsername: sshUsername || '',
            sshPassword: sshPassword || '',
            enabled: true
        };

        config.olt.devices.push(newDevice);

        if (saveConfig(config)) {
            // Restart scraper untuk include OLT baru
            const { restartLogScraper } = require('../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            // Restart juga poller SNMP-LOS (mis. ZTE) supaya device baru langsung dipantau.
            try {
                const { restartSnmpLosPoller } = require('../lib/olt-snmp-los-poller');
                if (typeof restartSnmpLosPoller === 'function') restartSnmpLosPoller();
            } catch (__e) { /* ignore */ }
            
            res.json({
                status: 200,
                message: 'OLT berhasil ditambahkan',
                data: newDevice
            });
        } else {
            res.status(500).json({ status: 500, message: 'Gagal menyimpan konfigurasi' });
        }
    } catch (error) {
        console.error('[OLT] Error adding device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * PUT /api/olt/devices/:id
 * Update OLT device
 */
router.put('/devices/:id', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { id } = req.params;
        const { name, host, brand, snmpPort, snmpCommunity, snmpTimeout, snmpRetries, webUsername, webPassword, sshPort, sshUsername, sshPassword, enabled } = req.body;

        const config = loadConfig();

        if (!config.olt || !config.olt.devices) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        const deviceIndex = config.olt.devices.findIndex(d => d.id === id);
        if (deviceIndex === -1) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        // Update device
        config.olt.devices[deviceIndex] = {
            ...config.olt.devices[deviceIndex],
            name: name || config.olt.devices[deviceIndex].name,
            host: host || config.olt.devices[deviceIndex].host,
            brand: brand || config.olt.devices[deviceIndex].brand || 'auto',
            snmpPort: parseInt(snmpPort) || config.olt.devices[deviceIndex].snmpPort,
            snmpCommunity: snmpCommunity || config.olt.devices[deviceIndex].snmpCommunity,
            snmpTimeout: parseInt(snmpTimeout) || config.olt.devices[deviceIndex].snmpTimeout,
            snmpRetries: parseInt(snmpRetries) || config.olt.devices[deviceIndex].snmpRetries,
            webUsername: webUsername !== undefined ? webUsername : config.olt.devices[deviceIndex].webUsername,
            webPassword: webPassword !== undefined ? webPassword : config.olt.devices[deviceIndex].webPassword,
            // Kredensial SSH (provisioning/backup); undefined = pertahankan nilai lama.
            sshPort: sshPort !== undefined ? (parseInt(sshPort) || 22) : (config.olt.devices[deviceIndex].sshPort || 22),
            sshUsername: sshUsername !== undefined ? sshUsername : (config.olt.devices[deviceIndex].sshUsername || ''),
            sshPassword: sshPassword !== undefined ? sshPassword : (config.olt.devices[deviceIndex].sshPassword || ''),
            enabled: enabled !== undefined ? (enabled === true || enabled === 'true') : config.olt.devices[deviceIndex].enabled
        };

        if (saveConfig(config)) {
            // Restart scraper untuk apply perubahan
            const { restartLogScraper } = require('../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            // Restart juga poller SNMP-LOS (mis. ZTE) supaya device baru langsung dipantau.
            try {
                const { restartSnmpLosPoller } = require('../lib/olt-snmp-los-poller');
                if (typeof restartSnmpLosPoller === 'function') restartSnmpLosPoller();
            } catch (__e) { /* ignore */ }
            
            res.json({
                status: 200,
                message: 'OLT berhasil diupdate',
                data: config.olt.devices[deviceIndex]
            });
        } else {
            res.status(500).json({ status: 500, message: 'Gagal menyimpan konfigurasi' });
        }
    } catch (error) {
        console.error('[OLT] Error updating device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * DELETE /api/olt/devices/:id
 * Delete OLT device
 */
router.delete('/devices/:id', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { id } = req.params;

        const config = loadConfig();
        
        if (!config.olt || !config.olt.devices) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        const deviceIndex = config.olt.devices.findIndex(d => d.id === id);
        if (deviceIndex === -1) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        // Remove device
        const deletedDevice = config.olt.devices.splice(deviceIndex, 1)[0];

        if (saveConfig(config)) {
            // Restart scraper untuk remove OLT
            const { restartLogScraper } = require('../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            // Restart juga poller SNMP-LOS (mis. ZTE) supaya device baru langsung dipantau.
            try {
                const { restartSnmpLosPoller } = require('../lib/olt-snmp-los-poller');
                if (typeof restartSnmpLosPoller === 'function') restartSnmpLosPoller();
            } catch (__e) { /* ignore */ }
            
            res.json({
                status: 200,
                message: 'OLT berhasil dihapus',
                data: deletedDevice
            });
        } else {
            res.status(500).json({ status: 500, message: 'Gagal menyimpan konfigurasi' });
        }
    } catch (error) {
        console.error('[OLT] Error deleting device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * POST /api/olt/devices/:id/test
 * Test connection to specific OLT device
 */
router.post('/devices/:id/test', async (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }

        const { id } = req.params;
        const device = oltManager.getOltDevice(id);

        if (!device) {
            return res.status(404).json({ status: 404, message: 'OLT tidak ditemukan' });
        }

        console.log(`[OLT] Testing connection to ${device.name} (${device.host}) brand=${device.brand || 'auto'}`);

        const config = {
            host: device.host,
            port: device.snmpPort || 161,
            community: device.snmpCommunity || 'public',
            timeout: device.snmpTimeout || 15000,
            retries: device.snmpRetries || 2
        };

        // Auto-deteksi merk via sysObjectID bila brand 'auto'/kosong, lalu simpan balik ke config
        // supaya query berikutnya langsung pakai driver yang benar tanpa probe lagi.
        let brand = device.brand || 'auto';
        let detectedBrand = null;
        if (brand === 'auto') {
            detectedBrand = await detectBrand(config);
            brand = detectedBrand;
            const cfg = loadConfig();
            const dev = cfg.olt && cfg.olt.devices && cfg.olt.devices.find(d => d.id === id);
            if (dev) { dev.brand = detectedBrand; saveConfig(cfg); }
        }

        const driver = getDriver(brand);
        const result = await driver.getOltData(config);

        if (result.status === 'success') {
            const detectNote = detectedBrand ? ` (terdeteksi: ${driver.label})` : '';
            res.json({
                status: 200,
                message: `Koneksi berhasil! Ditemukan ${result.onus.length} ONT${detectNote}`,
                data: {
                    timestamp: result.timestamp,
                    onuCount: result.onus.length,
                    brand: brand,
                    brandLabel: driver.label
                }
            });
        } else {
            res.status(500).json({
                status: 500,
                message: result.message || 'Gagal koneksi ke OLT'
            });
        }
    } catch (error) {
        console.error('[OLT] Error testing device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * GET /api/olt/drivers
 * Daftar merk OLT yang didukung (untuk dropdown brand di form device).
 */
router.get('/drivers', (req, res) => {
    try {
        if (!req.user || !['admin', 'owner'].includes(req.user.role)) {
            return res.status(403).json({ status: 403, message: 'Forbidden' });
        }
        res.json({ status: 200, data: listDrivers() });
    } catch (error) {
        console.error('[OLT] Error listing drivers:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

/**
 * GET /api/olt/event-log
 * Log durable kejadian OLT (LOS / Dying-Gasp / pulih) ter-ENRICH identitas pelanggan.
 * Query: from,to (epoch ms atau ISO), type (los|dying-gasp|discovery), q (cari
 * nama/pppoe/HP/MAC/alamat), oltId, mac, limit, offset.
 */
router.get('/event-log', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ status: 401, message: 'Unauthorized' });
        }
        const repo = require('../repositories/olt-event.repository').getOltEventRepository();
        const q = req.query || {};
        const toMs = (v) => {
            if (v == null || v === '') return undefined;
            const n = Number(v);
            if (Number.isFinite(n)) return n;
            const d = Date.parse(v);
            return Number.isNaN(d) ? undefined : d;
        };
        const filters = {
            from: toMs(q.from),
            to: toMs(q.to),
            type: q.type || undefined,
            q: q.q || undefined,
            oltId: q.oltId || undefined,
            mac: q.mac || undefined,
            limit: q.limit ? Number(q.limit) : 200,
            offset: q.offset ? Number(q.offset) : 0,
        };
        const [rawItems, total, stats] = await Promise.all([
            repo.listEvents(filters),
            repo.countEvents(filters),
            repo.getStats(filters),
        ]);
        // Enrich tampilan OLT (read-time): olt_id mentah (IP OLT asli / IP MikroTik ke-NAT)
        // → {olt_name, olt_ip} manusiawi. Tanpa migrasi/backfill.
        const { resolveOltDisplay } = require('../lib/olt-name-resolver');
        const items = rawItems.map((r) => {
            const o = resolveOltDisplay(r.olt_id);
            return Object.assign({}, r, { olt_name: o.name, olt_ip: o.ip });
        });
        res.json({ status: 200, data: { items, total, stats } });
    } catch (error) {
        console.error('[OLT] Error event-log:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

module.exports = router;
