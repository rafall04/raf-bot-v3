"use strict";

/**
 * Header Doc
 * Purpose: Guardrail helper portal — resolveArea whitelist (anti-SSRF), getReadyAreas (health),
 *   dan proxy helper mengirim HEADER BERSIH (tanpa XFF/cookie/authorization pembeli ke bot).
 * Caller: Jest (`npx jest lib/__tests__/portal-areas.test.js`).
 * Deps: axios (di-mock); global.config.portal stub.
 * SideEffects: Tidak ada (axios di-mock).
 */

jest.mock("axios");
const axios = require("axios");
const { resolveArea, isAreaEnabled, getReadyAreas, proxyJson, proxyBinary, _clearHealthCache } = require("../portal-areas");

beforeEach(() => {
    jest.clearAllMocks();
    _clearHealthCache();
    global.config = {
        portal: {
            areas: [
                { id: "dander", label: "DANDER", baseUrl: "http://127.0.0.1:3011", enabled: true },
                { id: "tanjung", label: "TANJUNG", baseUrl: "http://127.0.0.1:3201", enabled: false }
            ]
        }
    };
});

describe("resolveArea (whitelist anti-SSRF)", () => {
    test("id valid → area dari config (baseUrl dari config, bukan input)", () => {
        expect(resolveArea("dander").baseUrl).toBe("http://127.0.0.1:3011");
    });
    test("id tak dikenal / path-traversal / URL / non-string → null", () => {
        ["nope", "../etc/passwd", "http://evil.com", "127.0.0.1:9", "", null, 123].forEach((v) => {
            expect(resolveArea(v)).toBeNull();
        });
    });
    test("isAreaEnabled: area enabled:false → false", () => {
        expect(isAreaEnabled(resolveArea("tanjung"))).toBe(false);
        expect(isAreaEnabled(resolveArea("dander"))).toBe(true);
    });
});

describe("getReadyAreas (enabled + health)", () => {
    test("hanya area enabled + health OK yang tampil", async () => {
        axios.get.mockResolvedValue({ status: 200, data: { data: [] } });
        const ready = await getReadyAreas();
        expect(ready).toEqual([{ id: "dander", label: "DANDER" }]); // tanjung disabled → dikecualikan
    });
    test("health gagal (bot mati) → area tak ready", async () => {
        axios.get.mockRejectedValue(new Error("ECONNREFUSED"));
        const ready = await getReadyAreas();
        expect(ready).toEqual([]);
    });
});

describe("proxy header BERSIH", () => {
    test("proxyJson TIDAK mengirim x-forwarded-for / cookie / authorization", async () => {
        axios.mockResolvedValue({ status: 200, data: { ok: true } });
        await proxyJson(resolveArea("dander"), "post", "/api/public/register", { body: { a: 1 } });
        const cfg = axios.mock.calls[0][0];
        const headerKeys = Object.keys(cfg.headers).map((k) => k.toLowerCase());
        expect(headerKeys).not.toContain("x-forwarded-for");
        expect(headerKeys).not.toContain("cookie");
        expect(headerKeys).not.toContain("authorization");
        expect(cfg.url).toBe("http://127.0.0.1:3011/api/public/register");
    });
    test("proxyBinary responseType arraybuffer + header bersih", async () => {
        axios.get.mockResolvedValue({ status: 200, data: Buffer.from("x"), headers: { "content-type": "image/png" } });
        const r = await proxyBinary(resolveArea("dander"), "/app/qr/abc");
        expect(r.contentType).toBe("image/png");
        const cfg = axios.get.mock.calls[0][1];
        expect(cfg.responseType).toBe("arraybuffer");
        expect(Object.keys(cfg.headers).map((k) => k.toLowerCase())).not.toContain("cookie");
    });
});
