const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_OUTPUT = 1024 * 1024;

// Singleton keepAlive agents — sama pattern dengan lib/genieacs.js. Untuk
// `getJsonOverHttp` ke local PHP (siteUrl), pool reuse TCP socket supaya
// tidak handshake fresh tiap voucher/PPPoE create.
const KEEPALIVE_AGENT_OPTIONS = { keepAlive: true, maxSockets: 20, maxFreeSockets: 10, timeout: 60000 };
const httpAgent = new http.Agent(KEEPALIVE_AGENT_OPTIONS);
const httpsAgent = new https.Agent(KEEPALIVE_AGENT_OPTIONS);

// Cache config in-memory — sebelumnya tiap call baca .env + mikrotik_devices.json
// dari disk. Untuk hot path "create voucher" yang trigger berkali-kali per detik,
// ini hilangkan disk I/O hit. TTL 5 menit supaya admin edit config tetap kepick
// dengan delay yang wajar. Manual invalidate via invalidateMikrotikConfigCache()
// untuk test atau on-demand reload.
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
let configCache = null;
let configCacheExpiresAt = 0;

function invalidateMikrotikConfigCache() {
    configCache = null;
    configCacheExpiresAt = 0;
}

// Retry & circuit breaker — pattern dipinjam dari lib/genieacs.js. Shared state
// karena cuma 1 MikroTik device per instance bot (single source of truth).
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const RETRYABLE_ERROR_CODES = new Set(['TIMEOUT_ERROR']);

// Circuit breaker untuk MikroTik. Tidak hitung COMMAND_ERROR karena itu bisa
// jadi indikasi user input invalid, bukan device down — false positive akan
// trip breaker dan blok user yang valid.
const CIRCUIT_DEFAULT_THRESHOLD = 5;
const CIRCUIT_DEFAULT_OPEN_MS = 30000;
const circuitState = {
    consecutiveFailures: 0,
    state: 'closed',
    openUntil: 0,
    probeInFlight: false,
};

function getMikrotikRetryConfig() {
    const attempts = parseInt(global.config?.mikrotikRetryAttempts, 10);
    const baseDelay = parseInt(global.config?.mikrotikRetryBaseDelayMs, 10);
    return {
        maxAttempts: Number.isFinite(attempts) && attempts >= 1 ? attempts : DEFAULT_RETRY_MAX_ATTEMPTS,
        baseDelay: Number.isFinite(baseDelay) && baseDelay >= 0 ? baseDelay : DEFAULT_RETRY_BASE_DELAY_MS,
    };
}

function getMikrotikCircuitConfig() {
    const threshold = parseInt(global.config?.mikrotikCircuitFailureThreshold, 10);
    const openMs = parseInt(global.config?.mikrotikCircuitOpenMs, 10);
    return {
        threshold: Number.isFinite(threshold) && threshold >= 1 ? threshold : CIRCUIT_DEFAULT_THRESHOLD,
        openMs: Number.isFinite(openMs) && openMs >= 0 ? openMs : CIRCUIT_DEFAULT_OPEN_MS,
        enabled: global.config?.mikrotikCircuitEnabled !== false,
    };
}

function recordMikrotikSuccess() {
    circuitState.consecutiveFailures = 0;
    circuitState.state = 'closed';
    circuitState.openUntil = 0;
    circuitState.probeInFlight = false;
}

function recordMikrotikFailure(errorCode) {
    if (!RETRYABLE_ERROR_CODES.has(errorCode)) {
        circuitState.probeInFlight = false;
        return;
    }
    circuitState.consecutiveFailures += 1;
    const { threshold, openMs } = getMikrotikCircuitConfig();
    if (circuitState.consecutiveFailures >= threshold) {
        circuitState.state = 'open';
        circuitState.openUntil = Date.now() + openMs;
    }
    circuitState.probeInFlight = false;
}

