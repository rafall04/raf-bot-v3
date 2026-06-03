/**
 * Header Doc
 * Purpose: Guardrail test untuk router API rekap tunggakan.
 * Caller: Jest test runner.
 * Deps: `../arrears`.
 * MainFuncs: Memverifikasi endpoint read-model dan summary mengembalikan payload service.
 * SideEffects: Tidak ada.
 */
"use strict";

jest.mock("../../services/arrears.service", () => ({
    createArrearsService: jest.fn()
}));

const express = require("express");
const http = require("http");
const { createArrearsService } = require("../../services/arrears.service");
const createArrearsRouter = require("../arrears");

function createApp(service) {
    createArrearsService.mockReturnValue(service);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { id: 1, username: "raf", role: "admin" };
        next();
    });
    app.use("/api/arrears", createArrearsRouter());
    return app;
}

async function startServer(app) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

describe("arrears routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test("GET /api/arrears/read-model returns rows and summary from service", async () => {
        const service = {
            getArrearsReadModel: jest.fn(async () => ({
                rows: [{ user_id: 1, total_outstanding: 110000 }],
                summary: { total_customers_in_arrears: 1 }
            })),
            getCustomerArrearsDetail: jest.fn(async () => ({
                customer: null,
                unpaid_periods: [],
                payment_timeline: [],
                total_outstanding: 0
            }))
        };
        const app = createApp(service);
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/arrears/read-model?period_month=4&period_year=2026`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.status).toBe(200);
            expect(payload.data.rows).toHaveLength(1);
            expect(service.getArrearsReadModel).toHaveBeenCalledWith({ periodMonth: 4, periodYear: 2026 });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/arrears/summary returns summary-only projection", async () => {
        const service = {
            getArrearsReadModel: jest.fn(async () => ({
                rows: [],
                summary: { total_customers_in_arrears: 2, total_outstanding: 300000 }
            })),
            getCustomerArrearsDetail: jest.fn(async () => ({
                customer: null,
                unpaid_periods: [],
                payment_timeline: [],
                total_outstanding: 0
            }))
        };
        const app = createApp(service);
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/arrears/summary?period_month=4&period_year=2026`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.data).toEqual({ total_customers_in_arrears: 2, total_outstanding: 300000 });
        } finally {
            await stopServer(server);
        }
    });
});
