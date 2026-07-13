/**
 * Header Doc
 * Purpose: Test parser murni caption PSB grup (parsePsbCaption) — valid, alias key, paket fuzzy, error.
 * Caller: Jest.
 * Deps: ../psb-caption-parser.
 * SideEffects: Tidak ada.
 */
"use strict";

const { parsePsbCaption, isPsbCaption } = require("../psb-caption-parser");

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
});