function checkMikrotikCircuit() {
    const { enabled } = getMikrotikCircuitConfig();
    if (!enabled || circuitState.state === 'closed') return null;
    const now = Date.now();
    if (circuitState.state === 'open') {
        if (now >= circuitState.openUntil) {
            circuitState.state = 'half-open';
            circuitState.probeInFlight = false;
        } else {
            return {
                code: 'CIRCUIT_OPEN',
                message: 'MikroTik sedang bermasalah, request ditolak sementara (circuit breaker open). Coba lagi sebentar.',
                openUntil: circuitState.openUntil,
            };
        }
    }
    if (circuitState.state === 'half-open') {
        if (circuitState.probeInFlight) {
            return {
                code: 'CIRCUIT_OPEN',
                message: 'Sedang memeriksa pemulihan MikroTik, request lain ditolak sementara.',
                openUntil: circuitState.openUntil,
            };
        }
        circuitState.probeInFlight = true;
    }
    return null;
}

function _resetMikrotikCircuitForTests() {
    circuitState.consecutiveFailures = 0;
    circuitState.state = 'closed';
    circuitState.openUntil = 0;
    circuitState.probeInFlight = false;
}

/**
 * Wrapper retry untuk operasi MikroTik. Default skip retry untuk
 * non-idempotent ops (voucher create dengan random username).
 *
 * @param {() => Promise<result>} fn - operasi yang return createResult-shape
 * @param {object} options
 * @param {boolean} options.retryable - default true. Set false untuk voucher create / add ops yang non-idempotent.
 */
async function withMikrotikRetry(fn, options = {}) {
    const retryable = options.retryable !== false;
    const { maxAttempts, baseDelay } = getMikrotikRetryConfig();
    const maxAttemptsToUse = retryable ? maxAttempts : 1;

    // Circuit breaker check sebelum attempt pertama.
    const block = checkMikrotikCircuit();
    if (block) {
        return createResult(options.operation || 'mikrotikRetry', {
            message: block.message,
            errorCode: block.code,
            details: { circuit: { state: circuitState.state, openUntil: block.openUntil } },
        });
    }

    let lastResult = null;
    for (let attempt = 1; attempt <= maxAttemptsToUse; attempt += 1) {
        lastResult = await fn();
        if (lastResult?.ok) {
            recordMikrotikSuccess();
            if (lastResult.details && typeof lastResult.details === 'object') {
                lastResult.details = { ...lastResult.details, attempts: attempt };
            }
            return lastResult;
        }
        // Hanya retry kalau transient + masih ada attempt tersisa.
        if (!RETRYABLE_ERROR_CODES.has(lastResult?.errorCode) || attempt >= maxAttemptsToUse) {
            break;
        }
        const baseWait = baseDelay * Math.pow(2, attempt - 1);
        const jitter = baseWait * 0.2 * (Math.random() - 0.5);
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.floor(baseWait + jitter))));
    }

    recordMikrotikFailure(lastResult?.errorCode);
    if (lastResult?.details && typeof lastResult.details === 'object') {
        lastResult.details = { ...lastResult.details, attempts: maxAttemptsToUse };
    }
    return lastResult;
}

function sanitizeValue(value) {
    if (value === undefined || value === null) return null;
    const stringValue = String(value);
    if (stringValue.length > 120) {
        return `${stringValue.slice(0, 117)}...`;
    }
    return stringValue;
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
        ...overrides,
    };
}

function parseBooleanLike(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return null;
}

function readDotEnvConfig() {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        return {};
    }

    try {
        const fileContent = fs.readFileSync(envPath, 'utf8');
        const parsed = {};

        fileContent.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                return;
            }

            const separatorIndex = trimmed.indexOf('=');
            if (separatorIndex === -1) {
                return;
            }

            const key = trimmed.slice(0, separatorIndex).trim();
            let value = trimmed.slice(separatorIndex + 1).trim();

            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            parsed[key] = value;
        });

        return parsed;
    } catch (error) {
        console.warn('[MIKROTIK_CONFIG_DOTENV_WARN]', error.message);
        return {};
    }
}

