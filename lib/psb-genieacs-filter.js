const { extractPppoeUsername } = require('./genieacs');

function unwrapParameterValue(value) {
    if (value && typeof value === 'object' && value._value !== undefined) {
        return value._value;
    }

    if (value && typeof value === 'object' && value.value !== undefined) {
        return value.value;
    }

    return value;
}

function normalizeStringValue(value) {
    const unwrapped = unwrapParameterValue(value);
    if (typeof unwrapped !== 'string') {
        return null;
    }

    const trimmed = unwrapped.trim();
    return trimmed || null;
}

function getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
        if (!current || typeof current !== 'object') {
            return undefined;
        }

        if (Object.prototype.hasOwnProperty.call(current, part)) {
            current = current[part];
            continue;
        }

        const lowerPart = part.toLowerCase();
        const foundKey = Object.keys(current).find((key) => key.toLowerCase() === lowerPart);
        if (!foundKey) {
            return undefined;
        }

        current = current[foundKey];
    }

    return current;
}

function getCurrentPppoeUsername(device) {
    return normalizeStringValue(extractPppoeUsername(device));
}

function isDefaultPppoeUsername(username) {
    return !!username && username.trim().toLowerCase() === 'tes@hw';
}

function parseGenieacsTimestamp(value) {
    const rawValue = unwrapParameterValue(value);

    if (rawValue === null || rawValue === undefined || rawValue === '') {
        return null;
    }

    if (rawValue instanceof Date) {
        const time = rawValue.getTime();
        return Number.isFinite(time) ? time : null;
    }

    if (typeof rawValue === 'number') {
        if (!Number.isFinite(rawValue) || rawValue <= 0) {
            return null;
        }
        return rawValue > 1000000000000 ? rawValue : rawValue * 1000;
    }

    if (typeof rawValue === 'string') {
        const parsed = Date.parse(rawValue);
        return Number.isFinite(parsed) ? parsed : null;
    }

    const parsed = Date.parse(String(rawValue));
    return Number.isFinite(parsed) ? parsed : null;
}

function getRegisteredInfo(device, options = {}) {
    const { allowLastInformFallback = false } = options;
    const registeredCandidate =
        getNestedValue(device, 'Events.Registered')
        ?? device['Events.Registered']
        ?? undefined;

    let registrationSource = null;
    let registeredTimestamp = parseGenieacsTimestamp(registeredCandidate);

    if (registeredTimestamp) {
        registrationSource = 'events_registered';
    } else if (allowLastInformFallback) {
        registeredTimestamp = parseGenieacsTimestamp(device._lastInform);
        if (registeredTimestamp) {
            registrationSource = 'last_inform';
        }
    }

    return {
        registeredTimestamp: registeredTimestamp || null,
        registeredDate: registeredTimestamp ? new Date(registeredTimestamp).toISOString() : null,
        registrationSource,
    };
}

function pickFirstString(...values) {
    for (const value of values) {
        const normalized = normalizeStringValue(value);
        if (normalized) {
            return normalized;
        }
    }
    return null;
}

function getDeviceSerialNumber(device, extractParameterValue) {
    return pickFirstString(
        getNestedValue(device, 'Device.DeviceInfo.SerialNumber'),
        getNestedValue(device, 'InternetGatewayDevice.DeviceInfo.SerialNumber'),
        typeof extractParameterValue === 'function' ? extractParameterValue(device, 'serialNumber') : null,
        getNestedValue(device, 'VirtualParameters.getSerialNumber'),
        getNestedValue(device, 'VirtualParameters.serialNumber'),
        device._serialNumber
    );
}

function normalizeGenieAcsPsbDevice(device, extractParameterValue, options = {}) {
    const currentPPPUsername = getCurrentPppoeUsername(device);
    const serialNumber = getDeviceSerialNumber(device, extractParameterValue);
    const model = pickFirstString(
        getNestedValue(device, 'Device.DeviceInfo.ModelName'),
        getNestedValue(device, 'InternetGatewayDevice.DeviceInfo.ModelName'),
        getNestedValue(device, 'Device.DeviceInfo.ProductClass'),
        getNestedValue(device, 'InternetGatewayDevice.DeviceInfo.ProductClass')
    );
    const manufacturer = pickFirstString(
        getNestedValue(device, 'Device.DeviceInfo.Manufacturer'),
        getNestedValue(device, 'InternetGatewayDevice.DeviceInfo.Manufacturer')
    );
    const registeredInfo = getRegisteredInfo(device, options);
    const lastInformTimestamp = parseGenieacsTimestamp(device._lastInform);

    return {
        deviceId: device && device._id ? String(device._id) : null,
        serialNumber: serialNumber || 'N/A',
        model: model || 'N/A',
        manufacturer: manufacturer || 'N/A',
        currentPPPUsername,
        lastInform: lastInformTimestamp ? new Date(lastInformTimestamp).toISOString() : null,
        registeredDate: registeredInfo.registeredDate,
        registeredTimestamp: registeredInfo.registeredTimestamp,
        registrationSource: registeredInfo.registrationSource,
    };
}

function filterNormalizedPsbDevices(devices, options = {}) {
    const {
        filterType = 'default',
        serialNumberFilter = null,
        pppoeUsernameFilter = null,
        now = Date.now(),
        newWindowMs = 86700000,
    } = options;

    const normalizedSerialFilter = typeof serialNumberFilter === 'string' && serialNumberFilter.trim()
        ? serialNumberFilter.trim().toLowerCase()
        : null;
    const normalizedPppoeFilter = typeof pppoeUsernameFilter === 'string' && pppoeUsernameFilter.trim()
        ? pppoeUsernameFilter.trim().toLowerCase()
        : null;

    let filtered = Array.isArray(devices) ? [...devices] : [];

    if (filterType === 'default') {
        filtered = filtered.filter((device) => isDefaultPppoeUsername(device.currentPPPUsername));
    } else if (filterType === 'new') {
        const threshold = now - newWindowMs;
        filtered = filtered.filter((device) =>
            typeof device.registeredTimestamp === 'number'
            && device.registeredTimestamp > threshold
        );
    } else if (filterType === 'by-pppoe' && normalizedPppoeFilter) {
        filtered = filtered.filter((device) =>
            typeof device.currentPPPUsername === 'string'
            && device.currentPPPUsername.toLowerCase().includes(normalizedPppoeFilter)
        );
    }

    if (normalizedSerialFilter) {
        filtered = filtered.filter((device) =>
            typeof device.serialNumber === 'string'
            && device.serialNumber.toLowerCase().includes(normalizedSerialFilter)
        );
    }

    return filtered;
}

function summarizePsbDevices(devices) {
    const normalizedDevices = Array.isArray(devices) ? devices : [];
    return {
        total: normalizedDevices.length,
        withoutPppoeUsername: normalizedDevices.filter((device) => !device.currentPPPUsername).length,
        withoutRegisteredDate: normalizedDevices.filter((device) => !device.registeredTimestamp).length,
    };
}

module.exports = {
    getCurrentPppoeUsername,
    isDefaultPppoeUsername,
    parseGenieacsTimestamp,
    getRegisteredInfo,
    getDeviceSerialNumber,
    normalizeGenieAcsPsbDevice,
    filterNormalizedPsbDevices,
    summarizePsbDevices,
};
