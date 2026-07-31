/**
 * Header Doc
 * Purpose: Resolver "pelanggan → ONU optik" — memetakan satu record pelanggan ke ONU-nya di
 *          snapshot OLT lalu merangkum data optik (rxPower/redaman), status (Online/LOS/Dying
 *          Gasp/Offline), identitas slot/onu/pon, dan merk/host OLT. Mengekstrak logika matching
 *          yang sebelumnya inline di `routes/olt.js` (GET /matched) menjadi satu sumber kebenaran
 *          yang dapat dipakai ulang (dashboard OLT + bot Telegram teknisi) dan dapat di-unit-test
 *          tanpa SNMP. Best-effort & READ-ONLY: tidak pernah throw, tidak menulis state apa pun
 *          (write-back cache tetap milik pemanggil, mis. routes/olt.js).
 * Caller: `routes/olt.js` (GET /matched, via buildOnuIndex+matchOnu) dan
 *         `message/telegram/command-handlers/*` (via resolveByCustomer/getOltSnapshot).
 * Deps (default, lazy-require agar test ringan): `./olt-hioso` (normalizeMAC, getMultipleOltData),
 *       `./olt-manager` (getOltDevices, getOltFromMac), `./olt-log-scraper` (normalizeMAC,
 *       getEventByMAC), file `database/last-caller-id-cache.json` (MAC/slot/onu terakhir per PPPoE).
 * MainFuncs: `buildOnuIndex`, `matchOnu`, `isRxPowerValid`, `createOpticalResolver`, `getOltSnapshot`,
 *            `resolveByCustomer`.
 * SideEffects: getOltSnapshot memanggil driver OLT (SNMP) — sudah di-cache TTL + single-flight agar
 *       tidak membebani/mengunci OLT. Selain itu murni.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CALLER_ID_CACHE_FILE = path.join(__dirname, "..", "database", "last-caller-id-cache.json");

// ---- default deps (lazy) -------------------------------------------------

function lazyOltHioso() {
    return require("./olt-hioso");
}
function lazyOltManager() {
    return require("./olt-manager");
}
function lazyLogScraper() {
    return require("./olt-log-scraper");
}

// Loader caller-id cache file (mtime-cached, hemat I/O) — bentuk:
// { [pppoe_username]: { mac, timestamp, slot_id?, onu_id? } }
let _callerCache = null;
let _callerCacheMtimeMs = 0;
function defaultLoadCallerIdCache() {
    try {
        const stat = fs.statSync(CALLER_ID_CACHE_FILE);
        if (_callerCache && stat.mtimeMs === _callerCacheMtimeMs) return _callerCache;
        const parsed = JSON.parse(fs.readFileSync(CALLER_ID_CACHE_FILE, "utf8"));
        _callerCache = parsed && typeof parsed === "object" ? parsed : {};
        _callerCacheMtimeMs = stat.mtimeMs;
        return _callerCache;
    } catch (__e) {
        return _callerCache || {};
    }
}

// ---- inti matching (dipakai bersama route + resolver) --------------------

/**
 * Bangun indeks lookup ONU dari daftar onu satu snapshot OLT.
 * Mirror persis logika di routes/olt.js: EPON via MAC-prefix(>=10), GPON via
 * deskripsi(PPPoE, harus mengandung '@') dan serial. Semua key lower-case.
 * @returns {{oltByMac:Object, oltByPppoe:Object, oltBySerial:Object}}
 */
function buildOnuIndex(onus, opts = {}) {
    const normalizeMAC = opts.normalizeMAC || lazyOltHioso().normalizeMAC;
    const oltByMac = {};
    const oltByPppoe = {};
    const oltBySerial = {};

    (Array.isArray(onus) ? onus : []).forEach((onu) => {
        if (!onu) return;
        const normalizedMac = normalizeMAC(onu.macAddress);
        if (normalizedMac && normalizedMac.length >= 10) {
            oltByMac[normalizedMac.substring(0, 10)] = onu;
        }
        if (onu.description && String(onu.description).includes("@")) {
            oltByPppoe[String(onu.description).trim().toLowerCase()] = onu;
        }
        if (onu.serial) {
            oltBySerial[String(onu.serial).trim().toLowerCase()] = onu;
        }
    });

    return { oltByMac, oltByPppoe, oltBySerial };
}

