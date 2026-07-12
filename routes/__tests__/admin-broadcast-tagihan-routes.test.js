/**
 * Header Doc
 * Purpose: Guardrail test route "Broadcast Terarah" — registry template lintas-kategori (resolver
 *          responseTemplates vs notificationTemplates + fallback), endpoint daftar template, dan
 *          filter pelanggan (unpaid/paid/isolir/menunggak) termasuk pembuangan akun infrastruktur.
 * Caller: Jest test runner.
 * Deps: `../admin-broadcast-tagihan-routes` (dengan template-service, response-template-helper, dan
 *       arrears.service di-mock; account-classification & formatBroadcastMessage tetap nyata).
 * MainFuncs: Memverifikasi findDirectedTemplate, resolveDirectedTemplateText, dan handler HTTP.
 * SideEffects: Tidak ada (tanpa akses DB/WA — arrears di-mock).
 */
"use strict";

const mockRenderResponseTemplate = jest.fn();
const mockGetArrearsReadModel = jest.fn();

// response-template-helper & arrears.service aman di-mock penuh (route hanya butuh 1 fungsi tiap modul).
jest.mock("../../lib/response-template-helper", () => ({
    renderResponseTemplate: mockRenderResponseTemplate
}));
jest.mock("../../services/arrears.service", () => ({
    createArrearsService: () => ({ getArrearsReadModel: mockGetArrearsReadModel })
}));

// template-service TIDAK di-mock penuh (lib/templating memanggil loadAllCategories() saat load).
// Cukup spy pada renderCategoryTemplate — route mengaksesnya dinamis (property call-time), jadi spy berlaku.
const templateService = require("../../lib/template-service");
const mockRenderCategoryTemplate = jest.spyOn(templateService, "renderCategoryTemplate");

const {
    registerAdminBroadcastTagihanRoutes,
    resolveDirectedTemplateText,
    findDirectedTemplate,
    DIRECTED_TEMPLATES
} = require("../admin-broadcast-tagihan-routes");

// Fake Express router: simpan handler terakhir (asyncHandler-wrapped) per "method path".
function makeRouter() {
    const routes = {};
    const register = (method) => (path, ...handlers) => {
        routes[`${method} ${path}`] = handlers[handlers.length - 1];
    };
    return { get: register("get"), post: register("post"), _routes: routes };
}

// Mock res dengan promise `done` yang selesai saat json() dipanggil (asyncHandler tak mengembalikan promise).
function makeRes() {
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    return {
        statusCode: null,
        body: null,
        done,
        _reject: rejectDone,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; resolveDone(payload); return this; }
    };
}

async function invoke(router, key, req) {
    const handler = router._routes[key];
    if (!handler) throw new Error(`Route tak terdaftar: ${key}`);
    const res = makeRes();
    handler(req, res, (err) => res._reject(err || new Error("next() terpanggil")));
    await res.done;
    return res;
}

let router;
beforeEach(() => {
    jest.clearAllMocks();
    mockRenderResponseTemplate.mockImplementation((key) => `RESP:${key}`);
    mockRenderCategoryTemplate.mockImplementation((cat, key) => ({ found: true, text: `NOTIF:${key}` }));
    router = makeRouter();
    registerAdminBroadcastTagihanRoutes(router, { ensureAuthenticatedStaff: (_req, _res, next) => next() });

    global.users = [
        { id: 1, name: "Aktif Lunas", status: "aktif", paid: true, phone_number: "0811", subscription: "P1", account_type: "pelanggan" },
        { id: 2, name: "Nunggak", status: "aktif", paid: false, phone_number: "0812", subscription: "P1", account_type: "pelanggan" },
        { id: 3, name: "Terisolir", status: "isolir", paid: false, phone_number: "0813", subscription: "P1", account_type: "pelanggan" },
        { id: 4, name: "CCTV", status: "aktif", paid: false, phone_number: "0814", account_type: "infrastruktur" }
    ];
    global.packages = [{ name: "P1", price: 100000 }];
});
afterEach(() => {
    delete global.users;
    delete global.packages;
});

