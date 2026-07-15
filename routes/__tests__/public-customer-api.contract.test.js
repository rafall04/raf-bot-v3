/**
 * Header Doc
 * Purpose: Contract/e2e audit pack provider-side untuk surface customer API yang dikonsumsi portal eksternal seperti `raff-panel-2`.
 * Caller: Jest test runner dan gate verifikasi integrasi customer portal.
 * Deps: `routes/public.js`, `lib/services/public-auth-service.js`, `lib/customer-token.js`, Express, HTTP server, dan mock boundary service customer/report/speed/wifi/public.
 * MainFuncs: `createApp`, `startServer`, `fetch` (shim retry transport tahan-flake), `createCustomerToken`, suite `public customer API contract`.
 * SideEffects: Menjalankan router HTTP in-memory via server ephemeral; request dikirim lewat shim `fetch` ber-retry transport (anti flake "fetch failed" saat full-suite --runInBand), tanpa mengubah kontrak; memverifikasi JWT customer issuer/audience, tanpa menyentuh database atau jaringan eksternal riil.
 */
"use strict";

const fs = require("fs");
const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const path = require("path");

jest.mock("express-rate-limit", () => jest.fn(() => (_req, _res, next) => next()));

jest.mock("../../lib/ipaymu", () => ({}));
jest.mock("../../lib/mikrotik", () => ({ getvoucher: jest.fn() }));
jest.mock("../../lib/saldo", () => ({
    addKoinUser: jest.fn(),
    addATM: jest.fn(),
    checkATMuser: jest.fn()
}));
jest.mock("../../lib/payment", () => ({
    updateStatusPayment: jest.fn(),
    checkStatusPayment: jest.fn(),
    delPayment: jest.fn(),
    addPayBuy: jest.fn(),
    addPayment: jest.fn(),
    updateKetPayment: jest.fn()
}));
jest.mock("../../lib/voucher", () => ({
    checkprofvc: jest.fn(),
    checkdurasivc: jest.fn(),
    checkhargavc: jest.fn()
}));
jest.mock("../../lib/database", () => ({
    saveReports: jest.fn(),
    saveSpeedRequests: jest.fn(),
    savePackageChangeRequests: jest.fn(),
    loadJSON: jest.fn(() => [])
}));
jest.mock("../../lib/auth-cache", () => ({
    authCache: {
        getAccountByUsername: jest.fn((_username, resolver) => (typeof resolver === "function" ? resolver() : null))
    }
}));
jest.mock("../../lib/password", () => ({
    comparePassword: jest.fn(async (rawPassword) => rawPassword === "correct-password"),
    hashPassword: jest.fn(async (value) => `hashed:${value}`)
}));
jest.mock("../../lib/phone-validator", () => ({
    normalizePhone: jest.fn((value) => String(value || "").replace(/\D/g, ""))
}));
jest.mock("../../lib/utils", () => ({
    normalizePhoneNumber: jest.fn((value) => value)
}));
jest.mock("../../lib/otp", () => ({
    generateSecureOTP: jest.fn(() => "123456"),
    checkOTPRequestLimit: jest.fn(() => ({ allowed: true })),
    checkOTPVerifyLimit: jest.fn(() => ({ allowed: true })),
    resetOTPAttempts: jest.fn(),
    isOTPValid: jest.fn(() => true)
}));
jest.mock("../../lib/error-handler", () => ({
    asyncHandler: jest.fn((handler) => async (req, res, next) => {
        try {
            await handler(req, res, next);
        } catch (error) {
            next(error);
        }
    }),
    createError: jest.fn((type, message, status = 500) => {
        const error = new Error(message);
        error.type = type;
        error.status = status;
        return error;
    }),
    ErrorTypes: {
        RATE_LIMIT_ERROR: "RATE_LIMIT_ERROR",
        AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
        VALIDATION_ERROR: "VALIDATION_ERROR"
    },
    validateRequired: jest.fn(),
    dbOperation: jest.fn(async (_label, operation) => operation())
}));
jest.mock("../../lib/templating", () => ({
    renderTemplate: jest.fn(() => "OTP:123456")
}));
jest.mock("../../lib/template-service", () => ({
    renderCategoryTemplate: jest.fn((_category, key) => ({ text: `tpl:${key}` }))
}));
jest.mock("../../lib/whatsapp-gateway", () => ({
    hasAuthenticatedSession: jest.fn(() => true)
}));
jest.mock("../../lib/ticket-workflow", () => ({
    ensureTicketShape: jest.fn((ticket) => ticket)
}));
jest.mock("../../lib/report-orchestration-service", () => ({
    appendCustomerReportPhoto: jest.fn(async ({ ticketId, photo }) => ({
        ticket: {
            ticketId,
            customerPhotos: [photo]
        }
    }))
}));
jest.mock("../../lib/services/customer-service", () => ({
    getProfile: jest.fn(),
    requestPackageChange: jest.fn(),
    getPackageChangeHistory: jest.fn(),
    getAvailablePackages: jest.fn(),
    updateAccount: jest.fn(),
    getPhoneNumbers: jest.fn(),
    addPhoneNumber: jest.fn(),
    removePhoneNumber: jest.fn()
}));
jest.mock("../../lib/services/report-service", () => ({
    submitReport: jest.fn(),
    getReportHistory: jest.fn(),
    isCustomerActiveStatus: jest.fn(() => true),
    getCustomerPhotoUploadStatuses: jest.fn(() => ["open", "process"])
}));
jest.mock("../../lib/services/speed-request-service", () => ({
    getActiveRequest: jest.fn(),
    getRequestHistory: jest.fn(),
    cancelRequest: jest.fn(),
    isFeatureEnabled: jest.fn(() => true),
    getAvailableSpeedBoosts: jest.fn(() => []),
    getSpeedBoostPackages: jest.fn(() => [])
}));
jest.mock("../../lib/services/public-service", () => ({
    getDashboardStatus: jest.fn(),
    getWifiName: jest.fn(),
    getAnnouncements: jest.fn(),
    getNews: jest.fn()
}));
jest.mock("../../lib/services/wifi-service", () => ({
    getCustomerWifiInfo: jest.fn(),
    getConnectedDevices: jest.fn(),
    updateCustomerWifiName: jest.fn(),
    updateCustomerWifiPassword: jest.fn(),
    updateCustomerWifi: jest.fn(),
    rebootCustomerRouter: jest.fn()
}));
jest.mock("../../lib/customer-traffic-usage-service", () => ({
    getFeatureStatus: jest.fn(() => ({ enabled: true, liveEnabled: true })),
    isFeatureEnabled: jest.fn(() => true),
    getCustomerUsage: jest.fn(),
    getCustomerLiveUsage: jest.fn()
}));
jest.mock("../../lib/whatsapp-delivery-service", () => ({
    sendMessage: jest.fn(async () => ({ sent: true })),
    sendMessageToMany: jest.fn(async () => ({ sent: true }))
}));
jest.mock("../../lib/middleware/validation", () => ({
    loginValidation: (_req, _res, next) => next(),
    customerLoginValidation: (_req, _res, next) => next(),
    otpRequestValidation: (_req, _res, next) => next(),
    otpVerifyValidation: (_req, _res, next) => next(),
    updateAccountValidation: (_req, _res, next) => next(),
    submitReportValidation: (_req, _res, next) => next(),
    requestSpeedValidation: (_req, _res, next) => next(),
    cancelSpeedRequestValidation: (_req, _res, next) => next(),
    requestPackageChangeValidation: (_req, _res, next) => next()
}));
jest.mock("../../lib/path-helper", () => ({
    getReportsUploadsPath: jest.fn((year, month, ticketId, dirname) => require("path").join(dirname, "..", "temp-tests", String(year), String(month), String(ticketId)))
}));
// Sengaja POJO, bukan class: routes/public.js hanya memakai BaseService.getCustomerJids.
// Efek sampingnya jadi guard: kalau ada modul `extends BaseService` (mis. isolir-service) ikut
// tertarik ke graf impor routes/public.js, suite ini pecah dengan
// "Class extends value #<Object> is not a constructor". Itu BUKAN alasan mengubah mock ini jadi
// class — itu tanda ada require berat (mikrotik/genieacs/wifi) yang bocor ke router portal
// pelanggan dan harus dibikin lazy di modulnya (lihat lib/services/bill-payment-settlement.js).
jest.mock("../../lib/services/base-service", () => ({
    getCustomerJids: jest.fn((phoneNumber) => [phoneNumber])
}));

