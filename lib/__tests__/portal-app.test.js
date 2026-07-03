"use strict";

/**
 * Header Doc
 * Purpose: Guardrail app portal — pastikan portal MENYAJIKAN halaman terpadu (landing dgn pemilih
 *   area, /daftar, /voucher) TAPI TIDAK punya surface admin (login/.php/API admin/Socket.IO).
 * Caller: Jest (`npx jest lib/__tests__/portal-app.test.js`).
 * Deps: http, express, path, ../portal-app; global.config stub (turnstile off, 1 area).
 * SideEffects: HTTP server ephemeral (listen(0)) lalu ditutup.
 */

const http = require("http");
const express = require("express");
const path = require("path");

const { createPortalApp } = require("../portal-app");

function makeRuntime() {
    return { config: global.config, getConfig() { return global.config; } };
}

let server;
let baseUrl;

beforeAll((done) => {
    global.config = {
        company: { name: "RAF NET" },
        turnstile: { enabled: false },
        portal: {
            brand: { name: "RAF NET" },
            areas: [{ id: "dander", label: "DANDER", baseUrl: "http://127.0.0.1:59999", enabled: true }]
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

describe("portal-app (portal publik terpadu)", () => {
    test("GET / → 200 landing dengan pemilih area", async () => {
        const res = await fetch(`${baseUrl}/`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Pilih area");
        expect(html).toContain("DANDER");
    });

    test("GET /daftar → 200 form + dropdown area", async () => {
        const res = await fetch(`${baseUrl}/daftar`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Daftar Pasang Baru");
        expect(html).toContain('name="area"');
    });

    test("GET /voucher → 200 (portal-voucher.html area-aware)", async () => {
        const res = await fetch(`${baseUrl}/voucher`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Voucher WiFi");
        expect(html).toContain("areaSel");
    });

    test("surface admin TIDAK ADA di portal: /login, .php, /api/users, /socket.io → 404", async () => {
        for (const p of ["/login", "/x.php", "/api/users", "/socket.io/?EIO=4&transport=polling"]) {
            const res = await fetch(`${baseUrl}${p}`);
            expect(res.status).toBe(404);
        }
    });
});