function readActiveMikrotikDevice() {
    const devicesPath = path.resolve(__dirname, '..', 'database', 'mikrotik_devices.json');
    if (!fs.existsSync(devicesPath)) {
        return null;
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(devicesPath, 'utf8'));
        if (!Array.isArray(parsed)) {
            return null;
        }

        return parsed.find((device) => device && device.active) || parsed[0] || null;
    } catch (error) {
        console.warn('[MIKROTIK_CONFIG_DEVICE_WARN]', error.message);
        return null;
    }
}

function getMikrotikConfig() {
    const now = Date.now();
    if (configCache && now < configCacheExpiresAt) {
        return configCache;
    }
    const env = process.env;
    const fileEnv = readDotEnvConfig();
    const activeDevice = readActiveMikrotikDevice();
    const host = env.IP_MC || env.MIKROTIK_HOST || fileEnv.IP_MC || fileEnv.MIKROTIK_HOST || activeDevice?.ip || null;
    const username = env.NAME_MC || env.MIKROTIK_USER || fileEnv.NAME_MC || fileEnv.MIKROTIK_USER || activeDevice?.name || null;
    const rawPassword = env.PASSWORD_MC || env.MIKROTIK_PASSWORD || fileEnv.PASSWORD_MC || fileEnv.MIKROTIK_PASSWORD || activeDevice?.password || null;
    const sslValue = env.SSL_MC ?? env.MIKROTIK_SSL ?? fileEnv.SSL_MC ?? fileEnv.MIKROTIK_SSL ?? 'false';
    const parsedSsl = parseBooleanLike(sslValue);
    const ssl = parsedSsl === null ? false : parsedSsl;
    const port = parseInt(
        env.PORT_MC || env.MIKROTIK_PORT || fileEnv.PORT_MC || fileEnv.MIKROTIK_PORT || activeDevice?.port || (ssl ? '8729' : '8728'),
        10
    );

    const result = {
        host,
        username,
        password: rawPassword ? '[configured]' : null,
        port: Number.isFinite(port) ? port : (ssl ? 8729 : 8728),
        ssl,
        valid: Boolean(host && username && rawPassword),
        missing: ['host', 'username', 'password'].filter((key) => {
            if (key === 'host') return !host;
            if (key === 'username') return !username;
            return !rawPassword;
        }),
        source: {
            env: Boolean(env.IP_MC || env.MIKROTIK_HOST || env.NAME_MC || env.MIKROTIK_USER || env.PASSWORD_MC || env.MIKROTIK_PASSWORD),
            dotenv: Boolean(fileEnv.IP_MC || fileEnv.MIKROTIK_HOST || fileEnv.NAME_MC || fileEnv.MIKROTIK_USER || fileEnv.PASSWORD_MC || fileEnv.MIKROTIK_PASSWORD),
            activeDevice: activeDevice ? {
                id: activeDevice.id || null,
                ip: activeDevice.ip || null,
                port: activeDevice.port || null,
            } : null,
        },
    };
    configCache = result;
    configCacheExpiresAt = now + CONFIG_CACHE_TTL_MS;
    return result;
}

function isMikrotikSyncEnabled(config = global.config) {
    const rawValue = config?.sync_to_mikrotik;
    if (rawValue === undefined || rawValue === null) {
        return true;
    }

    if (typeof rawValue === 'string') {
        return rawValue.toLowerCase() !== 'false';
    }

    return rawValue !== false;
}

function logResult(result, context = {}) {
    const logPayload = {
        operation: result.operation,
        ok: result.ok,
        errorCode: result.errorCode,
        timingMs: result.timingMs,
        message: result.message,
        context,
    };

    if (result.ok) {
        console.log('[MIKROTIK]', JSON.stringify(logPayload));
    } else {
        console.error('[MIKROTIK]', JSON.stringify(logPayload));
    }
}

