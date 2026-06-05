/**
 * Header Doc
 * Purpose: Driver brand ZTE C320/C300 (GPON, ZXAN MIB enterprise 3902) sesuai kontrak OltDriver.
 *          Ambil ONU (serial, deskripsi=PPPoE, status online/LOS/dying-gasp, rx power) via SNMP native.
 * Caller: lib/olt-drivers/index.js (registry).
 * Deps: ./snmp-util, ./contract.
 * MainFuncs: getOltData, getSingleOnuData, testConnection, matchIdentity, + helper parsing (__test).
 * SideEffects: sesi SNMP UDP sementara.
 *
 * Peta OID berasal dari discovery C320 V2.1.0 asli — lihat docs/olt-zte-c320-snmp-map.md.
 * ⚠️ Dua konstanta masih PROVISIONAL (perlu kalibrasi via CLI OLT), ditandai TODO di bawah:
 *    - RX_POWER scale (RX_POWER_DIVISOR / sign)
 *    - ZTE_OFFLINE_CAUSE enum (kode LOS vs Dying Gasp)
 */

const { snmpGet, snmpWalk } = require('./snmp-util');
const { defaultCapabilities, IDENTIFIER, normalizeOnu } = require('./contract');

// ── OID map (ZXAN GPON) ──────────────────────────────────────────────────────
const OID = {
    sysObjectID: '1.3.6.1.2.1.1.2.0',
    sysDescr: '1.3.6.1.2.1.1.1.0',
    ifName: '1.3.6.1.2.1.31.1.1.1.1',                  // <ifIndex> → "gpon_1/2/1"
    // Tabel info ONU: ...28.1.1.<col>.<ponIfIndex>.<onuId>
    onuModel: '1.3.6.1.4.1.3902.1012.3.28.1.1.1',      // "F609"
    onuDescr: '1.3.6.1.4.1.3902.1012.3.28.1.1.2',      // = username PPPoE (key matching)
    onuPortName: '1.3.6.1.4.1.3902.1012.3.28.1.1.3',   // "ONU-1:1"
    onuSerial: '1.3.6.1.4.1.3902.1012.3.28.1.1.5',     // OctetString 8B: "ZTEG"+4hex
    // Tabel status ONU: ...28.2.1.<col>.<ponIfIndex>.<onuId>
    onuPhaseState: '1.3.6.1.4.1.3902.1012.3.28.2.1.3', // 6=online, 0=offline
    onuOfflineReason: '1.3.6.1.4.1.3902.1012.3.28.2.1.7',
    // Optik DDM: ...50.12.1.1.<col>.<ponIfIndex>.<onuId>.1
    onuRxPower: '1.3.6.1.4.1.3902.1012.3.50.12.1.1.10',
};

const ENTERPRISE = '3902';

// ── Konstanta PROVISIONAL (TODO: kalibrasi via CLI OLT) ───────────────────────
// Dugaan dari discovery: raw 2593→-25.93, 1276→-12.76 dBm. Verifikasi vs
// `show gpon onu detail-info ...` lalu sesuaikan divisor/sign bila perlu.
const RX_POWER_DIVISOR = 100;
const RX_POWER_NEGATE = true;

// Enum penyebab offline ZTE (zxGponOnuLastOfflineCause-ish). Histogram: 9 dominan
// pada ONU online (=tidak offline). 1/2/3/5 muncul pada ONU offline.
// ⚠️ Mapping ini DUGAAN — perlu konfirmasi kode mana LOS vs Dying Gasp.
const ZTE_OFFLINE_CAUSE = {
    1: { label: 'unknown', isLos: false, isDyingGasp: false },
    2: { label: 'LOS', isLos: true, isDyingGasp: false },
    3: { label: 'LOSi', isLos: true, isDyingGasp: false },
    4: { label: 'LOFi', isLos: true, isDyingGasp: false },
    5: { label: 'dying-gasp', isLos: false, isDyingGasp: true },
    9: { label: 'none', isLos: false, isDyingGasp: false },
};

// ── Helper parsing (di-export untuk test) ─────────────────────────────────────

/**
 * Serial GPON ZTE dari OctetString 8 byte: 4 byte ASCII vendor ("ZTEG") + 4 byte hex.
 * @param {Buffer|null} buf
 * @returns {string|null} mis. "ZTEGD5D42874"
 */
function formatZteSerial(buf) {
    if (!buf || !Buffer.isBuffer(buf) || buf.length === 0) return null;
    if (buf.length === 8) {
        const vendor = buf.slice(0, 4).toString('ascii').replace(/[^\x20-\x7E]/g, '');
        const hex = buf.slice(4, 8).toString('hex').toUpperCase();
        return vendor + hex;
    }
    // Fallback: SN full-ASCII atau panjang lain.
    const ascii = buf.toString('ascii').replace(/[^\x20-\x7E]/g, '').trim();
    return ascii || buf.toString('hex').toUpperCase();
}

