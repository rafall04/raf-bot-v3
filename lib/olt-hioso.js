/**
 * Header Doc
 * Purpose: Driver SNMP OLT HIOSO (EPON) — membaca inventaris ONU beserta MAC, rxPower (redaman),
 *          phase-state (Online/LOS/Sync/Auth Fail/Offline) dan lastDownCause, lalu menggabungkan
 *          hasil banyak OLT jadi satu snapshot. Juga driver default untuk device brand 'auto'.
 *          KEJUJURAN DATA adalah bagian dari kontraknya: walk per-OID sengaja best-effort (satu OID
 *          rewel tak boleh menjatuhkan seluruh fetch), jadi hasil setengah jadi WAJIB ditandai —
 *          `onu.statusKnown=false` saat phaseState tak menyebut ONU itu, `incompleteWalks` +
 *          `failedWalks` di tingkat OLT, `failedOlts` di tingkat armada, dan status `error` bila
 *          SEMUA OLT gagal dibaca (bukan sukses berisi nol ONU, yang di hilir terbaca sebagai
 *          "semua pelanggan offline").
 *          GAGAL ≠ KOSONG: walk yang menolak dicatat terpisah dari walk yang memang tak berisi,
 *          supaya "OLT tak menjawab" tak tertukar dengan "OLT belum punya ONU".
 *          SEBAGIAN ≠ UTUH: snapshot gabungan yang kehilangan satu OLT tetap `success` (data OLT
 *          hidup masih berguna) TAPI wajib menyebut `failedOlts` — pemanggil tak bisa menyimpulkan
 *          kebutaan itu dari `onus`, dan tanpa daftar tsb pelanggan di balik OLT bisu divonis mati.
 *          PEMBATAS WAKTU IKUT KONFIGURASI: anggaran SNMP nyata = timeout × (1 + retries); pembatas
 *          darurat yang lebih pendek akan selalu menang duluan dan membuang seluruh verdict di atas.
 * Caller: `routes/olt.js` (dashboard monitor OLT), `lib/olt-optical-resolver.js` (bot teknisi),
 *         `lib/olt-rxpower-poller.js`, `lib/olt-drivers/*` (dispatch per-merk).
 * Deps: `./olt-drivers` (dispatch per-merk). **TIDAK LAGI memakai `net-snmp`** — lihat catatan di bawah.
 * MainFuncs: `getOltData`, `getMultipleOltData`, `getSingleOnuData`, `normalizeMAC`. (`parseRxPower` & seluruh peta OID SNMP DIBUANG — lihat #b283.)
 * SideEffects: Tidak membuka sesi SNMP sama sekali. Pembacaan HIOSO didelegasikan ke drivernya
 *              yang membaca lewat WEB (`lib/olt-web-optical`).
 *
 * !! SNMP HIOSO DILARANG (#b283) — membuat OLT hang (terbukti di lapangan). Larangan ini
 * KHUSUS HIOSO; ZTE aman dan punya jalur SNMP-nya sendiri di `lib/olt-drivers/zte.js`.
 * Isi walk SNMP-nya DIBUANG, bukan disimpan sebagai kode mati. Jaminan lama #b192
 * (pembacaan gagal TIDAK disulap jadi 'nol ONU') tetap berlaku dan kini dijaga di jalur
 * web: satu halaman gagal ⇒ seluruh OLT ditandai `failedOlts`, bukan daftar ONU kosong.
 *
 * Data yang diambil: MAC ONT, RX Power (redaman) dBm, status ONT, indikator Dying Gasp & LOS.
 */


/**
 * Format MAC address dari hex string ke format standar
 * @param {string} hexString - MAC dalam format hex (12 karakter)
 * @returns {string} MAC dalam format XX:XX:XX:XX:XX:XX
 */
function formatMacAddress(hexString) {
    if (typeof hexString !== 'string' || hexString.length !== 12) {
        return hexString;
    }
    return hexString.match(/.{2}/g).join(':').toUpperCase();
}

/**
 * Normalisasi MAC address untuk matching
 * Menghapus separator dan uppercase
 * @param {string} mac - MAC address dalam berbagai format
 * @returns {string} MAC tanpa separator, uppercase
 */
function normalizeMAC(mac) {
    if (!mac || typeof mac !== 'string') return '';
    return mac.replace(/[:\-\s]/g, '').toUpperCase();
}

/**
 * Match MAC address antara MikroTik dan OLT
 * MAC di OLT berbeda 2 digit terakhir dengan MAC di MikroTik
 * 
 * @param {string} mikrotikMAC - MAC dari MikroTik PPPoE
 * @param {string} oltMAC - MAC dari OLT
 * @returns {boolean} true jika match (10 digit pertama sama)
 */
