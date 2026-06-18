/**
 * Header Doc
 * Purpose: Guardrail untuk `lib/http-app.js` — memastikan `trust proxy` disetel sehingga `req.ip`
 *          membaca IP klien asli dari X-Forwarded-For (Cloudflare Tunnel) dan express-rate-limit
 *          tidak lagi melempar ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
 * Caller: Jest.
 * Deps: `../http-app`, `../http-security`, `express`, `http`.
 * MainFuncs: Menguji `resolveTrustProxy` dan perilaku `createHttpApp`.
 * SideEffects: Membuka HTTP server sementara di 127.0.0.1 lalu menutupnya.
 */
"use strict";

const express = require("express");
const http = require("http");
const { createHttpApp, resolveTrustProxy } = require("../http-app");
const { createGlobalLimiter } = require("../http-security");

// IP klien yang "dipalsukan" oleh proxy/tunnel lewat X-Forwarded-For.
const CLIENT_IP = "203.0.113.7";

async function startServer(app) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe("lib/http-app trust proxy", () => {
    describe("resolveTrustProxy", () => {
        test("default ke 'loopback' saat config tidak menyetel trustProxy", () => {
            expect(resolveTrustProxy({ config: {} })).toBe("loopback");
            expect(resolveTrustProxy({})).toBe("loopback");
            expect(resolveTrustProxy(undefined)).toBe("loopback");
        });

        test("menghormati override config.trustProxy (mis. hop count angka)", () => {
            expect(resolveTrustProxy({ config: { trustProxy: 1 } })).toBe(1);
        });

        test("menghormati false eksplisit untuk mematikan", () => {
            expect(resolveTrustProxy({ config: { trustProxy: false } })).toBe(false);
        });

        test("mengutamakan getConfig() di atas properti config", () => {
            const runtime = {
                config: { trustProxy: "from-config" },
                getConfig: () => ({ trustProxy: "from-getConfig" })
            };
            expect(resolveTrustProxy(runtime)).toBe("from-getConfig");
        });
    });

    describe("createHttpApp", () => {
        test("menyetel Express 'trust proxy' ke default loopback", () => {
            const app = createHttpApp({ config: {} }, express);
            expect(app.get("trust proxy")).toBe("loopback");
        });

        test("req.ip membaca IP klien dari X-Forwarded-For saat di belakang loopback", async () => {
            const app = createHttpApp({ config: {} }, express);
            app.get("/whoami", (req, res) => res.json({ ip: req.ip }));

            const { server, baseUrl } = await startServer(app);
            try {
                const response = await fetch(`${baseUrl}/whoami`, {
                    headers: { "X-Forwarded-For": CLIENT_IP }
                });
                const payload = await response.json();
                expect(response.status).toBe(200);
                expect(payload.ip).toBe(CLIENT_IP);
            } finally {
                await stopServer(server);
            }
        });

        test("req.ip mengabaikan X-Forwarded-For saat trustProxy dimatikan", async () => {
            const app = createHttpApp({ config: { trustProxy: false } }, express);
            app.get("/whoami", (req, res) => res.json({ ip: req.ip }));

            const { server, baseUrl } = await startServer(app);
            try {
                const response = await fetch(`${baseUrl}/whoami`, {
                    headers: { "X-Forwarded-For": CLIENT_IP }
                });
                const payload = await response.json();
                expect(response.status).toBe(200);
                expect(payload.ip).not.toBe(CLIENT_IP);
                // Tanpa trust proxy, req.ip = alamat peer (loopback), bukan IP dari header.
                expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).toContain(payload.ip);
            } finally {
                await stopServer(server);
            }
        });

        test("express-rate-limit tidak melempar ERR_ERL_UNEXPECTED_X_FORWARDED_FOR", async () => {
            const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
            const app = createHttpApp({ config: {} }, express);
            app.use(createGlobalLimiter());
            app.get("/limited", (req, res) => res.json({ ok: true, ip: req.ip }));

            const { server, baseUrl } = await startServer(app);
            try {
                const response = await fetch(`${baseUrl}/limited`, {
                    headers: { "X-Forwarded-For": CLIENT_IP }
                });
                const payload = await response.json();
                expect(response.status).toBe(200);
                expect(payload.ok).toBe(true);
                expect(payload.ip).toBe(CLIENT_IP);

                const offending = errorSpy.mock.calls
                    .flat()
                    .map((arg) => (arg && arg.message ? arg.message : String(arg)))
                    .some((text) => text.includes("ERR_ERL_UNEXPECTED_X_FORWARDED_FOR"));
                expect(offending).toBe(false);
            } finally {
                errorSpy.mockRestore();
                await stopServer(server);
            }
        });
    });
});
