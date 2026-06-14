/**
 * Header Doc
 * Purpose: Menjadi owner orchestration domain API PSB untuk intake, provisioning, transisi PSB ke users, dan handoff notifikasi route `api-psb-routes`.
 * Caller: `routes/api-psb-routes.js`.
 * Deps: `repositories/api-psb.repository.js`, adapter provisioning PSB/MikroTik, helper upload, dan notification boundary PSB.
 * MainFuncs: `createApiPsbService`, `submitPhase1`, `submitPhase2`, `submitPhase3`, `deleteAllPsbRecords`, `updatePsbStatus`, `activatePsbToUser`, `listPsbRecordsByStatus`, `getPsbRecordDetail`.
 * SideEffects: Membaca/menulis record PSB, memindahkan foto upload phase 1, memanggil adapter provisioning, memindahkan PSB ke users, menghapus snapshot PSB, dan mengirim notifikasi secara bertahap sesuai slice yang sudah dinormalisasi.
 */
"use strict";

function defaultDeps() {
    return {
        repository: null,
        comparePassword: null,
        addPPPoEUser: null,
        checkPPPoEUserExists: null,
        assertMikrotikResult: null,
        getProfileBySubscription: null,
        validatePhoneNumbers: null,
        normalizePhone: null,
        parseGoogleMapsLink: null,
        validateCoordinates: null,
        generateRandomPassword: null,
        getSSIDInfo: null,
        getNextAvailablePSBId: null,
        insertPSBRecord: null,
        sendPSBPhase1Notification: null,
        sendPSBPhase2Notification: null,
        sendPSBTeknisiMeluncurNotification: null,
        sendPSBInstallationCompleteNotification: null,
        logActivity: null,
        logWifiChange: null,
        updatePSBRecord: null,
        movePSBToUsers: null,
        updatePsbDeviceConfig: null,
        withLock: null,
        fs: require("fs"),
        path: require("path"),
        logger: console
    };
}

