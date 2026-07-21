/**
 * Header Doc
 * Purpose: Inti MURNI penetapan titik rumah pelanggan — urai masukan koordinat (pin WA / tempel link
 *          Google Maps / ketik "lat,lng"), hitung jarak, dan NILAI kelayakan titik sebelum disimpan.
 *          Satu gerbang dipakai bersama tiga jalur (WA teknisi-admin, web admin, pin dari pelanggan)
 *          supaya aturan presisinya persis sama di mana pun titik dimasukkan.
 *          LATAR: 92 pelanggan pernah menumpuk di satu titik karena panel menstempel koordinat DEFAULT
 *          saat izin GPS ditolak. Modul ini menutup pengulangannya: titik default ditolak keras, dan
 *          satu titik yang dipakai ulang untuk pelanggan berbeda dalam waktu dekat diberi peringatan.
 * Caller: `message/handlers/state-domains/customer-location.state.js` (WA), `routes/api-users-routes.js`
 *         (web `POST /api/users/:id/location`), dan jalur pin-dari-pelanggan.
 * Deps: tidak ada (murni; data pelanggan/aset di-inject).
 * MainFuncs: `parseCoordinateInput`, `haversineMeters`, `evaluateLocationCandidate`, `buildMapsUrl`,
 *            `formatDistance`, `LOCATION_SOURCES`.
 * SideEffects: Tidak ada.
 */
"use strict";

// Sumber koordinat — dicatat ke kolom `users.location_source` supaya nanti bisa dibedakan mana titik
// yang layak dipercaya dan mana yang tidak. Dulu tak ada penanda ini, sehingga 92 titik palsu terpaksa
// dihapus buta karena tak bisa dipisahkan dari yang asli.
const LOCATION_SOURCES = Object.freeze({
    PSB_WIZARD: "psb_wizard",
    TEKNISI_WA: "teknisi_wa",
    PELANGGAN_WA: "pelanggan_wa",
    ADMIN_WEB: "admin_web",
    IMPORT: "import"
});

// Titik yang HARAM jadi lokasi rumah siapa pun: koordinat default lama panel admin/teknisi
// (basecamp). Setiap titik dalam radius kecil dari sini ditolak, bukan sekadar diperingatkan.
const BLOCKED_POINTS = Object.freeze([
    { lat: -7.24139, lng: 111.83833, label: "titik default lama panel (basecamp), bukan rumah pelanggan", radiusM: 60 }
]);

const DEFAULTS = Object.freeze({
    duplicateWindowMs: 30 * 60 * 1000, // 30 menit
    duplicateRadiusM: 30,
    farThresholdM: 3000
});

function toNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const n = parseFloat(value.trim());
    return Number.isFinite(n) ? n : null;
}

function isValidPoint(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    // (0,0) = "Null Island" — hampir selalu tanda koordinat gagal terbaca, bukan lokasi sungguhan.
    if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
    return true;
}

/**
 * Urai koordinat dari teks bebas: "lat, lng", link Google Maps, atau `geo:`.
 * @returns {{lat:number,lng:number}|{error:string}|null}
 */
function parseCoordinateInput(input) {
    const raw = String(input === null || input === undefined ? "" : input).trim();
    if (!raw) return null;

    // Link pendek tak bisa diurai tanpa menembak jaringan — beri tahu, jangan gagal diam-diam.
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(raw)) {
        return { error: "Link pendek Google Maps belum bisa dibaca. Buka dulu linknya di HP, lalu salin koordinat atau link panjangnya." };
    }

    const patterns = [
        /[?&]q=(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i,   // ?q=lat,lng
        /[?&]ll=(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/i,  // ?ll=lat,lng
        /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,               // /@lat,lng,17z
        /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,          // geo:lat,lng
        // "lat, lng" polos. Lintang sengaja diizinkan sampai 3 digit supaya angka ngawur seperti
        // "999.9, 111.8" TETAP terurai lalu ditolak dengan pesan jelas — bukan gagal senyap
        // sebagai "tidak terbaca", yang menyesatkan karena maksud pengirimnya sudah jelas koordinat.
        /^(-?\d{1,3}(?:\.\d+)?)\s*[,;|\s]\s*(-?\d{1,3}(?:\.\d+)?)$/
    ];

    for (const re of patterns) {
        const m = raw.match(re);
        if (!m) continue;
        const lat = toNumber(m[1]);
        const lng = toNumber(m[2]);
        if (lat === null || lng === null) continue;
        if (!isValidPoint(lat, lng)) {
            return { error: `Koordinat ${m[1]},${m[2]} tidak masuk akal.` };
        }
        return { lat, lng };
    }
    return null;
}

function haversineMeters(aLat, aLng, bLat, bLng) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (bLat - aLat) * rad;
    const dLng = (bLng - aLng) * rad;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function buildMapsUrl(lat, lng) {
    return `https://maps.google.com/?q=${lat},${lng}`;
}

function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "-";
    return meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
}

function pointOf(row) {
    const lat = toNumber(row && row.latitude);
    const lng = toNumber(row && row.longitude);
    return isValidPoint(lat, lng) ? { lat, lng } : null;
}

/**
 * Nilai satu calon titik untuk seorang pelanggan.
 * TIDAK menyimpan apa pun — hanya menghasilkan putusan + bahan layar konfirmasi.
 */