const router = require("../public");
const CustomerService = require("../../lib/services/customer-service");
const ReportService = require("../../lib/services/report-service");
const SpeedRequestService = require("../../lib/services/speed-request-service");
const PublicService = require("../../lib/services/public-service");
const WifiService = require("../../lib/services/wifi-service");
const CustomerTrafficUsageService = require("../../lib/customer-traffic-usage-service");
const { appendCustomerReportPhoto } = require("../../lib/report-orchestration-service");
const { PublicAuthService } = require("../../lib/services/public-auth-service");
const { hasAuthenticatedSession } = require("../../lib/whatsapp-gateway");
const {
    checkOTPRequestLimit,
    checkOTPVerifyLimit,
    isOTPValid,
    resetOTPAttempts
} = require("../../lib/otp");
const {
    buildCustomerTokenPayload,
    CUSTOMER_TOKEN_AUDIENCE,
    CUSTOMER_TOKEN_ISSUER,
    CUSTOMER_TOKEN_VERSION,
    getCustomerTokenVerifyOptions
} = require("../../lib/customer-token");

const tempTestsDir = path.join(__dirname, "..", "..", "temp-tests");

function createApp() {
    const app = express();
    app.use(express.json());
    app.use(router);
    app.use((error, _req, res, _next) => {
        res.status(error.status || 500).json({
            status: error.status || 500,
            message: error.message
        });
    });
    return app;
}

// ── Transport hardening (BUKAN bagian kontrak) ──────────────────────────────
// Saat `npm test` (jest --runInBand, ratusan suite serial dalam 1 proses),
// global fetch (undici) sesekali melempar "TypeError: fetch failed" ke server
// lokal yang SEHAT — socket keep-alive basi / tekanan GC pada connection pool,
// bukan bug router. Gejalanya: suite ini hijau 59/59 standalone tapi kadang
// merah di sebagian full-run (nondeterministik). Kita bungkus fetch dengan
// retry singkat pada kegagalan TRANSPORT saja; bentuk request & response
// (kontrak yang diuji) tidak diubah sama sekali.
const RAW_FETCH = globalThis.fetch.bind(globalThis);
const FETCH_MAX_ATTEMPTS = 4;
const FETCH_RETRY_BASE_DELAY_MS = 25;

function isTransientFetchError(error) {
    if (!error) {
        return false;
    }
    // undici membungkus kegagalan socket sebagai TypeError "fetch failed" + .cause
    if (error.name === "TypeError" && /fetch failed/i.test(String(error.message))) {
        return true;
    }
    const transientCodes = new Set([
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ETIMEDOUT",
        "UND_ERR_SOCKET",
        "UND_ERR_CONNECT_TIMEOUT"
    ]);
    const causeCode = error.cause && error.cause.code;
    return transientCodes.has(error.code) || transientCodes.has(causeCode);
}

// Shadow global `fetch` untuk seluruh file: semua pemanggilan `fetch(...)` di
// bawah otomatis memakai versi tahan-flake ini (lexical scoping), tanpa perlu
// menyentuh body test. fetch hanya throw pada kegagalan JARINGAN (bukan status
// HTTP), jadi retry hanya menyentuh error transport; server test fresh + service
// di-mock membuat pengulangan request aman.
async function fetch(input, init) {
    let lastError;
    for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt += 1) {
        try {
            return await RAW_FETCH(input, init);
        } catch (error) {
            lastError = error;
            if (attempt === FETCH_MAX_ATTEMPTS || !isTransientFetchError(error)) {
                throw error;
            }
            // backoff linear kecil: beri connection pool undici waktu memulihkan socket
            await new Promise((resolve) => setTimeout(resolve, FETCH_RETRY_BASE_DELAY_MS * attempt));
        }
    }
    throw lastError;
}

