"use strict";

/**
 * Header Doc
 * Purpose: Guardrail — `/app/voucher` (publik ANONIM) tidak boleh membocorkan `hargaReseller`
 *   dan `margin` dari `global.voucher`, tetapi WAJIB tetap mengirim field yang dibaca
 *   `static/voucher-buy.html` (prof/namavc/durasivc/hargavc/featured). Dua sisi diuji karena
 *   memperketat proyeksi tanpa memeriksa konsumennya akan mengosongkan katalog halaman beli.
 *   Juga menjaga bentuk `{data:[]}` pada `/app/packages`, yang dipakai health-check portal.
 * Caller: Jest (`npx jest routes/__tests__/public-anonymous-voucher-projection.test.js`).
 * Deps: fs, path, `routes/public-anonymous` (handler dipanggil langsung, tanpa server HTTP).
 * MainFuncs: -
 * SideEffects: Menyetel/menghapus `global.voucher|config|packages` di dalam test.
 */

const fs = require("fs");
const path = require("path");

const router = require("../public-anonymous");

const VOUCHER_FIXTURE = [
    {
        prof: "Paket-3Jam",
        namavc: "Paket 3 Jam",
        durasivc: "3 Jam",
        hargavc: "1000",
        hargaReseller: "800",
        margin: "200"
    },
    {
        prof: "Paket-1Hari",
        namavc: "Paket 1 Hari",
        durasivc: "1 Hari",
        hargavc: "3000",
        hargaReseller: "2400",
        margin: "600"
    }
];

/** Panggil handler `/app/:type/:id?` langsung dan kembalikan payload yang di-JSON-kan. */
function callApp(type, { featured = "" } = {}) {
    global.voucher = JSON.parse(JSON.stringify(VOUCHER_FIXTURE));
    global.config = { voucherFeatured: featured };
    global.packages = [{ id: 1, name: "PAKET A", price: 110000, profile: "12M", whitelist: "false" }];

    const layer = router.stack.find((l) => l.route && l.route.path === "/app/:type/:id?");
    const handler = layer.route.stack[0].handle;

    let payload;
    const res = {
        json: (obj) => { payload = obj; return res; },
        status: () => res,
        send: () => res,
        setHeader: () => res,
        end: () => res
    };
    handler({ params: { type }, query: {} }, res);
    return payload;
}

afterEach(() => {
    delete global.voucher;
    delete global.config;
    delete global.packages;
});

describe("/app/voucher — proyeksi publik anonim", () => {
    test("TIDAK membocorkan hargaReseller / margin", () => {
        const { data } = callApp("voucher");
        expect(data).toHaveLength(2);
        data.forEach((item) => {
            expect(item).not.toHaveProperty("hargaReseller");
            expect(item).not.toHaveProperty("margin");
        });
        // Jaring pengaman kedua: tak ada jejak nilainya di seluruh payload ter-serialisasi.
        const raw = JSON.stringify(data);
        expect(raw).not.toContain("hargaReseller");
        expect(raw).not.toContain("margin");
        expect(raw).not.toContain("800");
        expect(raw).not.toContain("2400");
    });

    test("TETAP mengirim semua field yang dibaca halaman beli", () => {
        const { data } = callApp("voucher");
        data.forEach((item) => {
            ["prof", "namavc", "durasivc", "hargavc"].forEach((f) => {
                expect(item[f]).toBeDefined();
            });
        });
        expect(data[0].hargavc).toBe("1000");
        expect(data[0].namavc).toBe("Paket 3 Jam");
    });

    test("allowlist NYATA: kolom harga baru di voucher.json tidak otomatis bocor", () => {
        // Regresi untuk masa depan: blocklist akan lolos di sini, allowlist tidak.
        global.voucher = [{ ...VOUCHER_FIXTURE[0], hargaAgen: "700", hpp: "500" }];
        global.config = { voucherFeatured: "" };
        const layer = router.stack.find((l) => l.route && l.route.path === "/app/:type/:id?");
        let payload;
        const res = { json: (o) => { payload = o; return res; }, status: () => res };
        layer.route.stack[0].handle({ params: { type: "voucher" }, query: {} }, res);

        expect(payload.data[0]).not.toHaveProperty("hargaAgen");
        expect(payload.data[0]).not.toHaveProperty("hpp");
        expect(Object.keys(payload.data[0]).sort()).toEqual(["durasivc", "hargavc", "namavc", "prof"]);
    });

    test("featured hanya pada paket yang cocok config.voucherFeatured", () => {
        const { data } = callApp("voucher", { featured: "Paket-1Hari" });
        expect(data.find((i) => i.prof === "Paket-1Hari").featured).toBe(true);
        // Perilaku lama dipertahankan: yang tidak unggulan TIDAK punya key `featured` sama sekali.
        expect(data.find((i) => i.prof === "Paket-3Jam")).not.toHaveProperty("featured");
    });

    test("tanpa voucherFeatured, tidak ada paket yang ditandai", () => {
        const { data } = callApp("voucher", { featured: "" });
        data.forEach((item) => expect(item).not.toHaveProperty("featured"));
    });

    test("global.voucher kosong/bukan array tidak melempar", () => {
        global.voucher = undefined;
        global.config = {};
        const layer = router.stack.find((l) => l.route && l.route.path === "/app/:type/:id?");
        let payload;
        const res = { json: (o) => { payload = o; return res; }, status: () => res };
        expect(() => {
            layer.route.stack[0].handle({ params: { type: "voucher" }, query: {} }, res);
        }).not.toThrow();
        expect(payload.data).toEqual([]);
    });
});

describe("/app/packages — bentuk dijaga untuk health-check portal", () => {
    test("tetap membalas { data: [...] }", () => {
        // lib/portal-areas.js memakai GET /app/packages sebagai health-check area.
        const payload = callApp("packages");
        expect(payload).toHaveProperty("data");
        expect(Array.isArray(payload.data)).toBe(true);
    });

    test("type tak dikenal tetap { data: [] }", () => {
        const payload = callApp("entahapa");
        expect(payload.data).toEqual([]);
    });
});

describe("allowlist selaras dengan konsumennya", () => {
    test("setiap field voucher yang dibaca voucher-buy.html ada di allowlist", () => {
        // Kalau halaman mulai membaca field baru (mis. v.hargaPromo) tanpa menambahkannya ke
        // PUBLIC_VOUCHER_FIELDS, katalog akan diam-diam kosong/rusak di produksi. Test ini
        // memaksa keduanya bergerak bersama.
        const html = fs.readFileSync(
            path.join(__dirname, "..", "..", "static", "voucher-buy.html"),
            "utf8"
        );
        // Ambil hanya blok render katalog (setelah fetch('/app/voucher')).
        const start = html.indexOf("fetch('/app/voucher')");
        expect(start).toBeGreaterThan(-1);
        const block = html.slice(start, start + 2600);

        const dibaca = new Set();
        const re = /\bv\.([A-Za-z_][A-Za-z0-9_]*)/g;
        let m;
        while ((m = re.exec(block)) !== null) dibaca.add(m[1]);

        const allowed = new Set(["prof", "namavc", "durasivc", "hargavc", "featured"]);
        const takDiizinkan = [...dibaca].filter((f) => !allowed.has(f));
        expect(takDiizinkan).toEqual([]);
        // dan pastikan test ini benar-benar melihat sesuatu
        expect(dibaca.has("hargavc")).toBe(true);
        expect(dibaca.has("prof")).toBe(true);
    });
});
