/**
 * Header Doc
 * Purpose: State & helper bersama route OLT — cache snapshot (stale-while-revalidate + freshness),
 *          cache PPPoE, last-caller-id cache, load/save config, resolveOnuDisplayStatus.
 *          Dibagi ke sub-router lain lewat `module.exports` — Map/const di sini tetap SINGLETON.
 * Caller: sub-router `routes/olt/{snapshot,matching,health}.js`.
 * Deps: `../../lib/olt-optical-resolver`, `../../lib/olt-hioso`, `../../lib/mikrotik`,
 *       `../../lib/olt-manager`, `../../lib/env-config` (lazy di saveConfig).
 * MainFuncs: `getCachedOltDataByKey`, `getCachedMultipleOltData`, `getCachedOltData`,
 *            `getCachedPppoeData`, `loadConfig`/`saveConfig`, `resolveOnuDisplayStatus`.
 * SideEffects: membaca OLT via web + API MikroTik; menulis `database/last-caller-id-cache.json`.
 */
const fs = require('fs');
const path = require('path');
const { ambilDataOlt } = require('../../lib/olt-optical-resolver');
const { normalizeMAC } = require('../../lib/olt-hioso');
const { getActivePPPoEUsers } = require('../../lib/mikrotik');
const oltManager = require('../../lib/olt-manager');

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

// BATAS UMUR KERAS untuk stale-while-revalidate. Tanpa ini, sekali cache terisi, data lama
// disajikan SEKETIKA selamanya selama refresh latar belakang terus gagal (OLT tak terjangkau saat
// gangguan justru kondisi paling mungkin) — dan halaman tetap tampak "baru saja diperbarui".
// Lewat ambang ini pemanggil harus MENUNGGU data segar; kalau gagal, gagalnya terlihat.
const OLT_CACHE_MAX_AGE = 5 * 60 * 1000;

const oltDataCacheMap = new Map(); // key -> { data, timestamp, loading, refreshPromise }


/**
 * Metadata kesegaran untuk SNAPSHOT YANG DISAJIKAN — `servedAt` diambil pada detik data itu
 * dipetik dari cache, BUKAN dibaca ulang saat respons disusun.
 *
 * Bedanya fatal pada jalur stale-while-revalidate: request menyajikan snapshot lama lalu memicu
 * refresh latar belakang; kalau refresh itu selesai sebelum respons selesai disusun, membaca ulang
 * `entry.timestamp` menghasilkan umur milik snapshot BARU sementara `data` yang dikirim masih yang
 * LAMA. Persis kebohongan "baru saja diperbarui" yang seharusnya dihapus oleh #b189 — terlihat di
 * Tanjungharjo 2026-07-31: respons melaporkan umur 0 detik untuk data kosong, sementara log bot
 * mencatat 105 ONU dua detik kemudian.
 */
function buildOltFreshness(servedAt, entry) {
    if (!servedAt) {
        return {
            fetched_at: null,
            age_seconds: null,
            stale: true,
            refreshing: !!(entry && entry.loading),
            max_age_seconds: OLT_CACHE_MAX_AGE / 1000
        };
    }
    const ageMs = Date.now() - servedAt;
    return {
        fetched_at: new Date(servedAt).toISOString(),
        age_seconds: Math.round(ageMs / 1000),
        stale: ageMs >= OLT_CACHE_TTL,
        refreshing: !!(entry && entry.loading),
        max_age_seconds: OLT_CACHE_MAX_AGE / 1000
    };
}


/**
 * Refresh satu entry cache (query OLT). Dedup: jika sudah ada refresh berjalan,
 * pakai promise yang sama (tidak walk dobel).
 */
