/**
 * Header Doc
 * Purpose: Unit test route admin bot Telegram teknisi — list (whitelist+status+config sanitasi),
 *          add/remove/toggle, config save (normalisasi+keep token+restart), dan auth gating.
 * Caller: Jest targeted test.
 * Deps: `routes/admin-telegram-teknisi-routes.js`, Express, HTTP server lokal ephemeral.
 * MainFuncs: Verifikasi `registerAdminTelegramTeknisiRoutes` end-to-end dgn deps terinjeksi.
 * SideEffects: HTTP server lokal hanya selama test.
 */
"use strict";

const express = require("express");
const http = require("http");
const { registerAdminTelegramTeknisiRoutes, normalizeTeknisiConfig } = require("../admin-telegram-teknisi-routes");

function request(app, method, path, payload) {
    return new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            const body = payload ? JSON.stringify(payload) : "";
            const req = http.request(
                { host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
                (res) => {
                    let data = "";
                    res.on("data", (c) => (data += c));
                    res.on("end", () =>
                        server.close(() => {
                            let parsed = null;
                            try { parsed = data ? JSON.parse(data) : null; } catch (__e) { parsed = { raw: data }; }
                            resolve({ status: res.statusCode, body: parsed });
                        })
                    );
                }
            );
            req.on("error", (e) => server.close(() => reject(e)));
            if (body) req.write(body);
            req.end();
        });
    });
}

function fakeRepo(initial = []) {
    let store = initial.map((x) => ({ ...x }));
    return {
        list: jest.fn(() => store.map((x) => ({ ...x }))),
        add: jest.fn(({ chatId, name, addedBy }) => {
            const e = { chatId, name: name || "", addedBy: addedBy || "", addedAt: "T", enabled: true };
            store.push(e);
            return { ...e };
        }),
        remove: jest.fn((id) => {
            const before = store.length;
            store = store.filter((x) => x.chatId !== id);
            return store.length < before;
        }),
        setEnabled: jest.fn((id, enabled) => {
            const e = store.find((x) => x.chatId === id);
            if (!e) return null;
            e.enabled = enabled;
            return { ...e };
        }),
        _store: () => store,
    };
}

function buildApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    if (overrides.user !== undefined) {
        app.use((req, _res, next) => { req.user = overrides.user; next(); });
    }
    const router = express.Router();
    registerAdminTelegramTeknisiRoutes(router, {
        ensureAuthenticatedStaff: (_req, _res, next) => next(),
        repository: overrides.repository || fakeRepo(),
        readConfig: overrides.readConfig || (() => ({})),
        writeConfig: overrides.writeConfig || (() => {}),
        setRuntimeConfig: overrides.setRuntimeConfig || (() => {}),
        restartBot: overrides.restartBot || (() => {}),
        getStatus: overrides.getStatus || (() => ({ running: true, lastPollAt: "2026-06-22T00:00:00Z" })),
        logActivity: overrides.logActivity || (async () => {}),
    });
    app.use(router);
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ status: error.status || 500, message: error.message }));
    return app;
}

