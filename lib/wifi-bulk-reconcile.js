/**
 * Header Doc
 * Purpose: Tentukan SSID yang wajar dikelola pelanggan (kolom `bulk`) dari kapabilitas
 *          band modem di GenieACS, dan deteksi pelanggan yang `bulk`-nya tidak sinkron
 *          (mis. modem dual-band HG8145V5 tapi bulk tanpa SSID 5).
 * Caller: `routes/users.js` (GET /api/users/bulk-diff, POST /api/users/sync-bulk, dan
 *         POST /api/users/sync-device-ids untuk auto-heal bulk saat device diganti).
 * Deps: `lib/genieacs` (queryDevices, getDeviceById, getNestedValue, unwrapValue, extractDeviceModel).
 * MainFuncs: normalizeBulk, deviceHas5G, expectedBulkFromDevice, bulkMatchesExpected,
 *            fetchDeviceCapability, scanBulkDiff.
 * SideEffects: Hanya membaca GenieACS — tidak menulis apa pun.
 */
'use strict';

const {
    queryDevices,
    getDeviceById,
    getNestedValue,
    unwrapValue,
    extractDeviceModel,
} = require('./genieacs');

const WLAN_BASE = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration';
// Index 1 = WiFi 2.4GHz utama, index 5 = WiFi 5GHz utama (pola Huawei HG8145V5/HG8245H5).
const SSID_24G_INDEX = '1';
const SSID_5G_INDEX = '5';

function ssidPresent(deviceRecord, index) {
    const value = unwrapValue(getNestedValue(deviceRecord, `${WLAN_BASE}.${index}.SSID`));
    return value !== undefined && value !== null && value !== '';
}

function deviceHas5G(deviceRecord) {
    return ssidPresent(deviceRecord, SSID_5G_INDEX);
}

/**
 * bulk yang diharapkan berdasarkan band perangkat:
 * - dual-band (punya WLANConfiguration.5) → ['1','5']
 * - single-band → ['1']
 */
function expectedBulkFromDevice(deviceRecord) {
    return deviceHas5G(deviceRecord) ? [SSID_24G_INDEX, SSID_5G_INDEX] : [SSID_24G_INDEX];
}

/**
 * Nama model yang aman ditampilkan. `extractDeviceModel` kadang mengembalikan objek
 * (path TR-069 tanpa `_value`) sehingga jadi "[object Object]" di UI — fallback ke
 * segmen tengah device_id Huawei (format OUI-MODEL-SERIAL, mis. `00259E-HG8145V5-xxxx`).
 */
function resolveModel(deviceRecord, deviceId) {
    const raw = extractDeviceModel(deviceRecord);
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    const segments = String(deviceId || '').split('-');
    return segments.length >= 2 && segments[1] ? segments[1] : '-';
}

function normalizeBulk(bulk) {
    if (Array.isArray(bulk)) return bulk.map((x) => String(x).trim()).filter(Boolean);
    if (typeof bulk === 'string' && bulk.trim()) {
        try {
            const parsed = JSON.parse(bulk);
            if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
        } catch (_) {
            // bukan JSON valid — fallback ke format CSV lama.
        }
        return bulk.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return [];
}

function sortedUnique(list) {
    return [...new Set(list)].sort();
}

function bulkMatchesExpected(currentBulk, expectedBulk) {
    const a = sortedUnique(normalizeBulk(currentBulk));
    const b = sortedUnique(normalizeBulk(expectedBulk));
    return a.length === b.length && a.every((value, idx) => value === b[idx]);
}

const DEVICE_INFO_PROJECTION = [
    '_id',
    'InternetGatewayDevice.DeviceInfo',
    'Device.DeviceInfo',
    `${WLAN_BASE}.${SSID_24G_INDEX}.SSID`,
    `${WLAN_BASE}.${SSID_5G_INDEX}.SSID`,
];

/**
 * Ambil kapabilitas band satu device dari GenieACS. Dipakai sync-device-ids untuk
 * auto-heal bulk saat device pelanggan diganti. Best-effort: kalau gagal/NOT_FOUND,
 * kembalikan `{ found:false }` supaya caller bisa skip tanpa menggagalkan operasi utama.
 */
async function fetchDeviceCapability(deviceId, options = {}) {
    if (!deviceId) return { found: false, deviceId: null };
    const result = await getDeviceById(deviceId, DEVICE_INFO_PROJECTION, {
        operation: options.operation || 'wifiBulkReconcile.capability',
        timeoutMs: options.timeoutMs,
    });
    if (!result.ok || !result.data) {
        return { found: false, deviceId };
    }
    return {
        found: true,
        deviceId,
        model: resolveModel(result.data, deviceId),
        has5G: deviceHas5G(result.data),
        expectedBulk: expectedBulkFromDevice(result.data),
    };
}

/**
 * Scan seluruh pelanggan: bandingkan kolom `bulk` dengan kapabilitas band modem.
 * Mengembalikan daftar `different` (bulk perlu disesuaikan) + statistik. Read-only.
 */
async function scanBulkDiff(users = [], options = {}) {
    const withDevice = (users || []).filter((u) => u && u.device_id && String(u.device_id).trim());
    const deviceIds = [...new Set(withDevice.map((u) => String(u.device_id).trim()))];

    const different = [];
    let sameCount = 0;
    let notFoundCount = 0;

    if (deviceIds.length === 0) {
        return { different, stats: { total: 0, different: 0, same: 0, notFound: 0 } };
    }

    const response = await queryDevices({
        query: { _id: { $in: deviceIds } },
        projection: DEVICE_INFO_PROJECTION,
        limit: options.limit || 5000,
        timeoutMs: options.timeoutMs || 30000,
        operation: 'wifiBulkReconcile.scan',
    });
    if (!response.ok) {
        throw new Error(response.message || 'Gagal mengambil data perangkat dari GenieACS.');
    }
    const deviceMap = new Map((response.data || []).map((device) => [device._id, device]));

    for (const user of withDevice) {
        const device = deviceMap.get(String(user.device_id).trim());
        if (!device) {
            notFoundCount += 1;
            continue;
        }
        const expectedBulk = expectedBulkFromDevice(device);
        const currentBulk = normalizeBulk(user.bulk);
        if (bulkMatchesExpected(currentBulk, expectedBulk)) {
            sameCount += 1;
            continue;
        }
        different.push({
            id: user.id,
            name: user.name,
            device_id: user.device_id,
            model: resolveModel(device, user.device_id),
            has5G: deviceHas5G(device),
            current_bulk: currentBulk,
            expected_bulk: expectedBulk,
        });
    }

    return {
        different,
        stats: {
            total: withDevice.length,
            different: different.length,
            same: sameCount,
            notFound: notFoundCount,
        },
    };
}

module.exports = {
    WLAN_BASE,
    SSID_24G_INDEX,
    SSID_5G_INDEX,
    normalizeBulk,
    deviceHas5G,
    expectedBulkFromDevice,
    resolveModel,
    bulkMatchesExpected,
    fetchDeviceCapability,
    scanBulkDiff,
};
