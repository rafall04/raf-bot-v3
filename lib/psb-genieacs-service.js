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

async function listPsbDevices(filters = {}, options = {}) {
    const projection = [
        '_id',
        'Device.DeviceInfo',
        'InternetGatewayDevice.DeviceInfo',
        'VirtualParameters',
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

// Kandidat modem PSB = device yang BARU registrasi ke ACS (recency via field root `_registered`).
// Dipakai wizard PSB DM: tunjukkan SN ke teknisi untuk dicocokkan dgn stiker modem SEBELUM push.
// Difilter server-side (`_registered >= cutoff`) → efisien; hasil diurut TERBARU dulu. `nowMs`
// bisa di-inject untuk test deterministik.
async function findRecentPsbCandidates({ windowMinutes = 120, limit = 12, nowMs = Date.now(), timeoutMs = 15000 } = {}) {
    const cutoffMs = nowMs - Math.max(1, windowMinutes) * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const projection = [
        '_id',
        '_registered',
        '_lastInform',
        'Device.DeviceInfo',
        'InternetGatewayDevice.DeviceInfo',
        'VirtualParameters',
        ...require('./genieacs').resolvePathTemplates('pppoeUsername'),
    ];

    const result = await queryDevices({
        query: { _registered: { $gte: cutoffIso } },
        projection,
        limit,
        timeoutMs,
        operation: 'psb.recentCandidates',
    });
    if (!result.ok) {
        return result;
    }

    const devices = Array.isArray(result.data) ? result.data : [];
    const normalized = devices
        .map((device) => normalizeGenieAcsPsbDevice(device, extractParameterValue, { allowLastInformFallback: false }))
        .filter((device) => !!device.deviceId && !!device.registeredTimestamp)
        .sort((a, b) => (b.registeredTimestamp || 0) - (a.registeredTimestamp || 0));

    return {
        ok: true,
        data: normalized,
        cutoff: cutoffIso,
        windowMinutes,
        count: normalized.length,
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
    getDevicesForImport,
    updatePsbDeviceConfig,
    testPsbConnections,
};
