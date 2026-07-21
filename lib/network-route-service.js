/**
 * Header Doc
 * Purpose: PEMILIK TUNGGAL "jalur" — rangkaian titik yang dilewati kabel antara dua simpul peta
 *          (ODC→ODP atau pelanggan→ODP). Validasi titik, buang titik kembar, hitung panjang,
 *          lalu simpan/ambil/hapus.
 *
 *          SATU jalur tulis untuk DUA kanal: editor peta di web DAN wizard WA `#JALUR` memanggil
 *          service ini — supaya jalur yang direkam teknisi di lapangan dan yang digambar admin pakai
 *          mouse tak pernah tunduk pada aturan yang diam-diam berbeda (pola yang sama dengan
 *          `lib/network-assets-service` untuk ODC/ODP).
 *
 *          KENAPA INI ADA: peta selama ini selalu menggambar GARIS LURUS. Bukan karena fiturnya
 *          belum dibuat — `static/js/map-viewer.js` sudah punya editor waypoint lengkap dan sudah
 *          memanggil `/api/map/waypoints`, tabel `connection_waypoints` + repository-nya juga sudah
 *          ada — yang hilang cuma lapisan HTTP-nya, dan 404-nya ditelan diam-diam oleh klien
 *          (`if (response.ok)` tanpa cabang else) sehingga tak pernah ada yang mengeluh.
 * Caller: `routes/admin-network-assets-routes.js` (HTTP), `message/handlers/state-domains/network-asset.state.js` (WA `#JALUR`).
 * Deps: `lib/waypoints-repository` (tabel `connection_waypoints` di `database/users.sqlite`),
 *       `lib/network-assets-service` (haversineMeters — jangan tulis rumus jarak kedua).
 * MainFuncs: `parsePoints`, `routeLengthMeters`, `getRoute`, `saveRoute`, `deleteRoute`,
 *            `getAllRoutes`, `routeKey`, `isConnectionType`.
 * SideEffects: `saveRoute`/`deleteRoute` menulis tabel `connection_waypoints`.
 */
"use strict";

const { haversineMeters } = require("./network-assets-service");

// Hanya dua jenis koneksi yang digambar peta hari ini. Daftar TERTUTUP: `connection_type` ikut jadi
// kunci unik baris, jadi typo ("odc_odp") akan diam-diam melahirkan jalur kedua yang tak pernah terbaca.
const CONNECTION_TYPES = ["odc-odp", "customer-odp"];

const MIN_POINTS = 2; // di bawah ini bukan jalur, cuma satu titik
const MAX_POINTS = 500; // pagar: satu jalur desa jarang >50 titik; sisanya pasti loop yang lepas kendali
const DUP_METERS = 1; // dua pin di titik yang sama (teknisi menekan 2×) = ruas sepanjang 0 m

function defaultRepo() {
    return require("./waypoints-repository");
}

function isConnectionType(value) {
    return CONNECTION_TYPES.includes(String(value || "").trim().toLowerCase());
}

function normalizeType(value) {
    const t = String(value || "").trim().toLowerCase();
    if (!CONNECTION_TYPES.includes(t)) {
        throw new Error(`Jenis koneksi "${value}" tidak dikenal. Pilih: ${CONNECTION_TYPES.join(" / ")}.`);
    }
    return t;
}

function normalizeId(value, label) {
    const s = String(value === undefined || value === null ? "" : value).trim();
    if (!s) throw new Error(`${label} wajib diisi.`);
    if (s.length > 100) throw new Error(`${label} terlalu panjang.`);
    return s;
}

/**
 * Satu titik jadi `[lat, lng]` angka. Menerima `[lat,lng]` maupun `{lat,lng}`/`{latitude,longitude}`.
 *
 * `0` DITOLAK sebagai koordinat: `Number(null) === 0`, jadi titik yang gagal terbaca akan menyamar
 * jadi lintang/bujur 0 (Teluk Guinea, ~6.000 km dari sini) dan jalur tampak "tersimpan" padahal
 * melompat ke seberang bumi. Pelajaran yang sama dengan `parseCoord()` di network-assets-service.
 */
function parsePoint(raw) {
    let lat = null;
    let lng = null;

    if (Array.isArray(raw)) {
        lat = Number(raw[0]);
        lng = Number(raw[1]);
    } else if (raw && typeof raw === "object") {
        lat = Number(raw.lat !== undefined ? raw.lat : raw.latitude);
        lng = Number(raw.lng !== undefined ? raw.lng : (raw.lon !== undefined ? raw.lon : raw.longitude));
    } else {
        return null;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat === 0 || lng === 0) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return [lat, lng];
}

