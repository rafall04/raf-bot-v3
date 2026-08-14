/**
 * Header Doc
 * Purpose: Mengunci aturan arah persetujuan pembayaran — pengajuan CICILAN harus dicatat
 *          sebagai uang masuk, tak pernah sebagai pembalikan.
 * Caller: Jest test runner.
 * Deps: `../payment-approval.service` (`resolveArahPersetujuan`), `../../routes/partial-payment`
 *       hanya sebagai rujukan bentuk data.
 * MainFuncs: —
 * SideEffects: Tidak ada — predikat murni.
 *
 * KENAPA ADA: bug aslinya tak terlihat di satu berkas. `routes/partial-payment.js` menyimpan
 * `newStatus: isFullyPaid`, dan DUA jalur approve (routes/requests.js + bulkApproveRequests)
 * memutuskan kredit-vs-pembalikan dari boolean itu. Cicilan yang belum melunasi periode
 * menyimpan `false`, sehingga uang yang sudah diterima teknisi justru memicu PEMBALIKAN.
 */
"use strict";

const { resolveArahPersetujuan } = require("../payment-approval.service");

// Bentuk record persis seperti yang ditulis routes/partial-payment.js.
function pengajuanCicilan(ubah = {}) {
    return {
        id: 1756000000000,
        userId: 42,
        userName: "Budi",
        newStatus: false, // <- isFullyPaid: false karena BELUM lunas, bukan karena tak ada uang
        status: "pending",
        request_type: "partial_payment",
        payment_method: "CASH",
        is_partial_payment: true,
        amount_due: 150000,
        amount_paid: 75000,
        amount_remaining: 75000,
        period_month: 8,
        period_year: 2026,
        requested_by_teknisi_id: 9,
        ...ubah,
    };
}

describe("pengajuan cicilan tak boleh pernah jadi pembalikan", () => {
    test("cicilan sebagian (newStatus=false, ada uang diterima) → KREDIT", () => {
        const hasil = resolveArahPersetujuan(pengajuanCicilan());

        expect(hasil.arah).toBe("kredit");
        expect(hasil.arah).not.toBe("pembalikan");
    });

    test("cicilan yang kebetulan MELUNASI periode → tetap KREDIT", () => {
        const hasil = resolveArahPersetujuan(
            pengajuanCicilan({ newStatus: true, amount_paid: 150000, amount_remaining: 0 })
        );
        expect(hasil.arah).toBe("kredit");
    });

    test("penanda lama `is_partial_payment` saja (tanpa request_type) tetap dikenali", () => {
        const hasil = resolveArahPersetujuan(
            pengajuanCicilan({ request_type: undefined, is_partial_payment: true })
        );
        expect(hasil.arah).toBe("kredit");
    });

    test.each([0, null, undefined, "", "abc", -5000])(
        "cicilan dengan amount_paid %p DITOLAK, tidak diam-diam dibalikkan",
        (nominal) => {
            const hasil = resolveArahPersetujuan(pengajuanCicilan({ amount_paid: nominal }));

            expect(hasil.arah).toBe("tolak");
            expect(hasil.arah).not.toBe("pembalikan");
            expect(hasil.alasan).toMatch(/tidak diproses sebagai pembalikan/i);
        }
    );
});

describe("pengajuan non-cicilan tetap memakai semantik lama", () => {
    const biasa = (newStatus) => ({
        id: 1,
        userId: 42,
        newStatus,
        request_type: "paid_change",
        amount_due: 150000,
    });

    test("tandai LUNAS → kredit", () => {
        expect(resolveArahPersetujuan(biasa(true)).arah).toBe("kredit");
    });

    test("tandai BELUM BAYAR → pembalikan (jalur koreksi yang memang sah)", () => {
        expect(resolveArahPersetujuan(biasa(false)).arah).toBe("pembalikan");
    });

    test("newStatus hilang → pembalikan, bukan kredit tak sengaja", () => {
        expect(resolveArahPersetujuan(biasa(undefined)).arah).toBe("pembalikan");
    });

    test("nilai truthy non-boolean tidak dianggap lunas", () => {
        // Sengaja ketat: hanya `true` literal yang berarti lunas.
        expect(resolveArahPersetujuan(biasa("true")).arah).toBe("pembalikan");
        expect(resolveArahPersetujuan(biasa(1)).arah).toBe("pembalikan");
    });
});

describe("masukan rusak tak boleh meledak", () => {
    test.each([null, undefined, {}])("input %p → pembalikan (default aman, bukan lempar)", (r) => {
        expect(() => resolveArahPersetujuan(r)).not.toThrow();
        expect(resolveArahPersetujuan(r).arah).toBe("pembalikan");
    });
});
