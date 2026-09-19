/**
 * Header Doc
 * Purpose: Bacaan device GenieACS — query/projection, extractor parameter, refresh objects, diagnostics, feature status.
 * Caller: facade `lib/genieacs.js` (re-export; jangan require langsung kecuali test).
 * Deps: ./session.
 * MainFuncs: `getDeviceRecord`, `queryDevices`, `getParameterValue`, `refreshDeviceObjects`, `probeDeviceReachable`, `getPsbDevice`, `getGenieAcsDiagnostics`.
 * SideEffects: sama seperti lib/genieacs.js asli (split #b393 — murni pemindahan kode).
 */
const { createResult, getGenieAcsConfig, getGenieAcsFeatureFlags, logResult, genieacsRequest, submitTask } = require('./session');

function getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) {
            current = current[part];
        } else {
            return undefined;
        }
    }
    return current;
}


function unwrapValue(value) {
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, '_value')) {
        return value._value;
    }
    return value;
}


function getDefaultPaths(type) {
    switch (type) {
        case 'redaman':
            return ['VirtualParameters.RXPower', 'VirtualParameters.redaman'];
        case 'temperature':
            return ['VirtualParameters.Temp', 'VirtualParameters.Temperature', 'VirtualParameters.gettemp'];
        case 'modemType':
            return ['Device.DeviceInfo.ProductClass', 'InternetGatewayDevice.DeviceInfo.ProductClass'];
        case 'wifiSsid':
            return ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.{index}.SSID', 'Device.WiFi.SSID.{index}.SSID'];
        case 'wifiPassword':
            return [
                'InternetGatewayDevice.LANDevice.1.WLANConfiguration.{index}.PreSharedKey.1.PreSharedKey',
                'Device.WiFi.AccessPoint.{index}.Security.KeyPassphrase',
                'Device.WiFi.AccessPoint.{index}.Security.PreSharedKey',
            ];
        case 'wifiTransmitPower':
            return ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.{index}.TransmitPower', 'Device.WiFi.Radio.{index}.TransmitPower'];
        case 'pppoeUsername':
            return [
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
                'Device.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username',
                'Device.PPP.Interface.1.Username',
            ];
        case 'pppoePassword':
            return [
                'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password',
                'Device.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password',
                'Device.PPP.Interface.1.Password',
            ];
        case 'wifiContainer':
            return ['InternetGatewayDevice.LANDevice.1.WLANConfiguration', 'Device.WiFi.SSID'];
        case 'lastInform':
            return ['_lastInform'];
        default:
            return [];
    }
}


function uniqueValues(values = []) {
    return [...new Set(values.filter(Boolean))];
}


function deriveObjectNameFromPath(path) {
    if (!path) return null;
    return path
        .replace(/\.(SSID|TransmitPower|Username|Password)$/, '')
        .replace(/\.(PreSharedKey\.1\.PreSharedKey|Security\.KeyPassphrase|Security\.PreSharedKey)$/, '');
}


function extractFirstValue(device, paths = []) {
    for (const path of uniqueValues(paths)) {
        const value = unwrapValue(getNestedValue(device, path));
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return null;
}


// ── Pemindai PPPoE lintas-index ──────────────────────────────────────────────
// Path konfigurasi menunjuk `WANConnectionDevice.1.WANPPPConnection.1`, tapi modem dengan WAN
// TR-069 TERPISAH (jalur manajemen sendiri — topologi jaringan ini) menaruh PPPoE pelanggan di
// index LAIN (mis. `WANConnectionDevice.2`). Akibat nyata (insiden Dander 2026-08-07): username
// terlihat di UI GenieACS tapi bot membacanya kosong → cari by-PPPoE "mustahil" padahal modemnya
// ada. Pemindai ini menelusuri SEMUA instance numerik (urut index) sebagai pelengkap path config.
function collectNumericChildren(node) {
    if (!node || typeof node !== 'object') return [];
    return Object.keys(node)
        .filter((key) => /^\d+$/.test(key))
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => node[key]);
}


function scanPppoeUsernames(device) {
    const found = [];
    const pushValue = (value) => {
        const unwrapped = unwrapValue(value);
        if (typeof unwrapped === 'string' && unwrapped.trim()) found.push(unwrapped.trim());
    };
    for (const rootKey of ['InternetGatewayDevice', 'Device']) {
        const wanDevice = device && device[rootKey] && device[rootKey].WANDevice;
        for (const wd of collectNumericChildren(wanDevice)) {
            for (const wcd of collectNumericChildren(wd && wd.WANConnectionDevice)) {
                for (const wpc of collectNumericChildren(wcd && wcd.WANPPPConnection)) {
                    pushValue(wpc && wpc.Username);
                }
            }
        }
    }
    const pppInterface = device && device.Device && device.Device.PPP && device.Device.PPP.Interface;
    for (const iface of collectNumericChildren(pppInterface)) {
        pushValue(iface && iface.Username);
    }
    return [...new Set(found)];
}


