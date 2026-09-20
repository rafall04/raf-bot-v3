/**
 * Header Doc
 * Purpose: Operasi /tool/netwatch MikroTik via bridge PHP — list ringan (poller),
 *   full (termasuk script — discovery CCTV), add/set/remove. Mutasi via envSecrets
 *   (bukan argv → tak bocor di ps aux) dan dikunci per-host/.id.
 * Caller: facade lib/mikrotik.js (konsumen: cctv-monitor, discovery CCTV).
 * Deps: lib/mikrotik/core (runPhpMikrotik + withMikrotikRetry + withMikrotikKeyLock).
 * MainFuncs: getNetwatchList, getNetwatchFull, addNetwatch, setNetwatch, removeNetwatch.
 * SideEffects: spawn `php views/<script>.php`; menulis netwatch di router.
 */
"use strict";

const {
    runPhpMikrotik,
    withMikrotikRetry,
    withMikrotikKeyLock,
} = require('./core');

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

// Set (by .id) ATAU add (bila tanpa id) entri netwatch. Preserve-on-empty: field kosong tak ditulis
// (nilai router dipertahankan). Kepemilikan CCTV diverifikasi PEMANGGIL (classifyEntry) sebelum set —
// bridge hanya menyentuh .id yang sudah dipastikan. Dikunci per-host (check-then-act aman dari lomba).
async function setNetwatch(params = {}, context = {}) {
    const host = String(params.host || '').trim();
    const id = String(params.id || '').trim();
    if (!host && !id) {
        return { ok: false, errorCode: 'VALIDATION_ERROR', message: 'setNetwatch butuh host (add) atau id (set).' };
    }
    return withMikrotikKeyLock(`netwatch:${host || id}`, () => withMikrotikRetry(
        () => runPhpMikrotik('setNetwatch', 'set_netwatch', [], {
            envSecrets: {
                id,
                host,
                comment: params.comment || '',
                interval: params.interval || '',
                timeout: params.timeout || '',
                upscript: params.upScript || '',
                downscript: params.downScript || '',
                disabled: params.disabled === true ? 'yes' : params.disabled === false ? 'no' : '',
            },
            context,
            timeoutMs: 12000,
        }),
        { operation: 'setNetwatch' }
    ));
}

// Hapus entri netwatch by daftar .id (CSV). Pemanggil sudah menyaring HANYA .id milik-CCTV.
async function removeNetwatch(params = {}, context = {}) {
    const ids = Array.isArray(params.ids) ? params.ids : String(params.ids || '').split(',');
    const list = ids.map((x) => String(x || '').trim()).filter(Boolean);
    if (list.length === 0) return { ok: true, data: { removed: 0 } };
    const host = String(params.host || '').trim();
    return withMikrotikKeyLock(`netwatch:${host || list[0]}`, () => withMikrotikRetry(
        () => runPhpMikrotik('removeNetwatch', 'remove_netwatch', [], {
            envSecrets: { ids: list.join(',') },
            context,
            timeoutMs: 12000,
        }),
        { operation: 'removeNetwatch' }
    ));
}

module.exports = {
    getNetwatchList,
    getNetwatchFull,
    addNetwatch,
    setNetwatch,
    removeNetwatch,
};
