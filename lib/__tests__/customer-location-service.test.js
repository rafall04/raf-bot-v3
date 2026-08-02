/**
 * Header Doc
 * Purpose: Test gerbang penetapan titik rumah pelanggan — urai koordinat (pin/link maps/ketikan),
 *          tolak titik terlarang, tampilkan titik LAMA sebelum menimpa, dan tangkap pola
 *          "satu titik distempel ke banyak pelanggan" yang dulu bikin 92 pelanggan menumpuk.
 * Caller: Jest.
 * Deps: ../customer-location-service (murni).
 * SideEffects: tidak ada.
 */
"use strict";

const {
    parseCoordinateInput,
    haversineMeters,
    evaluateLocationCandidate,
    formatDistance,
    LOCATION_SOURCES
} = require("../customer-location-service");

const NOW = Date.parse("2026-07-21T10:00:00.000Z");
const RUMAH = { lat: -7.195085, lng: 111.8909083 };

describe("parseCoordinateInput", () => {
    test("ketikan koordinat polos", () => {
        expect(parseCoordinateInput("-7.195085, 111.890908")).toEqual({ lat: -7.195085, lng: 111.890908 });
        expect(parseCoordinateInput("-7.195085,111.890908")).toEqual({ lat: -7.195085, lng: 111.890908 });
        expect(parseCoordinateInput(" -7.195085 111.890908 ")).toEqual({ lat: -7.195085, lng: 111.890908 });
    });

    test("berbagai bentuk link Google Maps", () => {
        expect(parseCoordinateInput("https://maps.google.com/?q=-7.195085,111.890908"))
            .toEqual({ lat: -7.195085, lng: 111.890908 });
        expect(parseCoordinateInput("https://www.google.com/maps/@-7.195085,111.890908,17z"))
            .toEqual({ lat: -7.195085, lng: 111.890908 });
        expect(parseCoordinateInput("https://www.google.com/maps/place/Rumah/@-7.195085,111.890908,19z/data=x"))
            .toEqual({ lat: -7.195085, lng: 111.890908 });
        expect(parseCoordinateInput("geo:-7.195085,111.890908")).toEqual({ lat: -7.195085, lng: 111.890908 });
    });

    test("link PENDEK dijelaskan, bukan gagal diam-diam", () => {
        const r = parseCoordinateInput("https://maps.app.goo.gl/abc123");
        expect(r.error).toMatch(/Link pendek/i);
    });

    test("masukan tak dikenal → null; koordinat ngawur → error", () => {
        expect(parseCoordinateInput("rumah pak budi")).toBeNull();
        expect(parseCoordinateInput("")).toBeNull();
        expect(parseCoordinateInput("999.9, 111.8").error).toMatch(/tidak masuk akal/i);
    });

    test("(0,0) ditolak — hampir selalu tanda koordinat gagal terbaca", () => {
        expect(parseCoordinateInput("0,0").error).toMatch(/tidak masuk akal/i);
    });
});

describe("haversineMeters", () => {
    test("jarak dua titik berdekatan masuk akal", () => {
        // ~0.0009 derajat lintang ≈ 100 m
        expect(haversineMeters(-7.195, 111.89, -7.1959, 111.89)).toBeGreaterThan(90);
        expect(haversineMeters(-7.195, 111.89, -7.1959, 111.89)).toBeLessThan(110);
    });
    test("titik sama = 0 m", () => {
        expect(haversineMeters(-7.195, 111.89, -7.195, 111.89)).toBe(0);
    });
});