/**
 * Cocokkan satu user ke ONU di indeks. Prioritas brand-agnostik (sama dgn route):
 * deskripsi(=PPPoE) → serial → MAC-prefix(EPON). `macInfo` ({mac,source}) disediakan
 * pemanggil (route punya cache in-memory sendiri; resolver pakai default file-based).
 * @returns {{onu:(object|null), source:('pppoe'|'serial'|'mac'|null)}}
 */
function matchOnu(user, { index, macInfo = null } = {}, opts = {}) {
    if (!user || !user.pppoe_username || !index) return { onu: null, source: null };
    const normalizeMAC = opts.normalizeMAC || lazyOltHioso().normalizeMAC;

    const pppoeKey = String(user.pppoe_username).trim().toLowerCase();
    let onu = index.oltByPppoe[pppoeKey] || null;
    let source = onu ? "pppoe" : null;

    if (!onu && user.olt_serial) {
        onu = index.oltBySerial[String(user.olt_serial).trim().toLowerCase()] || null;
        if (onu) source = "serial";
    }

    if (!onu && macInfo && macInfo.mac) {
        const userMacPrefix = normalizeMAC(macInfo.mac).substring(0, 10);
        onu = index.oltByMac[userMacPrefix] || null;
        if (onu) source = "mac";
    }

    return { onu, source };
}

// ---- kesahihan pembacaan optik ------------------------------------------

/**
 * Apakah angka rxPower boleh dibaca sebagai PENGUKURAN SAAT INI?
 *
 * OLT EPON tetap melaporkan rxPower terakhir untuk ONU yang sudah mati — nilainya tidak dikosongkan
 * saat sinyal hilang. Tanpa penjagaan ini, ONU LOS tampil dengan angka redaman yang wajar (bahkan
 * "bagus"), dan pembacanya — dashboard, bot teknisi, laporan pasca-perbaikan — menyimpulkan
 * pelanggan itu sehat padahal justru dia yang mati.
 *
 * `statusKnown === false` berarti walk phaseState tidak menyebut ONU ini (walk SNMP setengah jadi);
 * merk selain HIOSO belum tentu mengirim field itu, jadi hanya `false` eksplisit yang dianggap
 * "tak diketahui".
 *
 * @param {object|null} onu ONU dari snapshot OLT
 * @param {string} status status final (setelah koreksi log scraper, bila ada)
 * @returns {boolean}
 */
function isRxPowerValid(onu, status) {
    if (!onu) return false;
    if (onu.statusKnown === false) return false;
    if (String(status) !== "Online") return false;
    return Number.isFinite(parseFloat(onu.rxPower));
}

// ---- snapshot OLT ber-cache (anti spam SNMP/lock OLT) --------------------

const SNAPSHOT_TTL_MS = 30000;
let _snapshot = { at: 0, data: null, inflight: null };

/**
 * Ambil snapshot semua OLT (getMultipleOltData) dengan cache TTL + single-flight,
 * supaya banyak perintah /redaman /olt yang datang bersamaan tidak menembak OLT
 * berkali-kali (catatan: sebagian OLT mengunci bila spam koneksi).
 * @returns {Promise<{status:string, timestamp?:any, onus:Array, oltResults?:Array, message?:string}>}
 */
async function getOltSnapshot(opts = {}) {
    const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : SNAPSHOT_TTL_MS;
    const forceRefresh = opts.forceRefresh === true;
    const getDevices = opts.getDevices || (() => lazyOltManager().getOltDevices());
    const getOltData = opts.getOltData || ((devices) => lazyOltHioso().getMultipleOltData(devices));
    const now = opts.now || Date.now();

    if (!forceRefresh && _snapshot.data && now - _snapshot.at < ttlMs) {
        return _snapshot.data;
    }
    if (_snapshot.inflight) {
        return _snapshot.inflight;
    }

    _snapshot.inflight = (async () => {
        try {
            const devices = getDevices() || [];
            const result = await getOltData(devices);
            if (result && result.status === "success") {
                _snapshot = { at: Date.now(), data: result, inflight: null };
            } else {
                _snapshot.inflight = null;
            }
            return result || { status: "error", onus: [], message: "no data" };
        } catch (e) {
            _snapshot.inflight = null;
            return { status: "error", onus: [], message: e.message };
        }
    })();

    return _snapshot.inflight;
}

