/**
 * Header Doc
 * Purpose: Mengunci RENCANA impor peta (fungsi murni `susunRencana`) — bagian yang menentukan apakah
 *          impor massal menata peta atau justru mengotorinya: nama yang sudah ada harus DIPERBARUI
 *          (bukan jadi kembar), induk ODC dipilih dari yang terdekat termasuk ODC yang baru diimpor,
 *          penanda non-aset diabaikan, dan garis hanya jadi jalur bila KEDUA ujungnya menempel.
 * Caller: Jest.
 * Deps: ../import-map-assets (tak menyentuh jaringan/file — hanya fungsi murni yang diuji).
 * SideEffects: Tidak ada.
 */
"use strict";

const { susunRencana } = require("../import-map-assets");

const ODC = { id: "ODC-KARANG-001", type: "ODC", name: "ODC_KARANG", latitude: -7.1979, longitude: 111.8846, capacity_ports: 0 };

function parsed(points, lines = []) {
    return { points, lines, format: "kml" };
}

describe("susunRencana", () => {
    test("titik baru dibuat, dan ODP menempel ke ODC terdekat", () => {
        const r = susunRencana(parsed([
            { name: "ODP_01", lat: -7.1984, lng: 111.8878 },
            { name: "ODP_07", lat: -7.1976, lng: 111.8829 }
        ]), [ODC]);

        expect(r.buat).toHaveLength(2);
        r.buat.forEach((b) => {
            expect(b.tipe).toBe("ODP");
            expect(b.induk.name).toBe("ODC_KARANG");
            expect(b.induk.meter).toBeGreaterThan(0);
        });
    });

    test("ODC yang BARU diimpor bisa langsung jadi induk ODP di berkas yang sama", () => {
        const r = susunRencana(parsed([
            { name: "ODC_KARANG_02", lat: -7.1996, lng: 111.8858 },
            { name: "ODP_09", lat: -7.1993, lng: 111.8851 }
        ]), []); // bot masih kosong

        const odp = r.buat.find((b) => b.name === "ODP_09");
        expect(odp.induk.name).toBe("ODC_KARANG_02");
        expect(odp.induk.id).toBeNull(); // ID-nya baru ada setelah POST — importer memetakannya saat apply
    });

    test("nama yang SUDAH ADA diperbarui titiknya, tidak dibuat kembar", () => {
        const r = susunRencana(parsed([{ name: "ODC_KARANG", lat: -7.1980, lng: 111.8850 }]), [ODC]);

        expect(r.buat).toHaveLength(0);
        expect(r.perbarui).toHaveLength(1);
        expect(r.perbarui[0].id).toBe("ODC-KARANG-001");
        expect(r.perbarui[0].geser).toBeGreaterThan(0); // dilaporkan bergeser berapa meter
    });

    test("nama ganda di data bot DILEWATI — komputer tak boleh menebak yang mana", () => {
        const kembar = [ODC, { ...ODC, id: "ODC-KARANG-002" }];
        const r = susunRencana(parsed([{ name: "ODC_KARANG", lat: -7.198, lng: 111.885 }]), kembar);

        expect(r.buat).toHaveLength(0);
        expect(r.perbarui).toHaveLength(0);
        expect(r.lewati[0].alasan).toMatch(/ganda/);
    });

    test("penanda lain di peta yang sama tidak ikut terseret jadi aset", () => {
        const r = susunRencana(parsed([
            { name: "SERVER", lat: -7.1975, lng: 111.8871 },
            { name: "INPUT", lat: -7.1990, lng: 111.8855 },
            { name: "Warkop Ayik", lat: -7.1970, lng: 111.8890 }
        ]), [ODC]);

        expect(r.buat).toHaveLength(0);
        expect(r.lewati).toHaveLength(3);
        expect(r.lewati[0].alasan).toMatch(/bukan ODC\/ODP/);
    });

    test("ODP di luar radius induk tetap dibuat, tapi TANPA induk (jangan menebak)", () => {
        const jauh = { name: "ODP_JAUH", lat: -7.3500, lng: 111.9500 }; // belasan km
        const r = susunRencana(parsed([jauh]), [ODC]);

        expect(r.buat[0].induk).toBeNull();
    });

    test("garis jadi jalur bila kedua ujungnya menempel, dan arahnya dinormalkan ODC→ODP", () => {
        const r = susunRencana(parsed(
            [{ name: "ODP_01", lat: -7.1984, lng: 111.8878 }],
            // digambar dari ODP ke ODC (terbalik) — harus dibalik saat disimpan
            [{ name: "jalur 1", points: [[-7.1984, 111.8878], [-7.1981, 111.8860], [-7.1979, 111.8846]] }]
        ), [ODC]);

        expect(r.jalur).toHaveLength(1);
        expect(r.jalur[0].odc.nama).toBe("ODC_KARANG");
        expect(r.jalur[0].odp.nama).toBe("ODP_01");
        expect(r.jalur[0].points[0]).toEqual([-7.1979, 111.8846]); // mulai dari ODC
    });

    test("garis dengan ujung menggantung TIDAK ditebak — dilaporkan alasannya", () => {
        const r = susunRencana(parsed(
            [{ name: "ODP_01", lat: -7.1984, lng: 111.8878 }],
            [{ name: "garis nyasar", points: [[-7.2500, 111.9500], [-7.1984, 111.8878]] }]
        ), [ODC]);

        expect(r.jalur).toHaveLength(0);
        expect(r.lewati.some((l) => /ujung garis/.test(l.alasan))).toBe(true);
    });
});
