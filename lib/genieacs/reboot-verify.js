/**
 * Header Doc
 * Purpose: Tulisan parameter GenieACS — setParameterValues(+verify read-back), reboot device, mapper hasil legacy.
 * Caller: facade `lib/genieacs.js` (re-export; jangan require langsung kecuali test).
 * Deps: ./session, ./device-read.
 * MainFuncs: `setParameterValues`, `verifyAppliedValues`, `rebootDevice`, `toLegacyMutationResult`.
 * SideEffects: sama seperti lib/genieacs.js asli (split #b393 — murni pemindahan kode).
 */
const { getNestedValue, unwrapValue, uniqueValues, deriveObjectNameFromPath, getDeviceRecord, refreshDeviceObjects } = require('./device-read');
const { createResult, getGenieAcsConfig, getGenieAcsFeatureFlags, logResult, withDeviceLock, submitTask } = require('./session');

async function verifyAppliedValues(deviceId, verificationPaths, refreshObjects, operation, options = {}) {
    const startedAt = Date.now();
    const config = getGenieAcsConfig();
    const verifyTimeoutMs = options.verifyTimeoutMs || config.verifyTimeoutMs;
    const verifyIntervalMs = options.verifyIntervalMs || config.verifyIntervalMs;
    const verificationMode = options.verificationMode || 'strict_readback';
    const allowSensitiveReadback = options.verifySensitive === true || verificationMode === 'strict_readback_all';
    const pathsToVerify = verificationPaths.filter((entry) => allowSensitiveReadback || !entry.sensitive);
    const unverifiedPaths = verificationPaths
        .filter((entry) => entry.sensitive && !allowSensitiveReadback)
        .map((entry) => entry.path);

    if (pathsToVerify.length === 0) {
        return createResult(operation, {
            ok: true,
            accepted: true,
            applied: true,
            message: 'Task GenieACS diterima tanpa readback sensitif.',
            details: {
                verificationMode,
                verifiedPaths: [],
                unverifiedPaths,
            },
            timingMs: Date.now() - startedAt,
        });
    }

    let lastDeviceResult = null;

    if (refreshObjects.length > 0) {
        await refreshDeviceObjects(deviceId, refreshObjects, { operation: `${operation}.refresh` });
    }

    const deadline = Date.now() + verifyTimeoutMs;

    while (Date.now() <= deadline) {
        lastDeviceResult = await getDeviceRecord(deviceId, pathsToVerify.map((entry) => entry.path), {
            operation: `${operation}.verify`,
        });
        if (lastDeviceResult.ok) {
            const mismatches = pathsToVerify.filter((entry) => unwrapValue(getNestedValue(lastDeviceResult.data, entry.path)) !== entry.expectedValue);
            if (mismatches.length === 0) {
                return createResult(operation, {
                    ok: true,
                    accepted: true,
                    applied: true,
                    message: 'Perubahan GenieACS berhasil diterapkan dan tervalidasi.',
                    data: lastDeviceResult.data,
                    details: {
                        verificationMode,
                        verifiedPaths: pathsToVerify.map((entry) => entry.path),
                        unverifiedPaths,
                    },
                    timingMs: Date.now() - startedAt,
                });
            }
        }

        await new Promise((resolve) => setTimeout(resolve, verifyIntervalMs));
    }

    return createResult(operation, {
        ok: true,
        accepted: true,
        applied: false,
        message: 'Task GenieACS diterima, tetapi perubahan belum tervalidasi pada device.',
        errorCode: 'TASK_NOT_APPLIED',
        data: lastDeviceResult?.data || null,
        details: {
            verificationMode,
            verifiedPaths: pathsToVerify.map((entry) => entry.path),
            unverifiedPaths,
        },
        timingMs: Date.now() - startedAt,
    });
}


async function setParameterValues(deviceId, parameterValues = [], options = {}) {
    return withDeviceLock(deviceId, () => setParameterValuesInternal(deviceId, parameterValues, options));
}