/**
 * RX power dari raw integer → "X.XX dBm" atau "N/A".
 * @param {number|string|null} raw
 */
function parseRxPower(raw) {
    if (raw === null || raw === undefined || raw === '') return 'N/A';
    const n = parseInt(raw, 10);
    // 0 / 65535 / nilai sentinel = tidak ada pembacaan (ONU offline / no DDM).
    if (Number.isNaN(n) || n <= 0 || n >= 65535) return 'N/A';
    let dbm = n / RX_POWER_DIVISOR;
    if (RX_POWER_NEGATE) dbm = -dbm;
    return dbm.toFixed(2) + ' dBm';
}

/**
 * Klasifikasi status ONU dari phaseState (+ offlineReason saat offline).
 * @param {number|string} phaseState  6=online, 0=offline
 * @param {number|string|null} offlineReason
 * @returns {{status:string, isLos:boolean, isDyingGasp:boolean, lastDownCause:(number|null)}}
 */
function classifyStatus(phaseState, offlineReason) {
    const phase = parseInt(phaseState, 10);
    if (phase === 6) {
        return { status: 'Online', isLos: false, isDyingGasp: false, lastDownCause: null };
    }
    // Offline (phase 0 atau lainnya). Gunakan offlineReason untuk LOS vs Dying Gasp.
    const cause = offlineReason != null ? parseInt(offlineReason, 10) : null;
    const mapped = cause != null ? ZTE_OFFLINE_CAUSE[cause] : null;
    if (mapped && mapped.isDyingGasp) {
        return { status: 'Dying Gasp', isLos: false, isDyingGasp: true, lastDownCause: cause };
    }
    if (mapped && mapped.isLos) {
        return { status: 'LOS', isLos: true, isDyingGasp: false, lastDownCause: cause };
    }
    return { status: 'Offline', isLos: false, isDyingGasp: false, lastDownCause: cause };
}

/**
 * Ekstrak index ONU dari OID. Index = <ponIfIndex>.<onuId>[.<sub>].
 * @returns {{pon:string, onu:string}|null}
 */
function extractIndex(oid, baseOid) {
    const base = baseOid.startsWith('.') ? baseOid.slice(1) : baseOid;
    const o = oid.startsWith('.') ? oid.slice(1) : oid;
    if (!o.startsWith(base + '.')) return null;
    const parts = o.slice(base.length + 1).split('.');
    if (parts.length < 2) return null;
    return { pon: parts[0], onu: parts[1] };
}

function rowsToMap(rows, baseOid) {
    const m = new Map();
    for (const r of rows) {
        const idx = extractIndex(r.oid, baseOid);
        if (idx) m.set(`${idx.pon}.${idx.onu}`, r);
    }
    return m;
}

// ── Driver API ────────────────────────────────────────────────────────────────

async function getOltData(config) {
    if (!config || !config.host) {
        return { status: 'error', message: 'Host OLT tidak dikonfigurasi', onus: [], systemInfo: {} };
    }
    try {
        const [descRows, serialRows, modelRows, portRows, phaseRows, reasonRows, rxRows] = await Promise.all([
            snmpWalk(config, OID.onuDescr).catch(() => []),
            snmpWalk(config, OID.onuSerial).catch(() => []),
            snmpWalk(config, OID.onuModel).catch(() => []),
            snmpWalk(config, OID.onuPortName).catch(() => []),
            snmpWalk(config, OID.onuPhaseState).catch(() => []),
            snmpWalk(config, OID.onuOfflineReason).catch(() => []),
            snmpWalk(config, OID.onuRxPower).catch(() => []),
        ]);

        const descMap = rowsToMap(descRows, OID.onuDescr);
        const serialMap = rowsToMap(serialRows, OID.onuSerial);
        const modelMap = rowsToMap(modelRows, OID.onuModel);
        const portMap = rowsToMap(portRows, OID.onuPortName); // "ONU-1:1" label human
        const phaseMap = rowsToMap(phaseRows, OID.onuPhaseState);
        const reasonMap = rowsToMap(reasonRows, OID.onuOfflineReason);
        const rxMap = rowsToMap(rxRows, OID.onuRxPower);

        // Union semua key ONU (paling lengkap dari phase/desc/serial).
        const keys = new Set([...phaseMap.keys(), ...descMap.keys(), ...serialMap.keys()]);

        const onus = [];
        for (const key of keys) {
            const [pon, onu] = key.split('.');
            const phaseRow = phaseMap.get(key);
            const reasonRow = reasonMap.get(key);
            const status = classifyStatus(
                phaseRow ? phaseRow.value : null,
                reasonRow ? reasonRow.value : null
            );
            const descRow = descMap.get(key);
            const serialRow = serialMap.get(key);
            const modelRow = modelMap.get(key);
            const portRow = portMap.get(key);
            const rxRow = rxMap.get(key);

            onus.push(normalizeOnu({
                id: onu,
                slotId: pon, // ponIfIndex (key internal); ponName = label human
                ponName: portRow && portRow.value ? portRow.value : null,
                name: modelRow && modelRow.value ? modelRow.value : 'N/A',
                description: descRow && descRow.value ? descRow.value : null,
                serial: serialRow ? formatZteSerial(serialRow.raw) : null,
                macAddress: 'N/A', // ZTE GPON: identitas via serial/description, bukan MAC
                status: status.status,
                isLos: status.isLos,
                isDyingGasp: status.isDyingGasp,
                lastDownCause: status.lastDownCause,
                rxPower: rxRow ? parseRxPower(rxRow.value) : 'N/A',
            }));
        }

        onus.sort((a, b) => (a.slotId === b.slotId
            ? (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0)
            : String(a.slotId).localeCompare(String(b.slotId))));

        return {
            status: 'success',
            timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            onus,
            systemInfo: {},
        };
    } catch (error) {
        return { status: 'error', message: `ZTE getOltData: ${error.message}`, onus: [], systemInfo: {} };
    }
}