async function startServer(app) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function stopServer(server) {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function buildCustomer(overrides = {}) {
    return {
        id: 101,
        username: "budi",
        name: "Budi",
        password: "stored-hash",
        phone_number: "08123|628123",
        subscription: "Paket 20 Mbps",
        pppoe_username: "budi-pppoe",
        ...overrides
    };
}

function createCustomerToken(user) {
    return PublicAuthService.buildAuthResponse(user).token;
}

function createExpiredCustomerToken(user) {
    return jwt.sign(buildCustomerTokenPayload(user), global.config.jwt, {
        algorithm: "HS256",
        audience: CUSTOMER_TOKEN_AUDIENCE,
        issuer: CUSTOMER_TOKEN_ISSUER,
        expiresIn: -10
    });
}

function listTempTestFiles(dirPath) {
    if (!fs.existsSync(dirPath)) {
        return [];
    }

    return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(dirPath, entry.name);
        return entry.isDirectory() ? listTempTestFiles(entryPath) : [entryPath];
    });
}

// Longgarkan timeout default (5s): di bawah beban full-suite, request + retry
// transport tak boleh keburu timeout dan menyamar jadi kegagalan kontrak.
jest.setTimeout(20000);

describe("public customer API contract", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.config = { jwt: "customer-contract-secret" };
        global.users = [buildCustomer()];
        global.reports = [];
        global.packages = [];
        global.speed_requests = [];
        global.compensations = [];
        global.announcements = [];
        global.news = [];
        global.db = {
            get: jest.fn((_sql, params, callback) => {
                const user = global.users.find((item) => item.username === params[0]) || null;
                callback(null, user);
            }),
            all: jest.fn((_sql, _params, callback) => callback(null, global.users)),
            run: jest.fn((_sql, _params, callback) => callback.call({ changes: 1 }, null))
        };

        CustomerService.getProfile.mockResolvedValue({
            id: 101,
            name: "Budi",
            subscription: "Paket 20 Mbps"
        });
        CustomerService.updateAccount.mockResolvedValue({
            message: "Akun Anda telah berhasil diperbarui."
        });
        CustomerService.requestPackageChange.mockResolvedValue({
            message: "Permintaan perubahan paket berhasil dikirim"
        });
        CustomerService.getPackageChangeHistory.mockResolvedValue([
            {
                id: "pkgchange_001",
                currentPackageName: "Paket 20 Mbps",
                currentPackagePrice: 200000,
                requestedPackageName: "Paket 50 Mbps",
                requestedPackagePrice: 350000,
                status: "pending",
                createdAt: "2026-04-25T13:00:00.000Z",
                updatedAt: null,
                approvedBy: null,
                notes: null
            }
        ]);
        CustomerService.getAvailablePackages.mockResolvedValue([
            {
                id: 1,
                name: "Paket 20 Mbps",
                price: 200000,
                profile: "20M",
                description: "Paket reguler"
            },
            {
                id: 2,
                name: "Paket 50 Mbps",
                price: 350000,
                profile: "50M",
                description: "Paket upgrade"
            }
        ]);
        CustomerService.getPhoneNumbers.mockResolvedValue(["08123", "628123"]);
        CustomerService.addPhoneNumber.mockResolvedValue({
            added: true,
            phoneNumber: "08999",
            message: "Nomor HP berhasil ditambahkan"
        });
        CustomerService.removePhoneNumber.mockResolvedValue({
            removed: true,
            phoneNumber: "+628123",
            message: "Nomor HP berhasil dihapus"
        });
        WifiService.getCustomerWifiInfo.mockResolvedValue({
            deviceId: "ONT-01",
            ssids: [{ index: 1, name: "BudiNet" }]
        });
        WifiService.getConnectedDevices.mockResolvedValue({
            device_id: "ONT-01",
            total_devices: 1,
            format: "grouped",
            ssid_devices: [
                {
                    ssid_index: 1,
                    ssid_id: "1",
                    ssid_name: "BudiNet",
                    device_count: 1,
                    devices: [
                        {
                            mac_address: "AA:BB:CC:DD:EE:FF",
                            ip_address: "192.168.1.10",
                            host_name: "Budi-Phone",
                            signal_strength: -55,
                            signal_unit: "dBm"
                        }
                    ]
                }
            ]
        });
        WifiService.updateCustomerWifiName.mockResolvedValue({
            deviceId: "ONT-01",
            ssidIndex: 1,
            newName: "BudiNet-Baru",
            updatedAt: "2026-04-25T13:00:00.000Z",
            taskId: "TASK-NAME-001"
        });
        WifiService.updateCustomerWifiPassword.mockResolvedValue({
            deviceId: "ONT-01",
            ssidIndex: 1,
            updatedAt: "2026-04-25T13:00:00.000Z",
            taskId: "TASK-PASS-001"
        });
        WifiService.updateCustomerWifi.mockResolvedValue({ updated: true, deviceId: "ONT-01" });
        WifiService.rebootCustomerRouter.mockResolvedValue({
            deviceId: "ONT-01",
            message: "Perintah reboot berhasil dikirim. Router akan restart dalam beberapa detik.",
            rebootSent: true,
            timestamp: "2026-04-25T13:00:00.000Z"
        });
        SpeedRequestService.getActiveRequest.mockResolvedValue(null);
        SpeedRequestService.getRequestHistory.mockResolvedValue([
            { id: "SR-001", targetPackageName: "Boost 50 Mbps", status: "approved" }
        ]);
        SpeedRequestService.cancelRequest.mockResolvedValue({
            message: "Permintaan speed boost berhasil dibatalkan"
        });
        SpeedRequestService.getAvailableSpeedBoosts.mockResolvedValue([
            {
                name: "Boost 50 Mbps",
                profile: "BOOST50",
                basePrice: 350000,
                durations: {
                    "1_day": { label: "1 Hari", hours: 24, price: 15000 }
                }
            }
        ]);
        SpeedRequestService.getSpeedBoostPackages.mockResolvedValue([
            {
                name: "Boost 50 Mbps",
                price: 350000,
                profile: "BOOST50",
                speedBoostPrices: {
                    "1_day": { label: "1 Hari", hours: 24, price: 15000 }
                }
            }
        ]);
        PublicService.getDashboardStatus.mockResolvedValue({
            activeTicketCount: 1,
            unpaidInvoiceCount: 0
        });
        PublicService.getWifiName.mockResolvedValue({ wifiName: "RAF NET" });
        PublicService.getAnnouncements.mockResolvedValue([
            { id: "ANN-001", message: "Maintenance malam", created_at: "2026-04-25T13:00:00.000Z" }
        ]);
        PublicService.getNews.mockResolvedValue([
            { id: "NEWS-001", title: "Promo baru", content: "Diskon pelanggan", created_at: "2026-04-25T13:00:00.000Z" }
        ]);
        CustomerTrafficUsageService.getFeatureStatus.mockReturnValue({
            enabled: true,
            liveEnabled: true
        });
        CustomerTrafficUsageService.isFeatureEnabled.mockReturnValue(true);
        CustomerTrafficUsageService.getCustomerUsage.mockResolvedValue({
            hasPppoe: true,
            pppoeUsername: "budi-pppoe",
            today: { downloadBytes: 1, uploadBytes: 2, totalBytes: 3 },
            currentMonth: { downloadBytes: 4, uploadBytes: 5, totalBytes: 9 },
            dailyHistory: [],
            lastCollectedAt: "2026-04-25T13:00:00.000Z",
            stale: false
        });
        CustomerTrafficUsageService.getCustomerLiveUsage.mockResolvedValue({
            hasPppoe: true,
            pppoeUsername: "budi-pppoe",
            online: true,
            downloadBps: 1200,
            uploadBps: 600,
            downloadHuman: "1.2 Kbps",
            uploadHuman: "600 bps",
            interfaceName: "pppoe-budi",
            lastSampleAt: "2026-04-25T13:00:00.000Z",
            sampleIntervalMs: 5000,
            stale: false,
            warmup: false
        });
        ReportService.getReportHistory.mockResolvedValue([
            {
                ticketId: "TKT-001",
                category: "internet_mati",
                status: "open",
                createdAt: "2026-04-25T13:00:00.000Z"
            }
        ]);
        ReportService.submitReport.mockResolvedValue({ ticketId: "TKT-001" });
    });

    afterEach(() => {
        if (fs.existsSync(tempTestsDir)) {
            fs.rmSync(tempTestsDir, { recursive: true, force: true });
        }
        delete global.config;
        delete global.users;
        delete global.reports;
        delete global.packages;
        delete global.speed_requests;
        delete global.compensations;
        delete global.announcements;
        delete global.news;
        delete global.db;
    });

    test("POST /api/customer/login issues a customer token with raff-panel-2 audience contract", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ username: "budi", password: "correct-password" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toMatchObject({
                status: 200,
                message: "Login berhasil.",
                data: {
                    token: expect.any(String),
                    user: {
                        id: 101,
                        name: "Budi",
                        phoneNumber: "08123"
                    }
                }
            });
            const token = payload.data.token;
            const decoded = jwt.decode(token);
            expect(token).toEqual(expect.any(String));
            expect(decoded).toMatchObject({
                id: 101,
                name: "Budi",
                tokenType: "customer",
                ver: CUSTOMER_TOKEN_VERSION,
                aud: CUSTOMER_TOKEN_AUDIENCE,
                iss: CUSTOMER_TOKEN_ISSUER
            });
            expect(jwt.verify(token, global.config.jwt, getCustomerTokenVerifyOptions())).toMatchObject({
                id: 101,
                name: "Budi",
                tokenType: "customer"
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/auth/login keeps generic 401 response for wrong password", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ username: "budi", password: "wrong-password" })
            });
            const payload = await response.json();

            expect(response.status).toBe(401);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toEqual({
                status: 401,
                message: "Username atau password salah."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/phone-numbers returns stable phone-number list payload", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/phone-numbers`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Daftar nomor HP berhasil diambil",
                data: ["08123", "628123"]
            });
            expect(CustomerService.getPhoneNumbers).toHaveBeenCalledWith(
                expect.objectContaining({ id: 101 }),
                expect.any(Object)
            );
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/profile rejects missing bearer token", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/profile`);
            const payload = await response.json();

            expect(response.status).toBe(401);
            expect(payload).toEqual({
                status: 401,
                message: "Unauthorized: No token provided."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/profile rejects malformed bearer token with generic auth error", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/profile`, {
                headers: { authorization: "Bearer not-a-real-jwt" }
            });
            const payload = await response.json();

            expect(response.status).toBe(401);
            expect(payload).toEqual({
                status: 401,
                message: "Token tidak valid. Silakan login kembali."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/profile rejects expired bearer token without leaking internals", async () => {
        const expiredToken = createExpiredCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/profile`, {
                headers: { authorization: `Bearer ${expiredToken}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(401);
            expect(payload).toEqual({
                status: 401,
                message: "Sesi Anda telah berakhir. Silakan login kembali."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/profile delegates to CustomerService with authenticated customer context", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/profile`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toMatchObject({
                status: 200,
                message: "Profile berhasil diambil",
                data: {
                    id: 101,
                    name: "Budi",
                    subscription: "Paket 20 Mbps"
                }
            });
            expect(CustomerService.getProfile).toHaveBeenCalledWith(
                expect.objectContaining({ id: 101, username: "budi" }),
                expect.any(Object)
            );
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/auth/login mirrors the customer login token contract", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ username: "budi", password: "correct-password" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toMatchObject({
                status: 200,
                message: "Login berhasil.",
                data: {
                    token: expect.any(String),
                    user: {
                        id: 101,
                        name: "Budi",
                        phoneNumber: "08123"
                    }
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/reports/upload-photo accepts multipart upload and returns photo contract", async () => {
        const token = createCustomerToken(global.users[0]);
        global.reports = [{
            ticketId: "TKT-001",
            pelangganId: global.users[0].phone_number,
            createdAt: "2026-04-25T13:00:00.000Z",
            status: "open"
        }];
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const form = new FormData();
            form.append("ticketId", "TKT-001");
            form.append("photo", new Blob(["fake-image-binary"], { type: "image/png" }), "proof.png");

            const response = await fetch(`${baseUrl}/api/customer/reports/upload-photo`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`
                },
                body: form
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toMatchObject({
                status: 200,
                message: "Foto berhasil diupload (1/3)",
                data: {
                    ticketId: "TKT-001",
                    photoCount: 1,
                    totalPhotos: 1,
                    maxPhotos: 3,
                    photo: {
                        fileName: expect.stringMatching(/^customer_TKT-001_/),
                        uploadedAt: expect.any(String),
                        size: expect.any(Number)
                    }
                }
            });
            expect(appendCustomerReportPhoto).toHaveBeenCalledWith(expect.objectContaining({
                ticketId: "TKT-001",
                actor: {
                    id: 101,
                    username: "Budi",
                    source: "customer_panel"
                },
                maxPhotos: 3,
                allowedStatuses: ["open", "process"],
                photo: expect.objectContaining({
                    fileName: expect.stringMatching(/^customer_TKT-001_/),
                    path: expect.stringContaining(`${path.sep}temp-tests${path.sep}`),
                    uploadedBy: "customer",
                    uploadedVia: "customer_panel",
                    size: expect.any(Number)
                })
            }));
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/reports/upload-photo rejects tickets outside customer ownership and removes temp file", async () => {
        const token = createCustomerToken(global.users[0]);
        global.reports = [{
            ticketId: "TKT-404",
            pelangganId: "other-customer",
            createdAt: "2026-04-25T13:00:00.000Z",
            status: "open"
        }];
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const form = new FormData();
            form.append("ticketId", "TKT-404");
            form.append("photo", new Blob(["fake-image-binary"], { type: "image/png" }), "proof.png");

            const response = await fetch(`${baseUrl}/api/customer/reports/upload-photo`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`
                },
                body: form
            });
            const payload = await response.json();

            expect(response.status).toBe(404);
            expect(payload).toEqual({
                status: 404,
                message: "Tiket tidak ditemukan atau tidak memiliki akses"
            });
            expect(appendCustomerReportPhoto).not.toHaveBeenCalled();
            expect(listTempTestFiles(tempTestsDir)).toEqual([]);
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/reports/upload-photo rejects inactive tickets and removes temp file", async () => {
        const token = createCustomerToken(global.users[0]);
        global.reports = [{
            ticketId: "TKT-CLOSED",
            pelangganId: global.users[0].phone_number,
            createdAt: "2026-04-25T13:00:00.000Z",
            status: "closed"
        }];
        ReportService.isCustomerActiveStatus.mockReturnValueOnce(false);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const form = new FormData();
            form.append("ticketId", "TKT-CLOSED");
            form.append("photo", new Blob(["fake-image-binary"], { type: "image/png" }), "proof.png");

            const response = await fetch(`${baseUrl}/api/customer/reports/upload-photo`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`
                },
                body: form
            });
            const payload = await response.json();

            expect(response.status).toBe(400);
            expect(payload).toEqual({
                status: 400,
                message: "Tidak bisa upload foto. Status tiket: closed"
            });
            expect(appendCustomerReportPhoto).not.toHaveBeenCalled();
            expect(listTempTestFiles(tempTestsDir)).toEqual([]);
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/reports/upload-photo rejects non-image uploads with client error", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const form = new FormData();
            form.append("ticketId", "TKT-001");
            form.append("photo", new Blob(["not-an-image"], { type: "text/plain" }), "proof.txt");

            const response = await fetch(`${baseUrl}/api/customer/reports/upload-photo`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`
                },
                body: form
            });
            const payload = await response.json();

            expect(response.status).toBe(400);
            expect(payload).toEqual({
                status: 400,
                message: "Hanya file gambar yang diperbolehkan"
            });
            expect(appendCustomerReportPhoto).not.toHaveBeenCalled();
            expect(listTempTestFiles(tempTestsDir)).toEqual([]);
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/phone-numbers/add rejects empty phone numbers", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/phone-numbers/add`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({ phoneNumber: "" })
            });
            const payload = await response.json();

            expect(response.status).toBe(400);
            expect(payload).toEqual({
                status: 400,
                message: "Nomor HP tidak boleh kosong."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/phone-numbers/add returns added-phone contract", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/phone-numbers/add`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({ phoneNumber: "08999" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Nomor HP berhasil ditambahkan",
                data: {
                    added: true,
                    phoneNumber: "08999",
                    message: "Nomor HP berhasil ditambahkan"
                }
            });
            expect(CustomerService.addPhoneNumber).toHaveBeenCalledWith(
                expect.objectContaining({ id: 101 }),
                "08999",
                expect.any(Object)
            );
        } finally {
            await stopServer(server);
        }
    });

    test("DELETE /api/customer/phone-numbers/:phoneNumber decodes URL-encoded numbers", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/phone-numbers/%2B628123`, {
                method: "DELETE",
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Nomor HP berhasil dihapus",
                data: {
                    removed: true,
                    phoneNumber: "+628123",
                    message: "Nomor HP berhasil dihapus"
                }
            });
            expect(CustomerService.removePhoneNumber).toHaveBeenCalledWith(
                expect.objectContaining({ id: 101 }),
                "+628123",
                expect.any(Object)
            );
        } finally {
            await stopServer(server);
        }
    });
test("POST /api/customer/phone-numbers/add returns added-phone contract", async () => {
    const token = createCustomerToken(global.users[0]);
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/customer/phone-numbers/add`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ phoneNumber: "08999" })
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            status: 200,
            message: "Nomor HP berhasil ditambahkan",
            data: {
                added: true,
                phoneNumber: "08999",
                message: "Nomor HP berhasil ditambahkan"
            }
        });
        expect(CustomerService.addPhoneNumber).toHaveBeenCalledWith(
            expect.objectContaining({ id: 101 }),
            "08999",
            expect.any(Object)
        );
    } finally {
        await stopServer(server);
    }
});

