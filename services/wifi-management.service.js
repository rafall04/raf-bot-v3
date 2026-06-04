/**
 * Header Doc
 * Purpose: Menjadi owner orchestration domain WiFi untuk perubahan nama/sandi agar handler bot tinggal menjadi adapter channel.
 * Caller: `message/handlers/wifi-management-handler.js` dan caller WiFi legacy/state yang mempertahankan signature existing.
 * Deps: Adapter `lib/wifi.js`, resolver customer `lib/jid-utils`, repository `repositories/wifi.repository.js`, dan callback state/reply dari caller.
 * MainFuncs: `createWifiManagementService`, `handleGantiNamaWifi`, `handleGantiSandiWifi`, `handleSingleSSIDNameChange`, `handleBulkAutoNameChange`, `handleSingleSSIDPasswordChange`, `handleBulkAutoPasswordChange`, `logWifiNameChange`, `logWifiPasswordChange`.
 * SideEffects: Mengubah konfigurasi WiFi perangkat, menulis log perubahan WiFi, dan memperbarui state percakapan WiFi melalui callback caller.
 */
"use strict";

function createNotImplemented(name) {
    return async function notImplemented() {
        throw new Error(`${name} is not implemented yet`);
    };
}

function sanitizePhone(identifier = "") {
    return String(identifier || "")
        .replace("@s.whatsapp.net", "")
        .replace("@lid", "");
}

/**
 * Bangun actor object berdasarkan context bot WA.
 * - Kalau staff (owner/teknisi) trigger via `gantinamawifi 123 X` / `gantisandiwifi 123 X`
 *   → role staff dengan nama dari pushname dan nomor sender.
 * - Kalau customer self-service → role customer.
 *
 * Dipakai untuk audit trail di wifi_change_logs (lihat lib/wifi-logger.js).
 */
function buildWifiActor({ isOwner, isTeknisi, providedId, sender, pushname }) {
    const isStaffActing = (isOwner || isTeknisi) && providedId;
    if (!isStaffActing) {
        return { role: "customer", identifier: "customer", phone: sanitizePhone(sender), displayName: null };
    }
    const role = isOwner ? "owner" : "teknisi";
    const phone = sanitizePhone(sender);
    return {
        role,
        identifier: pushname || phone || role,
        phone,
        displayName: pushname || null
    };
}

function getStateKey(sender, stateSender) {
    return stateSender || sender;
}

function buildWifiLogSender(rawSender, stateSender) {
    return stateSender || rawSender;
}

function buildWifiStateSetter(setUserState, stateKey, payload) {
    setUserState(stateKey, payload);
}

function renderWithFallback(renderResponseTemplate, key, fallback, data = {}) {
    if (typeof renderResponseTemplate !== "function") {
        return fallback;
    }
    return renderResponseTemplate(key, fallback, data);
}

function replyWifiTemplate(reply, renderResponseTemplate, key, data = {}) {
    return reply(renderWithFallback(renderResponseTemplate, key, key, data));
}

function buildSsidInfoPrefix(currentSSIDs = "") {
    return currentSSIDs ? `SSID WiFi yang tersedia:\n${currentSSIDs}\n\n` : "";
}

function buildWifiNameLine(newName = "") {
    return newName ? `Anda ingin mengubah nama WiFi menjadi: "${newName}"\n\n` : "";
}

function buildWifiPasswordLine(newPassword = "") {
    return newPassword ? `Anda ingin mengubah kata sandi WiFi menjadi: \`${newPassword}\`\n\n` : "";
}

function buildDeviceMissingData({ pushname, user, isPrivileged }) {
    return {
        pushname,
        deviceContext: isPrivileged ? `untuk pelanggan "${user.name}"` : "Anda",
        nextAction: isPrivileged ? "Tidak bisa melanjutkan." : "Silakan hubungi Admin."
    };
}

