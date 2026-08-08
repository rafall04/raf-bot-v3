/**
 * Header Doc
 * Purpose: Service device GenieACS untuk alur PSB — daftar/normalisasi device, KANDIDAT modem utk
 *          wizard DM (registrasi baru + bootstrap ulang/factory-reset + modem polos `tes@hw` yang
 *          sedang online — tiga jalur, supaya modem BEKAS terlihat tanpa harus menghapus record di
 *          GenieACS), pencarian bebas sadar-bentuk-stiker, dan push konfigurasi.
 * Caller: `message/handlers/state-domains/psb.state.js` (wizard), `routes/api-psb-routes.js`,
 *         `routes/api.js`, `services/api-psb.service.js`.
 * Deps: `lib/genieacs` (queryDevices/getPsbDevice/updatePsbDeviceConfig/diagnostics),
 *       `lib/psb-genieacs-filter` (normalisasi + filter murni + pencocokan SN stiker↔heksa).
 * MainFuncs: `findRecentPsbCandidates`, `findPsbCandidatesByHint`, `listPsbDevices`, `findPsbDevice`,
 *            `getDevicesForImport`, `updatePsbDeviceConfig`, `testPsbConnections`.
 * SideEffects: HTTP ke GenieACS (read; push hanya via updatePsbDeviceConfig).
 */
const {
    queryDevices,
    getPsbDevice,
    updatePsbDeviceConfig,
    getGenieAcsDiagnostics,
} = require('./genieacs');
const {
    normalizeGenieAcsPsbDevice,
    filterNormalizedPsbDevices,
    summarizePsbDevices,
    psbCandidateMatchesHint,
    isDefaultPppoeUsername,
} = require('./psb-genieacs-filter');