test("DELETE /api/customer/phone-numbers/:phoneNumber decodes URL-encoded numbers", async () => {
    const token = createCustomerToken(global.users[0]);
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/customer/phone-numbers/%2B628123`, {
            method: "DELETE",
            headers: { authorization: `Bearer ${token}` }
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            status: 200,
            message: "Nomor HP berhasil dihapus",
            data: {
                removed: true,
                phoneNumber: "+628123",
                message: "Nomor HP berhasil dihapus"
            }
        });
        expect(CustomerService.removePhoneNumber).toHaveBeenCalledWith(
            expect.objectContaining({ id: 101 }),
            "+628123",
            expect.any(Object)
        );
    } finally {
        await stopServer(server);
    }
});

test("GET /api/customer/wifi/info forwards skipRefresh=true to WifiService", async () => {
    const token = createCustomerToken(global.users[0]);
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/customer/wifi/info?skipRefresh=true`, {
            headers: { authorization: `Bearer ${token}` }
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            status: 200,
            message: "Info WiFi berhasil diambil",
            data: {
                deviceId: "ONT-01",
                ssids: [{ index: 1, name: "BudiNet" }]
            }
        });
        expect(WifiService.getCustomerWifiInfo).toHaveBeenCalledWith(
            expect.objectContaining({ id: 101 }),
            expect.any(Object),
            true
        );
    } finally {
        await stopServer(server);
    }
});

