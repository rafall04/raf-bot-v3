/**
 * Header Doc
 * Purpose: Memverifikasi helper fulfillment voucher multi-beli (#b402) — batch generate,
 *   format daftar kode, parse ket, gate config, dan normalisasi qty.
 * Caller: Jest test runner.
 * Deps: `../voucher-fulfillment`.
 * MainFuncs: generateVoucherBatch, formatVoucherCodeList, parseVoucherCodesFromKet,
 *   voucherMultiBuyConfig, normalizeVoucherQty.
 * SideEffects: Tidak ada; getvoucher dimock in-memory.
 */
"use strict";

const {
    voucherMultiBuyConfig,
    normalizeVoucherQty,
    generateVoucherBatch,
    formatVoucherCodeList,
    parseVoucherCodesFromKet
} = require("../voucher-fulfillment");

describe("voucher-fulfillment (#b402)", () => {
    describe("voucherMultiBuyConfig", () => {
        test("default OFF + maxQty default saat config kosong", () => {
            expect(voucherMultiBuyConfig(undefined)).toEqual({ enabled: false, maxQty: 10 });
            expect(voucherMultiBuyConfig({})).toEqual({ enabled: false, maxQty: 10 });
            expect(voucherMultiBuyConfig({ voucherMultiPurchase: {} })).toEqual({ enabled: false, maxQty: 10 });
        });
        test("enabled + maxQty dari config", () => {
            expect(voucherMultiBuyConfig({ voucherMultiPurchase: { enabled: true, maxQty: 5 } }))
                .toEqual({ enabled: true, maxQty: 5 });
        });
        test("maxQty tak valid/negatif di-clamp ke >=1", () => {
            expect(voucherMultiBuyConfig({ voucherMultiPurchase: { enabled: true, maxQty: "abc" } }).maxQty).toBe(10);
            expect(voucherMultiBuyConfig({ voucherMultiPurchase: { enabled: true, maxQty: -3 } }).maxQty).toBe(1);
        });
    });

    describe("normalizeVoucherQty", () => {
        test("record lama tanpa qty → 1; nilai tak valid → 1", () => {
            expect(normalizeVoucherQty(undefined)).toBe(1);
            expect(normalizeVoucherQty(null)).toBe(1);
            expect(normalizeVoucherQty("")).toBe(1);
            expect(normalizeVoucherQty("abc")).toBe(1);
            expect(normalizeVoucherQty(0)).toBe(1);
            expect(normalizeVoucherQty(-5)).toBe(1);
        });
        test("qty valid dipertahankan (string angka ikut)", () => {
            expect(normalizeVoucherQty(3)).toBe(3);
            expect(normalizeVoucherQty("7")).toBe(7);
        });
    });

    describe("generateVoucherBatch", () => {
        const ok = (code) => ({ ok: true, data: { username: code } });
        const fail = (msg) => ({ ok: false, message: msg });

        test("qty=1: 1 panggilan getvoucher, 1 kode", async () => {
            const getvoucher = jest.fn().mockResolvedValue(ok("VCR1"));
            const r = await generateVoucherBatch({ getvoucher, prof: "P1", qty: 1, sender: "6281", caller: "t" });
            expect(getvoucher).toHaveBeenCalledTimes(1);
            expect(r).toEqual({ codes: ["VCR1"], failures: [] });
        });

        test("qty=3: 3 panggilan SEKUENSIAL, semua kode terkumpul berurutan", async () => {
            const getvoucher = jest.fn()
                .mockResolvedValueOnce(ok("A1"))
                .mockResolvedValueOnce(ok("A2"))
                .mockResolvedValueOnce(ok("A3"));
            const r = await generateVoucherBatch({ getvoucher, prof: "P1", qty: 3, sender: "6281", caller: "t" });
            expect(getvoucher).toHaveBeenCalledTimes(3);
            expect(r.codes).toEqual(["A1", "A2", "A3"]);
            expect(r.failures).toEqual([]);
        });

        test("gagal di tengah → BERHENTI (tak pukul MikroTik lagi), kode sukses dipertahankan", async () => {
            const getvoucher = jest.fn()
                .mockResolvedValueOnce(ok("A1"))
                .mockResolvedValueOnce(fail("mikrotik down"));
            const r = await generateVoucherBatch({ getvoucher, prof: "P1", qty: 3, sender: "6281", caller: "t" });
            expect(getvoucher).toHaveBeenCalledTimes(2); // item ke-3 TIDAK dicoba
            expect(r.codes).toEqual(["A1"]);
            expect(r.failures).toEqual(["mikrotik down"]);
        });

        test("getvoucher throw → dicatat sebagai failure, batch berhenti", async () => {
            const getvoucher = jest.fn().mockRejectedValue(new Error("timeout"));
            const r = await generateVoucherBatch({ getvoucher, prof: "P1", qty: 2, sender: "6281", caller: "t" });
            expect(r.codes).toEqual([]);
            expect(r.failures).toEqual(["timeout"]);
        });

        test("getvoucher mengembalikan STRING (site_url kosong) → string-nya jadi pesan failure", async () => {
            const getvoucher = jest.fn().mockResolvedValue("Mikrotik Site URL belum diisi");
            const r = await generateVoucherBatch({ getvoucher, prof: "P1", qty: 1, sender: "6281", caller: "t" });
            expect(r.codes).toEqual([]);
            expect(r.failures).toEqual(["Mikrotik Site URL belum diisi"]);
        });

        test("qty tak valid dinormalisasi ke 1 (defense-in-depth; gate utama di route)", async () => {
            const getvoucher = jest.fn().mockResolvedValue(ok("X"));
            await generateVoucherBatch({ getvoucher, prof: "P1", qty: "nope", sender: "6281", caller: "t" });
            expect(getvoucher).toHaveBeenCalledTimes(1);
        });
    });

    describe("formatVoucherCodeList", () => {
        test("1 kode → polos; >1 → baris bernomor", () => {
            expect(formatVoucherCodeList([])).toBe("");
            expect(formatVoucherCodeList(["A"])).toBe("A");
            expect(formatVoucherCodeList(["A", "B", "C"])).toBe("1. A\n2. B\n3. C");
        });
    });

    describe("parseVoucherCodesFromKet", () => {
        test("format buynow 'Voucher: A, B' & buynowweb 'A, B' keduanya ter-parse", () => {
            expect(parseVoucherCodesFromKet("Voucher: A1, B2")).toEqual(["A1", "B2"]);
            expect(parseVoucherCodesFromKet("A1, B2, C3")).toEqual(["A1", "B2", "C3"]);
            expect(parseVoucherCodesFromKet("Voucher: SINGLE")).toEqual(["SINGLE"]);
            expect(parseVoucherCodesFromKet("SINGLE")).toEqual(["SINGLE"]);
        });
        test("ket kosong / GAGAL → []", () => {
            expect(parseVoucherCodesFromKet(undefined)).toEqual([]);
            expect(parseVoucherCodesFromKet("")).toEqual([]);
            expect(parseVoucherCodesFromKet("   ")).toEqual([]);
            expect(parseVoucherCodesFromKet("GAGAL voucher: mikrotik down")).toEqual([]);
        });
        test("non-string → []", () => {
            expect(parseVoucherCodesFromKet(null)).toEqual([]);
            expect(parseVoucherCodesFromKet(123)).toEqual([]);
        });
    });
});
