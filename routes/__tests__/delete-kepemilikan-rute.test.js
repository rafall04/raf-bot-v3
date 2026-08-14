/**
 * Header Doc
 * Purpose: Membuktikan `DELETE /api/:category/:id` di admin-ops TIDAK lagi membayangi pemilik
 *          domain yang di-mount setelahnya (users/accounts/packages), sementara kategori legacy
 *          yang memang tak punya pemilik TETAP dilayaninya.
 * Caller: Jest test runner.
 * Deps: `express`, `./helpers/panggil-http`, `../admin-ops-routes`.
 * MainFuncs: `bangunAppUrutanNyata`.
 * SideEffects: Server HTTP ephemeral di 127.0.0.1. Service admin-ops di-mock — tes ini menguji
 *              PERUTEAN, bukan penghapusan.
 *
 * KENAPA ADA: bug aslinya tak terlihat dari membaca satu berkas. `adminApiRouter` di-mount di
 * lib/routes-registry.js baris 57, pemilik `DELETE /users/:id` baru di baris 78 — sehingga
 * penghapusan pelanggan lewat web tak pernah memutus sesi PPPoE maupun menghapus secret di
 * MikroTik ("modem hantu"). Yang harus dijaga adalah URUTAN MOUNT, jadi tes ini menyusun
 * ulang urutan itu, bukan memanggil satu router saja.
 */
"use strict";

jest.mock("../../services/admin-ops.service", () => ({
    createAdminOpsService: () => ({
        deleteEntityByCategory: jest.fn(async ({ category, id }) => ({
            status: 200,
            message: `legacy menghapus ${category}/${id}`,
        })),
        deleteAllUsers: jest.fn(),
        cleanupOrphanedPhotos: jest.fn(),
    }),
}));

const express = require("express");
const { panggilHttp } = require("./helpers/panggil-http");
const { registerAdminOpsRoutes } = require("../admin-ops-routes");

function bangunAppUrutanNyata(peran = { id: 1, username: "admin", role: "admin" }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = peran;
        next();
    });

    // 1) adminApiRouter — di produksi di-mount PALING AWAL.
    const adminApiRouter = express.Router();
    registerAdminOpsRoutes(adminApiRouter, {
        ensureAuthenticatedStaff: (req, res, next) => next(),
        logActivity: async () => {},
    });
    app.use("/", adminApiRouter);

    // 2) Pemilik-pemilik yang di-mount SETELAHNYA. Diwakili penanda supaya jelas siapa
    //    yang benar-benar melayani request.
    const pemilikUsers = express.Router();
    pemilikUsers.delete("/users/:id", (req, res) =>
        res.json({ pemilik: "api-users-routes", langkah: { secret_dihapus: { dijalankan: true, ok: true } } })
    );
    const pemilikAccounts = express.Router();
    pemilikAccounts.delete("/accounts/:id", (req, res) => res.json({ pemilik: "accounts" }));
    const pemilikPackages = express.Router();
    pemilikPackages.delete("/api/packages/:id", (req, res) => res.json({ pemilik: "packages" }));

    app.use("/", pemilikPackages);
    app.use("/api", pemilikAccounts);
    app.use("/api", pemilikUsers);

    app.use((req, res) => res.status(404).json({ pemilik: "tidak-ada" }));
    return app;
}

// Helper bersama: http.request TANPA keep-alive. Pola "server baru per request" + `fetch`
// (yang memakai connection pool) sesekali gagal `TypeError: fetch failed`.
async function hapus(app, path) {
    return panggilHttp(app, "DELETE", path);
}

describe("DELETE /api/:category/:id tidak lagi membayangi pemilik domain", () => {
    test("hapus pelanggan mendarat di pemilik yang memutus PPPoE, bukan catch-all legacy", async () => {
        const res = await hapus(bangunAppUrutanNyata(), "/api/users/42");

        expect(res.status).toBe(200);
        expect(res.json.pemilik).toBe("api-users-routes");
        // Bukti perilakunya, bukan sekadar rutenya: respons membawa `langkah` yang dipakai
        // static/js/users.js untuk menampilkan hasil per-langkah.
        expect(res.json.langkah.secret_dihapus.ok).toBe(true);
        expect(res.json.message).toBeUndefined();
    });

    test("hapus akun staf mendarat di routes/accounts.js", async () => {
        const res = await hapus(bangunAppUrutanNyata(), "/api/accounts/3");
        expect(res.json.pemilik).toBe("accounts");
    });

    test("hapus paket mendarat di routes/packages.js", async () => {
        const res = await hapus(bangunAppUrutanNyata(), "/api/packages/7");
        expect(res.json.pemilik).toBe("packages");
    });

    test.each(["payment", "statik", "voucher", "atm", "payment-method", "mikrotik-devices"])(
        "kategori legacy '%s' TETAP dilayani admin-ops",
        async (kategori) => {
            const res = await hapus(bangunAppUrutanNyata(), `/api/${kategori}/9`);

            expect(res.status).toBe(200);
            expect(res.json.message).toBe(`legacy menghapus ${kategori}/9`);
        }
    );

    test("kategori tak dikenal tidak diam-diam ditelan catch-all", async () => {
        const res = await hapus(bangunAppUrutanNyata(), "/api/entah-apa/1");

        expect(res.status).toBe(404);
        expect(res.json.pemilik).toBe("tidak-ada");
    });
});
