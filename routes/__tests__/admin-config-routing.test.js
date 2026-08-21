/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan owner route konfigurasi parameter GenieACS dan device MikroTik aktif di registrar config baru.
 * Caller: Jest test runner.
 * Deps: `express` dan `../admin-config-routes`.
 * MainFuncs: Memverifikasi endpoint CRUD `genieacs-parameters` dan `mikrotik-devices` terpasang di admin config registrar.
 * SideEffects: Tidak ada.
 */
"use strict";

const express = require("express");
const { registerAdminConfigRoutes } = require("../admin-config-routes");

describe("admin config routing", () => {
    test("registrar mengekspos owner route CRUD genieacs-parameters dan mikrotik-devices", () => {
        const router = express.Router();
        registerAdminConfigRoutes({
            router,
            ensureAuthenticatedStaff: (_req, _res, next) => next(),
            logActivity: jest.fn(),
            loadJSON: jest.fn().mockReturnValue([]),
            saveJSON: jest.fn()
        });

        const paths = router.stack
            .filter((layer) => layer.route)
            .map((layer) => `${Object.keys(layer.route.methods)[0]}:${layer.route.path}`);

        expect(paths).toContain("get:/api/genieacs-parameters");
        expect(paths).toContain("post:/api/genieacs-parameters");
        expect(paths).toContain("put:/api/genieacs-parameters/:id");
        expect(paths).toContain("delete:/api/genieacs-parameters/:id");
        expect(paths).toContain("get:/api/mikrotik-devices");
        expect(paths).toContain("get:/api/mikrotik-devices/:id");
        expect(paths).toContain("post:/api/mikrotik-devices");
        expect(paths).toContain("put:/api/mikrotik-devices/:id");
        expect(paths).toContain("post:/api/mikrotik-devices/set-active/:id");
    });

    // !! KEBOCORAN KREDENSIAL YANG SUDAH TERBUKTI DI PRODUKSI (2026-08-21).
    // `listDevices()` memulangkan isi `database/mikrotik_devices.json` APA ADANYA — host, port,
    // user, dan `password` tanpa redaksi. Kedua GET dulu hanya bergerbang
    // `ensureAuthenticatedStaff`, yang MEMASUKKAN peran teknisi, sementara POST/PUT/set-active
    // sudah ber-`requireAdmin`. Terbukti live: akun teknisi menerima host router inti + sandinya.
    describe("gerbang kredensial perangkat MikroTik", () => {
        function buatRouter() {
            const router = express.Router();
            registerAdminConfigRoutes({
                router,
                ensureAuthenticatedStaff: (_req, _res, next) => next(),
                logActivity: jest.fn(),
                loadJSON: jest.fn().mockReturnValue([]),
                saveJSON: jest.fn()
            });
            return router;
        }

        async function panggil(router, method, path, user) {
            const layer = router.stack.find(
                (l) => l.route && l.route.path === path && l.route.methods[method]
            );
            const handlers = layer.route.stack.map((e) => e.handle);
            const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(p2) { this.body = p2; return this; } };
            const req = { body: {}, params: { id: "1" }, query: {}, user };
            let galat = null;
            for (const h of handlers) {
                if (galat) break;
                let teruskan = false;
                const next = (e) => { if (e) galat = e; else teruskan = true; };
                try { await h(req, res, next); } catch (e) { galat = e; }
                if (!teruskan && !galat) break;
            }
            return { res, galat };
        }

        test.each([
            ["get", "/api/mikrotik-devices"],
            ["get", "/api/mikrotik-devices/:id"],
        ])("%s %s DITOLAK untuk peran teknisi — ini kredensial router, bukan data lapangan", async (method, path) => {
            const { galat } = await panggil(buatRouter(), method, path, { username: "davin", role: "teknisi" });
            expect(galat).toMatchObject({ statusCode: 403 });
        });

        test("admin TETAP boleh membacanya (halaman /config tak boleh ikut pecah)", async () => {
            const { galat } = await panggil(buatRouter(), "get", "/api/mikrotik-devices", { username: "raf", role: "admin" });
            expect(galat).toBeNull();
        });
    });
});