function matchMAC(mikrotikMAC, oltMAC) {
    const mikNorm = normalizeMAC(mikrotikMAC);
    const oltNorm = normalizeMAC(oltMAC);
    
    if (mikNorm.length < 10 || oltNorm.length < 10) return false;
    
    // Bandingkan 10 karakter pertama (5 oktet = 10 hex digit)
    return mikNorm.substring(0, 10) === oltNorm.substring(0, 10);
}




/**
 * Get full suffix dari OID (untuk query yang akurat)
 * Format OID: {baseOid}.{X}.{slot}.{onu}
 * @param {string} oid - Full OID string
 * @param {string} baseOid - Base OID yang digunakan
 * @returns {string} Full suffix (X.slot.onu)
 */


/**
 * Get OLT data via SNMP
 * @param {Object} config - OLT configuration {host, port, community, timeout, retries}
 * @returns {Promise<Object>} OLT data with ONUs
 */


/**
 * Baca SEMUA ONU satu OLT. Sejak larangan SNMP HIOSO (#b283) ini mendelegasikan ke driver
 * HIOSO yang membacanya lewat WEB (`lib/olt-web-optical`).
 *
 * !! SNMP membuat OLT HIOSO hang. Larangan ini KHUSUS HIOSO — ZTE aman dan punya jalur
 * SNMP-nya sendiri di `lib/olt-drivers/zte.js`.
 */
async function getOltData(config) {
    return require('./olt-drivers').resolveDriver({ brand: 'hioso', host: config && config.host })
        .getOltData(config);
}

/**
 * Match OLT data dengan data pelanggan
 * @param {Array} oltOnus - Array of ONUs from OLT
 * @param {Array} mikrotikMacs - Array of {pppoe_username, mac} from MikroTik
 * @param {Array} users - Array of users from database
 * @returns {Array} Matched data with customer info
 */
function matchOltWithCustomers(oltOnus, mikrotikMacs, users) {
    const result = [];

    for (const onu of oltOnus) {
        // Find matching MikroTik MAC
        const mikrotikMatch = mikrotikMacs.find(m => matchMAC(m.mac, onu.macAddress));
        
        if (mikrotikMatch) {
            // Find user by pppoe_username
            const user = users.find(u => u.pppoe_username === mikrotikMatch.pppoe_username);
            
            if (user) {
                result.push({
                    user_id: user.id,
                    customer_name: user.name,
                    pppoe_username: user.pppoe_username,
                    mac_mikrotik: mikrotikMatch.mac,
                    mac_olt: onu.macAddress,
                    rx_power: onu.rxPower,
                    olt_status: onu.status,
                    is_dying_gasp: onu.isDyingGasp,
                    is_los: onu.isLos,
                    last_down_cause: onu.lastDownCause,
                    slot_id: onu.slotId,
                    onu_id: onu.id
                });
            }
        }
    }

    return result;
}

/**
 * Get single ONU data via SNMP - menggunakan performSnmpWalk yang sama dengan getOltData
 * Ini lebih reliable karena menggunakan metode yang sudah terbukti berhasil
 * 
 * @param {Object} config - OLT configuration {host, port, community, timeout, retries}
 * @param {string|number} slotId - Slot ID dari ONT
 * @param {string|number} onuId - ONU ID dari ONT
 * @returns {Promise<Object>} Single ONU data {rxPower, status, isLos, isDyingGasp}
 */
/**
 * Baca SATU ONU. Sejak larangan SNMP HIOSO (#b283) ini mendelegasikan ke driver HIOSO
 * yang membacanya lewat WEB. Isi SNMP-nya dibuang, bukan disimpan sebagai kode mati.
 */
async function getSingleOnuData(config, slotId, onuId) {
    return require('./olt-drivers').resolveDriver({ brand: 'hioso', host: config && config.host })
        .getSingleOnuData(config, slotId, onuId);
}

/**
 * Get data dari multiple OLT secara parallel
 * @param {Array} oltDevices - Array of OLT device configs
 * @returns {Promise<Object>} Merged OLT data
 */