function extractParameterValue(device, parameterType) {
    const { getParameterPaths, getNestedValue, unwrapValue } = require('./genieacs');
    const paths = getParameterPaths(parameterType);
    for (const path of paths) {
        const value = unwrapValue(getNestedValue(device, path));
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return null;
}

async function fetchAllPsbDevices({ projection, query = {}, pageSize = 500, maxDevices = 5000, timeoutMs = 20000, operation = 'psb.fetchAll' } = {}) {
    const devices = [];
    let skip = 0;

    while (devices.length < maxDevices) {
        const limit = Math.min(pageSize, maxDevices - devices.length);
        const result = await queryDevices({
            query,
            projection,
            limit,
            skip,
            timeoutMs,
            operation,
        });
        if (!result.ok) {
            return result;
        }

        const batch = Array.isArray(result.data) ? result.data : [];
        devices.push(...batch);
        if (batch.length < limit) {
            return {
                ok: true,
                devices,
                truncated: false,
            };
        }
        skip += batch.length;
    }

    return {
        ok: true,
        devices,
        truncated: true,
    };
}

async function findPsbDevice(deviceId, options = {}) {
    const result = await getPsbDevice(deviceId, {
        ...options,
        operation: options.operation || 'psb.findDevice',
    });
    if (!result.ok) {
        return result;
    }

    return {
        ok: true,
        data: {
            deviceId: result.data.deviceId,
            serialNumber: result.data.serialNumber,
            model: result.data.model,
            manufacturer: result.data.manufacturer,
            currentPPPUsername: result.data.currentPPPUsername,
        },
        message: result.message,
        errorCode: result.errorCode,
        details: result.details,
    };
}

// Subtree WAN utuh ikut diproyeksikan supaya pemindai PPPoE lintas-index (lib/genieacs) punya
// bahan — leaf path config hanya menunjuk index 1, padahal modem dgn WAN TR-069 terpisah
// menaruh PPPoE pelanggan di index lain (insiden Dander 2026-08-07: by-PPPoE buta).
const PPPOE_SCAN_PROJECTION = [
    'InternetGatewayDevice.WANDevice',
    'Device.WANDevice',
    'Device.PPP.Interface',
];

async function listPsbDevices(filters = {}, options = {}) {
    const projection = [
        '_id',
        'Device.DeviceInfo',
        'InternetGatewayDevice.DeviceInfo',
        'VirtualParameters',
        ...PPPOE_SCAN_PROJECTION,
        ...require('./genieacs').resolvePathTemplates('pppoeUsername'),
        '_registered',
        'Events.Registered',
        '_lastInform',
    ];

    const fetched = await fetchAllPsbDevices({
        projection,
        query: {},
        pageSize: options.pageSize || 500,
        maxDevices: options.maxDevices || 5000,
        timeoutMs: options.timeoutMs || 30000,
        operation: options.operation || 'psb.listDevices',
    });

    if (!fetched.ok) {
        return fetched;
    }

    const normalized = fetched.devices
        .map((device) => normalizeGenieAcsPsbDevice(device, extractParameterValue, { allowLastInformFallback: false }))
        .filter((device) => !!device.deviceId)
        .sort((a, b) => {
            const leftTimestamp = a.registeredTimestamp || (a.lastInform ? Date.parse(a.lastInform) : 0) || 0;
            const rightTimestamp = b.registeredTimestamp || (b.lastInform ? Date.parse(b.lastInform) : 0) || 0;
            return rightTimestamp - leftTimestamp;
        });

    const summary = summarizePsbDevices(normalized);
    const filtered = filterNormalizedPsbDevices(normalized, {
        filterType: filters.filterType || 'default',
        serialNumberFilter: filters.serialNumberFilter || null,
        pppoeUsernameFilter: filters.pppoeUsernameFilter || null,
        now: filters.now || Date.now(),
    });

    return {
        ok: true,
        data: filtered,
        summary,
        normalizedCount: normalized.length,
        fetchedCount: fetched.devices.length,
        truncated: fetched.truncated,
    };
}

// Kandidat modem PSB untuk wizard DM — TIGA jalur deteksi digabung (dedup per deviceId):
//   1) `registered`      — device BARU pertama kali kontak ke ACS (`_registered >= cutoff`).
//   2) `reset`           — device LAMA yang baru kirim "0 BOOTSTRAP" (`_lastBootstrap >= cutoff`).
//                          JALUR CADANGAN, BUKAN ANDALAN. Diukur di ACS Dander 2026-08-08 (160
//                          device): 103 device TIDAK punya `_lastBootstrap` sama sekali, dan pada 57
//                          sisanya nilainya SAMA PERSIS dengan `_registered` — nol kasus field itu
//                          bergerak setelah registrasi. Artinya di ACS ini jalur 2 tak pernah
//                          memunculkan kandidat yang belum ditangkap jalur 1. Dipertahankan karena
//                          murah & benar secara semantik bila ACS mulai mengisinya, TAPI jangan
//                          pernah menjanjikan "factory reset → muncul di daftar" ke teknisi.
//                          Yang TERBUKTI menemukan modem bekas: pencarian SN (`cari`, sadar stiker).
//   3) `default-online`  — device yang SEDANG inform dengan PPPoE bawaan `tes@hw`: modem bekas yang
//                          kredensialnya di-set ulang manual (tanpa factory reset → tak ada BOOTSTRAP).
// Tiap kandidat diberi `detectedVia` + `detectedAtIso` supaya layar teknisi jujur ("reg/reset/online
// X mnt lalu"). Hasil diurut stempel deteksi TERBARU dulu. `nowMs` bisa di-inject untuk test.
async function findRecentPsbCandidates({ windowMinutes = 120, limit = 12, nowMs = Date.now(), timeoutMs = 15000 } = {}) {
    const cutoffMs = nowMs - Math.max(1, windowMinutes) * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const projection = [
        '_id',
        '_registered',
        '_lastBootstrap',
        '_lastInform',
        'Device.DeviceInfo',
        'InternetGatewayDevice.DeviceInfo',
        'VirtualParameters',
        ...PPPOE_SCAN_PROJECTION,
        ...require('./genieacs').resolvePathTemplates('pppoeUsername'),
    ];

    // Jalur 1+2 dalam SATU query `$or`. Fallback: bila ACS menolak `$or` (versi tua), ulangi query
    // lama `_registered` saja — wizard tak boleh mati karena kemampuan query ACS.
    let result = await queryDevices({
        query: { $or: [{ _registered: { $gte: cutoffIso } }, { _lastBootstrap: { $gte: cutoffIso } }] },
        projection,
        limit,
        timeoutMs,
        operation: 'psb.recentCandidates',
    });
    if (!result.ok) {
        result = await queryDevices({
            query: { _registered: { $gte: cutoffIso } },
            projection,
            limit,
            timeoutMs,
            operation: 'psb.recentCandidates.legacy',
        });
    }
    if (!result.ok) {
        return result;
    }

    const tagCandidate = (device) => {
        // Urutan label: registrasi baru menang atas reset (device baru juga BOOTSTRAP saat kontak
        // pertama — bagi teknisi itu "modem baru", bukan "modem di-reset").
        if (typeof device.registeredTimestamp === 'number' && device.registeredTimestamp >= cutoffMs) {
            return { ...device, detectedVia: 'registered', detectedAtIso: device.registeredDate };
        }
        if (typeof device.lastBootstrapTimestamp === 'number' && device.lastBootstrapTimestamp >= cutoffMs) {
            return { ...device, detectedVia: 'reset', detectedAtIso: device.lastBootstrap };
        }
        return null;
    };

    const primary = (Array.isArray(result.data) ? result.data : [])
        .map((device) => normalizeGenieAcsPsbDevice(device, extractParameterValue, { allowLastInformFallback: false }))
        .filter((device) => !!device.deviceId)
        .map(tagCandidate)
        .filter(Boolean);

    // Jalur 3: modem polos (`tes@hw`) yang masih rajin inform. Best-effort — gagal baca jalur ini
    // tak boleh menjatuhkan jalur 1+2 (kandidat yang sudah ada tetap dikembalikan).
    let defaultOnline = [];
    try {
        const informResult = await queryDevices({
            query: { _lastInform: { $gte: cutoffIso } },
            projection,
            limit: 500,
            timeoutMs,
            operation: 'psb.defaultOnlineCandidates',
        });
        if (informResult.ok) {
            defaultOnline = (Array.isArray(informResult.data) ? informResult.data : [])
                .map((device) => normalizeGenieAcsPsbDevice(device, extractParameterValue, { allowLastInformFallback: false }))
                .filter((device) => !!device.deviceId
                    && (isDefaultPppoeUsername(device.currentPPPUsername)
                        || (Array.isArray(device.allPPPUsernames) && device.allPPPUsernames.some(isDefaultPppoeUsername))))
                .map((device) => ({ ...device, detectedVia: 'default-online', detectedAtIso: device.lastInform }));
        }
    } catch (_e) { /* best-effort */ }

    const byDeviceId = new Map();
    for (const candidate of [...primary, ...defaultOnline]) {
        if (!byDeviceId.has(candidate.deviceId)) byDeviceId.set(candidate.deviceId, candidate);
    }
    const merged = [...byDeviceId.values()]
        .sort((a, b) => (Date.parse(b.detectedAtIso) || 0) - (Date.parse(a.detectedAtIso) || 0))
        .slice(0, Math.max(1, limit));

    return {
        ok: true,
        data: merged,
        cutoff: cutoffIso,
        windowMinutes,
        count: merged.length,
    };
}

// Cari modem dari SATU kata kunci bebas — teknisi tak perlu tahu ini SN atau nama.
// Dicocokkan (case-insensitive, SADAR-BENTUK-STIKER via psbCandidateMatchesHint) ke: serial number,
// device id, dan username PPPoE yang SEDANG tertulis di modem. PPPoE itu kunci modem copotan: modem
// bekas masih membawa username pemilik lama, jadi mengetik "wimpi" menemukannya walau pelanggannya
// sudah dihapus. SN boleh diketik persis seperti STIKER (`HWTC49B734AD`, lengkap maupun potongan) —
// konversi ke bentuk 16-heksa ACS terjadi di pencocokan, bukan tugas teknisi.
// Sengaja cari-lalu-pilih: salah ketik hanya menghasilkan "tak ketemu", tak pernah menulis apa pun.
async function findPsbCandidatesByHint({ hint, limit = 10, timeoutMs = 30000 } = {}) {
    const q = String(hint || "").trim().toLowerCase();
    if (!q) {
        return { ok: false, message: "Kata kunci pencarian kosong.", errorCode: "EMPTY_HINT" };
    }

    // filterType 'all' = tanpa penyaringan bawaan; penyaringan OR dilakukan di sini karena
    // filter bawaan hanya mendukung satu kolom (AND), bukan "SN ATAU PPPoE".
    const result = await listPsbDevices({ filterType: "all" }, {
        timeoutMs,
        operation: "psb.searchByHint"
    });
    if (!result.ok) return result;

    const devices = Array.isArray(result.data) ? result.data : [];
    const matched = devices.filter((d) => psbCandidateMatchesHint(d, q));

    return {
        ok: true,
        data: matched.slice(0, limit),
        hint: q,
        matchedCount: matched.length,
        scannedCount: devices.length
    };
}

async function getDevicesForImport(registeredDeviceIds = new Set(), options = {}) {
    const result = await queryDevices({
        projection: [
            'Device.DeviceInfo',
            'InternetGatewayDevice.DeviceInfo',
            ...require('./genieacs').resolvePathTemplates('pppoeUsername'),
        ],
        limit: options.limit || 1000,
        timeoutMs: options.timeoutMs || 30000,
        operation: options.operation || 'psb.devicesForImport',
    });

    if (!result.ok) {
        return result;
    }

    const devices = (result.data || []).map((device) => ({
        deviceId: device._id,
        serialNumber: require('./genieacs').extractSerialNumber(device) || device._id,
        model: require('./genieacs').extractDeviceModel(device) || '-',
        manufacturer: require('./genieacs').extractDeviceManufacturer(device) || '-',
        pppUsername: require('./genieacs').extractPppoeUsername(device),
        isRegistered: registeredDeviceIds.has(device._id),
    }));

    return {
        ok: true,
        data: devices.filter((device) => !device.isRegistered),
        stats: {
            total: devices.length,
            registered: devices.filter((device) => device.isRegistered).length,
            available: devices.filter((device) => !device.isRegistered).length,
        },
    };
}

async function testPsbConnections(deviceId, options = {}) {
    return getGenieAcsDiagnostics({
        deviceId: deviceId || undefined,
        mode: deviceId ? 'device-read' : 'basic',
        timeoutMs: options.timeoutMs || 5000,
        context: options.context,
    });
}

module.exports = {
    findPsbDevice,
    listPsbDevices,
    findRecentPsbCandidates,
    findPsbCandidatesByHint,
    getDevicesForImport,
    updatePsbDeviceConfig,
    testPsbConnections,
};