/**
 * Deret titik mentah → jalur yang layak disimpan. Melempar Error dengan pesan siap-tampil
 * (dipakai apa adanya oleh HTTP maupun balasan WA).
 */
function parsePoints(raw) {
    if (!Array.isArray(raw)) throw new Error("Titik jalur harus berupa daftar koordinat.");
    if (raw.length > MAX_POINTS) throw new Error(`Titik jalur terlalu banyak (maks ${MAX_POINTS}).`);

    const points = [];
    for (let i = 0; i < raw.length; i++) {
        const p = parsePoint(raw[i]);
        if (!p) throw new Error(`Titik ke-${i + 1} tidak valid (koordinat kosong atau di luar jangkauan).`);

        // Buang titik kembar BERURUTAN saja — jalur boleh melewati persimpangan yang sama dua kali.
        const prev = points[points.length - 1];
        if (prev && haversineMeters(prev[0], prev[1], p[0], p[1]) < DUP_METERS) continue;
        points.push(p);
    }

    if (points.length < MIN_POINTS) {
        throw new Error(`Jalur butuh minimal ${MIN_POINTS} titik berbeda (titik awal dan titik akhir).`);
    }
    return points;
}

/** Panjang jalur mengikuti garisnya — inilah perkiraan kebutuhan kabel, bukan jarak lurus. */
function routeLengthMeters(points) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += haversineMeters(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    }
    return Math.round(total);
}

/** Kunci gabungan untuk cache di sisi klien (satu permintaan untuk SEMUA jalur, bukan satu per garis). */
function routeKey(connectionType, sourceId, targetId) {
    return `${String(connectionType).toLowerCase()}|${sourceId}|${targetId}`;
}

async function getRoute(connectionType, sourceId, targetId, deps = {}) {
    const repo = deps.repo || defaultRepo();
    const type = normalizeType(connectionType);
    const src = normalizeId(sourceId, "sourceId");
    const tgt = normalizeId(targetId, "targetId");

    const rows = await repo.getConnectionWaypoints(type, src, tgt);
    if (!Array.isArray(rows) || rows.length < MIN_POINTS) return null;

    // Data lama bisa saja tersimpan sebelum validasi ini ada — jangan sampai satu baris rusak
    // menjatuhkan seluruh peta; perlakukan sebagai "belum ada jalur".
    try {
        const points = parsePoints(rows);
        return { points, meters: routeLengthMeters(points) };
    } catch (_e) {
        return null;
    }
}

async function saveRoute(input, deps = {}) {
    const repo = deps.repo || defaultRepo();
    const type = normalizeType(input && input.connectionType);
    const src = normalizeId(input && input.sourceId, "sourceId");
    const tgt = normalizeId(input && input.targetId, "targetId");
    const points = parsePoints((input && input.points) || []);

    const actor = String((input && input.actor) || "").slice(0, 100) || null;
    await repo.saveConnectionWaypoints(type, src, tgt, points, actor);

    return {
        connectionType: type,
        sourceId: src,
        targetId: tgt,
        points,
        count: points.length,
        meters: routeLengthMeters(points)
    };
}

async function deleteRoute(connectionType, sourceId, targetId, deps = {}) {
    const repo = deps.repo || defaultRepo();
    const type = normalizeType(connectionType);
    const src = normalizeId(sourceId, "sourceId");
    const tgt = normalizeId(targetId, "targetId");

    await repo.deleteConnectionWaypoints(type, src, tgt);
    return { connectionType: type, sourceId: src, targetId: tgt };
}

/**
 * SEMUA jalur sekaligus. Klien peta dulu memanggil endpoint per-koneksi di dalam loop — 100 ODP =
 * 100 permintaan berurutan tiap kali peta dibuka. Satu permintaan borongan menggantikan semuanya.
 */
async function getAllRoutes(deps = {}) {
    const repo = deps.repo || defaultRepo();
    const rows = await repo.getAllConnectionWaypoints();

    const out = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!row) return;
        let points;
        try { points = parsePoints(row.waypoints); } catch (_e) { return; } // baris rusak dilewati, bukan meledak
        out.push({
            key: routeKey(row.connection_type, row.source_id, row.target_id),
            connectionType: row.connection_type,
            sourceId: row.source_id,
            targetId: row.target_id,
            points,
            count: points.length,
            meters: routeLengthMeters(points),
            updatedAt: row.updated_at || null,
            updatedBy: row.updated_by || null
        });
    });
    return out;
}

module.exports = {
    CONNECTION_TYPES,
    MIN_POINTS,
    MAX_POINTS,
    isConnectionType,
    parsePoint,
    parsePoints,
    routeLengthMeters,
    routeKey,
    getRoute,
    saveRoute,
    deleteRoute,
    getAllRoutes
};