describe("evaluateLocationCandidate", () => {
    test("titik wajar → boleh, dengan tetangga terdekat sbg bahan penilaian", () => {
        const r = evaluateLocationCandidate({
            point: RUMAH,
            customer: { id: 41, name: "Imam Ghozali" },
            users: [{ id: 96, name: "agus supriono", latitude: -7.1985798, longitude: 111.8869848 }],
            assets: [{ id: "ODP-1", name: "ODP Ngitik-02", type: "ODP", latitude: -7.1955, longitude: 111.8915 }],
            nowMs: NOW
        });
        expect(r.blocked).toBe(false);
        expect(r.ok).toBe(true);
        expect(r.nearestCustomer.name).toBe("agus supriono");
        expect(r.nearestAsset.name).toBe("ODP Ngitik-02");
        expect(r.mapsUrl).toContain("-7.195085");
        expect(r.warnings).toHaveLength(0);
    });

    test("TITIK DEFAULT lama panel DITOLAK KERAS (tak bisa dipaksa)", () => {
        const r = evaluateLocationCandidate({
            point: { lat: -7.24139, lng: 111.83833 },
            customer: { id: 1, name: "X" },
            users: [], nowMs: NOW
        });
        expect(r.blocked).toBe(true);
        expect(r.ok).toBe(false);
        expect(r.blockReason).toMatch(/basecamp|default/i);
    });

    test("titik dekat basecamp (dalam radius) juga ditolak", () => {
        const r = evaluateLocationCandidate({
            point: { lat: -7.24145, lng: 111.83838 },
            customer: { id: 1, name: "X" }, users: [], nowMs: NOW
        });
        expect(r.blocked).toBe(true);
    });

    // Permintaan eksplisit: setiap kali mau memasukkan titik, titik LAMA harus ikut ditampilkan.
    test("titik LAMA pelanggan ikut dikembalikan lengkap dengan jarak geser", () => {
        const r = evaluateLocationCandidate({
            point: RUMAH,
            customer: {
                id: 41, name: "Imam", latitude: -7.1985798, longitude: 111.8869848,
                location_source: LOCATION_SOURCES.PSB_WIZARD, location_updated_at: "2026-07-20T22:50:08.534Z"
            },
            users: [], nowMs: NOW
        });
        expect(r.previous).not.toBeNull();
        expect(r.previous.source).toBe("psb_wizard");
        expect(r.previous.distanceM).toBeGreaterThan(500);
        expect(r.previous.mapsUrl).toContain("-7.1985798");
    });

    test("pelanggan belum punya titik → previous null (tak mengarang)", () => {
        const r = evaluateLocationCandidate({ point: RUMAH, customer: { id: 41, name: "Imam" }, users: [], nowMs: NOW });
        expect(r.previous).toBeNull();
    });

    // Penawar langsung penyakit lama: satu titik distempel ke banyak pelanggan.
    test("titik sama dgn yang BARU SAJA disimpan utk pelanggan lain → peringatan", () => {
        const r = evaluateLocationCandidate({
            point: RUMAH,
            customer: { id: 41, name: "Imam" },
            users: [{
                id: 96, name: "agus supriono",
                latitude: RUMAH.lat, longitude: RUMAH.lng,
                location_updated_at: new Date(NOW - 5 * 60 * 1000).toISOString()
            }],
            nowMs: NOW
        });
        expect(r.blocked).toBe(false); // tetap boleh — kadang dua rumah memang berdempetan
        expect(r.warnings.map((w) => w.code)).toContain("titik_berulang");
        expect(r.warnings[0].message).toMatch(/agus supriono/);
    });

    test("titik sama tapi disimpan LAMA (di luar jendela) → bukan peringatan", () => {
        const r = evaluateLocationCandidate({
            point: RUMAH,
            customer: { id: 41, name: "Imam" },
            users: [{
                id: 96, name: "agus", latitude: RUMAH.lat, longitude: RUMAH.lng,
                location_updated_at: new Date(NOW - 5 * 60 * 60 * 1000).toISOString()
            }],
            nowMs: NOW
        });
        expect(r.warnings.map((w) => w.code)).not.toContain("titik_berulang");
    });

    test("titik jauh dari semua titik dikenal → peringatan nyasar (tetap boleh)", () => {
        const r = evaluateLocationCandidate({
            point: { lat: -6.2, lng: 106.8 }, // Jakarta
            customer: { id: 41, name: "Imam" },
            users: [{ id: 96, name: "agus", latitude: -7.1985798, longitude: 111.8869848 }],
            nowMs: NOW
        });
        expect(r.blocked).toBe(false);
        expect(r.warnings.map((w) => w.code)).toContain("jauh_dari_area");
    });

    test("koordinat tak valid → ditolak", () => {
        expect(evaluateLocationCandidate({ point: { lat: null, lng: null } }).blocked).toBe(true);
        expect(evaluateLocationCandidate({ point: { lat: 0, lng: 0 } }).blocked).toBe(true);
    });
});

describe("formatDistance", () => {
    test("meter di bawah 1 km, kilometer di atasnya", () => {
        expect(formatDistance(85)).toBe("85 m");
        expect(formatDistance(3500)).toBe("3.5 km");
    });
});

// Sumber titik dipakai untuk MENILAI kelayakan sebuah koordinat belakangan (itu sebabnya kolomnya
// ada — 92 titik palsu dulu terpaksa dihapus buta karena tak bisa dipisahkan dari yang asli).
// Teknisi-lewat-web menandai sambil berdiri di depan rumah, admin-lewat-web menandai dari kantor
// atas kiriman orang lain: dua situasi berbeda yang TIDAK boleh tercatat sebagai satu nilai.
describe("LOCATION_SOURCES", () => {
    test("teknisi web punya nilai sendiri, terpisah dari admin web", () => {
        expect(LOCATION_SOURCES.TEKNISI_WEB).toBe("teknisi_web");
        expect(LOCATION_SOURCES.TEKNISI_WEB).not.toBe(LOCATION_SOURCES.ADMIN_WEB);
    });

    test("semua sumber unik — dua jalur tak boleh berbagi label", () => {
        const nilai = Object.values(LOCATION_SOURCES);
        expect(new Set(nilai).size).toBe(nilai.length);
    });
});
