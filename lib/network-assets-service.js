/**
 * Header Doc
 * Purpose: PEMILIK TUNGGAL logika aset jaringan (ODC/ODP) — pembuatan aset, hitung pemakaian port,
 *          validasi penyambungan pelanggan→ODP, dan pencarian aset TERDEKAT dari titik GPS.
 *
 *          KEBENARAN PORT DITURUNKAN DARI DATA, TIDAK PERNAH DI-INCREMENT:
 *            - `ODP.ports_used` = jumlah PELANGGAN dgn `connected_odp_id` = ODP itu.
 *            - `ODC.ports_used` = jumlah ODP ANAK (port ODC dipakai feeder ke ODP, BUKAN oleh pelanggan).
 *          Dulu makna `ports_used` ODC berbeda di 3 tempat (boot=jumlah ODP, POST=+1, port-usage-updater=
 *          SUM pelanggan anak) → angka berubah makna sampai restart. Hitung-ulang membunuh seluruh kelas
 *          bug drift itu: tak ada penghitung yang bisa "meleset", karena tak ada penghitung.
 *
 *          `capacity_ports = 0` berarti TAK DIBATASI (konvensi lama, dipertahankan).
 * Caller: `routes/admin-network-assets-routes.js`, `routes/admin-shared.js` (re-export generateAssetId),
 *         `lib/database.js` (hitung-ulang saat boot), `services/api-users/*` (validasi ODP),
 *         wizard WA `#ODC`/`#ODP`, halaman "Rapikan ODP".
 * Deps: `lib/network-assets-persistence` (lock/save). Data di-inject; default membaca
 *       `global.networkAssets` + `global.users`.
 * MainFuncs: `recomputePortUsage`, `syncPortUsage`, `createAsset`, `assertOdpAssignable`,
 *            `getOdpStatus`, `findNearest`, `haversineMeters`, `generateAssetId`, `mapsUrl`.
 * SideEffects: `syncPortUsage`/`createAsset` menulis `database/network_assets.json` (+ `global.networkAssets`).
 */
"use strict";

const EARTH_RADIUS_M = 6371000;

// Radius usulan (bisa ditimpa config.networkAssets). Angka default dari kenyataan FTTH:
// drop cable ODP→rumah jarang >250 m; feeder ODC→ODP bisa 1–2 km.
const DEFAULT_ODP_SUGGEST_M = 250;
const DEFAULT_ODC_SUGGEST_M = 2000;
const DEFAULT_ODP_CAPACITY = 8;

function cfg() {
    const c = (typeof global !== "undefined" && global.config && global.config.networkAssets) || {};
    return {
        odpSuggestMaxMeters: Number(c.odpSuggestMaxMeters) || DEFAULT_ODP_SUGGEST_M,
        odcSuggestMaxMeters: Number(c.odcSuggestMaxMeters) || DEFAULT_ODC_SUGGEST_M,
        defaultOdpCapacity: Number(c.defaultOdpCapacity) || DEFAULT_ODP_CAPACITY
    };
}

