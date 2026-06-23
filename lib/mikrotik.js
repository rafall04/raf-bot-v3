const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { getInternalServiceToken, INTERNAL_SERVICE_HEADER } = require('./internal-service-token');
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

// M8/M9: Per-key mutex untuk serialisasi operasi yang menarget identitas
// yang sama (PPPoE username, IP binding, queue name). Mencegah race kondisi
// dari PHP existence check yang tidak atomic dengan RouterOS API add command:
//   Request A: check exists → no → add (in flight)
//   Request B: check exists → no (concurrent) → add
//   → MikroTik bisa create duplicate, atau salah satu fail dengan trap message
// Setelah lock: B akan await A selesai, lalu existence check di B lihat user
// sudah ada → return DUPLICATE dengan rapi (no leak resource).
// Beda key tetap paralel. In-process only — multi-instance butuh distributed
// lock (out-of-scope sini, single bot per deployment).
const keyLocks = new Map();

async function withMikrotikKeyLock(lockKey, fn) {
    if (!lockKey) return fn();
    const previous = keyLocks.get(lockKey) || Promise.resolve();
    let releaseSlot;
    const slot = new Promise((resolve) => { releaseSlot = resolve; });
    keyLocks.set(lockKey, slot);
    try {
        await previous;
        return await fn();
    } finally {
        releaseSlot();
        if (keyLocks.get(lockKey) === slot) {
            keyLocks.delete(lockKey);
        }
    }
}

function _resetMikrotikKeyLocksForTests() {
    keyLocks.clear();
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

        // M7: nilai sensitif (password) DILARANG masuk argv — argv visible di
        // `ps aux`. Caller bisa pass via `options.envSecrets: { key: value }`;
        // setiap key di-prefix `MTIN_` dan ditaruh di environment. PHP
        // `mikrotik_read_input` (views/mikrotik_helper.php) prioritaskan
        // baca dari `getenv('MTIN_<key>')` sebelum argv.
        const childEnv = { ...process.env };
        if (options.envSecrets && typeof options.envSecrets === 'object') {
            for (const [key, value] of Object.entries(options.envSecrets)) {
                if (value === undefined || value === null) continue;
                childEnv[`MTIN_${key}`] = String(value);
            }
        }

        const child = spawn('php', [scriptPath, ...args.map((arg) => String(arg))], {
            cwd: path.resolve(__dirname, '..'),
            windowsHide: true,
            env: childEnv,
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
                headers: {
                    'Content-Type': 'application/json',
                    [INTERNAL_SERVICE_HEADER]: getInternalServiceToken(global.config?.jwt),
                },
            });
        } else {
            response = await axios.get(url, {
                params: options.params || {},
                timeout: options.timeoutMs || 15000,
                httpAgent,
                httpsAgent,
                headers: { [INTERNAL_SERVICE_HEADER]: getInternalServiceToken(global.config?.jwt) },
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
            // Utamakan pesan dari body JSON PHP (mis. "Profil Hotspot ... tidak ditemukan")
            // ketimbang string axios generik ("Request failed with status code 404"), agar
            // tangga klasifikasi error di pemanggil (voucher/binding/queue) tidak mati.
            message: error.response?.data?.message || error.message || 'Permintaan HTTP MikroTik gagal.',
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
    // M8: lock per-username — concurrent update untuk user yang sama harus serialize
    // supaya tidak ada "last write wins yang acak" antara dua admin.
    return withMikrotikKeyLock(`pppoe:${username}`, () => withMikrotikRetry(
        () => runPhpMikrotik('updatePPPoEProfile', 'update_pppoe_profile', [username, newProfile], { context }),
        { operation: 'updatePPPoEProfile' }
    ));
}

async function deleteActivePPPoEUser(username, context = {}) {
    return withMikrotikKeyLock(`pppoe:${username}`, () => withMikrotikRetry(
        () => runPhpMikrotik('deleteActivePPPoEUser', 'delete_active_pppoe_user', [username], { context }),
        { operation: 'deleteActivePPPoEUser' }
    ));
}

async function getPPPProfiles(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getPPPProfiles', 'get_ppp_profiles', [], { context }),
        { operation: 'getPPPProfiles' }
    );
}

/**
 * Ambil daftar netwatch dari MikroTik (/tool/netwatch/print).
 * Tiap entry: {host, status('up'|'down'|'unknown'), comment, since, disabled}.
 * Dipakai CCTV monitor untuk deteksi transisi up→down per IP CCTV terdaftar.
 */
async function getNetwatchList(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getNetwatchList', 'get_netwatch_list', [], { context, timeoutMs: 10000 }),
        { operation: 'getNetwatchList' }
    );
}

// Netwatch LENGKAP termasuk up-script/down-script — dipakai fitur discovery CCTV
// (parse `:local cctv`/`:local area`). On-demand saja; poller cctv-monitor tetap
// pakai getNetwatchList yang ringan. Timeout sedikit lebih longgar (script besar).
async function getNetwatchFull(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getNetwatchFull', 'get_netwatch_full', [], { context, timeoutMs: 12000 }),
        { operation: 'getNetwatchFull' }
    );
}

