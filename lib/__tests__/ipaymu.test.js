/**
 * Test iPaymu client — fokus pada checkTransaction (verifikasi server-to-server
 * yang mengamankan callback dari forgery) + pay() creation.
 */
"use strict";

const ipaymu = require("../ipaymu");
const { checkTransaction, pay, _buildSignature, _resolveCreds } = ipaymu;

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
