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

    // ODP: tolak ID yang TIDAK TERDAFTAR (typo yang diterima diam-diam = akar data sampah — dulu
    // `connected_odp_id` tak pernah divalidasi sama sekali) dan ODP yang sudah PENUH (kapasitas ODP
    // dulu hanya ditegakkan untuk relasi ODC→ODP, tak pernah untuk PELANGGAN → ODP 8 port bisa diisi
    // tak terbatas, padahal "muat berapa lagi" justru alasan utama mencatat ODP).
    // Kosong = SAH (pelanggan memang belum dipetakan). Semua jalur tulis (web, #PSB, import Excel)
    // bermuara ke sini, jadi satu penjaga cukup.
    const odpToAssign = userData.connected_odp_id || userData.odp_id;
    if (odpToAssign) {
        const assertOdpAssignable = deps.assertOdpAssignable
            || require("../../lib/network-assets-service").assertOdpAssignable;
        try {
            assertOdpAssignable(odpToAssign, {});
        } catch (err) {
            return {
                errorResponse: {
                    status: 400,
                    body: { status: 400, message: err.message }
                }
            };
        }
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
        // #b327: sebelum jatuh ke default SSID tunggal, pakai `ssid_indices` (kapabilitas band yang
        // terdeteksi) bila ada. Modem DUAL-BAND yang firstRead-nya SUKSES dikirim ssid_indices=["1","5"]
        // tapi TANPA `bulk` → dulu default ["1"] → ganti nama/sandi WiFi cuma menyentuh 2.4GHz; 5GHz
        // warisi WiFi pemilik lama (kasus modem bekas). Sejalankan bulk dgn band yang benar-benar di-push.
        if (Array.isArray(userData.ssid_indices) && userData.ssid_indices.length > 0) {
            bulkData = userData.ssid_indices.map(String);
        } else {
            const defaultSSID = (deps.getConfig() && deps.getConfig().defaultBulkSSID)
                ? String(deps.getConfig().defaultBulkSSID)
                : "1";
            bulkData = [defaultSSID];
        }
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
        // billing_cycle: 'awal_bulan' (default) | 'akhir_bulan' (bayar & isolir menjelang akhir bulan).
        billing_cycle: String(userData.billing_cycle || "").trim().toLowerCase() === "akhir_bulan" ? "akhir_bulan" : "awal_bulan",
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
