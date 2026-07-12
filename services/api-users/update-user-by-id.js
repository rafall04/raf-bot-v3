/**
 * Header Doc
 * Purpose: Method `updateUserById` — update existing user dari admin panel. Mengeksekusi: lookup user → validate immutable fields (pppoe_username/pppoe_password tidak boleh diubah dari sini) → validate phone (warning jika duplicate) → merge userData ke draftUser → cek subscription change (sync mikrotik profile) → cek paid status change (apply via finance boundary) → DB update + snapshot replace → activity log. Return response dengan sync metadata.
 * Caller: `services/api-users.service.js` (composer wraps menjadi method `service.updateUserById(args)`); juga dipanggil oleh `create-user.js` orchestrator saat `userData.id` present (delegate path).
 * Deps: `deps.repository.findUserById`/`updateUserRecord`/`getUsersSnapshot`/`replaceUsersSnapshot`, `deps.normalizeUserPaymentMethod`, `deps.validatePhoneNumbers`, `deps.getDb`, `deps.isMikrotikSyncEnabled`, `deps.buildMikrotikSyncResult`, `deps.getProfileBySubscription`, `deps.assertMikrotikResult`, `deps.updatePPPoEProfile`, `deps.deleteActivePPPoEUser` (putus sesi setelah ganti profil), `deps.applyPaymentStatusChange`, `deps.handlePaidStatusChange`, `deps.getPeriodParts`, `deps.getEffectivePrice`, `deps.logActivity`, `deps.logger`.
 * MainFuncs: `updateUserById(deps, { id, userData, actor, requestMeta })`.
 * SideEffects: Validate → MikroTik profile change (if subscription changed) → finance boundary call (if paid changed) → DB update via repository.updateUserRecord → snapshot replace → activity log (best-effort).
 */
"use strict";

