/**
 * Header Doc
 * Purpose: Registrar route admin untuk aset jaringan (ODC/ODP) dan route peta.
 *          Controller TIPIS: seluruh aturan (ID, normalisasi tipe, kapasitas, hitung-ulang port) dimiliki
 *          `lib/network-assets-service` — SATU jalur pembuatan yang sama dipakai wizard WA `#ODC`/`#ODP`,
 *          supaya web dan WA tak pernah diam-diam berbeda aturan.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, `ensureAuthenticatedStaff` + `ensureAdmin` (api-route-helpers), repository runtime,
 *       persistence assets (lock/save), `lib/network-assets-service`, `lib/routing-service`.
 * MainFuncs: `registerAdminNetworkAssetsRoutes`.
 * SideEffects: Menulis `database/network_assets.json` (di bawah file-lock) + state runtime.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");
const { ensureAdmin } = require("./api-route-helpers");
const assetService = require("../lib/network-assets-service");

function registerAdminNetworkAssetsRoutes(router, deps) {
    const {
        ensureAuthenticatedStaff,
        rateLimit,
        runtime,
        updateNetworkAssetsWithLock
    } = deps;

    // BACA: seluruh staf (teknisi butuh peta). TULIS: admin saja — teknisi memetakan lewat wizard WA
    // `#ODC`/`#ODP` (kanal yang memang mereka pakai di lapangan), bukan lewat HTTP.
    // Dulu cek admin ini disalin INLINE 3× di dalam handler (rawan drift); kini satu middleware.
    const getUsers = () => (typeof deps.getUsers === "function"
        ? deps.getUsers()
        : (Array.isArray(global.users) ? global.users : []));

    const publishLatest = () => {
        const latest = (runtime.state && typeof runtime.state.get === "function")
            ? runtime.state.get("networkAssets")
            : (Array.isArray(global.networkAssets) ? global.networkAssets : []);
        runtime.repositories.networkAssets.setAll(latest);
        return latest;
    };

    router.get("/api/map/network-assets", ensureAuthenticatedStaff, (_req, res) => {
        try {
            res.status(200).json({
                status: 200,
                message: "Network assets loaded successfully.",
                data: runtime.repositories.networkAssets.getAll()
            });
        } catch (error) {
            console.error("[API_NETWORK_ASSETS_ERROR]", error);
            res.status(500).json({ status: 500, message: `Failed to load network assets: ${error.message}` });
        }
    });

    /**
     * "Rapikan ODP" — pelanggan yang BELUM punya ODP tapi PUNYA GPS, beserta usulan ODP terdekat
     * (yang masih bersisa port). BACA-SAJA: jarak garis lurus adalah TEBAKAN — kabel drop bisa saja
     * ditarik ke ODP lain — jadi endpoint ini hanya MENGUSULKAN. Penetapannya lewat
     * `POST /api/users/:id` yang sudah ada (di sana validasi ODP + hitung-ulang port ikut jalan),
     * supaya tak lahir jalur tulis kedua yang diam-diam beda aturan.
     */
    router.get("/api/map/odp-tidy", ensureAuthenticatedStaff, ensureAdmin, (req, res) => {
        try {
            const assets = runtime.repositories.networkAssets.getAll() || [];
            const users = getUsers();
            const qMax = parseInt(req.query.maxMeters, 10);
            const maxMeters = Number.isFinite(qMax) && qMax > 0 ? qMax : assetService.getAssetConfig().odpSuggestMaxMeters;

            const rows = [];
            const tanpaGpsRows = [];
            let sudahTerpetakan = 0;

            for (const u of users) {
                if (!u) continue;
                if (String(u.connected_odp_id || "").trim()) { sudahTerpetakan++; continue; }

                // JANGAN pakai Number() polos: `Number(null) === 0` → pelanggan TANPA GPS akan terbaca
                // "punya GPS di titik (0,0)" dan halaman melaporkan "0 tanpa GPS" padahal puluhan
                // belum dipetakan. parseCoord memperlakukan null/""/0 sebagai BELUM DISET.
                const lat = assetService.parseCoord(u.latitude);
                const lng = assetService.parseCoord(u.longitude);
                if (lat === null || lng === null) {
                    // Tanpa titik, jarak TAK BISA mengusulkan apa pun — tapi orangnya tetap harus bisa
                    // ditata: admin memilih ODP manual di sini, atau teknisi menyambungkan lewat NAMA
                    // di WA (#ISI). Jangan sembunyikan mereka hanya karena tak punya koordinat.
                    tanpaGpsRows.push({
                        id: u.id,
                        name: u.name || `#${u.id}`,
                        phone: u.phone_number || "",
                        address: u.address || ""
                    });
                    continue;
                }

                const usul = assetService.suggestOdpForPoint(lat, lng, { assets, users, limit: 3, maxMeters });
                rows.push({
                    id: u.id,
                    name: u.name || `#${u.id}`,
                    address: u.address || "",
                    latitude: lat,
                    longitude: lng,
                    suggestions: usul.map((s) => ({
                        id: s.asset.id,
                        name: s.asset.name,
                        meters: s.meters,
                        sisa: s.status ? s.status.sisa : null
                    }))
                });
            }

            // Yang paling dekat duluan: itu yang paling aman dikonfirmasi borongan.
            rows.sort((a, b) => {
                const am = a.suggestions.length ? a.suggestions[0].meters : Infinity;
                const bm = b.suggestions.length ? b.suggestions[0].meters : Infinity;
                return am - bm;
            });

            // Daftar SEMUA ODP + huniannya — dipakai dropdown manual (pelanggan tanpa GPS).
            const odps = assets
                .filter((a) => a && a.type === "ODP")
                .map((a) => {
                    const st = assetService.getOdpStatus(a.id, { assets, users });
                    return { id: a.id, name: a.name, used: st.used, capacity: st.capacity, full: st.full };
                })
                .sort((a, b) => String(a.name).localeCompare(String(b.name)));

            res.status(200).json({
                status: 200,
                message: "Usulan ODP siap.",
                data: {
                    rows,
                    maxMeters,
                    tanpaGpsRows, // jujur: tanpa titik, jarak tak bisa mengusulkan — pilih ODP manual
                    tanpaGps: tanpaGpsRows.length,
                    sudahTerpetakan,
                    odps,
                    totalOdp: odps.length
                }
            });
        } catch (error) {
            console.error("[API_ODP_TIDY_ERROR]", error);
            res.status(500).json({ status: 500, message: `Gagal menyusun usulan ODP: ${error.message}` });
        }
    });

    router.post("/api/map/route", ensureAuthenticatedStaff, rateLimit("map-route", 30, 60000), asyncHandler(async (req, res) => {
        try {
            const { startLat, startLng, endLat, endLng, profile } = req.body;
            if (startLat === undefined || startLng === undefined || endLat === undefined || endLng === undefined) {
                return res.status(400).json({ status: 400, message: "Koordinat awal dan akhir harus diisi (startLat, startLng, endLat, endLng)" });
            }

            const parsedStartLat = parseFloat(startLat);
            const parsedStartLng = parseFloat(startLng);
            const parsedEndLat = parseFloat(endLat);
            const parsedEndLng = parseFloat(endLng);
            if (isNaN(parsedStartLat) || isNaN(parsedStartLng) || isNaN(parsedEndLat) || isNaN(parsedEndLng)) {
                return res.status(400).json({ status: 400, message: "Koordinat harus berupa angka yang valid" });
            }
            if (parsedStartLat < -90 || parsedStartLat > 90 || parsedStartLng < -180 || parsedStartLng > 180
                || parsedEndLat < -90 || parsedEndLat > 90 || parsedEndLng < -180 || parsedEndLng > 180) {
                return res.status(400).json({ status: 400, message: "Koordinat di luar range yang valid (lat: -90 to 90, lng: -180 to 180)" });
            }

            const routingProfile = profile || runtime.config?.openRouteService?.defaultProfile || "driving-car";
            const allowedProfiles = ["driving-car", "driving-hgv", "foot-walking", "foot-hiking", "cycling-regular", "cycling-road", "cycling-mountain", "cycling-electric"];
            if (!allowedProfiles.includes(routingProfile)) {
                return res.status(400).json({ status: 400, message: `Profile routing tidak valid. Profile yang diizinkan: ${allowedProfiles.join(", ")}` });
            }

            const routingService = require("../lib/routing-service");
            const coordinates = await routingService.getRoute(parsedStartLat, parsedStartLng, parsedEndLat, parsedEndLng, routingProfile);
            if (!Array.isArray(coordinates) || coordinates.length < 2) {
                return res.status(500).json({ status: 500, message: "Gagal mendapatkan route. Format koordinat tidak valid." });
            }

            res.status(200).json({
                status: 200,
                message: "Route berhasil didapatkan",
                data: {
                    coordinates,
                    profile: routingProfile,
                    pointCount: coordinates.length,
                    enabled: routingService.isEnabled()
                }
            });
        } catch (error) {
            console.error("[API_MAP_ROUTE_ERROR]", error);
            res.status(500).json({ status: 500, message: error.message || "Gagal mendapatkan route" });
        }
    }));

    router.post("/api/map/network-assets", ensureAuthenticatedStaff, ensureAdmin, asyncHandler(async (req, res) => {
        try {
            const asset = await assetService.createAsset({
                ...req.body,
                created_by: (req.user && (req.user.name || req.user.username)) || "",
                source: "web"
            }, { updateWithLock: updateNetworkAssetsWithLock, getUsers });

            publishLatest();
            res.status(201).json({ status: 201, message: "Aset jaringan berhasil ditambahkan.", data: asset });
        } catch (error) {
            console.error("[API_NETWORK_ASSETS_POST_ERROR]", error);
            res.status(400).json({ status: 400, message: error.message || "Gagal menambahkan aset jaringan." });
        }
    }));

    router.put("/api/map/network-assets/:id", ensureAuthenticatedStaff, ensureAdmin, asyncHandler(async (req, res) => {
        const { id } = req.params;
        const { type, name, address, capacity_ports: capacityPorts, latitude, longitude, notes, parent_odc_id: parentOdcId } = req.body;

        const nextType = String(type || "").trim().toUpperCase();
        if (nextType !== "ODC" && nextType !== "ODP") {
            return res.status(400).json({ status: 400, message: 'Tipe aset harus "ODC" atau "ODP".' });
        }
        if (!name || latitude === undefined || longitude === undefined || latitude === "" || longitude === "") {
            return res.status(400).json({ status: 400, message: "Nama, Latitude, dan Longitude wajib diisi." });
        }

        try {
            // Di bawah LOCK (dulu PUT menulis langsung via saveNetworkAssets → race lost-update dgn POST/DELETE).
            const updated = await updateNetworkAssetsWithLock(async (assets) => {
                const index = assets.findIndex((asset) => String(asset.id) === String(id));
                if (index === -1) throw new Error("Aset jaringan tidak ditemukan.");
                const oldAsset = assets[index];

                const nextParentOdcId = nextType === "ODP" ? (String(parentOdcId || "").trim() || null) : null;
                if (nextParentOdcId) {
                    const parent = assets.find((a) => String(a.id) === String(nextParentOdcId) && a.type === "ODC");
                    if (!parent) throw new Error(`Induk ODC "${nextParentOdcId}" tidak ditemukan.`);

                    const movingToNewParent = String(oldAsset.parent_odc_id || "") !== String(nextParentOdcId);
                    if (movingToNewParent) {
                        // Kapasitas ODC = berapa ODP boleh digantung. Dihitung dari DATA (jumlah ODP anak),
                        // bukan dari ports_used tersimpan yang bisa basi.
                        const cap = parseInt(parent.capacity_ports, 10) || 0;
                        const childCount = assets.filter((a) => a.type === "ODP" && String(a.parent_odc_id || "") === String(parent.id)).length;
                        if (cap > 0 && childCount >= cap) {
                            throw new Error(`ODC ${parent.name} sudah penuh (${childCount}/${cap} ODP). Pilih ODC lain.`);
                        }
                    }
                }

                // Pindah tipe ODP→ODC padahal masih ada pelanggan menempel = memutus rujukan diam-diam.
                if (oldAsset.type === "ODP" && nextType !== "ODP") {
                    const attached = getUsers().filter((u) => String((u && u.connected_odp_id) || "") === String(oldAsset.id)).length;
                    if (attached > 0) {
                        throw new Error(`ODP ${oldAsset.name} masih dipakai ${attached} pelanggan. Pindahkan pelanggannya dulu sebelum mengubah tipe.`);
                    }
                }

                assets[index] = {
                    ...oldAsset,
                    type: nextType,
                    name: String(name).trim(),
                    address: address || "",
                    capacity_ports: parseInt(capacityPorts, 10) || 0,
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude),
                    notes: notes || "",
                    parent_odc_id: nextParentOdcId,
                    updated_by: (req.user && (req.user.name || req.user.username)) || "",
                    updatedAt: new Date().toISOString()
                };

                assetService.recomputePortUsage(assets, getUsers());
                return assets[index];
            });

            publishLatest();
            res.status(200).json({ status: 200, message: "Aset jaringan berhasil diperbarui.", data: updated });
        } catch (error) {
            console.error("[API_NETWORK_ASSETS_PUT_ERROR]", error);
            res.status(400).json({ status: 400, message: error.message || "Gagal memperbarui aset jaringan." });
        }
    }));

    router.delete("/api/map/network-assets/:id", ensureAuthenticatedStaff, ensureAdmin, asyncHandler(async (req, res) => {
        const { id } = req.params;
        try {
            await updateNetworkAssetsWithLock(async (assets) => {
                const index = assets.findIndex((asset) => String(asset.id) === String(id));
                if (index === -1) throw new Error("Aset jaringan tidak ditemukan.");
                const asset = assets[index];

                if (asset.type === "ODC") {
                    const children = assets.filter((a) => a.type === "ODP" && String(a.parent_odc_id || "") === String(id));
                    if (children.length > 0) {
                        throw new Error(`ODC ${asset.name} tidak dapat dihapus karena masih memiliki ${children.length} ODP. Hapus atau pindahkan ODP-nya dulu.`);
                    }
                }

                // ODP yang masih menampung pelanggan TIDAK boleh dihapus: `connected_odp_id` mereka akan
                // menunjuk aset hantu (tak ada FK yang menahan) → data sampah yang tak terlihat.
                if (asset.type === "ODP") {
                    const attached = getUsers().filter((u) => String((u && u.connected_odp_id) || "") === String(id));
                    if (attached.length > 0) {
                        const contoh = attached.slice(0, 3).map((u) => u.name || u.id).join(", ");
                        throw new Error(`ODP ${asset.name} masih dipakai ${attached.length} pelanggan (${contoh}${attached.length > 3 ? ", …" : ""}). Pindahkan pelanggannya dulu.`);
                    }
                }

                assets.splice(index, 1);
                assetService.recomputePortUsage(assets, getUsers());
                return true;
            });

            publishLatest();
            res.status(200).json({ status: 200, message: "Aset jaringan berhasil dihapus." });
        } catch (error) {
            console.error("[API_NETWORK_ASSETS_DELETE_ERROR]", error);
            res.status(400).json({ status: 400, message: error.message || "Gagal menghapus aset jaringan." });
        }
    }));
}

module.exports = {
    registerAdminNetworkAssetsRoutes
};
