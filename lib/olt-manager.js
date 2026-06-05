/**
 * Header Doc
 * Purpose: Mengelola daftar OLT dan cache mapping MAC ke OLT untuk monitoring jaringan.
 * Caller: Scraper OLT, monitoring OLT, dan helper diagnostik jaringan.
 * Deps: `fs`, `path`, `config.json`, dan `database/olt-mac-cache.json`.
 * MainFuncs: `loadMacCache`, `saveMacCache`, `updateMacCache`, `getOltFromMac`, `getOltDevices`, `getOltGlobalConfig`, `cleanupMacCache`.
 * SideEffects: Membaca/menulis cache MAC OLT dan memasang timer cleanup background yang tidak menahan process exit.
 */

const fs = require('fs');
const path = require('path');

// Cache file untuk MAC → OLT mapping
const MAC_CACHE_FILE = path.join(__dirname, '..', 'database', 'olt-mac-cache.json');

// In-memory cache
let macToOltCache = new Map();

/**
 * Load MAC cache dari file
 */
function loadMacCache() {
    try {
        if (fs.existsSync(MAC_CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(MAC_CACHE_FILE, 'utf8'));
            macToOltCache = new Map(Object.entries(data));
            console.log(`[OLT-Manager] Loaded ${macToOltCache.size} MAC mappings from cache`);
        }
    } catch (e) {
        console.error('[OLT-Manager] Error loading MAC cache:', e.message);
    }
}

/**
 * Save MAC cache ke file
 */
function saveMacCache() {
    try {
        const data = {};
        macToOltCache.forEach((value, key) => {
            data[key] = value;
        });
        fs.writeFileSync(MAC_CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error('[OLT-Manager] Error saving MAC cache:', e.message);
    }
}

/**
 * Update MAC cache
 */
function updateMacCache(mac, oltId, oltName, oltHost) {
    const normalizedMac = mac.replace(/[:\-\s]/g, '').toUpperCase();
    macToOltCache.set(normalizedMac, {
        oltId: oltId,
        oltName: oltName,
        oltHost: oltHost,
        lastSeen: new Date().toISOString()
    });
}

/**
 * Get OLT info dari MAC
 */
function getOltFromMac(mac) {
    const normalizedMac = mac.replace(/[:\-\s]/g, '').toUpperCase();
    return macToOltCache.get(normalizedMac) || null;
}

/**
 * Get all OLT devices dari config
 */
function getOltDevices() {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        if (!config.olt || !config.olt.devices) {
            // Backward compatibility: single OLT
            if (config.olt && config.olt.host) {
                return [{
                    id: 'olt1',
                    name: 'OLT Default',
                    brand: config.olt.brand || 'auto',
                    host: config.olt.host,
                    snmpPort: config.olt.port || 161,
                    snmpCommunity: config.olt.community || 'public',
                    snmpTimeout: config.olt.timeout || 15000,
                    snmpRetries: config.olt.retries || 2,
                    webUsername: config.olt.webUsername || '',
                    webPassword: config.olt.webPassword || '',
                    enabled: config.olt.enabled !== false
                }];
            }
            return [];
        }
        
        // Multiple OLT
        return config.olt.devices.filter(d => d.enabled !== false);
    } catch (e) {
        console.error('[OLT-Manager] Error loading OLT devices:', e.message);
        return [];
    }
}

/**
 * Get OLT device by ID
 */
function getOltDevice(oltId) {
    const devices = getOltDevices();
    return devices.find(d => d.id === oltId) || null;
}

/**
 * Get global OLT config (interval, timeWindow, etc)
 */
function getOltGlobalConfig() {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        return {
            enabled: config.olt?.enabled !== false,
            webEnabled: config.olt?.webEnabled !== false,
            scrapeInterval: config.olt?.scrapeInterval || 1,
            timeWindow: config.olt?.timeWindow || 10,
            maxLogPages: config.olt?.maxLogPages || 3
        };
    } catch (e) {
        console.error('[OLT-Manager] Error loading global config:', e.message);
        return {
            enabled: false,
            webEnabled: false,
            scrapeInterval: 1,
            timeWindow: 10,
            maxLogPages: 3
        };
    }
}

/**
 * Cleanup old cache entries (older than 7 days)
 */
function cleanupMacCache() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let cleaned = 0;
    
    macToOltCache.forEach((value, key) => {
        const lastSeen = new Date(value.lastSeen);
        if (lastSeen < sevenDaysAgo) {
            macToOltCache.delete(key);
            cleaned++;
        }
    });
    
    if (cleaned > 0) {
        console.log(`[OLT-Manager] Cleaned ${cleaned} old MAC cache entries`);
        saveMacCache();
    }
}

// Load cache saat module di-load
loadMacCache();

// Cleanup cache setiap 24 jam tanpa menahan proses test/CLI untuk exit.
const macCacheCleanupInterval = setInterval(cleanupMacCache, 24 * 60 * 60 * 1000);
if (typeof macCacheCleanupInterval.unref === 'function') {
    macCacheCleanupInterval.unref();
}

module.exports = {
    loadMacCache,
    saveMacCache,
    updateMacCache,
    getOltFromMac,
    getOltDevices,
    getOltDevice,
    getOltGlobalConfig,
    cleanupMacCache
};
