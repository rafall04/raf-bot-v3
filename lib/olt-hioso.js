/**
 * OLT HIOSO SNMP Library
 * Library untuk query data ONT dari OLT HIOSO via SNMP
 * 
 * Data yang diambil:
 * - MAC Address ONT
 * - RX Power (Redaman) dalam dBm
 * - Status ONT (Online/Offline)
 * - Dying Gasp indicator
 * - LOS (Loss of Signal) indicator
 */

const snmp = require('net-snmp');

// OID Map untuk HIOSO OLT
// Berdasarkan HIOSO MIB documentation dan testing
const HIOSO_OID = {
    enterpriseRoot: '1.3.6.1.4.1.25355',
    system: {
        hiosoRoot: '1.3.6.1.4.1.25355.3.1',
        ipAddress: '1.3.6.1.4.1.25355.3.1.1.0',
        subnetMask: '1.3.6.1.4.1.25355.3.1.2.0',
        gateway: '1.3.6.1.4.1.25355.3.1.3.0',
        firmwareVersion: '1.3.6.1.4.1.25355.3.1.8.1.1.2.1',
        mib2Root: '1.3.6.1.2.1.1',
        sysDescr: '1.3.6.1.2.1.1.1.0',
        sysName: '1.3.6.1.2.1.1.5.0',
    },
    onu: {
        name: '1.3.6.1.4.1.25355.3.2.6.3.2.1.37',
        mac: '1.3.6.1.4.1.25355.3.2.6.3.2.1.11',
        // Phase State: 1=working/online, 2=LOS/offline, 3=syncMib, 4=authFail, 5=offline
        phaseState: '1.3.6.1.4.1.25355.3.2.6.3.2.1.39',
        // Dying Gasp flag (tidak reliable, gunakan lastDownCause)
        dyingGasp: '1.3.6.1.4.1.25355.3.2.6.3.2.1.40',
        // Last Down Cause - KUNCI untuk membedakan LOS vs Dying Gasp:
        // 0 = Normal / No down
        // 1 = Power failure / Dying Gasp (adaptor mati)
        // 2 = LOS (Loss of Signal - fiber putus)
        // 3 = LOF (Loss of Frame)
        // 4 = LOA (Loss of Ack)
        // 5 = Deactivate
        lastDownCause: '1.3.6.1.4.1.25355.3.2.6.3.2.1.41',
        rxPower: '1.3.6.1.4.1.25355.3.2.6.14.2.1.8',
        txPower: '1.3.6.1.4.1.25355.3.2.6.14.2.1.4',
        distance: '1.3.6.1.4.1.25355.3.2.6.3.2.1.25',
    }
};

// Last Down Cause values
// CATATAN: Berdasarkan testing, OLT HIOSO tidak membedakan LOS vs Dying Gasp
// Kedua kondisi (fiber dicabut dan adaptor mati) menghasilkan lastDownCause = 1
// Jadi kita tidak bisa membedakan keduanya melalui SNMP

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
 * Parse RX Power ke format dBm
 * @param {string|number} value - Nilai dari SNMP
 * @returns {string} Nilai dalam format "X.XX dBm" atau "N/A"
 */
function parseRxPower(value) {
    if (value === 'N/A' || value === null || value === undefined) return 'N/A';
    
    const parsedValue = parseFloat(value);
    if (isNaN(parsedValue)) return 'N/A';
    
    return parsedValue.toFixed(2) + ' dBm';
}

/**
 * Get ONU ID dari OID
 * Format OID: {baseOid}.{X}.{slot}.{onu}
 * @param {string} oid - Full OID string
 * @returns {string} ONU ID (bagian terakhir)
 */
function getOnuIdFromOid(oid) {
    const parts = oid.split('.');
    return parts[parts.length - 1];
}

/**
 * Get Slot ID dari OID
 * Format OID: {baseOid}.{X}.{slot}.{onu}
 * @param {string} oid - Full OID string
 * @returns {string} Slot ID (bagian kedua dari belakang)
 */
function getSlotIdFromOid(oid) {
    const parts = oid.split('.');
    if (parts.length >= 2) {
        return parts[parts.length - 2];
    }
    return 'UNKNOWN';
}

/**
 * Get full suffix dari OID (untuk query yang akurat)
 * Format OID: {baseOid}.{X}.{slot}.{onu}
 * @param {string} oid - Full OID string
 * @param {string} baseOid - Base OID yang digunakan
 * @returns {string} Full suffix (X.slot.onu)
 */

/**
 * Perform SNMP Walk dengan session
 * @param {Object} session - SNMP session
 * @param {string} baseOid - Base OID untuk walk
 * @param {number} maxOids - Maximum OIDs to collect
 * @returns {Promise<Array>} Array of {oid, value, type}
 */