// SEMUA username PPPoE yang terbaca dari device: nilai path konfigurasi lebih dulu (kompatibel
// perilaku lama), lalu hasil pindai lintas-index. Konsumen yang butuh satu nilai pakai
// extractPppoeUsername; pencarian/klasifikasi PSB mencocokkan ke SEMUANYA.
function extractPppoeUsernames(device) {
    const values = [];
    const fromConfig = extractFirstValue(device, resolvePathTemplates('pppoeUsername'));
    if (typeof fromConfig === 'string' && fromConfig.trim()) values.push(fromConfig.trim());
    for (const scanned of scanPppoeUsernames(device)) values.push(scanned);
    return [...new Set(values)];
}


function extractPppoeUsername(device) {
    const all = extractPppoeUsernames(device);
    return all.length ? all[0] : null;
}


function extractPppoePassword(device) {
    return extractFirstValue(device, resolvePathTemplates('pppoePassword'));
}


function extractSerialNumber(device) {
    return extractFirstValue(device, [
        ...getParameterPaths('serialNumber'),
        'Device.DeviceInfo.SerialNumber',
        'InternetGatewayDevice.DeviceInfo.SerialNumber',
    ]);
}


function extractDeviceModel(device) {
    return extractFirstValue(device, [
        ...getParameterPaths('modemType'),
        'Device.DeviceInfo.ModelName',
        'InternetGatewayDevice.DeviceInfo.ModelName',
    ]);
}


function extractDeviceManufacturer(device) {
    return extractFirstValue(device, [
        'Device.DeviceInfo.Manufacturer',
        'InternetGatewayDevice.DeviceInfo.Manufacturer',
    ]);
}


function parseTimestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    const unwrapped = unwrapValue(value);
    if (unwrapped instanceof Date) return Number.isNaN(unwrapped.getTime()) ? null : unwrapped.getTime();
    if (typeof unwrapped === 'number') return Number.isFinite(unwrapped) ? unwrapped : null;
    const parsed = Date.parse(String(unwrapped));
    return Number.isNaN(parsed) ? null : parsed;
}


function extractRegisteredDate(device) {
    // GenieACS menyimpan waktu registrasi PERTAMA di field root `_registered` (Date). Diverifikasi
    // langsung ke ACS DANDER (157 device): `Events.Registered` KOSONG pada ONU Huawei/ZTE lapangan,
    // sedangkan `_registered` selalu terisi & bisa di-query/-sort server-side. Prioritaskan `_registered`;
    // sisakan `Events.Registered` sebagai fallback untuk perangkat/ACS yang kebetulan mengisinya.
    if (device && device._registered) return device._registered;
    const registeredValue = extractFirstValue(device, ['Events.Registered', 'Events.Registered._value', 'Events.Registered.value']);
    if (!registeredValue) return null;
    return registeredValue;
}


function extractRegisteredTimestamp(device) {
    return parseTimestamp(extractRegisteredDate(device));
}


function getParameterPaths(type) {
    try {
        const { loadJSON } = require('../database');
        const parameters = loadJSON('genieacs_parameters.json') || [];
        const configs = parameters.filter((entry) => entry.type === type);
        const allPaths = [];
        configs.forEach((entry) => {
            if (Array.isArray(entry.paths)) {
                allPaths.push(...entry.paths);
            }
        });
        return allPaths.length > 0 ? allPaths : getDefaultPaths(type);
    } catch (error) {
        console.warn(`[GENIEACS] Failed to load parameter config for ${type}: ${error.message}`);
        return getDefaultPaths(type);
    }
}


async function queryDevices(options = {}) {
    const operation = options.operation || 'queryDevices';
    const projection = Array.isArray(options.projection)
        ? uniqueValues(options.projection)
        : uniqueValues(String(options.projection || '').split(','));
    const params = {};

    if (options.query && Object.keys(options.query).length > 0) {
        params.query = JSON.stringify(options.query);
    }
    if (projection.length > 0) {
        params.projection = projection.join(',');
    }
    if (options.limit !== undefined && options.limit !== null) {
        params.limit = options.limit;
    }
    if (options.skip !== undefined && options.skip !== null) {
        params.skip = options.skip;
    }

    const result = await genieacsRequest('get', '/devices/', {
        operation,
        params,
        timeoutMs: options.timeoutMs,
        successMessage: options.successMessage || 'Data device berhasil diambil.',
        failureMessage: options.failureMessage || 'Gagal mengambil data device dari GenieACS.',
    });

    if (!result.ok) {
        return result;
    }

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: true,
        message: result.message,
        data: Array.isArray(result.data) ? result.data : [],
        details: result.details,
        timingMs: result.timingMs,
    });
}


function resolvePathTemplates(type, index = null) {
    return getParameterPaths(type).map((path) => {
        if (index === null || index === undefined) return path;
        return path.replace(/\{index\}/g, String(index));
    });
}


async function getDeviceRecord(deviceId, projection = [], options = {}) {
    const operation = options.operation || 'getDeviceInfo';
    const startedAt = Date.now();
    if (!deviceId) {
        return createResult(operation, {
            message: 'Device ID diperlukan.',
            errorCode: 'NOT_FOUND',
            timingMs: Date.now() - startedAt,
        });
    }

    const fields = Array.isArray(projection) ? projection.filter(Boolean) : String(projection || '').split(',').filter(Boolean);
    const result = await queryDevices({
        query: { _id: deviceId },
        projection: fields,
        timeoutMs: options.timeoutMs,
        operation,
        successMessage: 'Data device berhasil diambil.',
        failureMessage: 'Gagal mengambil data device dari GenieACS.',
    });

    if (!result.ok) {
        return result;
    }

    if (!Array.isArray(result.data) || !result.data[0]) {
        return createResult(operation, {
            message: `Data perangkat tidak ditemukan untuk ID: ${deviceId}.`,
            errorCode: 'NOT_FOUND',
            timingMs: Date.now() - startedAt,
            details: result.details,
        });
    }

    return createResult(operation, {
        ok: true,
        message: result.message,
        data: result.data[0],
        details: result.details,
        timingMs: Date.now() - startedAt,
    });
}


