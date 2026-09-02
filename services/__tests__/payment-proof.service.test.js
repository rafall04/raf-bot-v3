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
        softDelete: jest.fn(async (id, patch) => {
            const i = records.findIndex((r) => r.id === id);
            if (i < 0) return null;
            records[i] = { ...records[i], ...patch, fileName: null };
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
        // Struk KANONIK (tagihan_struk_lunas), bukan template khusus bukti-bayar: harus berbentuk
        // struk, memakai kode bukti sebagai nomor rujukan, dan menyebut metode Transfer Bank.
        expect(payload.text).toContain("STRUK PEMBAYARAN");
        expect(payload.text).toContain(record.id);
        expect(payload.text).toContain("Transfer Bank");
        expect(payload.text).not.toMatch(/\$\{[a-z_]+\}/i);
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

describe("payment-proof.service evaluateIntake (GERBANG — sebelum apa pun disimpan)", () => {
    test("ada tagihan → capture, snapshot tagihan ikut dikembalikan", async () => {
        const svc = createPaymentProofService(makeDeps());
        const res = await svc.evaluateIntake({ user: baseUser, caption: "" });
        expect(res.action).toBe("capture");
        expect(res.billing.outstanding).toBe(150000);
        expect(res.ackText).toBeNull();
    });

    test("TAK ada tagihan → neutral + ack yang TIDAK menyebut pembayaran (insiden Lapak RT 15)", async () => {
        const deps = makeDeps({
            getPaymentPositionForPeriod: jest.fn(async () => ({ outstanding: 0, is_fully_paid: true, amount_due: 150000 }))
        });
        const svc = createPaymentProofService(deps);
        const res = await svc.evaluateIntake({ user: baseUser, caption: "" });

        expect(res.action).toBe("neutral");
        expect(res.reason).toBe("tak-ada-tagihan");
        // Inti misleading-nya ada di KALIMAT, bukan di record. Template tersimpan pun harus bersih.
        expect(res.ackText).not.toMatch(/bayar|pembayaran/i);
        expect(res.ackText).not.toMatch(/\$\{[a-z_]+\}/i);
    });

    test("admin sedang menangani chat → silent, dan tagihan TIDAK di-query sama sekali", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const res = await svc.evaluateIntake({ user: baseUser, adminActive: true });

        expect(res.action).toBe("silent");
        expect(res.ackText).toBeNull();
        expect(deps.getPaymentPositionForPeriod).not.toHaveBeenCalled();
    });

    test("snapshot tagihan MELEMPAR → neutral (buta ≠ nol), tidak pernah capture", async () => {
        const deps = makeDeps({
            getPaymentPositionForPeriod: jest.fn(async () => { throw new Error("db down"); })
        });
        const svc = createPaymentProofService(deps);
        const res = await svc.evaluateIntake({ user: baseUser });
        expect(res.action).toBe("neutral");
        expect(res.reason).toBe("tagihan-tak-diketahui");
    });

    test("caption keluhan → complaint + ack mengarahkan ke lapor", async () => {
        const svc = createPaymentProofService(makeDeps());
        const res = await svc.evaluateIntake({ user: baseUser, caption: "internet lemot mas" });
        expect(res.action).toBe("complaint");
        expect(res.ackText).toMatch(/lapor/i);
        expect(res.ackText).not.toMatch(/\$\{[a-z_]+\}/i);
    });
});

describe("payment-proof.service notif admin (3 aksi + saran ikut bukti)", () => {
    test("BELUM LUNAS → notif mengiklankan ok / tolak / HAPUS", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        await submit(svc);

        const [, payload] = deps.sendMessageToMany.mock.calls[0];
        // Bug yang ditemukan owner: aksi `hapus` SUDAH jalan di WA sejak #b144, tapi notifnya tidak
        // pernah menyebutnya — admin hanya diberi tahu `ok` dan `tolak`. Web punya 3 tombol, WA 2.
        expect(payload.caption).toMatch(/\bok\b/i);
        expect(payload.caption).toMatch(/tolak/i);
        expect(payload.caption).toMatch(/hapus/i);
        expect(payload.caption).not.toMatch(/\$\{[a-z_]+\}/i);
    });

    test("SUDAH LUNAS → notif MEMIMPIN dengan hapus, bukan mengundang 'ok' refleks", async () => {
        const deps = makeDeps({
            getPaymentPositionForPeriod: jest.fn(async () => ({ outstanding: 0, is_fully_paid: true, amount_due: 150000 }))
        });
        const svc = createPaymentProofService(deps);
        // Jalur ini hanya tercapai lewat "bayar di muka" (caption menyebut transfer) — gerbang intake
        // sudah menahan yang caption-nya polos.
        await submit(svc, { caption: "sudah transfer buat bulan depan", advance: true });

        const [, payload] = deps.sendMessageToMany.mock.calls[0];
        expect(payload.caption).toMatch(/tidak punya tagihan terbuka/i);
        expect(payload.caption).toMatch(/hapus/i);
    });
});

describe("payment-proof.service confirmProof — menolak melunasi yang tidak terutang", () => {
    test("pelanggan sudah lunas → no_outstanding, ledger TIDAK disentuh, record tetap pending", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);

        // Antara submit & konfirmasi, tagihannya sudah lunas (mis. ditarik teknisi / bukan bukti bayar).
        deps.getPaymentPositionForPeriod.mockImplementation(async () => ({
            outstanding: 0, is_fully_paid: true, amount_due: 150000
        }));

        const res = await svc.confirmProof(record.id, { adminName: "ana" });

        expect(res.ok).toBe(false);
        expect(res.reason).toBe("no_outstanding");
        // Dulu record semacam ini tetap dibalik jadi "confirmed" (ledger no_change) → antrian berbohong.
        expect(svc.getById(record.id).status).toBe("pending");
        expect(deps.billSettlement.settleTagihanPayment).not.toHaveBeenCalled();
        expect(deps.sendCritical).not.toHaveBeenCalled();
    });

    test("cek tagihan gagal → JANGAN blokir admin (settle sendiri sudah idempoten & fail-closed)", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);

        deps.getPaymentPositionForPeriod.mockImplementation(async () => { throw new Error("db down"); });

        const res = await svc.confirmProof(record.id);
        expect(res.ok).toBe(true);
        expect(deps.billSettlement.settleTagihanPayment).toHaveBeenCalled();
    });
});