function toNum(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * Koordinat yang BENAR-BENAR terisi. `null`/`""`/`0` = BELUM DISET.
 * PENTING: `Number(null) === 0` — jadi memakai `Number()` polos membuat pelanggan tanpa GPS terbaca
 * "punya GPS di titik (0, 0)" (Teluk Guinea, ~6.000 km dari sini). Itu bukan sekadar angka jelek: ia
 * membuat halaman melaporkan "0 pelanggan tanpa GPS" padahal puluhan belum dipetakan — persis
 * miss-info yang harus dihindari. Lintang/bujur 0 tak pernah menjadi alamat pelanggan di sini.
 */
function parseCoord(v) {
    const n = toNum(v);
    if (n === null || n === 0) return null;
    return n;
}
function defaultAssets() {
    return (typeof global !== "undefined" && Array.isArray(global.networkAssets)) ? global.networkAssets : [];
}
function defaultUsers() {
    return (typeof global !== "undefined" && Array.isArray(global.users)) ? global.users : [];
}
function hasCoords(a) {
    return Boolean(a) && parseCoord(a.latitude) !== null && parseCoord(a.longitude) !== null;
}
function odpIdOf(u) {
    return String((u && u.connected_odp_id) || "").trim();
}
function mapsUrl(lat, lng) {
    return `https://maps.google.com/?q=${lat},${lng}`;
}

/** Jarak garis lurus (meter) — cukup untuk "ODP mana yang terdekat", bukan panjang kabel. */
function haversineMeters(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Hitung ulang `ports_used` SELURUH aset dari data (memutasi `assets`). Idempoten & murah.
 * ODP = jumlah pelanggan terhubung (TERMASUK akun infra: modem CCTV tetap memakan 1 port fisik).
 * ODC = jumlah ODP anak.
 */
function recomputePortUsage(assets, users) {
    const A = Array.isArray(assets) ? assets : [];
    const U = Array.isArray(users) ? users : [];

    const custPerOdp = new Map();
    for (const u of U) {
        const id = odpIdOf(u);
        if (id) custPerOdp.set(id, (custPerOdp.get(id) || 0) + 1);
    }

    const odpPerOdc = new Map();
    for (const a of A) {
        if (!a || a.type !== "ODP") continue;
        a.ports_used = custPerOdp.get(String(a.id)) || 0;
        const parent = String(a.parent_odc_id || "").trim();
        if (parent) odpPerOdc.set(parent, (odpPerOdc.get(parent) || 0) + 1);
    }
    for (const a of A) {
        if (!a || a.type !== "ODC") continue;
        a.ports_used = odpPerOdc.get(String(a.id)) || 0;
    }
    return A;
}

/** Hitung-ulang + simpan. Panggil sesudah mutasi apa pun yang menyentuh aset atau connected_odp_id. */
function syncPortUsage(deps = {}) {
    const assets = deps.getAssets ? deps.getAssets() : defaultAssets();
    const users = deps.getUsers ? deps.getUsers() : defaultUsers();
    recomputePortUsage(assets, users);
    const save = deps.saveAssets || require("./network-assets-persistence").saveNetworkAssets;
    save(assets);
    return assets;
}

function findAssetById(id, assets) {
    const key = String(id || "").trim();
    if (!key) return null;
    return (assets || defaultAssets()).find((a) => a && String(a.id) === key) || null;
}

/** Status hunian ODP dihitung dari PELANGGAN (kebenaran live), bukan dari `ports_used` yang bisa basi. */
function getOdpStatus(odpId, opts = {}) {
    const assets = opts.assets || defaultAssets();
    const users = opts.users || defaultUsers();
    const odp = findAssetById(odpId, assets);
    if (!odp || odp.type !== "ODP") return { found: false, id: String(odpId || "") };

    const used = users.filter((u) => odpIdOf(u) === String(odp.id)).length;
    const capacity = parseInt(odp.capacity_ports, 10) || 0;
    return {
        found: true,
        id: odp.id,
        name: odp.name,
        used,
        capacity,
        full: capacity > 0 && used >= capacity,
        sisa: capacity > 0 ? Math.max(0, capacity - used) : null // null = tak dibatasi
    };
}

/**
 * Pastikan pelanggan boleh disambungkan ke ODP ini. LEMPAR Error (pesan siap-tampil) bila:
 * ODP tak terdaftar (typo diterima diam-diam = akar data sampah) atau sudah penuh.
 * `odpId` kosong = sah (pelanggan memang belum dipetakan) → return null.
 * `excludeUserId`: saat MENGEDIT pelanggan yang sudah menempel di ODP itu — jangan hitung dirinya
 * sendiri lalu memvonis "penuh".
 */
function assertOdpAssignable(odpId, opts = {}) {
    const key = String(odpId || "").trim();
    if (!key) return null;

    const assets = opts.assets || defaultAssets();
    const allUsers = opts.users || defaultUsers();
    const users = opts.excludeUserId == null
        ? allUsers
        : allUsers.filter((u) => String((u && u.id) ?? "") !== String(opts.excludeUserId));

    const odp = findAssetById(key, assets);
    if (!odp || odp.type !== "ODP") {
        throw new Error(`ODP "${key}" tidak terdaftar. Daftarkan dulu ODP-nya (WhatsApp: #ODP <nama>), atau kosongkan.`);
    }

    const st = getOdpStatus(odp.id, { assets, users });
    if (st.full) {
        throw new Error(`ODP ${odp.name} (${odp.id}) sudah PENUH ${st.used}/${st.capacity}. Pilih ODP lain.`);
    }
    return odp;
}

/**
 * Aset terdekat dari sebuah titik, terurut. Mengembalikan `[{ asset, meters }]`.
 * CATATAN PENTING: jarak garis lurus adalah TEBAKAN, bukan kebenaran — kabel drop bisa saja ditarik
 * ke ODP yang lebih jauh. Hasil fungsi ini WAJIB dikonfirmasi manusia, jangan dipasang diam-diam.
 */
function findNearest(lat, lng, type, opts = {}) {
    const la = parseCoord(lat);
    const ln = parseCoord(lng);
    if (la === null || ln === null) return []; // tanpa titik → tanpa usulan (jangan menebak)

    const assets = opts.assets || defaultAssets();
    const limit = opts.limit === undefined ? 3 : opts.limit;
    const maxMeters = opts.maxMeters === undefined ? null : opts.maxMeters;

    const out = [];
    for (const a of assets) {
        if (!a) continue;
        if (type && a.type !== type) continue;
        if (!hasCoords(a)) continue;
        const meters = Math.round(haversineMeters(la, ln, toNum(a.latitude), toNum(a.longitude)));
        if (maxMeters !== null && meters > maxMeters) continue;
        out.push({ asset: a, meters });
    }
    out.sort((x, y) => x.meters - y.meters);
    return limit > 0 ? out.slice(0, limit) : out;
}

/** ODP terdekat yang MASIH ADA SISA PORT — inilah yang layak diusulkan saat pasang pelanggan baru. */
function suggestOdpForPoint(lat, lng, opts = {}) {
    const assets = opts.assets || defaultAssets();
    const users = opts.users || defaultUsers();
    const maxMeters = opts.maxMeters === undefined ? cfg().odpSuggestMaxMeters : opts.maxMeters;

    const near = findNearest(lat, lng, "ODP", { assets, limit: 0, maxMeters });
    return near
        .map((n) => ({ ...n, status: getOdpStatus(n.asset.id, { assets, users }) }))
        .filter((n) => !n.status.full)
        .slice(0, opts.limit || 3);
}

/** ID aset: `ODC-<BASE>-001` / `ODP-<BASE-INDUK>-001`. Dipindah dari routes/admin-shared.js apa adanya. */
function generateAssetId(type, parentOdcId = null, existingAssets = [], assetName = "") {
    let prefix = "";
    let baseCode = "XXX";
    let sequenceNumber = 1;
    if (type === "ODC") prefix = "ODC";
    else if (type === "ODP") prefix = "ODP";
    else return `ASSET-UNKNOWN-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    if (type === "ODP" && parentOdcId) {
        const parentMatch = parentOdcId.match(/^ODC-([A-Z0-9]+(?:-[0-9]+)?)/i);
        if (parentMatch && parentMatch[1]) baseCode = parentMatch[1].replace(/-/g, "");
        else if (parentOdcId.length >= 3) {
            baseCode = parentOdcId.substring(0, Math.min(parentOdcId.length, 7)).toUpperCase().replace(/[^A-Z0-9]/gi, "");
            if (baseCode.length === 0) baseCode = "PARENT";
        }
    } else if (assetName) {
        const nameParts = assetName.trim().toUpperCase().split(/\s+|_|-/);
        let generatedBase = "";
        if (nameParts.length > 1 && nameParts[0].length > 0 && nameParts[1].length > 0) {
            generatedBase = `${nameParts[0].substring(0, Math.min(nameParts[0].length, 3))}${nameParts[1].substring(0, Math.min(nameParts[1].length, 2))}`;
        } else if (nameParts[0].length >= 3) generatedBase = nameParts[0].substring(0, 3);
        else if (nameParts[0].length > 0) {
            generatedBase = nameParts[0];
            while (generatedBase.length < 3 && generatedBase.length > 0) generatedBase += "X";
        }
        baseCode = generatedBase.substring(0, 7).replace(/[^A-Z0-9]/gi, "");
    }

    if (baseCode.length === 0) baseCode = "GEN";
    const relevantAssets = (type === "ODP" && parentOdcId)
        ? existingAssets.filter((asset) => asset.type === "ODP" && asset.parent_odc_id === parentOdcId)
        : existingAssets.filter((asset) => asset.type === type && asset.id.startsWith(`${prefix}-${baseCode}-`));

    sequenceNumber = relevantAssets.length + 1;
    const formattedSequence = String(sequenceNumber).padStart(3, "0");
    const newPotentialId = `${prefix}-${baseCode}-${formattedSequence}`;
    let uniquenessCounter = 0;
    let finalId = newPotentialId;
    while (existingAssets.some((asset) => asset.id === finalId)) {
        uniquenessCounter++;
        finalId = `${newPotentialId}_${uniquenessCounter}`;
        if (uniquenessCounter > 20) {
            finalId = `${newPotentialId}_${Math.random().toString(36).substring(2, 7)}`;
            if (existingAssets.some((asset) => asset.id === finalId)) finalId = `${newPotentialId}_${Date.now().toString().slice(-5)}`;
            break;
        }
    }
    return finalId;
}

/**
 * Buat aset (SATU jalur pembuatan — dipakai route web MAUPUN wizard WA, supaya tak ada dua
 * implementasi yang diam-diam berbeda). Menulis di bawah file-lock.
 */
async function createAsset(input = {}, deps = {}) {
    const type = String(input.type || "").trim().toUpperCase();
    if (type !== "ODC" && type !== "ODP") throw new Error('Tipe aset harus "ODC" atau "ODP".');

    const name = String(input.name || "").trim();
    if (!name) throw new Error("Nama aset wajib diisi.");

    const lat = parseCoord(input.latitude);
    const lng = parseCoord(input.longitude);
    if (lat === null || lng === null) throw new Error("Titik lokasi (latitude & longitude) wajib diisi.");
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error("Koordinat di luar jangkauan wajar.");

    const withLock = deps.updateWithLock || require("./network-assets-persistence").updateNetworkAssetsWithLock;
    const getUsers = deps.getUsers || defaultUsers;

    return withLock(async (assets) => {
        let parentOdcId = null;
        if (type === "ODP") {
            parentOdcId = String(input.parent_odc_id || "").trim() || null;
            if (parentOdcId) {
                const parent = findAssetById(parentOdcId, assets);
                if (!parent || parent.type !== "ODC") throw new Error(`Induk ODC "${parentOdcId}" tidak ditemukan.`);
                const cap = parseInt(parent.capacity_ports, 10) || 0;
                const used = assets.filter((a) => a && a.type === "ODP" && String(a.parent_odc_id || "") === String(parent.id)).length;
                if (cap > 0 && used >= cap) {
                    throw new Error(`ODC ${parent.name} sudah penuh (${used}/${cap} ODP). Pilih ODC lain.`);
                }
            }
        }

        const asset = {
            id: generateAssetId(type, parentOdcId, assets, name),
            type,
            name,
            address: String(input.address || ""),
            capacity_ports: parseInt(input.capacity_ports, 10) || 0,
            latitude: lat,
            longitude: lng,
            notes: String(input.notes || ""),
            parent_odc_id: parentOdcId,
            ports_used: 0,
            photo_path: String(input.photo_path || ""), // foto box: yang bikin ODP ini ketemu lagi nanti
            created_by: String(input.created_by || ""), // jejak: siapa yang memetakan
            source: String(input.source || "web"), // "wa" | "web"
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        assets.push(asset);
        recomputePortUsage(assets, getUsers());
        return asset;
    });
}

/**
 * Cari aset berdasarkan NAMA (yang diketik teknisi di WA — dia tak pernah hafal ID).
 * Cocok PERSIS dulu; kalau nihil baru cocok-sebagian. Mengembalikan daftar (bisa >1 → biar pemanggil
 * yang meminta teknisi memilih; JANGAN diam-diam ambil yang pertama).
 */
function findAssetsByName(name, type, assets) {
    const q = String(name || "").trim().toLowerCase();
    if (!q) return [];
    const pool = (assets || defaultAssets()).filter((a) => a && (!type || a.type === type));

    const persis = pool.filter((a) => String(a.name || "").trim().toLowerCase() === q);
    if (persis.length) return persis;

    // ID juga diterima (kalau teknisi menyalin dari balasan bot sebelumnya).
    const byId = pool.filter((a) => String(a.id || "").toLowerCase() === q);
    if (byId.length) return byId;

    return pool.filter((a) => String(a.name || "").toLowerCase().includes(q));
}

/** Pelanggan yang menempel di sebuah ODP (kebenaran live dari data pelanggan, bukan angka tersimpan). */
function getOdpCustomers(odpId, opts = {}) {
    const users = opts.users || defaultUsers();
    const key = String(odpId || "").trim();
    if (!key) return [];
    return users.filter((u) => odpIdOf(u) === key);
}

/**
 * Perbarui aset (nama/lokasi/kapasitas/induk). Dipakai wizard WA saat teknisi mengetik `#ODP <nama>`
 * yang SUDAH ADA — itu koreksi (mis. salah share-lokasi), BUKAN alasan membuat duplikat.
 * Hanya field yang dikirim yang diubah. Menulis di bawah file-lock + hitung ulang port.
 */
async function updateAsset(id, patch = {}, deps = {}) {
    const withLock = deps.updateWithLock || require("./network-assets-persistence").updateNetworkAssetsWithLock;
    const getUsers = deps.getUsers || defaultUsers;
    const key = String(id || "").trim();
    if (!key) throw new Error("ID aset wajib diisi.");

    return withLock(async (assets) => {
        const index = assets.findIndex((a) => a && String(a.id) === key);
        if (index === -1) throw new Error(`Aset "${key}" tidak ditemukan.`);
        const lama = assets[index];
        const next = { ...lama };

        if (patch.name !== undefined && String(patch.name).trim()) next.name = String(patch.name).trim();

        if (patch.latitude !== undefined || patch.longitude !== undefined) {
            const lat = parseCoord(patch.latitude);
            const lng = parseCoord(patch.longitude);
            if (lat === null || lng === null) throw new Error("Titik lokasi baru tidak valid.");
            next.latitude = lat;
            next.longitude = lng;
        }

        if (patch.capacity_ports !== undefined) {
            const cap = parseInt(patch.capacity_ports, 10) || 0;
            // Menurunkan kapasitas di bawah jumlah yang SUDAH terpasang = berbohong soal muatan.
            const terpakai = lama.type === "ODP"
                ? getOdpCustomers(lama.id, { users: getUsers() }).length
                : assets.filter((a) => a && a.type === "ODP" && String(a.parent_odc_id || "") === String(lama.id)).length;
            if (cap > 0 && cap < terpakai) {
                throw new Error(`Kapasitas ${cap} lebih kecil dari yang sudah terpasang (${terpakai}). Lepas dulu sebagian.`);
            }
            next.capacity_ports = cap;
        }

        if (patch.parent_odc_id !== undefined && next.type === "ODP") {
            const parentId = String(patch.parent_odc_id || "").trim() || null;
            if (parentId) {
                const parent = assets.find((a) => a && String(a.id) === parentId && a.type === "ODC");
                if (!parent) throw new Error(`Induk ODC "${parentId}" tidak ditemukan.`);
                if (String(lama.parent_odc_id || "") !== parentId) {
                    const cap = parseInt(parent.capacity_ports, 10) || 0;
                    const anak = assets.filter((a) => a && a.type === "ODP" && String(a.parent_odc_id || "") === parentId).length;
                    if (cap > 0 && anak >= cap) {
                        throw new Error(`ODC ${parent.name} sudah penuh (${anak}/${cap} ODP). Pilih ODC lain.`);
                    }
                }
            }
            next.parent_odc_id = parentId;
        }

        if (patch.photo_path) next.photo_path = String(patch.photo_path);
        if (patch.notes !== undefined) next.notes = String(patch.notes || "");
        next.updated_by = String(patch.updated_by || next.updated_by || "");
        next.updatedAt = new Date().toISOString();

        assets[index] = next;
        recomputePortUsage(assets, getUsers());
        return assets[index];
    });
}

module.exports = {
    parseCoord,
    findAssetsByName,
    getOdpCustomers,
    updateAsset,
    haversineMeters,
    recomputePortUsage,
    syncPortUsage,
    findAssetById,
    getOdpStatus,
    assertOdpAssignable,
    findNearest,
    suggestOdpForPoint,
    generateAssetId,
    createAsset,
    mapsUrl,
    getAssetConfig: cfg
};
