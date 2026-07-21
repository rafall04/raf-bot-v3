/**
 * Header Doc
 * Purpose: Mengunci aturan JALUR kabel (waypoint) — satu-satunya pemilik validasi titik & panjang,
 *          dipakai bersama oleh `/api/map/waypoints` (web) dan wizard WA `#JALUR`.
 *          Yang dikunci di sini adalah hal-hal yang kalau lolos akan membuat PETA BERBOHONG:
 *          koordinat 0 yang menyamar jadi titik sah, jalur 1 titik, dan titik kembar 0 meter.
 * Caller: Jest.
 * Deps: ../network-route-service (repo di-inject — tak menyentuh SQLite).
 * SideEffects: Tidak ada.
 */
"use strict";

const svc = require("../network-route-service");

function fakeRepo(seed = {}) {
    const store = new Map(Object.entries(seed));
    const key = (t, s, g) => `${t}|${s}|${g}`;
    return {
        store,
        getConnectionWaypoints: jest.fn(async (t, s, g) => store.get(key(t, s, g)) || null),
        saveConnectionWaypoints: jest.fn(async (t, s, g, points) => { store.set(key(t, s, g), points); return true; }),
        deleteConnectionWaypoints: jest.fn(async (t, s, g) => { store.delete(key(t, s, g)); return true; }),
        getAllConnectionWaypoints: jest.fn(async () => Array.from(store.entries()).map(([k, points]) => {
            const [connection_type, source_id, target_id] = k.split("|");
            return { connection_type, source_id, target_id, waypoints: points, updated_at: "2026-07-21", updated_by: "teknisi" };
        }))
    };
}

// Dua titik ±110 m di Bojonegoro (0.001° lintang ≈ 111 m).
const A = [-7.2500, 111.8400];
const B = [-7.2510, 111.8400];
const C = [-7.2510, 111.8410];

describe("parsePoints", () => {
    test("menerima [lat,lng] maupun {lat,lng}", () => {
        const hasil = svc.parsePoints([A, { lat: B[0], lng: B[1] }]);
        expect(hasil).toEqual([A, B]);
    });

    test("MENOLAK koordinat 0 — Number(null)===0 membuat titik gagal-baca menyamar jadi titik sah", () => {
        expect(() => svc.parsePoints([A, [0, 0]])).toThrow(/Titik ke-2/);
        expect(() => svc.parsePoints([[null, null], B])).toThrow(/Titik ke-1/);
    });

    test("menolak koordinat di luar jangkauan bumi", () => {
        expect(() => svc.parsePoints([A, [95, 200]])).toThrow(/Titik ke-2/);
    });

    test("membuang titik kembar BERURUTAN (teknisi menekan kirim 2×) tanpa menggagalkan jalur", () => {
        const hasil = svc.parsePoints([A, A, B]);
        expect(hasil).toEqual([A, B]);
    });

    test("jalur yang menyusut jadi 1 titik ditolak — itu bukan jalur", () => {
        expect(() => svc.parsePoints([A, A])).toThrow(/minimal 2 titik/);
        expect(() => svc.parsePoints([A])).toThrow(/minimal 2 titik/);
    });

    test("menolak jalur yang tak masuk akal panjangnya (pagar loop lepas kendali)", () => {
        const banyak = Array.from({ length: svc.MAX_POINTS + 1 }, (_v, i) => [-7.25 + i * 0.0001, 111.84]);
        expect(() => svc.parsePoints(banyak)).toThrow(/terlalu banyak/);
    });
});

describe("routeLengthMeters", () => {
    test("menjumlah PANJANG GARIS, bukan jarak lurus ujung-ke-ujung", () => {
        const siku = svc.routeLengthMeters([A, B, C]);
        const lurus = svc.routeLengthMeters([A, C]);
        expect(siku).toBeGreaterThan(lurus); // jalur menyiku selalu lebih panjang — inilah kebutuhan kabel
        expect(siku).toBeGreaterThan(200);
        expect(siku).toBeLessThan(250);
    });
});

describe("simpan / ambil / hapus", () => {
    test("saveRoute menormalkan tipe koneksi dan mengembalikan hitungan panjang", async () => {
        const repo = fakeRepo();
        const hasil = await svc.saveRoute({
            connectionType: "ODC-ODP", sourceId: "ODC-1", targetId: "ODP-9", points: [A, B, C], actor: "teknisi"
        }, { repo });

        expect(hasil.connectionType).toBe("odc-odp");
        expect(hasil.count).toBe(3);
        expect(hasil.meters).toBeGreaterThan(0);
        expect(repo.saveConnectionWaypoints).toHaveBeenCalledWith("odc-odp", "ODC-1", "ODP-9", [A, B, C], "teknisi");
    });

    test("tipe koneksi asing ditolak — typo tak boleh melahirkan jalur kedua yang tak pernah terbaca", async () => {
        const repo = fakeRepo();
        await expect(svc.saveRoute({ connectionType: "odc_odp", sourceId: "1", targetId: "2", points: [A, B] }, { repo }))
            .rejects.toThrow(/tidak dikenal/);
        expect(repo.saveConnectionWaypoints).not.toHaveBeenCalled();
    });

    test("getRoute mengembalikan null (bukan melempar) saat baris lama rusak — satu baris cacat tak boleh menjatuhkan peta", async () => {
        const repo = fakeRepo({ "odc-odp|ODC-1|ODP-9": [[0, 0], [0, 0]] });
        await expect(svc.getRoute("odc-odp", "ODC-1", "ODP-9", { repo })).resolves.toBeNull();
    });

    test("getRoute mengembalikan titik + panjang saat jalur sah", async () => {
        const repo = fakeRepo({ "odc-odp|ODC-1|ODP-9": [A, B, C] });
        const jalur = await svc.getRoute("odc-odp", "ODC-1", "ODP-9", { repo });
        expect(jalur.points).toEqual([A, B, C]);
        expect(jalur.meters).toBeGreaterThan(0);
    });

    test("getAllRoutes memberi kunci gabungan siap-cache untuk klien peta", async () => {
        const repo = fakeRepo({ "odc-odp|ODC-1|ODP-9": [A, B] });
        const semua = await svc.getAllRoutes({ repo });
        expect(semua).toHaveLength(1);
        expect(semua[0].key).toBe(svc.routeKey("odc-odp", "ODC-1", "ODP-9"));
        expect(semua[0].points).toEqual([A, B]);
    });

    test("deleteRoute meneruskan tipe yang sudah dinormalkan", async () => {
        const repo = fakeRepo({ "odc-odp|ODC-1|ODP-9": [A, B] });
        await svc.deleteRoute("ODC-ODP", "ODC-1", "ODP-9", { repo });
        expect(repo.deleteConnectionWaypoints).toHaveBeenCalledWith("odc-odp", "ODC-1", "ODP-9");
    });
});
