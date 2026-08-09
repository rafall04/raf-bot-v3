/**
 * Header Doc
 * Purpose: Phase 4-8 dari workflow create user — insert ke DB + in-memory snapshot, apply paid status via finance boundary (dengan rollback on error: hapus user dari snapshot+DB jika gagal mencatat status lunas), OPSIONAL waiver "bebas tagihan bulan ini" bila `userData.free_first_month` ON (best-effort, mutual-eksklusif dgn paid, hanya paket bertagihan), activity log (best-effort), kirim welcome message via WhatsApp (best-effort, mode-aware: `psb_welcome` untuk mode new, `import_welcome` untuk import, `customer_welcome` default), return final response 201 dengan generated credentials + mikrotik sync metadata + `free_month_applied`.
 * Caller: `services/api-users/create-user.js` (orchestrator).
 * Deps: `deps.repository.insertUserRecord`/`getUsersSnapshot`/`replaceUsersSnapshot`/`deleteUserRecord`, `deps.applyPaymentStatusChange`, `deps.handlePaidStatusChange`, `deps.getPeriodParts`, `deps.getEffectivePrice`, `deps.logActivity`, `deps.getConfig`, `deps.getPackages`, `deps.renderTemplate`, `deps.sendMessage`, `deps.getStatusSnapshot`, `deps.logger`, lazy-require `../../lib/utils` (normalizePhoneNumber).
 * MainFuncs: `persistAndNotifyNewUser(deps, { newUser, plainTextPassword, finalUsername, paymentMethod, registrationMode, mikrotikSync, deviceConfig, syncEnabled, userData, actor, requestMeta })`.
 * SideEffects: DB insert + snapshot replace, finance boundary call (paid path), activity log, WhatsApp send (async/fire-and-forget). Rollback paid path: hapus user dari DB+snapshot jika applyPaymentStatusChange gagal — throw final error. Welcome mode `new` DITAHAN bila `deviceConfig.attempted && !deviceConfig.ok` (push modem gagal → jangan janjikan WiFi aktif); respons membawa `device_config` + `warning:"device_config_failed"` agar teknisi/admin tahu harus set modem manual.
 */
"use strict";

