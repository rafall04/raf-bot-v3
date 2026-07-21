/**
 * Header Doc
 * Purpose: PARSER MURNI hasil ekspor Google Maps → daftar titik & garis siap dijadikan aset jaringan.
 *          Menerima 3 bentuk ekspor yang benar-benar dikeluarkan Google:
 *            - **KML** (My Maps → "Ekspor ke KML/KMZ", centang "Ekspor sebagai KML")
 *            - **GeoJSON** (Takeout → Maps → Tempat berlabel / My Maps)
 *            - **CSV** (Takeout/My Maps; kolom lat-lng terpisah MAUPUN kolom WKT `POINT (lng lat)`)
 *
 *          KENAPA ADA: titik ODC/ODP milik operator sudah lama ada di Google Maps — mengetik ulang
 *          satu per satu ke bot itu pekerjaan sia-sia sekaligus sumber salah ketik. Yang dibutuhkan
 *          cuma penerjemah: nama + koordinat.
 *
 *          MURNI: tidak menyentuh file, jaringan, maupun global. Semua I/O ada di
 *          `scripts/import-map-assets.js` supaya aturan penerjemahan ini bisa diuji tanpa apa pun.
 *
 *          ⚠️ URUTAN KOORDINAT: KML/GeoJSON/WKT menulis **lng,lat** (bujur dulu) sedangkan seluruh
 *          isi repo ini memakai **lat,lng**. Tertukar = ODP pindah ke Samudra Hindia dengan yakin.
 * Caller: `scripts/import-map-assets.js`.
 * Deps: `cheerio` (mode XML, hanya untuk KML).
 * MainFuncs: `parseMapExport`, `classifyAssetName`, `parseKml`, `parseGeoJson`, `parseCsv`.
 * SideEffects: Tidak ada.
 */
"use strict";

/**
 * Nama menentukan jenis aset — itulah satu-satunya petunjuk yang dibawa ekspor Google.
 * `ODC_KARANG`, `ODP_07`, `odp-09`, `ODC 2` semuanya tertangkap; `SERVER`/`INPUT`/nama toko TIDAK
 * (dikembalikan null) supaya penanda lain di peta yang sama tak ikut terseret jadi aset.
 */
function classifyAssetName(name) {
    const s = String(name || "").trim();
    if (/^odc\b|^odc[\s_.-]/i.test(s)) return "ODC";
    if (/^odp\b|^odp[\s_.-]/i.test(s)) return "ODP";
    return null;
}

/** Koordinat yang benar-benar terisi. `0` ditolak — lihat parseCoord di network-assets-service. */
function coord(lat, lng) {
    const a = Number(lat);
    const b = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (a === 0 || b === 0) return null;
    if (a < -90 || a > 90 || b < -180 || b > 180) return null;
    return { lat: a, lng: b };
}

/** "lng,lat,alt" → {lat,lng}. Urutan Google, BUKAN urutan repo ini. */
function fromKmlTuple(tuple) {
    const bagian = String(tuple || "").trim().split(",");
    if (bagian.length < 2) return null;
    return coord(bagian[1], bagian[0]);
}

function parseKml(text) {
    const cheerio = require("cheerio");
    const $ = cheerio.load(text, { xmlMode: true });
    const points = [];
    const lines = [];

    $("Placemark").each((_i, el) => {
        const node = $(el);
        const nama = node.children("name").first().text().trim();

        const titik = node.find("Point > coordinates").first().text().trim();
        if (titik) {
            const c = fromKmlTuple(titik.split(/\s+/)[0]);
            if (c) points.push({ name: nama, lat: c.lat, lng: c.lng });
            return;
        }

        const garis = node.find("LineString > coordinates").first().text().trim();
        if (garis) {
            const urut = garis.split(/\s+/).map(fromKmlTuple).filter(Boolean).map((c) => [c.lat, c.lng]);
            if (urut.length >= 2) lines.push({ name: nama, points: urut });
        }
    });

    return { points, lines };
}