async function getDeviceById(deviceId, projection = [], options = {}) {
    return getDeviceRecord(deviceId, projection, options);
}


async function getParameterValueByPath(deviceId, parameterPath, options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'getParameterValueByPath';
    const trimmedPath = typeof parameterPath === 'string' ? parameterPath.trim() : '';

    if (!trimmedPath) {
        return createResult(operation, {
            message: 'parameterPath wajib diisi.',
            errorCode: 'VALIDATION_ERROR',
            timingMs: Date.now() - startedAt,
        });
    }

    const deviceResult = await getDeviceRecord(deviceId, [trimmedPath], {
        operation,
        timeoutMs: options.timeoutMs,
    });

    if (!deviceResult.ok) {
        return deviceResult;
    }

    const rawValue = getNestedValue(deviceResult.data, trimmedPath);
    const value = unwrapValue(rawValue);

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: true,
        message: value !== undefined && value !== null ? 'Parameter berhasil ditemukan.' : 'Parameter tidak ditemukan pada path yang diminta.',
        data: {
            deviceId,
            pathFound: value !== undefined && value !== null ? trimmedPath : null,
            value: value !== undefined ? value : null,
            valueType: value === undefined || value === null ? null : typeof value,
            rawValue: rawValue === undefined ? null : rawValue,
        },
        details: deviceResult.details,
        timingMs: Date.now() - startedAt,
    });
}


async function getParameterValue(deviceId, parameterType, options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'getParameterValue';
    const paths = uniqueValues(getParameterPaths(parameterType));

    if (!paths.length) {
        return createResult(operation, {
            message: `Tidak ada konfigurasi path untuk parameter type: ${parameterType}.`,
            errorCode: 'NOT_FOUND',
            timingMs: Date.now() - startedAt,
        });
    }

    const deviceResult = await getDeviceRecord(deviceId, paths, {
        operation,
        timeoutMs: options.timeoutMs,
    });

    if (!deviceResult.ok) {
        return deviceResult;
    }

    let foundPath = null;
    let rawValue = null;
    let value = null;
    for (const path of paths) {
        rawValue = getNestedValue(deviceResult.data, path);
        value = unwrapValue(rawValue);
        if (value !== undefined && value !== null && value !== '') {
            foundPath = path;
            break;
        }
    }

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: true,
        message: foundPath ? 'Parameter berhasil ditemukan.' : 'Parameter paths terdaftar tetapi tidak ada nilai yang tersedia.',
        data: {
            deviceId,
            parameterType,
            testedPaths: paths,
            pathFound: foundPath,
            value: foundPath ? value : null,
            valueType: foundPath ? typeof value : null,
            rawValue: foundPath ? rawValue : null,
        },
        details: deviceResult.details,
        timingMs: Date.now() - startedAt,
    });
}


async function refreshDeviceObjects(deviceId, objectNames = [], options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'refreshDeviceObjects';
    const names = [...new Set(objectNames.filter(Boolean))];

    if (names.length === 0) {
        return createResult(operation, {
            ok: true,
            accepted: true,
            applied: null,
            message: 'Tidak ada object yang perlu di-refresh.',
            data: { refreshedObjects: [] },
            timingMs: Date.now() - startedAt,
        });
    }

    const settled = await Promise.allSettled(names.map((objectName) => submitTask(deviceId, {
        name: 'refreshObject',
        objectName,
    }, operation, {
        successMessage: `Refresh object ${objectName} berhasil dikirim.`,
        failureMessage: `Gagal refresh object ${objectName}.`,
        // Teruskan timeout dari caller (mis. getWifiInfo pakai ~25 dtk utk connection-request ONU yang
        // lambat). Default undefined → submitTask pakai config.timeoutMs (15 dtk) seperti semula.
        timeoutMs: options.timeoutMs,
    })));

    const failed = [];
    const refreshedObjects = [];
    // #b347: kumpulkan task ber-202 utk dibersihkan. Modem yang tak menjawab membalas 202 (task cuma
    // MASUK ANTREAN, tak pernah dieksekusi) → task refreshObject mengendap SELAMANYA (pola insiden
    // 3.797 task dari 1 modem pensiun #b260). probeDeviceReachable sudah membersihkan diri; jalur
    // cek-wifi on-demand (getWifiInfo→refreshDeviceObjects) terlewat — pelanggan bermodem mati yang
    // berulang 'cek wifi' menumpuk 3-4 task tiap panggilan. Hapus tiap task 202, mirror probe.
    const purgeTaskIds = [];
    settled.forEach((entry, index) => {
        if (entry.status === 'fulfilled' && entry.value.ok) {
            refreshedObjects.push(names[index]);
        } else {
            failed.push({
                objectName: names[index],
                message: entry.status === 'fulfilled' ? entry.value.message : entry.reason?.message,
            });
        }
        if (entry.status === 'fulfilled' && entry.value
            && entry.value.details && entry.value.details.httpStatus === 202
            && entry.value.data && entry.value.data.taskId) {
            purgeTaskIds.push(entry.value.data.taskId);
        }
    });
    if (purgeTaskIds.length) {
        await Promise.allSettled(purgeTaskIds.map((taskId) =>
            genieacsRequest('delete', `/tasks/${encodeURIComponent(taskId)}`, {
                operation: `${operation}.bersihkan`,
                timeoutMs: 5000,
            })));
    }

    return createResult(operation, {
        ok: failed.length === 0 || refreshedObjects.length > 0,
        accepted: refreshedObjects.length > 0,
        applied: null,
        message: failed.length === 0 ? 'Refresh object berhasil dikirim.' : 'Sebagian refresh object gagal dikirim.',
        data: { refreshedObjects, failed },
        errorCode: failed.length > 0 && refreshedObjects.length === 0 ? 'TASK_SUBMISSION_ERROR' : null,
        details: { refreshedObjects, failed },
        timingMs: Date.now() - startedAt,
    });
}


