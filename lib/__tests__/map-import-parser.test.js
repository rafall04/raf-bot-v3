/**
 * Header Doc
 * Purpose: Mengunci penerjemahan ekspor Google Maps → titik aset. Yang paling wajib dijaga:
 *          URUTAN KOORDINAT (Google menulis lng,lat — repo ini lat,lng) dan PEMILAHAN NAMA
 *          (penanda lain di peta yang sama, mis. "SERVER"/"INPUT"/nama toko, tak boleh ikut jadi aset).
 *          Nama contoh diambil dari peta asli operator: ODC_KARANG, ODP_01, ODP_07, SERVER, INPUT.
 * Caller: Jest.
 * Deps: ../map-import-parser.
 * SideEffects: Tidak ada.
 */
"use strict";

const { parseMapExport, classifyAssetName } = require("../map-import-parser");

// Titik nyata dari peta operator (Tanjungharjo) — bujur 111.88…, lintang -7.19…
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Jaringan</name>
  <Placemark><name>ODC_KARANG</name><Point><coordinates>111.8846,-7.1979,0</coordinates></Point></Placemark>
  <Placemark><name>ODP_01</name><Point><coordinates>111.8878,-7.1984,0</coordinates></Point></Placemark>
  <Placemark><name>ODP_07</name><Point><coordinates>111.8829,-7.1976,0</coordinates></Point></Placemark>
  <Placemark><name>SERVER</name><Point><coordinates>111.8871,-7.1975,0</coordinates></Point></Placemark>
  <Placemark><name>Jalur ODC ke ODP_01</name><LineString><coordinates>
     111.8846,-7.1979,0 111.8860,-7.1981,0 111.8878,-7.1984,0
  </coordinates></LineString></Placemark>