async function getMultipleOltData(oltDevices) {
    if (!Array.isArray(oltDevices) || oltDevices.length === 0) {
        return {
            status: 'error',
            message: 'No OLT devices configured',
            onus: [],
            systemInfo: {},
            oltResults: []
        };
    }
    
    console.log(`[OLT] Querying ${oltDevices.length} OLT device(s) in parallel...`);
    
    // Query semua OLT secara parallel
    const promises = oltDevices.map(async (olt) => {
        try {
            const config = {
                host: olt.host,
                port: olt.snmpPort || 161,
                community: olt.snmpCommunity || 'public',
                timeout: olt.snmpTimeout || 15000,
                retries: olt.snmpRetries || 2
            };

            // Dispatch per-merk: device.brand → driver. Default (auto) = HIOSO.
            const driver = require('./olt-drivers').resolveDriver(olt);
            const result = await driver.getOltData(config);
            
            // Add OLT info to each ONU
            if (result.status === 'success' && result.onus) {
                result.onus.forEach(onu => {
                    onu.olt_id = olt.id;
                    onu.olt_name = olt.name;
                    onu.olt_host = olt.host;
                    onu.olt_brand = olt.brand || 'auto';
                });
            }
            
            return {
                oltId: olt.id,
                oltName: olt.name,
                oltHost: olt.host,
                status: result.status,
                message: result.message,
                onus: result.onus || [],
                systemInfo: result.systemInfo || {},
                incompleteWalks: result.incompleteWalks || [],
                failedWalks: result.failedWalks || []
            };
        } catch (error) {
            console.error(`[OLT] Error querying ${olt.name}:`, error.message);
            return {
                oltId: olt.id,
                oltName: olt.name,
                oltHost: olt.host,
                status: 'error',
                message: error.message,
                onus: [],
                systemInfo: {},
                // Ikut dibawa walau kosong: bentuk hasil harus sama di semua jalan keluar, supaya
                // `[]` selalu berarti "tak ada yang gagal" dan tak pernah "tak ada yang bercerita".
                incompleteWalks: [],
                failedWalks: []
            };
        }
    });
    
    const results = await Promise.all(promises);
    
    // Merge semua ONUs dari semua OLT
    const allOnus = [];
    results.forEach(result => {
        if (result.status === 'success' && result.onus.length > 0) {
            allOnus.push(...result.onus);
            console.log(`[OLT] [${result.oltName}] Got ${result.onus.length} ONUs`);
        } else if (result.status === 'error') {
            console.error(`[OLT] [${result.oltName}] Error: ${result.message}`);
        }
    });
    
    console.log(`[OLT] Total ONUs from all OLTs: ${allOnus.length}`);

    // OLT yang TIDAK TERBACA ronde ini. Ini kunci kejujuran di tingkat armada: snapshot gabungan
    // wajib menyatakan matanya yang buta sebelah, karena pemanggil TIDAK BISA menyimpulkannya dari
    // `onus` — ONU pelanggan yang OLT-nya bisu tampak persis sama dengan ONU yang benar-benar
    // hilang dari OLT yang sehat. Tanpa daftar ini, satu OLT mati di antara OLT hidup membuat
    // seluruh pelanggannya divonis "Offline" (insiden Dander 192.168.11.2, 53 dari 58 pelanggan).
    const failedOlts = results
        .filter((result) => result.status === 'error')
        .map((result) => ({
            oltId: result.oltId,
            oltName: result.oltName,
            oltHost: result.oltHost,
            message: result.message
        }));

    // Merk/OLT yang walk-nya tak lengkap / gagal — dipakai UI untuk menandai data setengah jadi.
    const perOltWalks = (field) => results
        .filter((result) => Array.isArray(result[field]) && result[field].length > 0)
        .map((result) => ({ oltId: result.oltId, oltName: result.oltName, walks: result[field] }));

    // SEMUA OLT gagal ≠ "semua ONU hilang". Dulu fungsi ini selalu balas `success` dengan daftar
    // ONU kosong, sehingga pemanggil menyimpulkan setiap pelanggan tidak ditemukan di OLT alias
    // offline — kegagalan alat baca disajikan sebagai vonis tentang jaringan pelanggan.
    const allFailed = results.length > 0 && results.every((result) => result.status === 'error');
    if (allFailed) {
        return {
            status: 'error',
            message: `Semua OLT gagal dibaca (${results.map((r) => r.oltName || r.oltHost).join(', ')})`,
            timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            fetchedAt: new Date().toISOString(),
            onus: [],
            systemInfo: {},
            incompleteWalks: perOltWalks('incompleteWalks'),
            failedWalks: perOltWalks('failedWalks'),
            failedOlts,
            oltResults: results
        };
    }

    if (failedOlts.length > 0) {
        console.warn(`[OLT] Snapshot SEBAGIAN: ${failedOlts.length} dari ${results.length} OLT tidak terbaca`
            + ` (${failedOlts.map((f) => f.oltName || f.oltHost).join(', ')}) — pelanggan di baliknya TIDAK boleh dibaca sebagai offline.`);
    }

    return {
        status: 'success',
        timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        // Stempel yang bisa dihitung umurnya oleh pemanggil (yang di atas untuk mata manusia).
        fetchedAt: new Date().toISOString(),
        onus: allOnus,
        systemInfo: {},
        incompleteWalks: perOltWalks('incompleteWalks'),
        failedWalks: perOltWalks('failedWalks'),
        // Sengaja tetap `success`: data OLT yang hidup tetap berguna dan tak boleh ikut dibuang.
        // Yang berubah, snapshot ini kini JUJUR soal cakupannya — lihat `failedOlts`.
        failedOlts,
        oltResults: results // Detail per OLT
    };
}

