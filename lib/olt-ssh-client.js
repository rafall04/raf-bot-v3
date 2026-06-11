/**
 * Header Doc
 * Purpose: Klien SSH interaktif untuk CLI OLT (ZTE ZXAN C320/C300 dst.) — buka shell, kirim
 *          perintah satu-per-satu sambil menunggu prompt, tangani pagination `--More--`,
 *          prompt konfirmasi `[yes/no]`, mode `enable`, dan deteksi error CLI (`%Error`, dll).
 * Caller: lib/olt-zte-provision.js (registrasi/hapus ONU, status, capture running-config),
 *         lib/olt-backup.js (backup konfigurasi), routes/olt-provisioning.js (test SSH).
 * Deps: ssh2 (Client). Kredensial dari entry device config.olt.devices (sshUsername dst.).
 * MainFuncs: openOltShell, runOltCommands, withHostLock, detectCliError, __test (helper murni).
 * SideEffects: koneksi TCP/SSH keluar ke OLT; tidak menulis file/DB.
 *
 * CATATAN KEAMANAN OPERASIONAL:
 * - Satu sesi konfigurasi per OLT pada satu waktu: semua pemanggil WAJIB lewat withHostLock
 *   (runOltCommands sudah otomatis) supaya dua admin tidak saling tindih sesi `conf t`.
 * - Firmware ZXAN lama hanya bicara kex/cipher legacy (group1-sha1, aes128-cbc, ssh-rsa) —
 *   daftar algoritma di bawah sengaja memasukkan opsi legacy yang non-default di ssh2.
 */

'use strict';

const { Client } = require('ssh2');

// ── Konstanta protokol/CLI ───────────────────────────────────────────────────

