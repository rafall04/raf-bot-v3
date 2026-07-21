/**
 * Header Doc
 * Purpose: Test parser murni caption PSB grup (parsePsbCaption) — valid, alias key, paket fuzzy, error.
 * Caller: Jest.
 * Deps: ../psb-caption-parser.
 * SideEffects: Tidak ada.
 */
"use strict";

const { parsePsbCaption, isPsbCaption, extractPsbFields } = require("../psb-caption-parser");

const PACKAGES = [
    { name: "PAKET-110K", profile: "16Mbps" },
    { name: "PAKET-125K", profile: "22Mbps" }
];

describe("parsePsbCaption", () => {
    test("caption valid → ok + data lengkap + paket kanonik", () => {
        const cap = "#PSB\nNama: Budi Santoso\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";
        const r = parsePsbCaption(cap, { packages: PACKAGES });
        expect(r.ok).toBe(true);
        expect(r.data).toMatchObject({
            nama: "Budi Santoso", paket: "PAKET-110K", wifi_ssid: "BudiNet",
            wifi_password: "budi12345", hp: "08123456789"
        });
    });

    test("dusun ke-parse saat ada (alias: dusun/dsn/dukuh)", () => {
        const cap = "#PSB\nNama: Budi\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";
        const r = parsePsbCaption(cap, { packages: PACKAGES });
        expect(r.ok).toBe(true);
        expect(r.data.dusun).toBe("Krajan");
    });

    test("tanpa dusun → parser TETAP ok (opsional di parser; wizard DM yang mewajibkan)", () => {
        const cap = "#PSB\nNama: Budi\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789";
        const r = parsePsbCaption(cap, { packages: PACKAGES });
        expect(r.ok).toBe(true);
        expect(r.data.dusun).toBe("");
    });

    test("alias key (No HP / Password / SSID) + paket via profil", () => {
        const cap = "#psb\nNAMA : Siti\nPackage: 16Mbps\nSSID: SitiWifi\nPassword: rahasia99\nNo HP: 62812000111";
        const r = parsePsbCaption(cap, { packages: PACKAGES });
        expect(r.ok).toBe(true);
        expect(r.data.paket).toBe("PAKET-110K"); // 16Mbps → PAKET-110K
        expect(r.data.nama).toBe("Siti");
        expect(r.data.wifi_ssid).toBe("SitiWifi");
    });

    test("bukan #PSB → isPsb false, tak diproses", () => {
        const r = parsePsbCaption("halo ini chat biasa", { packages: PACKAGES });
        expect(r.isPsb).toBe(false);
        expect(r.ok).toBe(false);
        expect(isPsbCaption("halo")).toBe(false);
        expect(isPsbCaption("#PSB\nNama: X")).toBe(true);
    });

    test("field kurang + paket ngawur + HP invalid → errors terkumpul", () => {
        const cap = "#PSB\nNama: Andi\nPaket: PAKET-999\nWiFi: AndiNet\nSandi: 123\nHP: 08";
        const r = parsePsbCaption(cap, { packages: PACKAGES });
        expect(r.ok).toBe(false);
        expect(r.errors.join(" ")).toMatch(/tak dikenal/);
        expect(r.errors.join(" ")).toMatch(/Sandi WiFi minimal/);
        expect(r.errors.join(" ")).toMatch(/tidak valid/);
    });

    test("HP MULTI-nomor (pipe) → valid + di-normalize (trim spasi, join |)", () => {
        const cap = "#PSB\nNama: Budi\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789 | 6285700000002";
        const r = parsePsbCaption(cap, { packages: PACKAGES });
        expect(r.ok).toBe(true);
        expect(r.data.hp).toBe("08123456789|6285700000002");
    });

    test("HP multi-nomor dgn salah satu invalid → error menyebut nomor buruk", () => {
        const cap = "#PSB\nNama: Budi\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789|123";
        const r = parsePsbCaption(cap, { packages: PACKAGES });
        expect(r.ok).toBe(false);
        expect(r.errors.join(" ")).toMatch(/tidak valid/);
        expect(r.errors.join(" ")).toContain("123");
    });

    // Pemberi lead / marketing OPSIONAL (Fase 1 komisi PSB) — ke-parse tanpa mengganggu validasi wajib.
    test("field Marketing (alias) ke-parse via extractPsbFields; tak bikin caption invalid", () => {
        expect(extractPsbFields("Marketing: Pak Broker").marketing).toBe("Pak Broker");
        expect(extractPsbFields("Pemberi lead: Budi").marketing).toBe("Budi");
        expect(extractPsbFields("Referral: Sales A").marketing).toBe("Sales A");
        const cap = "#PSB\nNama: Budi\nDusun: Krajan\nPaket: PAKET-110K\nWiFi: BudiNet\nSandi: budi12345\nHP: 08123456789\nMarketing: Pak Broker";
        const r = parsePsbCaption(cap, { packages: PACKAGES });
        expect(r.ok).toBe(true);
        expect(r.data.marketing).toBe("Pak Broker");
    });
});

