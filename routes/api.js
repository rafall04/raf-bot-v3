/**
 * Header Doc
 * Purpose: Mengagregasi sub-router API internal dan menyuntik dependency domain ke factory route modular.
 * Caller: `index.js` melalui mount `/api`.
 * Deps: Express, helper route API, service domain users/PSB/voucher/network, database helper, dan runtime app.
 * MainFuncs: `router.use(createApiNetworkRouter)`, `router.use(createApiUsersRouter)`, `router.use(createApiPsbRouter)`, `router.use(createApiVoucherRouter)`.
 * SideEffects: Menyatukan dependency injection route API dan mewariskan runtime app ke hotspot hasil stabilisasi.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const { hashPassword, comparePassword } = require('../lib/password');
const {
    updatePPPoEProfile,
    deleteActivePPPoEUser,
    addPPPoEUser,
    checkPPPoEUserExists,
    getAllPPPoESecrets,
    getPPPProfiles,
    getHotspotProfiles,
    assertMikrotikResult,
    getMikrotikDiagnostics,
    isMikrotikSyncEnabled,
} = require('../lib/mikrotik');
const { getProfileBySubscription } = require('../lib/myfunc');
const { handlePaidStatusChange } = require('../lib/approval-logic');
const { getPeriodParts, evaluateCollectionSettlement } = require('../lib/technician-collection-settlement');
const {
    applyPaymentStatusChange,
    getEffectivePrice,
    normalizeUserPaymentMethod
} = require('../lib/payment-finance-service');
const { validatePhoneNumbers, normalizePhone, getSupportedCountries } = require('../lib/phone-validator-international');
const { renderTemplate, templatesCache } = require('../lib/templating');
const { 
    savePackage, 
    saveAccounts, 
    loadJSON, 
    saveJSON,
    updateOdpPortUsage,
    updateOdcPortUsage,
    saveNetworkAssets
} = require('../lib/database');
const { parseGoogleMapsLink, generateRandomPassword, validateCoordinates } = require('../lib/psb-helper');
const { sendPSBPhase1Notification, sendPSBPhase2Notification, sendPSBTeknisiMeluncurNotification, sendPSBInstallationCompleteNotification } = require('../lib/psb-notification');
const { logActivity } = require('../lib/activity-logger');
const { insertPSBRecord, updatePSBRecord, getPSBRecord, getPSBRecordsByStatus, movePSBToUsers, getNextAvailablePSBId, getNextAvailableUserId } = require('../lib/psb-database');
const { logWifiChange } = require('../lib/wifi-logger');
const { getGenieAcsConfig, getGenieAcsFeatureStatus } = require('../lib/genieacs');
const crypto = require('crypto');
const { rateLimit } = require('../lib/security');
const { withLock } = require('../lib/request-lock');
const {
    findPsbDevice,
    listPsbDevices,
    getDevicesForImport,
    updatePsbDeviceConfig,
    testPsbConnections,
} = require('../lib/psb-genieacs-service');
const {
    loadVoucherSentHistory,
    appendVoucherSentHistory,
    resolveVoucherDeliveryStatus,
    buildVoucherSentHistoryEntries,
    getVoucherSentStats,
    findVoucherHistoryByReference
} = require('../lib/voucher-delivery');
const {
    ensureAuthenticated,
    ensureAdmin,
    ensureAuthenticatedStaff,
    normalizeQueryStringParam,
    redactPppoeFilter,
    buildMikrotikSyncResult,
} = require('./api-route-helpers');
const createApiNetworkRouter = require('./api-network-routes');
const createApiVoucherRouter = require('./api-voucher-routes');
const createApiUsersRouter = require('./api-users-routes');
const createApiPsbRouter = require('./api-psb-routes');
const createArrearsRouter = require('./arrears');
const psbService = require('../lib/services/api-psb-service');

const router = express.Router();
router.use(createApiNetworkRouter({
    ensureAuthenticated,
    ensureAdmin,
    updatePPPoEProfile,
    assertMikrotikResult,
    isMikrotikSyncEnabled,
    buildMikrotikSyncResult,
    getAllPPPoESecrets,
    getPPPProfiles,
    getHotspotProfiles,
    getDevicesForImport,
    runtime: global.__appRuntime || null
}));
router.use(createApiUsersRouter({
    hashPassword,
    comparePassword,
    updatePPPoEProfile,
    deleteActivePPPoEUser,
    addPPPoEUser,
    checkPPPoEUserExists,
    assertMikrotikResult,
    isMikrotikSyncEnabled,
    getProfileBySubscription,
    handlePaidStatusChange,
    getPeriodParts,
    applyPaymentStatusChange,
    getEffectivePrice,
    normalizeUserPaymentMethod,
    getNextAvailableUserId,
    validatePhoneNumbers,
    normalizePhone,
    getSupportedCountries,
    renderTemplate,
    templatesCache,
    savePackage,
    saveAccounts,
    loadJSON,
    saveJSON,
    updateOdpPortUsage,
    updateOdcPortUsage,
    saveNetworkAssets,
    logActivity,
    ensureAuthenticated,
    ensureAdmin,
    buildMikrotikSyncResult,
    runtime: global.__appRuntime || null,
}));
router.use(createApiPsbRouter({
    comparePassword,
    addPPPoEUser,
    checkPPPoEUserExists,
    assertMikrotikResult,
    getProfileBySubscription,
    validatePhoneNumbers,
    normalizePhone,
    parseGoogleMapsLink,
    validateCoordinates,
    generateRandomPassword,
    sendPSBPhase1Notification,
    sendPSBPhase2Notification,
    sendPSBTeknisiMeluncurNotification,
    sendPSBInstallationCompleteNotification,
    logActivity,
    insertPSBRecord,
    updatePSBRecord,
    getPSBRecord,
    getPSBRecordsByStatus,
    movePSBToUsers,
    getNextAvailablePSBId,
    getNextAvailableUserId,
    logWifiChange,
    rateLimit,
    withLock,
    findPsbDevice,
    listPsbDevices,
    updatePsbDeviceConfig,
    testPsbConnections,
    getGenieAcsConfig,
    getGenieAcsFeatureStatus,
    normalizeQueryStringParam,
    redactPppoeFilter,
    ensureAuthenticatedStaff,
    ensureAdmin,
    psbService,
    runtime: global.__appRuntime || null,
}));
router.use(createApiVoucherRouter({
    fs,
    path,
    renderTemplate,
    loadVoucherSentHistory,
    appendVoucherSentHistory,
    resolveVoucherDeliveryStatus,
    buildVoucherSentHistoryEntries,
    getVoucherSentStats,
    findVoucherHistoryByReference,
    runtime: global.__appRuntime || null
}));
router.use('/arrears', createArrearsRouter());

module.exports = router;
