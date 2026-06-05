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
    // Kolom .10 (c10) = RX optical power ONU (downstream). Encoding dBm = raw/500 - 30,
    // DIVERIFIKASI vs CLI `show pon power attenuation` 4 ONU (lihat parseRxPower).
    // Kolom lain di tabel DDM ini: c24=Vcc (raw×0.1mV→3.3V), c18=suhu (raw/256°C).
    onuRxPower: '1.3.6.1.4.1.3902.1012.3.50.12.1.1.10',
};

const ENTERPRISE = '3902';

// Offset ifIndex ZTE: index pon di tabel ONU-mgmt = ifIndex gpon-olt + 0x10100.
// Verifikasi: pon 268567040 → ifName[268501248]="gpon_1/2/2"; pon 268566784 → "gpon_1/2/1".
const PON_IFINDEX_OFFSET = 0x10100; // 65792

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

// Rentang RX power fisik GPON. Dengan encoding raw/500-30, raw>0 selalu beri dBm>-30,
// jadi RX_MAX (buang nilai positif/sampah) yang utama. 65535 = no-signal (CLI "no signal").
const RX_MIN_DBM = -31;
const RX_MAX_DBM = 0;

/**
 * RX power ONU (downstream) dari raw → "X.XX dBm" atau "N/A".
 *
 * Encoding ZTE C320 DIVERIFIKASI terhadap CLI `show pon power attenuation` di 4 ONU:
 *   dBm = raw/500 - 30
 *   raw 3406→-23.188, 3741→-22.518, 5105→-19.790, 3584→-22.832 (semua cocok CLI).
 * raw 0 / 65535 = no-signal (ONU offline / DDM tak terbaca).
 * @param {number|string|null} raw
 */
function parseRxPower(raw) {
    if (raw === null || raw === undefined || raw === '') return 'N/A';
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n <= 0 || n >= 65535) return 'N/A'; // no-signal / sentinel
    const dbm = n / 500 - 30;
    if (dbm < RX_MIN_DBM || dbm > RX_MAX_DBM) return 'N/A'; // di luar rentang fisik = sampah
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

/**
 * SNMP walk ANDAL: ulangi seluruh walk bila error ATAU mengembalikan 0 baris,
 * sampai `maxAttempts`. Untuk tabel ONU ZTE (desc/serial/phase/rx) yang selalu
 * berisi ratusan baris, hasil 0 = kegagalan transport (satu trip timeout di
 * event-loop sibuk) — bukan tabel kosong. Mengulang seluruh walk memulihkannya.
 * @param {object} cfg
 * @param {string} oid
 * @param {number} maxAttempts
 * @returns {Promise<Array>} rows (mungkin [] bila semua percobaan gagal)
 */
async function reliableSnmpWalk(cfg, oid, maxAttempts = 3) {
    let last = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const rows = await snmpWalk(cfg, oid, { maxRepetitions: 30, cap: 8000 });
            if (rows.length > 0) return rows;
            last = rows;
        } catch (e) {
            // error transport → coba lagi
        }
    }
    return last;
}

/**
 * Jalankan kumpulan task (() => Promise) dengan batas konkurensi.
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} limit
 * @returns {Promise<any[]>} hasil terurut sesuai input
 */
async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let next = 0;
    async function worker() {
        while (next < tasks.length) {
            const idx = next++;
            results[idx] = await tasks[idx]();
        }
    }
    const n = Math.max(1, Math.min(limit, tasks.length));
    await Promise.all(Array.from({ length: n }, () => worker()));
    return results;
}

/**
 * Bangun map ponIfIndex → nama port gpon-olt ("gpon_1/2/2") dari ifName.
 * Index pon di tabel ONU-mgmt = ifIndex gpon-olt + PON_IFINDEX_OFFSET, jadi
 * ifName[pon - offset] = "gpon_1/2/2". Batch GET hanya pon unik (sedikit).
 * @param {string[]} keys  daftar "pon.onu"
 * @param {object} config
 * @returns {Promise<Map<string,string>>} pon → "gpon_x/y/z"
 */
