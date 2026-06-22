/**
 * Header Doc
 * Purpose: Phase 1+2 dari workflow create user — validate input, generate ID/username/password, prepare `newUser` object, plus determine registration mode flags (`addToMikrotik`/`skipMikrotik`/`syncEnabled`/`paymentMethod`). Return `{ errorResponse }` jika ada validation error, atau `{ prepared: { newUser, plainTextPassword, finalUsername, paymentMethod, registrationMode, addToMikrotik, skipMikrotik, syncEnabled, paymentMethodInputPresent } }` jika OK.
 * Caller: `services/api-users/create-user.js` (orchestrator).
 * Deps: `deps.getNextAvailableUserId`, `deps.validatePhoneNumbers`, `deps.getDb`, `deps.repository.getUsersSnapshot`, `deps.hashPassword`, `deps.normalizeUserPaymentMethod`, `deps.isMikrotikSyncEnabled`, `deps.buildMikrotikSyncResult`, `deps.getConfig`, lazy-require `../../lib/psb-helper` (generateRandomPassword).
 * MainFuncs: `prepareNewUser(deps, { userData })`.
 * SideEffects: hashing password (await), DB validation read (read-only). Tidak menulis ke DB di phase ini.
 */
"use strict";

async function prepareNewUser(deps, { userData }) {
    let newUserId;
    try {
        newUserId = await deps.getNextAvailableUserId();
    } catch (err) {
        return {
            errorResponse: {
                status: 500,
                body: {
                    status: 500,
                    message: "Gagal mendapatkan ID untuk user baru",
                    error: err.message
                }
            }
        };
    }

    const phoneToValidate = userData.phone_number || userData.phone;
    if (phoneToValidate && phoneToValidate.trim() !== "") {
        const defaultCountry = userData.country || "ID";
        const validationResult = await deps.validatePhoneNumbers(deps.getDb(), phoneToValidate, null, defaultCountry);

        if (!validationResult.valid) {
            return {
                errorResponse: {
                    status: 400,
                    body: {
                        status: 400,
                        message: validationResult.message,
                        conflictUser: validationResult.conflictUser || null
                    }
                }
            };
        }
    }

    const idExists = deps.repository.getUsersSnapshot().some((user) => parseInt(user.id, 10) === parseInt(newUserId, 10));
    if (idExists) {
        return {
            errorResponse: {
                status: 500,
                body: {
                    status: 500,
                    message: "Terjadi kesalahan dalam pembuatan ID. Silakan coba lagi.",
                    error: "ID conflict detected"
                }
            }
        };
    }

    let finalUsername = userData.username;
    let finalPassword = userData.password;
    let plainTextPassword = "";

    if (!finalUsername || finalUsername.trim() === "") {
        const nameParts = (userData.name || "").toLowerCase().split(" ").filter(Boolean);
        const baseUsernameRoot = nameParts[0] || "user";
        let baseUsername = baseUsernameRoot;
        if (nameParts.length > 1) {
            baseUsername += nameParts[1].charAt(0);
        }
        let counter = 1;
        finalUsername = baseUsername;
        while (deps.repository.getUsersSnapshot().some((user) => user.username === finalUsername && String(user.id) !== String(newUserId))) {
            counter += 1;
            finalUsername = `${baseUsername}${counter}`;
        }
    }

    if (!finalPassword || finalPassword.trim() === "") {
        const { generateRandomPassword } = require("../../lib/psb-helper");
        plainTextPassword = generateRandomPassword();
        finalPassword = await deps.hashPassword(plainTextPassword);
    } else {
        plainTextPassword = finalPassword;
        finalPassword = await deps.hashPassword(finalPassword);
    }

    let bulkData = userData.bulk;
    if (!bulkData || !Array.isArray(bulkData) || bulkData.length === 0) {
        const defaultSSID = (deps.getConfig() && deps.getConfig().defaultBulkSSID)
            ? String(deps.getConfig().defaultBulkSSID)
            : "1";
        bulkData = [defaultSSID];
    }

    const newUser = {
        id: newUserId,
        ...userData,
        phone_number: userData.phone_number || userData.phone,
        subscription: userData.subscription || userData.package,
        connected_odp_id: userData.connected_odp_id || userData.odp_id,
        paid: userData.paid || false,
        send_invoice: userData.send_invoice || false,
        is_corporate: userData.is_corporate || false,
        notify_outage: userData.notify_outage === false ? false : true,
        // account_type: 'pelanggan' (default) | 'infrastruktur' (mis. modem CCTV/monitoring).
        account_type: String(userData.account_type || "").trim().toLowerCase() === "infrastruktur" ? "infrastruktur" : "pelanggan",
        bulk: bulkData,
        username: finalUsername,
        password: finalPassword,
        created_at: new Date().toISOString()
    };

    const addToMikrotik = userData.add_to_mikrotik === true || userData.add_to_mikrotik === "true";
    const registrationMode = userData.registration_mode || "legacy";
    const skipMikrotik = userData.skip_mikrotik === true || userData.skip_mikrotik === "true";
    const syncEnabled = deps.isMikrotikSyncEnabled(deps.getConfig());
    const paymentMethodInputPresent = userData.payment_method !== undefined
        && userData.payment_method !== null
        && String(userData.payment_method).trim() !== "";
    const paymentMethod = deps.normalizeUserPaymentMethod(userData.payment_method);

    if (paymentMethodInputPresent && !paymentMethod) {
        return {
            errorResponse: {
                status: 400,
                body: {
                    status: 400,
                    message: "payment_method wajib CASH atau TRANSFER_BANK"
                }
            }
        };
    }

    if (newUser.paid === true && !paymentMethod) {
        return {
            errorResponse: {
                status: 400,
                body: {
                    status: 400,
                    message: "Metode pembayaran wajib dipilih saat membuat pelanggan dengan status sudah membayar."
                }
            }
        };
    }

    return {
        prepared: {
            newUser,
            plainTextPassword,
            finalUsername,
            paymentMethod,
            registrationMode,
            addToMikrotik,
            skipMikrotik,
            syncEnabled,
            paymentMethodInputPresent
        }
    };
}

module.exports = {
    prepareNewUser
};