describe("registry template", () => {
    test("findDirectedTemplate: default → tagihan, id tak dikenal → tagihan, id valid → entri tepat", () => {
        expect(findDirectedTemplate().id).toBe("tagihan");
        expect(findDirectedTemplate("ngawur").id).toBe("tagihan");
        expect(findDirectedTemplate("isolir").key).toBe("isolir_notification");
        expect(DIRECTED_TEMPLATES.map((t) => t.id)).toEqual(["tagihan", "tenggang", "isolir", "welcome"]);
    });

    test("resolveDirectedTemplateText: responseTemplates lewat renderResponseTemplate", () => {
        const text = resolveDirectedTemplateText(findDirectedTemplate("tagihan"));
        expect(mockRenderResponseTemplate).toHaveBeenCalledWith("broadcast_tagihan", expect.any(String), {});
        expect(text).toBe("RESP:broadcast_tagihan");
    });

    test("resolveDirectedTemplateText: notificationTemplates lewat renderCategoryTemplate", () => {
        const text = resolveDirectedTemplateText(findDirectedTemplate("isolir"));
        expect(mockRenderCategoryTemplate).toHaveBeenCalledWith("notificationTemplates", "isolir_notification", {});
        expect(text).toBe("NOTIF:isolir_notification");
    });

    test("resolveDirectedTemplateText: fallback saat template tersimpan tak ditemukan", () => {
        mockRenderCategoryTemplate.mockReturnValueOnce({ found: false });
        const entry = findDirectedTemplate("tenggang");
        expect(resolveDirectedTemplateText(entry)).toBe(entry.fallback);
    });
});

describe("GET /templates", () => {
    test("mengembalikan 4 template untuk dropdown", async () => {
        const res = await invoke(router, "get /api/broadcast-tagihan/templates", { query: {} });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.items.map((t) => t.id)).toEqual(["tagihan", "tenggang", "isolir", "welcome"]);
    });
});

describe("GET /default-template", () => {
    test("?template=isolir me-resolve dari notificationTemplates", async () => {
        const res = await invoke(router, "get /api/broadcast-tagihan/default-template", { query: { template: "isolir" } });
        expect(res.body.data.template_key).toBe("isolir_notification");
        expect(res.body.data.text).toBe("NOTIF:isolir_notification");
    });

    test("tanpa query → default tagihan (responseTemplates)", async () => {
        const res = await invoke(router, "get /api/broadcast-tagihan/default-template", { query: {} });
        expect(res.body.data.template_id).toBe("tagihan");
        expect(res.body.data.text).toBe("RESP:broadcast_tagihan");
    });
});

describe("GET /customers — filter status", () => {
    test("status=isolir → hanya pelanggan berstatus isolir", async () => {
        const res = await invoke(router, "get /api/broadcast-tagihan/customers", { query: { status: "isolir" } });
        expect(res.body.data.items.map((u) => u.id)).toEqual([3]);
    });

    test("status=paid → hanya yang sudah bayar", async () => {
        const res = await invoke(router, "get /api/broadcast-tagihan/customers", { query: { status: "paid" } });
        expect(res.body.data.items.map((u) => u.id)).toEqual([1]);
    });

    test("status=unpaid (default) → belum bayar, buang akun infrastruktur", async () => {
        const res = await invoke(router, "get /api/broadcast-tagihan/customers", { query: {} });
        expect(res.body.data.items.map((u) => u.id).sort()).toEqual([2, 3]);
    });

    test("status=menunggak → petakan baris arrears ke global.users, buang infra", async () => {
        // Arrears mengembalikan id 2 & 4; id 4 (infra) harus tetap terbuang oleh filter isInfrastructure.
        mockGetArrearsReadModel.mockResolvedValue({
            rows: [
                { user_id: 2, total_outstanding: 150000 },
                { user_id: 4, total_outstanding: 999000 }
            ]
        });
        const res = await invoke(router, "get /api/broadcast-tagihan/customers", { query: { status: "menunggak" } });
        expect(mockGetArrearsReadModel).toHaveBeenCalledTimes(1);
        expect(res.body.data.items.map((u) => u.id)).toEqual([2]);
        expect(res.body.data.items[0].outstanding).toBe(150000);
    });
});
