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
    voucherCustomCredsConfig,
    normalizeVoucherQty,
    normalizeVoucherUsername,
    normalizeVoucherPassword,
    isVoucherUsernameReserved,
    assertVoucherUsernameAvailable,
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

    describe("voucherCustomCredsConfig (#b405)", () => {
        test("default OFF saat config kosong/absen", () => {
            expect(voucherCustomCredsConfig(undefined)).toEqual({ enabled: false });
            expect(voucherCustomCredsConfig({})).toEqual({ enabled: false });
            expect(voucherCustomCredsConfig({ voucherCustomCreds: {} })).toEqual({ enabled: false });
        });
        test("enabled dari config", () => {
            expect(voucherCustomCredsConfig({ voucherCustomCreds: { enabled: true } }).enabled).toBe(true);
        });
    });

    describe("normalizeVoucherUsername (#b405)", () => {
        test("valid → lowercase; trim; 3-16 char; huruf/angka/-/_, mulai alnum", () => {
            expect(normalizeVoucherUsername("Adi_Keren")).toBe("adi_keren");
            expect(normalizeVoucherUsername("  user-01  ")).toBe("user-01");
            expect(normalizeVoucherUsername("a1_")).toBe("a1_");
        });
        test("invalid → null (terlalu pendek/panjang, karakter aneh, mulai non-alnum)", () => {
            for (const bad of ["", "ab", "x".repeat(17), "user name", "user@x", "-abc", "_abc", null, undefined]) {
                expect({ bad, hasil: normalizeVoucherUsername(bad) }).toEqual({ bad, hasil: null });
            }
        });
    });

    describe("normalizeVoucherPassword (#b405)", () => {
        test("kosong/blank → null (artinya: pakai username sebagai password)", () => {
            expect(normalizeVoucherPassword(undefined)).toBe(null);
            expect(normalizeVoucherPassword("")).toBe(null);
            expect(normalizeVoucherPassword("   ")).toBe(null);
        });
        test("valid 3-64 non-spasi → dipertahankan; spasi → null", () => {
            expect(normalizeVoucherPassword("abc123")).toBe("abc123");
            expect(normalizeVoucherPassword("x".repeat(64))).toBe("x".repeat(64));
            expect(normalizeVoucherPassword("ab")).toBe(null);
            expect(normalizeVoucherPassword("x".repeat(65))).toBe(null);
            expect(normalizeVoucherPassword("a b c")).toBe(null);
        });
    });

    describe("isVoucherUsernameReserved (#b405)", () => {
        const now = Date.now();
        test("record pending non-expired dgn customUser sama → true", () => {
            const payments = [{ customUser: "adi", status: false, createdAt: now }];
            expect(isVoucherUsernameReserved(payments, "adi", now)).toBe(true);
        });
        test("record LUNAS tak menahan nama; record expired tak menahan", () => {
            const payments = [
                { customUser: "adi", status: true, createdAt: now },
                { customUser: "budi", status: false, createdAt: now - (48 * 3600 * 1000) }
            ];
            expect(isVoucherUsernameReserved(payments, "adi", now)).toBe(false);
            expect(isVoucherUsernameReserved(payments, "budi", now)).toBe(false);
        });
        test("username beda / payments kosong → false", () => {
            expect(isVoucherUsernameReserved([], "adi", now)).toBe(false);
            expect(isVoucherUsernameReserved([{ customUser: "budi", status: false, createdAt: now }], "adi", now)).toBe(false);
        });
    });

    describe("assertVoucherUsernameAvailable (#b405)", () => {
        const payments = () => [];
        test("username invalid → reason 'invalid' (MikroTik tak dipukul)", async () => {
            const cekHotspotUser = jest.fn();
            const r = await assertVoucherUsernameAvailable({ payments: payments(), cekHotspotUser, username: "!!bad" });
            expect(r.ok).toBe(false);
            expect(r.reason).toBe("invalid");
            expect(cekHotspotUser).not.toHaveBeenCalled();
        });
        test("ter-reservasi pending → reason 'reserved' (MikroTik tak dipukul)", async () => {
            const cekHotspotUser = jest.fn();
            const r = await assertVoucherUsernameAvailable({
                payments: [{ customUser: "adi", status: false, createdAt: Date.now() }],
                cekHotspotUser,
                username: "ADI"
            });
            expect(r.reason).toBe("reserved");
            expect(cekHotspotUser).not.toHaveBeenCalled();
        });
        test("MikroTik: exists → 'taken'", async () => {
            const r = await assertVoucherUsernameAvailable({
                payments: payments(),
                cekHotspotUser: jest.fn().mockResolvedValue({ ok: true, data: { exists: true } }),
                username: "adi"
            });
            expect(r.reason).toBe("taken");
        });
        test("pre-check gagal → 'check_failed' (fail-closed, tak anggap kosong)", async () => {
            const resGagal = jest.fn().mockResolvedValue({ ok: false });
            const r1 = await assertVoucherUsernameAvailable({ payments: payments(), cekHotspotUser: resGagal, username: "adi" });
            expect(r1.reason).toBe("check_failed");
            const resString = jest.fn().mockResolvedValue("mikrotik down");
            const r2 = await assertVoucherUsernameAvailable({ payments: payments(), cekHotspotUser: resString, username: "adi" });
            expect(r2.reason).toBe("check_failed");
            const throwing = jest.fn().mockRejectedValue(new Error("timeout"));
            const r3 = await assertVoucherUsernameAvailable({ payments: payments(), cekHotspotUser: throwing, username: "adi" });
            expect(r3.reason).toBe("check_failed");
        });
        test("kosong → ok:true + username dinormalisasi", async () => {
            const r = await assertVoucherUsernameAvailable({
                payments: payments(),
                cekHotspotUser: jest.fn().mockResolvedValue({ ok: true, data: { exists: false } }),
                username: "  ADI "
            });
            expect(r).toEqual({ ok: true, username: "adi" });
        });
    });

    describe("generateVoucherBatch — custom creds (#b405)", () => {
        const ok = (code) => ({ ok: true, data: { username: code } });

        test("custom diteruskan ke getvoucher; kode customUser dipakai", async () => {
            const getvoucher = jest.fn().mockResolvedValue(ok("adi"));
            const r = await generateVoucherBatch({
                getvoucher, prof: "P1", qty: 1, sender: "6281", caller: "t",
                custom: { username: "adi", password: "rahasia" }
            });
            expect(getvoucher).toHaveBeenCalledWith("P1", "6281",
                { caller: "t#1", custom: { username: "adi", password: "rahasia" } });
            expect(r.codes).toEqual(["adi"]);
        });

        test("custom + qty>1 → langsung gagal TANPA panggil MikroTik", async () => {
            const getvoucher = jest.fn();
            const r = await generateVoucherBatch({
                getvoucher, prof: "P1", qty: 3, sender: "6281", caller: "t",
                custom: { username: "adi" }
            });
            expect(getvoucher).not.toHaveBeenCalled();
            expect(r.codes).toEqual([]);
            expect(r.failures[0]).toMatch(/1 voucher/i);
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
