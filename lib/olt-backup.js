/**
 * Header Doc
 * Purpose: Backup konfigurasi OLT dua metode — (1) FTP: OLT upload startrun.dat ke FTP
 *          receiver on-demand di host bot (±10 dtk, startup-config); (2) capture
 *          `show running-config` via SSH (lambat, running-config). Simpan ke
 *          backups/olt/<deviceId>/, retensi, opsional kirim Telegram. Termasuk
 *          konfigurasi auto-backup (config.olt.backup) dan util listing/download.
 * Caller: routes/olt-provisioning.js (backup manual + listing), lib/cron/jobs/olt-backup.js (terjadwal).
 * Deps: fs, path, ./olt-zte-provision (captureRunningConfig, uploadStartupViaFtp),
 *       ./olt-ftp-receiver (withFtpReceiver), ./olt-manager, ./telegram-backup.
 * MainFuncs: getBackupSettings, saveBackupSettings, runBackupForDevice, runBackupAll,
 *            listBackups, resolveBackupFile.
 * SideEffects: tulis/hapus file di backups/olt/, ubah config.json (saveBackupSettings),
 *              kirim dokumen/pesan Telegram bila diaktifkan.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { captureRunningConfig, uploadStartupViaFtp } = require('./olt-zte-provision');
const { withFtpReceiver } = require('./olt-ftp-receiver');
const oltManager = require('./olt-manager');
const { sendTelegramDocument, sendTelegramMessage, getTelegramConfig } = require('./telegram-backup');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', 'backups', 'olt');

const DEFAULT_SETTINGS = {
    enabled: false,
    schedule: '30 2 * * *',   // tiap hari 02:30 WIB
    keep: 30,                 // simpan 30 file terakhir per OLT
    sendTelegram: false,
    // Metode backup (verif live C320):
    //   'ftp'     → OLT upload startrun.dat (STARTUP config) ke FTP receiver on-demand
    //               di host bot — ±10 DETIK. Butuh ftpSelfHost (IP bot dari sisi OLT)
    //               + route OLT→bot. Isi = hasil `write` terakhir.
    //   'capture' → rekam `show running-config` via SSH — 15-20 MENIT di C320 besar,
    //               tapi isi = kondisi berjalan saat itu.
    method: 'ftp',
    ftpSelfHost: '',
    ftpPort: 21,
    ftpFallbackCapture: true, // bila ftp gagal → coba capture (lambat tapi tetap kebackup)
};

// ── Konfigurasi auto-backup (config.olt.backup) ──────────────────────────────

function readConfigFile() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
        console.error('[OLT-BACKUP] Gagal baca config.json:', e.message);
        return {};
    }
}

/** @returns {{enabled, schedule, keep, sendTelegram, method, ftpSelfHost, ftpPort, ftpFallbackCapture}} */
function getBackupSettings() {
    const cfg = readConfigFile();
    const raw = (cfg.olt && cfg.olt.backup) || {};
    return {
        enabled: raw.enabled === true,
        schedule: typeof raw.schedule === 'string' && raw.schedule.trim() ? raw.schedule.trim() : DEFAULT_SETTINGS.schedule,
        keep: clampInt(raw.keep, 1, 365, DEFAULT_SETTINGS.keep),
        sendTelegram: raw.sendTelegram === true,
        method: raw.method === 'capture' ? 'capture' : 'ftp',
        ftpSelfHost: typeof raw.ftpSelfHost === 'string' ? raw.ftpSelfHost.trim() : '',
        ftpPort: clampInt(raw.ftpPort, 1, 65535, DEFAULT_SETTINGS.ftpPort),
        ftpFallbackCapture: raw.ftpFallbackCapture !== false,
    };
}

/**
 * Simpan setting backup ke config.json (sub-key olt.backup saja, field lain dipertahankan).
 * @param {object} settings
 * @returns {object} setting ternormalisasi yang tersimpan
 */