// Prompt CLI ZXAN: "ZXAN#", "ZXAN(config)#", "ZXAN(config-if)#", juga hostname custom.
// Generik: baris terakhir buffer berakhiran '#' atau '>' (boleh diikuti 1 spasi).
const GENERIC_PROMPT_RE = /[\w()\\/.:-]+[#>]\s?$/;
// Prompt minta password (login enable / konfirmasi kredensial).
const PASSWORD_PROMPT_RE = /password\s*:\s*$/i;
// Prompt konfirmasi yes/no berbagai dialek firmware.
const CONFIRM_PROMPT_RE = /\[\s*yes\s*\/\s*no\s*\]|\(\s*y\s*\/\s*n\s*\)|are you sure/i;
// Penanda pagination; ZXAN menulis " --More--" lalu menghapusnya dengan backspace.
const MORE_RE = /-{1,2}\s?more\s?-{1,2}/i;

// Algoritma legacy untuk firmware OLT tua (ssh2 menonaktifkan sebagian secara default).
const LEGACY_ALGORITHMS = {
    kex: [
        'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256',
        'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1',
        'diffie-hellman-group1-sha1',
    ],
    cipher: [
        'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
        'aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc',
    ],
    serverHostKey: [
        'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ssh-dss',
    ],
    hmac: ['hmac-sha2-256', 'hmac-sha2-512', 'hmac-sha1', 'hmac-md5'],
};

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_COMMAND_TIMEOUT_MS = 20000;

// ── Helper murni (di-export untuk unit test) ─────────────────────────────────

/**
 * Bersihkan output terminal: buang escape ANSI, karakter backspace + huruf yang
 * dihapusnya, penanda --More--, dan CR yang menempel.
 * @param {string} text
 * @returns {string}
 */
function cleanTerminalOutput(text) {
    if (!text) return '';
    let out = String(text);
    out = out.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');   // ANSI CSI
    out = out.replace(/\x1b[=>]/g, '');                  // mode keypad
    // ZXAN menghapus " --More--" dengan urutan backspace/spasi: buang penandanya dulu,
    // lalu terapkan backspace yang tersisa.
    out = out.replace(/-{1,2}\s?More\s?-{1,2}/gi, '');
    while (/[^\x08]\x08/.test(out)) out = out.replace(/[^\x08]\x08/g, '');
    out = out.replace(/\x08+/g, '');
    out = out.replace(/\r+\n/g, '\n').replace(/\r/g, '\n');
    return out;
}

/**
 * Apakah ekor buffer terlihat seperti prompt CLI yang siap menerima perintah?
 * @param {string} buffer
 * @param {RegExp} [promptRe]
 * @returns {boolean}
 */
function endsWithPrompt(buffer, promptRe) {
    const tail = String(buffer || '').slice(-160).trimEnd();
    if (!tail) return false;
    const lastLine = tail.split('\n').pop().trim();
    return (promptRe || GENERIC_PROMPT_RE).test(lastLine);
}

/**
 * Deteksi pesan error CLI ZXAN pada output sebuah perintah konfigurasi.
 * Contoh: "%Error 326: The onu of this position exists", "% Invalid input detected".
 * @param {string} output  output BERSIH (tanpa echo perintah & prompt)
 * @returns {string|null} pesan error pertama atau null bila tidak ada
 */
function detectCliError(output) {
    if (!output) return null;
    const lines = String(output).split('\n');
    for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (/^%/.test(t)) return t;
        if (/^(unknown command|incomplete command|command rejected|error\s*[:[]|failed\s*[:.])/i.test(t)) return t;
    }
    return null;
}

/**
 * Buang echo perintah di awal dan baris prompt di akhir dari output mentah satu perintah.
 * @param {string} raw     output bersih (cleanTerminalOutput) antara kirim & prompt
 * @param {string} command perintah yang dikirim
 * @returns {string}
 */
function stripEchoAndPrompt(raw, command) {
    const lines = String(raw || '').split('\n');
    // Buang baris pertama bila merupakan echo perintah (CLI menggemakan input).
    if (lines.length && command && lines[0].trim().endsWith(command.trim())) lines.shift();
    // Buang baris terakhir bila berupa prompt.
    while (lines.length && GENERIC_PROMPT_RE.test(lines[lines.length - 1].trim()) &&
           !/\s/.test(lines[lines.length - 1].trim().replace(/[#>]\s?$/, ''))) {
        lines.pop();
    }
    return lines.join('\n').replace(/^\n+|\n+$/g, '');
}

/**
 * Pecah teks script CLI menjadi daftar perintah yang dikirim: trim, buang baris
 * kosong dan baris separator "!" (kosmetik di config ZTE, tak perlu dieksekusi).
 * @param {string} script
 * @returns {string[]}
 */
function scriptToCommands(script) {
    return String(script || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && l !== '!' && !l.startsWith('!'));
}

// ── Lock per-host (sesi konfigurasi tunggal per OLT) ─────────────────────────

/** @type {Map<string, Promise<any>>} antrian promise per host */
const hostLocks = new Map();

/**
 * Serialisasi operasi per host: operasi berikutnya menunggu yang sebelumnya selesai.
 * @template T
 * @param {string} host
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withHostLock(host, fn) {
    const key = String(host || 'unknown');
    const prev = hostLocks.get(key) || Promise.resolve();
    const next = prev.then(fn); // prev = tail yang tidak pernah reject (lihat bawah)
    const tail = next.catch(() => {}); // antrian tidak boleh putus karena operasi error
    hostLocks.set(key, tail);
    // Bersihkan entry bila ini operasi terakhir (hindari Map tumbuh tak terbatas).
    tail.then(() => {
        if (hostLocks.get(key) === tail) hostLocks.delete(key);
    });
    return next;
}

// ── Sesi shell ───────────────────────────────────────────────────────────────

/**
 * Buka koneksi SSH + shell interaktif ke OLT, tunggu prompt pertama, dan (opsional)
 * naikkan privilege via `enable` bila prompt masih level user (`>`).
 *
 * @param {object} device  entry device: {host, sshPort, sshUsername, sshPassword, sshEnablePassword?}
 * @param {object} [opts]  {connectTimeoutMs, commandTimeoutMs, disablePaging=true}
 * @returns {Promise<{exec: Function, close: Function, prompt: string, banner: string}>}
 */
function openOltShell(device, opts = {}) {
    const host = device && device.host;
    const username = device && (device.sshUsername || '');
    const password = device && (device.sshPassword || '');
    if (!host) return Promise.reject(new Error('Host OLT tidak dikonfigurasi'));
    if (!username) return Promise.reject(new Error(`Kredensial SSH OLT ${host} belum diisi (sshUsername)`));

    const connectTimeoutMs = opts.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS;
    const commandTimeoutMs = opts.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
        const conn = new Client();
        let stream = null;
        let buffer = '';
        let settled = false;
        let closed = false;

        const fail = (err) => {
            if (settled) return;
            settled = true;
            try { conn.end(); } catch (_e) { /* abaikan */ }
            reject(err instanceof Error ? err : new Error(String(err)));
        };

        const connectTimer = setTimeout(() => fail(new Error(`Timeout koneksi SSH ke ${host} (${connectTimeoutMs}ms)`)), connectTimeoutMs + 5000);

        conn.on('error', (err) => {
            clearTimeout(connectTimer);
            fail(new Error(`SSH ${host}: ${err.message}`));
        });

        conn.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
            // Sebagian firmware ZXAN pakai auth keyboard-interactive, jawab semua dengan password.
            finish(prompts.map(() => password));
        });

        conn.on('ready', () => {
            // Handshake selesai — timer koneksi tak relevan lagi; tahap berikutnya
            // (prompt, enable, terminal length) dijaga timeout waitFor masing-masing.
            clearTimeout(connectTimer);
            conn.shell({ term: 'vt100', cols: 400, rows: 200 }, (err, s) => {
                if (err) { clearTimeout(connectTimer); return fail(new Error(`Gagal buka shell ${host}: ${err.message}`)); }
                stream = s;
                stream.on('data', (d) => { buffer += d.toString('utf8'); });
                stream.stderr && stream.stderr.on('data', (d) => { buffer += d.toString('utf8'); });
                stream.on('close', () => { closed = true; });

                /**
                 * Tunggu sampai predicate(bufferBersih) true atau timeout.
                 * Polling ringan 80ms — sederhana & tahan banting untuk CLI lambat.
                 */
                const waitFor = (predicate, timeoutMs, label) => new Promise((res, rej) => {
                    const t0 = Date.now();
                    const iv = setInterval(() => {
                        const clean = cleanTerminalOutput(buffer);
                        if (predicate(clean)) { clearInterval(iv); res(clean); return; }
                        // Pagination: kirim spasi supaya output lanjut.
                        if (MORE_RE.test(buffer.slice(-40))) {
                            buffer = buffer.replace(/-{1,2}\s?More\s?-{1,2}\s*$/i, '');
                            try { stream.write(' '); } catch (_e) { /* stream tutup */ }
                        }
                        if (closed) { clearInterval(iv); rej(new Error(`Koneksi SSH ${host} tertutup saat menunggu ${label}`)); return; }
                        if (Date.now() - t0 > timeoutMs) {
                            clearInterval(iv);
                            const tail = cleanTerminalOutput(buffer).slice(-400);
                            rej(new Error(`Timeout menunggu ${label} dari ${host} (${timeoutMs}ms). Output terakhir:\n${tail}`));
                        }
                    }, 80);
                });

                (async () => {
                    // 1) Tunggu prompt pertama (atau prompt password user-exec tertentu).
                    await waitFor((c) => endsWithPrompt(c), connectTimeoutMs, 'prompt awal');

                    // 2) Bila masih user-exec (">"), coba naik privilege via enable.
                    let clean = cleanTerminalOutput(buffer);
                    let lastLine = clean.trimEnd().split('\n').pop().trim();
                    if (/>\s?$/.test(lastLine)) {
                        buffer = '';
                        stream.write('enable\n');
                        await waitFor((c) => endsWithPrompt(c) || PASSWORD_PROMPT_RE.test(c.trimEnd()), commandTimeoutMs, 'respons enable');
                        clean = cleanTerminalOutput(buffer);
                        if (PASSWORD_PROMPT_RE.test(clean.trimEnd())) {
                            buffer = '';
                            stream.write((device.sshEnablePassword || password) + '\n');
                            await waitFor((c) => endsWithPrompt(c), commandTimeoutMs, 'prompt enable');
                        }
                        clean = cleanTerminalOutput(buffer);
                        lastLine = clean.trimEnd().split('\n').pop().trim();
                        if (!/#\s?$/.test(lastLine)) {
                            throw new Error(`Gagal masuk mode privileged di ${host} (prompt: "${lastLine}")`);
                        }
                    }

                    const banner = cleanTerminalOutput(buffer);
                    const promptLine = banner.trimEnd().split('\n').pop().trim();

                    /**
                     * Kirim satu perintah & tunggu prompt kembali.
                     * @param {string} command
                     * @param {object} [o] {timeoutMs, autoConfirm:false, confirmAnswer:'yes'}
                     * @returns {Promise<string>} output bersih tanpa echo/prompt
                     */
                    const exec = async (command, o = {}) => {
                        if (closed) throw new Error(`Koneksi SSH ${host} sudah tertutup`);
                        const timeoutMs = o.timeoutMs || commandTimeoutMs;
                        buffer = '';
                        stream.write(command + '\n');
                        // Selesai bila prompt muncul; bila autoConfirm dan muncul prompt
                        // konfirmasi, jawab otomatis lalu lanjut menunggu prompt.
                        const cleanOut = await (async () => {
                            const t0 = Date.now();
                            for (;;) {
                                try {
                                    return await waitFor((c) => endsWithPrompt(c), Math.max(500, timeoutMs - (Date.now() - t0)), `prompt setelah "${command}"`);
                                } catch (e) {
                                    const cNow = cleanTerminalOutput(buffer);
                                    if (o.autoConfirm && CONFIRM_PROMPT_RE.test(cNow.slice(-120))) {
                                        stream.write((o.confirmAnswer || 'yes') + '\n');
                                        continue;
                                    }
                                    throw e;
                                }
                            }
                        })();
                        return stripEchoAndPrompt(cleanOut, command);
                    };

                    // 3) Matikan pagination supaya output panjang tidak terpotong --More--.
                    if (opts.disablePaging !== false) {
                        try { await exec('terminal length 0', { timeoutMs: 8000 }); }
                        catch (_e) { /* firmware tanpa perintah ini: handler --More-- tetap jalan */ }
                    }

                    clearTimeout(connectTimer);
                    settled = true;
                    resolve({
                        exec,
                        prompt: promptLine,
                        banner,
                        close: () => {
                            try { stream && stream.write('exit\n'); } catch (_e) { /* abaikan */ }
                            try { conn.end(); } catch (_e) { /* abaikan */ }
                        },
                    });
                })().catch((e) => { clearTimeout(connectTimer); fail(e); });
            });
        });

        conn.connect({
            host,
            port: parseInt(device.sshPort, 10) || 22,
            username,
            password,
            tryKeyboard: true,
            readyTimeout: connectTimeoutMs,
            algorithms: LEGACY_ALGORITHMS,
            // OLT lama kadang lambat merespons keepalive; jangan putus agresif.
            keepaliveInterval: 10000,
            keepaliveCountMax: 3,
        });
    });
}

