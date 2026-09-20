"use strict";

/**
 * Header Doc
 * Purpose: Guardrail #b334 — endpoint anonim /app/detailtrx|statustrx|qr TIDAK boleh membocorkan
 *   record transaksi mentah lintas-tag. `global.payment` menampung tagihan bulanan/topup/buynowpanel
 *   yang berisi `sender` (nomor HP) & `ket` (kode voucher = uang). Jalur anonim hanya boleh membaca
 *   transaksi buynowweb-nya sendiri, dan hanya field aman (proyeksi allowlist). `statustrx`
 *   pada record LUNAS sengaja menyertakan `ket`+`trxId` — kode voucher memang harus tampil
 *   ke pemegang reff (halaman beli membacanya untuk layar sukses). Juga menjaga #b334
 *   penyimpanan `prof` di record buynowweb (voucher durasi benar walau harga kembar)
 *   + guard /app/buy menolak prof tak terdaftar (400, bukan charge iPaymu NaN).
 * Caller: Jest.
 * Deps: routes/public-anonymous (handler dipanggil langsung), fs/path (source-scan).
 * SideEffects: set/hapus global.payment.
 */
const fs = require("fs");
const path = require("path");
const router = require("../public-anonymous");

function handlerApp() {
    const layer = router.stack.find((l) => l.route && l.route.path === "/app/:type/:id?");
    return layer.route.stack[0].handle;
}

async function callTrx(type, id, payments, query = {}) {
    global.payment = payments;
    let statusCode = 200; let payload; let ended; const headers = {};
    const res = {
        status: (c) => { statusCode = c; return res; },
        json: (o) => { payload = o; return res; },
        send: (s) => { ended = s; return res; },
        setHeader: (k, v) => { headers[k] = v; return res; },
        end: (b) => { ended = b; return res; },
    };
    await handlerApp()({ params: { type, id }, query }, res);
    return { statusCode, payload, ended, headers };
}

afterEach(() => { delete global.payment; delete global.voucher; });

const TAGIHAN = {
    reffId: "reff-tagihan", trxId: "TRX-9", tag: "tagihan", status: true,
    sender: "628999888777@s.whatsapp.net", amount: 150000, method: "QRIS",
    ket: "Budi Santoso", qrStr: "00020101QRIS-HIDUP", createdAt: 123,
};
const VOUCHER_PANEL = {
    reffId: "reff-panel", trxId: "TRX-8", tag: "buynowpanel", status: true,
    sender: "628111@s.whatsapp.net", amount: 5000, method: "QRIS",
    ket: "VC-KODE-RAHASIA", createdAt: 123,
};
const WEB_PENDING = {
    reffId: "reff-web", trxId: "TRX-7", tag: "buynowweb", status: false,
    sender: "62812345@s.whatsapp.net", amount: 5000, method: "QRIS", ket: "",
    qrStr: "00020101QRIS-WEB", priceTotal: 5100, fee: 100, subtotal: 5000, prof: "Paket-1Hari", createdAt: 123,
};
const WEB_PAID = { ...WEB_PENDING, reffId: "reff-web-paid", status: true, ket: "VC-WEB-KODE" };

describe("/app/detailtrx — tak bocor record lintas-tag (#b334)", () => {
    test("reff tagihan/topup/panel → data null (bukan record mentah)", async () => {
        const r = await callTrx("detailtrx", "reff-tagihan", [TAGIHAN, VOUCHER_PANEL]);
        expect(r.payload.data).toBeNull();
    });

    test("buynowweb → HANYA field aman (tanpa sender/ket/trxId)", async () => {
        const r = await callTrx("detailtrx", "reff-web", [WEB_PENDING, TAGIHAN]);
        expect(r.payload.data).not.toBeNull();
        const raw = JSON.stringify(r.payload.data);
        expect(raw).not.toContain("62812345");           // sender
        expect(r.payload.data).not.toHaveProperty("sender");
        expect(r.payload.data).not.toHaveProperty("ket");
        expect(r.payload.data).not.toHaveProperty("trxId");
        expect(r.payload.data.reffId).toBe("reff-web");
        expect(r.payload.data.qrStr).toBe("00020101QRIS-WEB");
    });
});

describe("/app/statustrx — scoping tag + proyeksi (#b334)", () => {
    test("reff tagihan → 404 (bukan bocor), walau statusnya true", async () => {
        const r = await callTrx("statustrx", "reff-tagihan", [TAGIHAN]);
        expect(r.statusCode).toBe(404);
    });

    test("buynowweb lunas → ket (kode voucher) & trxId IKUT — ini yang ditampilkan layar sukses", async () => {
        // Halaman beli membaca rec.ket untuk menampilkan kode — membuangnya = kode tak pernah
        // tampil walau lunas. Aman: record sudah discope ke tag buynowweb (pemilik reff sendiri).
        const r = await callTrx("statustrx", "reff-web-paid", [WEB_PAID]);
        expect(r.statusCode).toBe(200);
        expect(r.payload.data.ket).toBe("VC-WEB-KODE");
        expect(r.payload.data.trxId).toBe("TRX-7");
        // sender (nomor HP) TETAP tak boleh bocor.
        expect(JSON.stringify(r.payload.data)).not.toContain("62812345");
        expect(r.payload.data).not.toHaveProperty("sender");
    });

    test("buynowweb belum bayar → 400 menunggu (tak bocor)", async () => {
        const r = await callTrx("statustrx", "reff-web", [WEB_PENDING]);
        expect(r.statusCode).toBe(400);
    });
});

describe("/app/buy — prof tak dikenal ditolak 400 (bukan charge iPaymu NaN)", () => {
    test("prof ngasal → 400, pay()/addPayment tak dipanggil", async () => {
        global.voucher = [{ prof: "Paket-1Hari", namavc: "1 Hari", durasivc: "1 Hari", hargavc: "5000" }];
        const r = await callTrx("buy", "prof-ngasal", [], { phone: "628123456789", email: "a@b.c" });
        expect(r.statusCode).toBe(400);
        expect(r.payload.message).toMatch(/tidak ditemukan/i);
    });
});

describe("/app/qr — hanya QRIS transaksi buynowweb (#b334)", () => {
    test("reff tagihan yang punya qrStr → 404 (QRIS hidup tak diserahkan)", async () => {
        const r = await callTrx("qr", "reff-tagihan", [TAGIHAN]);
        expect(r.statusCode).toBe(404);
    });

    test("buynowweb dgn qrStr → render PNG", async () => {
        const r = await callTrx("qr", "reff-web", [WEB_PENDING]);
        expect(r.headers["Content-Type"]).toBe("image/png");
        expect(Buffer.isBuffer(r.ended)).toBe(true);
    });
});

describe("prof disimpan di record buynowweb (#b334 — voucher durasi benar walau harga kembar)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "public-anonymous.js"), "utf8");
    const callback = fs.readFileSync(path.join(__dirname, "..", "public", "payment-callback.js"), "utf8");

    test("public-anonymous menyimpan prof di addPayment buynowweb", () => {
        expect(src).toMatch(/addPayment\([^)]*buynowweb[\s\S]*?prof:\s*id/);
    });

    test("callback buynowweb memakai pay.prof (fallback checkprofvc utk record lama)", () => {
        const i = callback.indexOf("pay.tag == 'buynowweb'");
        expect(i).toBeGreaterThan(-1);
        const blk = callback.slice(i, i + 600);
        expect(blk).toMatch(/pay\.prof\s*\|\|\s*checkprofvc/);
    });
});