/**
 * Apakah modem MENJAWAB SEKARANG? — bukti POSITIF, bukan tebakan dari umur inform.
 *
 * !! KENAPA PERLU (#b261). "Inform basi" hanya berarti modem belum menyapa lagi; inform periodik
 * di sini 900 detik, jadi modem sehat pun sering terlihat "diam". Menyimpulkan MATI dari situ
 * membuat bot memberi tahu pelanggan bahwa perangkatnya rusak padahal baik-baik saja — dan
 * mengirim mereka mengurus benda yang bukan penyebabnya.
 *
 * Bukti yang benar adalah connection request yang DIJAWAB. Terukur di produksi 2026-08-24:
 * modem dengan inform 13,7 menit lalu menjawab HTTP 200 dalam 4,4 detik; contoh lain 0,6 / 2,1 /
 * 7,1 detik. Yang tidak menjawab memulangkan 202 = "cuma masuk antrean" (#b254).
 *
 * @returns {Promise<{reachable: boolean|null, httpStatus: number|null, ms: number, reason: string}>}
 *          `reachable: null` = TIDAK BISA MENYIMPULKAN (ACS error/timeout). Pemanggil WAJIB
 *          memperlakukan null sebagai "belum tahu", BUKAN sebagai "mati" — aturan rumah
 *          "cannot observe != observed bad".
 */
async function probeDeviceReachable(deviceId, options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'device.probeReachable';
    if (!deviceId || String(deviceId).startsWith('DEVICE-')) {
        return { reachable: null, httpStatus: null, ms: 0, reason: 'device_id tidak valid' };
    }
    try {
        // Objek paling ringan yang tetap memaksa modem menjawab. Refresh TIDAK mengubah setelan.
        const r = await submitTask(deviceId, {
            name: 'refreshObject',
            objectName: options.objectName || 'InternetGatewayDevice.DeviceInfo.UpTime',
        }, operation, { timeoutMs: options.timeoutMs || 12000 });

        const httpStatus = (r && r.details && r.details.httpStatus) || null;
        const ms = Date.now() - startedAt;
        if (!r || !r.ok) return { reachable: null, httpStatus, ms, reason: r?.errorCode || 'submit gagal' };
        if (httpStatus === 202) {
            // !! PROBE HARUS BERSIH SETELAH DIRINYA SENDIRI. Status 202 berarti tugasnya MASUK
            // ANTREAN — dan tugas untuk modem yang tak menjawab tidak pernah dieksekusi, jadi ia
            // mengendap selamanya (#b260: satu modem pensiun sempat mengumpulkan 3.797 tugas).
            // Probe ini hanya bertanya "apakah kamu menjawab?", jadi begitu jawabannya "tidak",
            // tugasnya tak berguna lagi. Terbukti perlu: uji pertama meninggalkan 1 tugas.
            const taskId = r.data && r.data.taskId;
            if (taskId) {
                try {
                    await genieacsRequest('delete', `/tasks/${encodeURIComponent(taskId)}`, {
                        operation: `${operation}.bersihkan`,
                        timeoutMs: 5000,
                    });
                } catch (_e) { /* gagal bersih-bersih tak boleh menjatuhkan vonis */ }
            }
            return { reachable: false, httpStatus, ms, reason: 'hanya masuk antrean — modem tidak menjawab' };
        }
        if (httpStatus === 200) return { reachable: true, httpStatus, ms, reason: 'modem menjawab connection request' };
        return { reachable: null, httpStatus, ms, reason: `status tak dikenal: ${httpStatus}` };
    } catch (err) {
        return { reachable: null, httpStatus: null, ms: Date.now() - startedAt, reason: err.message };
    }
}


async function refreshObjects(deviceId, objectNames = [], options = {}) {
    return refreshDeviceObjects(deviceId, objectNames, options);
}