/**
 * Get single ONU data dengan cache strategy
 * Cek cache dulu untuk tahu ONU ada di OLT mana, baru query specific OLT
 * Fallback ke query all OLT jika cache miss
 * 
 * @param {string} mac - MAC address ONT (untuk lookup cache)
 * @param {string|number} slotId - Slot ID dari ONT
 * @param {string|number} onuId - ONU ID dari ONT
 * @returns {Promise<Object>} Single ONU data
 */
async function getSingleOnuDataWithCache(mac, slotId, onuId) {
    const oltManager = require('./olt-manager');
    const { resolveDriver } = require('./olt-drivers');

    // Normalize MAC
    const normalizedMac = normalizeMAC(mac);
    
    // Cek cache untuk tahu ONU ada di OLT mana
    const cachedOlt = oltManager.getOltFromMac(normalizedMac);
    
    if (cachedOlt) {
        // Cache hit - query specific OLT
        console.log(`[OLT] Cache hit for MAC ${normalizedMac}: ${cachedOlt.oltName}`);
        
        const oltDevice = oltManager.getOltDevice(cachedOlt.oltId);
        if (oltDevice) {
            const config = {
                host: oltDevice.host,
                port: oltDevice.snmpPort || 161,
                community: oltDevice.snmpCommunity || 'public',
                timeout: oltDevice.snmpTimeout || 10000,
                retries: oltDevice.snmpRetries || 1
            };

            const result = await resolveDriver(oltDevice).getSingleOnuData(config, slotId, onuId);

            // `success` saja BELUM cukup. OLT bisa menjawab tanpa menyebut ONU ini sama sekali,
            // dan hasil itu berbentuk `{status:'N/A', isLos:false, rxPower:'N/A'}` — berwajah modem
            // yang tak bermasalah. Jalur fallback di bawah sudah lama menyaring yang serupa; jalur
            // cache-hit — yang justru jalur normal karena cache MAC biasanya panas — dulu tidak.
            const readable = result.status === 'success'
                && result.data
                && result.data.statusKnown !== false;
            if (readable) {
                return result;
            }

            console.log(`[OLT] Cache hit but query failed/unreadable, falling back to query all OLTs`);
        }
    }
    
    // Cache miss atau query failed - query all OLTs
    console.log(`[OLT] Cache miss for MAC ${normalizedMac}, querying all OLTs...`);
    
    const oltDevices = oltManager.getOltDevices();
    
    // Query semua OLT secara parallel
    const promises = oltDevices.map(async (olt) => {
        const config = {
            host: olt.host,
            port: olt.snmpPort || 161,
            community: olt.snmpCommunity || 'public',
            timeout: olt.snmpTimeout || 10000,
            retries: olt.snmpRetries || 1
        };
        
        try {
            const result = await resolveDriver(olt).getSingleOnuData(config, slotId, onuId);
            if (result.status === 'success' && result.data && result.data.rxPower !== 'N/A') {
                // Found! Update cache
                oltManager.updateMacCache(normalizedMac, olt.id, olt.name, olt.host);
                oltManager.saveMacCache();
                
                console.log(`[OLT] Found ONT in ${olt.name}, updating cache`);
                return result;
            }
            return null;
        } catch (error) {
            console.error(`[OLT] Error querying ${olt.name}:`, error.message);
            return null;
        }
    });
    
    const results = await Promise.all(promises);
    
    // Return first successful result
    const successResult = results.find(r => r !== null);
    if (successResult) {
        return successResult;
    }
    
    // Tidak ditemukan di semua OLT
    return {
        status: 'error',
        message: 'Data ONT tidak ditemukan di semua OLT',
        data: null
    };
}

module.exports = {
    getOltData,
    getSingleOnuData,
    getMultipleOltData,
    getSingleOnuDataWithCache,
    matchOltWithCustomers,
    matchMAC,
    normalizeMAC,
    formatMacAddress,
};