async function setParameterValuesInternal(deviceId, parameterValues = [], options = {}) {
    const startedAt = Date.now();
    const operation = options.operation || 'setParameterValues';
    const normalizedValues = Array.isArray(parameterValues) ? parameterValues.filter((entry) => Array.isArray(entry) && entry[0]) : [];
    const verificationPaths = Array.isArray(options.verificationPaths) ? options.verificationPaths.filter((entry) => entry && entry.path) : [];
    const refreshObjectsList = uniqueValues(
        Array.isArray(options.refreshObjects)
            ? options.refreshObjects
            : verificationPaths.map((entry) => deriveObjectNameFromPath(entry.path))
    );
    const verificationMode = options.verificationMode || (verificationPaths.some((entry) => !entry.sensitive) ? 'strict_readback' : 'accept_task_only');

    if (normalizedValues.length === 0) {
        return createResult(operation, {
            message: 'Tidak ada parameter GenieACS yang dikirim.',
            errorCode: 'PARSE_ERROR',
            timingMs: Date.now() - startedAt,
        });
    }

    const submitResult = await submitTask(deviceId, {
        name: 'setParameterValues',
        parameterValues: normalizedValues,
    }, operation, {
        successMessage: options.successMessage || 'Task perubahan parameter berhasil dikirim ke GenieACS.',
        failureMessage: options.failureMessage || 'Gagal mengirim perubahan parameter ke GenieACS.',
        timeoutMs: options.timeoutMs,
    });

    if (!submitResult.ok || verificationMode === 'accept_task_only' || verificationPaths.length === 0) {
        submitResult.accepted = submitResult.ok;
        submitResult.applied = submitResult.ok ? null : submitResult.applied;

        // !! PENEGAKAN PUSAT `queuedOnly` (#b254).
        // Inilah titik yang benar, bukan `submitTask`: di sini kita TAHU verifikasi baca-balik
        // tidak akan dilakukan (mode `accept_task_only` dipilih justru karena sandi WiFi/PPPoE
        // TAK BISA dibaca balik), jadi status HTTP adalah SATU-SATUNYA bukti keterjangkauan.
        // Terukur di produksi: 29 dari 29 modem terjangkau memulangkan 200 — nol 202 palsu.
        // Tanpa ini, ganti sandi WiFi ke modem yang tak menjawab dilaporkan BERHASIL, dan
        // pelanggan diberi sandi baru yang tak pernah sampai ke modemnya.
        if (submitResult.ok
            && submitResult.details && submitResult.details.queuedOnly
            && getGenieAcsFeatureFlags().queuedOnlyIsFailure) {
            submitResult.ok = false;
            submitResult.accepted = true;   // ACS memang MENERIMA task-nya…
            submitResult.applied = false;   // …tapi modemnya TIDAK menerapkan.
            submitResult.errorCode = submitResult.errorCode || 'DEVICE_UNREACHABLE';
            submitResult.message = 'Modem tidak menjawab saat dihubungi — setelan hanya masuk antrean GenieACS, BELUM diterapkan ke modem.';
        }

        submitResult.details = {
            ...(submitResult.details || {}),
            verificationMode,
            verifiedPaths: [],
            unverifiedPaths: verificationPaths.map((entry) => entry.path),
        };
        submitResult.timingMs = Date.now() - startedAt;
        return submitResult;
    }

    const verifyResult = await verifyAppliedValues(deviceId, verificationPaths, refreshObjectsList, operation, {
        ...options,
        verificationMode,
    });
    verifyResult.accepted = true;
    verifyResult.data = {
        ...(verifyResult.data || {}),
        taskId: submitResult.data?.taskId || null,
    };
    verifyResult.timingMs = Date.now() - startedAt;
    return verifyResult;
}


async function rebootDevice(deviceId, options = {}) {
    return withDeviceLock(deviceId, async () => {
        const startedAt = Date.now();
        const result = await submitTask(deviceId, { name: 'reboot' }, 'rebootDevice', {
            verifyApplied: false,
            successMessage: 'Perintah reboot berhasil dikirim ke GenieACS.',
        });

        // #b347: cermin PENEGAKAN queuedOnly (#b254) yang ada di setParameterValuesInternal:1644 &
        // provisioning — jalur reboot terlewat. HTTP 202 = task cuma masuk antrean karena modem TAK
        // MENJAWAB → reboot BELUM tereksekusi. Dulu hanya cek result.ok (202→ok:true) sehingga panel
        // admin / self-service / WA dikabari "berhasil" padahal modem offline tak pernah reboot (dan
        // task mengendap = queue leak). Set ok:false/applied:false → toLegacyMutationResult di hilir
        // otomatis success:false, pemanggil menampilkan "belum tereksekusi".
        if (result.ok && result.details && result.details.queuedOnly && getGenieAcsFeatureFlags().queuedOnlyIsFailure) {
            result.ok = false;
            result.accepted = true;   // ACS MENERIMA task-nya…
            result.applied = false;   // …tapi modem TIDAK menerapkannya.
            result.errorCode = result.errorCode || 'DEVICE_UNREACHABLE';
            result.message = 'Modem tidak menjawab saat dihubungi — perintah reboot hanya masuk antrean GenieACS, BELUM dieksekusi ke modem.';
        } else if (result.ok) {
            result.applied = null;
            result.message = 'Perintah reboot diterima GenieACS.';
        }

        result.timingMs = Date.now() - startedAt;
        logResult(result, options.context);
        return result;
    });
}


function toLegacyMutationResult(result) {
    return {
        success: result.ok && result.accepted && result.applied !== false,
        ok: result.ok,
        accepted: result.accepted,
        applied: result.applied,
        message: result.message,
        errorCode: result.errorCode,
        details: result.details,
        timingMs: result.timingMs,
        taskId: result.data?.taskId || null,
        data: result.data || null,
    };
}


module.exports = {
    verifyAppliedValues,
    setParameterValues,
    setParameterValuesInternal,
    rebootDevice,
    toLegacyMutationResult,
};
