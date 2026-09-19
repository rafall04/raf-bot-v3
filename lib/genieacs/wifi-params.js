/**
 * Header Doc
 * Purpose: Parameter WiFi GenieACS — parse payload, build parameter values, set SSID/password/transmit-power, bulk update.
 * Caller: facade `lib/genieacs.js` (re-export; jangan require langsung kecuali test).
 * Deps: ./session, ./device-read, ./reboot-verify.
 * MainFuncs: `parseWifiPayload`, `setWifiCredentials`, `setWifiName`, `setWifiPassword`, `updateWifiSettings`, `applyBulkWifiUpdates`.
 * SideEffects: sama seperti lib/genieacs.js asli (split #b393 — murni pemindahan kode).
 */
const { deriveObjectNameFromPath, resolvePathTemplates } = require('./device-read');
const { setParameterValues } = require('./reboot-verify');
const { createResult, logResult } = require('./session');

function parseWifiPayload(payload = {}) {
    const updatesBySsid = new Map();
    const getEntry = (index) => {
        const normalized = String(index);
        if (!updatesBySsid.has(normalized)) {
            updatesBySsid.set(normalized, {});
        }
        return updatesBySsid.get(normalized);
    };

    for (const [key, rawValue] of Object.entries(payload)) {
        const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
        let match = key.match(/^ssid_password_(\d+)$/);
        if (match) {
            if (typeof value === 'string' && value !== '') {
                getEntry(match[1]).password = value;
            }
            continue;
        }

        match = key.match(/^ssid_(\d+)$/);
        if (match) {
            if (typeof value === 'string' && value !== '') {
                getEntry(match[1]).name = value;
            }
        }
    }

    const legacySsidId = payload.ssid_id ? String(payload.ssid_id).trim() : '1';
    const legacyName = typeof payload.ssid_name === 'string' ? payload.ssid_name.trim() : '';
    const legacyPassword = typeof payload.password === 'string' ? payload.password.trim() : '';
    if (legacyName) getEntry(legacySsidId).name = legacyName;
    if (legacyPassword) getEntry(legacySsidId).password = legacyPassword;

    const transmitPower = typeof payload.transmit_power === 'string' ? payload.transmit_power.trim() : payload.transmit_power;
    if (transmitPower !== undefined && transmitPower !== null && transmitPower !== '') {
        if (updatesBySsid.size === 0) {
            getEntry(legacySsidId).transmitPower = transmitPower;
        } else {
            updatesBySsid.forEach((entry) => {
                entry.transmitPower = transmitPower;
            });
        }
    }

    const updates = Array.from(updatesBySsid.entries()).map(([ssidIndex, values]) => ({ ssidIndex, ...values }));
    return {
        updates,
        ssidIndices: updates.map((entry) => entry.ssidIndex),
        hasChanges: updates.length > 0,
    };
}


function buildWifiParameterValues(updates) {
    const parameterValues = [];
    const verificationPaths = [];
    const refreshObjects = new Set(resolvePathTemplates('wifiContainer'));

    updates.forEach((update) => {
        if (update.name) {
            const paths = resolvePathTemplates('wifiSsid', update.ssidIndex);
            paths.forEach((path) => {
                parameterValues.push([path, update.name, 'xsd:string']);
                verificationPaths.push({ path, expectedValue: update.name });
                refreshObjects.add(deriveObjectNameFromPath(path));
            });
        }

        if (update.password) {
            const paths = resolvePathTemplates('wifiPassword', update.ssidIndex);
            paths.forEach((path) => {
                parameterValues.push([path, update.password, 'xsd:string']);
                verificationPaths.push({ path, expectedValue: update.password, sensitive: true });
                refreshObjects.add(deriveObjectNameFromPath(path));
            });
        }

        if (update.transmitPower !== undefined && update.transmitPower !== null && update.transmitPower !== '') {
            const paths = resolvePathTemplates('wifiTransmitPower', update.ssidIndex);
            paths.forEach((path) => {
                parameterValues.push([path, update.transmitPower, 'xsd:string']);
                verificationPaths.push({ path, expectedValue: update.transmitPower });
                refreshObjects.add(deriveObjectNameFromPath(path));
            });
        }
    });

    return {
        parameterValues,
        verificationPaths,
        refreshObjects: [...refreshObjects],
    };
}


