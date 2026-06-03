/**
 * Header Doc
 * Purpose: Registrar route admin untuk network assets dan route map.
 * Caller: `routes/admin-router.js`.
 * Deps: Router Express, middleware auth staf, helper asset ID, repository runtime, dan persistence assets.
 * MainFuncs: `registerAdminNetworkAssetsRoutes`.
 * SideEffects: Menulis data network assets ke store runtime dan persistence existing.
 */
"use strict";

const { asyncHandler } = require("../lib/error-handler");

function registerAdminNetworkAssetsRoutes(router, deps) {
    const {
        ensureAuthenticatedStaff,
        rateLimit,
        runtime,
        generateAssetId,
        updateNetworkAssetsWithLock,
        saveNetworkAssets
    } = deps;

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

    router.post("/api/map/network-assets", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
            return res.status(403).json({ message: "Akses ditolak." });
        }
        const { type, name, address, capacity_ports: capacityPorts, latitude, longitude, notes, parent_odc_id: parentOdcId } = req.body;
        if (!type || !name || !latitude || !longitude) {
            return res.status(400).json({ message: "Tipe, Nama, Latitude, dan Longitude wajib diisi." });
        }

        try {
            const result = await updateNetworkAssetsWithLock(async (assets) => {
                const newAssetId = generateAssetId(type, parentOdcId, assets, name);
                const newAsset = {
                    id: newAssetId,
                    type,
                    name,
                    address: address || "",
                    capacity_ports: parseInt(capacityPorts) || 0,
                    latitude: parseFloat(latitude),
                    longitude: parseFloat(longitude),
                    notes: notes || "",
                    parent_odc_id: parentOdcId || null,
                    ports_used: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                if (newAsset.type === "ODP" && newAsset.parent_odc_id) {
                    const parentOdc = assets.find((asset) => String(asset.id) === String(newAsset.parent_odc_id) && asset.type === "ODC");
                    if (!parentOdc) throw new Error(`Parent ODC dengan ID ${newAsset.parent_odc_id} tidak ditemukan.`);
                    const currentUsage = parseInt(parentOdc.ports_used) || 0;
                    const capacity = parseInt(parentOdc.capacity_ports) || 0;
                    if (capacity > 0 && currentUsage >= capacity) {
                        throw new Error(`ODC ${parentOdc.name} sudah penuh (${currentUsage}/${capacity}). Tidak dapat menambahkan ODP baru.`);
                    }
                    parentOdc.ports_used = currentUsage + 1;
                }
                assets.push(newAsset);
                return newAsset;
            });
            runtime.repositories.networkAssets.setAll(runtime.state.get("networkAssets"));
            res.status(201).json({ status: 201, message: "Aset jaringan berhasil ditambahkan.", data: result });
        } catch (error) {
            console.error("[API_NETWORK_ASSETS_POST_ERROR]", error);
            res.status(500).json({ status: 500, message: `Gagal menambahkan aset jaringan: ${error.message}` });
        }
    }));

    router.put("/api/map/network-assets/:id", ensureAuthenticatedStaff, (req, res) => {
        if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
            return res.status(403).json({ message: "Akses ditolak." });
        }
        const { id } = req.params;
        const { type, name, address, capacity_ports: capacityPorts, latitude, longitude, notes, parent_odc_id: parentOdcId } = req.body;
        if (!type || !name || !latitude || !longitude) {
            return res.status(400).json({ message: "Tipe, Nama, Latitude, dan Longitude wajib diisi." });
        }

        try {
            const existingAssets = [...runtime.repositories.networkAssets.getAll()];
            const assetIndex = existingAssets.findIndex((asset) => String(asset.id) === String(id));
            if (assetIndex === -1) return res.status(404).json({ status: 404, message: "Aset jaringan tidak ditemukan." });
            const oldAsset = { ...existingAssets[assetIndex] };
            const updatedAsset = {
                ...oldAsset,
                type,
                name,
                address: address || "",
                capacity_ports: parseInt(capacityPorts) || 0,
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
                notes: notes || "",
                parent_odc_id: parentOdcId || null,
                updatedAt: new Date().toISOString()
            };
            if (oldAsset.type === "ODP" && oldAsset.parent_odc_id && (updatedAsset.type !== "ODP" || updatedAsset.parent_odc_id !== oldAsset.parent_odc_id)) {
                const oldParentOdc = existingAssets.find((asset) => String(asset.id) === String(oldAsset.parent_odc_id) && asset.type === "ODC");
                if (oldParentOdc) oldParentOdc.ports_used = Math.max(0, (parseInt(oldParentOdc.ports_used) || 0) - 1);
            }
            if (updatedAsset.type === "ODP" && updatedAsset.parent_odc_id && (oldAsset.type !== "ODP" || updatedAsset.parent_odc_id !== oldAsset.parent_odc_id)) {
                const newParentOdc = existingAssets.find((asset) => String(asset.id) === String(updatedAsset.parent_odc_id) && asset.type === "ODC");
                if (!newParentOdc) return res.status(400).json({ status: 400, message: `Parent ODC dengan ID ${updatedAsset.parent_odc_id} tidak ditemukan.` });
                const currentUsage = parseInt(newParentOdc.ports_used) || 0;
                const capacity = parseInt(newParentOdc.capacity_ports) || 0;
                if (capacity > 0 && currentUsage >= capacity) {
                    return res.status(400).json({ status: 400, message: `ODC ${newParentOdc.name} sudah penuh (${currentUsage}/${capacity}). Tidak dapat memindahkan ODP ke ODC ini.` });
                }
                newParentOdc.ports_used = currentUsage + 1;
            }
            existingAssets[assetIndex] = updatedAsset;
            runtime.repositories.networkAssets.setAll(existingAssets);
            saveNetworkAssets(existingAssets);
            res.status(200).json({ status: 200, message: "Aset jaringan berhasil diperbarui.", data: updatedAsset });
        } catch (error) {
            console.error("[API_NETWORK_ASSETS_PUT_ERROR]", error);
            res.status(500).json({ status: 500, message: `Gagal memperbarui aset jaringan: ${error.message}` });
        }
    });

    router.delete("/api/map/network-assets/:id", ensureAuthenticatedStaff, asyncHandler(async (req, res) => {
        if (!req.user || !["admin", "owner", "superadmin"].includes(req.user.role)) {
            return res.status(403).json({ message: "Akses ditolak." });
        }
        const { id } = req.params;
        try {
            await updateNetworkAssetsWithLock(async (assets) => {
                const assetToDeleteIndex = assets.findIndex((asset) => String(asset.id) === String(id));
                if (assetToDeleteIndex === -1) throw new Error("Aset jaringan tidak ditemukan.");
                const assetToDelete = assets[assetToDeleteIndex];
                if (assetToDelete.type === "ODC") {
                    const childOdps = assets.filter((asset) => asset.type === "ODP" && String(asset.parent_odc_id) === String(id));
                    if (childOdps.length > 0) {
                        throw new Error(`ODC ${assetToDelete.name} tidak dapat dihapus karena memiliki ${childOdps.length} ODP yang terhubung. Hapus atau pindahkan ODP terlebih dahulu.`);
                    }
                }
                if (assetToDelete.type === "ODP" && assetToDelete.parent_odc_id) {
                    const parentOdc = assets.find((asset) => String(asset.id) === String(assetToDelete.parent_odc_id) && asset.type === "ODC");
                    if (parentOdc) parentOdc.ports_used = Math.max(0, (parseInt(parentOdc.ports_used) || 0) - 1);
                }
                assets.splice(assetToDeleteIndex, 1);
                return true;
            });
            runtime.repositories.networkAssets.setAll(runtime.state.get("networkAssets"));
            res.status(200).json({ status: 200, message: "Aset jaringan berhasil dihapus." });
        } catch (error) {
            console.error("[API_NETWORK_ASSETS_DELETE_ERROR]", error);
            res.status(500).json({ status: 500, message: `Gagal menghapus aset jaringan: ${error.message}` });
        }
    }));
}

module.exports = {
    registerAdminNetworkAssetsRoutes
};