describe("admin-telegram-teknisi-routes", () => {
    test("GET /list → whitelist + status + config tersanitasi (tanpa token)", async () => {
        const repo = fakeRepo([{ chatId: "100", name: "Budi", enabled: true }]);
        const app = buildApp({ repository: repo, readConfig: () => ({ telegramTeknisi: { enabled: true, botToken: "SECRET", pollTimeoutSec: 40 } }) });
        const res = await request(app, "GET", "/api/admin/telegram-teknisi/list");
        expect(res.status).toBe(200);
        expect(res.body.data.technicians).toHaveLength(1);
        expect(res.body.data.config).toEqual({ enabled: true, pollTimeoutSec: 40, tokenConfigured: true });
        // Token mentah TIDAK boleh bocor.
        expect(JSON.stringify(res.body)).not.toContain("SECRET");
    });

    test("POST /add → repo.add dipanggil; chatId kosong → 400", async () => {
        const repo = fakeRepo();
        const app = buildApp({ repository: repo, user: { role: "admin", username: "adm" } });
        const ok = await request(app, "POST", "/api/admin/telegram-teknisi/add", { chatId: "555", name: "Eko" });
        expect(ok.status).toBe(200);
        expect(repo.add).toHaveBeenCalledWith({ chatId: "555", name: "Eko", addedBy: "adm" });

        const bad = await request(app, "POST", "/api/admin/telegram-teknisi/add", { name: "x" });
        expect(bad.status).toBe(400);
    });

    test("POST /remove → 404 bila tidak ada", async () => {
        const repo = fakeRepo([{ chatId: "100", enabled: true }]);
        const app = buildApp({ repository: repo, user: { role: "admin" } });
        const ok = await request(app, "POST", "/api/admin/telegram-teknisi/remove", { chatId: "100" });
        expect(ok.status).toBe(200);
        const notFound = await request(app, "POST", "/api/admin/telegram-teknisi/remove", { chatId: "999" });
        expect(notFound.status).toBe(404);
    });

    test("POST /toggle → setEnabled; 404 bila tidak ada", async () => {
        const repo = fakeRepo([{ chatId: "100", enabled: true }]);
        const app = buildApp({ repository: repo, user: { role: "admin" } });
        const res = await request(app, "POST", "/api/admin/telegram-teknisi/toggle", { chatId: "100", enabled: false });
        expect(res.status).toBe(200);
        expect(repo.setEnabled).toHaveBeenCalledWith("100", false);
    });

    test("POST /config → simpan telegramTeknisi (token kosong dipertahankan), reload + restart", async () => {
        const writeConfig = jest.fn();
        const setRuntimeConfig = jest.fn();
        const restartBot = jest.fn();
        const app = buildApp({
            user: { role: "admin" },
            readConfig: () => ({ existing: 1, telegramTeknisi: { botToken: "OLD", pollTimeoutSec: 50 } }),
            writeConfig,
            setRuntimeConfig,
            restartBot,
        });
        const res = await request(app, "POST", "/api/admin/telegram-teknisi/config", { enabled: true, botToken: "", pollTimeoutSec: 60 });
        expect(res.status).toBe(200);
        const saved = writeConfig.mock.calls[0][0];
        expect(saved.existing).toBe(1); // field lain dipertahankan
        expect(saved.telegramTeknisi).toEqual({ enabled: true, botToken: "OLD", pollTimeoutSec: 60 });
        expect(setRuntimeConfig).toHaveBeenCalled();
        expect(restartBot).toHaveBeenCalled();
        // respons tidak membocorkan token
        expect(JSON.stringify(res.body)).not.toContain("OLD");
    });

    test("auth gating: role non-privileged (teknisi) → 403 untuk write, GET tetap boleh", async () => {
        const writeConfig = jest.fn();
        const app = buildApp({ user: { role: "teknisi" }, writeConfig });
        const post = await request(app, "POST", "/api/admin/telegram-teknisi/add", { chatId: "1" });
        expect(post.status).toBe(403);
        const get = await request(app, "GET", "/api/admin/telegram-teknisi/list");
        expect(get.status).toBe(200);
    });
});

describe("normalizeTeknisiConfig", () => {
    test("token kosong → pertahankan token lama; pollTimeoutSec di-clamp; enabled bool", () => {
        const c = normalizeTeknisiConfig({ enabled: "true", botToken: "  ", pollTimeoutSec: 9999 }, { botToken: "KEEP", pollTimeoutSec: 50 });
        expect(c).toEqual({ enabled: true, botToken: "KEEP", pollTimeoutSec: 300 });
    });
    test("token baru menimpa; default poll 50 saat invalid", () => {
        const c = normalizeTeknisiConfig({ enabled: false, botToken: "NEW", pollTimeoutSec: "x" }, {});
        expect(c).toEqual({ enabled: false, botToken: "NEW", pollTimeoutSec: 50 });
    });
});
