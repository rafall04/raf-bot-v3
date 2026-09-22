"use strict";

/**
 * Header Doc
 * Purpose: Guardrail #b402 — `/app/buy` multi-beli: `?qty=` divalidasi SEBELUM charge iPaymu
 *   (integer >=1, <= maxQty, >1 wajib gate voucherMultiPurchase.enabled), amount = harga×qty,
 *   dan record menyimpan prof+qty. Katalog /app/voucher memancarkan meta.multiBuy. statustrx
 *   memproyeksikan `codes` (array kode dari ket) + `qty` (record lama → 1).
 * Caller: Jest (`npx jest routes/__tests__/public-anonymous-buy-qty.test.js`).
 * Deps: routes/public-anonymous (handler dipanggil langsung; ipaymu & payment dimock).
 * SideEffects: set/hapus global.payment, global.voucher, global.config.
 */

jest.mock("../../lib/ipaymu", () => {
    const fn = jest.fn();
    return fn;
});
jest.mock("../../lib/payment", () => ({
    addPayment: jest.fn(),
    updateKetPayment: jest.fn(),
    updateStatusPayment: jest.fn(),
    checkStatusPayment: jest.fn(() => false)
}));
jest.mock("../../lib/mikrotik", () => ({
    ...jest.requireActual("../../lib/mikrotik"),
    cekHotspotUser: jest.fn()
}));

const pay = require("../../lib/ipaymu");
const { addPayment } = require("../../lib/payment");
const { cekHotspotUser } = require("../../lib/mikrotik");
const router = require("../public-anonymous");

function handlerApp() {
    const layer = router.stack.find((l) => l.route && l.route.path === "/app/:type/:id?");
    return layer.route.stack[0].handle;
}

async function callApp(type, id, query = {}, reqOpts = {}) {
    let statusCode = 200; let payload; let ended; const headers = {};
    const res = {
        status: (c) => { statusCode = c; return res; },
        json: (o) => { payload = o; return res; },
        send: (s) => { ended = s; return res; },
        setHeader: (k, v) => { headers[k] = v; return res; },
        end: (b) => { ended = b; return res; }
    };
    const req = { params: { type, id }, query, ...reqOpts };
    await handlerApp()(req, res);
    return { statusCode, payload, ended, headers };
}

const VOUCHERS = [
    { prof: "Paket-1Hari", namavc: "1 Hari", durasivc: "1 Hari", hargavc: "5000", hargaReseller: "4000", margin: "1000" }
];

const BASE_Q = { phone: "628123456789", email: "a@b.c" };
const prevCfg = global.config;

beforeEach(() => {
    jest.clearAllMocks();
    global.voucher = VOUCHERS;
    global.payment = [];
    pay.mockResolvedValue({ id: "TRX-Q", qrString: "QR", total: 999, fee: 35, subTotal: 999 });
    cekHotspotUser.mockResolvedValue({ ok: true, data: { exists: false } });
});

afterEach(() => {
    delete global.payment;
    delete global.voucher;
    global.config = prevCfg;
});

function multiCfg(cfg) {
    global.config = { ...(global.config || {}), voucherMultiPurchase: cfg };
}

function customCfg(enabled) {
    global.config = { ...(global.config || {}), voucherCustomCreds: { enabled } };
}