describe("payment-proof.service deleteProof (bukti palsu — tanpa menyentuh pelanggan)", () => {
    test("soft-delete: status 'deleted' + TIDAK ada notifikasi/settle ke pelanggan", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);

        const res = await svc.deleteProof(record.id, { adminName: "ana", reason: "foto keluhan" });

        expect(res.ok).toBe(true);
        expect(res.record.status).toBe("deleted");
        expect(res.record.verifiedBy).toBe("ana");
        expect(res.record.notes).toBe("foto keluhan");
        expect(deps.repository.softDelete).toHaveBeenCalledTimes(1);
        // INTI FITUR: hapus ≠ tolak — pelanggan tak dikirimi apa pun & ledger tak disentuh.
        expect(deps.sendCritical).not.toHaveBeenCalled();
        expect(deps.billSettlement.settleTagihanPayment).not.toHaveBeenCalled();
        // Hilang dari antrian.
        expect(svc.listPending().find((r) => r.id === record.id)).toBeUndefined();
    });

    test("idempoten: record non-pending → already_processed", async () => {
        const deps = makeDeps();
        const svc = createPaymentProofService(deps);
        const { record } = await submit(svc);
        await svc.deleteProof(record.id);
        const again = await svc.deleteProof(record.id);
        expect(again.ok).toBe(false);
        expect(again.reason).toBe("already_processed");
    });

    test("id tak dikenal → not_found", async () => {
        const svc = createPaymentProofService(makeDeps());
        expect((await svc.deleteProof("nope")).reason).toBe("not_found");
    });
});

describe("payment-proof.service confirmManyPending (borongan 'terima semua')", () => {
    test("lunasi yang punya tagihan, LEWATI yang sudah lunas (no_outstanding TAK ditandai lunas)", async () => {
        // user 9 = sudah lunas → harus DILEWATI, bukan ditandai lunas (gerbang uang).
        const deps = makeDeps({
            getPaymentPositionForPeriod: jest.fn(async (user) =>
                String(user.id) === "9"
                    ? { outstanding: 0, is_fully_paid: true, amount_due: 150000 }
                    : { outstanding: 150000, is_fully_paid: false, amount_due: 150000 }),
            findUserById: (id) => ({ id, name: `U${id}`, subscription: "10Mbps", phone_number: `62822${id}`, pppoe_username: `u${id}` })
        });
        const svc = createPaymentProofService(deps);
        const a = await submit(svc, { user: { id: 5, name: "Budi", phone_number: "6285", subscription: "10Mbps" }, canonicalSender: "6285@s.whatsapp.net" });
        const b = await submit(svc, { user: { id: 9, name: "Sudah", phone_number: "6289", subscription: "10Mbps" }, canonicalSender: "6289@s.whatsapp.net" });

        const res = await svc.confirmManyPending({ adminName: "ana" });

        expect(res.total).toBe(2);
        expect(res.confirmed.map((c) => c.id)).toEqual([a.record.id]);
        expect(res.skipped.map((s) => s.id)).toEqual([b.record.id]);
        expect(res.failed).toHaveLength(0);
        // Yang payable jadi confirmed; yang no_outstanding TETAP pending (tak pernah dilunasi diam-diam).
        expect(svc.getById(a.record.id).status).toBe("confirmed");
        expect(svc.getById(b.record.id).status).toBe("pending");
    });

    test("antrian kosong → total 0, semua array kosong", async () => {
        const svc = createPaymentProofService(makeDeps());
        const res = await svc.confirmManyPending({ adminName: "ana" });
        expect(res).toEqual({ total: 0, confirmed: [], alreadyPaid: [], skipped: [], failed: [] });
    });

    test("satu bukti gagal settle TIDAK menggagalkan sisanya (never-throw per item)", async () => {
        let calls = 0;
        const deps = makeDeps({
            billSettlement: {
                settleTagihanPayment: jest.fn(async () => {
                    calls += 1;
                    if (calls === 1) throw new Error("db down");
                    return { ok: true, ledger: { action: "paid" }, reactivation: { attempted: false } };
                })
            },
            findUserById: (id) => ({ id, name: `U${id}`, subscription: "10Mbps", phone_number: `62822${id}`, pppoe_username: `u${id}` })
        });
        const svc = createPaymentProofService(deps);
        const a = await submit(svc, { user: { id: 5, name: "Budi", phone_number: "6285", subscription: "10Mbps" }, canonicalSender: "6285@s.whatsapp.net" });
        const b = await submit(svc, { user: { id: 6, name: "Cici", phone_number: "6286", subscription: "10Mbps" }, canonicalSender: "6286@s.whatsapp.net" });

        const res = await svc.confirmManyPending({ adminName: "ana" });

        expect(res.total).toBe(2);
        expect(res.failed).toHaveLength(1);
        expect(res.confirmed).toHaveLength(1);
        // Yang gagal TETAP pending (fail-closed), yang sukses jadi confirmed.
        expect(svc.getById(a.record.id).status).toBe("pending");
        expect(svc.getById(b.record.id).status).toBe("confirmed");
    });
});