function parseBridgeResponse(operation, stdout, stderr, startedAt) {
    const timingMs = Date.now() - startedAt;
    const trimmedStdout = (stdout || '').trim();
    const trimmedStderr = (stderr || '').trim();

    if (!trimmedStdout) {
        return createResult(operation, {
            message: trimmedStderr || 'Bridge MikroTik tidak mengembalikan output.',
            errorCode: 'PARSE_ERROR',
            details: {
                stderr: sanitizeValue(trimmedStderr),
            },
            timingMs,
        });
    }

    let parsed;
    try {
        parsed = JSON.parse(trimmedStdout);
    } catch (error) {
        return createResult(operation, {
            message: `Output bridge MikroTik tidak valid: ${error.message}`,
            errorCode: 'PARSE_ERROR',
            details: {
                stdout: sanitizeValue(trimmedStdout),
                stderr: sanitizeValue(trimmedStderr),
            },
            timingMs,
        });
    }

    const ok = parsed.status === 'success';
    return createResult(operation, {
        ok,
        data: parsed.data ?? null,
        message: parsed.message || (ok ? 'Operasi MikroTik berhasil.' : 'Operasi MikroTik gagal.'),
        errorCode: ok ? null : (parsed.error_code || 'COMMAND_ERROR'),
        details: {
            bridge: parsed,
            stderr: trimmedStderr || null,
        },
        timingMs,
    });
}

function runPhpMikrotik(operation, script, args = [], options = {}) {
    const startedAt = Date.now();
    const scriptPath = path.resolve(__dirname, '..', 'views', `${script}.php`);
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    const maxOutput = options.maxOutput || DEFAULT_MAX_OUTPUT;

    return new Promise((resolve) => {
        const config = getMikrotikConfig();
        if (!config.valid) {
            const result = createResult(operation, {
                message: `Konfigurasi MikroTik tidak lengkap: ${config.missing.join(', ')}`,
                errorCode: 'CONFIG_ERROR',
                details: { config },
                timingMs: Date.now() - startedAt,
            });
            logResult(result, options.context);
            return resolve(result);
        }

        const child = spawn('php', [scriptPath, ...args.map((arg) => String(arg))], {
            cwd: path.resolve(__dirname, '..'),
            windowsHide: true,
            env: process.env,
        });

        let stdout = '';
        let stderr = '';
        let finished = false;
        let timedOut = false;

        const finalize = (result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            logResult(result, options.context);
            resolve(result);
        };

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
            finalize(createResult(operation, {
                message: `Operasi MikroTik timeout setelah ${timeoutMs}ms.`,
                errorCode: 'TIMEOUT_ERROR',
                details: { script, timeoutMs },
                timingMs: Date.now() - startedAt,
            }));
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
            if (stdout.length > maxOutput) {
                stdout = stdout.slice(0, maxOutput);
            }
        });

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > maxOutput) {
                stderr = stderr.slice(0, maxOutput);
            }
        });

        child.on('error', (error) => {
            finalize(createResult(operation, {
                message: `Gagal menjalankan bridge MikroTik: ${error.message}`,
                errorCode: 'COMMAND_ERROR',
                details: { script, error: error.message },
                timingMs: Date.now() - startedAt,
            }));
        });

        child.on('close', (code, signal) => {
            if (timedOut) return;

            const result = parseBridgeResponse(operation, stdout, stderr, startedAt);
            if (code !== 0 && result.ok) {
                result.ok = false;
                result.errorCode = 'COMMAND_ERROR';
                result.message = result.message || `Bridge MikroTik keluar dengan status ${code}.`;
            }

            if (signal && !result.errorCode) {
                result.ok = false;
                result.errorCode = 'COMMAND_ERROR';
                result.message = `Bridge MikroTik dihentikan oleh signal ${signal}.`;
            }

            finalize(result);
        });
    });
}

function assertMikrotikResult(result, fallbackMessage = null) {
    if (!result || result.ok !== true) {
        const error = new Error(fallbackMessage || result?.message || 'Operasi MikroTik gagal.');
        error.code = result?.errorCode || 'COMMAND_ERROR';
        error.result = result || null;
        throw error;
    }
    return result;
}

