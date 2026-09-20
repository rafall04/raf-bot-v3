/**
 * Header Doc
 * Purpose: Operasi Hotspot MikroTik via bridge PHP — profil, stats, user aktif,
 *   batch-add voucher (satu koneksi RouterOS), dan /system/script log Mikhmon
 *   (reconcile voucher). Batch add & script removal NON-idempotent → tanpa retry.
 * Caller: facade lib/mikrotik.js (konsumen: voucher-print, voucher-manager, dashboard).
 * Deps: lib/mikrotik/core (runPhpMikrotik + withMikrotikRetry).
 * MainFuncs: getHotspotProfiles, addHotspotUsersBatch, getHotspotLogScripts,
 *   removeScriptsByIds, getHotspotStats, getActiveHotspotUsers.
 * SideEffects: spawn `php views/<script>.php`; create/hapus user hotspot di router.
 */
"use strict";

const {
    runPhpMikrotik,
    withMikrotikRetry,
} = require('./core');

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

module.exports = {
    getHotspotProfiles,
    addHotspotUsersBatch,
    getHotspotLogScripts,
    removeScriptsByIds,
    getHotspotStats,
    getActiveHotspotUsers,
};