test("GET /api/customer/wifi/connected-devices returns grouped device payload", async () => {
    const token = createCustomerToken(global.users[0]);
    const app = createApp();
    const { server, baseUrl } = await startServer(app);

    try {
        const response = await fetch(`${baseUrl}/api/customer/wifi/connected-devices?skipRefresh=true`, {
            headers: { authorization: `Bearer ${token}` }
        });
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload).toEqual({
            status: 200,
            message: "Data device terkoneksi berhasil diambil",
            data: {
                device_id: "ONT-01",
                total_devices: 1,
                format: "grouped",
                ssid_devices: [
                    {
                        ssid_index: 1,
                        ssid_id: "1",
                        ssid_name: "BudiNet",
                        device_count: 1,
                        devices: [
                            {
                                mac_address: "AA:BB:CC:DD:EE:FF",
                                ip_address: "192.168.1.10",
                                host_name: "Budi-Phone",
                                signal_strength: -55,
                                signal_unit: "dBm"
                            }
                        ]
                    }
                ]
            }
        });
        expect(WifiService.getConnectedDevices).toHaveBeenCalledWith(
            expect.objectContaining({ id: 101 }),
            expect.any(Object),
            true
        );
    } finally {
        await stopServer(server);
    }
});

    test("POST /api/customer/wifi/update-name delegates WiFi rename payload", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/wifi/update-name`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({ ssidIndex: 1, newName: "BudiNet-Baru" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Nama WiFi berhasil diubah",
                data: {
                    deviceId: "ONT-01",
                    ssidIndex: 1,
                    newName: "BudiNet-Baru",
                    updatedAt: "2026-04-25T13:00:00.000Z",
                    taskId: "TASK-NAME-001"
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/wifi/update-password delegates WiFi password payload", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/wifi/update-password`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({ ssidIndex: 1, newPassword: "password123" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Password WiFi berhasil diubah",
                data: {
                    deviceId: "ONT-01",
                    ssidIndex: 1,
                    updatedAt: "2026-04-25T13:00:00.000Z",
                    taskId: "TASK-PASS-001"
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("PUT /api/customer/wifi/update returns combined WiFi update contract", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/wifi/update`, {
                method: "PUT",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({ ssidIndex: 1, newName: "BudiNet-Baru", newPassword: "password123" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "WiFi berhasil diupdate",
                data: {
                    updated: true,
                    deviceId: "ONT-01"
                }
            });
            expect(WifiService.updateCustomerWifi).toHaveBeenCalledWith(
                expect.objectContaining({ id: 101 }),
                1,
                { newName: "BudiNet-Baru", newPassword: "password123" },
                expect.any(Object)
            );
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/wifi/reboot preserves reboot result message", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/wifi/reboot`, {
                method: "POST",
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Perintah reboot berhasil dikirim. Router akan restart dalam beberapa detik.",
                data: {
                    deviceId: "ONT-01",
                    message: "Perintah reboot berhasil dikirim. Router akan restart dalam beberapa detik.",
                    rebootSent: true,
                    timestamp: "2026-04-25T13:00:00.000Z"
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/traffic-usage/status returns stable feature-status payload", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/traffic-usage/status`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Traffic pelanggan tersedia",
                data: {
                    enabled: true,
                    liveEnabled: true
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/traffic-usage returns zeroed 503 contract when feature is disabled", async () => {
        const token = createCustomerToken(global.users[0]);
        CustomerTrafficUsageService.isFeatureEnabled.mockReturnValueOnce(false);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/traffic-usage`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(503);
            expect(payload).toEqual({
                status: 503,
                message: "Traffic usage tidak tersedia saat ini.",
                data: {
                    hasPppoe: false,
                    pppoeUsername: null,
                    today: { downloadBytes: 0, uploadBytes: 0, totalBytes: 0 },
                    currentMonth: { downloadBytes: 0, uploadBytes: 0, totalBytes: 0 },
                    dailyHistory: [],
                    lastCollectedAt: null,
                    stale: false
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/traffic-usage returns positive usage payload when feature is enabled", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/traffic-usage`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Traffic usage berhasil diambil",
                data: {
                    hasPppoe: true,
                    pppoeUsername: "budi-pppoe",
                    today: { downloadBytes: 1, uploadBytes: 2, totalBytes: 3 },
                    currentMonth: { downloadBytes: 4, uploadBytes: 5, totalBytes: 9 },
                    dailyHistory: [],
                    lastCollectedAt: "2026-04-25T13:00:00.000Z",
                    stale: false
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/traffic-live returns zeroed 503 contract when live feature is disabled", async () => {
        const token = createCustomerToken(global.users[0]);
        CustomerTrafficUsageService.getFeatureStatus.mockReturnValueOnce({ enabled: true, liveEnabled: false });
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/traffic-live`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(503);
            expect(payload).toEqual({
                status: 503,
                message: "Bandwidth live tidak tersedia saat ini.",
                data: {
                    hasPppoe: false,
                    pppoeUsername: null,
                    online: false,
                    downloadBps: 0,
                    uploadBps: 0,
                    downloadHuman: "0 bps",
                    uploadHuman: "0 bps",
                    interfaceName: null,
                    lastSampleAt: null,
                    sampleIntervalMs: null,
                    stale: false,
                    warmup: false
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/traffic-live returns positive live payload when live feature is enabled", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/traffic-live`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Bandwidth live berhasil diambil",
                data: {
                    hasPppoe: true,
                    pppoeUsername: "budi-pppoe",
                    online: true,
                    downloadBps: 1200,
                    uploadBps: 600,
                    downloadHuman: "1.2 Kbps",
                    uploadHuman: "600 bps",
                    interfaceName: "pppoe-budi",
                    lastSampleAt: "2026-04-25T13:00:00.000Z",
                    sampleIntervalMs: 5000,
                    stale: false,
                    warmup: false
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/reports/history returns stable report history payload", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/reports/history`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Riwayat laporan berhasil diambil",
                data: [
                    {
                        ticketId: "TKT-001",
                        category: "internet_mati",
                        status: "open",
                        createdAt: "2026-04-25T13:00:00.000Z"
                    }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/request-package-change returns null data and request-package message", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/request-package-change`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({ targetPackageName: "Paket 50 Mbps" })
            });
            const payload = await response.json();

            expect(response.status).toBe(201);
            expect(payload).toEqual({
                status: 201,
                message: "Permintaan perubahan paket berhasil dikirim",
                data: null
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/package-change-requests/history returns stable history payload", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/package-change-requests/history`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Riwayat permintaan perubahan paket berhasil diambil",
                data: [
                    {
                        id: "pkgchange_001",
                        currentPackageName: "Paket 20 Mbps",
                        currentPackagePrice: 200000,
                        requestedPackageName: "Paket 50 Mbps",
                        requestedPackagePrice: 350000,
                        status: "pending",
                        createdAt: "2026-04-25T13:00:00.000Z",
                        updatedAt: null,
                        approvedBy: null,
                        notes: null
                    }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/packages returns monthly package list", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/packages`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Daftar paket bulanan berhasil diambil",
                data: [
                    { id: 1, name: "Paket 20 Mbps", price: 200000, profile: "20M", description: "Paket reguler" },
                    { id: 2, name: "Paket 50 Mbps", price: 350000, profile: "50M", description: "Paket upgrade" }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/account/update returns null data and preserves account-update message", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/account/update`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    currentPassword: "old-password",
                    newUsername: "budi-baru",
                    newPassword: "new-password"
                })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Akun Anda telah berhasil diperbarui.",
                data: null
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/speed-requests/active returns stable null payload when no active request exists", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/speed-requests/active`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Tidak ada speed boost yang aktif.",
                data: null
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/speed-requests/active returns active request payload when one exists", async () => {
        const token = createCustomerToken(global.users[0]);
        SpeedRequestService.getActiveRequest.mockResolvedValueOnce({
            id: "SR-ACTIVE-001",
            status: "active",
            requestedPackage: { name: "Boost 50 Mbps" }
        });
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/speed-requests/active`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Speed boost aktif berhasil diambil",
                data: {
                    id: "SR-ACTIVE-001",
                    status: "active",
                    requestedPackage: { name: "Boost 50 Mbps" }
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/speed-requests/history returns history payload", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/speed-requests/history`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Riwayat speed boost berhasil diambil",
                data: [
                    { id: "SR-001", targetPackageName: "Boost 50 Mbps", status: "approved" }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/customer/speed-requests/cancel returns null data and cancel message", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/speed-requests/cancel`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({ requestId: "SR-001" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Permintaan speed boost berhasil dibatalkan",
                data: null
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/speed-boost/status returns enabled contract", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/speed-boost/status`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Speed On Demand tersedia",
                data: { enabled: true }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/speed-boost/available returns disabled-feature empty payload", async () => {
        const token = createCustomerToken(global.users[0]);
        SpeedRequestService.getAvailableSpeedBoosts.mockResolvedValueOnce([]);
        SpeedRequestService.isFeatureEnabled.mockReturnValueOnce(false);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/speed-boost/available`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Speed Boost sedang tidak tersedia saat ini",
                data: []
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/customer/speed-boost/available returns available package payload when feature has data", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/customer/speed-boost/available`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Daftar paket speed boost berhasil diambil",
                data: [
                    {
                        name: "Boost 50 Mbps",
                        profile: "BOOST50",
                        basePrice: 350000,
                        durations: {
                            "1_day": { label: "1 Hari", hours: 24, price: 15000 }
                        }
                    }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/dashboard-status returns sensitive dashboard contract", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/dashboard-status`, {
                headers: { authorization: `Bearer ${token}` }
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(response.headers.get("pragma")).toBe("no-cache");
            expect(payload).toEqual({
                status: 200,
                message: "Status dashboard berhasil diambil",
                data: {
                    activeTicketCount: 1,
                    unpaidInvoiceCount: 0
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/lapor returns created report contract", async () => {
        const token = createCustomerToken(global.users[0]);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/lapor`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({ category: "internet_mati", reportText: "Internet mati total" })
            });
            const payload = await response.json();

            expect(response.status).toBe(201);
            expect(payload).toEqual({
                status: 201,
                message: "Laporan berhasil dibuat. Tim kami akan segera menghubungi Anda.",
                data: {
                    ticketId: "TKT-001"
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/request-speed returns 201 with payment-proof contract for cash requests", async () => {
        const token = createCustomerToken(global.users[0]);
        global.packages = [
            { name: "Paket 20 Mbps", price: 200000, profile: "20M" },
            {
                name: "Boost 50 Mbps",
                price: 350000,
                profile: "BOOST50",
                isSpeedBoost: true,
                speedBoostPrices: { "1_day": 15000 }
            }
        ];
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/request-speed`, {
                method: "POST",
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json"
                },
                body: JSON.stringify({
                    targetPackageName: "Boost 50 Mbps",
                    duration: "1_day",
                    paymentMethod: "cash"
                })
            });
            const payload = await response.json();

            expect(response.status).toBe(201);
            expect(payload).toEqual({
                status: 201,
                message: "Permintaan penambahan kecepatan Anda telah berhasil dikirim. Silakan upload bukti pembayaran untuk melanjutkan proses.",
                data: {
                    requestId: expect.stringMatching(/^speedreq_/),
                    paymentMethod: "cash",
                    amount: 15000,
                    needsPaymentProof: true
                }
            });
            expect(global.speed_requests).toHaveLength(1);
            expect(global.speed_requests[0]).toMatchObject({
                userId: 101,
                requestedPackageName: "Boost 50 Mbps",
                durationKey: "1_day",
                paymentMethod: "cash",
                paymentAmount: 15000
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/request-speed rejects missing bearer token", async () => {
        global.packages = [
            { name: "Paket 20 Mbps", price: 200000, profile: "20M" },
            {
                name: "Boost 50 Mbps",
                price: 350000,
                profile: "BOOST50",
                isSpeedBoost: true,
                speedBoostPrices: { "1_day": 15000 }
            }
        ];
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/request-speed`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    targetPackageName: "Boost 50 Mbps",
                    duration: "1_day",
                    paymentMethod: "cash"
                })
            });
            const payload = await response.json();

            expect(response.status).toBe(401);
            expect(payload).toEqual({
                status: 401,
                message: "Unauthorized: No token provided."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/speed-boost/packages returns public speed-boost package payload", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/speed-boost/packages`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Daftar paket speed boost berhasil diambil",
                data: [
                    {
                        name: "Boost 50 Mbps",
                        price: 350000,
                        profile: "BOOST50",
                        speedBoostPrices: {
                            "1_day": { label: "1 Hari", hours: 24, price: 15000 }
                        }
                    }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/otp returns 503 when WhatsApp session is offline", async () => {
        hasAuthenticatedSession.mockReturnValueOnce(false);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/otp`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ phoneNumber: "08123" })
            });
            const payload = await response.json();

            expect(response.status).toBe(503);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toEqual({
                status: 503,
                message: "Bot sedang offline"
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/otp returns rate-limit contract after quota exhaustion", async () => {
        checkOTPRequestLimit.mockReturnValueOnce({ allowed: false, remainingTime: 42 });
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/otp`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ phoneNumber: "08123" })
            });
            const payload = await response.json();

            expect(response.status).toBe(429);
            expect(payload).toEqual({
                status: 429,
                message: "Terlalu banyak permintaan OTP. Coba lagi dalam 42 menit."
            });
        } finally {
            await stopServer(server);
        }
    });

    test.each([
        ["/api/otp", "/api/auth/otp/request"]
    ])("POST %s and %s return stable OTP request contracts", async (primaryPath, aliasPath) => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            for (const endpoint of [primaryPath, aliasPath]) {
                const response = await fetch(`${baseUrl}${endpoint}`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ phoneNumber: "08123" })
                });
                const payload = await response.json();

                expect(response.status).toBe(200);
                expect(response.headers.get("cache-control")).toContain("no-store");
                expect(payload).toEqual({
                    status: 200,
                    message: "OTP berhasil dikirim",
                    data: null
                });
            }
        } finally {
            await stopServer(server);
        }
    });

    test.each(["/api/otpverify", "/api/auth/otp/verify"])("POST %s returns customer auth payload after OTP verification", async (endpoint) => {
        global.users = [buildCustomer({ otp: "123456", otpTimestamp: new Date().toISOString() })];
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}${endpoint}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ phoneNumber: "08123", otp: "123456" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toMatchObject({
                status: 200,
                message: "OTP berhasil diverifikasi.",
                data: {
                    token: expect.any(String),
                    user: {
                        id: 101,
                        name: "Budi",
                        phoneNumber: "08123"
                    }
                }
            });
            expect(jwt.verify(payload.data.token, global.config.jwt, getCustomerTokenVerifyOptions())).toMatchObject({
                id: 101,
                tokenType: "customer"
            });
            expect(resetOTPAttempts).toHaveBeenCalledWith("08123");
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/otpverify returns verify-limit contract after too many attempts", async () => {
        checkOTPVerifyLimit.mockReturnValueOnce({ allowed: false });
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/otpverify`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ phoneNumber: "08123", otp: "123456" })
            });
            const payload = await response.json();

            expect(response.status).toBe(429);
            expect(payload).toEqual({
                status: 429,
                message: "Terlalu banyak percobaan verifikasi. Silakan minta OTP baru."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/otpverify rejects expired OTPs", async () => {
        global.users = [buildCustomer({ otp: "123456", otpTimestamp: "2025-01-01T00:00:00.000Z" })];
        isOTPValid.mockReturnValueOnce(false);
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/otpverify`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ phoneNumber: "08123", otp: "123456" })
            });
            const payload = await response.json();

            expect(response.status).toBe(400);
            expect(payload).toEqual({
                status: 400,
                message: "OTP sudah kedaluwarsa. Silakan minta OTP baru."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/otpverify rejects invalid OTP without leaking internals", async () => {
        global.users = [buildCustomer({ otp: "123456", otpTimestamp: new Date().toISOString() })];
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/otpverify`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ phoneNumber: "08123", otp: "654321" })
            });
            const payload = await response.json();

            expect(response.status).toBe(400);
            expect(payload).toEqual({
                status: 400,
                message: "OTP tidak valid."
            });
        } finally {
            await stopServer(server);
        }
    });

    test("POST /api/auth/login mirrors the customer login token contract", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/auth/login`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ username: "budi", password: "correct-password" })
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toMatchObject({
                status: 200,
                message: "Login berhasil.",
                data: {
                    token: expect.any(String),
                    user: {
                        id: 101,
                        name: "Budi",
                        phoneNumber: "08123"
                    }
                }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/wifi-name returns public WiFi name contract", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/wifi-name`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload).toEqual({
                status: 200,
                message: "Nama WiFi berhasil diambil",
                data: { wifiName: "RAF NET" }
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/announcements returns cache-safe public announcements payload", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/announcements`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toEqual({
                status: 200,
                success: true,
                message: "Daftar pengumuman berhasil diambil",
                data: [
                    { id: "ANN-001", message: "Maintenance malam", created_at: "2026-04-25T13:00:00.000Z" }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/announcements/recent returns recent-announcements alias payload", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/announcements/recent`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toEqual({
                status: 200,
                success: true,
                message: "Daftar pengumuman terbaru berhasil diambil",
                data: [
                    { id: "ANN-001", message: "Maintenance malam", created_at: "2026-04-25T13:00:00.000Z" }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/news returns cache-safe public news payload", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/news`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toEqual({
                status: 200,
                success: true,
                message: "Daftar berita berhasil diambil",
                data: [
                    { id: "NEWS-001", title: "Promo baru", content: "Diskon pelanggan", created_at: "2026-04-25T13:00:00.000Z" }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

    test("GET /api/news/recent returns recent-news alias payload", async () => {
        const app = createApp();
        const { server, baseUrl } = await startServer(app);

        try {
            const response = await fetch(`${baseUrl}/api/news/recent`);
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toContain("no-store");
            expect(payload).toEqual({
                status: 200,
                success: true,
                message: "Daftar berita terbaru berhasil diambil",
                data: [
                    { id: "NEWS-001", title: "Promo baru", content: "Diskon pelanggan", created_at: "2026-04-25T13:00:00.000Z" }
                ]
            });
        } finally {
            await stopServer(server);
        }
    });

});