function saveBackupSettings(settings) {
    const normalized = {
        enabled: settings.enabled === true || settings.enabled === 'true',
        schedule: typeof settings.schedule === 'string' && settings.schedule.trim() ? settings.schedule.trim() : DEFAULT_SETTINGS.schedule,
        keep: clampInt(settings.keep, 1, 365, DEFAULT_SETTINGS.keep),
        sendTelegram: settings.sendTelegram === true || settings.sendTelegram === 'true',
        method: settings.method === 'capture' ? 'capture' : 'ftp',
        ftpSelfHost: typeof settings.ftpSelfHost === 'string' ? settings.ftpSelfHost.trim() : '',
        ftpPort: clampInt(settings.ftpPort, 1, 65535, DEFAULT_SETTINGS.ftpPort),
        ftpFallbackCapture: settings.ftpFallbackCapture !== false && settings.ftpFallbackCapture !== 'false',
    };
    const cfg = readConfigFile();
    if (!cfg.olt) cfg.olt = {};
    cfg.olt.backup = normalized;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 4), 'utf8');
    if (global.config) global.config.olt = cfg.olt; // jaga global tetap sinkron
    return normalized;
}

// ── Eksekusi backup ──────────────────────────────────────────────────────────

/**
 * Backup satu OLT — dua metode (lihat DEFAULT_SETTINGS.method):
 *   'ftp'     → FTP receiver on-demand + `file upload cfg-startup` (cepat; startup config).
 *   'capture' → rekam `show running-config` (lambat; running config).
 * Gagal FTP → fallback capture bila ftpFallbackCapture.
 * @param {object} device  entry device (butuh sshUsername/sshPassword)
 * @param {object} [opts]  {baseDir, keep, sendTelegram, method, ftpSelfHost, ftpPort,
 *                          capture, ftpUpload, ftpReceive} — 3 terakhir injectable utk test
 * @returns {Promise<{ok, deviceId, file, sizeBytes, lines, method, telegram, error}>}
 */
async function runBackupForDevice(device, opts = {}) {
    const baseDir = opts.baseDir || DEFAULT_BACKUP_DIR;
    const settings = getBackupSettings();
    const keep = clampInt(opts.keep, 1, 365, settings.keep);
    const wantTelegram = opts.sendTelegram !== undefined ? opts.sendTelegram === true : settings.sendTelegram;
    const method = opts.method || settings.method;
    const ftpSelfHost = opts.ftpSelfHost !== undefined ? opts.ftpSelfHost : settings.ftpSelfHost;
    const ftpPort = opts.ftpPort || settings.ftpPort;
    const capture = opts.capture || captureRunningConfig;
    const ftpUpload = opts.ftpUpload || uploadStartupViaFtp;
    const ftpReceive = opts.ftpReceive || withFtpReceiver;

    const result = { ok: false, deviceId: device.id, deviceName: device.name, file: null, sizeBytes: 0, lines: 0, method, telegram: null, error: null };
    try {
        if (!device.sshUsername || !device.sshPassword) {
            throw new Error('Kredensial SSH belum dikonfigurasi untuk OLT ini');
        }
        const dir = path.join(baseDir, sanitizeId(device.id));
        fs.mkdirSync(dir, { recursive: true });

        let fileName;
        let filePath;
        if (method === 'ftp') {
            if (!ftpSelfHost) throw new Error('Metode FTP butuh "IP bot dari sisi OLT" (ftpSelfHost) di setting backup');
            try {
                const recv = await ftpReceive({ selfHost: ftpSelfHost, port: ftpPort, remoteDir: 'RAF' }, async (ctx) => {
                    const up = await ftpUpload(device, { selfHost: ftpSelfHost, ftpUser: ctx.ftpUser, ftpPass: ctx.ftpPass, remoteDir: ctx.remoteDir });
                    if (!up.ok) throw new Error(`Perintah upload OLT gagal: ${up.error}`);
                    return up;
                });
                // File startup-config diterima — pindahkan APA ADANYA (byte-identik, bisa
                // dipakai restore) dengan nama timestamp; .dat = metode ftp.
                fileName = `${sanitizeId(device.id)}_${timestampForFile()}.dat`;
                filePath = path.join(dir, fileName);
                fs.copyFileSync(recv.filePath, filePath);
                recv.cleanup();
            } catch (ftpErr) {
                const fallback = opts.ftpFallbackCapture !== undefined ? opts.ftpFallbackCapture : settings.ftpFallbackCapture;
                if (!fallback) throw ftpErr;
                console.warn(`[OLT-BACKUP] FTP gagal untuk ${device.id} (${ftpErr.message}) → fallback capture running-config`);
                result.method = 'capture-fallback';
                ({ fileName, filePath } = writeCaptureBackup(dir, device, await capture(device)));
            }
        } else {
            ({ fileName, filePath } = writeCaptureBackup(dir, device, await capture(device)));
        }

        const stats = fs.statSync(filePath);
        result.ok = true;
        result.file = fileName;
        result.sizeBytes = stats.size;
        result.lines = fs.readFileSync(filePath, 'utf8').split('\n').length;

        pruneOldBackups(dir, keep);

        if (wantTelegram) {
            result.telegram = { sent: false, error: null };
            try {
                const tg = getTelegramConfig();
                if (!tg.enabled || !tg.botToken || !tg.chatId) throw new Error('Telegram backup belum dikonfigurasi');
                const sizeKb = (stats.size / 1024).toFixed(1);
                const methodLabel = result.method === 'ftp' ? 'FTP (startup-config)' : 'capture (running-config)';
                await sendTelegramDocument(filePath,
                    `🗄 <b>Backup Konfigurasi OLT</b>\n` +
                    `📟 ${escapeHtml(device.name || device.id)} (${escapeHtml(device.host || '')})\n` +
                    `📅 ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n` +
                    `📁 ${result.lines} baris • ${sizeKb} KB • ${methodLabel}`);
                result.telegram.sent = true;
            } catch (tgErr) {
                result.telegram.error = tgErr.message;
                console.error(`[OLT-BACKUP] Telegram gagal untuk ${device.id}:`, tgErr.message);
            }
        }
        console.log(`[OLT-BACKUP] ✅ ${device.name || device.id} (${result.method}): ${result.lines} baris → ${result.file}`);
    } catch (e) {
        result.error = e.message;
        console.error(`[OLT-BACKUP] ❌ ${device.name || device.id}: ${e.message}`);
    }
    return result;
}

