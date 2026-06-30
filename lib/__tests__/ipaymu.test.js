/**
 * Test iPaymu client — fokus pada checkTransaction (verifikasi server-to-server
 * yang mengamankan callback dari forgery) + pay() creation.
 */
"use strict";

const ipaymu = require("../ipaymu");
const { checkTransaction, pay, payDirect, payHosted, getPaymentChannels, _buildSignature, _resolveCreds } = ipaymu;

const realFetch = global.fetch;

function mockFetchOnce(jsonBody, { status = 200 } = {}) {
    global.fetch = jest.fn().mockResolvedValue({
        status,
        json: async () => jsonBody,
    });
}

beforeEach(() => {
    global.config = {
        ipaymuProduction: false,
        ipaymuCallback: "https://bot.example/callback/payment",
    };
});

afterAll(() => {
    global.fetch = realFetch;
});

describe("ipaymu.checkTransaction (verifikasi callback)", () => {
    test("Status 1 → paid:true + referenceId + amount", async () => {
        mockFetchOnce({ Success: true, Data: { Status: 1, StatusDesc: "Berhasil", ReferenceId: "abc123", Amount: 50000 } });
        const r = await checkTransaction("TRX-1");
        expect(r).toMatchObject({ ok: true, paid: true, referenceId: "abc123", amount: 50000 });
    });

    test("StatusDesc 'Berhasil' tetap paid walau Status bukan 1", async () => {
        mockFetchOnce({ Success: true, Data: { Status: 99, StatusDesc: "Berhasil" } });
        const r = await checkTransaction("TRX-2");
        expect(r.paid).toBe(true);
    });

    test("status pending → paid:false", async () => {
        mockFetchOnce({ Success: true, Data: { Status: 0, StatusDesc: "Pending" } });
        const r = await checkTransaction("TRX-3");
        expect(r).toMatchObject({ ok: true, paid: false });
    });

    test("iPaymu Success:false → ok:false paid:false (TOLAK kredit)", async () => {
        mockFetchOnce({ Success: false, Message: "Transaction not found" });
        const r = await checkTransaction("TRX-FAKE");
        expect(r).toMatchObject({ ok: false, paid: false });
        expect(r.error).toMatch(/not found/i);
    });

    test("trxId kosong → ok:false paid:false, tidak panggil fetch", async () => {
        global.fetch = jest.fn();
        const r = await checkTransaction("");
        expect(r).toMatchObject({ ok: false, paid: false });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("network error → ok:false paid:false (fail-closed, tidak kredit)", async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
        const r = await checkTransaction("TRX-4");
        expect(r).toMatchObject({ ok: false, paid: false });
        expect(r.error).toMatch(/ECONNRESET/);
    });

    test("kirim signature + va header ke endpoint /transaction", async () => {
        mockFetchOnce({ Success: true, Data: { Status: 1 } });
        await checkTransaction("TRX-5");
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toMatch(/\/api\/v2\/transaction$/);
        expect(opts.headers.signature).toBeTruthy();
        expect(opts.headers.va).toBeTruthy();
        expect(JSON.parse(opts.body)).toEqual({ transactionId: "TRX-5" });
    });
});

describe("ipaymu.pay (creation)", () => {
    const validProps = {
        amount: 50000, comment: "Topup", reffId: "ref-1",
        name: "Budi", phone: "62812", email: "b@x.com"
    };

    // pay() throw STRING (konvensi codebase untuk pesan user) → pakai rejects.toMatch.
    test("throw kalau field wajib kurang", async () => {
        await expect(pay({ amount: 1000 })).rejects.toMatch(/Required/);
    });

    test("throw kalau ipaymuCallback belum di-set", async () => {
        global.config = { ipaymuProduction: false }; // no callback
        await expect(pay(validProps)).rejects.toMatch(/Callback/);
    });

    test("throw kalau produksi tapi kredensial kosong", async () => {
        global.config = { ipaymuProduction: true, ipaymuCallback: "https://x/cb" };
        await expect(pay(validProps)).rejects.toMatch(/payment|kredensial/i);
    });

    test("throw STRING (bukan Error) supaya pesan tampil ke user", async () => {
        let thrown;
        try { await pay({ amount: 1000 }); } catch (e) { thrown = e; }
        expect(typeof thrown).toBe("string");
    });

    test("sukses → return struktur QR + trxId", async () => {
        mockFetchOnce({ Success: true, Data: { TransactionId: 777, QrString: "QR-DATA", Fee: 100, FeeDirection: "BUYER", Expired: "2026-01-01", Total: 50100 } });
        const r = await pay(validProps);
        expect(r).toMatchObject({ id: 777, reffId: "ref-1", subTotal: 50000, qrString: "QR-DATA", gateway: "ipaymu", total: 50100 });
    });

    test("iPaymu Success:false → throw Message", async () => {
        mockFetchOnce({ Success: false, Message: "Saldo merchant kurang" });
        await expect(pay(validProps)).rejects.toMatch(/Saldo merchant/);
    });

    test("Data tanpa QrString → throw (tidak crash optional chaining)", async () => {
        mockFetchOnce({ Success: true, Data: {} });
        await expect(pay(validProps)).rejects.toMatch(/QrString/);
    });
});

describe("ipaymu.getPaymentChannels", () => {
    test("hanya kembalikan channel active + online, grup kosong dibuang", async () => {
        mockFetchOnce({
            Success: true,
            Data: [
                { Code: "qris", Name: "QRIS", Channels: [
                    { Code: "mpm", Name: "QRIS", FeatureStatus: "active", HealthStatus: "online", TransactionFee: { ActualFee: 0.7, ActualFeeType: "PERCENT", AdditionalFee: 0 } }
                ]},
                { Code: "va", Name: "Virtual Account", Channels: [
                    { Code: "bca", Name: "BCA", FeatureStatus: "active", HealthStatus: "online", TransactionFee: { ActualFee: 4500, ActualFeeType: "FLAT" } },
                    { Code: "offlinebank", Name: "X", FeatureStatus: "active", HealthStatus: "offline" }
                ]},
                { Code: "cc", Name: "Credit Card", Channels: [
                    { Code: "cc", Name: "CC", FeatureStatus: "inactive", HealthStatus: "online" }
                ]}
            ]
        });
        const groups = await getPaymentChannels();
        expect(groups.map(g => g.method)).toEqual(["qris", "va"]); // cc (inactive) dibuang
        const va = groups.find(g => g.method === "va");
        expect(va.channels.map(c => c.channel)).toEqual(["bca"]); // offline dibuang
        expect(va.channels[0]).toMatchObject({ fee: 4500, feeType: "FLAT" });
    });

    test("Success:false → throw Error", async () => {
        mockFetchOnce({ Success: false, Message: "nope" });
        await expect(getPaymentChannels()).rejects.toThrow(/nope/);
    });
});

describe("ipaymu.payDirect (multi-channel)", () => {
    const baseProps = { amount: 150000, comment: "Tagihan", reffId: "ref-x", name: "Budi", phone: "62812", email: "b@x.com" };

    test("VA → normalisasi paymentNo + total + via", async () => {
        mockFetchOnce({ Success: true, Data: {
            TransactionId: 999, Via: "VA", Channel: "BCA", PaymentNo: "3811800086431345",
            PaymentName: "Toko", SubTotal: 150000, Fee: 4500, Total: 154500, Expired: "2026-06-29 20:00:00"
        }});
        const r = await payDirect({ ...baseProps, paymentMethod: "va", paymentChannel: "bca" });
        expect(r).toMatchObject({
            id: 999, reffId: "ref-x", paymentMethod: "va", paymentChannel: "bca",
            via: "VA", channelLabel: "BCA", paymentNo: "3811800086431345", total: 154500, qrString: null
        });
    });

    test("cstore → bawa note + storeFee", async () => {
        mockFetchOnce({ Success: true, Data: {
            TransactionId: 1000, Via: "Convenience Store", Channel: "ALFAMART", PaymentNo: "1001513878217",
            SubTotal: 150000, Fee: 4000, StoreFee: 2500, Total: 156500, Note: "Bayar di ALFAMART kode 1001513878217"
        }});
        const r = await payDirect({ ...baseProps, paymentMethod: "cstore", paymentChannel: "alfamart" });
        expect(r).toMatchObject({ paymentNo: "1001513878217", storeFee: 2500, note: expect.stringMatching(/ALFAMART/) });
    });

    test("field channel kurang → throw Error (tidak panggil fetch)", async () => {
        global.fetch = jest.fn();
        await expect(payDirect({ ...baseProps })).rejects.toThrow(/paymentMethod/);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("Success:false → throw Error (bukan string)", async () => {
        mockFetchOnce({ Success: false, Message: "Channel nonaktif" });
        await expect(payDirect({ ...baseProps, paymentMethod: "va", paymentChannel: "bca" })).rejects.toThrow(/Channel nonaktif/);
    });
});

describe("ipaymu.payHosted (sesi redirect — halaman iPaymu)", () => {
    const baseProps = { amount: 150000, comment: "Tagihan REG - Budi", reffId: "ref-h", name: "Budi", phone: "62812", email: "b@x.com" };

    test("sukses → return url + sessionId, POST ke /payment (bukan /payment/direct)", async () => {
        mockFetchOnce({ Success: true, Data: { SessionID: "sess-123", Url: "https://my.ipaymu.com/payment/sess-123" } });
        const r = await payHosted(baseProps);
        expect(r).toMatchObject({ url: "https://my.ipaymu.com/payment/sess-123", sessionId: "sess-123", reffId: "ref-h", gateway: "ipaymu" });
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toMatch(/\/api\/v2\/payment$/); // endpoint hosted, bukan /payment/direct
        const body = JSON.parse(opts.body);
        expect(body).toMatchObject({ referenceId: "ref-h", feeDirection: "BUYER", buyerName: "Budi" });
        expect(body.price).toEqual([150000]);
        expect(body.qty).toEqual([1]);
        expect(body.notifyUrl).toBe("https://bot.example/callback/payment");
    });

    test("returnUrl/cancelUrl diteruskan", async () => {
        mockFetchOnce({ Success: true, Data: { SessionID: "s", Url: "https://pay/s" } });
        await payHosted({ ...baseProps, returnUrl: "https://bot.example/bayar-status", cancelUrl: "https://bot.example/bayar/tok" });
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.returnUrl).toBe("https://bot.example/bayar-status");
        expect(body.cancelUrl).toBe("https://bot.example/bayar/tok");
    });

    test("field wajib kurang → throw Error (tidak panggil fetch)", async () => {
        global.fetch = jest.fn();
        await expect(payHosted({ amount: 1000 })).rejects.toThrow(/wajib/);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test("Success:false → throw Error", async () => {
        mockFetchOnce({ Success: false, Message: "Akun belum aktif" });
        await expect(payHosted(baseProps)).rejects.toThrow(/Akun belum aktif/);
    });

    test("Data tanpa Url → throw (tak bisa redirect)", async () => {
        mockFetchOnce({ Success: true, Data: { SessionID: "s" } });
        await expect(payHosted(baseProps)).rejects.toThrow(/URL/);
    });

    test("sandbox → request ke endpoint sandbox", async () => {
        global.config = { ipaymuProduction: true, ipaymuVA: "REALVA", ipaymuSecret: "REALSECRET", ipaymuCallback: "https://x/cb" };
        mockFetchOnce({ Success: true, Data: { SessionID: "s", Url: "https://pay/s" } });
        await payHosted({ ...baseProps, sandbox: true });
        expect(global.fetch.mock.calls[0][0]).toMatch(/sandbox\.ipaymu\.com/);
    });
});

describe("ipaymu sandbox per-call (uji tanpa toggle global)", () => {
    test("_resolveCreds(true) → base sandbox + demo creds (abaikan config produksi)", () => {
        global.config = { ipaymuProduction: true, ipaymuVA: "REALVA", ipaymuSecret: "REALSECRET" };
        const c = _resolveCreds(true);
        expect(c.base).toMatch(/sandbox/);
        expect(c.va).not.toBe("REALVA");
        expect(c.apikey).not.toBe("REALSECRET");
    });

    test("payDirect sandbox → request ke endpoint sandbox", async () => {
        global.config = { ipaymuProduction: true, ipaymuVA: "REALVA", ipaymuSecret: "REALSECRET", ipaymuCallback: "https://x/cb" };
        mockFetchOnce({ Success: true, Data: { TransactionId: 1, QrString: "Q" } });
        await payDirect({ amount: 10000, comment: "t", reffId: "r", name: "n", phone: "62", email: "e@x.com", paymentMethod: "qris", paymentChannel: "mpm", sandbox: true });
        expect(global.fetch.mock.calls[0][0]).toMatch(/sandbox\.ipaymu\.com/);
    });

    test("payDirect non-sandbox → endpoint produksi (isolasi: pelanggan asli tak terpengaruh)", async () => {
        global.config = { ipaymuProduction: true, ipaymuVA: "REALVA", ipaymuSecret: "REALSECRET", ipaymuCallback: "https://x/cb" };
        mockFetchOnce({ Success: true, Data: { TransactionId: 1, QrString: "Q" } });
        await payDirect({ amount: 10000, comment: "t", reffId: "r", name: "n", phone: "62", email: "e@x.com", paymentMethod: "qris", paymentChannel: "mpm" });
        expect(global.fetch.mock.calls[0][0]).toMatch(/my\.ipaymu\.com/);
    });
});

describe("ipaymu signature", () => {
    test("deterministik untuk input sama", () => {
        const body = { a: 1, b: "x" };
        const s1 = _buildSignature("POST", body, "VA1", "KEY1");
        const s2 = _buildSignature("POST", body, "VA1", "KEY1");
        expect(s1).toBe(s2);
        expect(s1).toMatch(/^[a-f0-9]{64}$/); // HMAC-SHA256 hex
    });

    test("sandbox pakai demo creds kalau config kosong", () => {
        global.config = { ipaymuProduction: false };
        const creds = _resolveCreds();
        expect(creds.production).toBe(false);
        expect(creds.va).toBeTruthy();
        expect(creds.apikey).toBeTruthy();
        expect(creds.base).toMatch(/sandbox/);
    });
});
