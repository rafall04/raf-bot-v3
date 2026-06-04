/**
 * OLT Routes
 * API endpoints untuk monitoring OLT HIOSO
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Import OLT library
const { getOltData, getSingleOnuData, getMultipleOltData, getSingleOnuDataWithCache, matchOltWithCustomers, matchMAC, normalizeMAC } = require('../lib/olt-hioso');
const { getActivePPPoEUsers } = require('../lib/mikrotik');

// Import OLT Log Scraper
const oltLogScraper = require('../lib/olt-log-scraper');

// Import OLT Manager
const oltManager = require('../lib/olt-manager');

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

        // Get OLT data dari semua OLT (parallel query)
        console.log(`[OLT] Fetching matched ONT data from ${oltDevices.length} OLT(s)`);
        const oltResult = await getMultipleOltData(oltDevices);

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

        // Build matched data menggunakan last caller ID untuk offline users
        const matchedData = [];
        const oltByMac = {};
        
        // Index OLT data by MAC prefix untuk quick lookup
        oltResult.onus.forEach(onu => {
            const normalizedMac = normalizeMAC(onu.macAddress);
            if (normalizedMac) {
                const prefix = normalizedMac.substring(0, 10);
                oltByMac[prefix] = onu;
            }
        });

        // Match setiap user dengan OLT data
        // PENTING: Jika user punya MAC (dari cache) tapi ONT tidak ada di OLT,
        // itu berarti ONT dalam kondisi DYING GASP (adaptor mati)
        for (const user of users) {
            if (!user.pppoe_username) continue;
            
            // Get MAC dari active session atau last known
            const macInfo = getMacForUser(user.pppoe_username, pppoeActive);
            if (!macInfo) continue;
            
            const userMacPrefix = normalizeMAC(macInfo.mac).substring(0, 10);
            
            // Cari ONU yang match
            const matchedOnu = oltByMac[userMacPrefix];
            
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
                // tetap bisa diketahui ikut OLT mana di query berikutnya.
                if (matchedOnu.macAddress && matchedOnu.olt_id) {
                    oltManager.updateMacCache(matchedOnu.macAddress, matchedOnu.olt_id, matchedOnu.olt_name, matchedOnu.olt_host);
                }

                matchedData.push({
                    user_id: user.id,
                    customer_name: user.name,
                    pppoe_username: user.pppoe_username,
                    mac_mikrotik: macInfo.mac,
                    mac_source: macInfo.source, // 'active' atau 'cached'
                    mac_olt: matchedOnu.macAddress,
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
                    pppoe_username: user.pppoe_username,
                    mac_mikrotik: macInfo.mac,
                    mac_source: macInfo.source,
                    mac_olt: 'N/A',
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
                    const r = await getSingleOnuData(config, slotId, onuId);
                    if (r.status === 'success' && r.data && r.data.rxPower !== 'N/A') {
                        return r;
                    }
                    return null;
                } catch (error) {
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
            // Selalu return data meskipun N/A (ONT offline)
            res.json({
                status: 200,
                message: 'OK',
                timestamp: result.timestamp,
                enabled: true,
                data: {
                    rx_power: result.data.rxPower,
                    olt_status: result.data.status,
                    is_dying_gasp: result.data.isDyingGasp,
                    is_los: result.data.isLos,
                    last_down_cause: result.data.lastDownCause
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
                globalConfig: globalConfig
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

        const { name, host, snmpPort, snmpCommunity, snmpTimeout, snmpRetries, webUsername, webPassword } = req.body;

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
            snmpPort: parseInt(snmpPort) || 161,
            snmpCommunity: snmpCommunity || 'public',
            snmpTimeout: parseInt(snmpTimeout) || 30000,
            snmpRetries: parseInt(snmpRetries) || 2,
            webUsername: webUsername || '',
            webPassword: webPassword || '',
            enabled: true
        };

        config.olt.devices.push(newDevice);

        if (saveConfig(config)) {
            // Restart scraper untuk include OLT baru
            const { restartLogScraper } = require('../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            
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
        const { name, host, snmpPort, snmpCommunity, snmpTimeout, snmpRetries, webUsername, webPassword, enabled } = req.body;

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
            snmpPort: parseInt(snmpPort) || config.olt.devices[deviceIndex].snmpPort,
            snmpCommunity: snmpCommunity || config.olt.devices[deviceIndex].snmpCommunity,
            snmpTimeout: parseInt(snmpTimeout) || config.olt.devices[deviceIndex].snmpTimeout,
            snmpRetries: parseInt(snmpRetries) || config.olt.devices[deviceIndex].snmpRetries,
            webUsername: webUsername !== undefined ? webUsername : config.olt.devices[deviceIndex].webUsername,
            webPassword: webPassword !== undefined ? webPassword : config.olt.devices[deviceIndex].webPassword,
            enabled: enabled !== undefined ? (enabled === true || enabled === 'true') : config.olt.devices[deviceIndex].enabled
        };

        if (saveConfig(config)) {
            // Restart scraper untuk apply perubahan
            const { restartLogScraper } = require('../lib/olt-log-scraper');
            if (typeof restartLogScraper === 'function') {
                restartLogScraper();
            }
            
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

        console.log(`[OLT] Testing connection to ${device.name} (${device.host})`);
        
        const config = {
            host: device.host,
            port: device.snmpPort || 161,
            community: device.snmpCommunity || 'public',
            timeout: device.snmpTimeout || 15000,
            retries: device.snmpRetries || 2
        };
        
        const result = await getOltData(config);

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
        console.error('[OLT] Error testing device:', error);
        res.status(500).json({ status: 500, message: error.message });
    }
});

module.exports = router;