</Document></kml>`;

describe("classifyAssetName", () => {
    test("mengenali penamaan operator apa adanya", () => {
        expect(classifyAssetName("ODC_KARANG")).toBe("ODC");
        expect(classifyAssetName("ODC_KARANG_02")).toBe("ODC");
        expect(classifyAssetName("ODP_01")).toBe("ODP");
        expect(classifyAssetName("odp-09")).toBe("ODP");
        expect(classifyAssetName("ODP 05")).toBe("ODP");
    });

    test("penanda lain di peta yang sama TIDAK ikut jadi aset", () => {
        ["SERVER", "INPUT", "Warkop Ayik", "Alfamart Tanjungharjo", ""].forEach((n) => {
            expect(classifyAssetName(n)).toBeNull();
        });
    });

    test("tidak termakan kata yang kebetulan berawalan sama", () => {
        expect(classifyAssetName("ODPRINTER")).toBeNull();
        expect(classifyAssetName("Odcokan")).toBeNull();
    });
});

describe("parseMapExport — KML", () => {
    test("membaca titik DAN membalik urutan koordinat Google (lng,lat → lat,lng)", () => {
        const { points, format } = parseMapExport(KML, "peta.kml");
        expect(format).toBe("kml");
        expect(points).toHaveLength(4); // SERVER ikut terbaca; pemilahan aset terjadi di importer

        const odc = points.find((p) => p.name === "ODC_KARANG");
        expect(odc.lat).toBeCloseTo(-7.1979, 4); // lintang NEGATIF — kalau tertukar, jadi +111 (mustahil)
        expect(odc.lng).toBeCloseTo(111.8846, 4);
    });

    test("garis (jalur kabel yang sudah digambar di My Maps) ikut terbaca berurutan", () => {
        const { lines } = parseMapExport(KML, "peta.kml");
        expect(lines).toHaveLength(1);
        expect(lines[0].points).toHaveLength(3);
        expect(lines[0].points[0][0]).toBeCloseTo(-7.1979, 4);
        expect(lines[0].points[2][1]).toBeCloseTo(111.8878, 4);
    });
});

describe("parseMapExport — GeoJSON & CSV", () => {
    test("GeoJSON (Takeout) — nama dari properties, koordinat dibalik", () => {
        const geo = JSON.stringify({
            type: "FeatureCollection",
            features: [
                { type: "Feature", properties: { name: "ODP_03" }, geometry: { type: "Point", coordinates: [111.8865, -7.1982] } },
                { type: "Feature", properties: { Title: "ODC_KARANG_02" }, geometry: { type: "Point", coordinates: [111.8858, -7.1996] } }
            ]
        });
        const { points, format } = parseMapExport(geo, "takeout.json");
        expect(format).toBe("geojson");
        expect(points.map((p) => p.name)).toEqual(["ODP_03", "ODC_KARANG_02"]);
        expect(points[0].lat).toBeCloseTo(-7.1982, 4);
    });

    test("CSV kolom lat/lng terpisah", () => {
        const csv = "name,lat,lng\nODP_05,-7.1980,111.8837\n\"Warkop, Ayik\",-7.1970,111.8890";
        const { points } = parseMapExport(csv, "titik.csv");
        expect(points).toHaveLength(2);
        expect(points[1].name).toBe("Warkop, Ayik"); // koma di dalam tanda kutip tak memecah kolom
    });

    test("CSV kolom WKT (bentuk ekspor My Maps) — POINT (lng lat)", () => {
        const csv = 'WKT,name\n"POINT (111.8878 -7.1984)",ODP_01\n"LINESTRING (111.8846 -7.1979, 111.8878 -7.1984)",Jalur 1';
        const { points, lines } = parseMapExport(csv, "mymaps.csv");
        expect(points).toHaveLength(1);
        expect(points[0].lat).toBeCloseTo(-7.1984, 4);
        expect(lines).toHaveLength(1);
        expect(lines[0].points).toHaveLength(2);
    });

    test("koordinat 0/kosong dibuang, bukan disimpan sebagai titik (0,0)", () => {
        const csv = "name,lat,lng\nODP_KOSONG,,\nODP_NOL,0,0\nODP_OK,-7.1984,111.8878";
        const { points } = parseMapExport(csv, "x.csv");
        expect(points.map((p) => p.name)).toEqual(["ODP_OK"]);
    });

    // Bentuk ekspor DAFTAR TERSIMPAN (Takeout → "Disimpan"): tak ada kolom lat/lng sama sekali,
    // hanya Title,Note,URL — koordinatnya harus dipungut dari URL.
    test("CSV Daftar Tersimpan — koordinat dipungut dari URL Google Maps", () => {
        const csv = [
            "Title,Note,URL",
            'ODP_01,,"https://www.google.com/maps/place/ODP_01/@-7.1984,111.8878,17z/data=!3m1!4b1!4m6!3m5!1s0x2e77!8m2!3d-7.19845!4d111.88781"',
            'ODC_KARANG,,"https://www.google.com/maps/search/?api=1&query=-7.1979,111.8846"',
            'ODP_05,,"https://maps.google.com/?q=-7.1980,111.8837"'
        ].join("\n");

        const { points } = parseMapExport(csv, "ODP.csv");
        expect(points.map((p) => p.name)).toEqual(["ODP_01", "ODC_KARANG", "ODP_05"]);
        // !3d/!4d = titik PIN, harus menang atas @lat,lng (posisi kamera) yang muncul lebih dulu di URL
        expect(points[0].lat).toBeCloseTo(-7.19845, 5);
        expect(points[0].lng).toBeCloseTo(111.88781, 5);
    });

    test("link pendek tanpa koordinat DILAPORKAN, bukan ditebak", () => {
        const csv = [
            "Title,Note,URL",
            "ODP_09,,https://maps.app.goo.gl/AbCdEf123",
            "ODP_03,,https://www.google.com/maps/search/?api=1&query=-7.1982,111.8865"
        ].join("\n");

        const hasil = parseMapExport(csv, "ODP.csv");
        expect(hasil.points.map((p) => p.name)).toEqual(["ODP_03"]);
        expect(hasil.noCoord.map((n) => n.name)).toEqual(["ODP_09"]);
    });

    test("berkas kosong tak meledak", () => {
        expect(parseMapExport("", "x.kml")).toEqual({ points: [], lines: [], format: "kosong" });
    });
});