async function updateUserById(deps, { id, userData, actor, requestMeta }) {
    const userToUpdate = deps.repository.findUserById(id);
    if (!userToUpdate) {
        return {
            status: 404,
            body: {
                status: 404,
                message: "Pengguna tidak ditemukan."
            }
        };
    }

    // Koersi ke boolean: findUserById mengembalikan `paid` MENTAH dari runtime (integer 0/1),
    // sedangkan draftUser.paid dikoersi ke boolean di bawah. Tanpa koersi, `0 !== false` / `1 !== true`
    // membuat `paidStatusChanged` SELALU true → memicu finance boundary di SETIAP update meski status
    // bayar tak berubah (akar 409 "no_paid_position"/"already_fully_paid"). Selaras update-user-payment-status.js.
    const oldPaidStatus = userToUpdate.paid === true || userToUpdate.paid === 1 || userToUpdate.paid === "1";
    const paymentMethodInputPresent = userData.payment_method !== undefined
        && userData.payment_method !== null
        && String(userData.payment_method).trim() !== "";
    const paymentMethod = deps.normalizeUserPaymentMethod(userData.payment_method);
    const oldUserData = {
        name: userToUpdate.name,
        phone_number: userToUpdate.phone_number,
        subscription: userToUpdate.subscription,
        paid: oldPaidStatus,
        pppoe_username: userToUpdate.pppoe_username
    };
    const draftUser = {
        ...userToUpdate,
        updated_at: new Date().toISOString()
    };

    // Kredensial PPPoE bersifat immutable dari endpoint ini — halaman edit user hanya MENAMPILKAN
    // (field readonly), tetapi FormData tetap mengirim ulang nilai display-nya. Bandingkan secara
    // ternormalisasi: null/undefined/"" dianggap setara & angka di-string-kan, jadi guard hanya
    // menolak PERUBAHAN nyata — bukan round-trip kosong. Tanpa ini, pelanggan tanpa pppoe_password
    // (tersimpan null, dikirim "") ikut terblokir 400 saat sekadar menambah No HP / edit lain.
    const normalizePppoeField = (value) => (value === undefined || value === null ? "" : String(value));

    if (Object.prototype.hasOwnProperty.call(userData, "pppoe_username")
        && normalizePppoeField(userData.pppoe_username) !== normalizePppoeField(userToUpdate.pppoe_username)) {
        return {
            status: 400,
            body: {
                status: 400,
                message: "PPPoE username tidak dapat diubah dari halaman user. Gunakan flow migrasi PPPoE khusus."
            }
        };
    }

    if (Object.prototype.hasOwnProperty.call(userData, "pppoe_password")
        && normalizePppoeField(userData.pppoe_password) !== normalizePppoeField(userToUpdate.pppoe_password)) {
        return {
            status: 400,
            body: {
                status: 400,
                message: "PPPoE password tidak dapat diubah langsung dari halaman user."
            }
        };
    }

    const phoneToValidate = userData.phone_number || userData.phone;
    if (phoneToValidate && phoneToValidate.trim() !== "") {
        const defaultCountry = userData.country || userToUpdate.country || "ID";
        const validationResult = await deps.validatePhoneNumbers(deps.getDb(), phoneToValidate, id, defaultCountry);

        if (!validationResult.valid) {
            if (!validationResult.message.includes("already registered")) {
                return {
                    status: 400,
                    body: {
                        status: 400,
                        message: validationResult.message,
                        conflictUser: validationResult.conflictUser || null
                    }
                };
            }

            deps.logger.warn?.(`[USER_UPDATE] Phone duplicate warning for user ${id}: ${validationResult.message}`);
        }
    }

    Object.keys(userData).forEach((key) => {
        // pppoe_username/pppoe_password immutable dari sini — jangan biarkan nilai display
        // (readonly di halaman edit) menimpa kredensial tersimpan (mis. null → "").
        if (userData[key] === undefined || key === "id" || key === "payment_method"
            || key === "pppoe_username" || key === "pppoe_password") {
            return;
        }

        if (key === "paid" || key === "send_invoice" || key === "is_corporate" || key === "notify_outage") {
            draftUser[key] = userData[key] === true || userData[key] === "true" || userData[key] === 1;
            return;
        }

        if (key === "phone_number" || key === "phone") {
            draftUser.phone_number = userData[key];
            return;
        }

        if (key === "package" || key === "subscription") {
            draftUser.subscription = userData[key];
            return;
        }

        if (key === "odp_id" || key === "connected_odp_id") {
            draftUser.connected_odp_id = userData[key];
            return;
        }

        if (key === "account_type") {
            // Normalisasi: hanya 'infrastruktur' yang diterima sebagai infra, selain itu 'pelanggan'.
            draftUser.account_type = String(userData[key] || "").trim().toLowerCase() === "infrastruktur"
                ? "infrastruktur"
                : "pelanggan";
            return;
        }

        draftUser[key] = userData[key];
    });

    // draftUser.paid bisa MASIH mentah (integer 0/1) bila FE tak mengirim field `paid` (tersalin dari
    // spread userToUpdate). Koersi ke boolean agar perbandingan paidStatusChanged type-safe di semua kasus.
    draftUser.paid = draftUser.paid === true || draftUser.paid === 1 || draftUser.paid === "1";

    const subscriptionChanged = oldUserData.subscription !== draftUser.subscription;
    const syncEnabled = deps.isMikrotikSyncEnabled();
    let mikrotikSync = deps.buildMikrotikSyncResult("applied", "Tidak ada sinkronisasi MikroTik yang diperlukan.");
    const paidStatusChanged = oldPaidStatus !== draftUser.paid;

    if (paymentMethodInputPresent && !paymentMethod) {
        return {
            status: 400,
            body: {
                status: 400,
                message: "payment_method wajib CASH atau TRANSFER_BANK"
            }
        };
    }

    if (oldPaidStatus === false && draftUser.paid === true && !paymentMethod) {
        return {
            status: 400,
            body: {
                status: 400,
                message: "Metode pembayaran wajib dipilih saat menandai pelanggan sebagai sudah membayar."
            }
        };
    }

    if (subscriptionChanged) {
        if (!syncEnabled) {
            mikrotikSync = deps.buildMikrotikSyncResult(
                "applied_locally_sync_disabled",
                "Sinkronisasi MikroTik dinonaktifkan. Perubahan hanya disimpan di aplikasi."
            );
        } else if (!draftUser.pppoe_username) {
            mikrotikSync = deps.buildMikrotikSyncResult(
                "skipped_no_pppoe",
                "Pelanggan tidak memiliki PPPoE username. Sinkronisasi MikroTik dilewati."
            );
        } else {
            const profile = deps.getProfileBySubscription(draftUser.subscription);
            if (!profile) {
                return {
                    status: 502,
                    body: {
                        status: 502,
                        message: `Profile MikroTik untuk paket "${draftUser.subscription}" tidak ditemukan.`,
                        sync_policy: "enabled",
                        sync_status: "failed_sync",
                        sync_message: `Profile MikroTik untuk paket "${draftUser.subscription}" tidak ditemukan.`,
                        mikrotik_sync: deps.buildMikrotikSyncResult("failed_sync", `Profile MikroTik untuk paket "${draftUser.subscription}" tidak ditemukan.`)
                    }
                };
            }

            try {
                deps.assertMikrotikResult(
                    await deps.updatePPPoEProfile(draftUser.pppoe_username, profile, { caller: "api.user-update" })
                );
                // Putuskan sesi PPPoE aktif agar profil/paket baru langsung berlaku (konsisten dengan alur change-package).
                // Best-effort: kegagalan disconnect hanya di-warn, tidak membatalkan perubahan profil yang sudah sukses.
                if (deps.deleteActivePPPoEUser) {
                    try {
                        const disconnectResult = await deps.deleteActivePPPoEUser(draftUser.pppoe_username, { caller: "api.user-update" });
                        if (disconnectResult && disconnectResult.ok !== true) {
                            deps.logger.warn?.(`[USER_UPDATE_WARN] Gagal memutus sesi PPPoE ${draftUser.pppoe_username}: ${disconnectResult.message}`);
                        }
                    } catch (disconnectError) {
                        deps.logger.warn?.(`[USER_UPDATE_WARN] Gagal memutus sesi PPPoE ${draftUser.pppoe_username}: ${disconnectError.message}`);
                    }
                }
                mikrotikSync = deps.buildMikrotikSyncResult("applied", `Profile MikroTik diubah ke ${profile}.`, { profile });
            } catch (pppoeErr) {
                deps.logger.error?.("[PPPOE_UPDATE_ERROR]", pppoeErr);
                return {
                    status: 502,
                    body: {
                        status: 502,
                        message: pppoeErr.message || "Sinkronisasi MikroTik gagal.",
                        sync_policy: "enabled",
                        sync_status: "failed_sync",
                        sync_message: pppoeErr.message || "Sinkronisasi MikroTik gagal.",
                        mikrotik_sync: deps.buildMikrotikSyncResult("failed_sync", pppoeErr.message || "Sinkronisasi MikroTik gagal.")
                    }
                };
            }
        }
    }

    if (paidStatusChanged) {
        const { periodMonth, periodYear } = deps.getPeriodParts({ date: new Date() });
        if (draftUser.paid === true) {
            const financeResult = await deps.applyPaymentStatusChange({
                user: userToUpdate,
                paid: true,
                periodMonth,
                periodYear,
                amountPaid: deps.getEffectivePrice(draftUser),
                amountDue: deps.getEffectivePrice(draftUser),
                isPartial: false,
                paymentMethod,
                notes: "Status pembayaran diperbarui",
                createdBy: actor.username,
                sourceAdminAction: `users-update:${id}:paid`,
                onFinalPaid: async () => {
                    await deps.handlePaidStatusChange(userToUpdate, {
                        paidDate: new Date().toISOString(),
                        method: paymentMethod,
                        approvedBy: actor.username,
                        notes: "Status pembayaran diperbarui"
                    });
                }
            });
            // no_change/already_fully_paid = idempoten (target "lunas" sudah tercapai) → BUKAN kegagalan.
            // Kegagalan nyata dari finance boundary di-throw (→500), jadi cabang ini hanya menyaring no-op.
            const paidApplied = financeResult.action === "paid"
                || (financeResult.action === "no_change" && financeResult.reason === "already_fully_paid");
            if (!paidApplied) {
                return {
                    status: 409,
                    body: {
                        status: 409,
                        message: financeResult.reason || financeResult.action || "Status pembayaran tidak berubah"
                    }
                };
            }
        } else {
            const financeResult = await deps.applyPaymentStatusChange({
                user: userToUpdate,
                paid: false,
                periodMonth,
                periodYear,
                amountDue: deps.getEffectivePrice(draftUser),
                notes: "Status pembayaran diperbarui",
                createdBy: actor.username,
                sourceAdminAction: `users-update:${id}:unpaid`
            });
            // no_change/no_paid_position (tak ada bayaran utk dibalik — sudah unpaid, flag pun sudah di-set
            // false) & duplicate_retry = idempoten (target "belum bayar" sudah tercapai) → BUKAN kegagalan.
            const reversalApplied = financeResult.action === "reversed"
                || financeResult.action === "duplicate_retry"
                || (financeResult.action === "no_change" && financeResult.reason === "no_paid_position");
            if (!reversalApplied) {
                return {
                    status: 409,
                    body: {
                        status: 409,
                        message: financeResult.reason || financeResult.action || "Status pembayaran tidak berubah"
                    }
                };
            }
        }
    }

    await deps.repository.updateUserRecord({
        id,
        fields: Object.keys(userData).filter((key) => key !== "id"),
        draftUser,
        skipPaidField: paidStatusChanged
    });

    const nextUsers = deps.repository.getUsersSnapshot().map((user) => (
        String(user.id) === String(id) ? { ...user, ...draftUser } : user
    ));
    deps.repository.replaceUsersSnapshot(nextUsers);

    try {
        const changedFields = [];
        if (oldUserData.name !== draftUser.name) changedFields.push("name");
        if (oldUserData.phone_number !== draftUser.phone_number) changedFields.push("phone_number");
        if (oldUserData.subscription !== draftUser.subscription) changedFields.push("subscription");
        if (oldUserData.paid !== draftUser.paid) changedFields.push("paid");
        if (oldUserData.pppoe_username !== draftUser.pppoe_username) changedFields.push("pppoe_username");

        await deps.logActivity({
            userId: actor.id,
            username: actor.username,
            role: actor.role,
            actionType: "UPDATE",
            resourceType: "user",
            resourceId: draftUser.id.toString(),
            resourceName: draftUser.name,
            description: `Updated user ${draftUser.name} (changed: ${changedFields.join(", ") || "none"})`,
            oldValue: oldUserData,
            newValue: {
                name: draftUser.name,
                phone_number: draftUser.phone_number,
                subscription: draftUser.subscription,
                paid: draftUser.paid,
                pppoe_username: draftUser.pppoe_username,
                sync_policy: syncEnabled ? "enabled" : "disabled",
                sync_status: mikrotikSync.status,
                sync_message: mikrotikSync.message
            },
            ipAddress: requestMeta?.ipAddress,
            userAgent: requestMeta?.userAgent
        });
    } catch (logErr) {
        deps.logger.error?.("[ACTIVITY_LOG_ERROR] Failed to log user update:", logErr);
    }

    // Auto-kirim welcome saat No HP PERTAMA kali diisi (kosong → terisi) — solusi "lupa broadcast
    // selamat datang" untuk pelanggan yang dibuat tanpa HP (welcome CREATE hanya jalan bila HP terisi
    // saat dibuat). Fire-and-forget, non-blocking, guarded (notifikasi tak boleh menjatuhkan update).
    try {
        const oldPhoneEmpty = !String(oldUserData.phone_number || "").trim();
        const newPhoneFilled = !!String(draftUser.phone_number || "").trim();
        if (oldPhoneEmpty && newPhoneFilled) {
            const { sendCustomerWelcome } = require("./send-welcome");
            void sendCustomerWelcome(deps, { user: draftUser })
                .then((r) => {
                    if (r?.sent) {
                        deps.logger?.log?.(`[WELCOME_AUTO] Welcome terkirim ke ${draftUser.name} (No HP baru diisi)`);
                    }
                })
                .catch((e) => deps.logger?.error?.("[WELCOME_AUTO_ERROR]", e.message));
        }
    } catch (welcomeErr) {
        deps.logger?.error?.("[WELCOME_AUTO_ERROR]", welcomeErr.message);
    }

    return {
        status: 200,
        body: {
            status: 200,
            message: "User berhasil diperbarui",
            data: draftUser,
            sync_policy: syncEnabled ? "enabled" : "disabled",
            sync_status: mikrotikSync.status,
            sync_message: mikrotikSync.message,
            mikrotik_sync: mikrotikSync
        }
    };
}

module.exports = {
    updateUserById
};