/**
 * Jalankan serangkaian perintah CLI pada OLT dalam SATU sesi shell, serial per host.
 * Berhenti pada perintah pertama yang error (stopOnError default true).
 *
 * @param {object} device   entry device (lihat openOltShell)
 * @param {string[]} commands
 * @param {object} [opts]   {commandTimeoutMs, stopOnError=true, autoConfirm=false, checkErrors=true}
 * @returns {Promise<{ok: boolean, results: Array<{command, output, ok, error}>, failedIndex: number|null, prompt: string}>}
 */
function runOltCommands(device, commands, opts = {}) {
    return withHostLock(device && device.host, async () => {
        const session = await openOltShell(device, opts);
        const results = [];
        let failedIndex = null;
        try {
            for (let i = 0; i < commands.length; i++) {
                const command = commands[i];
                let output = '';
                let error = null;
                try {
                    output = await session.exec(command, {
                        timeoutMs: opts.commandTimeoutMs,
                        autoConfirm: opts.autoConfirm === true,
                    });
                    if (opts.checkErrors !== false) error = detectCliError(output);
                } catch (e) {
                    error = e.message;
                }
                results.push({ command, output, ok: !error, error });
                if (error && opts.stopOnError !== false) { failedIndex = i; break; }
                if (error && failedIndex === null) failedIndex = i;
            }
        } finally {
            session.close();
        }
        return { ok: failedIndex === null, results, failedIndex, prompt: session.prompt };
    });
}

module.exports = {
    openOltShell,
    runOltCommands,
    withHostLock,
    detectCliError,
    scriptToCommands,
    __test: {
        cleanTerminalOutput,
        endsWithPrompt,
        stripEchoAndPrompt,
        detectCliError,
        scriptToCommands,
        GENERIC_PROMPT_RE,
        CONFIRM_PROMPT_RE,
        LEGACY_ALGORITHMS,
    },
};