async function getJsonOverHttp(operation, url, options = {}) {
    const startedAt = Date.now();
    const method = String(options.method || 'get').toLowerCase();
    try {
        let response;
        if (method === 'post') {
            // Untuk request yang mengandung kredensial (PPPoE password), kita
            // sengaja POST dengan body JSON supaya value TIDAK masuk URL query
            // string yang biasanya diakses-log webserver.
            response = await axios.post(url, options.body || {}, {
                timeout: options.timeoutMs || 15000,
                httpAgent,
                httpsAgent,
                headers: { 'Content-Type': 'application/json' },
            });
        } else {
            response = await axios.get(url, {
                params: options.params || {},
                timeout: options.timeoutMs || 15000,
                httpAgent,
                httpsAgent,
            });
        }

        return createResult(operation, {
            ok: true,
            data: response.data?.data ?? response.data,
            message: response.data?.message || 'Operasi MikroTik berhasil.',
            timingMs: Date.now() - startedAt,
            details: {
                httpStatus: response.status,
            },
        });
    } catch (error) {
        return createResult(operation, {
            message: error.message || 'Permintaan HTTP MikroTik gagal.',
            errorCode: error.code === 'ECONNABORTED' ? 'TIMEOUT_ERROR' : 'COMMAND_ERROR',
            details: {
                httpStatus: error.response?.status || null,
            },
            timingMs: Date.now() - startedAt,
        });
    }
}

function getSiteUrl() {
    const siteUrl = global.config?.site_url_bot;
    if (!siteUrl) {
        return createResult('mikrotik_http_helper', {
            message: "Konfigurasi 'site_url_bot' tidak ditemukan.",
            errorCode: 'CONFIG_ERROR',
        });
    }
    return siteUrl;
}

// Read & idempotent mutation ops di bawah — semua aman di-retry oleh
// withMikrotikRetry. PHP `adduserpppoe.php` sudah dedup (return DUPLICATE)
// jadi addPPPoEUser tetap aman.
async function updatePPPoEProfile(username, newProfile, context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('updatePPPoEProfile', 'update_pppoe_profile', [username, newProfile], { context }),
        { operation: 'updatePPPoEProfile' }
    );
}

async function deleteActivePPPoEUser(username, context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('deleteActivePPPoEUser', 'delete_active_pppoe_user', [username], { context }),
        { operation: 'deleteActivePPPoEUser' }
    );
}

async function getPPPProfiles(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getPPPProfiles', 'get_ppp_profiles', [], { context }),
        { operation: 'getPPPProfiles' }
    );
}

async function getActivePPPoEUsers(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getActivePPPoEUsers', 'get_ppp_active_optimized', [], { context, timeoutMs: 12000 }),
        { operation: 'getActivePPPoEUsers' }
    );
}

async function getPPPUsers(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getPPPUsers', 'get_pppoe_users', [], { context }),
        { operation: 'getPPPUsers' }
    );
}

async function getHotspotProfiles(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getHotspotProfiles', 'get_hotspot_profiles', [], { context }),
        { operation: 'getHotspotProfiles' }
    );
}

async function addPPPoEUser(username, password, profile, context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('addPPPoEUser', 'adduserpppoe', [username, password, profile], {
            context: { ...context, username: sanitizeValue(username), profile: sanitizeValue(profile) },
        }),
        { operation: 'addPPPoEUser' } // safe: PHP dedup returns DUPLICATE pada retry kalau attempt pertama sukses
    );
}

async function getPPPoEUserProfile(username, context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getPPPoEUserProfile', 'get_pppoe_user_profile', [username], { context }),
        { operation: 'getPPPoEUserProfile' }
    );
}

async function checkPPPoEUserExists(username, context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('checkPPPoEUserExists', 'check_pppoe_username_exists', [username], { context }),
        { operation: 'checkPPPoEUserExists' }
    );
}

async function getPppStats(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getPppStats', 'get_ppp_stats', [], { context, timeoutMs: 12000 }),
        { operation: 'getPppStats' }
    );
}

async function getHotspotStats(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getHotspotStats', 'get_hotspot_stats', [], { context, timeoutMs: 12000 }),
        { operation: 'getHotspotStats' }
    );
}

async function getActiveHotspotUsers(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getActiveHotspotUsers', 'get_hotspot_active_users', [], { context, timeoutMs: 12000 }),
        { operation: 'getActiveHotspotUsers' }
    );
}

