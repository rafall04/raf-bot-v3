/**
 * Test Tripay client — fokus signature (create + callback verify) yang mengamankan
 * integrasi, plus createCharge/getChannels/checkTransaction (mock fetch).
 */
"use strict";

const CryptoJs = require("crypto-js");
const tripay = require("../tripay");
const { createCharge, getChannels, checkTransaction, verifyCallbackSignature, _buildSignature } = tripay;

const realFetch = global.fetch;

function mockFetchOnce(jsonBody, { status = 200 } = {}) {
    global.fetch = jest.fn().mockResolvedValue({ status, json: async () => jsonBody });
}

beforeEach(() => {
    global.config = {
        tripayProduction: false,
        tripayApiKey: "APIKEY-SBX",
        tripayPrivateKey: "PRIVKEY-SBX",
        tripayMerchantCode: "T0001",
    };
});

afterAll(() => { global.fetch = realFetch; });

describe("tripay signature (create transaction)", () => {
    test("HMAC-SHA256(merchantCode+merchantRef+amount, privateKey) — deterministik & benar", () => {
        const sig = _buildSignature("T0001", "ref-1", 10000, "PRIVKEY-SBX");
        const expected = CryptoJs.enc.Hex.stringify(CryptoJs.HmacSHA256("T0001ref-110000", "PRIVKEY-SBX"));
        expect(sig).toBe(expected);
        expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });
});

describe("tripay verifyCallbackSignature", () => {
    test("signature cocok (HMAC raw body) → true", () => {
        const raw = '{"reference":"T123","status":"PAID"}';
        const sig = CryptoJs.enc.Hex.stringify(CryptoJs.HmacSHA256(raw, "PRIVKEY-SBX"));
        expect(verifyCallbackSignature(raw, sig)).toBe(true);
    });

    test("signature salah → false (tolak forgery)", () => {
        const raw = '{"reference":"T123","status":"PAID"}';
        expect(verifyCallbackSignature(raw, "deadbeef")).toBe(false);
    });

    test("body diubah (status dipalsukan) → signature lama tak cocok → false", () => {
        const raw = '{"reference":"T123","status":"UNPAID"}';
        const sigForUnpaid = CryptoJs.enc.Hex.stringify(CryptoJs.HmacSHA256(raw, "PRIVKEY-SBX"));
        const tampered = '{"reference":"T123","status":"PAID"}';
        expect(verifyCallbackSignature(tampered, sigForUnpaid)).toBe(false);
    });

    test("privateKey/signature kosong → false", () => {
        expect(verifyCallbackSignature("x", "")).toBe(false);
    });
});

describe("tripay.createCharge", () => {
    const baseProps = { amount: 10000, reffId: "ref-x", comment: "Tagihan REG", name: "Budi", email: "b@x.com", phone: "62812", method: "QRIS" };

    test("field wajib kurang → throw (tak panggil fetch)", async () => {
        global.fetch = jest.fn();
        await expect(createCharge({ amount: 1000 })).rejects.toThrow(/wajib/);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("sukses → return checkout_url + reference + gateway tripay", async () => {
        mockFetchOnce({ success: true, data: { reference: "T-REF-1", checkout_url: "https://tripay.co.id/checkout/T-REF-1", qr_url: "https://q", status: "UNPAID", amount: 10000 } });
        const r = await createCharge(baseProps);
        expect(r).toMatchObject({ url: "https://tripay.co.id/checkout/T-REF-1", reference: "T-REF-1", reffId: "ref-x", gateway: "tripay", qrUrl: "https://q" });
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toMatch(/api-sandbox\/transaction\/create$/);
        expect(opts.headers.Authorization).toBe("Bearer APIKEY-SBX");
        // body form-encoded berisi signature + merchant_ref + order item
        expect(opts.body).toMatch(/merchant_ref=ref-x/);
        expect(opts.body).toMatch(/signature=/);
    });

    test("success:false → throw message", async () => {
        mockFetchOnce({ success: false, message: "Channel tidak aktif" });
        await expect(createCharge(baseProps)).rejects.toThrow(/Channel tidak aktif/);
    });

    test("tanpa checkout_url → throw", async () => {
        mockFetchOnce({ success: true, data: { reference: "T", status: "UNPAID" } });
        await expect(createCharge(baseProps)).rejects.toThrow(/checkout_url/);
    });
});

describe("tripay.getChannels", () => {
    test("hanya channel active + normalisasi", async () => {
        mockFetchOnce({ success: true, data: [
            { code: "QRIS", name: "QRIS", group: "E-Wallet", active: true, icon_url: "q.png", total_fee: { flat: 750, percent: 0 } },
            { code: "OFF", name: "Off", active: false }
        ]});
        const ch = await getChannels();
        expect(ch.map(c => c.method)).toEqual(["QRIS"]);
        expect(ch[0]).toMatchObject({ name: "QRIS", fee: 750, logo: "q.png" });
    });

    test("success:false → throw", async () => {
        mockFetchOnce({ success: false, message: "nope" });
        await expect(getChannels()).rejects.toThrow(/nope/);
    });
});

describe("tripay.checkTransaction (verifikasi callback)", () => {
    test("status PAID → paid:true + referenceId(merchant_ref) + amount", async () => {
        mockFetchOnce({ success: true, data: { status: "PAID", merchant_ref: "ref-x", amount: 10000 } });
        const r = await checkTransaction("T-REF-1");
        expect(r).toMatchObject({ ok: true, paid: true, referenceId: "ref-x", amount: 10000 });
    });

    test("status UNPAID → paid:false", async () => {
        mockFetchOnce({ success: true, data: { status: "UNPAID", merchant_ref: "ref-x" } });
        const r = await checkTransaction("T-REF-1");
        expect(r).toMatchObject({ ok: true, paid: false });
    });

    test("reference kosong → tidak panggil fetch", async () => {
        global.fetch = jest.fn();
        const r = await checkTransaction("");
        expect(r).toMatchObject({ ok: false, paid: false });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("success:false → ok:false paid:false (fail-closed)", async () => {
        mockFetchOnce({ success: false, message: "not found" });
        const r = await checkTransaction("T-FAKE");
        expect(r).toMatchObject({ ok: false, paid: false });
    });
});