function extractWifiInfoFromDevice(deviceData) {
    const ssidPaths = resolvePathTemplates('wifiContainer');
    let wlanContainer = null;
    let containerPath = null;

    for (const path of ssidPaths) {
        const value = getNestedValue(deviceData, path);
        if (value && typeof value === 'object') {
            wlanContainer = value;
            containerPath = path;
            break;
        }
    }

    const ssid = [];
    if (wlanContainer && typeof wlanContainer === 'object') {
        Object.keys(wlanContainer).forEach((id) => {
            const entry = wlanContainer[id];
            const ssidName = unwrapValue(entry?.SSID);
            if (ssidName === undefined || ssidName === null) {
                return;
            }

            const associatedDevices = [];
            const assoc = entry?.AssociatedDevice;
            if (assoc && typeof assoc === 'object') {
                Object.keys(assoc).forEach((key) => {
                    const device = assoc[key];
                    if (!device || typeof device !== 'object') return;
                    const mac = unwrapValue(device.AssociatedDeviceMACAddress);
                    if (!mac) return;
                    associatedDevices.push({
                        ip: unwrapValue(device.AssociatedDeviceIPAddress) || 'N/A',
                        mac,
                        hostName: unwrapValue(device.X_HW_AssociatedDevicedescriptions)
                            || unwrapValue(device.X_HW_HostName)
                            || unwrapValue(device.HostName)
                            || 'N/A',
                        signal: unwrapValue(device.X_HW_RSSI) || 'N/A',
                    });
                });
            }

            ssid.push({
                id: String(id),
                name: ssidName,
                transmitPower: unwrapValue(entry?.TransmitPower),
                associatedDevices,
            });
        });
    }

    return {
        uptime: unwrapValue(getNestedValue(deviceData, 'VirtualParameters.getdeviceuptime')) || 'Tidak Tersedia',
        lastInform: deviceData._lastInform || null,
        ssid,
        containerPath,
    };
}


async function getWifiInfo(deviceId, options = {}) {
    const startedAt = Date.now();
    const operation = 'getWifiInfo';
    const skipRefresh = options.skipRefresh !== undefined ? options.skipRefresh : true;
    // Refresh cek-wifi HANYA menyentuh container WLAN (isinya SSID + AssociatedDevice + TotalAssociations)
    // plus VirtualParameters (uptime) — supaya data perangkat-terhubung tetap LIVE. JANGAN ikut me-refresh
    // seluruh subtree `InternetGatewayDevice.LANDevice.1`: pada ONU nyata (mis. Huawei HG8145V5) subtree itu
    // menyapu tabel Hosts + statistik → satu refresh saja ~13 dtk. Digabung refresh lain, total kerja sesi
    // CWMP satu ONU tembus timeout 15 dtk → TIMEOUT_ERROR beruntun → circuit breaker global OPEN → SEMUA
    // pelanggan gagal cek-wifi ("bisa sekali lalu gagal terus"). Diagnosa prod 2026-07-06 (device Dani).
    const refreshObjects = resolvePathTemplates('wifiContainer').concat(['VirtualParameters']);
    // ONU nyata butuh ~9-13 dtk membalas GetParameterValues container WLAN; timeout refresh dilonggarkan
    // (default 25 dtk, override via config.genieacsWifiRefreshTimeoutMs) agar refresh LIVE tidak salah-vonis
    // timeout & tidak men-trip breaker. Baca (getDeviceRecord) di bawah tetap murah dgn timeout default.
    const refreshTimeoutMs = Number.parseInt(options.refreshTimeoutMs ?? global.config?.genieacsWifiRefreshTimeoutMs, 10) || 25000;

    if (!skipRefresh) {
        await refreshDeviceObjects(deviceId, refreshObjects, { operation: 'refreshWifiInfo', timeoutMs: refreshTimeoutMs });
        await new Promise((resolve) => setTimeout(resolve, options.refreshDelayMs || 3000));
    }

    const projections = [
        ...resolvePathTemplates('wifiContainer'),
        'VirtualParameters.getdeviceuptime',
        '_lastInform',
    ];
    const deviceResult = await getDeviceRecord(deviceId, projections, { operation });
    if (!deviceResult.ok) {
        return deviceResult;
    }

    const wifiInfo = extractWifiInfoFromDevice(deviceResult.data);
    if (!wifiInfo.ssid.length) {
        return createResult(operation, {
            ok: false,
            accepted: true,
            applied: null,
            message: `Data SSID tidak ditemukan untuk device ${deviceId}.`,
            errorCode: 'UNSUPPORTED_PATH',
            details: {
                ...deviceResult.details,
                availableContainer: wifiInfo.containerPath,
            },
            timingMs: Date.now() - startedAt,
        });
    }

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: true,
        message: 'Informasi WiFi berhasil diambil.',
        data: {
            deviceId,
            uptime: wifiInfo.uptime,
            lastInform: wifiInfo.lastInform,
            ssid: wifiInfo.ssid,
        },
        details: {
            ...deviceResult.details,
            containerPath: wifiInfo.containerPath,
        },
        timingMs: Date.now() - startedAt,
    });
}


function formatMetricValue(value, suffix) {
    if (value === undefined || value === null || value === '') return null;
    return `${value} ${suffix}`;
}


