/**
 * Header Doc
 * Purpose: Menjadi owner orchestration domain API voucher untuk generate/send voucher, member credential delivery, dan statistik/history voucher API.
 * Caller: `routes/api-voucher-routes.js`.
 * Deps: `repositories/api-voucher.repository.js`, delivery WhatsApp terpusat, template renderer, dan adapter generate voucher/PHP.
 * MainFuncs: `createApiVoucherService`, `listVoucherProfiles`, `generateAndSendVouchers`, `listSentHistory`, `getSentStats`, `sendMemberCredentials`.
 * SideEffects: Membaca katalog voucher, membaca/menulis history pengiriman, memanggil adapter generate voucher/PHP, dan mengirim pesan WhatsApp.
 */
"use strict";

function defaultDeps() {
    return {
        repository: null,
        getConfig: null,
        renderTemplate: null,
        sendMessageToMany: null,
        ensureJid: null,
        resolveVoucherDeliveryStatus: null,
        buildVoucherSentHistoryEntries: null,
        logger: console
    };
}

function createApiVoucherService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    return {
        deps,

        async listVoucherProfiles() {
            const profiles = deps.repository.getVoucherProfiles();
            return {
                status: 200,
                body: {
                    status: 200,
                    message: `Ditemukan ${profiles.length} paket voucher`,
                    data: profiles
                }
            };
        },

        async generateAndSendVouchers(payload = {}) {
            const {
                profile,
                profileName,
                duration,
                quantity,
                phones,
                notes,
                sendWhatsApp,
                voucherType,
                customUsername,
                customPassword,
                transaction_context,
                recipient_type,
                voucher_source,
                reference_id,
                customer_id,
                createdBy
            } = payload;

            const transactionContext = transaction_context || "direct_customer_sale";
            const recipientType = recipient_type || "end_user";
            const voucherSource = voucher_source || (transactionContext === "delivery_resend" ? "existing_history" : "generated");

            if (recipientType === "agent_reseller") {
                return { status: 400, body: { status: 400, message: "Pengiriman voucher ke reseller harus memakai flow agent purchase, bukan generate-send." } };
            }
            if (!["direct_customer_sale", "delivery_resend"].includes(transactionContext)) {
                return { status: 400, body: { status: 400, message: "transaction_context tidak valid untuk route ini" } };
            }
            if (!profile) {
                return { status: 400, body: { status: 400, message: "Profile voucher diperlukan" } };
            }

            const isCustom = voucherType === "custom";
            let generatedVouchers = [];
            const voucherProfile = deps.repository.getVoucherProfileById(profile);

            if (transactionContext === "delivery_resend") {
                const history = deps.repository.loadSentHistory();
                const matchedEntries = deps.repository.findHistoryByReference(history, reference_id);
                if (matchedEntries.length === 0) {
                    return { status: 400, body: { status: 400, message: "Referensi voucher resend tidak ditemukan" } };
                }
                generatedVouchers = matchedEntries.map((entry) => ({
                    username: entry.username,
                    password: entry.password,
                    profile: entry.profile,
                    type: entry.type || "random"
                }));
            } else if (isCustom) {
                if (!customUsername || !customPassword) {
                    return { status: 400, body: { status: 400, message: "Username dan Password diperlukan untuk voucher custom" } };
                }
                generatedVouchers.push({ username: customUsername, password: customPassword, profile, type: "custom" });
            } else {
                if (!quantity || quantity < 1 || quantity > 50) {
                    return { status: 400, body: { status: 400, message: "Jumlah voucher harus antara 1-50" } };
                }
                const axios = require("axios");
                const siteUrlBot = deps.getConfig()?.site_url_bot || `http://127.0.0.1:${process.env.PORT || 3000}`;
                for (let i = 0; i < quantity; i += 1) {
                    try {
                        const phpUrl = `${siteUrlBot}/adduserhotspot.php?profil=${encodeURIComponent(profile)}&komen=VoucherSend`;
                        const phpResponse = await axios.get(phpUrl, { timeout: 15000 });
                        if (phpResponse.data && phpResponse.data.status === "success" && phpResponse.data.data) {
                            generatedVouchers.push({
                                username: phpResponse.data.data.username,
                                password: phpResponse.data.data.password,
                                profile: phpResponse.data.data.profile || profile,
                                type: "random"
                            });
                        }
                    } catch (err) {
                        deps.logger.error?.(`[VOUCHER_GENERATE] Error generating voucher ${i + 1}:`, err.message);
                    }
                    if (i < quantity - 1) {
                        await new Promise((resolve) => setTimeout(resolve, 300));
                    }
                }
                if (generatedVouchers.length === 0) {
                    return { status: 500, body: { status: 500, message: "Gagal generate voucher dari MikroTik. Pastikan koneksi MikroTik aktif." } };
                }
            }

            const notesText = notes ? `Catatan: ${notes}` : "";
            const wifiName = deps.getConfig()?.nama_wifi || "RAF NET";
            let message = "";

            if (isCustom) {
                message = deps.renderTemplate("voucher_send_custom", {
                    nama_paket: profileName || profile,
                    durasi: duration || "-",
                    username: customUsername,
                    password: customPassword,
                    catatan: notesText,
                    nama_wifi: wifiName
                });
                if (message.startsWith("Error: Template")) {
                    message = `Voucher Hotspot\n\nPaket: ${profileName || profile}\nDurasi: ${duration || "-"}\n\nKredensial Login:\nUsername: ${customUsername}\nPassword: ${customPassword}\n\n${notesText}\n\n${wifiName}`;
                }
            } else {
                const voucherListText = generatedVouchers.map((voucher, index) => `${generatedVouchers.length > 1 ? `${index + 1}. ` : ""}Kode: \`${voucher.username}\``).join("\n");
                message = deps.renderTemplate("voucher_send", {
                    nama_paket: profileName || profile,
                    durasi: duration || "-",
                    voucher_list: voucherListText,
                    catatan: notesText,
                    nama_wifi: wifiName
                });
                if (message.startsWith("Error: Template")) {
                    message = `Voucher Hotspot\n\nPaket: ${profileName || profile}\nDurasi: ${duration || "-"}\n\nKode Voucher:\n${voucherListText}\n\n${notesText}\n\n${wifiName}`;
                }
            }

            let requestedPhones = Array.isArray(phones) ? phones.map((phone) => String(phone || "").trim()).filter(Boolean) : [];
            const sentTo = [];
            const failedTo = [];

            if (transactionContext === "delivery_resend" && requestedPhones.length === 0) {
                const history = deps.repository.loadSentHistory();
                const matchedEntries = deps.repository.findHistoryByReference(history, reference_id);
                requestedPhones = matchedEntries.flatMap((entry) => String(entry.phone || "").split(",")).map((phone) => phone.trim()).filter(Boolean);
            }

            if (sendWhatsApp && requestedPhones.length > 0) {
                const delivery = await deps.sendMessageToMany(requestedPhones, { text: message });
                const deliveredRecipients = new Set((delivery.recipients || []).map((recipient) => deps.ensureJid(recipient)));
                for (const phone of requestedPhones) {
                    if (deliveredRecipients.has(deps.ensureJid(phone))) sentTo.push(phone);
                    else failedTo.push(phone);
                }
            }

            const deliveryStatus = deps.resolveVoucherDeliveryStatus({
                sendWhatsApp: Boolean(sendWhatsApp),
                requestedPhones,
                sentTo
            });
            const batchId = `VSB_${Date.now()}`;
            deps.repository.appendSentHistory(
                deps.buildVoucherSentHistoryEntries({
                    batchId,
                    vouchers: generatedVouchers,
                    profile,
                    profileName,
                    duration,
                    notes,
                    requestedPhones,
                    sentTo,
                    failedTo,
                    createdBy: createdBy || "admin",
                    sentStatus: deliveryStatus,
                    metadata: {
                        transaction_context: transactionContext,
                        recipient_type: recipientType,
                        voucher_source: voucherSource,
                        price_snapshot: voucherProfile ? parseInt(voucherProfile.hargavc || 0, 10) : null,
                        price_type: "retail",
                        voucher_profile_snapshot: voucherProfile ? {
                            prof: voucherProfile.prof,
                            namavc: voucherProfile.namavc,
                            durasivc: voucherProfile.durasivc,
                            hargavc: voucherProfile.hargavc,
                            hargaReseller: voucherProfile.hargaReseller,
                            margin: voucherProfile.margin
                        } : null,
                        customer_id: customer_id || null,
                        financial_effect: "none",
                        reference_id: reference_id || null
                    }
                })
            );

            return {
                status: 200,
                body: {
                    status: 200,
                    message: `Berhasil generate ${generatedVouchers.length} voucher`,
                    vouchers: generatedVouchers,
                    batch_id: batchId,
                    transaction_context: transactionContext,
                    recipient_type: recipientType,
                    voucher_source: voucherSource,
                    delivery_status: deliveryStatus,
                    sent_to: sentTo,
                    failed_to: failedTo,
                    total_requested: requestedPhones.length,
                    total_sent: sentTo.length,
                    sentTo,
                    totalSent: sentTo.length
                }
            };
        },

        async listSentHistory({ limit = 50 } = {}) {
            const history = deps.repository.loadSentHistory();
            return {
                status: 200,
                body: {
                    status: 200,
                    data: history
                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                        .slice(0, limit),
                    total: history.length
                }
            };
        },

        async getSentStats() {
            const history = deps.repository.loadSentHistory();
            const stats = deps.repository.getSentStats(history);
            return {
                status: 200,
                body: {
                    status: 200,
                    ...stats
                }
            };
        },

        async sendMemberCredentials({ userId, phones, notes, createdBy }) {
            if (!userId) {
                return { status: 400, body: { status: 400, message: "User ID diperlukan" } };
            }

            const user = await deps.repository.findUserById(userId);
            if (!user) {
                return { status: 404, body: { status: 404, message: "User tidak ditemukan" } };
            }

            const packageInfo = user.paket ? deps.repository.findPackageByName(user.paket) : null;
            let targetPhones = phones && phones.length > 0 ? phones : [];
            if (targetPhones.length === 0 && user.no_hp) {
                targetPhones = user.no_hp.split("|").map((phone) => phone.trim()).filter(Boolean);
            }
            if (targetPhones.length === 0) {
                return { status: 400, body: { status: 400, message: "Tidak ada nomor HP tujuan" } };
            }

            const notesText = notes ? `Catatan: ${notes}` : "";
            const wifiName = deps.getConfig()?.nama_wifi || "RAF NET";
            let finalMessage = deps.renderTemplate("member_credentials_send", {
                nama_pelanggan: user.nama || "-",
                username: user.pppoe || user.username || "-",
                password: user.password || "-",
                nama_paket: packageInfo?.nama || user.paket || "-",
                catatan: notesText,
                nama_wifi: wifiName
            });
            if (finalMessage.startsWith("Error: Template")) {
                finalMessage = `Kredensial Member\n\nHalo ${user.nama || "-"},\n\nUsername: ${user.pppoe || user.username || "-"}\nPassword: ${user.password || "-"}\nPaket: ${packageInfo?.nama || user.paket || "-"}\n\n${notesText}\n\n${wifiName}`;
            }

            const delivery = await deps.sendMessageToMany(targetPhones, { text: finalMessage });
            if (!delivery.sent && delivery.errorCode === "WHATSAPP_NOT_CONNECTED") {
                return { status: 500, body: { status: 500, message: "WhatsApp tidak terhubung" } };
            }

            const deliveredRecipients = new Set((delivery.recipients || []).map((recipient) => deps.ensureJid(recipient)));
            const sentTo = targetPhones.filter((phone) => deliveredRecipients.has(deps.ensureJid(phone)));
            if (sentTo.length === 0) {
                return { status: 500, body: { status: 500, message: "Gagal mengirim ke semua nomor" } };
            }

            deps.repository.appendSentHistory([{
                id: `MC${Date.now()}`,
                type: "member_credentials",
                user_id: user.id,
                user_name: user.nama,
                username: user.pppoe || user.username,
                phone: sentTo.join(", "),
                notes,
                sent_status: "sent",
                created_at: new Date().toISOString(),
                created_by: createdBy || "admin"
            }]);

            return {
                status: 200,
                body: {
                    status: 200,
                    message: `Kredensial berhasil dikirim ke ${sentTo.length} nomor`,
                    sentTo,
                    user: {
                        nama: user.nama,
                        username: user.pppoe || user.username,
                        paket: user.paket
                    }
                }
            };
        }
    };
}

module.exports = {
    createApiVoucherService
};