/**
 * Backup semua OLT yang SSH-nya terkonfigurasi (serial — lock per host sudah di lapisan SSH,
 * serial antar-device supaya tidak membebani event loop bot).
 * @param {object} [opts] {devices, baseDir, sendTelegram, notifySummary}
 * @returns {Promise<{results: Array, okCount: number, failCount: number}>}
 */
async function runBackupAll(opts = {}) {
    const devices = (opts.devices || oltManager.getOltDevices()).filter((d) => d.sshUsername && d.sshPassword);
    const results = [];
    for (const device of devices) {
        results.push(await runBackupForDevice(device, opts));
    }
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    // Ringkasan ke Telegram hanya bila ada kegagalan (sukses per-file sudah terkirim dokumennya).
    if (opts.notifySummary !== false && failCount > 0) {
        try {
            const tg = getTelegramConfig();
            if (tg.enabled && tg.botToken && tg.chatId) {
                const failLines = results.filter((r) => !r.ok)
                    .map((r) => `• ${escapeHtml(r.deviceName || r.deviceId)}: ${escapeHtml(r.error || 'gagal')}`).join('\n');
                await sendTelegramMessage(`⚠️ <b>Backup OLT selesai dengan kegagalan</b>\n✅ ${okCount} • ❌ ${failCount}\n${failLines}`);
            }
        } catch (e) {
            console.error('[OLT-BACKUP] Gagal kirim ringkasan Telegram:', e.message);
        }
    }
    return { results, okCount, failCount };
}

// ── Listing & download ───────────────────────────────────────────────────────

/**
 * Daftar file backup (semua device atau satu device).
 * @param {string|null} deviceId
 * @param {string} [baseDir]
 * @returns {Array<{deviceId, file, sizeBytes, mtime}>} terbaru dulu
 */
