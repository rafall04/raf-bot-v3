/**
 * Header Doc
 * Purpose: Mengunci penutupan bayar-ganda gateway — (a) transaksi pending DIPAKAI ULANG
 *          sehingga hanya ada satu tagihan hidup per periode, dan (b) pembayaran yang masuk
 *          untuk periode yang sudah lunas dicatat + dialarmi, dan pelanggan TIDAK menerima
 *          struk lunas palsu.
 * Caller: Jest test runner.
 * Deps: `lib/payment.js`, `lib/services/bill-payment-aftercare.js`.
 * MainFuncs: —
 * SideEffects: Mengisi/mengosongkan array global `payment` selama tes.
 *
 * KENAPA ADA: `applyPaymentStatusChange` memulangkan `{action:'no_change',
 * reason:'already_fully_paid'}` TANPA menulis baris ledger, tapi tetap `ok:true`. Ketiga
 * callback gateway hanya membaca `settleResult.reactivation`, jadi pembayaran KEDUA untuk
 * periode yang sama = uang masuk rekening gateway, NOL baris pembukuan, dan pelanggan tetap
 * menerima struk "sudah LUNAS". Terukur di produksi 2026-08-15: belum pernah terjadi
 * (0 kejadian, volume 1 transaksi seumur hidup) — ini ranjau, dan tes ini menjaganya tetap mati.
 */
"use strict";

const { findPendingPayment } = require("../payment");
const { putuskanTindakanPascaLunas } = require("../services/bill-payment-aftercare");

const SEKARANG = Date.now();
const JAM = 60 * 60 * 1000;

function pasangPayment(list) {
    global.payment = list;
}

afterEach(() => {
    global.payment = [];
});

describe("findPendingPayment: satu tagihan hidup per periode", () => {
    const dasar = { tag: "tagihan", userId: 7, periodMonth: 8, periodYear: 2026, maxAgeMs: 45 * 60 * 1000 };

    test("menemukan transaksi pending milik user+periode yang sama", () => {
        pasangPayment([
            { reffId: "a1", tag: "tagihan", status: false, userId: 7, periodMonth: 8, periodYear: 2026, createdAt: SEKARANG - 60000 },
        ]);
        expect(findPendingPayment(dasar).reffId).toBe("a1");
    });

    test("MENGABAIKAN yang sudah lunas — itu bukan tagihan hidup", () => {
        pasangPayment([
            { reffId: "a1", tag: "tagihan", status: true, userId: 7, periodMonth: 8, periodYear: 2026, createdAt: SEKARANG - 60000 },
        ]);
        expect(findPendingPayment(dasar)).toBeNull();
    });

    test("MENGABAIKAN periode & pelanggan lain", () => {
        pasangPayment([
            { reffId: "lain-periode", tag: "tagihan", status: false, userId: 7, periodMonth: 7, periodYear: 2026, createdAt: SEKARANG },
            { reffId: "lain-user", tag: "tagihan", status: false, userId: 8, periodMonth: 8, periodYear: 2026, createdAt: SEKARANG },
            { reffId: "lain-tag", tag: "voucher", status: false, userId: 7, periodMonth: 8, periodYear: 2026, createdAt: SEKARANG },
        ]);
        expect(findPendingPayment(dasar)).toBeNull();
    });

    test("MENGABAIKAN yang sudah kedaluwarsa — QRIS mati lebih menyesatkan daripada yang baru", () => {
        pasangPayment([
            { reffId: "tua", tag: "tagihan", status: false, userId: 7, periodMonth: 8, periodYear: 2026, createdAt: SEKARANG - 2 * JAM },
        ]);
        expect(findPendingPayment(dasar)).toBeNull();
    });

    test("bila ada beberapa, memilih yang TERBARU", () => {
        pasangPayment([
            { reffId: "lama", tag: "tagihan", status: false, userId: 7, periodMonth: 8, periodYear: 2026, createdAt: SEKARANG - 10 * 60000 },
            { reffId: "baru", tag: "tagihan", status: false, userId: 7, periodMonth: 8, periodYear: 2026, createdAt: SEKARANG - 60000 },
        ]);
        expect(findPendingPayment(dasar).reffId).toBe("baru");
    });

    test("userId dibandingkan sebagai string — '7' dan 7 adalah pelanggan yang sama", () => {
        pasangPayment([
            { reffId: "a1", tag: "tagihan", status: false, userId: "7", periodMonth: 8, periodYear: 2026, createdAt: SEKARANG },
        ]);
        expect(findPendingPayment(dasar).reffId).toBe("a1");
    });
});

