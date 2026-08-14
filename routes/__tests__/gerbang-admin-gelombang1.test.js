/**
 * Header Doc
 * Purpose: Tes regresi bahwa peran `teknisi`/`agen` tak bisa lagi menyentuh operasi yang
 *          seharusnya admin — PIN agen (kredensial uang), penimpaan database pelanggan,
 *          broadcast massal, dan penulisan ulang template pesan pelanggan.
 * Caller: Jest test runner.
 * Deps: `express`, `http`, `../agents`, `../admin-database-routes`, `../admin-content-routes`.
 * MainFuncs: `panggil`.
 * SideEffects: Server HTTP ephemeral di 127.0.0.1. Service di-mock — yang diuji GERBANGNYA,
 *              dan justru dibuktikan lewat "service tak pernah terpanggil".
 */
"use strict";

const express = require("express");
const http = require("http");

const PERAN = {
    teknisi: { id: 9, username: "teknisi1", role: "teknisi" },
    agen: { id: 8, username: "agen1", role: "agen" },
    admin: { id: 1, username: "admin", role: "admin" },
};

async function panggil(app, metode, path, badan) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
            method: metode,
            headers: { "Content-Type": "application/json" },
            body: badan ? JSON.stringify(badan) : undefined,
        });
        return { status: res.status, teks: await res.text() };
    } finally {
        await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    }
}

function bungkus(mount, router, peran) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = PERAN[peran];
        next();
    });
    app.use(mount, router);
    return app;
}

describe("PIN agen reseller hanya boleh disentuh admin", () => {
    const agentsRouter = require("../agents");

    // PIN + nomor WA agen adalah yang mengotorisasi confirmTransaction — yang mengkredit
    // saldo pelanggan dan mengaktifkan stok voucher.
    const mutasiBerbahaya = [
        ["POST", "/api/agents/AGT001/pin/create", { pin: "1234", whatsappNumber: "628111" }],
        ["PUT", "/api/agents/AGT001/pin/reset", { pin: "1234" }],
        ["PUT", "/api/agents/AGT001/pin/change", { oldPin: "0000", pin: "1234" }],
        ["DELETE", "/api/agents/delete/AGT001", null],
        ["PUT", "/api/agents/update/AGT001", { name: "Dibajak" }],
        ["POST", "/api/agents/add", { name: "Palsu" }],
    ];

    describe.each(["teknisi", "agen"])("peran %s", (peran) => {
        test.each(mutasiBerbahaya)("%s %s ditolak 403", async (metode, path, badan) => {
            const res = await panggil(bungkus("/api/agents", agentsRouter, peran), metode, path, badan);
            expect(res.status).toBe(403);
        });
    });

    test("agen tak bisa mengintip daftar agen lain", async () => {
        const res = await panggil(bungkus("/api/agents", agentsRouter, "agen"), "GET", "/api/agents/list");
        expect(res.status).toBe(403);
    });
});

describe("Operasi database pelanggan hanya boleh admin", () => {
    const { registerAdminDatabaseRoutes } = require("../admin-database-routes");

    function app(peran) {
        const router = express.Router();
        registerAdminDatabaseRoutes(router, {
            ensureAuthenticatedStaff: (req, res, next) => next(),
            logActivity: async () => {},
        });
        const a = bungkus("/", router, peran);
        // Error handler minimal supaya createError(403) jadi status HTTP, seperti di produksi.
        a.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ message: err.message }));
        return a;
    }

    const operasiMerusak = [
        ["POST", "/api/database/upload"],
        ["POST", "/api/database/restore"],
        ["POST", "/api/database/reload"],
        ["POST", "/api/database/migrate-schema"],
    ];

    test.each(operasiMerusak)("teknisi ditolak pada %s %s", async (metode, path) => {
        const res = await panggil(app("teknisi"), metode, path, {});
        expect(res.status).toBe(403);
    });
});

describe("Broadcast massal & penulisan template hanya boleh admin", () => {
    const { registerAdminContentRoutes } = require("../admin-content-routes");
    // Dipakai ulang dari suite kontrak yang sudah ada — bentuk deps registrar ini rumit,
    // dan menebaknya sendiri hanya menghasilkan tes yang gagal karena alasan yang salah.
    const { buatDepsKonten } = require("./helpers/admin-content-deps");

    let broadcastTerpanggil;

    function app(peran) {
        broadcastTerpanggil = 0;
        const deps = buatDepsKonten();
        deps.adminBroadcastService = {
            queueBroadcast: async () => {
                broadcastTerpanggil += 1;
                return { status: 200, message: "terkirim" };
            },
            previewBroadcast: () => {
                broadcastTerpanggil += 1;
                return { status: 200, message: "pratinjau" };
            },
        };

        const router = express.Router();
        registerAdminContentRoutes(router, deps);
        const a = bungkus("/", router, peran);
        a.use((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ message: err.message }));
        return a;
    }

    test("teknisi tak bisa broadcast ke SELURUH pelanggan", async () => {
        const res = await panggil(app("teknisi"), "POST", "/api/broadcast", {
            mode: "all",
            text: "pesan massal",
        });

        expect(res.status).toBe(403);
        // Bukti terkuat: antrean broadcast tak pernah tersentuh.
        expect(broadcastTerpanggil).toBe(0);
    });

    test("teknisi tak bisa memakai pratinjau untuk memanen daftar penerima", async () => {
        const res = await panggil(app("teknisi"), "POST", "/api/broadcast/preview", { mode: "all" });

        expect(res.status).toBe(403);
        expect(broadcastTerpanggil).toBe(0);
    });

    test("teknisi tak bisa menulis ulang template pesan pelanggan", async () => {
        const res = await panggil(app("teknisi"), "POST", "/api/templates", {
            responseTemplates: { welcome: "disabotase" },
        });

        expect(res.status).toBe(403);
    });

    test.each([
        ["POST", "/api/announcements"],
        ["POST", "/api/news"],
    ])("teknisi ditolak pada %s %s", async (metode, path) => {
        const res = await panggil(app("teknisi"), metode, path, { title: "x", content: "y" });
        expect(res.status).toBe(403);
    });
});