function evaluateLocationCandidate(options = {}) {
    const {
        point,
        customer = null,
        users = [],
        assets = [],
        nowMs = Date.now(),
        duplicateWindowMs = DEFAULTS.duplicateWindowMs,
        duplicateRadiusM = DEFAULTS.duplicateRadiusM,
        farThresholdM = DEFAULTS.farThresholdM
    } = options;

    const lat = toNumber(point && point.lat);
    const lng = toNumber(point && point.lng);
    if (!isValidPoint(lat, lng)) {
        return { ok: false, blocked: true, blockReason: "Koordinat tidak valid.", warnings: [], previous: null, mapsUrl: null };
    }

    // 1) Titik terlarang — tolak keras, tak bisa dipaksa.
    for (const b of BLOCKED_POINTS) {
        if (haversineMeters(lat, lng, b.lat, b.lng) <= (b.radiusM || 50)) {
            return {
                ok: false,
                blocked: true,
                blockReason: `Titik ini adalah ${b.label}. Ambil titik dari rumah pelanggan, atau teruskan pin lokasi dari pelanggannya.`,
                warnings: [],
                previous: null,
                mapsUrl: buildMapsUrl(lat, lng)
            };
        }
    }

    const list = Array.isArray(users) ? users : [];
    const customerId = customer && customer.id !== undefined ? String(customer.id) : null;
    const warnings = [];

    // 2) TITIK LAMA pelanggan ini — SELALU ditampilkan sebelum menimpa (permintaan eksplisit:
    //    "setiap mau memasukkan, entah via web atau WA, ada sharelok lamanya").
    const prevPoint = pointOf(customer);
    const previous = prevPoint
        ? {
            lat: prevPoint.lat,
            lng: prevPoint.lng,
            source: (customer && customer.location_source) || null,
            updatedAt: (customer && customer.location_updated_at) || null,
            distanceM: haversineMeters(prevPoint.lat, prevPoint.lng, lat, lng),
            mapsUrl: buildMapsUrl(prevPoint.lat, prevPoint.lng)
        }
        : null;

    // 3) Satu titik dipakai ulang untuk pelanggan BERBEDA dalam waktu dekat = pola "stempel dari
    //    tempat saya duduk" — persis penyakit yang bikin 92 pelanggan menumpuk. Dideteksi dari DB
    //    (location_updated_at), jadi tahan restart dan berlaku lintas petugas.
    const stamped = list.filter((u) => {
        if (!u || (customerId !== null && String(u.id) === customerId)) return false;
        const p = pointOf(u);
        if (!p) return false;
        if (haversineMeters(p.lat, p.lng, lat, lng) > duplicateRadiusM) return false;
        const t = Date.parse(u.location_updated_at || "");
        return Number.isFinite(t) && (nowMs - t) <= duplicateWindowMs;
    });
    if (stamped.length) {
        warnings.push({
            code: "titik_berulang",
            message: `Titik ini SAMA dengan yang baru saja disimpan untuk ${stamped.map((u) => u.name).join(", ")}. `
                + `Kalau kamu tidak sedang berada di rumah mereka, kemungkinan ini lokasimu sendiri — bukan rumah pelanggan.`
        });
    }

    // 4) Tetangga & aset terdekat — bahan penilaian manusia, sekaligus deteksi titik nyasar.
    let nearestCustomer = null;
    list.forEach((u) => {
        if (!u || (customerId !== null && String(u.id) === customerId)) return;
        const p = pointOf(u);
        if (!p) return;
        const m = haversineMeters(lat, lng, p.lat, p.lng);
        if (!nearestCustomer || m < nearestCustomer.meters) nearestCustomer = { name: u.name, meters: m };
    });

    let nearestAsset = null;
    (Array.isArray(assets) ? assets : []).forEach((a) => {
        const aLat = toNumber(a && (a.latitude !== undefined ? a.latitude : a.lat));
        const aLng = toNumber(a && (a.longitude !== undefined ? a.longitude : a.lng));
        if (!isValidPoint(aLat, aLng)) return;
        const m = haversineMeters(lat, lng, aLat, aLng);
        if (!nearestAsset || m < nearestAsset.meters) nearestAsset = { name: a.name || a.id, type: a.type || "aset", meters: m };
    });

    const nearestAnchor = [nearestCustomer, nearestAsset]
        .filter(Boolean)
        .reduce((best, cur) => (!best || cur.meters < best.meters ? cur : best), null);
    if (nearestAnchor && nearestAnchor.meters > farThresholdM) {
        warnings.push({
            code: "jauh_dari_area",
            message: `Titik ini ${formatDistance(nearestAnchor.meters)} dari titik dikenal terdekat (${nearestAnchor.name}). Pastikan tidak salah pin.`
        });
    }

    return {
        ok: true,
        blocked: false,
        blockReason: null,
        point: { lat, lng },
        warnings,
        previous,
        nearestCustomer,
        nearestAsset,
        mapsUrl: buildMapsUrl(lat, lng)
    };
}

module.exports = {
    LOCATION_SOURCES,
    BLOCKED_POINTS,
    DEFAULTS,
    parseCoordinateInput,
    haversineMeters,
    buildMapsUrl,
    formatDistance,
    evaluateLocationCandidate
};
