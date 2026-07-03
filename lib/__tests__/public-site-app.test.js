"use strict";

/**
 * Header Doc
 * Purpose: Guardrail listener publik — pastikan app publik (lib/public-site-app) MENYAJIKAN surface
 *   anonim (landing /, /voucher) TAPI TIDAK punya surface admin (login, .php, /api/* admin, Socket.IO)
 *   sehingga tak ada yang bisa di-brute-force di port publik. Mengunci invariant pemisahan surface.
 * Caller: Jest (`npx jest lib/__tests__/public-site-app.test.js`).
 * Deps: http, express, path, ../public-site-app; global.config/global.packages stub.
 * SideEffects: Membuka HTTP server ephemeral (listen(0)) lalu ditutup.
 */

const http = require("http");
const express = require("express");
const path = require("path");

const { createPublicSiteApp } = require("../public-site-app");

function makeRuntime() {
    return { config: global.config, getConfig() { return global.config; } };
}

let server;
let baseUrl;

beforeAll((done) => {
    global.config = {
        company: {
            name: "RAF NET TEST",
            address: "Jl. Test No. 1",
            phone: "6281234567890",
            email: "test@rafnet.id",
            website: "https://rafnet.test"
        }
    };
    global.packages = [
        { name: "10 Mbps", price: 150000 },
        { name: "PAKET-VOUCHER", price: 5000 },
        { name: "20 Mbps", price: 200000, whitelist: false }
    ];
    global.payment = [];

    const app = createPublicSiteApp(makeRuntime(), express, {
        projectRoot: path.join(__dirname, "..", "..")
    });
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

describe("public-site-app (listener publik anonim)", () => {
    test("GET / → 200 landing berisi nama usaha + paket (voucher paket disembunyikan)", async () => {
        const res = await fetch(`${baseUrl}/`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("RAF NET TEST");
        expect(html).toContain("10 Mbps");
        expect(html).toContain("20 Mbps");
        expect(html).not.toContain("PAKET-VOUCHER");
    });

    test("GET /voucher → 200 (halaman beli voucher anonim tersaji di port publik)", async () => {
        const res = await fetch(`${baseUrl}/voucher`);
        expect(res.status).toBe(200);
    });

    test("surface admin TIDAK ADA di port publik: /login, .php, /api/users → 404", async () => {
        for (const p of ["/login", "/dashboard.php", "/api/users"]) {
            const res = await fetch(`${baseUrl}${p}`);
            expect(res.status).toBe(404);
        }
    });

    test("tak ada Socket.IO staf di app publik: handshake → 404", async () => {
        const res = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`);
        expect(res.status).toBe(404);
    });

    test("GET /daftar → 200 form registrasi (server-rendered)", async () => {
        const res = await fetch(`${baseUrl}/daftar`);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Daftar Pasang Baru");
        expect(html).toContain('name="phone"');
    });

    test("POST /api/public/register body kosong → 400 (validasi menolak sebelum service)", async () => {
        const res = await fetch(`${baseUrl}/api/public/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        expect(res.status).toBe(400);
    });
});
