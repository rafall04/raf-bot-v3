/**
 * Test selector multi-gateway: pemilihan aktif via config + routing chargeRedirect/verify
 * ke adapter yang benar (iPaymu payHosted vs Tripay createCharge dgn method default).
 */
"use strict";

jest.mock("../ipaymu", () => ({
    payHosted: jest.fn(async () => ({ url: "https://ipaymu/pay", sessionId: "SESS-1" })),
    checkTransaction: jest.fn(async () => ({ ok: true, paid: true })),
}));
jest.mock("../tripay", () => ({
    createCharge: jest.fn(async (p) => ({ url: "https://tripay/checkout", reference: "TRX-T", method: p.method })),
    checkTransaction: jest.fn(async () => ({ ok: true, paid: true })),
}));

const ipaymu = require("../ipaymu");
const tripay = require("../tripay");
const gateways = require("../payment-gateways");

beforeEach(() => { jest.clearAllMocks(); global.config = {}; });

describe("payment-gateways selector", () => {
    test("getActiveName: tripay / ipaymu / fallback unknown→ipaymu / default→ipaymu", () => {
        global.config = { paymentGateway: "tripay" };
        expect(gateways.getActiveName()).toBe("tripay");
        global.config = { paymentGateway: "ipaymu" };
        expect(gateways.getActiveName()).toBe("ipaymu");
        global.config = { paymentGateway: "xyz" };
        expect(gateways.getActiveName()).toBe("ipaymu");
        global.config = {};
        expect(gateways.getActiveName()).toBe("ipaymu");
    });

    test("ipaymu.chargeRedirect → payHosted, reference NULL (callback pakai payload trx_id)", async () => {
        global.config = { paymentGateway: "ipaymu" };
        const r = await gateways.getActive().chargeRedirect({ amount: 10000, reffId: "r1" });
        expect(ipaymu.payHosted).toHaveBeenCalled();
        expect(r).toMatchObject({ url: "https://ipaymu/pay", reference: null, sessionId: "SESS-1", gateway: "ipaymu" });
    });

    test("tripay.chargeRedirect → createCharge dgn method default QRIS, reference terisi", async () => {
        global.config = { paymentGateway: "tripay" };
        const r = await gateways.getActive().chargeRedirect({ amount: 10000, reffId: "r1" });
        expect(tripay.createCharge).toHaveBeenCalledWith(expect.objectContaining({ method: "QRIS", reffId: "r1" }));
        expect(r).toMatchObject({ url: "https://tripay/checkout", reference: "TRX-T", gateway: "tripay" });
    });

    test("tripay method bisa di-override via config.tripayDefaultMethod", async () => {
        global.config = { paymentGateway: "tripay", tripayDefaultMethod: "BRIVA" };
        await gateways.getActive().chargeRedirect({ amount: 10000, reffId: "r1" });
        expect(tripay.createCharge).toHaveBeenCalledWith(expect.objectContaining({ method: "BRIVA" }));
    });

    test("verify mendelegasikan ke checkTransaction gateway aktif", async () => {
        global.config = { paymentGateway: "tripay" };
        await gateways.getActive().verify("TRX-T", { sandbox: true });
        expect(tripay.checkTransaction).toHaveBeenCalledWith("TRX-T", { sandbox: true });
    });
});
