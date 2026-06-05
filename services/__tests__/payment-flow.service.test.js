/**
 * Header Doc
 * Purpose: Memverifikasi service payment flow menjadi owner orchestration bot-side untuk create request dan proof upload.
 * Caller: Jest test runner.
 * Deps: `../payment-flow.service`.
 * MainFuncs: Menguji create request topup, prompt voucher choice, lookup/update proof topup, dan template custom outbound WA payment flow.
 * SideEffects: Tidak ada; seluruh dependency dimock in-memory.
 */
"use strict";

const { createPaymentFlowService } = require("../payment-flow.service");
const templateService = require("../../lib/template-service");

const originalResponseTemplates = templateService.cache.responseTemplates;

function setResponseTemplate(key, template) {
    templateService.cache.responseTemplates[key] = {
        name: key,
        category: "payment",
        template
    };
}

describe("payment-flow.service", () => {
    beforeEach(() => {
        templateService.cache.responseTemplates = { ...originalResponseTemplates };
    });

    afterEach(() => {
        templateService.cache.responseTemplates = originalResponseTemplates;
    });

    test("handleTopupSaldoPayment uses injected payment repository create request", async () => {
        const createPaymentRequest = jest.fn().mockResolvedValue(undefined);
        const sendMessage = jest.fn().mockResolvedValue(undefined);
        const service = createPaymentFlowService({
            paymentRepository: {
                createPaymentRequest,
                getUserTopupRequests: jest.fn(),
                getPendingTransferTopupRequests: jest.fn(),
                saveTopupProofUpdate: jest.fn()
            },
            renderTemplate: jest.fn().mockReturnValue("QRIS info"),
            sendMessage,
            pay: jest.fn().mockResolvedValue({
                id: "TRX-1",
                subTotal: 10000,
                fee: 500,
                total: 10500,
                qrString: "QR-STRING"
            })
        });

        await service.handleTopupSaldoPayment({
            sender: "6281@s.whatsapp.net",
            pushname: "Tester",
            command: "topup",
            q: "10000",
            from: "6281@s.whatsapp.net",
            msg: {},
            checkprofvc: jest.fn(),
            checkhargavoucher: jest.fn(),
            checkhargavc: jest.fn()
        });

        expect(createPaymentRequest).toHaveBeenCalledWith(
            expect.any(String),
            "TRX-1",
            "6281@s.whatsapp.net",
            "topup",
            10000,
            "QRIS",
            "Topup 10000 to 6281@s.whatsapp.net"
        );
        expect(sendMessage).toHaveBeenCalled();
    });

    test("handleTopupPaymentProof uses repository pending lookup and proof update", async () => {
        const request = {
            id: "REQ-1",
            amount: 15000,
            userId: "6281@s.whatsapp.net",
            paymentMethod: "transfer",
            status: "pending"
        };
        const getPendingTransferTopupRequests = jest
            .fn()
            .mockReturnValueOnce([request])
            .mockReturnValueOnce([request]);
        const saveTopupProofUpdate = jest.fn().mockImplementation((req) => req);
        const sendMessage = jest.fn().mockResolvedValue({ sent: true });
        const sendMessageToMany = jest.fn().mockResolvedValue({ sent: true, successCount: 1 });
        const service = createPaymentFlowService({
            paymentRepository: {
                createPaymentRequest: jest.fn(),
                getUserTopupRequests: jest.fn().mockReturnValue([request]),
                getPendingTransferTopupRequests,
                saveTopupProofUpdate
            },
            normalizeJidForSaldo: jest.fn().mockResolvedValue("6281@s.whatsapp.net"),
            getSocket: jest.fn().mockReturnValue({}),
            downloadMedia: jest.fn().mockResolvedValue(Buffer.from("proof")),
            sendMessage,
            sendMessageToMany,
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        await service.handleTopupPaymentProof({
            key: { remoteJid: "6281@s.whatsapp.net" },
            message: { imageMessage: {} }
        }, { id: 1, name: "Tester" }, "Tester", {
            config: { ownerNumber: [], site_url_bot: "http://localhost:3100" },
            accounts: []
        });

        expect(saveTopupProofUpdate).toHaveBeenCalledWith(
            request,
            expect.objectContaining({
                fileName: expect.stringContaining("topup_REQ-1_"),
                uploadedAt: expect.any(String)
            })
        );
        expect(sendMessage).toHaveBeenCalled();
        expect(sendMessageToMany).toHaveBeenCalled();
    });

    test("handleTopupPaymentProof renders custom response templates for customer and admin WA messages", async () => {
        setResponseTemplate("payment_flow_topup_proof_received", "CUSTOM_PROOF_RECEIVED ${requestId} ${amount} ${uploadStatus}");
        setResponseTemplate("payment_flow_topup_proof_admin_notification", "CUSTOM_ADMIN_PROOF ${requestId} ${customerName} ${customerPhone} ${amount} ${adminUrl}");

        const request = {
            id: "REQ-CUSTOM",
            amount: 25000,
            userId: "6281@s.whatsapp.net",
            paymentMethod: "transfer",
            status: "pending"
        };
        const sendMessage = jest.fn().mockResolvedValue({ sent: true });
        const sendMessageToMany = jest.fn().mockResolvedValue({ sent: true, successCount: 1 });
        const service = createPaymentFlowService({
            paymentRepository: {
                createPaymentRequest: jest.fn(),
                getUserTopupRequests: jest.fn().mockReturnValue([request]),
                getPendingTransferTopupRequests: jest.fn(),
                saveTopupProofUpdate: jest.fn()
            },
            normalizeJidForSaldo: jest.fn().mockResolvedValue("6281@s.whatsapp.net"),
            getSocket: jest.fn().mockReturnValue({}),
            downloadMedia: jest.fn().mockResolvedValue(Buffer.from("proof")),
            sendMessage,
            sendMessageToMany,
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        await service.handleTopupPaymentProof({
            key: { remoteJid: "6281@s.whatsapp.net" },
            message: { imageMessage: {} }
        }, { id: 1, name: "Tester User" }, "Tester Push", {
            config: { ownerNumber: ["6282"], site_url_bot: "https://admin.test" },
            accounts: []
        });

        expect(sendMessage).toHaveBeenCalledWith(
            "6281@s.whatsapp.net",
            { text: "CUSTOM_PROOF_RECEIVED REQ-CUSTOM Rp 25.000 diterima" },
            { skipDuplicateCheck: true }
        );
        expect(sendMessageToMany).toHaveBeenCalledWith(
            ["6282"],
            expect.objectContaining({
                caption: "CUSTOM_ADMIN_PROOF REQ-CUSTOM Tester Push 6281 Rp 25.000 https://admin.test/saldo-management"
            })
        );
    });

    test("handleTopupPaymentProof renders custom failure template when upload fails", async () => {
        setResponseTemplate("payment_flow_topup_proof_upload_failed", "CUSTOM_PROOF_FAILED ${errorMessage}");

        const request = {
            id: "REQ-FAIL",
            amount: 25000,
            userId: "6281@s.whatsapp.net",
            paymentMethod: "transfer",
            status: "pending"
        };
        const sendMessage = jest.fn().mockResolvedValue({ sent: true });
        const service = createPaymentFlowService({
            paymentRepository: {
                createPaymentRequest: jest.fn(),
                getUserTopupRequests: jest.fn().mockReturnValue([request]),
                getPendingTransferTopupRequests: jest.fn(),
                saveTopupProofUpdate: jest.fn()
            },
            normalizeJidForSaldo: jest.fn().mockResolvedValue("6281@s.whatsapp.net"),
            getSocket: jest.fn().mockReturnValue({}),
            downloadMedia: jest.fn().mockRejectedValue(new Error("download failed")),
            sendMessage,
            sendMessageToMany: jest.fn(),
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
        });

        await service.handleTopupPaymentProof({
            key: { remoteJid: "6281@s.whatsapp.net" },
            message: { imageMessage: {} }
        }, { id: 1, name: "Tester User" }, "Tester Push", {
            config: { ownerNumber: [], site_url_bot: "https://admin.test" },
            accounts: []
        });

        expect(sendMessage).toHaveBeenCalledWith(
            "6281@s.whatsapp.net",
            { text: "CUSTOM_PROOF_FAILED download failed" },
            { skipDuplicateCheck: true }
        );
    });

    test("handleBeliVoucher sets voucher-choice state and replies with catalog prompt", async () => {
        const setUserState = jest.fn();
        const reply = jest.fn().mockResolvedValue(undefined);
        const service = createPaymentFlowService({
            paymentRepository: {
                createPaymentRequest: jest.fn(),
                getUserTopupRequests: jest.fn(),
                getPendingTransferTopupRequests: jest.fn(),
                saveTopupProofUpdate: jest.fn()
            }
        });

        await service.handleBeliVoucher({
            sender: "6281@s.whatsapp.net",
            pushname: "Tester",
            entities: {},
            q: "",
            reply,
            setUserState,
            global: {
                voucher: [
                    { namavc: "Voucher 1 Jam", durasivc: "1 Jam", hargavc: "1000" }
                ]
            },
            helpers: {}
        });

        expect(setUserState).toHaveBeenCalledWith("6281@s.whatsapp.net", expect.objectContaining({
            step: "ASK_VOUCHER_CHOICE",
            flow: "payment"
        }));
        expect(reply).toHaveBeenCalledWith(expect.stringContaining("Pilihan Voucher Tersedia"));
    });

    test("processVoucherPurchase renders custom response templates for invalid and successful purchase replies", async () => {
        setResponseTemplate("payment_flow_voucher_price_not_found", "CUSTOM_VOUCHER_NOT_FOUND ${chosenPrice}");
        setResponseTemplate("payment_flow_voucher_purchase_processing", "CUSTOM_VOUCHER_PROCESSING");
        setResponseTemplate("payment_flow_voucher_purchase_success", "CUSTOM_VOUCHER_SUCCESS ${voucherCode} ${packageName}");

        const reply = jest.fn();
        // Kode voucher (pesan sukses) sekarang dikirim via sendCritical (retry +
        // dead-letter), BUKAN reply biasa — supaya kode tidak hilang diam-diam.
        const sendCritical = jest.fn().mockResolvedValue({ delivered: true, attempts: 1 });
        const service = createPaymentFlowService({ sendCritical });
        const helpers = {
            checkhargavoucher: jest.fn((price) => price === "1000"),
            checkprofvc: jest.fn(() => "VC-1"),
            checkdurasivc: jest.fn(() => "1 Jam"),
            checkhargavc: jest.fn(() => 1000),
            checkATMuser: jest.fn().mockResolvedValueOnce(5000).mockResolvedValueOnce(4000),
            confirmATM: jest.fn().mockResolvedValue(undefined),
            getvoucher: jest.fn().mockResolvedValue({ ok: true, data: { username: "VCR123" } })
        };

        await service.processVoucherPurchase("6281@s.whatsapp.net", "Tester", "9999", reply, helpers, {
            config: { nama: "RAF Test" }
        });
        expect(reply).toHaveBeenLastCalledWith("CUSTOM_VOUCHER_NOT_FOUND 9999");

        await service.processVoucherPurchase("6281@s.whatsapp.net", "Tester", "1000", reply, helpers, {
            config: { nama: "RAF Test" }
        });
        expect(reply).toHaveBeenCalledWith("CUSTOM_VOUCHER_PROCESSING");
        // Kode voucher dikirim via sendCritical, bukan reply.
        expect(sendCritical).toHaveBeenCalledWith(
            "6281@s.whatsapp.net",
            { text: "CUSTOM_VOUCHER_SUCCESS VCR123 1 Jam" },
            expect.objectContaining({ label: "voucher_code" })
        );
    });

    test("processVoucherPurchase: voucher dibuat tapi confirmATM GAGAL → kode TIDAK dikirim (anti orphan free voucher)", async () => {
        setResponseTemplate("payment_flow_voucher_purchase_processing", "PROC");
        setResponseTemplate("payment_flow_voucher_purchase_failure", "FAIL ${errorMessage}");

        const reply = jest.fn();
        const sendCritical = jest.fn().mockResolvedValue({ delivered: true });
        const service = createPaymentFlowService({ sendCritical });
        const helpers = {
            checkhargavoucher: jest.fn(() => true),
            checkprofvc: jest.fn(() => "VC-1"),
            checkdurasivc: jest.fn(() => "1 Jam"),
            checkhargavc: jest.fn(() => 1000),
            checkATMuser: jest.fn().mockResolvedValue(5000),
            // Deduct GAGAL setelah voucher dibuat.
            confirmATM: jest.fn().mockRejectedValue(new Error("DB locked")),
            getvoucher: jest.fn().mockResolvedValue({ ok: true, data: { username: "ORPHAN1" } })
        };

        await service.processVoucherPurchase("6281@s.whatsapp.net", "Tester", "1000", reply, helpers, {
            config: { nama: "RAF Test" }
        });

        // Kode voucher TIDAK dikirim (pelanggan belum bayar — hindari voucher gratis).
        expect(sendCritical).not.toHaveBeenCalled();
        // Pelanggan diberi tahu gagal + saldo tidak terpotong.
        expect(reply).toHaveBeenLastCalledWith(expect.stringContaining("TIDAK terpotong"));
    });
});
