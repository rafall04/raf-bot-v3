const {
    setWifiCredentials: facadeSetWifiCredentials,
    setPPPoECredentials: facadeSetPPPoECredentials,
    getDeviceInfo,
    rebootDevice,
} = require('./genieacs');

async function setWifiCredentials(deviceId, ssidIndex, ssidName, password, options = {}) {
    return facadeSetWifiCredentials(deviceId, ssidIndex, ssidName, password, options);
}

async function setPPPoECredentials(deviceId, username, password, options = {}) {
    return facadeSetPPPoECredentials(deviceId, username, password, options);
}

module.exports = {
    setWifiCredentials,
    setPPPoECredentials,
    getDeviceInfo,
    rebootDevice,
};