async function performSnmpWalk(session, baseOid, maxOids = 5000) {
    return new Promise((resolve, reject) => {
        const results = [];
        let lastOid = '';
        const MAX_SAME_OID_REPEATS = 3;
        let sameOidRepeatCount = 0;

        const feedCb = (varbinds) => {
            if (results.length >= maxOids) {
                resolve(results);
                return;
            }

            for (let i = 0; i < varbinds.length; i++) {
                const varbind = varbinds[i];
                
                if (varbind.type === snmp.ObjectType.EndOfMibView || 
                    varbind.type === snmp.ObjectType.NoSuchObject || 
                    varbind.type === snmp.ObjectType.NoSuchInstance) {
                    resolve(results);
                    return;
                }

                if (varbind.oid === lastOid) {
                    sameOidRepeatCount++;
                    if (sameOidRepeatCount >= MAX_SAME_OID_REPEATS) {
                        reject(new Error(`OID loop detected at ${varbind.oid}`));
                        return;
                    }
                } else {
                    sameOidRepeatCount = 0;
                    lastOid = varbind.oid;
                }

                const normalizedBaseOid = baseOid.startsWith('.') ? baseOid.substring(1) : baseOid;
                const normalizedVarbindOid = varbind.oid.startsWith('.') ? varbind.oid.substring(1) : varbind.oid;

                if (!normalizedVarbindOid.startsWith(normalizedBaseOid)) {
                    resolve(results);
                    return;
                }

                let value = null;
                if (varbind.value !== null && varbind.value !== undefined) {
                    if (varbind.type === snmp.ObjectType.OctetString) {
                        try {
                            let strValue = varbind.value.toString('utf8');
                            strValue = strValue.replace(/[\x00-\x1F\x7F-\x9F]/g, '').trim();
                            if (strValue.toLowerCase() === 'na' || strValue === '') {
                                value = 'N/A';
                            } else {
                                value = strValue;
                            }
                        } catch (_e) {
                            value = varbind.value.toString('hex');
                        }
                    } else if (varbind.type === snmp.ObjectType.TimeTicks) {
                        value = parseInt(varbind.value.toString(), 10) / 100;
                    } else {
                        value = varbind.value.toString();
                    }
                }

                results.push({
                    oid: varbind.oid,
                    value: value,
                    type: snmp.ObjectType[varbind.type] || 'UNKNOWN_TYPE'
                });
            }
        };

        const doneCb = (error) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        };

        session.walk(baseOid, feedCb, doneCb);
    });
}

/**
 * Get OLT data via SNMP
 * @param {Object} config - OLT configuration {host, port, community, timeout, retries}
 * @returns {Promise<Object>} OLT data with ONUs
 */
