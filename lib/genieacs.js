/**
 * Header Doc
 * Purpose: Adapter tunggal ke GenieACS (TR-069) — baca device, set parameter WiFi/PPPoE, reboot, verifikasi hasil.
 * Caller: `lib/wifi.js`, `lib/genieacs-*.js`, `services/network-ops.service.js`, handler WA lewat `lib/wifi`.
 * Deps: `axios`, agent http/https keepAlive singleton, `database/genieacs_parameters.json` (override path).
 * MainFuncs: `getDeviceRecord`, `setParameterValues`, `setWifiCredentials`, `updateWifiSettings`, `applyBulkWifiUpdates`, `setPPPoECredentials`, `rebootDevice`.
 * SideEffects: Kirim task ke GenieACS (mengubah konfigurasi modem pelanggan), log hasil operasi, buka circuit breaker saat ACS bermasalah.
 */
const axios = require('axios');
const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_VERIFY_TIMEOUT_MS = 15000;
const DEFAULT_VERIFY_INTERVAL_MS = 1500;

// Singleton HTTP/HTTPS agents — keepAlive supaya TCP+TLS handshake tidak diulang
// tiap call. Untuk satu sesi "ganti nama WiFi" yang terdiri dari 5-15 request ke
// GenieACS (info, set, refresh, verify polling), ini turunkan p95 latency 30-50%.
// maxSockets 20 cukup untuk concurrent admin + bot + cron jobs di satu instance.
const KEEPALIVE_AGENT_OPTIONS = { keepAlive: true, maxSockets: 20, maxFreeSockets: 10, timeout: 60000 };
const httpAgent = new http.Agent(KEEPALIVE_AGENT_OPTIONS);
const httpsAgent = new https.Agent(KEEPALIVE_AGENT_OPTIONS);

// Purge socket keep-alive yang mungkin BASI (mis. GenieACS sempat restart): socket "free" di pool
// bisa sudah ditutup sisi server → request berikut kena ECONNRESET/CONNECT_ERROR. Dipanggil saat
// breaker MEMBUKA dan saat probe HALF-OPEN agar pemulihan memakai koneksi fresh. Tanpa ini, probe
// pemulihan ikut memakai socket mati → CONNECT_ERROR → breaker NYANGKUT open (regresi prod 22-06).
function destroyGenieAgents() {
    try { httpAgent.destroy(); } catch (_e) { /* abaikan */ }
    try { httpsAgent.destroy(); } catch (_e) { /* abaikan */ }
}

// Retry & per-device-mutex tuning — bisa di-override via global.config kalau perlu.
const DEFAULT_RETRY_MAX_ATTEMPTS = 3; // attempt pertama + 2 retry
const DEFAULT_RETRY_BASE_DELAY_MS = 250; // exponential: 250, 500, 1000

// In-process per-device mutex: {deviceId → tail Promise}. Mutasi untuk device
// yang sama antri (avoid race ketika 2 admin/customer + bot trigger barengan).
// Beda device tetap paralel. Cross-process: TIDAK serialize — kalau ada multi
// instance bot, butuh distributed lock (out-of-scope sini).
const deviceLocks = new Map();

// Circuit breaker untuk koneksi ke GenieACS. State machine:
//   closed: normal — request lewat.
//   open: GenieACS dianggap down — fail-fast tanpa axios call.
//   half-open: setelah cooldown, izinkan 1 probe; sukses → closed, gagal → open lagi.
// Hanya dihitung transient failure (TIMEOUT/CONNECT). 4xx/AUTH/NOT_FOUND tidak
// trip breaker karena bukan indikasi GenieACS down.
const CIRCUIT_DEFAULT_THRESHOLD = 5;
const CIRCUIT_DEFAULT_OPEN_MS = 30000;
const circuitState = {
    consecutiveFailures: 0,
    state: 'closed', // 'closed' | 'open' | 'half-open'
    openUntil: 0,
    probeInFlight: false,
};

