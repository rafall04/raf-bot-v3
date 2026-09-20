/**
 * Header Doc
 * Purpose: Operasi PPPoE ke MikroTik via bridge PHP — profil, secret, sesi aktif, user,
 *   stats, dan steering address-lists. Semua dibungkus withMikrotikRetry (baca = retryable;
 *   mutasi dikunci per-username via withMikrotikKeyLock).
 * Caller: facade lib/mikrotik.js.
 * Deps: lib/mikrotik/core (transport + retry + lock + sanitize).
 * MainFuncs: updatePPPoEProfile, deleteActivePPPoEUser, removePPPoESecret, getPPPProfiles,
 *   getPPPUsers, getActivePPPoEUsers, getAllPPPoESecrets, getPPPoEUserProfile,
 *   checkPPPoEUserExists, addPPPoEUser, getPppStats, getSteeringAddressLists.
 * SideEffects: spawn `php views/<script>.php` (bridge ke RouterOS API).
 */
"use strict";

const {
    runPhpMikrotik,
    withMikrotikRetry,
    withMikrotikKeyLock,
    sanitizeValue,
} = require('./core');

// Read & idempotent mutation ops di file ini — semua aman di-retry oleh
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

// Hapus PPPoE user TUNTAS dari MikroTik: hapus /ppp/secret (kredensial → tak bisa konek
// lagi) + putus /ppp/active (sesi berjalan). Idempoten (secret sudah tak ada = sukses).
// Dipakai saat hapus pelanggan agar sekali hapus di bot = ikut bersih di MikroTik.
async function removePPPoESecret(username, context = {}) {
    return withMikrotikKeyLock(`pppoe:${username}`, () => withMikrotikRetry(
        () => runPhpMikrotik('removePPPoESecret', 'delete_pppoe_secret', [username], { context }),
        { operation: 'removePPPoESecret' }
    ));
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

// Keanggotaan address-list steering pelanggan (RAF-STEER-<jalur>) — dipakai lib/customer-path-resolver
// untuk memetakan IP pelanggan -> jalur upstream LIVE (bukan CIDR statik). READ-ONLY, di-cache pemanggil.
async function getSteeringAddressLists(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getSteeringAddressLists', 'get_steering_lists', [], { context, timeoutMs: 10000 }),
        { operation: 'getSteeringAddressLists' }
    );
}

async function getPPPUsers(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getPPPUsers', 'get_pppoe_users', [], { context }),
        { operation: 'getPPPUsers' }
    );
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

async function getAllPPPoESecrets(context = {}) {
    return withMikrotikRetry(
        () => runPhpMikrotik('getAllPPPoESecrets', 'get_all_pppoe_secrets', [], { context, timeoutMs: 15000 }),
        { operation: 'getAllPPPoESecrets' }
    );
}

module.exports = {
    updatePPPoEProfile,
    deleteActivePPPoEUser,
    removePPPoESecret,
    getPPPProfiles,
    getPPPUsers,
    getActivePPPoEUsers,
    getAllPPPoESecrets,
    getPPPoEUserProfile,
    checkPPPoEUserExists,
    addPPPoEUser,
    getPppStats,
    getSteeringAddressLists,
};