function refreshOltEntry(entry, devices) {
    if (entry.loading && entry.refreshPromise) return entry.refreshPromise;
    entry.loading = true;
    entry.refreshPromise = (async () => {
        try {
            // Sumber optik dipilih di `lib/olt-optical-resolver` — SATU pemilik keputusan
            // untuk seluruh aplikasi (#b275). Bawaannya WEB; SNMP membuat OLT hang.
            const result = await ambilDataOlt(devices);
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

    // Umur dipetik BERSAMAAN dengan datanya (lihat buildOltFreshness) — bukan dibaca ulang nanti.
    const sajikan = (data, servedAt) => ({ data, freshness: buildOltFreshness(servedAt, entry) });

    if (forceRefresh) {
        const result = await refreshOltEntry(entry, devices); // tunggu segar
        return sajikan(result, result && result.status === 'success' ? entry.timestamp : Date.now());
    }
    const fresh = entry.data && (now - entry.timestamp) < OLT_CACHE_TTL;
    if (fresh) return sajikan(entry.data, entry.timestamp);
    if (entry.data && (now - entry.timestamp) < OLT_CACHE_MAX_AGE) {
        // Basi tapi masih dalam batas → sajikan seketika + refresh di background (tak ditunggu).
        // Snapshot & umurnya dipetik SEKARANG, sebelum refresh latar belakang sempat menggantinya.
        const data = entry.data;
        const servedAt = entry.timestamp;
        if (!entry.loading) refreshOltEntry(entry, devices).catch(() => {});
        return sajikan(data, servedAt);
    }
    // Belum pernah terisi ATAU sudah melewati batas umur keras → tunggu data segar. Kalau OLT
    // memang tak terjangkau, hasilnya status error dan halaman menampilkan kegagalan itu apa
    // adanya — jauh lebih berguna daripada foto lama berlabel "baru saja".
    const result = await refreshOltEntry(entry, devices);
    return sajikan(result, result && result.status === 'success' ? entry.timestamp : Date.now());
}


// Kompat: /matched tetap pakai key 'all' (semua OLT).
async function getCachedMultipleOltData(oltDevices, forceRefresh = false) {
    return getCachedOltDataByKey('all', oltDevices, forceRefresh);
}

// Kesahihan pembacaan redaman dimiliki `lib/olt-optical-resolver` (dipakai bersama bot teknisi &
// laporan pasca-perbaikan) — jangan bikin salinan rumusnya di sini.


// ============================================
// LAST CALLER ID CACHE - Menyimpan MAC terakhir per PPPoE username
// Ini memungkinkan matching meskipun pelanggan offline
// ============================================
const lastCallerIdCache = new Map(); // Map<pppoe_username, {mac, timestamp}>
const LAST_CALLER_ID_FILE = path.join(__dirname, '..', '..', 'database', 'last-caller-id-cache.json');


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
async function getCachedOltData(_oltConfigLama, forceRefresh = false) {
    // Dulu membaca `config.olt.host` — bentuk config SATU-OLT yang sudah lama tidak ada
    // (sekarang `config.olt.devices[]`), jadi jalur ini sebenarnya sudah rusak diam-diam.
    // Sekaligus: pembacaannya memakai SNMP HIOSO langsung, yang kini DILARANG (bikin OLT hang).
    //
    // Diarahkan ke pembungkus multi-perangkat yang sama dengan /matched — satu cache, satu
    // pintu (`ambilDataOlt`), dan HIOSO otomatis terbaca lewat web.
    const devices = oltManager.getOltDevices() || [];
    const { data } = await getCachedMultipleOltData(devices, forceRefresh === true);
    return data;
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
        const configPath = path.join(__dirname, '..', '..', 'config.json');
        const configData = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(configData);
    } catch (error) {
        console.error('[OLT] Error loading config:', error.message);
        return {};
    }
}


// Helper to save config — delegasi ke env-config.saveConfigAtomic (indent 2 konsisten + STRIP field
// ephemeral lalu re-add ke global.config). Dulu `global.config = config` di sini MENJATUHKAN
// environment/isProduction/isTest (config dibaca dari disk tanpa field itu) — bug terkonfirmasi audit.
function saveConfig(config) {
    try {
        require('../../lib/env-config').saveConfigAtomic(config);
        return true;
    } catch (error) {
        console.error('[OLT] Error saving config:', error.message);
        return false;
    }
}


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


/**
 * ID device OLT berikutnya yang DIJAMIN unik. Ambil suffix numerik TERTINGGI dari id `olt<N>` yang
 * ADA + 1 (bukan panjang array yang bisa menyusut karena hapus), lalu naikkan sampai benar-benar
 * tak bertabrakan dengan id mana pun (termasuk id non-standar). Fungsi murni → mudah diuji.
 */
function nextOltDeviceId(devices) {
    const list = Array.isArray(devices) ? devices : [];
    const existing = new Set(list.map((d) => d && d.id).filter(Boolean));
    let maxSeq = 0;
    for (const d of list) {
        const m = d && typeof d.id === 'string' && d.id.match(/^olt(\d+)$/);
        if (m) { const n = parseInt(m[1], 10); if (Number.isFinite(n) && n > maxSeq) maxSeq = n; }
    }
    let seq = maxSeq + 1;
    while (existing.has(`olt${seq}`)) seq += 1;
    return `olt${seq}`;
}


module.exports = {
    OLT_CACHE_MAX_AGE,
    OLT_CACHE_TTL,
    buildOltFreshness,
    getCachedMultipleOltData,
    getCachedOltData,
    getCachedOltDataByKey,
    getCachedPppoeData,
    getMacForUser,
    getPPPoEActiveUsers,
    lastCallerIdCache,
    loadConfig,
    loadLastCallerIdCache,
    nextOltDeviceId,
    oltDataCacheMap,
    pppoeCache,
    refreshOltEntry,
    resolveOnuDisplayStatus,
    saveConfig,
    saveLastCallerIdCache,
    updateLastCallerIdCache,
};