function getCircuitConfig() {
    const threshold = parseInt(global.config?.genieacsCircuitFailureThreshold, 10);
    const openMs = parseInt(global.config?.genieacsCircuitOpenMs, 10);
    return {
        threshold: Number.isFinite(threshold) && threshold >= 1 ? threshold : CIRCUIT_DEFAULT_THRESHOLD,
        openMs: Number.isFinite(openMs) && openMs >= 0 ? openMs : CIRCUIT_DEFAULT_OPEN_MS,
        enabled: global.config?.genieacsCircuitEnabled !== false,
    };
}

function recordCircuitSuccess() {
    circuitState.consecutiveFailures = 0;
    circuitState.state = 'closed';
    circuitState.openUntil = 0;
    circuitState.probeInFlight = false;
}

function recordCircuitFailure(errorCode, opts = {}) {
    // !! "ONU TAK MENJAWAB" BUKAN "ACS RUSAK" (#b251).
    // `POST /devices/<id>/tasks?connection_request` secara desain MENUNGGU ACS menghubungi modem.
    // Modem pelanggan yang mati / jauh / sinyalnya jelek tentu tak menjawab, dan axios memulangkan
    // ECONNABORTED → `TIMEOUT_ERROR`. Dulu kode menghitung itu sebagai bukti GenieACS down, jadi
    // cukup beberapa modem bisu beruntun untuk membuka breaker GLOBAL — yang lalu ikut menolak cek
    // WiFi pelanggan, provisioning PSB, reboot berbantu, dan panel admin, padahal ACS-nya sehat
    // (terukur: curl 39 ms, diagnostik ok 47 ms dari proses yang sama). Itulah yang membuat
    // pemantauan redaman Tanjungharjo buta 18 jam pada 2026-08-20.
    // CONNECT_ERROR tetap dihitung — itu memang berarti host ACS-nya yang tak terjangkau.
    if (opts.deviceBound && errorCode === 'TIMEOUT_ERROR') {
        circuitState.probeInFlight = false;
        return;
    }
    if (!RETRYABLE_ERROR_CODES.has(errorCode)) {
        // Non-transient: jangan trip breaker.
        circuitState.probeInFlight = false;
        return;
    }
    circuitState.consecutiveFailures += 1;
    const { threshold, openMs } = getCircuitConfig();
    if (circuitState.consecutiveFailures >= threshold) {
        circuitState.state = 'open';
        circuitState.openUntil = Date.now() + openMs;
        destroyGenieAgents(); // GenieACS divonis down → buang socket basi
    }
    circuitState.probeInFlight = false;
}

/**
 * Cek apakah request boleh lewat. Return null kalau boleh, atau object error
 * fast-fail kalau breaker open. Pada cooldown sudah lewat → transition ke
 * half-open dan izinkan 1 probe.
 */
function checkCircuit() {
    const { enabled } = getCircuitConfig();
    if (!enabled) return null;
    if (circuitState.state === 'closed') return null;

    const now = Date.now();
    if (circuitState.state === 'open') {
        if (now >= circuitState.openUntil) {
            circuitState.state = 'half-open';
            circuitState.probeInFlight = false;
            destroyGenieAgents(); // probe pemulihan WAJIB koneksi fresh (anti socket basi)
        } else {
            return {
                code: 'CIRCUIT_OPEN',
                message: 'GenieACS sedang bermasalah, request ditolak sementara (circuit breaker open). Coba lagi sebentar.',
                openUntil: circuitState.openUntil,
            };
        }
    }

    if (circuitState.state === 'half-open') {
        if (circuitState.probeInFlight) {
            return {
                code: 'CIRCUIT_OPEN',
                message: 'Sedang memeriksa pemulihan GenieACS, request lain ditolak sementara.',
                openUntil: circuitState.openUntil,
            };
        }
        circuitState.probeInFlight = true;
    }
    return null;
}

// Test helper — reset breaker state. Tidak di-export ke public surface.
function _resetCircuitForTests() {
    circuitState.consecutiveFailures = 0;
    circuitState.state = 'closed';
    circuitState.openUntil = 0;
    circuitState.probeInFlight = false;
}

