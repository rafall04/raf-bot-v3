/**
 * Header Doc
 * Purpose : Menegakkan larangan SNMP untuk merek HIOSO (#b283) — SNMP membuat OLT HIOSO hang.
 *           Larangan ini KHUSUS HIOSO; ZTE aman dan jalur SNMP-nya sengaja dibiarkan.
 *           Sekaligus menjaga jaminan lama #b192 di jalur barunya: pembacaan yang GAGAL
 *           tidak boleh disulap jadi "nol ONU".
 * Caller  : jest
 * Deps    : pemindaian sumber + driver hioso (I/O di-inject)
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");

// Berkas yang BOLEH menyentuh net-snmp — semuanya jalur ZTE atau infrastrukturnya.
// (Skrip manual ZTE di `scripts/olt-zte-*` diizinkan lewat pola, lihat pemindaian di bawah.)
const SNMP_DIIZINKAN = [
    path.join("lib", "olt-drivers", "zte.js"),
    path.join("lib", "olt-drivers", "snmp-util.js"),
    path.join("lib", "olt-snmp-health.js"),        // OID ZTE enterprise; pemanggilnya dikunci brand=zte
    path.join("lib", "olt-snmp-los-poller.js"),    // hanya start bila ada device losViaSnmp (ZTE)
];

function berkasJs(dir, keluar = []) {
    if (!fs.existsSync(dir)) return keluar;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".git", "__tests__", "tmp", "dist", ".worktrees", "backups"].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) berkasJs(p, keluar);
        else if (e.name.endsWith(".js")) keluar.push(p);
    }
    return keluar;
}

function pemakaiNetSnmp() {
    const hasil = [];
    const daftar = [
        ...berkasJs(path.join(AKAR, "lib")),
        ...berkasJs(path.join(AKAR, "routes")),
        ...berkasJs(path.join(AKAR, "services")),
        ...berkasJs(path.join(AKAR, "message")),
        ...berkasJs(path.join(AKAR, "scripts")),
    ];
    for (const f of daftar) {
        const rel = path.relative(AKAR, f);
        if (SNMP_DIIZINKAN.includes(rel)) continue;
        // Skrip manual khusus ZTE dikenali dari NAMANYA (prefix `olt-zte-`), bukan daftar
        // nama yang harus dirawat tangan — daftar begitu selalu ketinggalan berkas baru.
        if (rel.split(path.sep).join("/").startsWith("scripts/olt-zte-")) continue;
        for (const baris of fs.readFileSync(f, "utf8").split(String.fromCharCode(10))) {
            const t = baris.trim();
            if (t.startsWith("*") || t.startsWith("//")) continue;   // komentar bukan pemakaian
            if (t.includes("net-snmp")) { hasil.push(rel + ": " + t.slice(0, 90)); break; }
        }
    }
    return hasil;
}

describe("#b283 — HIOSO tidak boleh disentuh SNMP", () => {
    test("!! tak ada berkas di luar jalur ZTE yang memakai net-snmp", () => {
        // Kalau ini merah: pindahkan pembacaannya ke web (lib/olt-web-optical), JANGAN
        // menambah nama ke daftar izin — daftar itu untuk jalur ZTE saja.
        expect(pemakaiNetSnmp()).toEqual([]);
    });

    test("penjaganya memindai sesuatu (bukan hijau palsu)", () => {
        // ZTE memang harus muncul sebagai pemakai sah — kalau pemindainya rusak, ini pun kosong.
        const zte = fs.readFileSync(path.join(AKAR, "lib", "olt-drivers", "zte.js"), "utf8");
        expect(zte).toMatch(/net-snmp/);
    });

    test("lib/olt-hioso.js sudah TIDAK memuat kode SNMP", () => {
        const src = fs.readFileSync(path.join(AKAR, "lib", "olt-hioso.js"), "utf8");
        expect(src).not.toMatch(/snmp\.createSession/);
        expect(src).not.toMatch(/require\(['"]net-snmp['"]\)/);
    });

    test("driver HIOSO membaca lewat WEB, bukan SNMP", () => {
        const src = fs.readFileSync(path.join(AKAR, "lib", "olt-drivers", "hioso.js"), "utf8");
        expect(src).toMatch(/olt-web-optical/);
        expect(src).not.toMatch(/net-snmp/);
        // Kapabilitasnya pun harus jujur menyatakan SNMP tak bisa dipakai membedakan LOS/DG.
        expect(src).toMatch(/losViaSnmp:\s*false/);
    });

    test("ZTE TIDAK ikut dilarang — larangannya khusus HIOSO", () => {
        const zte = require("../olt-drivers/zte.js");
        expect(zte.brand).toBe("zte");
        expect(zte.capabilities.losViaSnmp).toBe(true);
    });

        describe("deteksi merek otomatis tidak boleh men-SNMP HIOSO", () => {
        test("!! halaman web HIOSO dikenali TANPA satu paket SNMP pun", async () => {
            jest.resetModules();
            let snmpDipakai = false;
            jest.doMock("../olt-drivers/snmp-util", () => ({
                snmpGet: async () => { snmpDipakai = true; return {}; },
                snmpWalk: async () => { snmpDipakai = true; return []; },
            }));
            jest.doMock("../olt-web-optical", () => ({
                fetchPage: async () => ({ ok: true, code: 200, body: "<table id=\"ponListTable\"></table>" }),
            }));
            const { detectBrand } = require("../olt-drivers");
            const brand = await detectBrand({ host: "1.1.1.1", webUsername: "u", webPassword: "p" });
            expect(brand).toBe("hioso");
            expect(snmpDipakai).toBe(false);
            jest.dontMock("../olt-drivers/snmp-util");
            jest.dontMock("../olt-web-optical");
        });

        test("brand yang sudah jelas disebut tidak di-probe sama sekali", async () => {
            jest.resetModules();
            let adaProbe = false;
            jest.doMock("../olt-drivers/snmp-util", () => ({
                snmpGet: async () => { adaProbe = true; return {}; },
                snmpWalk: async () => { adaProbe = true; return []; },
            }));
            jest.doMock("../olt-web-optical", () => ({
                fetchPage: async () => { adaProbe = true; return { ok: false }; },
            }));
            const { detectBrand } = require("../olt-drivers");
            expect(await detectBrand({ host: "1.1.1.1", brand: "hioso" })).toBe("hioso");
            expect(adaProbe).toBe(false);
            jest.dontMock("../olt-drivers/snmp-util");
            jest.dontMock("../olt-web-optical");
        });

        test("bukan HIOSO (web bisu) → SNMP tetap boleh dipakai, ZTE terdeteksi", async () => {
            // Kalau tes ini hijau tanpa SNMP pernah dipanggil, artinya deteksi ZTE ikut mati.
            jest.resetModules();
            let snmpDipakai = false;
            jest.doMock("../olt-drivers/snmp-util", () => ({
                snmpGet: async () => {
                    snmpDipakai = true;
                    return { "1.3.6.1.2.1.1.2.0": { value: "1.3.6.1.4.1.3902.1082" }, "1.3.6.1.2.1.1.1.0": { value: "ZXAN" } };
                },
                snmpWalk: async () => [],
            }));
            jest.doMock("../olt-web-optical", () => ({ fetchPage: async () => ({ ok: false, code: 0 }) }));
            const { detectBrand } = require("../olt-drivers");
            const brand = await detectBrand({ host: "2.2.2.2", webUsername: "u", webPassword: "p" });
            expect(snmpDipakai).toBe(true);
            expect(brand).toBe("zte");
            jest.dontMock("../olt-drivers/snmp-util");
            jest.dontMock("../olt-web-optical");
        });
    });

    test("!! tak ada skrip yang men-SNMP OID HIOSO (enterprise 25355)", () => {
        // 18 skrip debug SNMP HIOSO dibuang di #b283. Semuanya membaca `config.olt.host`
        // yang kebetulan sudah undefined — jadi 'aman'-nya cuma kebetulan, satu baris config
        // memulihkannya jadi senjata aktif. Penggantinya: `scripts/olt-web-debug.js`.
        const nakal = [];
        for (const p of berkasJs(path.join(AKAR, "scripts"))) {
            const src = fs.readFileSync(p, "utf8");
            if (src.includes("net-snmp") && /1.3.6.1.4.1.25355/.test(src)) {
                nakal.push(path.relative(AKAR, p));
            }
        }
        expect(nakal).toEqual([]);
    });

    test("pengganti berbasis web-nya ADA (kemampuannya dipindah, bukan dihapus)", () => {
        const p = path.join(AKAR, "scripts", "olt-web-debug.js");
        expect(fs.existsSync(p)).toBe(true);
        const src = fs.readFileSync(p, "utf8");
        expect(src).not.toMatch(/net-snmp/);
        expect(src).toMatch(/olt-web-optical/);
    });

    describe("jaminan #b192 tetap berlaku di jalur web", () => {
        const driver = require("../olt-drivers/hioso.js");

        test("!! web gagal dibaca → status error, BUKAN success berisi nol ONU", async () => {
            jest.resetModules();
            jest.doMock("../olt-web-optical", () => ({
                getWebOpticalSnapshot: async () => ({
                    status: "success", onus: [],
                    failedOlts: [{ oltName: "OLT A", oltHost: "1.1.1.1", message: "timeout" }],
                }),
            }));
            jest.doMock("../olt-manager", () => ({ getOltDevices: () => [{ host: "1.1.1.1", webUsername: "u", webPassword: "p" }] }));
            const d = require("../olt-drivers/hioso.js");
            const r = await d.getOltData({ host: "1.1.1.1" });
            expect(r.status).toBe("error");
            expect(r.onus).toEqual([]);
            expect(r.message).toMatch(/tak terbaca/i);
            jest.dontMock("../olt-web-optical");
            jest.dontMock("../olt-manager");
        });

        test("kredensial web kosong → GAGAL TERANG-TERANGAN, tidak diam-diam balik ke SNMP", async () => {
            jest.resetModules();
            jest.doMock("../olt-manager", () => ({ getOltDevices: () => [] }));
            const d = require("../olt-drivers/hioso.js");
            const r = await d.getOltData({ host: "9.9.9.9" });
            expect(r.status).toBe("error");
            expect(r.message).toMatch(/kredensial web/i);
            expect(r.message).toMatch(/hang/i);
            jest.dontMock("../olt-manager");
        });

        test("!! sumberOptik=\"snmp\" TIDAK membuka jalan SNMP untuk HIOSO", async () => {
            // Saklar lama ini masih ada dan namanya menjanjikan SNMP. Kalau seseorang
            // menyalakannya di config produksi, HIOSO harus TETAP lewat web — kalau tidak,
            // satu baris config bisa menggantung OLT.
            jest.resetModules();
            let webDipakai = false;
            jest.doMock("../olt-web-optical", () => ({
                getWebOpticalSnapshot: async () => { webDipakai = true; return { status: "success", onus: [{ macAddress: "AA:BB:CC:DD:EE:FF" }], failedOlts: [] }; },
            }));
            jest.doMock("../olt-manager", () => ({
                getOltDevices: () => [{ id: 1, host: "1.1.1.1", brand: "hioso", webUsername: "u", webPassword: "p" }],
                getOltFromMac: () => null,
            }));
            const cfgLama = global.config;
            global.config = { olt: { sumberOptik: "snmp" } };
            try {
                const { ambilDataOlt } = require("../olt-optical-resolver");
                const hasil = await ambilDataOlt([{ id: 1, name: "OLT A", host: "1.1.1.1", brand: "hioso", webUsername: "u", webPassword: "p" }]);
                // (a) cabang "snmp" MEMANG diambil — hanya jalur dispatch per-merek yang
                //     menghasilkan `oltResults` & menstempel olt_id pada tiap ONU. Tanpa cek
                //     ini tesnya juga hijau kalau saklarnya diam-diam diabaikan.
                expect(Array.isArray(hasil.oltResults)).toBe(true);
                expect(hasil.onus[0].olt_id).toBe(1);
                // (b) ...dan cabang itu tetap bermuara di WEB, bukan SNMP.
                expect(webDipakai).toBe(true);
            } finally {
                global.config = cfgLama;
                jest.dontMock("../olt-web-optical");
                jest.dontMock("../olt-manager");
            }
        });

        test("driver punya bentuk kontrak yang sama seperti sebelumnya", () => {
            for (const k of ["getOltData", "getSingleOnuData", "testConnection", "matchIdentity"]) {
                expect(typeof driver[k]).toBe("function");
            }
        });
    });
});
