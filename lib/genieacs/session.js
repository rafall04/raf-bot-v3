/**
 * Header Doc
 * Purpose: Transport & state GenieACS — http agents, circuit breaker, per-device lock, retry, redact sensitif, genieacsRequest/submitTask.
 * Caller: facade `lib/genieacs.js` (re-export; jangan require langsung kecuali test).
 * Deps: axios, http, https.
 * MainFuncs: `genieacsRequest`, `submitTask`, `withDeviceLock`, `checkCircuit`, `createResult`, `getGenieAcsConfig`.
 * SideEffects: sama seperti lib/genieacs.js asli (split #b393 — murni pemindahan kode).
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


module.exports = {
    axios,
    http,
    https,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_VERIFY_TIMEOUT_MS,
    DEFAULT_VERIFY_INTERVAL_MS,
    KEEPALIVE_AGENT_OPTIONS,
    httpAgent,
    httpsAgent,
    destroyGenieAgents,
    DEFAULT_RETRY_MAX_ATTEMPTS,
    DEFAULT_RETRY_BASE_DELAY_MS,
    deviceLocks,
    CIRCUIT_DEFAULT_THRESHOLD,
    CIRCUIT_DEFAULT_OPEN_MS,
    circuitState,
    getCircuitConfig,
    recordCircuitSuccess,
    recordCircuitFailure,
    checkCircuit,
    _resetCircuitForTests,
    createResult,
    getGenieAcsConfig,
    getGenieAcsFeatureFlags,
    logResult,
    mapAxiosError,
    sanitizeValue,
    SENSITIVE_PATH_PATTERNS,
    isSensitiveParameterPath,
    collectSensitiveValues,
    redactSensitive,
    RETRYABLE_ERROR_CODES,
    isRetryableByDefault,
    resolveRetryAttempts,
    withDeviceLock,
    genieacsRequest,
    submitTask,
};