describe("/app/buy — qty multi-beli (#b402)", () => {
    test("tanpa qty → default 1, amount = harga satuan, record simpan prof+qty", async () => {
        multiCfg({ enabled: true, maxQty: 10 });
        const r = await callApp("buy", "Paket-1Hari", BASE_Q);
        expect(r.statusCode).toBe(200);
        expect(pay).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000 }));
        expect(addPayment).toHaveBeenCalledWith(
            expect.any(String), "TRX-Q", "628123456789", "buynowweb", 5000, "QRIS", "",
            expect.objectContaining({ prof: "Paket-1Hari", qty: 1 })
        );
    });

    test("qty=3 + enabled → iPaymu ditagih harga×qty, record qty=3", async () => {
        multiCfg({ enabled: true, maxQty: 10 });
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, qty: "3" });
        expect(r.statusCode).toBe(200);
        expect(pay).toHaveBeenCalledWith(expect.objectContaining({ amount: 15000 }));
        expect(addPayment).toHaveBeenCalledWith(
            expect.any(String), "TRX-Q", "628123456789", "buynowweb", 15000, "QRIS", "",
            expect.objectContaining({ prof: "Paket-1Hari", qty: 3 })
        );
    });

    test("qty>1 saat fitur OFF → 400, iPaymu TIDAK dipanggil", async () => {
        multiCfg({ enabled: false, maxQty: 10 });
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, qty: "3" });
        expect(r.statusCode).toBe(400);
        expect(pay).not.toHaveBeenCalled();
        expect(addPayment).not.toHaveBeenCalled();
    });

    // Catatan: qty kosong/blank ("  ", "") diperlakukan "tak diisi" → default 1 (bukan error).
    test.each(["0", "-2", "2.5", "abc", "1e3", "2x"])(
        "qty tidak-valid %p → 400, iPaymu TIDAK dipanggil",
        async (qty) => {
            multiCfg({ enabled: true, maxQty: 10 });
            const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, qty });
            expect(r.statusCode).toBe(400);
            expect(pay).not.toHaveBeenCalled();
        }
    );

    test("qty di atas maxQty → 400, iPaymu TIDAK dipanggil", async () => {
        multiCfg({ enabled: true, maxQty: 5 });
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, qty: "6" });
        expect(r.statusCode).toBe(400);
        expect(r.payload.message).toMatch(/maksimal/i);
        expect(pay).not.toHaveBeenCalled();
    });

    test("qty=1 selalu boleh walau fitur OFF (backward-compat)", async () => {
        multiCfg({ enabled: false, maxQty: 10 });
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, qty: "1" });
        expect(r.statusCode).toBe(200);
        expect(pay).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000 }));
    });
});

describe("/app/voucher — meta.multiBuy (#b402)", () => {
    test("katalog memancarkan meta.multiBuy sesuai config + field harga reseller tetap tak bocor", async () => {
        multiCfg({ enabled: true, maxQty: 7 });
        const r = await callApp("voucher", undefined, {});
        expect(r.payload.meta.multiBuy).toEqual({ enabled: true, maxQty: 7 });
        const raw = JSON.stringify(r.payload.data);
        expect(raw).not.toContain("hargaReseller");
        expect(raw).not.toContain("margin");
    });

    test("tanpa config → multiBuy OFF (halaman sembunyikan kontrol jumlah)", async () => {
        delete global.config;
        const r = await callApp("voucher", undefined, {});
        expect(r.payload.meta.multiBuy.enabled).toBe(false);
    });
});

describe("/app/statustrx — codes + qty (#b402)", () => {
    test("lunas qty=3 → codes array dari ket 'A, B, C' + qty 3", async () => {
        global.payment = [{
            reffId: "r-multi", trxId: "TRX-7", tag: "buynowweb", status: true,
            sender: "6281", amount: 15000, method: "QRIS", ket: "A1, B2, C3",
            prof: "Paket-1Hari", qty: 3, createdAt: 123
        }];
        const r = await callApp("statustrx", "r-multi", {});
        expect(r.statusCode).toBe(200);
        expect(r.payload.data.codes).toEqual(["A1", "B2", "C3"]);
        expect(r.payload.data.qty).toBe(3);
    });

    test("record LAMA tanpa qty → qty diproyeksikan 1; ket 'Voucher: X' ter-parse", async () => {
        global.payment = [{
            reffId: "r-legacy", trxId: "TRX-8", tag: "buynowweb", status: true,
            sender: "6281", amount: 5000, method: "QRIS", ket: "Voucher: LEGACY1", createdAt: 123
        }];
        const r = await callApp("statustrx", "r-legacy", {});
        expect(r.statusCode).toBe(200);
        expect(r.payload.data.qty).toBe(1);
        expect(r.payload.data.codes).toEqual(["LEGACY1"]);
    });

    test("lunas tapi GAGAL terbit → codes [] (halaman tampilkan proses manual)", async () => {
        global.payment = [{
            reffId: "r-gagal", trxId: "TRX-9", tag: "buynowweb", status: true,
            sender: "6281", amount: 5000, method: "QRIS", ket: "GAGAL voucher: mikrotik down", qty: 2, createdAt: 123
        }];
        const r = await callApp("statustrx", "r-gagal", {});
        expect(r.statusCode).toBe(200);
        expect(r.payload.data.codes).toEqual([]);
        expect(r.payload.data.qty).toBe(2);
    });
});