async function getCustomerRedaman(deviceId, options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'getCustomerRedaman';
    const redamanPaths = getParameterPaths('redaman');

    if (!options.skipRefresh) {
        await refreshDeviceObjects(deviceId, redamanPaths, {
            operation: `${operation}.refresh`,
            timeoutMs: options.timeoutMs,
        });
    }

    const result = await getParameterValue(deviceId, 'redaman', {
        operation: `${operation}.read`,
        timeoutMs: options.timeoutMs,
    });

    if (!result.ok) {
        return result;
    }

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: true,
        message: result.message,
        data: {
            deviceId,
            redaman: result.data.value,
            pathFound: result.data.pathFound,
        },
        details: result.details,
        timingMs: Date.now() - startedAt,
    });
}


async function getDeviceCoreInfo(deviceId, options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'getDeviceCoreInfo';
    const projection = uniqueValues([
        '_id',
        'Device.DeviceInfo',
        'InternetGatewayDevice.DeviceInfo',
        ...getParameterPaths('temperature'),
    ]);

    if (!options.skipRefresh) {
        await refreshDeviceObjects(deviceId, [
            'VirtualParameters',
            'Device.DeviceInfo',
            'InternetGatewayDevice.DeviceInfo',
        ], {
            operation: `${operation}.refresh`,
            timeoutMs: options.timeoutMs,
        });
    }

    const deviceResult = await getDeviceRecord(deviceId, projection, {
        operation: `${operation}.read`,
        timeoutMs: options.timeoutMs,
    });

    if (!deviceResult.ok) {
        return deviceResult;
    }

    const device = deviceResult.data;
    const deviceInfo = device.Device?.DeviceInfo || device.InternetGatewayDevice?.DeviceInfo || {};
    const temperature = extractFirstValue(device, getParameterPaths('temperature'));

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: true,
        message: 'Informasi inti perangkat berhasil diambil.',
        data: {
            modemType: extractDeviceModel(device) || null,
            serialNumber: extractSerialNumber(device) || null,
            softwareVersion: unwrapValue(deviceInfo.SoftwareVersion) || null,
            hardwareVersion: unwrapValue(deviceInfo.HardwareVersion) || null,
            manufacturer: extractDeviceManufacturer(device) || null,
            temperature,
        },
        details: deviceResult.details,
        timingMs: Date.now() - startedAt,
    });
}


async function getMultipleDeviceMetrics(deviceIds = [], options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'getMultipleDeviceMetrics';
    const ids = uniqueValues((deviceIds || []).map((entry) => String(entry).trim()));

    if (!ids.length) {
        return createResult(operation, {
            ok: true,
            accepted: true,
            applied: true,
            message: 'Tidak ada device yang diminta.',
            data: [],
            timingMs: Date.now() - startedAt,
        });
    }

    if (!options.skipRefresh) {
        await Promise.allSettled(ids.map((deviceId) => refreshDeviceObjects(deviceId, [
            'VirtualParameters',
            'Device.DeviceInfo',
            'InternetGatewayDevice.DeviceInfo',
            ...resolvePathTemplates('wifiContainer').map((path) => deriveObjectNameFromPath(path)),
        ], {
            operation: `${operation}.refresh`,
            timeoutMs: options.timeoutMs,
        })));
    }

    const projection = uniqueValues([
        '_id',
        'Device.DeviceInfo',
        'InternetGatewayDevice.DeviceInfo',
        ...getParameterPaths('redaman'),
        ...getParameterPaths('temperature'),
        ...resolvePathTemplates('wifiContainer'),
    ]);

    const result = await queryDevices({
        query: { _id: { $in: ids } },
        projection,
        timeoutMs: options.timeoutMs || global.config?.genieacsBatchTimeout || 30000,
        operation: `${operation}.query`,
    });

    if (!result.ok) {
        return result;
    }

    const metrics = (result.data || []).map((device) => {
        const wifiInfo = extractWifiInfoFromDevice(device);
        const totalConnectedDevices = (wifiInfo.ssid || []).reduce((sum, ssid) => sum + (ssid.associatedDevices || []).length, 0);
        const redaman = extractFirstValue(device, getParameterPaths('redaman'));
        const temperature = extractFirstValue(device, getParameterPaths('temperature'));

        return {
            deviceId: device._id,
            redaman: formatMetricValue(redaman, 'dBm'),
            uptime: null,
            temperature: formatMetricValue(temperature, '°C'),
            modemType: extractDeviceModel(device) || null,
            totalConnectedDevices,
        };
    });

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: true,
        message: 'Metrik perangkat berhasil diambil.',
        data: metrics,
        details: result.details,
        timingMs: Date.now() - startedAt,
    });
}