function listBackups(deviceId, baseDir) {
    const root = baseDir || DEFAULT_BACKUP_DIR;
    if (!fs.existsSync(root)) return [];
    const deviceDirs = deviceId
        ? [sanitizeId(deviceId)]
        : fs.readdirSync(root).filter((d) => {
            try { return fs.statSync(path.join(root, d)).isDirectory(); } catch (_e) { return false; }
        });
    const out = [];
    for (const dev of deviceDirs) {
        const dir = path.join(root, dev);
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
            if (!isBackupFile(f)) continue;
            try {
                const st = fs.statSync(path.join(dir, f));
                out.push({ deviceId: dev, file: f, sizeBytes: st.size, mtime: st.mtime.toISOString() });
            } catch (_e) { /* file hilang di tengah listing */ }
        }
    }
    out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
    return out;
}

/**
 * Resolve path absolut file backup dengan guard path-traversal.
 * @param {string} deviceId
 * @param {string} fileName
 * @param {string} [baseDir]
 * @returns {string} path absolut
 * @throws bila nama tidak aman / file tidak ada
 */
function resolveBackupFile(deviceId, fileName, baseDir) {
    const root = baseDir || DEFAULT_BACKUP_DIR;
    const safeDevice = sanitizeId(deviceId);
    const safeFile = path.basename(String(fileName || ''));
    if (!isBackupFile(safeFile) || safeFile !== fileName) {
        throw new Error('Nama file backup tidak valid');
    }
    const full = path.join(root, safeDevice, safeFile);
    const resolved = path.resolve(full);
    if (!resolved.startsWith(path.resolve(root))) throw new Error('Path backup tidak valid');
    if (!fs.existsSync(resolved)) throw new Error('File backup tidak ditemukan');
    return resolved;
}

// ── Helper ───────────────────────────────────────────────────────────────────

/** File backup yang dikenal: .cfg (metode capture) & .dat (metode ftp, startrun.dat). */
function isBackupFile(name) {
    return name.endsWith('.cfg') || name.endsWith('.dat');
}

/** Tulis hasil capture running-config ke file .cfg ber-header. */
function writeCaptureBackup(dir, device, configText) {
    const fileName = `${sanitizeId(device.id)}_${timestampForFile()}.cfg`;
    const filePath = path.join(dir, fileName);
    const headerLines = [
        `! Backup konfigurasi OLT — ${device.name || device.id} (${device.host})`,
        `! Diambil: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} (metode: capture running-config)`,
        '!',
    ];
    fs.writeFileSync(filePath, headerLines.join('\n') + '\n' + configText + '\n', 'utf8');
    return { fileName, filePath };
}

/** Hapus file backup terlama melebihi batas keep di satu folder device. */
function pruneOldBackups(dir, keep) {
    try {
        const files = fs.readdirSync(dir)
            .filter(isBackupFile)
            .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime); // terbaru dulu
        for (const item of files.slice(keep)) {
            fs.unlinkSync(path.join(dir, item.f));
            console.log(`[OLT-BACKUP] Retensi: hapus ${item.f}`);
        }
    } catch (e) {
        console.error('[OLT-BACKUP] Gagal pruning retensi:', e.message);
    }
}

function timestampForFile() {
    // WIB eksplisit — server bisa saja UTC.
    const now = new Date();
    const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
    const p = (n) => String(n).padStart(2, '0');
    return `${wib.getFullYear()}${p(wib.getMonth() + 1)}${p(wib.getDate())}-${p(wib.getHours())}${p(wib.getMinutes())}${p(wib.getSeconds())}`;
}

function sanitizeId(id) {
    return String(id || 'olt').replace(/[^\w.-]/g, '_').slice(0, 60);
}

function clampInt(v, min, max, dflt) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return dflt;
    return Math.max(min, Math.min(max, n));
}

function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
    getBackupSettings,
    saveBackupSettings,
    runBackupForDevice,
    runBackupAll,
    listBackups,
    resolveBackupFile,
    DEFAULT_BACKUP_DIR,
    __test: { pruneOldBackups, sanitizeId, timestampForFile, clampInt },
};
