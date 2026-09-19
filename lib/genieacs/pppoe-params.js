/**
 * Header Doc
 * Purpose: Parameter PPPoE GenieACS — build credentials, setPPPoECredentials, updatePsbDeviceConfig.
 * Caller: facade `lib/genieacs.js` (re-export; jangan require langsung kecuali test).
 * Deps: ./session, ./device-read, ./reboot-verify.
 * MainFuncs: `buildPppoeParameterValues`, `setPPPoECredentials`, `updatePsbDeviceConfig`.
 * SideEffects: sama seperti lib/genieacs.js asli (split #b393 — murni pemindahan kode).
 */
const { uniqueValues, deriveObjectNameFromPath, resolvePathTemplates } = require('./device-read');
const { setParameterValues } = require('./reboot-verify');
const { logResult } = require('./session');

function buildPppoeParameterValues(username, password) {
    const parameterValues = [];
    const verificationPaths = [];
    const refreshObjects = new Set();

    resolvePathTemplates('pppoeUsername').forEach((path) => {
        parameterValues.push([path, username, 'xsd:string']);
        verificationPaths.push({ path, expectedValue: username });
        refreshObjects.add(deriveObjectNameFromPath(path));
    });

    resolvePathTemplates('pppoePassword').forEach((path) => {
        parameterValues.push([path, password, 'xsd:string']);
        verificationPaths.push({ path, expectedValue: password, sensitive: true });
        refreshObjects.add(deriveObjectNameFromPath(path));
    });

    return {
        parameterValues,
        verificationPaths,
        refreshObjects: [...refreshObjects],
    };
}


async function setPPPoECredentials(deviceId, username, password, options = {}) {
    const startedAt = Date.now();
    const operation = 'setPPPoECredentials';
    const { parameterValues, verificationPaths, refreshObjects } = buildPppoeParameterValues(username, password);
    const submitResult = await setParameterValues(deviceId, parameterValues, {
        ...options,
        operation,
        verificationPaths,
        refreshObjects,
        verificationMode: options.verifyApplied === true ? 'strict_readback' : 'accept_task_only',
        successMessage: 'Task perubahan PPPoE berhasil dikirim ke GenieACS.',
    });

    submitResult.timingMs = Date.now() - startedAt;
    logResult(submitResult, options.context);
    return submitResult;
}


async function updatePsbDeviceConfig(deviceId, payload = {}, options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'updatePsbDeviceConfig';
    const ssidIndices = uniqueValues(
        (Array.isArray(payload.ssidIndices) && payload.ssidIndices.length ? payload.ssidIndices : [payload.ssidIndex || 1])
            .map((entry) => String(entry).trim())
            .filter(Boolean)
    );

    const parameterValues = [];

    if (payload.pppUsername) {
        resolvePathTemplates('pppoeUsername').forEach((path) => {
            parameterValues.push([path, payload.pppUsername, 'xsd:string']);
        });
    }
    if (payload.pppPassword) {
        resolvePathTemplates('pppoePassword').forEach((path) => {
            parameterValues.push([path, payload.pppPassword, 'xsd:string']);
        });
    }
    if (payload.wifiSSID) {
        ssidIndices.forEach((ssidIndex) => {
            resolvePathTemplates('wifiSsid', ssidIndex).forEach((path) => {
                parameterValues.push([path, payload.wifiSSID, 'xsd:string']);
            });
        });
    }
    if (payload.wifiPassword) {
        ssidIndices.forEach((ssidIndex) => {
            resolvePathTemplates('wifiPassword', ssidIndex).forEach((path) => {
                parameterValues.push([path, payload.wifiPassword, 'xsd:string']);
            });
        });
    }

    const result = await setParameterValues(deviceId, parameterValues, {
        ...options,
        operation,
        verificationMode: 'accept_task_only',
        refreshObjects: uniqueValues([
            ...resolvePathTemplates('pppoeUsername').map((path) => deriveObjectNameFromPath(path)),
            ...resolvePathTemplates('pppoePassword').map((path) => deriveObjectNameFromPath(path)),
            ...ssidIndices.flatMap((ssidIndex) => resolvePathTemplates('wifiSsid', ssidIndex).map((path) => deriveObjectNameFromPath(path))),
            ...ssidIndices.flatMap((ssidIndex) => resolvePathTemplates('wifiPassword', ssidIndex).map((path) => deriveObjectNameFromPath(path))),
        ]),
        successMessage: 'Konfigurasi device PSB berhasil dikirim ke GenieACS.',
    });

    // ✅ UTANG DI ATAS SUDAH DILUNASI — fakta yang dulu "belum terukur" kini TERUKUR (#b251).
    // Pengukuran produksi 2026-08-20 (task `refreshObject`, baca-saja, 7 modem), pemisahannya
    // BERSIH SEMPURNA:
    //     4 modem dgn `_lastInform` 0–1 menit lalu (terjangkau)              → HTTP 200 semua
    //     3 modem dgn `_lastInform` 202 / 280 / 65.123 menit lalu (mati)     → HTTP 202 semua
    // Jadi di deployment ini: 200 = modem BENAR-BENAR menerapkan · 202 = task cuma masuk ANTREAN,
    // modem tak tersentuh sama sekali.
    //
    // Kenapa ini wajib ditegakkan di sini: hasil fungsi inilah yang diumumkan wizard PSB sebagai
    // "✅ online!" DAN yang memicu pesan selamat datang berisi kredensial WiFi ke pelanggan.
    // Selama 202 dihitung sukses, pelanggan menerima nama & sandi WiFi untuk modem yang tak pernah
    // dikonfigurasi — dan penahan welcome di `create-user-persist` (devicePushFailed) tak pernah
    // aktif. Readback BUKAN pilihan di sini: sandi WiFi/PPPoE memang tak bisa dibaca balik (justru
    // itu alasan `accept_task_only` dipakai). Status HTTP memberi vonis keterjangkauan tanpa
    // menyentuh nilai sensitif.
    // Penegakan pusat di `setParameterValuesInternal` sudah membalik `ok` lebih dulu, jadi syarat
    // `result.ok &&` di sini akan MELEWATKAN kasusnya. Blok ini dipertahankan sebagai penegasan
    // idempoten + pesan khusus PSB.
    if (result.details && result.details.queuedOnly) {
        result.ok = false;
        result.errorCode = result.errorCode || 'DEVICE_UNREACHABLE';
        result.message = 'Modem tidak menjawab saat dihubungi — setelan hanya masuk antrean GenieACS, BELUM diterapkan ke modem.';
        result.data = {
            ...(result.data || {}),
            deviceId,
            queuedOnly: true,
            updatedParameters: parameterValues.length,
            ssidIndices,
        };
        result.timingMs = Date.now() - startedAt;
        return result;
    }

    if (result.ok) {
        result.data = {
            ...(result.data || {}),
            deviceId,
            updatedParameters: parameterValues.length,
            parameters: parameterValues.map((entry) => entry[0]),
            ssidIndices,
        };
    }
    result.timingMs = Date.now() - startedAt;
    return result;
}


module.exports = {
    buildPppoeParameterValues,
    setPPPoECredentials,
    updatePsbDeviceConfig,
};
