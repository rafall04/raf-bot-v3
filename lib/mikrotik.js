/**
 * Header Doc
 * Purpose: FACADE adapter MikroTik — menjaga API publik `require('lib/mikrotik')` identik
 *   (33 export, nama & signature sama) setelah isinya dipecah ke lib/mikrotik/*.
 * Caller: 60+ callsite di routes/, services/, lib/, message/, index.js — tak berubah.
 * Deps: lib/mikrotik/{core,pppoe,netwatch,hotspot,site-http}.js.
 * MainFuncs: (re-export) runPhpMikrotik, createResult, assertMikrotikResult,
 *   getMikrotikConfig, invalidateMikrotikConfigCache, isMikrotikSyncEnabled,
 *   getMikrotikDiagnostics, checkPPPoEUserExists, updatePPPoEProfile, deleteActivePPPoEUser,
 *   removePPPoESecret, getActivePPPoEUsers, getSteeringAddressLists, getPPPProfiles,
 *   getNetwatchList, getNetwatchFull, addNetwatch, setNetwatch, removeNetwatch,
 *   getHotspotProfiles, addHotspotUsersBatch, getHotspotLogScripts, removeScriptsByIds,
 *   getPPPUsers, addPPPoEUser, getPPPoEUserProfile, getAllPPPoESecrets, getPppStats,
 *   getHotspotStats, getActiveHotspotUsers, statusap, getvoucher, addbinding, addqueue,
 *   _resetMikrotikCircuitForTests, _resetMikrotikKeyLocksForTests.
 * SideEffects: Memuat submodule (mendaftarkan keep-alive agent + circuit state tunggal di core).
 */
"use strict";

const core = require('./mikrotik/core');
const pppoe = require('./mikrotik/pppoe');
const netwatch = require('./mikrotik/netwatch');
const hotspot = require('./mikrotik/hotspot');
const siteHttp = require('./mikrotik/site-http');

module.exports = {
    // core: transport + config + retry/circuit/locks
    runPhpMikrotik: core.runPhpMikrotik,
    createResult: core.createResult,
    assertMikrotikResult: core.assertMikrotikResult,
    getMikrotikConfig: core.getMikrotikConfig,
    invalidateMikrotikConfigCache: core.invalidateMikrotikConfigCache,
    isMikrotikSyncEnabled: core.isMikrotikSyncEnabled,
    getMikrotikDiagnostics: core.getMikrotikDiagnostics,
    // pppoe
    checkPPPoEUserExists: pppoe.checkPPPoEUserExists,
    updatePPPoEProfile: pppoe.updatePPPoEProfile,
    deleteActivePPPoEUser: pppoe.deleteActivePPPoEUser,
    removePPPoESecret: pppoe.removePPPoESecret,
    getActivePPPoEUsers: pppoe.getActivePPPoEUsers,
    getSteeringAddressLists: pppoe.getSteeringAddressLists,
    getPPPProfiles: pppoe.getPPPProfiles,
    getPPPUsers: pppoe.getPPPUsers,
    addPPPoEUser: pppoe.addPPPoEUser,
    getPPPoEUserProfile: pppoe.getPPPoEUserProfile,
    getAllPPPoESecrets: pppoe.getAllPPPoESecrets,
    getPppStats: pppoe.getPppStats,
    // netwatch
    getNetwatchList: netwatch.getNetwatchList,
    getNetwatchFull: netwatch.getNetwatchFull,
    addNetwatch: netwatch.addNetwatch,
    setNetwatch: netwatch.setNetwatch,
    removeNetwatch: netwatch.removeNetwatch,
    // hotspot
    getHotspotProfiles: hotspot.getHotspotProfiles,
    addHotspotUsersBatch: hotspot.addHotspotUsersBatch,
    getHotspotLogScripts: hotspot.getHotspotLogScripts,
    removeScriptsByIds: hotspot.removeScriptsByIds,
    getHotspotStats: hotspot.getHotspotStats,
    getActiveHotspotUsers: hotspot.getActiveHotspotUsers,
    // site-http
    statusap: siteHttp.statusap,
    getvoucher: siteHttp.getvoucher,
    addbinding: siteHttp.addbinding,
    addqueue: siteHttp.addqueue,
    // Internal — diekspos hanya untuk test.
    _resetMikrotikCircuitForTests: core._resetMikrotikCircuitForTests,
    _resetMikrotikKeyLocksForTests: core._resetMikrotikKeyLocksForTests,
};