async function getPsbDevice(deviceId, options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'getPsbDevice';
    const projection = uniqueValues([
        '_id',
        '_registered',
        '_lastInform',
        'Device.DeviceInfo',
        'InternetGatewayDevice.DeviceInfo',
        'VirtualParameters',
        'Events.Registered',
        // Subtree WAN utuh (bukan hanya leaf index-1) supaya pemindai PPPoE lintas-index
        // punya bahan — modem dgn WAN TR-069 terpisah menaruh PPPoE pelanggan di index lain.
        'InternetGatewayDevice.WANDevice',
        'Device.WANDevice',
        'Device.PPP.Interface',
        ...resolvePathTemplates('pppoeUsername'),
    ]);

    const result = await getDeviceRecord(deviceId, projection, {
        operation,
        timeoutMs: options.timeoutMs,
    });

    if (!result.ok) {
        return result;
    }

    const device = result.data;
    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: true,
        message: 'Device PSB berhasil diambil.',
        data: {
            deviceId: device._id,
            serialNumber: extractSerialNumber(device),
            model: extractDeviceModel(device),
            manufacturer: extractDeviceManufacturer(device),
            currentPPPUsername: extractPppoeUsername(device),
            lastInform: extractFirstValue(device, resolvePathTemplates('lastInform')) || null,
            registeredAt: extractRegisteredDate(device),
            registeredTimestamp: extractRegisteredTimestamp(device),
            raw: device,
        },
        details: result.details,
        timingMs: Date.now() - startedAt,
    });
}


async function getDeviceInfo(deviceId, options = {}) {
    const startedAt = Date.now();
    const result = await getDeviceRecord(deviceId, [
        '_id',
        ...resolvePathTemplates('lastInform'),
        'Device.DeviceInfo',
        'InternetGatewayDevice.DeviceInfo',
    ], {
        operation: 'getDeviceInfo',
        timeoutMs: options.timeoutMs,
    });
    if (!result.ok) {
        logResult(result, options.context);
        return result;
    }

    const device = result.data;
    const finalResult = createResult('getDeviceInfo', {
        ok: true,
        accepted: true,
        applied: true,
        message: 'Informasi device berhasil diambil.',
        data: {
            _id: device._id,
            lastInform: device._lastInform || null,
            deviceInfo: device.Device?.DeviceInfo || device.InternetGatewayDevice?.DeviceInfo || null,
            raw: device,
        },
        details: result.details,
        timingMs: Date.now() - startedAt,
    });
    logResult(finalResult, options.context);
    return finalResult;
}


async function getConnectedDevices(deviceId, options = {}) {
    const result = await getWifiInfo(deviceId, options);
    if (!result.ok) return result;

    const devices = [];
    result.data.ssid.forEach((ssid) => {
        (ssid.associatedDevices || []).forEach((device) => {
            devices.push({ ...device, ssidId: ssid.id, ssidName: ssid.name });
        });
    });

    return createResult('getConnectedDevices', {
        ok: true,
        accepted: result.accepted,
        applied: result.applied,
        message: 'Daftar perangkat terhubung berhasil diambil.',
        data: {
            deviceId,
            totalDevices: devices.length,
            devices,
            ssid: result.data.ssid,
        },
        details: result.details,
        timingMs: result.timingMs,
    });
}


async function getGenieAcsDiagnostics(options = {}) {
    const startedAt = Date.now();
    const config = getGenieAcsConfig();
    const mode = options.mode || 'basic';
    if (!config.valid) {
        const result = createResult('getGenieAcsDiagnostics', {
            message: `Konfigurasi GenieACS tidak lengkap: ${config.missing.join(', ')}`,
            errorCode: 'CONFIG_ERROR',
            details: { config, mode },
            timingMs: Date.now() - startedAt,
        });
        logResult(result, options.context);
        return result;
    }

    const basic = await queryDevices({
        projection: ['_id'],
        limit: 1,
        timeoutMs: options.timeoutMs || 5000,
        operation: 'getGenieAcsDiagnostics.basic',
        successMessage: 'Koneksi ke GenieACS berhasil.',
        failureMessage: 'Koneksi ke GenieACS gagal.',
    });

    if (!basic.ok || !options.deviceId) {
        const result = createResult('getGenieAcsDiagnostics', {
            ok: basic.ok,
            accepted: basic.ok,
            applied: basic.ok ? true : null,
            message: basic.message,
            errorCode: basic.errorCode,
            details: {
                ...(basic.details || {}),
                config,
            },
            timingMs: Date.now() - startedAt,
            data: {
                configValid: config.valid,
                connected: basic.ok,
                basicConnected: basic.ok,
                deviceReadable: false,
                wifiCapable: false,
                pppoeCapable: false,
                mutationCapable: false,
                capabilityReady: false,
                resolvedPaths: {
                    wifiContainer: resolvePathTemplates('wifiContainer'),
                    pppoeUsername: resolvePathTemplates('pppoeUsername'),
                },
                mode,
            },
        });
        logResult(result, options.context);
        return result;
    }
    const deviceResult = await getDeviceRecord(options.deviceId, [
        '_id',
        '_lastInform',
        ...resolvePathTemplates('wifiContainer'),
        ...resolvePathTemplates('pppoeUsername'),
    ], {
        operation: 'getGenieAcsDiagnostics.deviceRead',
        timeoutMs: options.timeoutMs || 5000,
    });
    const mutationResult = await refreshDeviceObjects(options.deviceId, [
        'VirtualParameters',
        ...resolvePathTemplates('wifiContainer').map((path) => deriveObjectNameFromPath(path)),
        ...resolvePathTemplates('pppoeUsername').map((path) => deriveObjectNameFromPath(path)),
    ], {
        operation: 'getGenieAcsDiagnostics.mutation',
    });
    const wifiCapable = deviceResult.ok && Boolean(extractWifiInfoFromDevice(deviceResult.data).containerPath);
    const pppoeCapable = deviceResult.ok && Boolean(extractPppoeUsername(deviceResult.data));
    const mutationCapable = mutationResult.accepted === true;
    const basicConnected = basic.ok;
    const deviceReadable = deviceResult.ok;
    const capabilityReady = basicConnected && deviceReadable && mutationCapable;
    const readinessOk = mode === 'capability' || mode === 'device-probe'
        ? capabilityReady
        : (mode === 'device-read' ? (basicConnected && deviceReadable) : basicConnected);
    const result = createResult('getGenieAcsDiagnostics', {
        ok: readinessOk,
        accepted: mutationCapable,
        applied: mutationCapable ? true : null,
        message: readinessOk ? 'GenieACS readiness check selesai.' : (mutationResult.message || deviceResult.message || basic.message),
        errorCode: !basic.ok ? basic.errorCode : deviceResult.errorCode,
        details: {
            basic: basic.details || null,
            deviceRead: deviceResult.details || null,
            mutation: mutationResult.details || null,
            config,
        },
        timingMs: Date.now() - startedAt,
        data: {
            configValid: config.valid,
            connected: basicConnected,
            basicConnected,
            deviceReadable,
            wifiCapable,
            pppoeCapable,
            mutationCapable,
            capabilityReady,
            resolvedPaths: {
                wifiContainer: resolvePathTemplates('wifiContainer'),
                pppoeUsername: resolvePathTemplates('pppoeUsername'),
            },
            mode,
        },
    });
    logResult(result, options.context);
    return result;
}


