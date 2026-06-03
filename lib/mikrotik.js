const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_OUTPUT = 1024 * 1024;

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

    return {
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
    try {
        const response = await axios.get(url, {
            params: options.params || {},
            timeout: options.timeoutMs || 15000,
        });

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

async function updatePPPoEProfile(username, newProfile, context = {}) {
    return runPhpMikrotik('updatePPPoEProfile', 'update_pppoe_profile', [username, newProfile], { context });
}

async function deleteActivePPPoEUser(username, context = {}) {
    return runPhpMikrotik('deleteActivePPPoEUser', 'delete_active_pppoe_user', [username], { context });
}

async function getPPPProfiles(context = {}) {
    return runPhpMikrotik('getPPPProfiles', 'get_ppp_profiles', [], { context });
}

async function getActivePPPoEUsers(context = {}) {
    return runPhpMikrotik('getActivePPPoEUsers', 'get_ppp_active_optimized', [], {
        context,
        timeoutMs: 12000,
    });
}

async function getPPPUsers(context = {}) {
    return runPhpMikrotik('getPPPUsers', 'get_pppoe_users', [], { context });
}

async function getHotspotProfiles(context = {}) {
    return runPhpMikrotik('getHotspotProfiles', 'get_hotspot_profiles', [], { context });
}

async function addPPPoEUser(username, password, profile, context = {}) {
    return runPhpMikrotik('addPPPoEUser', 'adduserpppoe', [username, password, profile], {
        context: { ...context, username: sanitizeValue(username), profile: sanitizeValue(profile) },
    });
}

async function getPPPoEUserProfile(username, context = {}) {
    return runPhpMikrotik('getPPPoEUserProfile', 'get_pppoe_user_profile', [username], { context });
}

async function checkPPPoEUserExists(username, context = {}) {
    return runPhpMikrotik('checkPPPoEUserExists', 'check_pppoe_username_exists', [username], { context });
}

async function getPppStats(context = {}) {
    return runPhpMikrotik('getPppStats', 'get_ppp_stats', [], { context, timeoutMs: 12000 });
}

async function getHotspotStats(context = {}) {
    return runPhpMikrotik('getHotspotStats', 'get_hotspot_stats', [], { context, timeoutMs: 12000 });
}

async function getActiveHotspotUsers(context = {}) {
    return runPhpMikrotik('getActiveHotspotUsers', 'get_hotspot_active_users', [], {
        context,
        timeoutMs: 12000,
    });
}

async function statusap(context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }

    const startedAt = Date.now();
    try {
        const response = await axios.get(`${siteUrl}/interface.php`, { timeout: 15000 });
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
}

async function getvoucher(profile, sender, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    return getJsonOverHttp('getvoucher', `${siteUrl}/adduserhotspot.php`, {
        params: { profil: profile, komen: sender },
        timeoutMs: 15000,
        context,
    });
}

async function addpppoe(user, pw, profil, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    return getJsonOverHttp('addpppoe', `${siteUrl}/adduserpppoe.php`, {
        params: { user, pw, profil },
        timeoutMs: 15000,
        context,
    });
}

async function addbinding(komen, ip, mac, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    return getJsonOverHttp('addbinding', `${siteUrl}/addipbinding.php`, {
        params: { comment: komen, ip, mac },
        timeoutMs: 15000,
        context,
    });
}

async function addqueue(prof, komen, ip, parent, ceklimitat, cekmaxlimit, context = {}) {
    const siteUrl = getSiteUrl();
    if (typeof siteUrl !== 'string') {
        return siteUrl;
    }
    return getJsonOverHttp('addqueue', `${siteUrl}/addsimplequeue.php`, {
        params: { comment: prof, name: komen, target: ip, parent, limitat: ceklimitat, maxlimit: cekmaxlimit },
        timeoutMs: 15000,
        context,
    });
}

async function getAllPPPoESecrets(context = {}) {
    return runPhpMikrotik('getAllPPPoESecrets', 'get_all_pppoe_secrets', [], { context, timeoutMs: 15000 });
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
};
