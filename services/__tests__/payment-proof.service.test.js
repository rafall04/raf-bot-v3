"use strict";

const { createPaymentProofService } = require("../payment-proof.service");

function makeFakeRepo() {
    const records = [];
    return {
        records,
        create: jest.fn(async (rec, buffer, ext) => {
            const r = { ...rec, fileName: buffer ? `${rec.id}.${ext}` : undefined };
            records.push(r);
            return r;
        }),
        listPending: () => records.filter((r) => r.status === "pending"),
        getById: (id) => records.find((r) => r.id === id) || null,
        update: jest.fn(async (id, patch) => {
            const i = records.findIndex((r) => r.id === id);
            if (i < 0) return null;
            records[i] = { ...records[i], ...patch };
            return records[i];
        }),
        getFilePath: (rec) => (rec && rec.fileName ? `/x/${rec.fileName}` : null)
    };
}

function makeDeps(over = {}) {
    return {
        repository: makeFakeRepo(),
        getCurrentBillingPeriod: () => ({ periodMonth: 7, periodYear: 2026 }),
        getPaymentPositionForPeriod: jest.fn(async () => ({ outstanding: 150000, is_fully_paid: false, amount_due: 150000 })),
        getEffectivePrice: () => 150000,
        billSettlement: {
            settleTagihanPayment: jest.fn(async () => ({ ok: true, ledger: { action: "paid" }, reactivation: { attempted: false } }))
        },
        sendMessageToMany: jest.fn(async () => ({ sent: true, successCount: 1 })),
        sendCritical: jest.fn(async () => ({ delivered: true })),
        getAdminJids: () => ["628111@s.whatsapp.net"],
        findUserById: (id) => ({ id, name: "Budi", subscription: "10Mbps", phone_number: "628222", pppoe_username: "budi" }),
        getConfig: () => ({ site_url_bot: "http://x" }),
        logger: { error() {}, warn() {} },
        ...over
    };
}

const baseUser = { id: 5, name: "Budi", phone_number: "628222", subscription: "10Mbps" };

async function submit(svc, over = {}) {
    return svc.handleIncomingProof({
        user: baseUser,
        canonicalSender: "628222@s.whatsapp.net",
        pushname: "Budi",
        messageType: "imageMessage",
        buffer: Buffer.from("img"),
        caption: "",
        ...over
    });
}

describe("payment-proof.service handleIncomingProof", () => {
    test("menyimpan bukti pending, notif admin bergambar, dan mengembalikan ackText", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const res = await submit(svc);

        expect(res.record.status).toBe("pending");
        expect(res.record.userDbId).toBe(5);
        expect(res.record.periodMonth).toBe(7);
        expect(res.record.userId).toBe("628222@s.whatsapp.net");

        expect(deps.sendMessageToMany).toHaveBeenCalledTimes(1);
        const [recips, payload] = deps.sendMessageToMany.mock.calls[0];
        expect(recips).toEqual(["628111@s.whatsapp.net"]);
        expect(payload.image).toBeInstanceOf(Buffer);
        expect(payload.caption).toContain("BP-");
        expect(res.ackText).toMatch(/terima/i);
    });

    test("dokumen → payload document + fileType document", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const res = await submit(svc, { messageType: "documentMessage", buffer: Buffer.from("pdf") });
        const [, payload] = deps.sendMessageToMany.mock.calls[0];
        expect(payload.document).toBeInstanceOf(Buffer);
        expect(res.record.fileType).toBe("document");
    });

    test("notif admin gagal TIDAK menggagalkan pencatatan bukti", async () => {
        const deps = makeDeps({ sendMessageToMany: jest.fn(async () => { throw new Error("WA down"); }) });
        const svc = createPaymentProofService(deps);
        const res = await submit(svc);
        expect(res.record.status).toBe("pending");
    });
});

describe("payment-proof.service confirm/reject", () => {
    test("confirmProof: settle TRANSFER_BANK + struk saat ledger action 'paid'", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);

        const res = await svc.confirmProof(record.id, { adminName: "ana" });
        expect(res.ok).toBe(true);
        expect(deps.billSettlement.settleTagihanPayment).toHaveBeenCalledWith(
            expect.objectContaining({ paymentMethod: "TRANSFER_BANK", periodMonth: 7, periodYear: 2026 })
        );
        expect(deps.sendCritical).toHaveBeenCalledTimes(1);
        const [jid, payload] = deps.sendCritical.mock.calls[0];
        expect(jid).toBe("628222@s.whatsapp.net");
        expect(payload).toHaveProperty("text");
        expect(res.record.status).toBe("confirmed");
        expect(res.record.verifiedBy).toBe("ana");
    });

    test("confirmProof: ledger 'no_change' → tandai confirmed tanpa struk ganda", async () => {
        const deps = makeDeps({
            billSettlement: { settleTagihanPayment: jest.fn(async () => ({ ok: true, ledger: { action: "no_change" }, reactivation: null })) }
        });
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);
        const res = await svc.confirmProof(record.id);
        expect(res.ok).toBe(true);
        expect(res.alreadyPaid).toBe(true);
        expect(deps.sendCritical).not.toHaveBeenCalled();
        expect(res.record.status).toBe("confirmed");
    });

    test("confirmProof: record non-pending ditolak (idempoten)", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);
        await svc.confirmProof(record.id);
        const again = await svc.confirmProof(record.id);
        expect(again.ok).toBe(false);
        expect(again.reason).toBe("already_processed");
    });

    test("confirmProof: settle gagal (fail-closed) → record tetap pending", async () => {
        const deps = makeDeps({
            billSettlement: { settleTagihanPayment: jest.fn(async () => { throw new Error("ledger fail"); }) }
        });
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);
        const res = await svc.confirmProof(record.id);
        expect(res.ok).toBe(false);
        expect(res.reason).toBe("settle_failed");
        expect(svc.getById(record.id).status).toBe("pending");
    });

    test("rejectProof: tandai rejected + beri tahu pelanggan", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);
        const res = await svc.rejectProof(record.id, { adminName: "ana", reason: "buram" });
        expect(res.ok).toBe(true);
        expect(res.record.status).toBe("rejected");
        expect(res.record.notes).toBe("buram");
        expect(deps.sendCritical).toHaveBeenCalledTimes(1);
    });

    test("confirm/reject id tak dikenal → not_found", async () => {
        const svc = createPaymentProofService(makeDeps());
        expect((await svc.confirmProof("nope")).reason).toBe("not_found");
        expect((await svc.rejectProof("nope")).reason).toBe("not_found");
    });
});
