/**
 * Header Doc
 * Purpose: Generator script netwatch on-up/on-down (notifikasi Telegram untuk teknisi/admin) saat
 *          provisioning CCTV BARU. Merakit script RouterOS SATU BARIS (wajib — `comm()` memecah
 *          nilai pada `\n`, lihat routeros_api.class.php:371) dari config (bot/chat/template) +
 *          data CCTV (nama/area auto-isi via `:local`). Sanitasi anti-injeksi CLI pada nama/area.
 * Caller: routes/cctv.js (POST /api/cctv/provision-netwatch), lib/cctv-monitor-config.js (DEFAULT_NETWATCH).
 * Deps: none (murni).
 * MainFuncs: sanitizeRouterString, buildNetwatchScripts, isValidNetwatchConfig.
 * SideEffects: none.
 */
'use strict';

// Default config netwatch/Telegram. msgUp/msgDown = isi `:local msg "..."` (string RouterOS,
// pakai $area/$cctv/$time/$date yang di-set script). Backslash = escape hex RouterOS (mis. \E2 = ✅).
const DEFAULT_NETWATCH = {
    botToken: '',
    chatId: '',
    interval: '5s',
    timeout: '1s',
    msgUp: '\\E2\\9C\\85 *CCTV ONLINE (UP)*%0A%0A\\F0\\9F\\93\\8D Area: $area%0A\\F0\\9F\\93\\B9 Device: $cctv%0A\\E2\\8F\\B0 Waktu: $time - $date',
    msgDown: '\\F0\\9F\\9A\\A8 *CCTV OFFLINE (DOWN)*%0A%0A\\F0\\9F\\93\\8D Area: $area%0A\\F0\\9F\\93\\B9 Device: $cctv%0A\\E2\\8F\\B0 Waktu: $time - $date',
};

/**
 * Amankan string yang masuk ke dalam `"..."` script RouterOS (nama/area/bot/chat dari user/config):
 * paksa satu baris + buang control char (charCode < 32 atau 127), escape backslash lalu kutip ganda.
 * Cegah injeksi CLI (kutip ganda di-escape → tak bisa keluar dari string).
 */
function sanitizeRouterString(s) {
    const oneLine = String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ');
    let cleaned = '';
    for (let i = 0; i < oneLine.length; i++) {
        const code = oneLine.charCodeAt(i);
        if (code >= 32 && code !== 127) cleaned += oneLine[i]; // lewati control char
    }
    return cleaned
        .replace(/\\/g, '\\\\')   // escape backslash (harus sebelum kutip)
        .replace(/"/g, '\\"')     // escape kutip ganda
        .trim();
}

function buildOneScript(cfg, areaSafe, nameSafe, msgTemplate) {
    const bot = sanitizeRouterString(cfg.botToken);
    const chat = sanitizeRouterString(cfg.chatId);
    // msgTemplate = konten string RouterOS apa adanya (dikendalikan admin via template); paksa 1 baris.
    const msg = String(msgTemplate == null ? '' : msgTemplate).replace(/[\r\n]+/g, ' ');
    return [
        `:local bot "${bot}"`,
        `:local chat "${chat}"`,
        `:local area "${areaSafe}"`,
        `:local cctv "${nameSafe}"`,
        ':local date [/system clock get date]',
        ':local time [/system clock get time]',
        `:local msg "${msg}"`,
        '/tool fetch url="https://api.telegram.org/bot$bot/sendMessage" http-method=post http-data="chat_id=$chat&text=$msg&parse_mode=Markdown" keep-result=no',
    ].join(';') + ';';
}

/**
 * Rakit script up & down (satu baris) untuk satu CCTV.
 * @param {object} cfg {botToken, chatId, interval, timeout, msgUp, msgDown}
 * @param {object} device {name, area, host}
 * @returns {{upScript:string, downScript:string}}
 */
function buildNetwatchScripts(cfg, device) {
    const c = { ...DEFAULT_NETWATCH, ...(cfg || {}) };
    const d = device || {};
    const areaSafe = sanitizeRouterString(d.area || '');
    const nameSafe = sanitizeRouterString(d.name || d.host || '');
    return {
        upScript: buildOneScript(c, areaSafe, nameSafe, c.msgUp),
        downScript: buildOneScript(c, areaSafe, nameSafe, c.msgDown),
    };
}

/** Config siap dipakai bila bot token & chat id terisi. */
function isValidNetwatchConfig(cfg) {
    const c = cfg || {};
    return !!(String(c.botToken || '').trim() && String(c.chatId || '').trim());
}

module.exports = { DEFAULT_NETWATCH, sanitizeRouterString, buildNetwatchScripts, isValidNetwatchConfig };
