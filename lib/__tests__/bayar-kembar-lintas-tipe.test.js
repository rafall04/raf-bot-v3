/**
 * Header Doc
 * Purpose: Mengunci #b254 — satu pelanggan + satu periode hanya boleh punya SATU pengajuan
 *          pembayaran yang menunggu (apa pun tipenya), dan kredit ke ledger TIDAK BOLEH melebihi
 *          sisa tagihan periode itu.
 * Caller: Jest test runner.
 * Deps: `lib/payment-finance-service`.
 * MainFuncs: —
 * SideEffects: Tidak ada (murni fungsi lingkup + aritmetika plafon).
 */
"use strict";

const { isSamePaymentRequestScope, normalizePaymentRequestScope } = require("../payment-finance-service");

const CICILAN = {
    userId: 42,
    request_type: "partial_payment",
    period_month: 8,
    period_year: 2026,
    amount_paid: 50000,
};
const PELUNASAN = {
    userId: 42,
    request_type: "payment_status_change",
    period_month: 8,
    period_year: 2026,
};

describe("#b254 — satu periode, satu pengajuan menunggu", () => {
    test("cicilan dan pelunasan penuh untuk pelanggan+periode SAMA dianggap bentrok", () => {
        // Inilah lubangnya: dulu `request_type` ikut jadi kunci, jadi keduanya lolos berbarengan.
        expect(isSamePaymentRequestScope(CICILAN, PELUNASAN)).toBe(true);
        expect(isSamePaymentRequestScope(PELUNASAN, CICILAN)).toBe(true);
    });

    test("periode BERBEDA tetap boleh berdampingan", () => {
        expect(isSamePaymentRequestScope(CICILAN, { ...PELUNASAN, period_month: 9 })).toBe(false);
        expect(isSamePaymentRequestScope(CICILAN, { ...PELUNASAN, period_year: 2027 })).toBe(false);
    });

    test("pelanggan BERBEDA tetap boleh berdampingan", () => {
        expect(isSamePaymentRequestScope(CICILAN, { ...PELUNASAN, userId: 43 })).toBe(false);
    });

    test("bentuk lama `is_partial_payment` tetap terbaca sebagai tipe cicilan", () => {
        const lama = normalizePaymentRequestScope({ userId: 42, is_partial_payment: true, period_month: 8, period_year: 2026 });
        expect(lama.request_type).toBe("partial_payment");
        // Tipe tetap DICATAT (dipakai untuk menyebut jenis penghalang di pesan 409),
        // tapi tidak lagi menentukan bentrok.
        expect(isSamePaymentRequestScope(lama, PELUNASAN)).toBe(true);
    });

    test("id pelanggan bertipe beda (string vs angka) tetap dianggap sama", () => {
        expect(isSamePaymentRequestScope({ ...CICILAN, userId: "42" }, PELUNASAN)).toBe(true);
    });
});

describe("#b254 — kredit tidak boleh melebihi sisa tagihan", () => {
    // Aritmetika plafon yang dipasang di `applyPaymentStatusChange`. Diuji sebagai aturan murni
    // supaya tak perlu menyeret seluruh boundary keuangan + SQLite ke dalam unit test.
    // Cerminan aturan di `applyPaymentStatusChange`. `null` = kredit DIBATALKAN (no_change).
    function dikredit(diminta, sisa) {
        const s = Math.max(0, sisa);
        if (s <= 0) return null;
        return Math.min(diminta, s);
    }

    test("skenario nyata: tagihan 75rb, cicilan 50rb disetujui, lalu pelunasan penuh", () => {
        // Setelah cicilan 50rb, sisa = 25rb. Pengajuan "penuh" tak menyimpan amount_paid sehingga
        // jatuh ke harga paket 75rb — dulu ledger jadi 125rb untuk tagihan 75rb.
        expect(dikredit(75000, 25000)).toBe(25000);
        expect(50000 + dikredit(75000, 25000)).toBe(75000);
    });

    test("pembayaran wajar tidak dipotong", () => {
        expect(dikredit(50000, 75000)).toBe(50000);
        expect(dikredit(75000, 75000)).toBe(75000);
    });

    test("sisa 0 → kredit DIBATALKAN, bukan diteruskan", () => {
        // Godaannya menyerahkan kasus ini ke rem `is_fully_paid`. DATA PRODUKSI membantah:
        // Tanjungharjo user 57 periode 7/2026 punya DUA kredit Rp110.000 untuk tagihan
        // Rp110.000 — keduanya lewat fungsi yang sama, jadi rem itu tidak menyala.
        expect(dikredit(110000, 0)).toBeNull();
    });

    test("kejadian NYATA user 57: bayar penuh dua kali, yang kedua ditolak", () => {
        expect(dikredit(110000, 110000)).toBe(110000); // kredit pertama: sisa penuh
        expect(dikredit(110000, 0)).toBeNull();        // kredit kedua: sisa habis → ditolak
    });

    test("sisa negatif (data aneh) juga membatalkan, bukan memotong ke minus", () => {
        expect(dikredit(75000, -5000)).toBeNull();
    });
});
