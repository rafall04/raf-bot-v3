/**
 * Header Doc
 * Purpose: Menjadi owner orchestration bot-side untuk create request payment/topup, voucher purchase flow, dan upload bukti pembayaran selama normalisasi Wave 2.
 * Caller: `message/handlers/payment-processor-handler.js` dan `message/handlers/topup-handler.js`.
 * Deps: `repositories/payment.repository.js`, helper state conversation, adapter payment gateway, runtime delivery WA, media download, template renderer, dan logger.
 * MainFuncs: `createPaymentFlowService`, `handleTopupSaldoPayment`, `handleBeliVoucher`, `processVoucherPurchase`, `handleVoucherChoiceState`, `handleTopupPaymentProof`, `notifyAdminsWithProof`, `getAdminRecipients`.
 * SideEffects: Membuat request payment, memperbarui bukti topup, menyimpan file bukti, mengirim QR/pesan WhatsApp, dan memberi notifikasi admin.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const qr = require("qr-image");
const convertRupiah = require("rupiah-format");
const { createPaymentRepository } = require("../repositories/payment.repository");
const { renderCategoryTemplate } = require("../lib/template-service");

function renderResponseTemplate(key, data = {}, fallback = "") {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found && result.text.trim() ? result.text : (fallback || key);
}

function createNotImplemented(name) {
    return async function notImplemented() {
        throw new Error(`${name} is not implemented yet`);
    };
}

function defaultDeps() {
    return {
        paymentRepository: createPaymentRepository(),
        renderTemplate: require("../lib/templating").renderTemplate,
        sendMessage: require("../lib/whatsapp-delivery-service").sendMessage,
        sendMessageToMany: require("../lib/whatsapp-delivery-service").sendMessageToMany,
        downloadMedia: require("../lib/whatsapp.adapter").downloadMedia,
        normalizeJidForSaldo: require("../lib/jid-utils").normalizeJidForSaldo,
        getSocket: require("../lib/whatsapp-gateway").getSocket,
        getConnectionState: require("../lib/whatsapp-gateway").getConnectionState,
        logger: require("../lib/logger").logger
    };
}

function createPaymentFlowService(overrides = {}) {
    const deps = {
        ...defaultDeps(),
        ...overrides
    };

    async function handleTopupSaldoPayment({
        sender,
        pushname,
        command,
        q,
        from,
        msg,
        pay,
        checkprofvc,
        checkhargavoucher,
        checkhargavc,
        addPayment
    }) {
        if (!q) throw "contoh penggunaan: topup 10000";

        let number = parseInt(q, 10);
        if (command === "topup" && (Number.isNaN(number) || number < 1000 || number > 1_000_000)) {
            throw "Jumlah topup invalid!\nMinimum topup Rp. 1000 & Maksimal topup Rp. 1.000.000";
        }

        const reff = Math.floor(Math.random() * 1677721631342).toString(16);
        let profvc = checkprofvc(q);

        if (command === "buynow") {
            if (!checkhargavoucher(q)) {
                throw "Harga Voucher Tersebut Tidak Terdaftar. Silahkan Periksa Lagi.\n\nTerima Kasih";
            }
            number = checkhargavc(profvc);
        }

        const paymentGateway = pay || deps.pay || createNotImplemented("paymentFlow.pay");
        const createPaymentRequest = addPayment || deps.paymentRepository.createPaymentRequest.bind(deps.paymentRepository);

        const res = await paymentGateway({
            amount: number,
            reffId: reff,
            comment: command === "topup"
                ? `Topup dana saldo sebesar Rp. ${number}`
                : `pembelian voucher ${profvc} sebesar Rp. ${number}`,
            name: pushname,
            phone: sender.split("@")[0],
            email: sender
        });

        const text = deps.renderTemplate("qris_payment_info", {
            sub_total: res.subTotal.toLocaleString("id-ID"),
            biaya_admin: res.fee.toLocaleString("id-ID"),
            total_bayar: res.total.toLocaleString("id-ID")
        });

        await createPaymentRequest(reff, res.id, sender, command, number, "QRIS", `Topup ${number} to ${sender}`);

        const qrr = qr.imageSync(res.qrString, { type: "png", ec_level: "H" });
        await deps.sendMessage(from, { image: qrr, caption: text }, { quoted: msg, skipDuplicateCheck: true });
    }

    async function processVoucherPurchase(sender, pushname, price, replyFunc, helpers, globalScope) {
        const {
            checkhargavoucher,
            checkprofvc,
            checkdurasivc,
            checkhargavc,
            checkATMuser,
            confirmATM,
            getvoucher
        } = helpers;

        if (!checkhargavoucher(price)) {
            await replyFunc(renderResponseTemplate("payment_flow_voucher_price_not_found", { chosenPrice: price }));
            return;
        }

        const profvc123 = checkprofvc(price);
        const durasivc123 = checkdurasivc(profvc123);
        const hargavc123 = checkhargavc(profvc123);

        const currentSaldo = await checkATMuser(sender);
        if (currentSaldo < hargavc123) {
            await replyFunc(renderResponseTemplate("payment_flow_voucher_purchase_insufficient_balance", {
                voucherPrice: convertRupiah.convert(hargavc123),
                currentBalance: convertRupiah.convert(currentSaldo)
            }));
            return;
        }

        try {
            await replyFunc(renderResponseTemplate("payment_flow_voucher_purchase_processing"));

            const voucherResult = await getvoucher(profvc123, sender, { caller: "payment-processor.purchase-voucher" });
            if (!voucherResult.ok) {
                throw new Error(voucherResult.message);
            }

            const voucherData = voucherResult.data || {};
            const voucherCode = `${voucherData.username}`;

            await confirmATM(sender, hargavc123);
            const currentSaldoAfterPurchase = await checkATMuser(sender);
            const formattedSaldoAfterPurchase = convertRupiah.convert(currentSaldoAfterPurchase);

            await replyFunc(renderResponseTemplate("payment_flow_voucher_purchase_success", {
                packageName: durasivc123,
                voucherCode,
                remainingBalance: formattedSaldoAfterPurchase,
                serviceName: globalScope.config.nama
            }));
        } catch (err) {
            let userFriendlyErrorMessage = "Terjadi kesalahan saat membuat voucher. ";
            if (err.message) {
                if (err.message.includes("Kesalahan Koneksi Mikrotik")) {
                    userFriendlyErrorMessage += "Bot gagal terhubung ke Mikrotik. Mohon laporkan ke Admin.";
                } else if (err.message.includes("Profil Hotspot yang dimasukkan salah atau tidak ditemukan")) {
                    userFriendlyErrorMessage += "Profil voucher yang Anda pilih tidak valid. Mohon hubungi Admin.";
                } else if (err.message.includes("Voucher dengan username ini") || err.message.includes("already have user with this name")) {
                    userFriendlyErrorMessage += "Terjadi duplikasi username saat membuat voucher. Mohon coba lagi atau hubungi Admin.";
                } else if (err.message.includes("data username/password tidak ditemukan")) {
                    userFriendlyErrorMessage += "Voucher berhasil dibuat, namun bot gagal mendapatkan username/passwordnya. Mohon laporkan ke Admin.";
                } else {
                    userFriendlyErrorMessage += `Detail: ${err.message || "Error tidak diketahui"}. Mohon coba lagi atau hubungi Admin.`;
                }
            }
            await replyFunc(renderResponseTemplate("payment_flow_voucher_purchase_failure", {
                errorMessage: userFriendlyErrorMessage
            }));
        }
    }

    async function handleBeliVoucher({ sender, pushname, entities = {}, q, reply, global, helpers, setUserState }) {
        const hargaVoucher = entities.harga_voucher || q;

        if (hargaVoucher) {
            return processVoucherPurchase(sender, pushname, hargaVoucher, reply, helpers, global);
        }

        setUserState(sender, {
            step: "ASK_VOUCHER_CHOICE",
            flow: "payment",
            ownerType: "customer",
            context: {
                voucherFlow: "purchase"
            }
        });

        let voucherListString = "";
        if (global.voucher && global.voucher.length > 0) {
            global.voucher.forEach((voucher) => {
                const parsedHarga = parseInt(voucher.hargavc, 10);
                const hargaFormatted = parsedHarga
                    ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(parsedHarga)
                    : `Rp ${voucher.hargavc}`;
                voucherListString += `  • 💸 ${voucher.namavc || "Voucher"} (${voucher.durasivc || "N/A"}) - *${hargaFormatted}*\n`;
            });
        } else {
            voucherListString = "Maaf, saat ini tidak ada voucher yang tersedia.\n";
        }

        return reply(renderResponseTemplate("payment_flow_voucher_purchase_prompt", {
            pushname,
            voucherList: voucherListString
        }));
    }

    async function handleVoucherChoiceState({ sender, pushname, chats, reply, helpers, global, getUserState, deleteUserState }) {
        const userState = getUserState(sender);
        if (!userState || userState.step !== "ASK_VOUCHER_CHOICE") {
            return { handled: false };
        }

        const chosenPrice = chats.trim().replace(/\D/g, "");
        if (!chosenPrice) {
            await reply(renderResponseTemplate("payment_flow_voucher_price_prompt"));
            return { handled: true };
        }

        if (!helpers.checkhargavoucher(chosenPrice)) {
            await reply(renderResponseTemplate("payment_flow_voucher_price_not_found", { chosenPrice }));
            return { handled: true };
        }

        deleteUserState(sender);
        await processVoucherPurchase(sender, pushname, chosenPrice, reply, helpers, global);
        return { handled: true };
    }

    async function getAdminRecipients(globalScope = global) {
        const adminRecipients = new Set();

        if (globalScope.config?.ownerNumber && Array.isArray(globalScope.config.ownerNumber)) {
            globalScope.config.ownerNumber.forEach((num) => {
                if (num && num.trim()) {
                    adminRecipients.add(num.trim());
                }
            });
        }

        if (globalScope.accounts) {
            const adminAccounts = globalScope.accounts.filter((acc) =>
                ["admin", "owner", "superadmin"].includes(acc.role) &&
                acc.phone_number &&
                acc.phone_number.trim() !== ""
            );

            for (const admin of adminAccounts) {
                let adminJid = admin.phone_number.trim();
                if (!adminJid.endsWith("@s.whatsapp.net")) {
                    if (adminJid.startsWith("0")) {
                        adminJid = `62${adminJid.substring(1)}@s.whatsapp.net`;
                    } else if (adminJid.startsWith("62")) {
                        adminJid = `${adminJid}@s.whatsapp.net`;
                    } else {
                        continue;
                    }
                }
                adminRecipients.add(adminJid);
            }
        }

        return Array.from(adminRecipients);
    }

    async function notifyAdminsWithProof(request, proofPath, user, pushname = "", globalScope = global) {
        const adminUrl = `${globalScope.config?.site_url_bot || "http://localhost:3100"}/saldo-management`;
        const customerPhone = request.userId.replace("@s.whatsapp.net", "");
        const amount = `Rp ${request.amount.toLocaleString("id-ID")}`;
        const uploadTime = new Date().toLocaleString("id-ID");
        const adminMessage = renderResponseTemplate("payment_flow_topup_proof_admin_notification", {
            requestId: request.id,
            customerName: pushname || user.name || "Pelanggan",
            customerPhone,
            amount,
            paymentMethod: "Transfer Bank",
            uploadTime,
            adminUrl
        });

        const adminRecipients = await getAdminRecipients(globalScope);
        const mediaMessage = (proofPath.endsWith(".jpg") || proofPath.endsWith(".png"))
            ? { image: { url: proofPath }, caption: adminMessage }
            : { document: { url: proofPath }, fileName: path.basename(proofPath), caption: adminMessage };

        const adminDelivery = await deps.sendMessageToMany(adminRecipients, mediaMessage);
        if (adminDelivery.sent) {
            deps.logger.info("Admin notified with topup proof", { requestId: request.id, successCount: adminDelivery.successCount });
        } else {
            deps.logger.warn("Cannot notify admin - WhatsApp not connected", { requestId: request.id });
        }
    }

    async function handleTopupPaymentProof(msg, user, pushname = "", globalScope = global) {
        const sender = msg.key.remoteJid;
        const canonicalSender = await deps.normalizeJidForSaldo(sender, {
            allowLid: true,
            raf: deps.getSocket()
        }) || sender;

        try {
            deps.logger.info("[TOPUP_PROOF] Starting payment proof upload", {
                sender,
                canonicalSender,
                userId: user?.id,
                hasMessage: !!msg.message
            });

            let allUserRequests = deps.paymentRepository.getUserTopupRequests(canonicalSender);
            if (allUserRequests.length === 0 && canonicalSender !== sender) {
                allUserRequests = deps.paymentRepository.getUserTopupRequests(sender);
            }

            deps.logger.info("[TOPUP_PROOF] User topup requests found", {
                sender: canonicalSender,
                totalRequests: allUserRequests.length,
                requests: allUserRequests.map((r) => ({
                    id: r.id,
                    status: r.status,
                    method: r.paymentMethod,
                    hasProof: !!r.paymentProof
                }))
            });

            const pendingRequests = allUserRequests.filter((request) =>
                (request.status === "pending" || request.status === "waiting_verification") &&
                request.paymentMethod === "transfer"
            );

            if (pendingRequests.length === 0) {
                const message = deps.renderTemplate("topup_no_pending", {});
                await deps.sendMessage(sender, { text: message }, { skipDuplicateCheck: true });
                return;
            }

            const request = pendingRequests[0];
            if (!deps.getSocket()) {
                throw new Error("WhatsApp connection not available");
            }

            const buffer = await deps.downloadMedia(msg, "buffer", {});
            const proofDir = path.join(__dirname, "../temp/topup_proofs");
            if (!fs.existsSync(proofDir)) {
                fs.mkdirSync(proofDir, { recursive: true });
            }

            const fileExtension = msg.message.imageMessage ? "jpg" : "pdf";
            const fileName = `topup_${request.id}_${Date.now()}.${fileExtension}`;
            const filePath = path.join(proofDir, fileName);
            fs.writeFileSync(filePath, buffer);

            const isReupload = !!request.paymentProof;
            deps.paymentRepository.saveTopupProofUpdate(request, {
                fileName,
                uploadedAt: new Date().toISOString()
            });

            const uploadStatus = isReupload ? "diperbarui" : "diterima";
            const confirmMsg = renderResponseTemplate("payment_flow_topup_proof_received", {
                requestId: request.id,
                amount: `Rp ${request.amount.toLocaleString("id-ID")}`,
                uploadStatus,
                verificationStatus: "Menunggu Verifikasi Admin"
            });

            await deps.sendMessage(sender, { text: confirmMsg }, { skipDuplicateCheck: true });
            await notifyAdminsWithProof(request, filePath, user, pushname, globalScope);
        } catch (error) {
            deps.logger.error("[TOPUP_PROOF] CRITICAL ERROR - Failed to handle payment proof", {
                error: error.message,
                stack: error.stack,
                sender,
                userId: user?.id
            });

            await deps.sendMessage(sender, {
                text: renderResponseTemplate("payment_flow_topup_proof_upload_failed", {
                    errorMessage: error.message
                })
            }, { skipDuplicateCheck: true });
        }
    }

    return {
        deps,
        handleTopupSaldoPayment,
        handleBeliVoucher,
        processVoucherPurchase,
        handleVoucherChoiceState,
        handleTopupPaymentProof,
        notifyAdminsWithProof,
        getAdminRecipients
    };
}

module.exports = {
    createPaymentFlowService,
    defaultDeps
};
