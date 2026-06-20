/**
 * Header Doc
 * Purpose: Konsol OLT READ-ONLY ter-guard — jalankan satu perintah `show ...` via SSH untuk
 *          diagnosa dari web tanpa buka CLI. Whitelist ketat: hanya `show`, tolak karakter/
 *          perintah berbahaya, blokir output masif (running-config) yang menggantung sesi.
 * Caller: routes/olt-provisioning.js (POST /provision/devices/:id/show).
 * Deps: lib/olt-ssh-client (runOltCommands — host-lock + 1 sesi). Tidak menulis ke OLT.
 * MainFuncs: validateShowCommand (murni, di-export untuk test), runShowCommand.
 * SideEffects: SATU sesi SSH read-only (serial per host).
 *
 * KEAMANAN: perintah tulis/konfig/reboot DITOLAK (bukan `show`). Karakter rangkai perintah
 * (`;` `|` `&` newline) & `?` ditolak (cegah injeksi/multi-perintah). running/startup-config &
 * tech-support diblokir (output 15-20 menit bikin sesi nyangkut — ZXAN tak punya paging tuntas).
 */
'use strict';

const { runOltCommands } = require('./olt-ssh-client');

// Output masif / menggantung — arahkan ke backup/SSH langsung, jangan via konsol web.
const BLOCKED = /\b(running-config|startup-config|tech-support|logging)\b/i;

/**
 * Validasi perintah konsol. Hanya `show ...` murni yang lolos.
 * @param {string} raw
 * @returns {{ok:true, command:string}|{ok:false, reason:string}}
 */
function validateShowCommand(raw) {
    const cmd = String(raw == null ? '' : raw).trim();
    if (!cmd) return { ok: false, reason: 'Perintah kosong.' };
    if (/[\n\r;|&?`$<>]/.test(cmd)) return { ok: false, reason: 'Mengandung karakter yang tidak diizinkan.' };
    if (!/^show\s+\S/i.test(cmd)) return { ok: false, reason: 'Hanya perintah "show ..." (read-only) yang diizinkan.' };
    if (BLOCKED.test(cmd)) {
        return {
            ok: false,
            reason: 'Perintah ini menghasilkan output sangat besar/lama. Gunakan fitur Backup atau SSH langsung.'
        };
    }
    if (cmd.length > 120) return { ok: false, reason: 'Perintah terlalu panjang.' };
    return { ok: true, command: cmd };
}

/**
 * Jalankan satu perintah `show` read-only pada OLT.
 * @param {object} device entry device (host + kredensial SSH)
 * @param {string} raw perintah dari user
 * @returns {Promise<{ok:boolean, command?:string, output?:string, error?:string|null, prompt?:string}>}
 */
async function runShowCommand(device, raw) {
    const v = validateShowCommand(raw);
    if (!v.ok) return { ok: false, error: v.reason };

    const res = await runOltCommands(device, [v.command], {
        stopOnError: false,
        checkErrors: true,
        commandTimeoutMs: 25000,
        connectRetries: 1
    });
    const r = (res.results && res.results[0]) || {};
    return {
        ok: !r.error,
        command: v.command,
        output: r.output || '',
        error: r.error || null,
        prompt: res.prompt || null
    };
}

module.exports = { runShowCommand, validateShowCommand };
