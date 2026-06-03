const {
    setWifiCredentials: facadeSetWifiCredentials,
    setPPPoECredentials: facadeSetPPPoECredentials,
    updatePsbDeviceConfig: facadeUpdatePsbDeviceConfig,
    getDeviceInfo,
    rebootDevice,
} = require('./genieacs');

async function setWifiCredentials(deviceId, ssidIndex, ssidName, password, options = {}) {
    return facadeSetWifiCredentials(deviceId, ssidIndex, ssidName, password, options);
}

async function setPPPoECredentials(deviceId, username, password, options = {}) {
    return facadeSetPPPoECredentials(deviceId, username, password, options);
}

async function updatePsbDeviceConfig(deviceId, payload = {}, options = {}) {
    return facadeUpdatePsbDeviceConfig(deviceId, payload, options);
}

module.exports = {
    setWifiCredentials,
    setPPPoECredentials,
    updatePsbDeviceConfig,
    getDeviceInfo,
    rebootDevice,
};