describe("/app/buy — custom creds (#b405)", () => {
    test("cuser saat fitur OFF → 400, iPaymu TIDAK dipanggil", async () => {
        customCfg(false);
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, cuser: "adi" });
        expect(r.statusCode).toBe(400);
        expect(r.payload.message).toMatch(/belum tersedia/i);
        expect(pay).not.toHaveBeenCalled();
    });

    test("cuser + qty>1 → 400 (custom hanya 1 voucher), iPaymu TIDAK dipanggil", async () => {
        customCfg(true);
        multiCfg({ enabled: true, maxQty: 10 });
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, cuser: "adi", qty: "2" });
        expect(r.statusCode).toBe(400);
        expect(r.payload.message).toMatch(/1 voucher/i);
        expect(pay).not.toHaveBeenCalled();
    });

    test("cuser format invalid → 400, MikroTik tak dipukul", async () => {
        customCfg(true);
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, cuser: "!!bad" });
        expect(r.statusCode).toBe(400);
        expect(cekHotspotUser).not.toHaveBeenCalled();
        expect(pay).not.toHaveBeenCalled();
    });

    test("cuser invalid → 400 (bukan 409 — format salah bukan bentrok)", async () => {
        customCfg(true);
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, cuser: "a b" });
        expect(r.statusCode).toBe(400);
    });

    test("cpass invalid (spasi) → 400, iPaymu TIDAK dipanggil", async () => {
        customCfg(true);
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, cuser: "adi", cpass: "a b" });
        expect(r.statusCode).toBe(400);
        expect(r.payload.message).toMatch(/password/i);
        expect(pay).not.toHaveBeenCalled();
    });

    test("cuser sudah ada di MikroTik → 409, iPaymu TIDAK dipanggil", async () => {
        customCfg(true);
        cekHotspotUser.mockResolvedValue({ ok: true, data: { exists: true } });
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, cuser: "adi" });
        expect(r.statusCode).toBe(409);
        expect(pay).not.toHaveBeenCalled();
    });

    test("cuser ter-reservasi pending payment lain → 409, MikroTik tak dipukul", async () => {
        customCfg(true);
        global.payment = [{ reffId: "r-x", tag: "buynowweb", status: false, customUser: "adi", createdAt: Date.now() }];
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, cuser: "ADI" });
        expect(r.statusCode).toBe(409);
        expect(cekHotspotUser).not.toHaveBeenCalled();
        expect(pay).not.toHaveBeenCalled();
    });

    test("pre-check MikroTik gagal → 503 fail-closed, iPaymu TIDAK dipanggil", async () => {
        customCfg(true);
        cekHotspotUser.mockResolvedValue({ ok: false });
        const r = await callApp("buy", "Paket-1Hari", { ...BASE_Q, cuser: "adi" });
        expect(r.statusCode).toBe(503);
        expect(pay).not.toHaveBeenCalled();
    });

    test("POST body cuser+cpass → 200, record simpan customUser/customPass", async () => {
        customCfg(true);
        const r = await callApp("buy", "Paket-1Hari", BASE_Q, {
            method: "POST",
            body: { cuser: "Adi_Keren", cpass: "rahasia123" }
        });
        expect(r.statusCode).toBe(200);
        expect(cekHotspotUser).toHaveBeenCalledWith("adi_keren", expect.anything());
        expect(addPayment).toHaveBeenCalledWith(
            expect.any(String), "TRX-Q", "628123456789", "buynowweb", 5000, "QRIS", "",
            expect.objectContaining({
                prof: "Paket-1Hari", qty: 1,
                customUser: "adi_keren", customPass: "rahasia123"
            })
        );
    });

    test("POST tanpa cpass → customPass = username (default)", async () => {
        customCfg(true);
        const r = await callApp("buy", "Paket-1Hari", BASE_Q, {
            method: "POST",
            body: { cuser: "adi" }
        });
        expect(r.statusCode).toBe(200);
        expect(addPayment).toHaveBeenCalledWith(
            expect.any(String), "TRX-Q", "628123456789", "buynowweb", 5000, "QRIS", "",
            expect.objectContaining({ customUser: "adi", customPass: "adi" })
        );
    });
});