describe("putuskanTindakanPascaLunas: verdict ledger menentukan, bukan asumsi", () => {
    const user = { id: 7, name: "Pelanggan Uji", subscription: "PAKET-220K" };
    const dasar = {
        user, amount: 220000, periodMonth: 8, periodYear: 2026,
        method: "QRIS", refId: "ref-123", gateway: "ipaymu",
    };

    function depsPalsu() {
        const dicatat = [];
        const alarm = [];
        return {
            catatan: dicatat,
            alarm,
            deps: {
                upsertFinancialLedgerEntry: async (e) => { dicatat.push(e); },
                getAdminJids: () => ["628111@s.whatsapp.net", "628222@s.whatsapp.net"],
                sendCritical: async (jid, teks) => { alarm.push({ jid, teks }); },
                logger: { error: () => {}, warn: () => {} },
            },
        };
    }

    test("pelunasan NORMAL → struk lunas, tanpa baris kelebihan & tanpa alarm", async () => {
        const p = depsPalsu();
        const hasil = await putuskanTindakanPascaLunas(
            { ...dasar, settleResult: { ok: true, ledger: { action: "recorded" }, reactivation: {} } },
            p.deps
        );
        expect(hasil.jenis).toBe("lunas");
        expect(p.catatan).toHaveLength(0);
        expect(p.alarm).toHaveLength(0);
    });

    test("periode SUDAH lunas → jenis 'kelebihan', BUKAN struk lunas", async () => {
        const p = depsPalsu();
        const hasil = await putuskanTindakanPascaLunas(
            { ...dasar, settleResult: { ok: true, ledger: { action: "no_change", reason: "already_fully_paid" } } },
            p.deps
        );
        expect(hasil.jenis).toBe("kelebihan");
        // Inilah kebohongan yang dulu terkirim — pastikan mati.
        expect(hasil.teksPelanggan).not.toMatch(/sudah \*LUNAS\*/i);
        expect(hasil.teksPelanggan).toMatch(/sudah lunas sebelumnya/i);
        expect(hasil.teksPelanggan).toMatch(/220\.000/);
    });

    test("#b329 bayar MELEBIHI sisa (droppedExcess) → struk LUNAS + catat SELISIH sbg kelebihan + alarm", async () => {
        const p = depsPalsu();
        const hasil = await putuskanTindakanPascaLunas(
            { ...dasar, settleResult: { ok: true, ledger: { action: "paid", droppedExcess: 80000 }, reactivation: {} } },
            p.deps
        );
        expect(hasil.jenis).toBe("lunas"); // periode BARU lunas → struk lunas normal, BUKAN 'kelebihan'
        expect(p.catatan).toHaveLength(1);
        expect(p.catatan[0].amount).toBe(80000); // HANYA selisih yang dicatat kelebihan (bukan full 220k)
        expect(p.catatan[0].status).toBe("pending_review");
        expect(p.alarm.length).toBeGreaterThan(0); // admin dialarmi
    });

    test("#b329 action 'paid' tanpa droppedExcess → struk lunas biasa, tak ada kelebihan/alarm", async () => {
        const p = depsPalsu();
        const hasil = await putuskanTindakanPascaLunas(
            { ...dasar, settleResult: { ok: true, ledger: { action: "paid", droppedExcess: 0 }, reactivation: {} } },
            p.deps
        );
        expect(hasil.jenis).toBe("lunas");
        expect(p.catatan).toHaveLength(0);
        expect(p.alarm).toHaveLength(0);
    });

    test("uangnya DICATAT ke ledger sebagai kelebihan bayar, status pending_review", async () => {
        const p = depsPalsu();
        await putuskanTindakanPascaLunas(
            { ...dasar, settleResult: { ok: true, ledger: { action: "no_change", reason: "already_fully_paid" } } },
            p.deps
        );
        expect(p.catatan).toHaveLength(1);
        const e = p.catatan[0];
        expect(e.referenceType).toBe("kelebihan_bayar");
        expect(e.amount).toBe(220000);
        // BUKAN pelunasan — tak boleh ikut menaikkan "sudah dibayar" periode itu.
        expect(e.status).toBe("pending_review");
        // Idempoten per-transaksi: callback gateway bisa dikirim ulang.
        expect(e.eventKey).toBe("kelebihan_bayar:ref-123");
    });

    test("SEMUA admin dialarmi, dan pesannya menyebut nominal + nomor ref", async () => {
        const p = depsPalsu();
        await putuskanTindakanPascaLunas(
            { ...dasar, settleResult: { ok: true, ledger: { action: "no_change", reason: "already_fully_paid" } } },
            p.deps
        );
        expect(p.alarm).toHaveLength(2);
        expect(p.alarm[0].teks).toMatch(/KELEBIHAN BAYAR/i);
        expect(p.alarm[0].teks).toMatch(/220\.000/);
        expect(p.alarm[0].teks).toMatch(/ref-123/);
    });

    test("ledger GAGAL tak melempar, dan alarm admin menyebut kegagalannya", async () => {
        // Kegagalan mencatat tak boleh menjatuhkan callback gateway — tapi juga tak boleh
        // senyap, karena baris itu satu-satunya jejak uangnya.
        const p = depsPalsu();
        p.deps.upsertFinancialLedgerEntry = async () => { throw new Error("db penuh"); };
        const hasil = await putuskanTindakanPascaLunas(
            { ...dasar, settleResult: { ok: true, ledger: { action: "no_change", reason: "already_fully_paid" } } },
            p.deps
        );
        expect(hasil.jenis).toBe("kelebihan");
        expect(hasil.ledgerDicatat).toBe(false);
        expect(p.alarm[0].teks).toMatch(/GAGAL dicatat/i);
    });

    test("satu admin gagal dikirimi TIDAK menghentikan admin lainnya", async () => {
        const p = depsPalsu();
        let n = 0;
        p.deps.sendCritical = async (jid, teks) => {
            n++;
            if (n === 1) throw new Error("WA putus");
            p.alarm.push({ jid, teks });
        };
        const hasil = await putuskanTindakanPascaLunas(
            { ...dasar, settleResult: { ok: true, ledger: { action: "no_change", reason: "already_fully_paid" } } },
            p.deps
        );
        expect(n).toBe(2);
        expect(hasil.adminDialarmi).toBe(true);
    });

    test("settleResult tanpa ledger diperlakukan sebagai pelunasan normal, bukan kelebihan", async () => {
        const p = depsPalsu();
        const hasil = await putuskanTindakanPascaLunas({ ...dasar, settleResult: { ok: true } }, p.deps);
        expect(hasil.jenis).toBe("lunas");
    });
});