function createApiPsbService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        deps,

        async submitPhase1({
            phone_number,
            name,
            address,
            odc_id,
            odp_id,
            location_url,
            latitude,
            longitude,
            ktp_photo_path,
            house_photo_path,
            temp_id,
            userContext = {},
            requestMeta = {}
        } = {}) {
            if (!phone_number || !name || !address) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: "Nomor HP, nama, dan alamat harus diisi"
                    }
                };
            }

            if (!ktp_photo_path || !house_photo_path) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: "Foto KTP dan foto rumah harus diupload"
                    }
                };
            }

            let finalLat = latitude ? parseFloat(latitude) : null;
            let finalLng = longitude ? parseFloat(longitude) : null;

            if (location_url && (!finalLat || !finalLng)) {
                const parsed = deps.parseGoogleMapsLink?.(location_url);
                if (parsed) {
                    finalLat = parsed.latitude;
                    finalLng = parsed.longitude;
                }
            }

            if (finalLat !== null && finalLng !== null && !deps.validateCoordinates?.(finalLat, finalLng)) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: "Koordinat lokasi tidak valid"
                    }
                };
            }

            let accessLimit = 3;
            const configAccessLimit = deps.repository.getConfigSnapshot()?.accessLimit;
            const cronAccessLimit = deps.repository.getCronConfigSnapshot()?.accessLimit;

            if (configAccessLimit !== undefined && configAccessLimit !== null) {
                accessLimit = parseInt(configAccessLimit, 10) || 3;
            } else if (cronAccessLimit !== undefined && cronAccessLimit !== null) {
                accessLimit = parseInt(cronAccessLimit, 10) || 3;
            }

            const phoneNumbers = phone_number.split("|").map((phone) => phone.trim()).filter(Boolean);
            if (phoneNumbers.length === 0) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: "Minimal 1 nomor HP harus diisi"
                    }
                };
            }

            if (phoneNumbers.length > accessLimit) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: `Maksimal ${accessLimit} nomor HP sesuai konfigurasi. Anda memasukkan ${phoneNumbers.length} nomor.`
                    }
                };
            }

            const validationResult = await deps.validatePhoneNumbers?.(deps.repository.getDb(), phone_number, null, "ID");
            if (!validationResult?.valid) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: validationResult?.message,
                        conflictUser: validationResult?.conflictUser || null
                    }
                };
            }

            let customerId;
            try {
                customerId = await deps.getNextAvailablePSBId();
            } catch (error) {
                return {
                    status: 500,
                    body: {
                        status: 500,
                        message: "Gagal mendapatkan ID untuk customer baru",
                        error: error.message
                    }
                };
            }

            const year = String(new Date().getFullYear());
            const month = String(new Date().getMonth() + 1).padStart(2, "0");
            const finalDir = deps.path.join(requestMeta.baseDir || process.cwd(), "uploads/psb", year, month, String(customerId));
            if (!deps.fs.existsSync(finalDir)) {
                deps.fs.mkdirSync(finalDir, { recursive: true });
            }

            let finalKtpPath = ktp_photo_path;
            if (temp_id && ktp_photo_path.includes(temp_id)) {
                const oldKtpPath = deps.path.join(requestMeta.baseDir || process.cwd(), ktp_photo_path.replace(/^\//, ""));
                if (deps.fs.existsSync(oldKtpPath)) {
                    const ktpFilename = deps.path.basename(ktp_photo_path);
                    const finalKtpFilename = ktpFilename.startsWith("ktp_photo") ? ktpFilename : `ktp_photo${deps.path.extname(ktpFilename)}`;
                    const newKtpPath = deps.path.join(finalDir, finalKtpFilename);
                    deps.fs.renameSync(oldKtpPath, newKtpPath);
                    finalKtpPath = `/uploads/psb/${year}/${month}/${customerId}/${finalKtpFilename}`;
                }
            }

            let finalHousePath = house_photo_path;
            if (temp_id && house_photo_path.includes(temp_id)) {
                const oldHousePath = deps.path.join(requestMeta.baseDir || process.cwd(), house_photo_path.replace(/^\//, ""));
                if (deps.fs.existsSync(oldHousePath)) {
                    const houseFilename = deps.path.basename(house_photo_path);
                    const finalHouseFilename = houseFilename.startsWith("house_photo") ? houseFilename : `house_photo${deps.path.extname(houseFilename)}`;
                    const newHousePath = deps.path.join(finalDir, finalHouseFilename);
                    deps.fs.renameSync(oldHousePath, newHousePath);
                    finalHousePath = `/uploads/psb/${year}/${month}/${customerId}/${finalHouseFilename}`;
                }
            }

            if (temp_id) {
                const tempDir = deps.path.join(requestMeta.baseDir || process.cwd(), "uploads/psb", year, month, temp_id);
                try {
                    if (deps.fs.existsSync(tempDir)) {
                        const files = deps.fs.readdirSync(tempDir);
                        if (files.length === 0) {
                            deps.fs.rmdirSync(tempDir);
                        }
                    }
                } catch (error) {
                    deps.logger.warn?.(`[PSB_PHASE1] Could not clean up temp folder: ${error.message}`);
                }
            }

            const createdAt = new Date().toISOString();
            const psbRecord = {
                id: customerId,
                name,
                phone_number,
                address,
                latitude: finalLat,
                longitude: finalLng,
                location_url: location_url || null,
                psb_status: "phase1_completed",
                created_at: createdAt,
                created_by: userContext.username,
                phase1_completed_at: createdAt,
                odc_id: odc_id || null,
                odp_id: odp_id || null,
                psb_data: {
                    ktp_photo: finalKtpPath,
                    house_photo: finalHousePath,
                    location_shared_at: createdAt,
                    odc_id: odc_id || null,
                    odp_id: odp_id || null
                }
            };

            await deps.insertPSBRecord(psbRecord);
            deps.repository.updatePsbRecordsSnapshot((currentRecords) => [...currentRecords, psbRecord]);

            try {
                await deps.logActivity?.({
                    userId: userContext.id,
                    username: userContext.username,
                    role: userContext.role,
                    actionType: "CREATE",
                    resourceType: "user",
                    resourceId: String(customerId),
                    resourceName: name,
                    description: `PSB Phase 1 completed for ${name}`,
                    oldValue: null,
                    newValue: {
                        name,
                        phone_number,
                        psb_status: "phase1_completed"
                    },
                    ipAddress: requestMeta.ipAddress,
                    userAgent: requestMeta.userAgent
                });
            } catch (logErr) {
                deps.logger.error?.("[PSB_PHASE1] Activity log error:", logErr);
            }

            try {
                await deps.sendPSBPhase1Notification?.(psbRecord);
            } catch (notifErr) {
                deps.logger.error?.("[PSB_PHASE1] Notification error:", notifErr);
            }

            return {
                status: 200,
                body: {
                    status: 200,
                    message: "Data awal PSB berhasil disimpan",
                    data: {
                        customerId,
                        name,
                        phone_number,
                        psb_status: "phase1_completed"
                    }
                }
            };
        },

        async submitPhase2({ customerId, installed_odc_id, installed_odp_id, port_number, installation_notes, userContext = {}, requestMeta = {} } = {}) {
            if (!customerId) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: "Customer ID harus diisi"
                    }
                };
            }

            const phase2Records = deps.repository.getPsbRecordsSnapshot();
            const psbRecordIndex = phase2Records.findIndex((record) => String(record.id) === String(customerId));
            if (psbRecordIndex === -1) {
                return {
                    status: 404,
                    body: {
                        status: 404,
                        message: "Customer tidak ditemukan di database PSB"
                    }
                };
            }

            const currentRecord = phase2Records[psbRecordIndex];
            if (currentRecord.psb_status !== "phase1_completed" && currentRecord.psb_status !== "teknisi_meluncur") {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: `Customer belum siap untuk instalasi. Status saat ini: ${currentRecord.psb_status || "unknown"}. Status harus 'phase1_completed' atau 'teknisi_meluncur'.`
                    }
                };
            }

            const installedOdcId = installed_odc_id || null;
            const installedOdpId = installed_odp_id || null;
            const completedAt = new Date().toISOString();
            const psbData = {
                ...(currentRecord.psb_data || {}),
                phase2_completed_at: completedAt,
                installed_odc_id: installedOdcId,
                installed_odp_id: installedOdpId,
                port_number: port_number || null,
                installation_notes: installation_notes || null
            };

            await deps.updatePSBRecord(customerId, {
                psb_status: "phase2_completed",
                installed_odc_id: installedOdcId,
                installed_odp_id: installedOdpId,
                port_number: port_number || null,
                installation_notes: installation_notes || null,
                phase2_completed_at: completedAt,
                psb_data: psbData
            });

            const updatedRecord = {
                ...currentRecord,
                psb_status: "phase2_completed",
                installed_odc_id: installedOdcId,
                installed_odp_id: installedOdpId,
                port_number: port_number || null,
                installation_notes: installation_notes || null,
                phase2_completed_at: completedAt,
                psb_data: psbData
            };
            deps.repository.updatePsbRecordsSnapshot((records) =>
                records.map((record, index) => (index === psbRecordIndex ? updatedRecord : record))
            );

            try {
                await deps.logActivity?.({
                    userId: userContext.id,
                    username: userContext.username,
                    role: userContext.role,
                    actionType: "UPDATE",
                    resourceType: "psb",
                    resourceId: String(customerId),
                    resourceName: updatedRecord.name,
                    description: `PSB Phase 2 (Pemasangan) completed for ${updatedRecord.name}`,
                    oldValue: {
                        psb_status: currentRecord.psb_status,
                        installed_odc_id: currentRecord.installed_odc_id || null,
                        installed_odp_id: currentRecord.installed_odp_id || null
                    },
                    newValue: {
                        psb_status: "phase2_completed",
                        installed_odc_id: installedOdcId,
                        installed_odp_id: installedOdpId,
                        port_number: port_number || null
                    },
                    ipAddress: requestMeta.ipAddress,
                    userAgent: requestMeta.userAgent
                });
            } catch (logErr) {
                deps.logger.error?.("[PSB_PHASE2] Activity log error:", logErr);
            }

            try {
                await deps.sendPSBInstallationCompleteNotification?.(updatedRecord);
            } catch (notifErr) {
                deps.logger.error?.("[PSB_PHASE2] Notification error:", notifErr);
            }

            return {
                status: 200,
                body: {
                    status: 200,
                    message: "Data pemasangan berhasil disimpan",
                    data: {
                        customerId,
                        name: updatedRecord.name,
                        phone_number: updatedRecord.phone_number,
                        installed_odc_id: installedOdcId,
                        installed_odp_id: installedOdpId,
                        port_number: port_number || null
                    }
                }
            };
        },

        async submitPhase3({
            customerId,
            pppoe_username,
            pppoe_password,
            subscription,
            device_id,
            wifi_ssid,
            wifi_password,
            ssid_index = 1,
            ssid_indices = [],
            userContext = {},
            requestMeta = {}
        } = {}) {
            const transaction = {
                customerId: null,
                pppoeCreated: false,
                deviceUpdated: false
            };

            try {
                const ssidIndicesToUpdate = Array.isArray(ssid_indices) && ssid_indices.length > 0
                    ? ssid_indices
                    : [ssid_index];

                if (!customerId || !pppoe_username || !subscription || !device_id || !wifi_ssid || !wifi_password) {
                    return {
                        status: 400,
                        body: {
                            status: 400,
                            message: "Customer ID, PPPoE username, subscription, device ID, WiFi SSID, dan WiFi password harus diisi"
                        }
                    };
                }

                const phase3Records = deps.repository.getPsbRecordsSnapshot();
                const psbRecordIndex = phase3Records.findIndex((record) => String(record.id) === String(customerId));
                if (psbRecordIndex === -1) {
                    return {
                        status: 404,
                        body: {
                            status: 404,
                            message: "Customer tidak ditemukan di database PSB"
                        }
                    };
                }

                const psbRecord = phase3Records[psbRecordIndex];
                if (psbRecord.psb_status !== "phase2_completed") {
                    return {
                        status: 400,
                        body: {
                            status: 400,
                            message: `Customer belum menyelesaikan Fase 2 (Pemasangan). Status saat ini: ${psbRecord.psb_status || "unknown"}`
                        }
                    };
                }

                transaction.customerId = customerId;

                const finalPPPoEPassword = pppoe_password
                    || deps.repository.getConfigSnapshot()?.defaultPPPoEPassword
                    || deps.generateRandomPassword?.();

                const profile = deps.getProfileBySubscription?.(subscription);
                if (!profile) {
                    return {
                        status: 400,
                        body: {
                            status: 400,
                            message: `Profile tidak ditemukan untuk subscription: ${subscription}`
                        }
                    };
                }

                try {
                    const addPppoeResult = await deps.addPPPoEUser?.(pppoe_username, finalPPPoEPassword, profile, {
                        caller: "api.psb.submit-phase3"
                    });
                    deps.assertMikrotikResult?.(addPppoeResult);
                    transaction.pppoeCreated = true;
                    deps.logger.log?.(`[PSB_PHASE3] PPPoE user created in MikroTik: ${pppoe_username}`);
                } catch (mikrotikError) {
                    const errorMessage = mikrotikError.message || "";
                    const isDuplicateError = errorMessage.includes("sudah ada")
                        || errorMessage.includes("already")
                        || errorMessage.includes("Akun PPPoE dengan nama yang sama");

                    deps.logger.error?.("[PSB_PHASE3] MikroTik registration error:", mikrotikError);

                    if (isDuplicateError) {
                        return {
                            status: 400,
                            body: {
                                status: 400,
                                message: `PPPoE username "${pppoe_username}" sudah ada di MikroTik. Silakan gunakan username lain.`,
                                error: errorMessage,
                                errorType: "duplicate_username",
                                stoppedAt: "mikrotik_registration"
                            }
                        };
                    }

                    return {
                        status: 500,
                        body: {
                            status: 500,
                            message: "Gagal registrasi ke MikroTik. Pastikan koneksi ke MikroTik berjalan dan username tidak duplikat.",
                            error: errorMessage,
                            errorType: "mikrotik_error",
                            stoppedAt: "mikrotik_registration"
                        }
                    };
                }

                let oldSsidName = null;
                try {
                    const ssidInfo = await deps.getSSIDInfo?.(device_id, true);
                    if (ssidInfo && Array.isArray(ssidInfo.ssid) && ssidInfo.ssid.length > 0) {
                        const targetSsidIndex = ssidIndicesToUpdate[0] || ssid_index || "1";
                        const oldSsid = ssidInfo.ssid.find((ssid) => String(ssid.id) === String(targetSsidIndex));
                        oldSsidName = oldSsid?.name || null;
                    }
                } catch (ssidInfoError) {
                    deps.logger.warn?.(`[PSB_PHASE3] Could not fetch old SSID info from GenieACS: ${ssidInfoError.message}`);
                }

                let genieacsError = null;
                try {
                    const updateResponse = await deps.updatePsbDeviceConfig?.(device_id, {
                        pppUsername: pppoe_username,
                        pppPassword: finalPPPoEPassword,
                        wifiSSID: wifi_ssid,
                        wifiPassword: wifi_password,
                        ssidIndices: ssidIndicesToUpdate
                    }, {
                        timeoutMs: 30000,
                        operation: "api.psb.submitPhase3"
                    });

                    if (updateResponse?.ok && updateResponse?.accepted) {
                        transaction.deviceUpdated = true;
                    } else if (updateResponse) {
                        throw new Error(updateResponse.message || "Task GenieACS tidak diterima");
                    }
                } catch (genieError) {
                    // JANGAN telan diam-diam: PPPoE & user tetap dibuat, tapi modem mungkin
                    // belum terkonfigurasi. Simpan pesan agar di-surface ke teknisi (lihat return).
                    genieacsError = genieError.message;
                    deps.logger.warn?.("[PSB_PHASE3] GenieACS update failed, but continuing:", genieError.message);
                }

                const completedAt = new Date().toISOString();
                const psbData = {
                    ...(psbRecord.psb_data || {}),
                    phase3_completed_at: completedAt,
                    ssid_indices: ssidIndicesToUpdate,
                    wifi_config: {
                        ssid: wifi_ssid,
                        password: wifi_password,
                        ssid_indices: ssidIndicesToUpdate
                    }
                };

                await deps.updatePSBRecord?.(customerId, {
                    pppoe_username,
                    pppoe_password: finalPPPoEPassword,
                    device_id,
                    subscription,
                    psb_status: "completed",
                    psb_wifi_ssid: wifi_ssid,
                    psb_wifi_password: wifi_password,
                    phase3_completed_at: completedAt,
                    psb_data: psbData
                });

                const updatedRecord = {
                    ...psbRecord,
                    pppoe_username,
                    pppoe_password: finalPPPoEPassword,
                    device_id,
                    subscription,
                    psb_status: "completed",
                    psb_wifi_ssid: wifi_ssid,
                    psb_wifi_password: wifi_password,
                    phase3_completed_at: completedAt,
                    psb_data: psbData
                };
                deps.repository.updatePsbRecordsSnapshot((records) =>
                    records.map((record, index) => (index === psbRecordIndex ? updatedRecord : record))
                );

                const newUserId = await deps.movePSBToUsers?.(updatedRecord);
                const bulkSSIDs = ssidIndicesToUpdate.map((idx) => String(idx));
                const newUser = {
                    id: newUserId,
                    name: updatedRecord.name,
                    phone_number: updatedRecord.phone_number,
                    address: updatedRecord.address,
                    latitude: updatedRecord.latitude,
                    longitude: updatedRecord.longitude,
                    location_url: updatedRecord.location_url,
                    subscription,
                    device_id,
                    paid: false,
                    pppoe_username,
                    pppoe_password: finalPPPoEPassword,
                    connected_odp_id: updatedRecord.installed_odp_id || updatedRecord.odp_id,
                    bulk: bulkSSIDs,
                    send_invoice: 0,
                    is_corporate: 0,
                    created_at: updatedRecord.created_at,
                    updated_at: completedAt
                };
                deps.repository.updateUsers?.((currentUsers) => [...currentUsers, newUser]);

                try {
                    await deps.logActivity?.({
                        userId: userContext.id,
                        username: userContext.username,
                        role: userContext.role,
                        actionType: "UPDATE",
                        resourceType: "user",
                        resourceId: String(customerId),
                        resourceName: updatedRecord.name,
                        description: `PSB Phase 3 (Setup Awal Pelanggan) completed for ${updatedRecord.name}`,
                        oldValue: {
                            psb_status: "phase2_completed",
                            subscription: null,
                            device_id: null,
                            pppoe_username: null
                        },
                        newValue: {
                            psb_status: "completed",
                            subscription,
                            device_id,
                            pppoe_username,
                            wifi_ssid
                        },
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent
                    });
                } catch (logErr) {
                    deps.logger.error?.("[PSB_PHASE3] Activity log error:", logErr);
                }

                try {
                    await deps.logWifiChange?.({
                        userId: String(newUserId),
                        deviceId: device_id,
                        changeType: "both",
                        changes: {
                            oldSsidName,
                            newSsidName: wifi_ssid,
                            oldPassword: null,
                            newPassword: wifi_password,
                            passwordChanged: true,
                            ssidNameChanged: true,
                            ssidId: ssidIndicesToUpdate[0] || ssid_index || "1"
                        },
                        changedBy: userContext.username || userContext.name || "System",
                        changeSource: "web_technician",
                        actorRole: (userContext.role || "").toLowerCase() === "teknisi" ? "teknisi" : "admin",
                        actorIdentifier: userContext.username || userContext.name || null,
                        actorPhone: null,
                        customerName: updatedRecord.name,
                        customerPhone: updatedRecord.phone_number,
                        reason: "PSB Setup - Konfigurasi WiFi awal pelanggan",
                        notes: `PSB Phase 3 setup. Paket: ${subscription}`,
                        ipAddress: requestMeta.ipAddress,
                        userAgent: requestMeta.userAgent
                    });
                } catch (wifiLogErr) {
                    deps.logger.error?.("[PSB_PHASE3] WiFi log error:", wifiLogErr);
                }

                try {
                    await deps.sendPSBPhase2Notification?.({
                        ...updatedRecord,
                        subscription
                    }, {
                        pppoe_username,
                        pppoe_password: finalPPPoEPassword,
                        wifi_ssid,
                        wifi_password
                    });
                } catch (notifErr) {
                    deps.logger.error?.("[PSB_PHASE3] Notification error:", notifErr);
                }

                // Transport tetap 200 (frontend butuh ini untuk menampilkan kredensial), tapi
                // pesan + flag warning mencerminkan kegagalan parsial GenieACS agar device tidak
                // terlanjur dianggap "beres" saat modem belum dikonfigurasi.
                const genieacsOk = transaction.deviceUpdated === true;
                return {
                    status: 200,
                    body: {
                        status: 200,
                        message: genieacsOk
                            ? "PSB Phase 3 (Setup Awal Pelanggan) berhasil diselesaikan"
                            : "PSB Phase 3 selesai SEBAGIAN: PPPoE & data pelanggan dibuat, TAPI konfigurasi modem (GenieACS) GAGAL dikirim. Silakan konfigurasi WiFi/PPPoE di modem secara manual.",
                        warning: genieacsOk ? null : "genieacs_update_failed",
                        genieacsError: genieacsOk ? null : genieacsError,
                        data: {
                            psbCustomerId: customerId,
                            finalUserId: newUserId,
                            name: updatedRecord.name,
                            pppoe_username,
                            pppoe_password: finalPPPoEPassword,
                            wifi_ssid,
                            wifi_password,
                            device_id,
                            mikrotikRegistered: transaction.pppoeCreated,
                            genieacsUpdated: transaction.deviceUpdated
                        }
                    }
                };
            } catch (error) {
                if (transaction.pppoeCreated) {
                    deps.logger.warn?.("[PSB_PHASE3_ROLLBACK] PPPoE user created but process failed:", error.message);
                }
                return {
                    status: 500,
                    body: {
                        status: 500,
                        message: "Gagal menyelesaikan PSB Phase 3",
                        error: error.message
                    }
                };
            }
        },

        async updatePsbStatus({ customerId, status, userContext = {}, requestMeta = {} } = {}) {
            if (!customerId || !status) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: "Customer ID dan status harus diisi"
                    }
                };
            }

            try {
                return await deps.withLock(`psb-update-status-${customerId}`, async () => {
                    const allowedStatuses = ["teknisi_meluncur", "phase1_completed", "phase2_completed"];
                    if (!allowedStatuses.includes(status)) {
                        return {
                            status: 400,
                            body: {
                                status: 400,
                                message: `Status tidak valid. Status yang diizinkan: ${allowedStatuses.join(", ")}`
                            }
                        };
                    }

                    const psbRecords = deps.repository.getPsbRecordsSnapshot();
                    const psbRecordIndex = psbRecords.findIndex((record) => String(record.id) === String(customerId));
                    if (psbRecordIndex === -1) {
                        return {
                            status: 404,
                            body: {
                                status: 404,
                                message: "Customer tidak ditemukan di database PSB"
                            }
                        };
                    }

                    const currentRecord = psbRecords[psbRecordIndex];
                    const oldStatus = currentRecord.psb_status;

                    if (status === "teknisi_meluncur" && currentRecord.psb_status !== "phase1_completed") {
                        return {
                            status: 400,
                            body: {
                                status: 400,
                                message: `Status tidak dapat diubah ke 'teknisi_meluncur'. Status saat ini harus 'phase1_completed'. Status saat ini: ${currentRecord.psb_status}`
                            }
                        };
                    }

                    await deps.updatePSBRecord(customerId, {
                        psb_status: status
                    });

                    const updatedRecord = {
                        ...currentRecord,
                        psb_status: status
                    };
                    deps.repository.updatePsbRecordsSnapshot((records) =>
                        records.map((record, index) => (index === psbRecordIndex ? updatedRecord : record))
                    );

                    if (status === "teknisi_meluncur") {
                        try {
                            await deps.sendPSBTeknisiMeluncurNotification?.(updatedRecord, {
                                name: userContext.name || userContext.username || "Teknisi",
                                phone_number: userContext.phone_number || null
                            });
                        } catch (notifErr) {
                            deps.logger.error?.("[PSB_UPDATE_STATUS] Notification error:", notifErr);
                        }
                    }

                    try {
                        await deps.logActivity?.({
                            userId: userContext.id,
                            username: userContext.username,
                            role: userContext.role,
                            actionType: "UPDATE",
                            resourceType: "psb",
                            resourceId: String(customerId),
                            resourceName: updatedRecord.name,
                            description: `PSB status updated to ${status} for ${updatedRecord.name}`,
                            oldValue: { psb_status: oldStatus },
                            newValue: { psb_status: status },
                            ipAddress: requestMeta.ipAddress,
                            userAgent: requestMeta.userAgent
                        });
                    } catch (logErr) {
                        deps.logger.error?.("[PSB_UPDATE_STATUS] Activity log error:", logErr);
                    }

                    return {
                        status: 200,
                        body: {
                            status: 200,
                            message: `Status berhasil diupdate menjadi '${status}'`,
                            data: {
                                customerId,
                                status
                            }
                        }
                    };
                });
            } catch (error) {
                return {
                    status: 500,
                    body: {
                        status: 500,
                        message: error.message === `Could not acquire lock for psb-update-status-${customerId}`
                            ? "Status sedang diproses. Silakan coba lagi."
                            : "Gagal update status",
                        error: error.message
                    }
                };
            }
        },

        async deleteAllPsbRecords({ password, userContext = {}, requestMeta = {} } = {}) {
            if (!password) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: "Password diperlukan untuk konfirmasi"
                    }
                };
            }

            const currentUser = deps.repository.getAccountsSnapshot().find((account) => account.username === userContext.username) || null;
            if (!currentUser) {
                return {
                    status: 401,
                    body: {
                        status: 401,
                        message: "User tidak ditemukan"
                    }
                };
            }

            const isPasswordValid = await deps.comparePassword?.(password, currentUser.password);
            if (!isPasswordValid) {
                return {
                    status: 401,
                    body: {
                        status: 401,
                        message: "Password salah"
                    }
                };
            }

            const recordCount = deps.repository.getPsbRecordsSnapshot().length;
            if (recordCount === 0) {
                return {
                    status: 200,
                    body: {
                        status: 200,
                        message: "Tidak ada data PSB untuk dihapus",
                        deletedCount: 0
                    }
                };
            }

            await deps.repository.deleteAllPsbRecords();
            deps.repository.setPsbRecordsSnapshot([]);

            try {
                await deps.logActivity?.({
                    userId: userContext.id,
                    username: userContext.username,
                    role: userContext.role,
                    actionType: "DELETE",
                    resourceType: "psb",
                    resourceId: "all",
                    resourceName: "All PSB Records",
                    description: `Deleted all ${recordCount} PSB records`,
                    oldValue: { count: recordCount },
                    newValue: { count: 0 },
                    ipAddress: requestMeta.ipAddress,
                    userAgent: requestMeta.userAgent
                });
            } catch (logErr) {
                deps.logger.error?.("[PSB_DELETE_ALL] Activity log error:", logErr);
            }

            deps.logger.log?.(`[PSB_DELETE_ALL] User ${userContext.username} deleted all ${recordCount} PSB records`);

            return {
                status: 200,
                body: {
                    status: 200,
                    message: `Berhasil menghapus ${recordCount} data PSB`,
                    deletedCount: recordCount
                }
            };
        },

        async activatePsbToUser() {
            throw new Error("apiPsbService.activatePsbToUser not implemented");
        },

        async listPsbRecordsByStatus({ status } = {}) {
            let customers = deps.repository.getPsbRecordsSnapshot();
            if (status) {
                customers = customers.filter((customer) => customer.psb_status === status);
            }

            return {
                status: 200,
                body: {
                    status: 200,
                    message: "Data customers berhasil diambil",
                    data: customers
                }
            };
        },

        async getPsbRecordDetail({ customerId } = {}) {
            const customer = deps.repository.getPsbRecordsSnapshot().find((record) => String(record.id) === String(customerId)) || null;
            if (!customer) {
                return {
                    status: 404,
                    body: {
                        status: 404,
                        message: "Customer tidak ditemukan di database PSB"
                    }
                };
            }

            return {
                status: 200,
                body: {
                    status: 200,
                    message: "Data customer berhasil diambil",
                    data: customer
                }
            };
        }
    };
}

module.exports = {
    createApiPsbService
};