async function persistAndNotifyNewUser(deps, { newUser, plainTextPassword, finalUsername, paymentMethod, registrationMode, mikrotikSync, deviceConfig = { attempted: false, ok: false, message: null }, syncEnabled, userData, actor, requestMeta }) {
    await deps.repository.insertUserRecord(newUser);
    const usersAfterInsert = [...deps.repository.getUsersSnapshot(), newUser];
    deps.repository.replaceUsersSnapshot(usersAfterInsert);

    // Pelanggan menempel ke ODP → segarkan pemakaian port (dihitung ULANG dari data pelanggan).
    // Best-effort & never-throw: user sudah tersimpan; angka port tak boleh menggagalkan pendaftaran.
    if (newUser.connected_odp_id) {
        try {
            deps.syncPortUsage?.({ getUsers: () => usersAfterInsert });
        } catch (err) {
            deps.logger?.error?.("[CREATE_USER] Gagal hitung ulang pemakaian port ODP:", err);
        }
    }

    if (newUser.paid === true) {
        const { periodMonth, periodYear } = deps.getPeriodParts({ date: new Date() });
        try {
            const financeResult = await deps.applyPaymentStatusChange({
                user: newUser,
                paid: true,
                periodMonth,
                periodYear,
                amountPaid: deps.getEffectivePrice(newUser),
                amountDue: deps.getEffectivePrice(newUser),
                isPartial: false,
                paymentMethod,
                notes: "Status pembayaran ditandai lunas saat pembuatan pelanggan",
                createdBy: actor.username,
                sourceAdminAction: `user-create:${newUser.id}:paid`,
                onFinalPaid: async () => {
                    await deps.handlePaidStatusChange(newUser, {
                        paidDate: new Date().toISOString(),
                        method: paymentMethod,
                        approvedBy: actor.username,
                        notes: "Status pembayaran ditandai lunas saat pembuatan pelanggan"
                    });
                }
            });
            if (financeResult.action !== "paid") {
                throw new Error(financeResult.reason || financeResult.action || "Status pembayaran tidak berubah");
            }
        } catch (paidChangeErr) {
            deps.repository.replaceUsersSnapshot(
                deps.repository.getUsersSnapshot().filter((user) => String(user.id) !== String(newUser.id))
            );
            await deps.repository.deleteUserRecord(newUser.id);
            throw new Error(`Gagal mencatat status lunas pelanggan baru: ${paidChangeErr.message}`);
        }
    }

    // Toggle "Bebaskan tagihan bulan ini" (pelanggan baru mulai bayar bulan DEPAN). Mencatat WAIVER
    // (GRATIS) periode berjalan via boundary finance → periode dianggap lunas (kebal isolir + sinkron
    // rollover) TANPA masuk pemasukan. Mutual-eksklusif dgn paid (lunas=bayar), dan hanya untuk paket
    // bertagihan (>0). BEST-EFFORT: kegagalan waiver TIDAK menggagalkan pembuatan user (admin bisa
    // "Tandai Gratis" manual). Lihat lib/payment-finance-service.applyFreeMonth.
    let freeMonthApplied = false;
    const freeFirstMonth = userData?.free_first_month === true || userData?.free_first_month === "true";
    if (freeFirstMonth && newUser.paid !== true && deps.getEffectivePrice(newUser) > 0) {
        try {
            const applyFreeMonth = deps.applyFreeMonth
                || require("../../lib/payment-finance-service").applyFreeMonth;
            const { periodMonth, periodYear } = deps.getPeriodParts({ date: new Date() });
            const waiverResult = await applyFreeMonth({
                user: newUser,
                periodMonth,
                periodYear,
                reason: "Pelanggan baru — bebas tagihan bulan pendaftaran",
                createdBy: actor.username
            });
            freeMonthApplied = waiverResult.action === "waived"
                || waiverResult.action === "duplicate_retry"
                || waiverResult.positionAfter?.is_waived === true;
        } catch (freeErr) {
            deps.logger.error?.("[FREE_FIRST_MONTH_ERROR] Gagal apply waiver pelanggan baru:", freeErr.message);
        }
    }

    try {
        await deps.logActivity({
            userId: actor.id,
            username: actor.username,
            role: actor.role,
            actionType: "CREATE",
            resourceType: "user",
            resourceId: newUser.id.toString(),
            resourceName: newUser.name,
            description: `Created new user ${newUser.name}`,
            oldValue: null,
            newValue: {
                name: newUser.name,
                phone_number: newUser.phone_number,
                subscription: newUser.subscription,
                paid: newUser.paid,
                pppoe_username: newUser.pppoe_username,
                sync_policy: syncEnabled ? "enabled" : "disabled",
                sync_status: mikrotikSync.status,
                sync_message: mikrotikSync.message
            },
            ipAddress: requestMeta?.ipAddress,
            userAgent: requestMeta?.userAgent
        });
    } catch (logErr) {
        deps.logger.error?.("[ACTIVITY_LOG_ERROR] Failed to log user create:", logErr);
    }

    const appConfig = deps.getConfig();
    const welcomeEnabled = appConfig.welcomeMessage?.enabled !== false;
    // Push konfigurasi ke modem GAGAL → jangan kirim welcome yang menjanjikan "WiFi aktif"
    // (pelanggan akan diberi sandi WiFi yang belum di-set di modem). Kegagalan dimunculkan ke
    // teknisi/admin via `device_config` di respons. Keputusan user: "Tahan + beri tahu teknisi".
    const devicePushFailed = Boolean(deviceConfig?.attempted && !deviceConfig.ok);
    if (welcomeEnabled && newUser.phone_number) {
        try {
            const { normalizePhoneNumber } = require("../../lib/utils");
            let templateName = "customer_welcome";
            let templateData = {};

            if (registrationMode === "new" && userData.wifi_ssid && userData.wifi_password) {
                if (devicePushFailed) {
                    deps.logger.warn?.(`[WELCOME_HELD] psb_welcome ditahan utk pelanggan ${newUser.id}: push modem gagal (${deviceConfig?.message || "-"}). Set WiFi/PPPoE di modem manual dulu, lalu kirim welcome dari tombol.`);
                    throw new Error("Skip welcome message");
                }
                templateName = "psb_welcome";
                templateData = {
                    nama_pelanggan: newUser.name,
                    wifi_ssid: userData.wifi_ssid,
                    wifi_password: userData.wifi_password,
                    nama_paket: newUser.subscription || "-",
                    nama_wifi: appConfig.nama || appConfig.nama_wifi || "Layanan Kami",
                    nama_bot: appConfig.namabot || appConfig.botName || "RAF NET BOT"
                };
            } else if (registrationMode === "import") {
                let displayProfile = "-";
                if (newUser.subscription && deps.getPackages().length > 0) {
                    const pkg = deps.getPackages().find((item) => item.name === newUser.subscription);
                    // `packages.json` memakai camelCase `displayProfile`. Membaca `display_profile`
                    // (snake) SELALU undefined, sehingga jatuh ke `pkg.profile` — nama profil
                    // MikroTik. Akibatnya pelanggan diberi tahu angka yang BUKAN produk yang dijual,
                    // dan konsisten LEBIH TINGGI (Tanjung PAKET-110K: "16Mbps" padahal "Up To 10Mbps").
                    // Snake dipertahankan sebagai cadangan supaya katalog lama tetap terbaca.
                    if (pkg && (pkg.displayProfile || pkg.display_profile)) {
                        displayProfile = pkg.displayProfile || pkg.display_profile;
                    } else if (pkg && pkg.profile) {
                        displayProfile = pkg.profile;
                    }
                }
                templateName = "import_welcome";
                templateData = {
                    nama_pelanggan: newUser.name,
                    nama_paket: newUser.subscription || "-",
                    display_profile: displayProfile,
                    nama_wifi: appConfig.nama || appConfig.nama_wifi || "Layanan Kami",
                    nama_bot: appConfig.namabot || appConfig.botName || "RAF NET BOT"
                };
            } else {
                if (!newUser.username || !plainTextPassword) {
                    throw new Error("Skip welcome message");
                }
                const portalUrl = appConfig.welcomeMessage?.customerPortalUrl || appConfig.company?.website || appConfig.site_url_bot || "https://rafnet.my.id/customer";
                templateData = {
                    nama_pelanggan: newUser.name,
                    username: newUser.username,
                    password: plainTextPassword,
                    portal_url: portalUrl,
                    nama_wifi: appConfig.nama || appConfig.nama_wifi || "Layanan Kami",
                    nama_bot: appConfig.namabot || appConfig.botName || "RAF NET BOT"
                };
            }

            const messageText = deps.renderTemplate(templateName, templateData);
            if (!messageText) {
                throw new Error("Template not found");
            }

            const phoneNumbers = newUser.phone_number.split("|").map((item) => item.trim()).filter(Boolean);
            void (async () => {
                for (const number of phoneNumbers) {
                    const normalizedNumber = normalizePhoneNumber(number);
                    if (normalizedNumber && deps.getStatusSnapshot().connectionState === "open") {
                        const jid = `${normalizedNumber}@s.whatsapp.net`;
                        try {
                            await new Promise((resolve) => setTimeout(resolve, 1000));
                            const delivery = await deps.sendMessage(jid, { text: messageText });
                            if (!delivery.sent) {
                                throw new Error(delivery.warning || delivery.errorCode || "SEND_FAILED");
                            }
                        } catch (e) {
                            deps.logger.error?.(`[WELCOME_MSG_ERROR] Failed to send welcome message to ${jid}:`, e.message);
                        }
                    }
                }
            })();
        } catch (welcomeError) {
            if (welcomeError.message !== "Skip welcome message" && welcomeError.message !== "Template not found") {
                deps.logger.error?.("[WELCOME_MSG_ERROR] Failed to send welcome message:", welcomeError.message);
            }
        }
    }

    return {
        status: 201,
        body: {
            status: 201,
            message: freeMonthApplied
                ? "User berhasil ditambahkan (tagihan bulan ini dibebaskan — mulai ditagih bulan depan)"
                : "User berhasil ditambahkan",
            free_month_applied: freeMonthApplied,
            data: newUser,
            generated_credentials: {
                username: finalUsername,
                password: plainTextPassword
            },
            registration_mode: registrationMode || "legacy",
            sync_policy: syncEnabled ? "enabled" : "disabled",
            sync_status: mikrotikSync.status,
            sync_message: mikrotikSync.message,
            mikrotik_sync: mikrotikSync,
            device_config: deviceConfig,
            ...(devicePushFailed ? {
                warning: "device_config_failed",
                provisioning_note: "Konfigurasi WiFi/PPPoE ke modem GAGAL dikirim. Set manual di modem; pesan WiFi ke pelanggan DITAHAN sampai modem beres."
            } : {})
        }
    };
}

module.exports = {
    persistAndNotifyNewUser
};
