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
const {
    voucherMultiBuyConfig,
    voucherCustomCredsConfig,
    normalizeVoucherUsername,
    normalizeVoucherPassword,
    assertVoucherUsernameAvailable,
} = require("../lib/voucher-fulfillment");
const { cekHotspotUser } = require("../lib/mikrotik");
const { withMikrotikKeyLock } = require("../lib/mikrotik/core");

function renderResponseTemplate(key, data = {}, fallback = "") {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found && result.text.trim() ? result.text : (fallback || key);
}

// Recorder voucher orphan dipindah ke modul bersama supaya jalur callback (routes/public.js)
// dan jalur saldo (di sini) memakai pencatatan yang sama.
const { recordVoucherOrphan } = require("../lib/voucher-orphan");

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
        // Pengiriman kritis (kode voucher) — retry + dead-letter, tidak hilang diam-diam.
        sendCritical: require("../lib/whatsapp-critical-delivery").sendCritical,
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
        // Pesan format MENGIKUTI command yang diketik — `buynow` (voucher instan QRIS) tidak
        // sama dengan `topup` (isi saldo). Sebelumnya selalu menyuruh "topup 10000" walau user
        // mengetik buynow → membingungkan.
        if (!q) {
            throw command === "buynow"
                ? renderResponseTemplate(
                    "buynow_usage", {},
                    "🎟️ *Beli Voucher Instan (bayar QRIS)*\n\nFormat: *buynow [harga]* — 1 voucher\nBeli banyak sekaligus: *buynow [harga] [jumlah]*\nContoh: _*buynow 1000*_ atau _*buynow 1000 3*_\n\n💡 Lihat daftar harga: ketik *voucher*\n\nVoucher otomatis terkirim begitu pembayaran lunas — tidak perlu topup saldo dulu."
                )
                : renderResponseTemplate(
                    "topup_usage", {},
                    "💳 *Topup Saldo*\n\nFormat: *topup [nominal]*\nContoh: *topup 10000*\nMinimal Rp 1.000."
                );
        }

        let number = parseInt(q, 10);
        if (command === "topup" && (Number.isNaN(number) || number < 1000 || number > 1_000_000)) {
            throw "Jumlah topup invalid!\nMinimum topup Rp. 1000 & Maksimal topup Rp. 1.000.000";
        }

        const reff = Math.floor(Math.random() * 1677721631342).toString(16);
        let profvc = checkprofvc(q);
        let qty = 1;
        let customUser = null, customPass = null;

        if (command === "buynow") {
            // Format: `buynow <harga> [jumlah | username [password]]` (#b402 + custom creds).
            // Argumen ke-2 NUMERIK = jumlah voucher (gate voucherMultiPurchase); NON-numerik
            // = username kustom (argumen ke-3 opsional = password; gate voucherCustomCreds).
            const parts = String(q).trim().split(/\s+/);
            if (parts.length > 3) {
                throw renderResponseTemplate(
                    "buynow_usage", {},
                    "🎟️ *Beli Voucher Instan (bayar QRIS)*\n\nFormat: *buynow [harga]* — 1 voucher\nBeli banyak sekaligus: *buynow [harga] [jumlah]*\nUsername sendiri: *buynow [harga] [username] [password]*\nContoh: _*buynow 1000*_ , _*buynow 1000 3*_ , _*buynow 1000 adi rahasia123*_\n\n💡 Lihat daftar harga: ketik *voucher*\n\nVoucher otomatis terkirim begitu pembayaran lunas — tidak perlu topup saldo dulu."
                );
            }
            const hargaArg = parts[0];
            const extraArg = parts.length > 1 ? parts[1] : null;
            const extraArg2 = parts.length > 2 ? parts[2] : null;
            if (!checkhargavoucher(hargaArg)) {
                throw "Harga Voucher Tersebut Tidak Terdaftar. Silahkan Periksa Lagi.\n\nTerima Kasih";
            }
            profvc = checkprofvc(hargaArg);
            if (extraArg != null && /^\d+$/.test(extraArg)) {
                if (extraArg2 != null) {
                    throw renderResponseTemplate(
                        "buynow_usage", {},
                        "🎟️ *Beli Voucher Instan (bayar QRIS)*\n\nFormat: *buynow [harga]* — 1 voucher\nBeli banyak sekaligus: *buynow [harga] [jumlah]*\nUsername sendiri: *buynow [harga] [username] [password]*\nContoh: _*buynow 1000*_ , _*buynow 1000 3*_ , _*buynow 1000 adi rahasia123*_\n\n💡 Lihat daftar harga: ketik *voucher*\n\nVoucher otomatis terkirim begitu pembayaran lunas — tidak perlu topup saldo dulu."
                    );
                }
                const multi = voucherMultiBuyConfig(global.config);
                const qtyArg = extraArg;
                if (parseInt(qtyArg, 10) < 1 || parseInt(qtyArg, 10) > multi.maxQty) {
                    throw renderResponseTemplate(
                        "buynow_qty_invalid", { maks: multi.maxQty },
                        `❌ Jumlah voucher tidak valid.\n\nFormat: *buynow [harga] [jumlah]* — jumlah 1 sampai ${multi.maxQty} voucher per transaksi.\nContoh: _*buynow 1000 3*_`
                    );
                }
                qty = parseInt(qtyArg, 10);
                if (qty > 1 && !multi.enabled) {
                    throw renderResponseTemplate(
                        "buynow_multi_disabled", {},
                        "🎟️ Pembelian lebih dari 1 voucher dalam sekali transaksi belum tersedia.\n\nKetik *buynow [harga]* untuk beli 1 voucher — bisa diulang untuk voucher berikutnya."
                    );
                }
            } else if (extraArg != null) {
                // Jalur username kustom — qty tetap 1 (keputusan produk: kustom hanya 1 voucher).
                if (!voucherCustomCredsConfig(global.config).enabled) {
                    throw renderResponseTemplate(
                        "buynow_custom_disabled", {},
                        "🎟️ Voucher dengan username sendiri belum tersedia.\n\nKetik *buynow [harga]* untuk voucher dengan kode acak."
                    );
                }
                const uname = normalizeVoucherUsername(extraArg);
                if (!uname) {
                    throw renderResponseTemplate(
                        "voucher_username_invalid", {},
                        "❌ Username tidak valid.\n\nHanya huruf kecil/angka plus tanda - dan _ (3-16 karakter).\nContoh: _*buynow 1000 adi_* atau _*buynow 1000 adi rahasia123*_"
                    );
                }
                const pass = normalizeVoucherPassword(extraArg2);
                if (extraArg2 != null && !pass) {
                    throw renderResponseTemplate(
                        "voucher_password_invalid", {},
                        "❌ Password tidak valid — 3-64 karakter tanpa spasi.\n\nContoh: _*buynow 1000 adi rahasia123*_"
                    );
                }
                // Cek duplikat + reservasi dibungkus lock per-username: dua pelanggan yang
                // checkout bersamaan tak bisa sama-sama lolos pre-check. Charge iPaymu ikut
                // di dalam lock supaya record reservasi pasti dibuat sebelum lock lepas.
                const lockKey = `voucher-custom:${uname}`;
                const availability = await withMikrotikKeyLock(lockKey, () =>
                    assertVoucherUsernameAvailable({
                        payments: global.payment,
                        cekHotspotUser,
                        username: uname,
                    })
                );
                if (!availability.ok) {
                    throw renderResponseTemplate(
                        availability.reason === "check_failed" ? "voucher_username_check_failed" : "voucher_username_taken",
                        { username: availability.username || uname },
                        availability.message || "Username sudah dipakai. Pilih username lain."
                    );
                }
                customUser = availability.username;
                customPass = pass || availability.username;
            }
            number = (parseInt(checkhargavc(profvc), 10) || 0) * qty;
        }

        const paymentGateway = pay || deps.pay || createNotImplemented("paymentFlow.pay");
        const createPaymentRequest = addPayment || deps.paymentRepository.createPaymentRequest.bind(deps.paymentRepository);

        // Ack instan: pembuatan QR ke iPaymu bisa makan beberapa detik (apalagi bila koneksi
        // pertama perlu retry), jadi beri tahu pelanggan agar tidak merasa pesannya "ngambang".
        // Best-effort — kegagalan kirim ack TIDAK boleh menggagalkan pembelian.
        try {
            const ackText = renderResponseTemplate(
                "payment_processing_ack", {},
                "⏳ Sebentar ya, kami sedang menyiapkan pembayaran QRIS-mu..."
            );
            await deps.sendMessage(from, { text: ackText }, { quoted: msg, skipDuplicateCheck: true });
        } catch (ackErr) {
            deps.logger?.warn?.("[BUYNOW] Gagal kirim ack proses", { error: ackErr?.message });
        }

        // Charge gateway + catat record pembayaran. Untuk username kustom fungsi ini
        // dipanggil DI DALAM lock per-username (lihat bawah) supaya reservasi — yaitu
        // record payment itu sendiri — pasti tertulis sebelum lock dilepas; dua pelanggan
        // yang checkout bersamaan tak bisa sama-sama lolos pre-check.
        const chargeAndRecord = async () => {
            let res;
            try {
                res = await paymentGateway({
                    amount: number,
                    reffId: reff,
                    comment: command === "topup"
                        ? `Topup dana saldo sebesar Rp. ${number}`
                        : `pembelian voucher ${profvc}${qty > 1 ? ` x${qty}` : ''} sebesar Rp. ${number}`,
                    name: pushname,
                    phone: sender.split("@")[0],
                    email: sender
                });
            } catch (gwErr) {
                const technical = (typeof gwErr === "string") ? gwErr : (gwErr?.message || String(gwErr));
                deps.logger?.warn?.("[BUYNOW] Gateway pembayaran gagal", { command, number, error: technical });
                // Pesan ramah ke pelanggan — bukan error teknis "timeout 12000ms". Retry koneksi
                // sudah dilakukan di lib/ipaymu; bila tetap gagal, minta pelanggan ulangi sebentar lagi.
                // Throw STRING (konvensi codebase: pesan string langsung di-reply ke user).
                throw renderResponseTemplate(
                    "payment_gateway_busy", {},
                    "🙏 Maaf, sistem pembayaran sedang sibuk sesaat. Coba ketik ulang perintahmu beberapa saat lagi ya."
                );
            }

            const text = deps.renderTemplate("qris_payment_info", {
                sub_total: res.subTotal.toLocaleString("id-ID"),
                biaya_admin: res.fee.toLocaleString("id-ID"),
                total_bayar: res.total.toLocaleString("id-ID")
            });

            // `buynow` (voucher instan): simpan `prof` yang dipilih pembeli di record. Callback
            // fulfillment (payment-callback.js) memakainya — checkprofvc(harga) tertukar bila dua
            // paket berharga sama. Pola sama dengan buynowweb/buynowpanel yang sudah simpan prof.
            // `qty` ikut disimpan (#b402) — callback menerbitkan voucher sebanyak itu (record lama = 1).
            // `customUser`/`customPass` ikut tersimpan → record sekaligus reservasi username.
            const paymentOpts = command === "buynow" ? { prof: profvc, qty, ...(customUser ? { customUser, customPass } : {}) } : {};
            await createPaymentRequest(reff, res.id, sender, command, number, "QRIS", `Topup ${number} to ${sender}`, paymentOpts);

            const qrr = qr.imageSync(res.qrString, { type: "png", ec_level: "H" });
            await deps.sendMessage(from, { image: qrr, caption: text }, { quoted: msg, skipDuplicateCheck: true });
        };

        if (customUser) {
            // Lock mencakup RE-CEK ketersediaan + charge + tulis record: celah antara
            // pre-check awal (saat parse argumen) dan pembuatan record tak bisa disusupi
            // checkout lain dengan username yang sama.
            await withMikrotikKeyLock(`voucher-custom:${customUser}`, async () => {
                const chk = await assertVoucherUsernameAvailable({
                    payments: global.payment,
                    cekHotspotUser,
                    username: customUser,
                });
                if (!chk.ok) {
                    throw renderResponseTemplate(
                        chk.reason === "check_failed" ? "voucher_username_check_failed" : "voucher_username_taken",
                        { username: chk.username || customUser },
                        chk.message || "Username sudah dipakai. Pilih username lain."
                    );
                }
                await chargeAndRecord();
            });
        } else {
            await chargeAndRecord();
        }
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

            // Voucher SUDAH dibuat di MikroTik. Potong saldo sekarang. Kalau GAGAL,
            // voucher jadi orphan (ada di MikroTik, belum dibayar). Catat untuk
            // rekonsiliasi admin + JANGAN kirim kode (pelanggan belum bayar) — hindari
            // bocor voucher gratis diam-diam. Saldo pelanggan tidak terpotong.
            //
            // PENTING: confirmATM/deductSaldo menandai KEGAGALAN lewat nilai kembalian false
            // (saldo kurang akibat pembelian paralel, DB sibuk/terkunci SQLITE_BUSY, error
            // commit) — BUKAN throw. Jadi WAJIB cek boolean-nya. Tetap bungkus try/catch agar
            // jika suatu saat helper berubah jadi melempar, kita tetap masuk jalur orphan dan
            // TIDAK mengirim voucher gratis.
            let deducted = false;
            let deductErrorMessage = "deduct_failed";
            try {
                deducted = await confirmATM(sender, hargavc123);
            } catch (deductErr) {
                deductErrorMessage = deductErr?.message || "deduct_failed";
            }
            if (!deducted) {
                recordVoucherOrphan({
                    sender: sender.split("@")[0],
                    voucherCode,
                    profile: profvc123,
                    price: hargavc123,
                    reason: deductErrorMessage
                });
                deps.logger?.error?.("[VOUCHER_ORPHAN] Saldo gagal dipotong setelah voucher dibuat", {
                    sender: sender.split("@")[0], voucherCode, error: deductErrorMessage
                });
                await replyFunc(renderResponseTemplate("payment_flow_voucher_purchase_failure", {
                    errorMessage: "Terjadi kendala saat memproses pembayaran. Saldo Anda TIDAK terpotong. Mohon coba lagi atau hubungi Admin."
                }));
                return;
            }
            const currentSaldoAfterPurchase = await checkATMuser(sender);
            const formattedSaldoAfterPurchase = convertRupiah.convert(currentSaldoAfterPurchase);

            const successText = renderResponseTemplate("payment_flow_voucher_purchase_success", {
                packageName: durasivc123,
                voucherCode,
                remainingBalance: formattedSaldoAfterPurchase,
                serviceName: globalScope.config.nama
            });

            // KRITIS: saldo sudah terpotong + voucher sudah dibuat. Kode HARUS sampai
            // ke pelanggan. Kirim via sendCritical (retry + dead-letter) — kalau gagal
            // total, kode tersimpan di dead-letter untuk relay admin, tidak hilang.
            const delivery = await deps.sendCritical(sender, { text: successText }, { label: "voucher_code" });
            if (!delivery.delivered) {
                deps.logger?.error?.("[VOUCHER] Kode voucher gagal terkirim, tersimpan di dead-letter", {
                    sender: sender.split("@")[0],
                    voucherCode,
                    errorCode: delivery.errorCode,
                });
            }
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