function replyWifiPasswordPrompt(reply, renderResponseTemplate) {
    return reply(renderWithFallback(
        renderResponseTemplate,
        "convo_ganti_sandi_ask_password_single",
        "Silakan ketik kata sandi WiFi baru yang Anda inginkan.\n\nMinimal 8 karakter.\n\nKetik *batal* jika ingin membatalkan proses ini."
    ));
}

function replyWifiBulkPasswordPrompt(reply, renderResponseTemplate) {
    return reply(renderWithFallback(
        renderResponseTemplate,
        "convo_ganti_sandi_ask_password_bulk",
        "Silakan ketik kata sandi WiFi baru yang Anda inginkan untuk SEMUA SSID.\n\nMinimal 8 karakter.\n\nKetik *batal* jika ingin membatalkan proses ini."
    ));
}

function replyWifiPasswordConfirm(reply, renderResponseTemplate, newPassword, ssidId) {
    return reply(renderWithFallback(
        renderResponseTemplate,
        "convo_ganti_sandi_confirm",
        `Anda yakin ingin mengubah kata sandi WiFi${ssidId ? ` SSID ${ssidId}` : ""} menjadi: \`${newPassword}\` ?\n\nBalas *'ya'* untuk melanjutkan, atau *'batal'* untuk membatalkan.`,
        {
            sandi_wifi_baru: newPassword,
            ssid_id: ssidId || ""
        }
    ));
}

function replyWifiPasswordSuccess(reply, renderResponseTemplate, newPassword, ssidInfo = "") {
    return reply(renderWithFallback(
        renderResponseTemplate,
        "convo_ganti_sandi_success",
        `Berhasil. Kata sandi WiFi ${ssidInfo}telah diubah menjadi: \`${newPassword}\`.`,
        {
            sandi_wifi_baru: newPassword,
            ssidInfo
        }
    ));
}

function replyWifiPasswordFailed(reply, renderResponseTemplate, error) {
    return reply(renderWithFallback(
        renderResponseTemplate,
        "convo_ganti_sandi_failed",
        `Maaf, gagal mengubah kata sandi WiFi. Error: ${error.message}`,
        { error_message: error.message }
    ));
}

function buildCurrentSsidInfo(ssidEntries, bulkIds = []) {
    return bulkIds.map((bulkId, index) => {
        const matchedSSID = ssidEntries.find((entry) => String(entry.id) === String(bulkId));
        return `${index + 1}. SSID ${bulkId}: "${matchedSSID?.name || "Tidak diketahui"}"`;
    }).join("\n");
}

function defaultDeps() {
    const { createWifiRepository } = require("../repositories/wifi.repository");
    return {
        resolveTargetUser: async ({ sender, users, msg, raf, providedId }) => {
            const { resolveCustomerBySender } = require("../lib/jid-utils");
            if (providedId) {
                return {
                    user: users.find((entry) => entry.id == providedId) || null,
                    resolved: true
                };
            }
            return resolveCustomerBySender({ users, sender, msg, raf });
        },
        getSSIDInfo: require("../lib/wifi").getSSIDInfo,
        setSSIDName: require("../lib/wifi").setSSIDName,
        setPassword: require("../lib/wifi").setPassword,
        updateWifiSettings: require("../lib/wifi").updateWifiSettings,
        wifiRepository: createWifiRepository()
    };
}