async function getOltData(config) {
    const { host, port = 161, community = 'public', timeout = 15000, retries = 2 } = config;

    if (!host) {
        return {
            status: 'error',
            message: 'Host OLT tidak dikonfigurasi',
            onus: [],
            systemInfo: {}
        };
    }

    const session = snmp.createSession(host, community, {
        version: snmp.Version2c,
        timeout: timeout,
        retries: retries,
        port: port
    });

    // Timeout promise
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('SNMP request timeout after 60 seconds'));
        }, 60000);
    });

    const dataPromise = new Promise(async (resolve) => {
        let sessionClosed = false;
        
        const closeSession = () => {
            if (!sessionClosed && session) {
                sessionClosed = true;
                try {
                    session.close();
                } catch (_e) {
                    // Ignore close errors
                }
            }
        };

        session.on('error', (err) => {
            closeSession();
            resolve({
                status: 'error',
                message: `Gagal koneksi SNMP: ${err.message}`,
                onus: [],
                systemInfo: {}
            });
        });

        try {
            const oltData = {
                status: 'success',
                timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                systemInfo: {},
                onus: []
            };

            // Build promises for SNMP walks
            const promises = [
                performSnmpWalk(session, HIOSO_OID.onu.mac).catch(() => []),
                performSnmpWalk(session, HIOSO_OID.onu.rxPower).catch(() => []),
                performSnmpWalk(session, HIOSO_OID.onu.phaseState).catch(() => []),
                performSnmpWalk(session, HIOSO_OID.onu.lastDownCause).catch(() => []),
                performSnmpWalk(session, HIOSO_OID.onu.name).catch(() => []),
            ];

            const results = await Promise.all(promises);
            const [
                onuMacResults,
                onuRxPowerResults,
                onuPhaseStateResults,
                onuLastDownCauseResults,
                onuNameResults
            ] = results;

            // Build ONU map
            const onuMap = new Map();

            const getOrCreateOnu = (oid) => {
                const onuId = getOnuIdFromOid(oid);
                const slotId = getSlotIdFromOid(oid);
                const key = `${slotId}_${onuId}`;
                
                if (!onuMap.has(key)) {
                    onuMap.set(key, {
                        id: onuId,
                        slotId: slotId,
                        name: 'N/A',
                        macAddress: 'N/A',
                        status: 'N/A',
                        isLos: false,
                        isDyingGasp: false,
                        lastDownCause: null,
                        rxPower: 'N/A'
                    });
                }
                return onuMap.get(key);
            };

            // Process MAC addresses
            onuMacResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                const formattedMac = formatMacAddress(item.value);
                if (formattedMac !== 'N/A' && formattedMac.length === 17) {
                    onu.macAddress = formattedMac;
                }
            });

            // Process RX Power
            onuRxPowerResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                onu.rxPower = parseRxPower(item.value);
            });

            // Process Phase State: 1=working/online, 2=LOS/offline, 3=syncMib, 4=authFail, 5=offline
            // PENTING: phaseState = 2 bisa berarti LOS atau Dying Gasp
            // Gunakan lastDownCause untuk membedakan
            onuPhaseStateResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                onu.phaseStateRaw = item.value;
                switch (item.value) {
                    case '1':
                        onu.status = 'Online';
                        break;
                    case '2':
                        // Sementara set sebagai Offline, akan di-finalize berdasarkan lastDownCause
                        onu.status = 'Offline';
                        break;
                    case '3':
                        onu.status = 'Sync';
                        break;
                    case '4':
                        onu.status = 'Auth Fail';
                        break;
                    case '5':
                    default:
                        onu.status = 'Offline';
                        break;
                }
            });

            // Process Last Down Cause - KUNCI untuk membedakan LOS vs Dying Gasp
            // 0 = Normal, 1 = Power failure (Dying Gasp), 2 = LOS, dll
            onuLastDownCauseResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                onu.lastDownCause = item.value;
            });

            // Process Names
            onuNameResults.forEach(item => {
                const onu = getOrCreateOnu(item.oid);
                if (item.value && item.value !== 'N/A') {
                    onu.name = item.value;
                }
            });

            // Finalize status berdasarkan phaseState dan lastDownCause
            // CATATAN: OLT HIOSO tidak membedakan LOS vs Dying Gasp melalui SNMP
            // Kedua kondisi menghasilkan phaseState=2 dan lastDownCause=1
            // Jadi kita gunakan status generik "LOS" untuk semua kondisi offline
            onuMap.forEach(onu => {
                if (onu.phaseStateRaw === '2') {
                    // ONT offline - tidak bisa membedakan LOS vs Dying Gasp
                    onu.isDyingGasp = false;
                    onu.isLos = true;
                    onu.status = 'LOS';
                }
            });

            // Convert map to array and sort
            oltData.onus = Array.from(onuMap.values())
                .filter(onu => onu.macAddress !== 'N/A') // Only include ONUs with valid MAC
                .sort((a, b) => {
                    const slotA = parseInt(a.slotId) || 0;
                    const slotB = parseInt(b.slotId) || 0;
                    if (slotA !== slotB) return slotA - slotB;
                    return parseInt(a.id) - parseInt(b.id);
                });

            closeSession();
            resolve(oltData);

        } catch (error) {
            closeSession();
            resolve({
                status: 'error',
                message: `Error processing data: ${error.message}`,
                onus: [],
                systemInfo: {}
            });
        }
    });

    try {
        return await Promise.race([dataPromise, timeoutPromise]);
    } catch (error) {
        if (session && !session.isClosed) {
            try { session.close(); } catch (_e) { /* ignore */ }
        }
        return {
            status: 'error',
            message: error.message,
            onus: [],
            systemInfo: {}
        };
    }
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
async function getSingleOnuData(config, slotId, onuId) {
    const { host, port = 161, community = 'public', timeout = 10000, retries = 1 } = config;

    if (!host || !slotId || !onuId) {
        return {
            status: 'error',
            message: 'Parameter tidak lengkap (host, slotId, onuId diperlukan)',
            data: null
        };
    }

    const targetSlotId = String(slotId);
    const targetOnuId = String(onuId);
    const targetKey = `${targetSlotId}.${targetOnuId}`;
    
    console.log(`[OLT] getSingleOnuData: slot=${targetSlotId}, onu=${targetOnuId}, key=${targetKey}`);

    const session = snmp.createSession(host, community, {
        version: snmp.Version2c,
        timeout: timeout,
        retries: retries,
        port: port
    });

    // Timeout promise
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error('SNMP request timeout after 20 seconds'));
        }, 20000);
    });

    const dataPromise = new Promise(async (resolve) => {
        let sessionClosed = false;
        
        const closeSession = () => {
            if (!sessionClosed && session) {
                sessionClosed = true;
                try { session.close(); } catch (_e) { /* ignore */ }
            }
        };

        session.on('error', (err) => {
            closeSession();
            resolve({
                status: 'error',
                message: `Gagal koneksi SNMP: ${err.message}`,
                data: null
            });
        });

        try {
            // Walk semua OID yang diperlukan menggunakan performSnmpWalk (sama seperti getOltData)
            const promises = [
                performSnmpWalk(session, HIOSO_OID.onu.rxPower, 2000).catch(() => []),
                performSnmpWalk(session, HIOSO_OID.onu.phaseState, 2000).catch(() => []),
                performSnmpWalk(session, HIOSO_OID.onu.lastDownCause, 2000).catch(() => [])
            ];

            const [rxPowerResults, phaseStateResults, lastDownCauseResults] = await Promise.all(promises);

            closeSession();

            console.log(`[OLT] Walk results: rxPower=${rxPowerResults.length}, phaseState=${phaseStateResults.length}, lastDownCause=${lastDownCauseResults.length}`);

            const result = {
                rxPower: 'N/A',
                status: 'N/A',
                isLos: false,
                isDyingGasp: false,
                lastDownCause: null
            };

            // Helper untuk cek apakah OID match dengan target slot.onu
            const isTargetOnu = (oid) => {
                const parts = oid.split('.');
                const onuIdFromOid = parts[parts.length - 1];
                const slotIdFromOid = parts[parts.length - 2];
                return slotIdFromOid === targetSlotId && onuIdFromOid === targetOnuId;
            };

            // Process RX Power - cari yang match dengan target
            for (const item of rxPowerResults) {
                if (isTargetOnu(item.oid)) {
                    result.rxPower = parseRxPower(item.value);
                    console.log(`[OLT] Found rxPower for ${targetKey}: ${result.rxPower}`);
                    break;
                }
            }

            // Process Phase State
            let phaseStateValue = null;
            for (const item of phaseStateResults) {
                if (isTargetOnu(item.oid)) {
                    phaseStateValue = item.value;
                    switch (item.value) {
                        case '1':
                            result.status = 'Online';
                            break;
                        case '2':
                            // Sementara set sebagai Offline, akan di-finalize berdasarkan lastDownCause
                            result.status = 'Offline';
                            break;
                        case '3':
                            result.status = 'Sync';
                            break;
                        case '4':
                            result.status = 'Auth Fail';
                            break;
                        case '5':
                        default:
                            result.status = 'Offline';
                            break;
                    }
                    console.log(`[OLT] Found phaseState for ${targetKey}: ${item.value}`);
                    break;
                }
            }

            // Process Last Down Cause
            for (const item of lastDownCauseResults) {
                if (isTargetOnu(item.oid)) {
                    result.lastDownCause = item.value;
                    console.log(`[OLT] Found lastDownCause for ${targetKey}: ${item.value}`);
                    break;
                }
            }
            
            // Finalize status berdasarkan phaseState
            // CATATAN: OLT HIOSO tidak membedakan LOS vs Dying Gasp melalui SNMP
            // Kedua kondisi menghasilkan phaseState=2 dan lastDownCause=1
            // Jadi kita gunakan status generik "LOS" untuk semua kondisi offline
            if (phaseStateValue === '2') {
                // ONT offline - tidak bisa membedakan LOS vs Dying Gasp
                result.isDyingGasp = false;
                result.isLos = true;
                result.status = 'LOS';
                console.log(`[OLT] ${targetKey}: LOS/Offline (phaseState=2)`);
            }

            console.log(`[OLT] Final result for ${targetKey}:`, result);

            resolve({
                status: 'success',
                timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
                data: result
            });

        } catch (error) {
            closeSession();
            console.error(`[OLT] Error in getSingleOnuData:`, error);
            resolve({
                status: 'error',
                message: error.message,
                data: null
            });
        }
    });

    try {
        return await Promise.race([dataPromise, timeoutPromise]);
    } catch (error) {
        if (session && !session.isClosed) {
            try { session.close(); } catch (_e) { /* ignore */ }
        }
        return {
            status: 'error',
            message: error.message,
            data: null
        };
    }
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
                systemInfo: result.systemInfo || {}
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
                systemInfo: {}
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
    
    return {
        status: 'success',
        timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        onus: allOnus,
        systemInfo: {},
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

            if (result.status === 'success') {
                return result;
            }
            
            console.log(`[OLT] Cache hit but query failed, falling back to query all OLTs`);
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
    HIOSO_OID
};
