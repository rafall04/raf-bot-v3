/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan composition root HTTP dan bot meneruskan runtime eksplisit ke boundary aktif.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, `../../lib/routes-registry`, dan source `../../index.js`.
 * MainFuncs: Memverifikasi route registry menerima runtime dan `msgHandler` dipanggil dengan payload runtime.
 * SideEffects: Tidak ada; membaca source statis dan memanggil registry dengan mock app.
 */
"use strict";

const fs = require("fs");
const path = require("path");

jest.mock("../public", () => ({ __routerName: "public" }));
jest.mock("../api", () => ({ __routerName: "api" }));
jest.mock("../tickets", () => ({ __routerName: "tickets" }));
jest.mock("../invoice", () => ({ __routerName: "invoice" }));
jest.mock("../payment-status", () => ({ __routerName: "payment-status" }));
jest.mock("../requests", () => ({ __routerName: "requests" }));
jest.mock("../compensation", () => ({ __routerName: "compensation" }));
jest.mock("../speed-requests", () => ({ __routerName: "speed-requests" }));
jest.mock("../stats", () => ({ __routerName: "stats" }));
jest.mock("../users", () => ({ __routerName: "users" }));
jest.mock("../accounts", () => ({ __routerName: "accounts" }));
jest.mock("../packages", () => ({ __routerName: "packages" }));
jest.mock("../saldo", () => ({ __routerName: "saldo" }));
jest.mock("../agents", () => ({ __routerName: "agents" }));
jest.mock("../pages", () => ({ __routerName: "pages" }));
jest.mock("../monitoring-api", () => ({ __routerName: "monitoring-api" }));
jest.mock("../kasbon", () => ({ __routerName: "kasbon" }));
jest.mock("../partial-payment", () => ({ __routerName: "partial-payment" }));
jest.mock("../discount", () => ({ __routerName: "discount" }));
jest.mock("../change-package", () => ({ __routerName: "change-package" }));
jest.mock("../message-templates", () => ({ __routerName: "message-templates" }));
jest.mock("../rekap-keuangan", () => ({ __routerName: "rekap-keuangan" }));
jest.mock("../expenses", () => ({ __routerName: "expenses" }));
jest.mock("../gaji", () => ({ __routerName: "gaji" }));
jest.mock("../olt", () => ({ __routerName: "olt" }));
jest.mock("../technician-settlement", () => ({ __routerName: "technician-settlement" }));
jest.mock("../admin-router", () => ({
    createAdminRouter: jest.fn(() => ({ __routerName: "admin" }))
}));

const { createAdminRouter } = require("../admin-router");
const { registerRoutes } = require("../../lib/routes-registry");

describe("runtime wiring", () => {
    test("route registry forwards runtime to createAdminRouter", () => {
        const app = { use: jest.fn() };
        const runtime = { id: "runtime-1" };

        registerRoutes(app, runtime);

        expect(createAdminRouter).toHaveBeenCalledWith({ runtime });
    });

    test("index forwards runtime into message handler calls", () => {
        const source = fs.readFileSync(path.join(__dirname, "..", "..", "index.js"), "utf8");

        expect(source).toContain("registerRoutes(app, runtime);");
        expect(source).toContain("await msgHandler(raf, msg, m, { runtime });");
    });
});
