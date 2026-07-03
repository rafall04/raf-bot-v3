"use strict";

/**
 * Header Doc
 * Purpose: Guardrail proxy portal — registrasi (Turnstile portal, area guard, passthrough bot) &
 *   voucher (`/api/area/:area/:type` allowlist, passthrough, anti-bocor antar-area). axios & turnstile
 *   di-mock (tidak hit jaringan).
 * Caller: Jest (`npx jest routes/__tests__/portal-proxy.test.js`).
 * Deps: axios (mock), lib/turnstile (mock), http, express, lib/portal-app; global.config stub.
 * SideEffects: HTTP server ephemeral (listen(0)) lalu ditutup.
 */

jest.mock("axios");
jest.mock("../../lib/turnstile", () => ({ verifyTurnstile: jest.fn() }));

const axios = require("axios");
const { verifyTurnstile } = require("../../lib/turnstile");
const http = require("http");
const express = require("express");
const path = require("path");
const { createPortalApp } = require("../../lib/portal-app");

function makeRuntime() {
    return { config: global.config, getConfig() { return global.config; } };
}

let server;
let baseUrl;

beforeAll((done) => {
    global.config = {
        company: { name: "RAF NET" },
        turnstile: { enabled: true, siteKey: "sk", secretKey: "secret" },
        portal: {
            brand: { name: "RAF NET" },
            areas: [
                { id: "dander", label: "DANDER", baseUrl: "http://127.0.0.1:3011", enabled: true },
                { id: "tanjung", label: "TANJUNG", baseUrl: "http://127.0.0.1:3201", enabled: true },
                { id: "off", label: "OFF", baseUrl: "http://127.0.0.1:3299", enabled: false }
            ]
        }
    };
    const app = createPortalApp(makeRuntime(), express, { projectRoot: path.join(__dirname, "..", "..") });
    server = http.createServer(app);
    server.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        done();
    });
});

afterAll((done) => {
    if (server) server.close(done);
    else done();
});

beforeEach(() => {
    jest.clearAllMocks();
    verifyTurnstile.mockResolvedValue({ ok: true });
});

function postReg(body) {
    return fetch(`${baseUrl}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

describe("POST /api/register (proxy ke bot area)", () => {
    test("Turnstile gagal → 403, TIDAK proxy", async () => {
        verifyTurnstile.mockResolvedValue({ ok: false });
        const res = await postReg({ area: "dander", name: "Budi", phone: "08123456789", address: "Jl X" });
        expect(res.status).toBe(403);
        expect(axios).not.toHaveBeenCalled();
    });

    test("area tak valid → 400", async () => {
        const res = await postReg({ area: "nope", name: "Budi", phone: "08123456789", address: "Jl X" });
        expect(res.status).toBe(400);
    });

    test("area disabled → 503", async () => {
        const res = await postReg({ area: "off", name: "Budi", phone: "08123456789", address: "Jl X" });
        expect(res.status).toBe(503);
    });

    test("sukses → passthrough status+message bot; proxy ke endpoint bot tanpa turnstileToken", async () => {
        axios.mockResolvedValue({ status: 201, data: { status: 201, message: "Pendaftaran berhasil!" } });
        const res = await postReg({ area: "dander", name: "Budi", phone: "08123456789", address: "Jl Mawar" });
        expect(res.status).toBe(201);
        expect((await res.json()).message).toBe("Pendaftaran berhasil!");
        const cfg = axios.mock.calls[0][0];
        expect(cfg.url).toBe("http://127.0.0.1:3011/api/public/register");
        expect(cfg.method).toBe("post");
        expect(cfg.data.turnstileToken).toBeUndefined();
    });
});

describe("GET /api/area/:area/:type (proxy voucher)", () => {
    test("buy → passthrough reff; URL bot benar", async () => {
        axios.mockResolvedValue({ status: 200, data: { status: 200, data: "reff123" } });
        const res = await fetch(`${baseUrl}/api/area/dander/buy/PROF?phone=628&email=a@a`);
        expect(res.status).toBe(200);
        expect((await res.json()).data).toBe("reff123");
        expect(axios.mock.calls[0][0].url).toBe("http://127.0.0.1:3011/app/buy/PROF");
    });

    test("type tak di-allowlist → 400 (tak proxy path sembarang)", async () => {
        const res = await fetch(`${baseUrl}/api/area/dander/admin/x`);
        expect(res.status).toBe(400);
        expect(axios).not.toHaveBeenCalled();
    });

    test("qr → binary image/png", async () => {
        axios.get.mockResolvedValue({ status: 200, data: Buffer.from("PNG"), headers: { "content-type": "image/png" } });
        const res = await fetch(`${baseUrl}/api/area/dander/qr/reff123`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/png");
    });

    test("anti-bocor: reff milik Dander di-poll ke area Tanjung → diarahkan ke bot TANJUNG (404 passthrough)", async () => {
        axios.mockResolvedValue({ status: 404, data: { status: 404, message: "" } });
        const res = await fetch(`${baseUrl}/api/area/tanjung/statustrx/reffMilikDander`);
        expect(res.status).toBe(404);
        expect(axios.mock.calls[0][0].url).toBe("http://127.0.0.1:3201/app/statustrx/reffMilikDander");
    });

    test("area tak dikenal → 404", async () => {
        const res = await fetch(`${baseUrl}/api/area/evil/voucher`);
        expect(res.status).toBe(404);
    });
});
