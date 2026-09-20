/**
 * Header Doc
 * Purpose: Facade adapter GenieACS (TR-069) — re-export API publik; implementasi kini di `lib/genieacs/`.
 * Caller: `lib/wifi.js`, `lib/genieacs-*.js`, `services/network-ops.service.js`, handler WA lewat `lib/wifi`.
 * Deps: `lib/genieacs/session` (transport/circuit/lock), `device-read` (bacaan+extractor),
 *       `reboot-verify` (setParameterValues+verify), `wifi-params`, `pppoe-params`.
 * MainFuncs: `getDeviceRecord`, `setParameterValues`, `setWifiCredentials`, `updateWifiSettings`, `applyBulkWifiUpdates`, `setPPPoECredentials`, `rebootDevice`.
 * SideEffects: tidak ada logika di sini — pemecahan murni (#b393); state (circuit breaker, deviceLocks,
 *              http agents) tetap tunggal karena semua submodul berbagi `./session` (cache require Node).
 */
const session = require('./genieacs/session');
const deviceRead = require('./genieacs/device-read');
const rebootVerify = require('./genieacs/reboot-verify');
const wifiParams = require('./genieacs/wifi-params');
const pppoeParams = require('./genieacs/pppoe-params');

module.exports = {
    createResult: session.createResult,
    getGenieAcsConfig: session.getGenieAcsConfig,
    getGenieAcsFeatureStatus: deviceRead.getGenieAcsFeatureStatus,
    parseWifiPayload: wifiParams.parseWifiPayload,
    getParameterPaths: deviceRead.getParameterPaths,
    resolvePathTemplates: deviceRead.resolvePathTemplates,
    getDefaultPaths: deviceRead.getDefaultPaths,
    getNestedValue: deviceRead.getNestedValue,
    unwrapValue: deviceRead.unwrapValue,
    queryDevices: deviceRead.queryDevices,
    getDeviceById: deviceRead.getDeviceById,
    getParameterValue: deviceRead.getParameterValue,
    getParameterValueByPath: deviceRead.getParameterValueByPath,
    setParameterValues: rebootVerify.setParameterValues,
    refreshObjects: deviceRead.refreshObjects,
    probeDeviceReachable: deviceRead.probeDeviceReachable,
    extractPppoeUsername: deviceRead.extractPppoeUsername,
    extractPppoeUsernames: deviceRead.extractPppoeUsernames,
    extractPppoePassword: deviceRead.extractPppoePassword,
    extractSerialNumber: deviceRead.extractSerialNumber,
    extractDeviceModel: deviceRead.extractDeviceModel,
    extractDeviceManufacturer: deviceRead.extractDeviceManufacturer,
    extractRegisteredDate: deviceRead.extractRegisteredDate,
    extractRegisteredTimestamp: deviceRead.extractRegisteredTimestamp,
    getWifiInfo: deviceRead.getWifiInfo,
    getCustomerRedaman: deviceRead.getCustomerRedaman,
    getConnectedDevices: deviceRead.getConnectedDevices,
    getDeviceInfo: deviceRead.getDeviceInfo,
    getDeviceCoreInfo: deviceRead.getDeviceCoreInfo,
    getMultipleDeviceMetrics: deviceRead.getMultipleDeviceMetrics,
    getPsbDevice: deviceRead.getPsbDevice,
    refreshDeviceObjects: deviceRead.refreshDeviceObjects,
    rebootDevice: rebootVerify.rebootDevice,
    setWifiCredentials: wifiParams.setWifiCredentials,
    setWifiName: wifiParams.setWifiName,
    setWifiPassword: wifiParams.setWifiPassword,
    applyBulkWifiUpdates: wifiParams.applyBulkWifiUpdates,
    setBulkWifiPasswords: wifiParams.setBulkWifiPasswords,
    setBulkWifiNames: wifiParams.setBulkWifiNames,
    setWifiTransmitPower: wifiParams.setWifiTransmitPower,
    setPPPoECredentials: pppoeParams.setPPPoECredentials,
    updatePsbDeviceConfig: pppoeParams.updatePsbDeviceConfig,
    updateWifiSettings: wifiParams.updateWifiSettings,
    getGenieAcsDiagnostics: deviceRead.getGenieAcsDiagnostics,
    toLegacyMutationResult: rebootVerify.toLegacyMutationResult,
    // Internal — diekspos hanya untuk test, jangan dipanggil dari luar.
    _resetCircuitForTests: session._resetCircuitForTests,
};