describe("/app/check-user — probe ketersediaan (#b405)", () => {
    test("fitur OFF → 404", async () => {
        customCfg(false);
        const r = await callApp("check-user", undefined, { name: "adi" });
        expect(r.statusCode).toBe(404);
    });

    test("format invalid → 400", async () => {
        customCfg(true);
        const r = await callApp("check-user", undefined, { name: "!!x" });
        expect(r.statusCode).toBe(400);
        expect(cekHotspotUser).not.toHaveBeenCalled();
    });

    test("tersedia → 200 available:true", async () => {
        customCfg(true);
        const r = await callApp("check-user", undefined, { name: "adi" });
        expect(r.statusCode).toBe(200);
        expect(r.payload.data).toEqual({ username: "adi", available: true });
    });

    test("ada di MikroTik → 409 available:false", async () => {
        customCfg(true);
        cekHotspotUser.mockResolvedValue({ ok: true, data: { exists: true } });
        const r = await callApp("check-user", undefined, { name: "adi" });
        expect(r.statusCode).toBe(409);
        expect(r.payload.data.available).toBe(false);
    });

    test("ter-reservasi pending → 409, MikroTik tak dipukul", async () => {
        customCfg(true);
        global.payment = [{ reffId: "r-x", tag: "buynowweb", status: false, customUser: "adi", createdAt: Date.now() }];
        const r = await callApp("check-user", undefined, { name: "adi" });
        expect(r.statusCode).toBe(409);
        expect(cekHotspotUser).not.toHaveBeenCalled();
    });

    test("pre-check gagal → 503 (bukan 'available' — fail closed)", async () => {
        customCfg(true);
        cekHotspotUser.mockRejectedValue(new Error("timeout"));
        const r = await callApp("check-user", undefined, { name: "adi" });
        expect(r.statusCode).toBe(503);
    });
});

describe("/app/voucher — meta.customCreds (#b405)", () => {
    test("enabled → meta.customCreds.enabled true", async () => {
        customCfg(true);
        const r = await callApp("voucher", undefined, {});
        expect(r.payload.meta.customCreds).toEqual({ enabled: true });
    });
    test("tanpa config → customCreds OFF", async () => {
        delete global.config;
        const r = await callApp("voucher", undefined, {});
        expect(r.payload.meta.customCreds.enabled).toBe(false);
    });
});

describe("/app/statustrx — custom creds diproyeksikan (#b405)", () => {
    test("lunas custom → customUser/customPass ikut; non-custom tak ada", async () => {
        global.payment = [
            {
                reffId: "r-c1", trxId: "TRX-C1", tag: "buynowweb", status: true,
                sender: "6281", amount: 5000, method: "QRIS", ket: "adi",
                qty: 1, customUser: "adi", customPass: "rahasia123", createdAt: 123
            },
            {
                reffId: "r-c2", trxId: "TRX-C2", tag: "buynowweb", status: true,
                sender: "6281", amount: 5000, method: "QRIS", ket: "VCR9", qty: 1, createdAt: 123
            }
        ];
        const custom = await callApp("statustrx", "r-c1", {});
        expect(custom.payload.data.customUser).toBe("adi");
        expect(custom.payload.data.customPass).toBe("rahasia123");
        const biasa = await callApp("statustrx", "r-c2", {});
        expect("customUser" in biasa.payload.data).toBe(false);
        expect("customPass" in biasa.payload.data).toBe(false);
    });
});
