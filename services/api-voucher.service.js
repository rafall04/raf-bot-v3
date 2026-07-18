/**
 * Header Doc
 * Purpose: Menjadi owner orchestration domain API voucher untuk generate/send voucher, member credential delivery, dan statistik/history voucher API.
 * Caller: `routes/api-voucher-routes.js`.
 * Deps: `repositories/api-voucher.repository.js`, delivery WhatsApp terpusat, template renderer, dan adapter generate voucher/PHP.
 * MainFuncs: `createApiVoucherService`, `listVoucherProfiles`, `generateAndSendVouchers`, `listSentHistory`, `getSentStats`, `sendMemberCredentials`, `resendVoucherCode`, `reissueVoucher`.
 * SideEffects: Membaca katalog voucher, membaca/menulis history pengiriman, memanggil adapter generate voucher/PHP, dan mengirim pesan WhatsApp.
 */
"use strict";

const { getInternalServiceToken, INTERNAL_SERVICE_HEADER } = require("../lib/internal-service-token");

function defaultDeps() {
    return {
        repository: null,
        getConfig: null,
        renderTemplate: null,
        sendMessageToMany: null,
        ensureJid: null,
        // Generator voucher MikroTik + helper profil/payment untuk "terbitkan ulang" (reissue).
        getvoucher: null,
        checkprofvc: null,
        updateKetPayment: null,
        updateStatusPayment: null,
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
            let vouchersRequested = 0;
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
                vouchersRequested = generatedVouchers.length;
            } else if (isCustom) {
                if (!customUsername || !customPassword) {
                    return { status: 400, body: { status: 400, message: "Username dan Password diperlukan untuk voucher custom" } };
                }
                generatedVouchers.push({ username: customUsername, password: customPassword, profile, type: "custom" });
                vouchersRequested = 1;
            } else {
                if (!quantity || quantity < 1 || quantity > 50) {
                    return { status: 400, body: { status: 400, message: "Jumlah voucher harus antara 1-50" } };
                }
                vouchersRequested = quantity;
                const axios = require("axios");
                const appConfig = deps.getConfig() || {};
                const siteUrlBot = appConfig.site_url_bot || `http://127.0.0.1:${process.env.PORT || 3100}`;
                // adduserhotspot.php berada di belakang guard auth `.php` (requirePhpPageAuth).
                // Panggilan Node->.php WAJIB membawa token internal-service (pola sama seperti
                // lib/mikrotik.js); tanpa header ini guard menolak (401 di loopback, atau 404 di
                // balik reverse-proxy/Cloudflare) sehingga generate voucher gagal total.
                const internalHeaders = { [INTERNAL_SERVICE_HEADER]: getInternalServiceToken(appConfig.jwt || global.config?.jwt) };
                for (let i = 0; i < quantity; i += 1) {
                    try {
                        const phpUrl = `${siteUrlBot}/adduserhotspot.php?profil=${encodeURIComponent(profile)}&komen=VoucherSend`;
                        const phpResponse = await axios.get(phpUrl, { timeout: 15000, headers: internalHeaders });
                        if (phpResponse.data && phpResponse.data.status === "success" && phpResponse.data.data) {
                            generatedVouchers.push({
                                username: phpResponse.data.data.username,
                                password: phpResponse.data.data.password,
                                profile: phpResponse.data.data.profile || profile,
                                type: "random"
                            });
                        } else {
                            deps.logger.error?.(`[VOUCHER_GENERATE] Voucher ${i + 1} gagal: respons MikroTik tidak success`, phpResponse.data?.message || phpResponse.data?.status || "unknown");
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
                    message: generatedVouchers.length < vouchersRequested
                        ? `Berhasil generate ${generatedVouchers.length} dari ${vouchersRequested} voucher (${vouchersRequested - generatedVouchers.length} gagal)`
                        : `Berhasil generate ${generatedVouchers.length} voucher`,
                    vouchers: generatedVouchers,
                    vouchers_requested: vouchersRequested,
                    vouchers_generated: generatedVouchers.length,
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

        // Kirim ULANG kode voucher yang SUDAH terbit ke nomor pembeli (recovery). TIDAK menerbitkan
        // voucher baru — hanya mengirim ulang kode tersimpan. Router yang mencari record + kode;
        // service yang render template + kirim (owner WA-send). Never-throw.
        async resendVoucherCode({ phone, code, namaPaket, amount }) {
            if (!phone || !code) {
                return { status: 400, body: { status: 400, message: "Nomor & kode voucher diperlukan" } };
            }
            const harga = "Rp" + (parseInt(amount, 10) || 0).toLocaleString("id-ID");
            let message = deps.renderTemplate("voucher_purchase_success", {
                nama_paket: namaPaket || "Voucher",
                harga,
                kode_voucher: code
            });
            if (!message || typeof message !== "string" || message.startsWith("Error: Template")) {
                message = `Kode voucher ${namaPaket || ""} Anda: ${code}`;
            }
            let delivery;
            try {
                delivery = await deps.sendMessageToMany([phone], { text: message });
            } catch (_err) {
                return { status: 502, body: { status: 502, message: "Gagal mengirim (WhatsApp error). Coba lagi.", code } };
            }
            if (!delivery || !delivery.sent) {
                return { status: 503, body: { status: 503, message: "WhatsApp belum terhubung — kode belum terkirim. Scan ulang QR WhatsApp bot lalu coba lagi. Sementara, salin kode ini & kirim manual.", code } };
            }
            return { status: 200, body: { status: 200, message: "Kode voucher dikirim ulang ke WhatsApp pembeli.", code } };
        },

        // Terbitkan ULANG voucher untuk transaksi yang SUDAH DIBAYAR tapi voucher-nya GAGAL terbit
        // (mis. MikroTik down saat callback). Generate voucher BARU via getvoucher, simpan kode +
        // tandai lunas, lalu kirim ke WA pembeli. NON-IDEMPOTENT: route wajib memvalidasi record
        // belum punya kode + mengunci per-reff agar klik ganda tak membuat voucher dobel.
        async reissueVoucher({ reff, amount, sender, namaPaket }) {
            if (!reff || !sender) {
                return { status: 400, body: { status: 400, message: "Ref & nomor pembeli diperlukan" } };
            }
            if (typeof deps.getvoucher !== "function" || typeof deps.checkprofvc !== "function") {
                return { status: 500, body: { status: 500, message: "Generator voucher tidak tersedia (dependency belum diinjeksi)." } };
            }
            const amt = parseInt(amount, 10) || 0;
            const prof = deps.checkprofvc(String(amt));
            if (!prof) {
                return { status: 422, body: { status: 422, message: "Profil voucher untuk nominal Rp" + amt.toLocaleString("id-ID") + " tidak ada di katalog." } };
            }
            let voucherResult;
            try {
                voucherResult = await deps.getvoucher(prof, sender, { caller: "api.voucher.reissue" });
            } catch (err) {
                return { status: 502, body: { status: 502, message: "Gagal generate voucher: " + (err && err.message ? err.message : "error MikroTik") } };
            }
            if (!voucherResult || !voucherResult.ok) {
                return { status: 502, body: { status: 502, message: "Gagal generate voucher: " + ((voucherResult && voucherResult.message) || "MikroTik menolak permintaan") } };
            }
            const code = (voucherResult.data && voucherResult.data.username) || voucherResult.message;
            // Voucher berhasil dibuat → simpan kode + tandai lunas (record tak lagi "gagal terbit").
            if (typeof deps.updateKetPayment === "function") deps.updateKetPayment(reff, String(code));
            if (typeof deps.updateStatusPayment === "function") deps.updateStatusPayment(reff, true);
            // Kirim ke WA pembeli (best-effort; kode sudah tersimpan & tampil di dashboard walau WA putus).
            let message = deps.renderTemplate("voucher_purchase_success", {
                nama_paket: namaPaket || prof,
                harga: "Rp" + amt.toLocaleString("id-ID"),
                kode_voucher: code
            });
            if (!message || typeof message !== "string" || message.startsWith("Error: Template")) {
                message = `Kode voucher ${namaPaket || prof} Anda: ${code}`;
            }
            let sent = false;
            try {
                const delivery = await deps.sendMessageToMany([sender], { text: message });
                sent = !!(delivery && delivery.sent);
            } catch (_err) { sent = false; }
            return {
                status: 200,
                body: {
                    status: 200,
                    code: String(code),
                    sent,
                    message: sent
                        ? "Voucher diterbitkan ulang & kode dikirim ke WhatsApp pembeli."
                        : "Voucher diterbitkan ulang (kode tersimpan). WhatsApp belum terhubung — salin kode & kirim manual."
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