async function applyBulkWifiUpdates(deviceId, updates = [], options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'applyBulkWifiUpdates';
    const normalizedUpdates = Array.isArray(updates)
        ? updates
            .map((entry) => ({
                ssidIndex: entry?.ssidIndex !== undefined && entry?.ssidIndex !== null ? String(entry.ssidIndex).trim() : '',
                name: typeof entry?.name === 'string' ? entry.name : null,
                password: typeof entry?.password === 'string' ? entry.password : null,
                transmitPower: entry?.transmitPower,
            }))
            .filter((entry) => entry.ssidIndex && (entry.name || entry.password || entry.transmitPower !== undefined))
        : [];

    if (!normalizedUpdates.length) {
        return createResult(operation, {
            message: 'Tidak ada perubahan bulk WiFi yang dikirim.',
            errorCode: 'PARSE_ERROR',
            timingMs: Date.now() - startedAt,
        });
    }

    const { parameterValues, verificationPaths, refreshObjects } = buildWifiParameterValues(normalizedUpdates);
    const onlySensitiveChanges = verificationPaths.length > 0 && verificationPaths.every((entry) => entry.sensitive);
    const defaultVerificationMode = onlySensitiveChanges ? 'accept_task_only' : 'strict_readback';
    const result = await setParameterValues(deviceId, parameterValues, {
        ...options,
        operation,
        verificationPaths,
        refreshObjects,
        verificationMode: options.verificationMode || defaultVerificationMode,
        successMessage: options.successMessage || 'Task perubahan bulk WiFi berhasil dikirim ke GenieACS.',
    });

    result.data = {
        ...(result.data || {}),
        updates: normalizedUpdates.map((entry) => ({
            ssidIndex: entry.ssidIndex,
            hasName: Boolean(entry.name),
            hasPassword: Boolean(entry.password),
            hasTransmitPower: entry.transmitPower !== undefined,
        })),
    };
    result.timingMs = Date.now() - startedAt;
    logResult(result, options.context);
    return result;
}


async function setWifiCredentials(deviceId, ssidIndex, ssidName, password, options = {}) {
    const startedAt = Date.now();
    const operation = 'setWifiCredentials';
    const { parameterValues, verificationPaths, refreshObjects } = buildWifiParameterValues([
        { ssidIndex: String(ssidIndex), name: ssidName, password },
    ]);

    if (!parameterValues.length) {
        return createResult(operation, {
            message: 'Tidak ada perubahan WiFi yang dikirim.',
            errorCode: 'PARSE_ERROR',
            timingMs: Date.now() - startedAt,
        });
    }

    const onlySensitiveChanges = verificationPaths.every((entry) => entry.sensitive);
    const submitResult = await setParameterValues(deviceId, parameterValues, {
        ...options,
        operation,
        verificationPaths,
        refreshObjects,
        verificationMode: options.verifyApplied === false ? 'accept_task_only' : (onlySensitiveChanges ? 'accept_task_only' : 'strict_readback'),
        successMessage: 'Task perubahan WiFi berhasil dikirim ke GenieACS.',
    });

    submitResult.timingMs = Date.now() - startedAt;
    logResult(submitResult, options.context);
    return submitResult;
}


async function setWifiName(deviceId, ssidIndex, newName, options = {}) {
    return setWifiCredentials(deviceId, ssidIndex, newName, null, options);
}


async function setWifiPassword(deviceId, ssidIndex, newPassword, options = {}) {
    return setWifiCredentials(deviceId, ssidIndex, null, newPassword, options);
}