// Tambah entri netwatch + script on-up/on-down (provisioning CCTV baru). Script & token via
// env (bukan argv → tak bocor di ps aux). PHP idempotent: host yang sudah ada di-skip (tak ditimpa).
async function addNetwatch(params = {}, context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('addNetwatch', 'add_netwatch', [], {
            envSecrets: {
                host: params.host || '',
                comment: params.comment || '',
                interval: params.interval || '5s',
                timeout: params.timeout || '1s',
                upscript: params.upScript || '',
                downscript: params.downScript || '',
                disabled: params.disabled ? 'yes' : 'no',
            },
            context,
            timeoutMs: 12000,
        }),
        { operation: 'addNetwatch' }
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

// Batch add voucher hotspot dalam SATU koneksi RouterOS (efisien untuk cetak banyak,
// mis. 360+): bridge connect sekali -> validasi profil -> N add -> disconnect sekali.
// Format kode ala Mikhmon via params: length, chartype (num/lower/upper/lower_num/
// upper_num/mix/safe), prefix. TANPA withMikrotikRetry — batch non-idempotent (username
// acak), retry otomatis bisa menggandakan; timeout dibuat longgar (180s, cukup ~1000 add).
async function addHotspotUsersBatch(params = {}, context = {}) {
    const profile = params.profile;
    const count = parseInt(params.count, 10) || 0;
    const comment = params.comment || 'VoucherPrint';
    const length = parseInt(params.length, 10) || 6;
    const chartype = params.chartype || 'safe';
    const prefix = params.prefix || '';
    const usernames = Array.isArray(params.usernames) ? params.usernames.filter(Boolean) : [];
    const options = { context, timeoutMs: 180000, maxOutput: 8 * 1024 * 1024 };
    // Mode custom: kirim daftar username via env (hindari batas panjang argv + tak muncul di ps).
    if (usernames.length > 0) {
        options.envSecrets = { usernames: usernames.join(',') };
    }
    return runPhpMikrotik(
        'addHotspotUsersBatch',
        'get_hotspot_batch_add',
        [profile, count, comment, length, chartype, prefix],
        options
    );
}

// List /system/script log Mikhmon (id+name) — untuk cron reconcile voucher (ingest lalu prune).
async function getHotspotLogScripts(context = {}) {
    return runPhpMikrotik('getHotspotLogScripts', 'get_log_scripts', [], { context, timeoutMs: 30000, maxOutput: 12 * 1024 * 1024 });
}

// Hapus /system/script berdasarkan .id (batch). ids via env (hindari batas argv).
async function removeScriptsByIds(ids = [], context = {}) {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (list.length === 0) return { ok: true, operation: 'removeScriptsByIds', data: { removed: 0 } };
    return runPhpMikrotik('removeScriptsByIds', 'remove_scripts', [], {
        context, timeoutMs: 120000, envSecrets: { ids: list.join(',') }
    });
}

async function addPPPoEUser(username, password, profile, context = {}) {
    // M8: lock per-username. Mencegah race PHP "check exists then add":
    // dua request paralel untuk username sama bisa lolos existence check
    // dan keduanya execute add → MikroTik bisa duplicate / trap error.
    // Dengan lock, request kedua await yang pertama, lalu lihat user
    // sudah ada → return DUPLICATE secara graceful.
    return withMikrotikKeyLock(`pppoe:${username}`, () => withMikrotikRetry(
        // M7: password lewat env (MTIN_pw), placeholder kosong di argv supaya
        // password TIDAK muncul di `ps aux`. PHP mikrotik_read_input baca env dulu.
        () => runPhpMikrotik('addPPPoEUser', 'adduserpppoe', [username, '', profile], {
            envSecrets: { pw: password },
            context: { ...context, username: sanitizeValue(username), profile: sanitizeValue(profile) },
        }),
        { operation: 'addPPPoEUser' } // safe: PHP dedup returns DUPLICATE pada retry kalau attempt pertama sukses
    ));
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

async function statusap(_context = {}) {
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
                headers: { [INTERNAL_SERVICE_HEADER]: getInternalServiceToken(global.config?.jwt) },
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
                message: error.response?.data?.message || error.message || 'Gagal mengambil status access point.',
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

async function addbinding(komen, ip, mac, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    // M9: lock per-(ip,mac). Tabel IP binding di MikroTik identitas uniknya
    // kombinasi IP+MAC, dua request paralel dengan kombo sama bisa create
    // duplicate row. PHP `addipbinding.php` belum confirmed idempotent —
    // main aman tidak retry, tapi lock tetap penting.
    return withMikrotikKeyLock(`binding:${ip}|${mac}`, () => withMikrotikRetry(
        () => getJsonOverHttp('addbinding', `${siteUrl}/addipbinding.php`, {
            params: { comment: komen, ip, mac },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'addbinding', retryable: false }
    ));
}

async function addqueue(prof, komen, ip, parent, ceklimitat, cekmaxlimit, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    // M9: lock per-queue-name. RouterOS simple queue identitasnya `name`
    // (param `komen` di sini = `name` di PHP). Concurrent add dengan nama
    // sama bisa overwrite atau create duplicate; serialize aman.
    return withMikrotikKeyLock(`queue:${komen}`, () => withMikrotikRetry(
        () => getJsonOverHttp('addqueue', `${siteUrl}/addsimplequeue.php`, {
            params: { comment: prof, name: komen, target: ip, parent, limitat: ceklimitat, maxlimit: cekmaxlimit },
            timeoutMs: 15000,
            context,
        }),
        { operation: 'addqueue', retryable: false }
    ));
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
    getNetwatchList,
    getNetwatchFull,
    addNetwatch,
    getHotspotProfiles,
    addHotspotUsersBatch,
    getHotspotLogScripts,
    removeScriptsByIds,
    getPPPUsers,
    addPPPoEUser,
    getPPPoEUserProfile,
    getAllPPPoESecrets,
    getPppStats,
    getHotspotStats,
    getActiveHotspotUsers,
    statusap,
    getvoucher,
    addbinding,
    addqueue,
    // Internal — diekspos hanya untuk test.
    _resetMikrotikCircuitForTests,
};
