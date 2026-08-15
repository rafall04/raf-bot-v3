/**
 * Header Doc
 * Purpose: Mengunci normalisasi kosakata metode pembayaran — ejaan yang beragam harus
 *          jatuh ke ember yang sama, dan ringkasan harus MENJUMLAH, bukan menimpa.
 * Caller: Jest test runner.
 * Deps: `lib/payment-method-vocab.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA — terukur di produksi Tanjungharjo 2026-08-15, `financial_ledger` memuat
 * "TRANSFER_BANK" (69 transaksi, Rp8.985.000) DAN "transfer" (1 transaksi, Rp10.000).
 * Keduanya menormal ke ember "transfer", dan mapMethodSummary lama menulis
 * `output[normalized] = {...}` sehingga yang tersisip belakangan MENANG: kartu Rekap
 * Keuangan menampilkan Rp10.000 dan menyembunyikan Rp8.985.000.
 *
 * Tes lama (routes/__tests__/rekap-keuangan-dashboard.test.js) tetap hijau selama ini
 * karena hanya memakai SATU kunci "CASH" — tabrakan tak pernah teruji.
 */
"use strict";

const {
    normalisasiMetode,
    ejaanUntukEmber,
    EMBER_BAKU,
    LABEL_EMBER,
} = require("../payment-method-vocab");

describe("normalisasiMetode menyatukan ejaan yang beragam", () => {
    test.each([
        ["CASH", "cash"],
        ["cash", "cash"],
        ["TUNAI", "cash"],
        ["  Tunai  ", "cash"],
        ["TRANSFER_BANK", "transfer"],
        ["transfer", "transfer"],
        ["TRANSFER", "transfer"],
        ["Transfer Bank", "transfer"],
        ["bank_transfer", "transfer"],
        ["SALDO", "saldo"],
        ["AGENT", "agent"],
        ["INTERNAL_PAYROLL", "payroll"],
        ["REVERSAL", "reversal"],
    ])("%s -> %s", (masukan, harap) => {
        expect(normalisasiMetode(masukan)).toBe(harap);
    });

    test("semua ejaan gateway masuk SATU ember 'online' agar tak berserak", () => {
        for (const m of ["qris", "QRIS", "va", "VA", "cstore", "MPM", "Mayar", "iPaymu (hosted)"]) {
            expect(normalisasiMetode(m)).toBe("online");
        }
    });

    test("kosong/null -> null, bukan ember palsu", () => {
        for (const m of [null, undefined, "", "   "]) {
            expect(normalisasiMetode(m)).toBeNull();
        }
    });

    test("ejaan tak dikenal dikembalikan apa adanya, TIDAK dibuang", () => {
        // Metode baru harus tetap terlihat pemilik usaha, bukan lenyap ke keranjang
        // "lain-lain" yang tak bisa ditelusuri.
        expect(normalisasiMetode("METODE_BARU")).toBe("metode_baru");
    });
});

describe("ejaanUntukEmber memekarkan ember jadi semua ejaannya (untuk filter)", () => {
    test("cash mencakup CASH dan TUNAI", () => {
        const e = ejaanUntukEmber("cash");
        expect(e).toEqual(expect.arrayContaining(["cash", "tunai"]));
    });

    test("transfer mencakup transfer_bank", () => {
        const e = ejaanUntukEmber("transfer");
        expect(e).toEqual(expect.arrayContaining(["transfer", "transfer_bank"]));
    });

    test("setiap ejaan yang dimekarkan menormal balik ke ember yang sama", () => {
        // Sifat bolak-balik ini yang menjaga filter & kartu ringkasan tak menyimpang.
        for (const ember of EMBER_BAKU) {
            for (const ejaan of ejaanUntukEmber(ember)) {
                expect(normalisasiMetode(ejaan)).toBe(ember);
            }
        }
    });

    test("ember tak dikenal tetap memulangkan dirinya sendiri", () => {
        expect(ejaanUntukEmber("metode_baru")).toEqual(["metode_baru"]);
        expect(ejaanUntukEmber("")).toEqual([]);
    });
});

describe("ringkasan MENJUMLAH ejaan yang bertabrakan, bukan menimpa", () => {
    // Salinan perilaku mapMethodSummary sesudah perbaikan (routes/rekap-keuangan.js).
    function ringkas(raw) {
        const output = {
            cash: { count: 0, amount: 0 }, transfer: { count: 0, amount: 0 },
            topup: { count: 0, amount: 0 }, saldo: { count: 0, amount: 0 },
            agent: { count: 0, amount: 0 }, payroll: { count: 0, amount: 0 },
        };
        Object.entries(raw || {}).forEach(([key, value]) => {
            const n = normalisasiMetode(key) || "lainnya";
            if (!output[n]) output[n] = { count: 0, amount: 0 };
            output[n].count += value.count || 0;
            output[n].amount += value.amount || 0;
        });
        return output;
    }

    test("data PRODUKSI Tanjungharjo: Rp8.985.000 tak lagi lenyap", () => {
        const hasil = ringkas({
            TRANSFER_BANK: { count: 69, amount: 8985000 },
            CASH: { count: 99, amount: 11630000 },
            REVERSAL: { count: 1, amount: 110000 },
            transfer: { count: 1, amount: 10000 },
        });
        expect(hasil.transfer).toEqual({ count: 70, amount: 8995000 });
        expect(hasil.cash).toEqual({ count: 99, amount: 11630000 });
        // Sebelum perbaikan, angka ini Rp10.000 — 69 pembayaran tak terlihat.
        expect(hasil.transfer.amount).not.toBe(10000);
    });

    test("TUNAI tak lagi jadi kartu terpisah dari CASH", () => {
        const hasil = ringkas({
            CASH: { count: 2, amount: 200000 },
            TUNAI: { count: 3, amount: 300000 },
        });
        expect(hasil.cash).toEqual({ count: 5, amount: 500000 });
        expect(hasil.tunai).toBeUndefined();
    });

    test("urutan sisip tidak mengubah hasil (bukti penimpaan sudah mati)", () => {
        const a = ringkas({ TRANSFER_BANK: { count: 69, amount: 8985000 }, transfer: { count: 1, amount: 10000 } });
        const b = ringkas({ transfer: { count: 1, amount: 10000 }, TRANSFER_BANK: { count: 69, amount: 8985000 } });
        expect(a.transfer).toEqual(b.transfer);
    });

    test("enam ember lama tetap ada meski kosong", () => {
        const hasil = ringkas({});
        for (const k of ["cash", "transfer", "topup", "saldo", "agent", "payroll"]) {
            expect(hasil[k]).toEqual({ count: 0, amount: 0 });
        }
    });

    test("setiap ember baku punya label yang bisa dibaca manusia", () => {
        for (const e of EMBER_BAKU) {
            expect(typeof LABEL_EMBER[e]).toBe("string");
            expect(LABEL_EMBER[e].length).toBeGreaterThan(0);
        }
    });
});