async function setWifiTransmitPower(deviceId, ssidIndex, level, options = {}) {
    const startedAt = Date.now();
    const operation = 'setWifiTransmitPower';
    const { parameterValues, verificationPaths, refreshObjects } = buildWifiParameterValues([
        { ssidIndex: String(ssidIndex), transmitPower: level },
    ]);

    const result = await setParameterValues(deviceId, parameterValues, {
        ...options,
        operation,
        verificationPaths,
        refreshObjects,
        verificationMode: options.verifyApplied === false ? 'accept_task_only' : 'strict_readback',
        successMessage: 'Task perubahan transmit power berhasil dikirim ke GenieACS.',
    });

    result.timingMs = Date.now() - startedAt;
    logResult(result, options.context);
    return result;
}


async function updateWifiSettings(deviceId, payload, options = {}) {
    const startedAt = Date.now();
    const operation = 'updateWifiSettings';
    const parsedPayload = parseWifiPayload(payload);
    if (!parsedPayload.hasChanges) {
        // Payload kosong = GAGAL, bukan sukses. Dulu ini balik `ok: true` sehingga
        // pemanggil yang cuma memeriksa `!result.ok` melapor "Berhasil!" ke pelanggan
        // padahal nol task dikirim ke GenieACS (kasus ganti sandi bulk_auto, lihat #b177).
        // Sekarang selaras dgn setParameterValuesInternal/setWifiCredentials/applyBulkWifiUpdates.
        const result = createResult(operation, {
            message: 'Tidak ada perubahan yang dikirim karena tidak ada data baru.',
            errorCode: 'PARSE_ERROR',
            data: { updates: [] },
            timingMs: Date.now() - startedAt,
        });
        logResult(result, options.context);
        return result;
    }

    const { parameterValues, verificationPaths, refreshObjects } = buildWifiParameterValues(parsedPayload.updates);
    const onlySensitiveChanges = verificationPaths.every((entry) => entry.sensitive);
    const submitResult = await setParameterValues(deviceId, parameterValues, {
        ...options,
        operation,
        verificationPaths,
        refreshObjects,
        verificationMode: options.verifyApplied === false ? 'accept_task_only' : (onlySensitiveChanges ? 'accept_task_only' : 'strict_readback'),
        successMessage: 'Task perubahan WiFi berhasil dikirim ke GenieACS.',
    });

    submitResult.data = {
        ...(submitResult.data || {}),
        updates: parsedPayload.updates.map((entry) => ({
            ssidIndex: entry.ssidIndex,
            hasName: Boolean(entry.name),
            hasPassword: Boolean(entry.password),
            hasTransmitPower: entry.transmitPower !== undefined,
        })),
    };

    submitResult.timingMs = Date.now() - startedAt;
    logResult(submitResult, options.context);
    return submitResult;
}


async function setBulkWifiPasswords(deviceId, ssidIndices = [], password, options = {}) {
    const updates = (ssidIndices || []).map((ssidIndex) => ({ ssidIndex, password }));
    return applyBulkWifiUpdates(deviceId, updates, {
        ...options,
        operation: options.operation || 'setBulkWifiPasswords',
        verificationMode: 'accept_task_only',
        successMessage: options.successMessage || 'Task perubahan password WiFi bulk berhasil dikirim ke GenieACS.',
    });
}


async function setBulkWifiNames(deviceId, ssidIndices = [], name, options = {}) {
    const updates = (ssidIndices || []).map((ssidIndex) => ({ ssidIndex, name }));
    return applyBulkWifiUpdates(deviceId, updates, {
        ...options,
        operation: options.operation || 'setBulkWifiNames',
        verificationMode: 'strict_readback',
        successMessage: options.successMessage || 'Task perubahan nama WiFi bulk berhasil dikirim ke GenieACS.',
    });
}


module.exports = {
    parseWifiPayload,
    buildWifiParameterValues,
    applyBulkWifiUpdates,
    setWifiCredentials,
    setWifiName,
    setWifiPassword,
    setWifiTransmitPower,
    updateWifiSettings,
    setBulkWifiPasswords,
    setBulkWifiNames,
};