// ---- resolver tingkat-tinggi (1 pelanggan, untuk bot) --------------------

function emptyResult(macInfo = null, identifiable = false) {
    return {
        matched: false,
        identifiable,
        source: null,
        macInfo,
        onu: null,
        rxPower: "N/A",
        // Tak ada ONU di snapshot → tak ada pembacaan yang boleh dianggap kondisi kini.
        rxPowerValid: false,
        status: identifiable ? "Offline" : "unknown",
        isLos: false,
        isDyingGasp: false,
        lastDownCause: null,
        macOlt: "N/A",
        serial: null,
        description: null,
        ponName: null,
        slotId: null,
        onuId: null,
        oltId: null,
        oltName: null,
        oltHost: null,
        oltBrand: null,
        logEvent: null,
        logTimestamp: null,
    };
}

/**
 * Factory resolver. Semua dependency dapat diinjeksi untuk test (tanpa SNMP/FS).
 * @param {object} deps
 * @returns {{ resolveByCustomer: function, getOltSnapshot: function }}
 */
function createOpticalResolver(deps = {}) {
    const loadCallerCache = deps.loadCallerIdCache || defaultLoadCallerIdCache;
    const getEventByMAC = deps.getEventByMAC || ((mac) => lazyLogScraper().getEventByMAC(mac));
    const normalizeForEvent = deps.normalizeForEvent || ((mac) => lazyLogScraper().normalizeMAC(mac));
    const normalizeMAC = deps.normalizeMAC || lazyOltHioso().normalizeMAC;
    const getOltFromMac = deps.getOltFromMac || ((mac) => lazyOltManager().getOltFromMac(mac));

    // MAC pelanggan: dari sesi aktif (kalau ada) → cache file (last known).
    const getMacForUser =
        deps.getMacForUser ||
        function defaultGetMacForUser(pppoeUsername, pppoeActive) {
            if (Array.isArray(pppoeActive)) {
                const active = pppoeActive.find((s) => s && s.name === pppoeUsername);
                if (active && active.caller_id) return { mac: active.caller_id, source: "active" };
            }
            const cache = loadCallerCache() || {};
            const known = cache[pppoeUsername];
            if (known && known.mac) return { mac: known.mac, source: "cached" };
            return null;
        };

    const getCachedInfo =
        deps.getCachedInfo ||
        function defaultGetCachedInfo(pppoeUsername) {
            const cache = loadCallerCache() || {};
            return cache[pppoeUsername] || null;
        };

    /**
     * Resolve satu pelanggan ke ONU optik dari snapshot OLT.
     * @param {object} user - record pelanggan (butuh pppoe_username; opsional olt_serial)
     * @param {object} ctx  - { oltSnapshot?:{onus:[]}, pppoeActive?:[] }
     * @returns {object} ringkasan optik (lihat emptyResult untuk bentuk field)
     */
    function resolveByCustomer(user, ctx = {}) {
        if (!user || !user.pppoe_username) return emptyResult(null, false);

        const onus = (ctx.oltSnapshot && ctx.oltSnapshot.onus) || [];
        const pppoeActive = ctx.pppoeActive || [];
        const index = buildOnuIndex(onus, { normalizeMAC });

        const macInfo = getMacForUser(user.pppoe_username, pppoeActive);
        const { onu, source } = matchOnu(user, { index, macInfo }, { normalizeMAC });

        // Tidak ada cara identifikasi sama sekali → tidak teridentifikasi.
        if (!onu && !macInfo) return emptyResult(null, false);

        if (onu) {
            // ONU ditemukan di OLT — upgrade status offline pakai log scraper (lebih akurat).
            const logEvent = safeCall(() => getEventByMAC(onu.macAddress));
            let status = onu.status;
            let isDyingGasp = onu.isDyingGasp;
            let isLos = onu.isLos;
            if (onu.status !== "Online" && logEvent) {
                if (logEvent.event_type === "dying-gasp") {
                    status = "Dying Gasp";
                    isDyingGasp = true;
                    isLos = false;
                } else if (logEvent.event_type === "los") {
                    status = "LOS";
                    isDyingGasp = false;
                    isLos = true;
                }
            }
            return {
                matched: true,
                identifiable: true,
                source,
                macInfo: macInfo || null,
                onu,
                rxPower: onu.rxPower,
                // Angka di atas bisa jadi pembacaan TERAKHIR dari ONU yang sudah mati (OLT EPON tak
                // mengosongkannya). Pemanggil WAJIB memakai flag ini sebelum menyimpulkan apa pun.
                rxPowerValid: isRxPowerValid(onu, status),
                status,
                isLos,
                isDyingGasp,
                lastDownCause: onu.lastDownCause != null ? onu.lastDownCause : null,
                macOlt: onu.macAddress,
                serial: onu.serial || null,
                description: onu.description || null,
                ponName: onu.ponName || null,
                slotId: onu.slotId != null ? onu.slotId : null,
                onuId: onu.id != null ? onu.id : null,
                oltId: onu.olt_id || null,
                oltName: onu.olt_name || null,
                oltHost: onu.olt_host || null,
                oltBrand: onu.olt_brand || null,
                logEvent: logEvent ? logEvent.event_type : null,
                logTimestamp: logEvent ? logEvent.timestamp : null,
            };
        }

        // ONU tidak ada di snapshot, tapi MAC dikenal → kemungkinan offline/LOS/Dying Gasp.
        const macNorm = safeCall(() => normalizeForEvent(macInfo.mac));
        const logEvent = macNorm ? safeCall(() => getEventByMAC(macNorm)) : null;
        const cachedInfo = getCachedInfo(user.pppoe_username) || null;
        const cachedOlt = safeCall(() => getOltFromMac(macInfo.mac)) || null;

        let status = "Offline";
        let isLos = false;
        let isDyingGasp = false;
        if (logEvent) {
            if (logEvent.event_type === "dying-gasp") {
                status = "Dying Gasp";
                isDyingGasp = true;
            } else if (logEvent.event_type === "los") {
                status = "LOS";
                isLos = true;
            }
        }

        const result = emptyResult(macInfo, true);
        return {
            ...result,
            status,
            isLos,
            isDyingGasp,
            slotId: cachedInfo && cachedInfo.slot_id != null ? cachedInfo.slot_id : null,
            onuId: cachedInfo && cachedInfo.onu_id != null ? cachedInfo.onu_id : null,
            oltId: cachedOlt ? cachedOlt.oltId : null,
            oltName: cachedOlt ? cachedOlt.oltName : null,
            oltHost: cachedOlt ? cachedOlt.oltHost : null,
            logEvent: logEvent ? logEvent.event_type : null,
            logTimestamp: logEvent ? logEvent.timestamp : null,
        };
    }

    return { resolveByCustomer, getOltSnapshot };
}

// Bungkus pemanggilan dep eksternal agar best-effort (tak pernah throw ke pemanggil).
function safeCall(fn) {
    try {
        return fn();
    } catch (__e) {
        return null;
    }
}

// Instance default (dipakai bot Telegram runtime).
const _default = createOpticalResolver();

module.exports = {
    buildOnuIndex,
    matchOnu,
    isRxPowerValid,
    createOpticalResolver,
    getOltSnapshot,
    resolveByCustomer: _default.resolveByCustomer,
    CALLER_ID_CACHE_FILE,
    _resetSnapshot: () => {
        _snapshot = { at: 0, data: null, inflight: null };
    },
    _resetCallerCache: () => {
        _callerCache = null;
        _callerCacheMtimeMs = 0;
    },
};