async function buildPonLabelMap(keys, config) {
    const map = new Map();
    const pons = [...new Set(keys.map((k) => k.split('.')[0]))];
    if (pons.length === 0) return map;
    const oids = pons.map((p) => `${OID.ifName}.${Number(p) - PON_IFINDEX_OFFSET}`);
    try {
        const res = await snmpGet(config, oids);
        pons.forEach((p, i) => {
            const r = res[oids[i]];
            if (r && r.value && /gpon/i.test(r.value)) map.set(p, String(r.value).trim());
        });
    } catch (e) {
        // ifName gagal → label fallback dipakai (portName .28.1.1.3).
    }
    return map;
}

// ── Driver API ────────────────────────────────────────────────────────────────

async function getOltData(config) {
    if (!config || !config.host) {
        return { status: 'error', message: 'Host OLT tidak dikonfigurasi', onus: [], systemInfo: {} };
    }
    try {
        // Strategi transport ANDAL. Tiap walk = banyak round-trip getBulk (rx-power ~18 trip).
        // Di event-loop bot yang sibuk (WhatsApp/scraper/cron), SATU trip yang timeout bikin
        // SELURUH walk error → seluruh field itu hilang (mis. rx-power N/A semua). Karena itu:
        //   - retries per-request (net-snmp) untuk tahan packet-loss per trip,
        //   - reliableWalk: ULANGI seluruh walk bila kosong/error (sampai 3x) — kunci agar
        //     redaman tidak hilang total hanya karena satu trip telat,
        //   - konkurensi 3 supaya tidak banjir tapi tetap cepat.
        const walkCfg = { ...config, timeout: Math.min(config.timeout || 15000, 10000), retries: 2 };
        const reliableWalk = (oid) => reliableSnmpWalk(walkCfg, oid, 3);
        const [
            descRows, serialRows, modelRows, portRows, phaseRows, reasonRows, rxRows,
        ] = await runWithConcurrency([
            () => reliableWalk(OID.onuDescr),
            () => reliableWalk(OID.onuSerial),
            () => reliableWalk(OID.onuModel),
            () => reliableWalk(OID.onuPortName),
            () => reliableWalk(OID.onuPhaseState),
            () => reliableWalk(OID.onuOfflineReason),
            () => reliableWalk(OID.onuRxPower),
        ], 3);

        const descMap = rowsToMap(descRows, OID.onuDescr);
        const serialMap = rowsToMap(serialRows, OID.onuSerial);
        const modelMap = rowsToMap(modelRows, OID.onuModel);
        const portMap = rowsToMap(portRows, OID.onuPortName); // "ONU-1:1" label human
        const phaseMap = rowsToMap(phaseRows, OID.onuPhaseState);
        const reasonMap = rowsToMap(reasonRows, OID.onuOfflineReason);
        const rxMap = rowsToMap(rxRows, OID.onuRxPower);

        // Union semua key ONU (paling lengkap dari phase/desc/serial).
        const keys = new Set([...phaseMap.keys(), ...descMap.keys(), ...serialMap.keys()]);

        // Label PON penuh (gpon-onu_1/2/2:16) dari ifName port gpon-olt.
        const ponLabelMap = await buildPonLabelMap([...keys], config);

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

            // Label PON penuh "gpon-onu_1/2/2:16" (seperti CLI), fallback "ONU-2:16".
            const gponPort = ponLabelMap.get(pon); // "gpon_1/2/2"
            const ponName = gponPort
                ? gponPort.replace(/^gpon_/i, 'gpon-onu_') + ':' + onu
                : (portRow && portRow.value ? portRow.value : null);

            onus.push(normalizeOnu({
                id: onu,
                slotId: pon, // ponIfIndex (key internal); ponName = label human
                ponName,
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

        // Observability: ringkas coverage tiap field (deteksi walk yang gagal di log live).
        const onlineCount = onus.filter((o) => o.status === 'Online').length;
        const rxCount = onus.filter((o) => o.rxPower && o.rxPower !== 'N/A').length;
        console.log(`[ZTE] ${config.host}: ${onus.length} ONU | online=${onlineCount} | rxPower OK=${rxCount}`
            + ` | walkRows desc=${descRows.length} serial=${serialRows.length} phase=${phaseRows.length} rx=${rxRows.length}`);
        if (rxRows.length === 0 && onlineCount > 0) {
            console.warn(`[ZTE] ${config.host}: ⚠️ walk rx-power KOSONG padahal ada ${onlineCount} ONU online — redaman akan N/A (transport gagal).`);
        }

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