function createResult(operation, overrides = {}) {
    return {
        ok: false,
        operation,
        data: null,
        message: '',
        errorCode: null,
        details: null,
        timingMs: 0,
        accepted: false,
        applied: null,
        ...overrides,
    };
}

function getGenieAcsConfig() {
    const config = global.config || {};
    const baseUrl = typeof config.genieacsBaseUrl === 'string' ? config.genieacsBaseUrl.trim().replace(/\/+$/, '') : '';
    const timeoutMs = parseInt(config.genieacsTimeoutMs || DEFAULT_TIMEOUT_MS, 10);
    const verifyTimeoutMs = parseInt(config.genieacsVerifyTimeoutMs || DEFAULT_VERIFY_TIMEOUT_MS, 10);
    const verifyIntervalMs = parseInt(config.genieacsVerifyIntervalMs || DEFAULT_VERIFY_INTERVAL_MS, 10);

    // Basic Auth optional — kalau username kosong, biarkan request tanpa header
    // (current production GenieACS pakai mode no-auth). Disetel via config supaya
    // kalau infra security tightening tinggal isi 2 field tanpa code change.
    const username = typeof config.genieacsUsername === 'string' ? config.genieacsUsername.trim() : '';
    const password = typeof config.genieacsPassword === 'string' ? config.genieacsPassword : '';
    const auth = username ? { username, password } : null;

    return {
        baseUrl: baseUrl || null,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS,
        verifyTimeoutMs: Number.isFinite(verifyTimeoutMs) ? verifyTimeoutMs : DEFAULT_VERIFY_TIMEOUT_MS,
        verifyIntervalMs: Number.isFinite(verifyIntervalMs) ? verifyIntervalMs : DEFAULT_VERIFY_INTERVAL_MS,
        auth,
        valid: Boolean(baseUrl),
        missing: baseUrl ? [] : ['genieacsBaseUrl'],
    };
}