async function getSingleOnuData(config, ponIfIndex, onuId) {
    if (!config || !config.host || ponIfIndex == null || onuId == null) {
        return { status: 'error', message: 'Parameter tidak lengkap (host, ponIfIndex, onuId)', data: null };
    }
    try {
        const suffix = `${ponIfIndex}.${onuId}`;
        const oids = {
            phase: `${OID.onuPhaseState}.${suffix}`,
            reason: `${OID.onuOfflineReason}.${suffix}`,
            rx: `${OID.onuRxPower}.${suffix}.1`,
        };
        const res = await snmpGet(config, Object.values(oids));
        const phase = res[oids.phase] ? res[oids.phase].value : null;
        const reason = res[oids.reason] ? res[oids.reason].value : null;
        const rx = res[oids.rx] ? res[oids.rx].value : null;
        const status = classifyStatus(phase, reason);
        return {
            status: 'success',
            timestamp: new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
            data: {
                rxPower: parseRxPower(rx),
                status: status.status,
                isLos: status.isLos,
                isDyingGasp: status.isDyingGasp,
                lastDownCause: status.lastDownCause,
            },
        };
    } catch (error) {
        return { status: 'error', message: `ZTE getSingleOnuData: ${error.message}`, data: null };
    }
}

async function testConnection(config) {
    try {
        const res = await snmpGet(config, [OID.sysObjectID, OID.sysDescr]);
        const soid = res[OID.sysObjectID] ? String(res[OID.sysObjectID].value) : '';
        const descr = res[OID.sysDescr] ? String(res[OID.sysDescr].value) : '';
        const isZte = soid.includes(`.4.1.${ENTERPRISE}.`) || /ZTE/i.test(descr);
        if (!isZte) {
            return { ok: false, message: `Bukan OLT ZTE (sysDescr="${descr.slice(0, 40)}")` };
        }
        return { ok: true, detectedBrand: 'zte', sysDescr: descr };
    } catch (error) {
        return { ok: false, message: error.message };
    }
}

/**
 * Matching GPON: deskripsi (=username PPPoE) dulu, fallback serial.
 * @param {string} identifier  username PPPoE (atau serial) dari sisi pelanggan
 * @param {import('./contract').OnuRecord} onu
 */
function matchIdentity(identifier, onu) {
    if (!identifier || !onu) return false;
    const id = String(identifier).trim().toLowerCase();
    if (onu.description && String(onu.description).trim().toLowerCase() === id) return true;
    if (onu.serial && String(onu.serial).trim().toLowerCase() === id) return true;
    return false;
}

const capabilities = {
    ...defaultCapabilities(),
    losViaSnmp: true,        // ZTE lapor penyebab offline via SNMP
    dyingGaspViaSnmp: true,
    needsWebScrape: false,   // tak perlu scraper/syslog seperti HIOSO
    needsSyslog: false,
    primaryIdentifier: IDENTIFIER.SERIAL, // native GPON; matchIdentity coba description→serial
};

module.exports = {
    brand: 'zte',
    label: 'ZTE C320/C300 GPON',
    enterpriseOids: [ENTERPRISE],
    capabilities,
    getOltData,
    getSingleOnuData,
    testConnection,
    matchIdentity,
    __test: { formatZteSerial, parseRxPower, classifyStatus, extractIndex, OID, ZTE_OFFLINE_CAUSE },
};