async function getGenieAcsFeatureStatus(options = {}) {
    const feature = options.feature || 'generic';
    const deviceId = options.deviceId || null;
    const config = getGenieAcsConfig();
    const flags = getGenieAcsFeatureFlags();

    const result = {
        configured: config.valid,
        enabled: flags.enabled,
        reachable: config.valid ? null : false,
        customerRebootEnabled: flags.customerRebootEnabled,
        adminRebootEnabled: flags.adminRebootEnabled,
        wifiManagementEnabled: flags.wifiManagementEnabled,
        psbProvisioningEnabled: flags.psbProvisioningEnabled,
        available: false,
        reason: '',
        errorCode: null,
    };

    const featureMap = {
        customerReboot: { key: 'customerRebootEnabled', label: 'reboot pelanggan' },
        adminReboot: { key: 'adminRebootEnabled', label: 'reboot admin' },
        wifiManagement: { key: 'wifiManagementEnabled', label: 'manajemen WiFi' },
        psbProvisioning: { key: 'psbProvisioningEnabled', label: 'provisioning PSB' },
    };

    if (!flags.enabled) {
        result.reason = 'GenieACS dinonaktifkan oleh admin.';
        result.errorCode = 'GENIEACS_DISABLED';
        return result;
    }

    if (!config.valid) {
        result.reason = 'GenieACS belum dikonfigurasi.';
        result.errorCode = 'GENIEACS_NOT_CONFIGURED';
        return result;
    }

    const featureDescriptor = featureMap[feature];
    if (featureDescriptor && flags[featureDescriptor.key] === false) {
        result.reason = `Fitur ${featureDescriptor.label} dinonaktifkan oleh admin.`;
        result.errorCode = 'GENIEACS_FEATURE_DISABLED';
        return result;
    }

    if ((feature === 'customerReboot' || feature === 'adminReboot') && !deviceId) {
        result.reason = 'Device tidak memiliki device_id.';
        result.errorCode = 'DEVICE_ID_REQUIRED';
        return result;
    }

    if (options.includeDiagnostics === true) {
        const diagnostics = await getGenieAcsDiagnostics({
            caller: options.caller || 'genieacs.feature-status',
            mode: options.mode || 'basic',
            deviceId,
        });
        result.reachable = diagnostics.data?.basicConnected === true;
        if (!diagnostics.ok && result.reachable !== true) {
            result.reason = diagnostics.message || 'GenieACS tidak dapat dijangkau.';
            result.errorCode = diagnostics.errorCode || 'GENIEACS_UNREACHABLE';
            return result;
        }
    }

    result.available = true;
    result.reason = 'GenieACS tersedia.';
    return result;
}


module.exports = {
    getNestedValue,
    unwrapValue,
    getDefaultPaths,
    uniqueValues,
    deriveObjectNameFromPath,
    extractFirstValue,
    collectNumericChildren,
    scanPppoeUsernames,
    extractPppoeUsernames,
    extractPppoeUsername,
    extractPppoePassword,
    extractSerialNumber,
    extractDeviceModel,
    extractDeviceManufacturer,
    parseTimestamp,
    extractRegisteredDate,
    extractRegisteredTimestamp,
    getParameterPaths,
    queryDevices,
    resolvePathTemplates,
    getDeviceRecord,
    getDeviceById,
    getParameterValueByPath,
    getParameterValue,
    refreshDeviceObjects,
    probeDeviceReachable,
    refreshObjects,
    extractWifiInfoFromDevice,
    getWifiInfo,
    formatMetricValue,
    getCustomerRedaman,
    getDeviceCoreInfo,
    getMultipleDeviceMetrics,
    getPsbDevice,
    getDeviceInfo,
    getConnectedDevices,
    getGenieAcsDiagnostics,
    getGenieAcsFeatureStatus,
};