async function statusap(context = {}) {
    return withMikrotikRetry(async () => {
        const siteUrl = getSiteUrl();
        if (typeof siteUrl !== 'string') {
            return siteUrl;
        }
        const startedAt = Date.now();
        try {
            const response = await axios.get(`${siteUrl}/interface.php`, {
                timeout: 15000,
                httpAgent,
                httpsAgent,
            });
            return createResult('statusap', {
                ok: true,
                data: response.data,
                message: 'Status access point berhasil diambil.',
                timingMs: Date.now() - startedAt,
                details: { httpStatus: response.status },
            });
        } catch (error) {
            return createResult('statusap', {
                message: error.message || 'Gagal mengambil status access point.',
                errorCode: error.code === 'ECONNABORTED' ? 'TIMEOUT_ERROR' : 'COMMAND_ERROR',
                timingMs: Date.now() - startedAt,
                details: { httpStatus: error.response?.status || null },
            });
        }
    }, { operation: 'statusap' });
}

async function getvoucher(profile, sender, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    // NON-IDEMPOTENT: PHP `adduserhotspot.php` generate random username tiap call.
    // Retry pada attempt-1 yang sukses tapi response hilang akan create voucher
    // ke-2 dengan username berbeda → MikroTik punya duplicate. Caller harus
    // toleran terhadap error transient di sini.
    return withMikrotikRetry(
        () => getJsonOverHttp('getvoucher', `${siteUrl}/adduserhotspot.php`, {
            params: { profil: profile, komen: sender },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'getvoucher', retryable: false }
    );
}

async function addpppoe(user, pw, profil, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    // PPPoE password TIDAK boleh di URL query string — pindah ke POST body.
    // PHP `mikrotik_read_input` sudah update untuk baca dari $_POST + JSON body.
    return withMikrotikRetry(
        () => getJsonOverHttp('addpppoe', `${siteUrl}/adduserpppoe.php`, {
            method: 'post',
            body: { user, pw, profil },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'addpppoe' } // safe: PHP dedup returns DUPLICATE
    );
}

async function addbinding(komen, ip, mac, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    // PHP `addipbinding.php` belum confirmed idempotent — main aman tidak retry.
    return withMikrotikRetry(
        () => getJsonOverHttp('addbinding', `${siteUrl}/addipbinding.php`, {
            params: { comment: komen, ip, mac },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'addbinding', retryable: false }
    );
}

async function addqueue(prof, komen, ip, parent, ceklimitat, cekmaxlimit, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    return withMikrotikRetry(
        () => getJsonOverHttp('addqueue', `${siteUrl}/addsimplequeue.php`, {
            params: { comment: prof, name: komen, target: ip, parent, limitat: ceklimitat, maxlimit: cekmaxlimit },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'addqueue', retryable: false }
    );
}

async function getAllPPPoESecrets(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getAllPPPoESecrets', 'get_all_pppoe_secrets', [], { context, timeoutMs: 15000 }),
        { operation: 'getAllPPPoESecrets' }
    );
}

async function getMikrotikDiagnostics(context = {}) {
    const result = await runPhpMikrotik('checkMikrotikConnection', 'check_mikrotik_connection', [], { context, timeoutMs: 8000 });
    return {
        ...result,
        details: {
            ...(result.details || {}),
            config: getMikrotikConfig(),
        },
    };
}

module.exports = {
    runPhpMikrotik,
    createResult,
    assertMikrotikResult,
    getMikrotikConfig,
    invalidateMikrotikConfigCache,
    isMikrotikSyncEnabled,
    getMikrotikDiagnostics,
    checkPPPoEUserExists,
    updatePPPoEProfile,
    deleteActivePPPoEUser,
    getActivePPPoEUsers,
    getPPPProfiles,
    getHotspotProfiles,
    getPPPUsers,
    addPPPoEUser,
    getPPPoEUserProfile,
    getAllPPPoESecrets,
    getPppStats,
    getHotspotStats,
    getActiveHotspotUsers,
    statusap,
    getvoucher,
    addpppoe,
    addbinding,
    addqueue,
    // Internal — diekspos hanya untuk test.
    _resetMikrotikCircuitForTests,
};