// ── RT/RW & perakit alamat ──────────────────────────────────────────────────────────────
const { normalizeRtRw, composeAddress, titleCaseDusun, validatePsbData } = require("../psb-caption-parser");

describe("normalizeRtRw", () => {
    test("terima berbagai gaya ketikan teknisi → selalu 3 digit", () => {
        expect(normalizeRtRw("14/2")).toEqual({ rt: "014", rw: "002" });
        expect(normalizeRtRw("014/002")).toEqual({ rt: "014", rw: "002" });
        expect(normalizeRtRw("RT 14 RW 2")).toEqual({ rt: "014", rw: "002" });
        expect(normalizeRtRw("rt14rw2")).toEqual({ rt: "014", rw: "002" });
        expect(normalizeRtRw("14-2")).toEqual({ rt: "014", rw: "002" });
        expect(normalizeRtRw("14 2")).toEqual({ rt: "014", rw: "002" });
        expect(normalizeRtRw("rt.5 rw.1")).toEqual({ rt: "005", rw: "001" });
    });

    test("satu angka saja / kosong → null (JANGAN tebak yang hilang)", () => {
        expect(normalizeRtRw("14")).toBeNull();
        expect(normalizeRtRw("RT 14")).toBeNull();
        expect(normalizeRtRw("")).toBeNull();
        expect(normalizeRtRw(null)).toBeNull();
        expect(normalizeRtRw("dua belas")).toBeNull();
    });
});

describe("composeAddress", () => {
    test("format persis seperti data alamat existing", () => {
        expect(composeAddress({ dusun: "ngitik", rt: "014", rw: "002", desa: "Tanjungharjo", kecamatan: "Kapas" }))
            .toBe("Dsn. Ngitik RT 014 RW 002 Ds. Tanjungharjo Kec. Kapas");
    });

    test("bagian yang kosong dilewati — alamat parsial tetap lebih berguna daripada kosong", () => {
        expect(composeAddress({ dusun: "Karang", desa: "Tanjungharjo", kecamatan: "Kapas" }))
            .toBe("Dsn. Karang Ds. Tanjungharjo Kec. Kapas");
        expect(composeAddress({ dusun: "Krajan" })).toBe("Dsn. Krajan");
        expect(composeAddress({})).toBe("");
    });

    test("titleCaseDusun rapikan ejaan untuk alamat", () => {
        expect(titleCaseDusun("ngitik")).toBe("Ngitik");
        expect(titleCaseDusun("SUMBER  rejo")).toBe("Sumber Rejo");
    });
});

describe("validatePsbData requireRtRw", () => {
    const base = { nama: "Budi", dusun: "Krajan", paket: "PAKET-110K", wifi_ssid: "BudiNet", wifi_password: "budi12345", hp: "08123456789" };

    test("wizard: RT/RW wajib & dinormalisasi ke data", () => {
        const kurang = validatePsbData(base, { packages: PACKAGES, requireDusun: true, requireRtRw: true });
        expect(kurang.ok).toBe(false);
        expect(kurang.status.rt_rw).toBe("missing");

        const lengkap = validatePsbData({ ...base, rt_rw: "14/2" }, { packages: PACKAGES, requireDusun: true, requireRtRw: true });
        expect(lengkap.ok).toBe(true);
        expect(lengkap.data.rt_rw).toBe("014/002");
        expect(lengkap.data.rt).toBe("014");
        expect(lengkap.data.rw).toBe("002");
    });

    test("RT/RW ngawur → invalid + pesan mencontohkan format", () => {
        const r = validatePsbData({ ...base, rt_rw: "sebelas" }, { packages: PACKAGES, requireDusun: true, requireRtRw: true });
        expect(r.ok).toBe(false);
        expect(r.status.rt_rw).toBe("invalid");
        expect(r.errors.join(" ")).toMatch(/14\/2/);
    });

    test("alamat bebas diisi → RT/RW tak lagi wajib", () => {
        const r = validatePsbData({ ...base, alamat: "Jl. Raya 12" }, { packages: PACKAGES, requireDusun: true, requireRtRw: true });
        expect(r.ok).toBe(true);
        expect(r.status.rt_rw).toBe("optional");
    });

    test("jalur grup (requireRtRw:false) tak terpengaruh", () => {
        const r = validatePsbData(base, { packages: PACKAGES });
        expect(r.ok).toBe(true);
        expect(r.status.rt_rw).toBe("optional");
    });
});
