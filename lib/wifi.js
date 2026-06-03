const {
    getWifiInfo,
    getCustomerRedaman: getCustomerRedamanResult,
    getDeviceCoreInfo: getDeviceCoreInfoResult,
    getMultipleDeviceMetrics: getMultipleDeviceMetricsResult,
    rebootDevice,
    setWifiName,
    setWifiPassword,
    setWifiTransmitPower,
    updateWifiSettings: updateWifiSettingsFacade,
    toLegacyMutationResult,
    getParameterPaths,
    getGenieAcsFeatureStatus,
} = require('./genieacs');

const REDAMAN_PATHS = getParameterPaths('redaman');
const TEMPERATURE_PATHS = getParameterPaths('temperature');

function normalizeLegacyWifiArgs(secondArg, thirdArg, defaultIndex = '1') {
    if (thirdArg === undefined) {
        return { ssidIndex: defaultIndex, value: secondArg };
    }

    const secondIsIndex = !Number.isNaN(parseInt(String(secondArg), 10));
    const thirdIsIndex = !Number.isNaN(parseInt(String(thirdArg), 10));

    if (secondIsIndex && !thirdIsIndex) {
        return { ssidIndex: String(secondArg), value: thirdArg };
    }

    if (!secondIsIndex && thirdIsIndex) {
        return { ssidIndex: String(thirdArg), value: secondArg };
    }

    return { ssidIndex: defaultIndex, value: thirdArg ?? secondArg };
}

async function getSSIDInfo(deviceId, skipRefresh = true) {
    const result = await getWifiInfo(deviceId, { skipRefresh });
    if (!result.ok) {
        throw new Error(result.message);
    }
    return result.data;
}

async function getCustomerRedaman(deviceId) {
    const result = await getCustomerRedamanResult(deviceId, {
        operation: 'wifi.getCustomerRedaman',
        skipRefresh: false,
    });
    if (!result.ok) {
        throw new Error(result.message);
    }
    return { redaman: result.data.redaman };
}

async function getDeviceCoreInfo(deviceId) {
    const result = await getDeviceCoreInfoResult(deviceId, {
        operation: 'wifi.getDeviceCoreInfo',
        skipRefresh: false,
    });
    if (!result.ok) {
        throw new Error(result.message);
    }
    return result.data;
}

async function getMultipleDeviceMetrics(deviceIds) {
    const result = await getMultipleDeviceMetricsResult(deviceIds, {
        operation: 'wifi.getMultipleDeviceMetrics',
        skipRefresh: false,
    });
    if (!result.ok) {
        throw new Error(result.message);
    }
    return result.data;
}

async function setPassword(deviceId, secondArg, thirdArg, options = {}) {
    const featureStatus = await getGenieAcsFeatureStatus({
        feature: 'wifiManagement',
        deviceId,
    });
    if (!featureStatus.available) {
        return {
            success: false,
            ok: false,
            accepted: false,
            applied: false,
            message: featureStatus.reason,
            errorCode: featureStatus.errorCode,
            data: { featureStatus },
        };
    }
    const { ssidIndex, value } = normalizeLegacyWifiArgs(secondArg, thirdArg);
    const result = await setWifiPassword(deviceId, ssidIndex, value, options);
    return toLegacyMutationResult(result);
}

async function setSSIDName(deviceId, secondArg, thirdArg, options = {}) {
    const featureStatus = await getGenieAcsFeatureStatus({
        feature: 'wifiManagement',
        deviceId,
    });
    if (!featureStatus.available) {
        return {
            success: false,
            ok: false,
            accepted: false,
            applied: false,
            message: featureStatus.reason,
            errorCode: featureStatus.errorCode,
            data: { featureStatus },
        };
    }
    const { ssidIndex, value } = normalizeLegacyWifiArgs(secondArg, thirdArg);
    const result = await setWifiName(deviceId, ssidIndex, value, options);
    return toLegacyMutationResult(result);
}

async function rebootRouter(deviceId, options = {}) {
    const featureStatus = await getGenieAcsFeatureStatus({
        feature: options.featureScope || 'adminReboot',
        deviceId,
    });
    if (!featureStatus.available) {
        return {
            success: false,
            ok: false,
            accepted: false,
            applied: false,
            message: featureStatus.reason,
            errorCode: featureStatus.errorCode,
            data: { featureStatus },
        };
    }
    const result = await rebootDevice(deviceId, options);
    return toLegacyMutationResult(result);
}

async function updateWifiSettings(deviceId, payload, options = {}) {
    const featureStatus = await getGenieAcsFeatureStatus({
        feature: 'wifiManagement',
        deviceId,
    });
    if (!featureStatus.available) {
        return {
            status: 503,
            accepted: false,
            applied: false,
            ok: false,
            message: featureStatus.reason,
            errorCode: featureStatus.errorCode,
            details: { featureStatus },
            data: null,
        };
    }
    const result = await updateWifiSettingsFacade(deviceId, payload, options);
    return {
        status: result.ok ? 200 : 500,
        accepted: result.accepted,
        applied: result.applied,
        ok: result.ok,
        message: result.message,
        errorCode: result.errorCode,
        details: result.details,
        data: result.data,
    };
}

async function setTransmitPower(deviceId, ssidIndex, level, options = {}) {
    const featureStatus = await getGenieAcsFeatureStatus({
        feature: 'wifiManagement',
        deviceId,
    });
    if (!featureStatus.available) {
        return {
            success: false,
            ok: false,
            accepted: false,
            applied: false,
            message: featureStatus.reason,
            errorCode: featureStatus.errorCode,
            data: { featureStatus },
        };
    }
    const result = await setWifiTransmitPower(deviceId, ssidIndex, level, options);
    return toLegacyMutationResult(result);
}

module.exports = {
    getSSIDInfo,
    getCustomerRedaman,
    getDeviceCoreInfo,
    getMultipleDeviceMetrics,
    rebootRouter,
    REDAMAN_PATHS,
    TEMPERATURE_PATHS,
    setPassword,
    setSSIDName,
    updateWifiSettings,
    setTransmitPower,
};