function createWifiManagementService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    function handleFallbackNameChange({ stateKey, user, newName, reply, setUserState, renderResponseTemplate, actor = null }) {
        if (newName && newName.trim().length > 0) {
            if (newName.length > 32) {
                return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_name_too_long");
            }

            buildWifiStateSetter(setUserState, stateKey, {
                step: "SELECT_CHANGE_MODE",
                targetUser: user,
                nama_wifi_baru: newName,
                bulk_ssids: user.bulk,
                actor
            });

            return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_name_mode_prompt", {
                ssidInfo: "",
                newNameLine: buildWifiNameLine(newName)
            });
        }

        buildWifiStateSetter(setUserState, stateKey, {
            step: "SELECT_CHANGE_MODE_FIRST",
            targetUser: user,
            bulk_ssids: user.bulk,
            actor
        });

        return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_name_mode_prompt", {
            ssidInfo: "",
            newNameLine: ""
        });
    }

    function handleFallbackPasswordChange({ stateKey, user, newPassword, reply, setUserState, renderResponseTemplate, actor = null }) {
        if (newPassword && newPassword.trim().length > 0) {
            if (newPassword.length < 8) {
                return reply(renderWithFallback(renderResponseTemplate, "convo_ganti_sandi_too_short", "⚠️ Kata sandi terlalu pendek, minimal harus 8 karakter."));
            }

            buildWifiStateSetter(setUserState, stateKey, {
                step: "SELECT_CHANGE_PASSWORD_MODE",
                targetUser: user,
                sandi_wifi_baru: newPassword,
                bulk_ssids: user.bulk,
                actor
            });

            return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_password_mode_prompt", {
                ssidInfo: "",
                newPasswordLine: buildWifiPasswordLine(newPassword)
            });
        }

        buildWifiStateSetter(setUserState, stateKey, {
            step: "SELECT_CHANGE_PASSWORD_MODE_FIRST",
            targetUser: user,
            bulk_ssids: user.bulk,
            actor
        });

        return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_password_mode_prompt", {
            ssidInfo: "",
            newPasswordLine: ""
        });
    }

    async function logWifiNameChange(user, newName, sender, type, actor = null, oldName = null) {
        try {
            await deps.wifiRepository.saveWifiNameChange(user, newName, sender, type, actor, oldName);
        } catch (error) {
            console.error("[LOG_WIFI_NAME_CHANGE] Error:", error);
        }
    }

    async function logWifiPasswordChange(user, newPassword, sender, type, actor = null) {
        try {
            await deps.wifiRepository.saveWifiPasswordChange(user, newPassword, sender, type, actor);
        } catch (error) {
            console.error("[LOG_WIFI_PASSWORD_CHANGE] Error:", error);
        }
    }

    async function handleSingleSSIDNameChange({ stateKey, user, newName, reply, global, rawSender = null, setUserState, deleteUserState, renderResponseTemplate, actor = null }) {
        if (!newName || newName.trim().length === 0) {
            buildWifiStateSetter(setUserState, stateKey, {
                step: "ASK_NEW_NAME_FOR_SINGLE",
                targetUser: user,
                ssid_id: user.ssid_id || "1",
                actor
            });

            return reply(renderWithFallback(
                renderResponseTemplate,
                "convo_ganti_nama_tanya_nama_satu",
                "Tentu, mau diganti jadi apa nama WiFi nya? Silakan ketik nama yang baru."
            ));
        }

        if (newName.length > 32) {
            return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_name_too_long");
        }

        if (global?.config?.custom_wifi_modification) {
            buildWifiStateSetter(setUserState, stateKey, {
                step: "CONFIRM_GANTI_NAMA",
                targetUser: user,
                nama_wifi_baru: newName,
                ssid_id: user.ssid_id || "1",
                actor
            });

            return reply(renderWithFallback(
                renderResponseTemplate,
                "convo_ganti_nama_konfirmasi_satu",
                `Baik, saya konfirmasi ya. Nama WiFi akan diubah menjadi: "${newName}". Sudah benar?\n\nBalas *'ya'* untuk melanjutkan.`,
                { selectedSsidId: user.ssid_id || "1", nama_wifi_baru: newName }
            ));
        }

        try {
            const result = await deps.setSSIDName(user.device_id, user.ssid_id || "1", newName);
            if (!result.success) {
                throw new Error(result.message);
            }
            await logWifiNameChange(user, newName, buildWifiLogSender(rawSender, stateKey), "single", actor);
            deleteUserState(stateKey);
            return reply(`✅ *Berhasil!*\n\nNama WiFi telah diubah menjadi: *"${newName}"*\n\n📝 *Info Penting:*\n• Perubahan akan aktif dalam 1-2 menit\n• Modem akan restart otomatis\n• Anda mungkin perlu menyambung ulang perangkat Anda\n\n💡 Jika ada masalah, hubungi admin untuk bantuan.`);
        } catch (error) {
            console.error("[SINGLE_NAME_CHANGE] Error:", error);
            deleteUserState(stateKey);
            return reply(`❌ Maaf, gagal mengubah nama WiFi. Silakan coba lagi atau hubungi admin.\n\nError: ${error.message}`);
        }
    }

    async function handleBulkAutoNameChange({ stateKey, user, newName, reply, rawSender = null, setUserState, deleteUserState, renderResponseTemplate, actor = null }) {
        if (!newName || newName.trim().length === 0) {
            buildWifiStateSetter(setUserState, stateKey, {
                step: "ASK_NEW_NAME_FOR_BULK_AUTO",
                targetUser: user,
                bulk_ssids: user.bulk,
                actor
            });
            return reply(renderWithFallback(
                renderResponseTemplate,
                "convo_ganti_nama_tanya_nama_semua",
                "Silakan ketik nama WiFi baru yang Anda inginkan untuk semua SSID."
            ));
        }

        if (newName.length > 32) {
            return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_name_too_long");
        }

        try {
            const bulkPayload = {};
            user.bulk.forEach((ssidId) => {
                bulkPayload[`ssid_${ssidId}`] = newName;
            });
            const response = await deps.updateWifiSettings(user.device_id, bulkPayload, { verifyApplied: true });
            if (!response.ok) {
                throw new Error(response.message);
            }

            await logWifiNameChange(user, newName, buildWifiLogSender(rawSender, stateKey), "bulk_auto", actor);
            deleteUserState(stateKey);
            return reply(`✅ *Berhasil!*\n\nNama WiFi untuk *semua SSID* telah diubah menjadi: *"${newName}"*\n\n📝 *Catatan:*\n• Perubahan akan aktif dalam 1-2 menit\n• Modem akan restart otomatis\n• Anda mungkin perlu menyambung ulang perangkat Anda`);
        } catch (error) {
            console.error("[BULK_AUTO_NAME_CHANGE] Error:", error);
            deleteUserState(stateKey);
            return reply(`❌ Maaf, gagal mengubah nama WiFi. Silakan coba lagi atau hubungi admin.\n\nError: ${error.message}`);
        }
    }

    async function handleSingleSSIDPasswordChange({ stateKey, user, newPassword, reply, global, rawSender = null, setUserState, deleteUserState, renderResponseTemplate, actor = null }) {
        if (!newPassword || newPassword.trim().length === 0) {
            buildWifiStateSetter(setUserState, stateKey, {
                step: "ASK_NEW_PASSWORD",
                targetUser: user,
                ssid_id: user.ssid_id || "1",
                actor
            });
            return replyWifiPasswordPrompt(reply, renderResponseTemplate);
        }

        if (newPassword.length < 8) {
            return reply(renderWithFallback(renderResponseTemplate, "convo_ganti_sandi_too_short", "⚠️ Kata sandi terlalu pendek, minimal harus 8 karakter."));
        }

        if (global?.config?.custom_wifi_modification) {
            buildWifiStateSetter(setUserState, stateKey, {
                step: "CONFIRM_GANTI_SANDI",
                targetUser: user,
                sandi_wifi_baru: newPassword,
                ssid_id: user.ssid_id || "1",
                actor
            });
            return replyWifiPasswordConfirm(reply, renderResponseTemplate, newPassword, user.ssid_id || "1");
        }

        try {
            const result = await deps.setPassword(user.device_id, user.ssid_id || "1", newPassword);
            if (!result.success) {
                throw new Error(result.message);
            }
            await logWifiPasswordChange(user, newPassword, buildWifiLogSender(rawSender, stateKey), "single", actor);
            deleteUserState(stateKey);
            return replyWifiPasswordSuccess(reply, renderResponseTemplate, newPassword);
        } catch (error) {
            console.error("[SINGLE_PASSWORD_CHANGE] Error:", error);
            deleteUserState(stateKey);
            return replyWifiPasswordFailed(reply, renderResponseTemplate, error);
        }
    }

    async function handleBulkAutoPasswordChange({ stateKey, user, newPassword, reply, rawSender = null, setUserState, deleteUserState, renderResponseTemplate, actor = null }) {
        if (!newPassword || newPassword.trim().length === 0) {
            buildWifiStateSetter(setUserState, stateKey, {
                step: "ASK_NEW_PASSWORD_BULK_AUTO",
                targetUser: user,
                bulk_ssids: user.bulk,
                actor
            });
            return replyWifiBulkPasswordPrompt(reply, renderResponseTemplate);
        }

        if (newPassword.length < 8) {
            return reply(renderWithFallback(renderResponseTemplate, "convo_ganti_sandi_too_short", "⚠️ Kata sandi terlalu pendek, minimal harus 8 karakter."));
        }

        try {
            const bulkPayload = {};
            user.bulk.forEach((ssidId) => {
                bulkPayload[`ssid_password_${ssidId}`] = newPassword;
            });
            const response = await deps.updateWifiSettings(user.device_id, bulkPayload, { verifyApplied: true });
            if (!response.ok) {
                throw new Error(response.message);
            }

            await logWifiPasswordChange(user, newPassword, buildWifiLogSender(rawSender, stateKey), "bulk_auto", actor);
            deleteUserState(stateKey);
            return replyWifiPasswordSuccess(reply, renderResponseTemplate, newPassword, "untuk *semua SSID* ");
        } catch (error) {
            console.error("[BULK_AUTO_PASSWORD_CHANGE] Error:", error);
            deleteUserState(stateKey);
            return replyWifiPasswordFailed(reply, renderResponseTemplate, error);
        }
    }

    async function handleGantiNamaWifi(context) {
        const {
            sender,
            stateSender,
            args,
            matchedKeywordLength,
            isOwner,
            isTeknisi,
            pushname,
            users,
            reply,
            global,
            mess,
            msg,
            raf,
            setUserState,
            deleteUserState,
            renderResponseTemplate
        } = context;

        try {
            let newName;
            let providedId = null;
            const keywordLength = matchedKeywordLength || 1;
            const stateKey = getStateKey(sender, stateSender);

            if ((isOwner || isTeknisi) && args.length > keywordLength + 1 && !Number.isNaN(parseInt(args[keywordLength], 10))) {
                providedId = args[keywordLength];
                newName = args.slice(keywordLength + 1).join(" ").trim();
            } else {
                newName = args.length > keywordLength ? args.slice(keywordLength).join(" ").trim() : "";
            }

            // Actor untuk audit trail — siapa yang sebenarnya trigger perubahan via WA.
            const actor = buildWifiActor({ isOwner, isTeknisi, providedId, sender, pushname });

            const resolved = await deps.resolveTargetUser({ sender, users, msg, raf, providedId });
            const user = resolved.user;

            if (!user) {
                if (isOwner || isTeknisi) {
                    if (providedId) {
                        return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_customer_not_found", { pushname, providedId });
                    }
                    return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_usage_name");
                }

                if (sender.endsWith("@lid")) {
                    return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_user_not_registered");
                }

                return reply(mess.userNotRegister);
            }

            if (user.subscription === "PAKET-VOUCHER" && !(isOwner || isTeknisi)) {
                return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_monthly_only_name", { pushname });
            }

            if (!user.device_id) {
                return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_device_missing", buildDeviceMissingData({ pushname, user, isPrivileged: isOwner || isTeknisi }));
            }

            await replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_checking_info");

            const useBulk = global.config.custom_wifi_modification && user.bulk && user.bulk.length > 0;
            const hasMultipleSSIDs = user.bulk && user.bulk.length > 0;

            if (useBulk) {
                try {
                    const { ssid } = await deps.getSSIDInfo(user.device_id);
                    const currentSSIDs = buildCurrentSsidInfo(ssid, user.bulk);

                    if (newName && newName.trim().length > 0) {
                        if (newName.length > 32) {
                            return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_name_too_long");
                        }

                        buildWifiStateSetter(setUserState, stateKey, {
                            step: "SELECT_CHANGE_MODE",
                            targetUser: user,
                            nama_wifi_baru: newName,
                            bulk_ssids: user.bulk,
                            ssid_info: currentSSIDs,
                            actor
                        });

                        return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_name_mode_prompt", {
                            ssidInfo: buildSsidInfoPrefix(currentSSIDs),
                            newNameLine: buildWifiNameLine(newName)
                        });
                    }

                    buildWifiStateSetter(setUserState, stateKey, {
                        step: "SELECT_CHANGE_MODE_FIRST",
                        targetUser: user,
                        bulk_ssids: user.bulk,
                        ssid_info: currentSSIDs,
                        actor
                    });

                    return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_name_mode_prompt", {
                        ssidInfo: buildSsidInfoPrefix(currentSSIDs),
                        newNameLine: ""
                    });
                } catch (error) {
                    console.error("[GANTI_NAMA_WIFI] Error getting current SSID:", error);
                    return handleFallbackNameChange({ stateKey, user, newName, reply, setUserState, deleteUserState, renderResponseTemplate, actor });
                }
            }

            if (hasMultipleSSIDs && !global.config.custom_wifi_modification) {
                return handleBulkAutoNameChange({ stateKey, user, newName, reply, global, rawSender: sender, setUserState, deleteUserState, renderResponseTemplate, actor });
            }

            return handleSingleSSIDNameChange({ stateKey, user, newName, reply, global, rawSender: sender, setUserState, deleteUserState, renderResponseTemplate, actor });
        } catch (error) {
            console.error("[GANTI_NAMA_WIFI_ERROR]", error);
            return replyWifiTemplate(context.reply, renderResponseTemplate, "wifi_management_info_check_failed");
        }
    }

    async function handleBulkPasswordChange({ stateKey, user, newPassword, reply, setUserState, renderResponseTemplate, actor = null }) {
        return deps.getSSIDInfo(user.device_id).then(({ ssid }) => {
            const currentSSIDs = buildCurrentSsidInfo(ssid, user.bulk);

            if (newPassword && newPassword.trim().length > 0) {
                if (newPassword.length < 8) {
                    return reply(renderWithFallback(renderResponseTemplate, "convo_ganti_sandi_too_short", "⚠️ Kata sandi terlalu pendek, minimal harus 8 karakter."));
                }

                buildWifiStateSetter(setUserState, stateKey, {
                    step: "SELECT_CHANGE_PASSWORD_MODE",
                    targetUser: user,
                    sandi_wifi_baru: newPassword,
                    bulk_ssids: user.bulk,
                    ssid_info: currentSSIDs,
                    actor
                });

                return reply(`SSID WiFi yang tersedia:\n${currentSSIDs}\n\nAnda ingin mengubah kata sandi WiFi menjadi: \`${newPassword}\`\n\nPilih mode perubahan:\n1️⃣ Ubah satu SSID saja\n2️⃣ Ubah semua SSID sekaligus\n\nBalas dengan angka pilihan Anda.`);
            }

            buildWifiStateSetter(setUserState, stateKey, {
                step: "SELECT_CHANGE_PASSWORD_MODE_FIRST",
                targetUser: user,
                bulk_ssids: user.bulk,
                ssid_info: currentSSIDs,
                actor
            });

            return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_password_mode_prompt", {
                ssidInfo: buildSsidInfoPrefix(currentSSIDs),
                newPasswordLine: ""
            });
        }).catch((error) => {
            console.error("[GANTI_SANDI_WIFI] Error getting current SSID:", error);
            return handleFallbackPasswordChange({ stateKey, user, newPassword, reply, setUserState, renderResponseTemplate, actor });
        });
    }

    async function handleGantiSandiWifi(context) {
        const {
            sender,
            stateSender,
            args,
            matchedKeywordLength,
            isOwner,
            isTeknisi,
            pushname,
            users,
            reply,
            global,
            mess,
            msg,
            raf,
            setUserState,
            deleteUserState,
            renderResponseTemplate
        } = context;

        try {
            let newPassword;
            let providedId = null;
            const keywordLength = matchedKeywordLength || 1;
            const stateKey = getStateKey(sender, stateSender);

            if ((isOwner || isTeknisi) && args.length > keywordLength + 1 && !Number.isNaN(parseInt(args[keywordLength], 10))) {
                providedId = args[keywordLength];
                newPassword = args.slice(keywordLength + 1).join(" ").trim();
            } else {
                newPassword = args.length > keywordLength ? args.slice(keywordLength).join(" ").trim() : "";
            }

            // Actor untuk audit trail (lihat handleGantiNamaWifi untuk pola yang sama).
            const actor = buildWifiActor({ isOwner, isTeknisi, providedId, sender, pushname });

            const resolved = await deps.resolveTargetUser({ sender, users, msg, raf, providedId });
            const user = resolved.user;

            if (!user) {
                if (isOwner || isTeknisi) {
                    if (providedId) {
                        return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_customer_not_found", { pushname, providedId });
                    }
                    return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_usage_password");
                }

                if (sender.endsWith("@lid")) {
                    return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_user_not_registered");
                }

                return reply(mess.userNotRegister);
            }

            if (user.subscription === "PAKET-VOUCHER" && !(isOwner || isTeknisi)) {
                return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_monthly_only_password", { pushname });
            }

            if (!user.device_id) {
                return replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_device_missing", buildDeviceMissingData({ pushname, user, isPrivileged: isOwner || isTeknisi }));
            }

            await replyWifiTemplate(reply, renderResponseTemplate, "wifi_management_checking_info");

            const useBulk = global.config.custom_wifi_modification && user.bulk && user.bulk.length > 0;
            const hasMultipleSSIDs = user.bulk && user.bulk.length > 0;

            if (useBulk) {
                return handleBulkPasswordChange({ stateKey, user, newPassword, reply, setUserState, renderResponseTemplate, actor });
            }

            if (hasMultipleSSIDs && !global.config.custom_wifi_modification) {
                return handleBulkAutoPasswordChange({ stateKey, user, newPassword, reply, global, rawSender: sender, setUserState, deleteUserState, renderResponseTemplate, actor });
            }

            return handleSingleSSIDPasswordChange({ stateKey, user, newPassword, reply, global, rawSender: sender, setUserState, deleteUserState, renderResponseTemplate, actor });
        } catch (error) {
            console.error("[GANTI_SANDI_WIFI_ERROR]", error);
            return replyWifiTemplate(context.reply, renderResponseTemplate, "wifi_management_info_check_failed");
        }
    }

    return {
        deps,
        handleGantiNamaWifi,
        handleGantiSandiWifi,
        handleSingleSSIDNameChange,
        handleBulkAutoNameChange,
        handleSingleSSIDPasswordChange,
        handleBulkAutoPasswordChange,
        logWifiNameChange,
        logWifiPasswordChange
    };
}

module.exports = {
    createWifiManagementService,
    defaultDeps
};