function parseGeoJson(text) {
    const data = typeof text === "string" ? JSON.parse(text) : text;
    const features = Array.isArray(data.features) ? data.features : (data.type === "Feature" ? [data] : []);
    const points = [];
    const lines = [];

    features.forEach((f) => {
        if (!f || !f.geometry) return;
        const p = f.properties || {};
        // Takeout memakai "Title"/"name"/"Location.Name" tergantung sumbernya.
        const nama = String(p.name || p.Name || p.title || p.Title || (p.location && p.location.name) || (p.Location && p.Location.Name) || "").trim();

        if (f.geometry.type === "Point") {
            const c = coord(f.geometry.coordinates[1], f.geometry.coordinates[0]);
            if (c) points.push({ name: nama, lat: c.lat, lng: c.lng });
            return;
        }
        if (f.geometry.type === "LineString") {
            const urut = (f.geometry.coordinates || [])
                .map((t) => coord(t[1], t[0]))
                .filter(Boolean)
                .map((c) => [c.lat, c.lng]);
            if (urut.length >= 2) lines.push({ name: nama, points: urut });
        }
    });

    return { points, lines };
}

/** Pembelah CSV yang menghormati tanda kutip (nama tempat sering mengandung koma). */
function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuote = !inQuote;
        } else if (ch === "," && !inQuote) {
            out.push(cur); cur = "";
        } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
}

function parseCsv(text) {
    const baris = String(text).split(/\r?\n/).filter((l) => l.trim());
    if (baris.length < 2) return { points: [], lines: [] };

    const header = splitCsvLine(baris[0]).map((h) => h.toLowerCase());
    const cari = (...kandidat) => header.findIndex((h) => kandidat.includes(h));

    const iNama = cari("name", "nama", "title", "judul", "label");
    const iLat = cari("lat", "latitude", "lintang");
    const iLng = cari("lng", "lon", "long", "longitude", "bujur");
    const iWkt = cari("wkt", "geometry", "geometri");

    const points = [];
    const lines = [];

    for (let i = 1; i < baris.length; i++) {
        const kolom = splitCsvLine(baris[i]);
        const nama = iNama >= 0 ? kolom[iNama] : "";

        if (iLat >= 0 && iLng >= 0) {
            const c = coord(kolom[iLat], kolom[iLng]);
            if (c) points.push({ name: nama, lat: c.lat, lng: c.lng });
            continue;
        }

        if (iWkt >= 0) {
            const wkt = String(kolom[iWkt] || "");
            const titik = /^\s*POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)/i.exec(wkt);
            if (titik) {
                const c = coord(titik[2], titik[1]); // WKT = lng lat
                if (c) points.push({ name: nama, lat: c.lat, lng: c.lng });
                continue;
            }
            const garis = /^\s*LINESTRING\s*\(([^)]*)\)/i.exec(wkt);
            if (garis) {
                const urut = garis[1].split(",")
                    .map((pasang) => {
                        const n = pasang.trim().split(/\s+/);
                        return coord(n[1], n[0]);
                    })
                    .filter(Boolean)
                    .map((c) => [c.lat, c.lng]);
                if (urut.length >= 2) lines.push({ name: nama, points: urut });
            }
        }
    }

    return { points, lines };
}

/**
 * Satu pintu untuk ketiga format. `filename` hanya dipakai menebak format; isi berkas yang menentukan
 * (ekspor Google kadang berekstensi .txt/.json bercampur).
 */
function parseMapExport(text, filename = "") {
    const isi = String(text || "").trim();
    if (!isi) return { points: [], lines: [], format: "kosong" };

    const nama = String(filename).toLowerCase();
    let hasil;
    let format;

    if (isi.startsWith("<") || nama.endsWith(".kml")) {
        hasil = parseKml(isi); format = "kml";
    } else if (isi.startsWith("{") || nama.endsWith(".geojson") || nama.endsWith(".json")) {
        hasil = parseGeoJson(isi); format = "geojson";
    } else {
        hasil = parseCsv(isi); format = "csv";
    }

    return { ...hasil, format };
}

module.exports = {
    classifyAssetName,
    parseMapExport,
    parseKml,
    parseGeoJson,
    parseCsv,
    splitCsvLine
};
