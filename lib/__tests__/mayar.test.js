"use strict";

const mayar = require("../mayar");

describe("lib/mayar client", () => {
    let calls;

    function mockFetch(responder) {
        calls = [];
        global.fetch = jest.fn(async (url, opts) => {
            calls.push({ url, opts });
            const { status, json } = responder(url, opts);
            return { status: status || 200, json: async () => json };
        });
    }

    beforeEach(() => {
        global.config = {
            mayarApiKey: "PROD_KEY",
            mayarSandboxApiKey: "SANDBOX_KEY",
            mayarSandbox: true,
        };
    });

    afterEach(() => {
        delete global.fetch;
        delete global.config;
    });

    test("createInvoice: kirim body benar ke sandbox + Bearer key sandbox, balikan data.link", async () => {
        mockFetch(() => ({ json: { statusCode: 200, data: { id: "inv_123", link: "https://sandbox.myr.id/inv_123", status: "created", amount: 125000 } } }));

        const r = await mayar.createInvoice({
            amount: 125000, name: "Widodo", phone: "628979154212",
            email: "x@bill.local", comment: "Tagihan PAKET-125K", returnUrl: "https://x/bayar-status",
        });

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe("https://api.mayar.club/hl/v1/invoice/create");
        expect(calls[0].opts.method).toBe("POST");
        expect(calls[0].opts.headers.Authorization).toBe("Bearer SANDBOX_KEY");
        const body = JSON.parse(calls[0].opts.body);
        expect(body.email).toBe("x@bill.local");
        expect(body.mobile).toBe("628979154212");
        expect(body.redirectUrl).toBe("https://x/bayar-status");
        expect(body.items).toEqual([{ quantity: 1, rate: 125000, description: "Tagihan PAKET-125K" }]);

        expect(r.url).toBe("https://sandbox.myr.id/inv_123");
        expect(r.reference).toBe("inv_123");
        expect(r.gateway).toBe("mayar");
    });

    test("createInvoice: pakai base PRODUKSI + key produksi saat mayarSandbox=false", async () => {
        global.config.mayarSandbox = false;
        mockFetch(() => ({ json: { data: { id: "inv_9", link: "https://x.myr.id/inv_9" } } }));

        await mayar.createInvoice({ amount: 50000, name: "A", email: "a@b.c" });

        expect(calls[0].url).toBe("https://api.mayar.id/hl/v1/invoice/create");
        expect(calls[0].opts.headers.Authorization).toBe("Bearer PROD_KEY");
    });

    test("createInvoice: lempar bila tak ada link di respons", async () => {
        mockFetch(() => ({ json: { data: { id: "inv_x" } } }));
        await expect(mayar.createInvoice({ amount: 1000, name: "A", email: "a@b.c" })).rejects.toThrow(/link pembayaran/i);
    });

    test("checkTransaction: paid=true untuk status lunas, false selain itu", async () => {
        mockFetch(() => ({ json: { data: { id: "inv_1", status: "SUCCESS", amount: 125000 } } }));
        const ok = await mayar.checkTransaction("inv_1", { sandbox: true });
        expect(ok.ok).toBe(true);
        expect(ok.paid).toBe(true);
        expect(ok.amount).toBe(125000);
        expect(calls[0].url).toBe("https://api.mayar.club/hl/v1/invoice/inv_1");

        mockFetch(() => ({ json: { data: { id: "inv_2", status: "created" } } }));
        const pending = await mayar.checkTransaction("inv_2", { sandbox: true });
        expect(pending.paid).toBe(false);
    });

    test("checkTransaction: envelope error (tidak throw) saat data kosong", async () => {
        mockFetch(() => ({ status: 404, json: { messages: "not found" } }));
        const r = await mayar.checkTransaction("nope");
        expect(r.ok).toBe(false);
        expect(r.paid).toBe(false);
    });
});