function getGenieAcsFeatureFlags(config = global.config || {}) {
    return {
        enabled: config.genieacsEnabled !== false,
        customerRebootEnabled: config.genieacsCustomerRebootEnabled !== false,
        adminRebootEnabled: config.genieacsAdminRebootEnabled !== false,
        wifiManagementEnabled: config.genieacsWifiManagementEnabled !== false,
        psbProvisioningEnabled: config.genieacsPsbDeviceProvisioningEnabled !== false,
        // HTTP 202 = task hanya diantrekan (modem tak terjangkau) → dihitung GAGAL.
        // Bawaannya MENYALA, menyimpang dari aturan rumah "fitur baru default OFF" — dan itu
        // disengaja: ini bukan fitur, ini KOREKSI VONIS yang sudah hidup tanpa gate di jalur PSB.
        // Default OFF berarti sengaja mempertahankan kebohongan. Saklarnya ada untuk deployment
        // ACS lain yang mungkin memulangkan 202 sebagai respons normal — matikan dengan
        // `genieacsQueuedOnlyIsFailure: false`.
        queuedOnlyIsFailure: config.genieacsQueuedOnlyIsFailure !== false,
    };
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

function logResult(result, context = {}) {
    const payload = {
        operation: result.operation,
        ok: result.ok,
        accepted: result.accepted,
        applied: result.applied,
        errorCode: result.errorCode,
        timingMs: result.timingMs,
        message: result.message,
        context,
    };

    if (result.ok) {
        console.log('[GENIEACS]', JSON.stringify(payload));
    } else {
        console.error('[GENIEACS]', JSON.stringify(payload));
    }
}

function mapAxiosError(error, defaultCode = 'CONNECT_ERROR') {
    if (!error) return defaultCode;
    if (error.code === 'ECONNABORTED') return 'TIMEOUT_ERROR';
    if (error.response?.status === 401 || error.response?.status === 403) return 'AUTH_ERROR';
    if (error.response?.status === 404) return 'NOT_FOUND';
    if (error.response) return 'TASK_SUBMISSION_ERROR';
    return defaultCode;
}

function sanitizeValue(value) {
    if (value === undefined || value === null) return null;
    const stringValue = String(value);
    return stringValue.length > 120 ? `${stringValue.slice(0, 117)}...` : stringValue;
}

// Path TR-069/TR-181 yang mengandung kredensial — value di sini WAJIB di-redact
// kalau muncul di error response yang akan masuk log.
const SENSITIVE_PATH_PATTERNS = [
    /PreSharedKey/i,
    /KeyPassphrase/i,
    /WPAEncryptionModes/i,
    /WANPPPConnection\.\d+\.Password/i,
    /PPP\.Interface\.\d+\.Password/i,
];

function isSensitiveParameterPath(path) {
    if (!path || typeof path !== 'string') return false;
    return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Ekstrak value-value sensitif dari parameterValues task. Dipakai untuk
 * redaction di error response yang sering echo-back request body.
 */
function collectSensitiveValues(taskOrPayload) {
    const out = new Set();
    const params = taskOrPayload?.parameterValues;
    if (!Array.isArray(params)) return [];
    for (const entry of params) {
        if (!Array.isArray(entry)) continue;
        const [path, value] = entry;
        if (value !== undefined && value !== null && value !== '' && isSensitiveParameterPath(path)) {
            out.add(String(value));
        }
    }
    return [...out];
}

function redactSensitive(stringified, sensitiveValues) {
    if (!stringified || !Array.isArray(sensitiveValues) || sensitiveValues.length === 0) return stringified;
    let result = String(stringified);
    for (const secret of sensitiveValues) {
        if (!secret || secret.length < 3) continue; // hindari false-positive replace untuk value pendek
        // Replace literal substring tanpa regex magic supaya tidak nge-mismatch karakter spesial.
        result = result.split(secret).join('[REDACTED]');
    }
    return result;
}

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
        const { loadJSON } = require('./database');
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

// Error code yang aman untuk retry: blip jaringan, bukan logic error.
// AUTH_ERROR & NOT_FOUND tidak boleh retry — retry hanya buang waktu.
// TASK_SUBMISSION_ERROR (5xx GenieACS) bisa transient tapi POST submitTask
// tidak strictly idempotent → biarkan caller eksplisit opt-in.
const RETRYABLE_ERROR_CODES = new Set(['TIMEOUT_ERROR', 'CONNECT_ERROR']);

function isRetryableByDefault(method) {
    const safe = String(method || '').toLowerCase();
    return safe === 'get' || safe === 'head';
}

function resolveRetryAttempts(options, method) {
    if (options.retryable === false) return 1;
    const configured = parseInt(global.config?.genieacsRetryAttempts, 10);
    const maxAttempts = Number.isFinite(configured) && configured >= 1 ? configured : DEFAULT_RETRY_MAX_ATTEMPTS;
    if (options.retryable === true) return maxAttempts;
    return isRetryableByDefault(method) ? maxAttempts : 1;
}

/**
 * Per-device serialize: chain operasi mutasi untuk deviceId yang sama supaya
 * tidak ada race condition di GenieACS task queue. Beda device tetap paralel.
 *
 * Pattern: setiap call dapat slot di akhir antrian. Slot itu jadi tail di
 * `deviceLocks`. Caller berikutnya await tail sebelumnya, lalu jalan, lalu
 * release. Setelah release, kalau kita masih tail (nobody queued behind),
 * hapus dari Map biar tidak memory leak.
 *
 * Catatan: hanya in-process. Multi-instance deployment butuh distributed lock
 * (out-of-scope). Mutex tidak block read — read concurrent aman.
 */
async function withDeviceLock(deviceId, fn) {
    if (!deviceId) return fn();
    const previous = deviceLocks.get(deviceId) || Promise.resolve();
    let releaseSlot;
    const slot = new Promise((resolve) => { releaseSlot = resolve; });
    deviceLocks.set(deviceId, slot);
    try {
        await previous;
        return await fn();
    } finally {
        releaseSlot();
        if (deviceLocks.get(deviceId) === slot) {
            deviceLocks.delete(deviceId);
        }
    }
}

async function genieacsRequest(method, path, options = {}) {
    const config = getGenieAcsConfig();
    if (!config.valid) {
        return createResult(options.operation || 'genieacsRequest', {
            message: `Konfigurasi GenieACS tidak lengkap: ${config.missing.join(', ')}`,
            errorCode: 'CONFIG_ERROR',
            details: { config },
        });
    }

    // Fail-fast kalau breaker open — hindari nunggu timeout × retry saat GenieACS down.
    const circuitBlock = checkCircuit();
    if (circuitBlock) {
        return createResult(options.operation || 'genieacsRequest', {
            message: circuitBlock.message,
            errorCode: circuitBlock.code,
            details: { circuit: { state: circuitState.state, openUntil: circuitBlock.openUntil } },
        });
    }

    const maxAttempts = resolveRetryAttempts(options, method);
    const baseDelayMs = parseInt(global.config?.genieacsRetryBaseDelayMs, 10);
    const retryBaseDelay = Number.isFinite(baseDelayMs) && baseDelayMs >= 0 ? baseDelayMs : DEFAULT_RETRY_BASE_DELAY_MS;
    const startedAt = Date.now();
    let lastError = null;
    let lastResponseData = null;
    let lastHttpStatus = null;
    let lastErrorCode = null;
    let attempt = 0;

    while (attempt < maxAttempts) {
        attempt += 1;
        try {
            const response = await axios({
                method,
                url: `${config.baseUrl}${path}`,
                data: options.data,
                params: options.params,
                timeout: options.timeoutMs || config.timeoutMs,
                httpAgent,
                httpsAgent,
                ...(config.auth ? { auth: config.auth } : {}),
            });

            recordCircuitSuccess();
            return createResult(options.operation || 'genieacsRequest', {
                ok: true,
                message: options.successMessage || 'Permintaan GenieACS berhasil.',
                data: response.data,
                details: { httpStatus: response.status, attempts: attempt },
                timingMs: Date.now() - startedAt,
            });
        } catch (error) {
            lastError = error;
            lastHttpStatus = error.response?.status || null;
            lastResponseData = error.response?.data ?? null;
            lastErrorCode = mapAxiosError(error);

            // Hanya retry kalau error transient DAN masih ada attempt tersisa.
            const canRetry = RETRYABLE_ERROR_CODES.has(lastErrorCode) && attempt < maxAttempts;
            if (!canRetry) break;

            // Exponential backoff: 250, 500, 1000 ms. + jitter ±20% supaya
            // kalau ada thundering herd, retry tersebar.
            const baseWait = retryBaseDelay * Math.pow(2, attempt - 1);
            const jitter = baseWait * 0.2 * (Math.random() - 0.5);
            const waitMs = Math.max(0, Math.floor(baseWait + jitter));
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }

    // `deviceBound` = kegagalan ini menyangkut SATU modem (connection-request), bukan kesehatan
    // transport ke server ACS. Lihat catatan di `recordCircuitFailure`.
    recordCircuitFailure(lastErrorCode, { deviceBound: options.deviceBound === true });
    const rawResponseString = JSON.stringify(lastResponseData);
    const redactedResponseString = redactSensitive(rawResponseString, options.sensitiveValues);
    return createResult(options.operation || 'genieacsRequest', {
        message: options.failureMessage || lastError?.message || 'Permintaan GenieACS gagal.',
        errorCode: lastErrorCode,
        details: {
            httpStatus: lastHttpStatus,
            response: sanitizeValue(redactedResponseString),
            attempts: attempt,
        },
        timingMs: Date.now() - startedAt,
    });
}

async function submitTask(deviceId, task, operation, options = {}) {
    const startedAt = Date.now();
    if (!deviceId) {
        return createResult(operation, {
            message: 'Device ID diperlukan.',
            errorCode: 'NOT_FOUND',
            timingMs: Date.now() - startedAt,
        });
    }

    const requestResult = await genieacsRequest('post', `/devices/${encodeURIComponent(deviceId)}/tasks?connection_request`, {
        operation,
        data: task,
        timeoutMs: options.timeoutMs,
        // SETIAP submitTask lewat `?connection_request`, jadi timeout di sini artinya MODEM yang
        // tak menjawab — bukan ACS yang rusak. Jangan biarkan modem bisu menjatuhkan breaker
        // global yang dipakai bersama cek-wifi, PSB, reboot, dan panel admin (#b251).
        deviceBound: true,
        successMessage: options.successMessage || 'Task GenieACS berhasil dikirim.',
        failureMessage: options.failureMessage || 'Gagal mengirim task ke GenieACS.',
        // POST submitTask NOT retried — GenieACS bisa double-queue task kalau request
        // pertama sukses di server tapi response hilang di jaringan. verifyAppliedValues
        // di layer atas yang akan handle "task submitted but not yet applied".
        retryable: false,
        // Password / WPA key di parameterValues bisa di-echo ulang di error response;
        // redact sebelum masuk log file.
        sensitiveValues: collectSensitiveValues(task),
    });

    // ⚠️ BELUM DIPAKAI UNTUK MEMUTUSKAN — sengaja hanya DICATAT.
    //
    // Menurut dokumentasi NBI GenieACS, 200 = task dieksekusi (connection-request berhasil) dan
    // 202 = task hanya diantrikan (modem tak terjangkau). Kalau itu berlaku di deployment ini,
    // jalur PSB sedang mengumumkan "modem sudah dikonfigurasi" untuk modem yang belum tersentuh.
    //
    // TAPI premis itu BELUM TERUKUR di sini: test lama (`lib/__tests__/genieacs.test.js`) memakai
    // 202 sebagai respons SUKSES yang normal untuk submit task. Mengubah keputusan berdasarkan
    // asumsi yang belum diadu ke ACS nyata berisiko membuat perubahan WiFi & PSB yang SEBENARNYA
    // berhasil dilaporkan gagal — teknisi terhenti, pelanggan tak terpasang.
    //
    // Jadi nilainya direkam dulu supaya distribusinya bisa DIUKUR dari log produksi. Setelah
    // terbukti, barulah ia boleh menjadi dasar vonis. (Prinsip repo: kalibrasi ambang dari
    // telemetri terukur, bukan dari intuisi.)
    const httpStatus = requestResult?.details?.httpStatus || null;
    const queuedOnly = httpStatus === 202;

    const result = createResult(operation, {
        ...requestResult,
        accepted: requestResult.ok,
        applied: options.verifyApplied ? false : null,
        timingMs: Date.now() - startedAt,
    });
    result.details = { ...(result.details || {}), httpStatus, queuedOnly };

    if (requestResult.ok) {
        result.data = {
            taskId: requestResult.data?._id || null,
            response: requestResult.data,
        };
    }

    return result;
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
    settled.forEach((entry, index) => {
        if (entry.status === 'fulfilled' && entry.value.ok) {
            refreshedObjects.push(names[index]);
        } else {
            failed.push({
                objectName: names[index],
                message: entry.status === 'fulfilled' ? entry.value.message : entry.reason?.message,
            });
        }
    });

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

async function verifyAppliedValues(deviceId, verificationPaths, refreshObjects, operation, options = {}) {
    const startedAt = Date.now();
    const config = getGenieAcsConfig();
    const verifyTimeoutMs = options.verifyTimeoutMs || config.verifyTimeoutMs;
    const verifyIntervalMs = options.verifyIntervalMs || config.verifyIntervalMs;
    const verificationMode = options.verificationMode || 'strict_readback';
    const allowSensitiveReadback = options.verifySensitive === true || verificationMode === 'strict_readback_all';
    const pathsToVerify = verificationPaths.filter((entry) => allowSensitiveReadback || !entry.sensitive);
    const unverifiedPaths = verificationPaths
        .filter((entry) => entry.sensitive && !allowSensitiveReadback)
        .map((entry) => entry.path);

    if (pathsToVerify.length === 0) {
        return createResult(operation, {
            ok: true,
            accepted: true,
            applied: true,
            message: 'Task GenieACS diterima tanpa readback sensitif.',
            details: {
                verificationMode,
                verifiedPaths: [],
                unverifiedPaths,
            },
            timingMs: Date.now() - startedAt,
        });
    }

    let lastDeviceResult = null;

    if (refreshObjects.length > 0) {
        await refreshDeviceObjects(deviceId, refreshObjects, { operation: `${operation}.refresh` });
    }

    const deadline = Date.now() + verifyTimeoutMs;

    while (Date.now() <= deadline) {
        lastDeviceResult = await getDeviceRecord(deviceId, pathsToVerify.map((entry) => entry.path), {
            operation: `${operation}.verify`,
        });
        if (lastDeviceResult.ok) {
            const mismatches = pathsToVerify.filter((entry) => unwrapValue(getNestedValue(lastDeviceResult.data, entry.path)) !== entry.expectedValue);
            if (mismatches.length === 0) {
                return createResult(operation, {
                    ok: true,
                    accepted: true,
                    applied: true,
                    message: 'Perubahan GenieACS berhasil diterapkan dan tervalidasi.',
                    data: lastDeviceResult.data,
                    details: {
                        verificationMode,
                        verifiedPaths: pathsToVerify.map((entry) => entry.path),
                        unverifiedPaths,
                    },
                    timingMs: Date.now() - startedAt,
                });
            }
        }

        await new Promise((resolve) => setTimeout(resolve, verifyIntervalMs));
    }

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: false,
        message: 'Task GenieACS diterima, tetapi perubahan belum tervalidasi pada device.',
        errorCode: 'TASK_NOT_APPLIED',
        data: lastDeviceResult?.data || null,
        details: {
            verificationMode,
            verifiedPaths: pathsToVerify.map((entry) => entry.path),
            unverifiedPaths,
        },
        timingMs: Date.now() - startedAt,
    });
}

async function setParameterValues(deviceId, parameterValues = [], options = {}) {
    return withDeviceLock(deviceId, () => setParameterValuesInternal(deviceId, parameterValues, options));
}

async function setParameterValuesInternal(deviceId, parameterValues = [], options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'setParameterValues';
    const normalizedValues = Array.isArray(parameterValues) ? parameterValues.filter((entry) => Array.isArray(entry) && entry[0]) : [];
    const verificationPaths = Array.isArray(options.verificationPaths) ? options.verificationPaths.filter((entry) => entry && entry.path) : [];
    const refreshObjectsList = uniqueValues(
        Array.isArray(options.refreshObjects)
            ? options.refreshObjects
            : verificationPaths.map((entry) => deriveObjectNameFromPath(entry.path))
    );
    const verificationMode = options.verificationMode || (verificationPaths.some((entry) => !entry.sensitive) ? 'strict_readback' : 'accept_task_only');

    if (normalizedValues.length === 0) {
        return createResult(operation, {
            message: 'Tidak ada parameter GenieACS yang dikirim.',
            errorCode: 'PARSE_ERROR',
            timingMs: Date.now() - startedAt,
        });
    }

    const submitResult = await submitTask(deviceId, {
        name: 'setParameterValues',
        parameterValues: normalizedValues,
    }, operation, {
        successMessage: options.successMessage || 'Task perubahan parameter berhasil dikirim ke GenieACS.',
        failureMessage: options.failureMessage || 'Gagal mengirim perubahan parameter ke GenieACS.',
        timeoutMs: options.timeoutMs,
    });

    if (!submitResult.ok || verificationMode === 'accept_task_only' || verificationPaths.length === 0) {
        submitResult.accepted = submitResult.ok;
        submitResult.applied = submitResult.ok ? null : submitResult.applied;

        // !! PENEGAKAN PUSAT `queuedOnly` (#b254).
        // Inilah titik yang benar, bukan `submitTask`: di sini kita TAHU verifikasi baca-balik
        // tidak akan dilakukan (mode `accept_task_only` dipilih justru karena sandi WiFi/PPPoE
        // TAK BISA dibaca balik), jadi status HTTP adalah SATU-SATUNYA bukti keterjangkauan.
        // Terukur di produksi: 29 dari 29 modem terjangkau memulangkan 200 — nol 202 palsu.
        // Tanpa ini, ganti sandi WiFi ke modem yang tak menjawab dilaporkan BERHASIL, dan
        // pelanggan diberi sandi baru yang tak pernah sampai ke modemnya.
        if (submitResult.ok
            && submitResult.details && submitResult.details.queuedOnly
            && getGenieAcsFeatureFlags().queuedOnlyIsFailure) {
            submitResult.ok = false;
            submitResult.accepted = true;   // ACS memang MENERIMA task-nya…
            submitResult.applied = false;   // …tapi modemnya TIDAK menerapkan.
            submitResult.errorCode = submitResult.errorCode || 'DEVICE_UNREACHABLE';
            submitResult.message = 'Modem tidak menjawab saat dihubungi — setelan hanya masuk antrean GenieACS, BELUM diterapkan ke modem.';
        }

        submitResult.details = {
            ...(submitResult.details || {}),
            verificationMode,
            verifiedPaths: [],
            unverifiedPaths: verificationPaths.map((entry) => entry.path),
        };
        submitResult.timingMs = Date.now() - startedAt;
        return submitResult;
    }

    const verifyResult = await verifyAppliedValues(deviceId, verificationPaths, refreshObjectsList, operation, {
        ...options,
        verificationMode,
    });
    verifyResult.accepted = true;
    verifyResult.data = {
        ...(verifyResult.data || {}),
        taskId: submitResult.data?.taskId || null,
    };
    verifyResult.timingMs = Date.now() - startedAt;
    return verifyResult;
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

async function rebootDevice(deviceId, options = {}) {
    return withDeviceLock(deviceId, async () => {
        const startedAt = Date.now();
        const result = await submitTask(deviceId, { name: 'reboot' }, 'rebootDevice', {
            verifyApplied: false,
            successMessage: 'Perintah reboot berhasil dikirim ke GenieACS.',
        });

        if (result.ok) {
            result.applied = null;
            result.message = 'Perintah reboot diterima GenieACS.';
        }

        result.timingMs = Date.now() - startedAt;
        logResult(result, options.context);
        return result;
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

function toLegacyMutationResult(result) {
    return {
        success: result.ok && result.accepted && result.applied !== false,
        ok: result.ok,
        accepted: result.accepted,
        applied: result.applied,
        message: result.message,
        errorCode: result.errorCode,
        details: result.details,
        timingMs: result.timingMs,
        taskId: result.data?.taskId || null,
        data: result.data || null,
    };
}

module.exports = {
    createResult,
    getGenieAcsConfig,
    getGenieAcsFeatureStatus,
    parseWifiPayload,
    getParameterPaths,
    resolvePathTemplates,
    getDefaultPaths,
    getNestedValue,
    unwrapValue,
    queryDevices,
    getDeviceById,
    getParameterValue,
    getParameterValueByPath,
    setParameterValues,
    refreshObjects,
    probeDeviceReachable,
    extractPppoeUsername,
    extractPppoeUsernames,
    extractPppoePassword,
    extractSerialNumber,
    extractDeviceModel,
    extractDeviceManufacturer,
    extractRegisteredDate,
    extractRegisteredTimestamp,
    getWifiInfo,
    getCustomerRedaman,
    getConnectedDevices,
    getDeviceInfo,
    getDeviceCoreInfo,
    getMultipleDeviceMetrics,
    getPsbDevice,
    refreshDeviceObjects,
    rebootDevice,
    setWifiCredentials,
    setWifiName,
    setWifiPassword,
    applyBulkWifiUpdates,
    setBulkWifiPasswords,
    setBulkWifiNames,
    setWifiTransmitPower,
    setPPPoECredentials,
    updatePsbDeviceConfig,
    updateWifiSettings,
    getGenieAcsDiagnostics,
    toLegacyMutationResult,
    // Internal — diekspos hanya untuk test, jangan dipanggil dari luar.
    _resetCircuitForTests,
};
