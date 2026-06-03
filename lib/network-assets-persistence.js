/**
 * Header Doc
 * Purpose: Mengisolasi load/save aset jaringan beserta locking file agar facade database legacy lebih tipis.
 * Caller: `lib/database.js` dan registrar/admin service yang perlu update aset jaringan.
 * Deps: `fs`, `proper-lockfile`, `lib/json-store.js`, dan state global legacy.
 * MainFuncs: `loadNetworkAssets`, `saveNetworkAssets`, `updateNetworkAssetsWithLock`.
 * SideEffects: Membaca/menulis `database/network_assets.json` dan memperbarui `global.networkAssets`.
 */
"use strict";

const fs = require("fs");
const lockfile = require("proper-lockfile");
const { dbBasePath } = require("./json-store");

const networkAssetsDbPath = require("path").join(dbBasePath, "network_assets.json");

function loadNetworkAssets() {
    try {
        if (fs.existsSync(networkAssetsDbPath)) {
            const fileContent = fs.readFileSync(networkAssetsDbPath, "utf-8");
            if (fileContent.trim() === "") {
                return [];
            }

            const jsonData = JSON.parse(fileContent);
            if (!Array.isArray(jsonData)) {
                console.error("[ASSET_LOAD_ERROR] Data di network_assets.json bukan array. Membuat backup dan file baru.");
                fs.copyFileSync(networkAssetsDbPath, `${networkAssetsDbPath}.corrupted.${Date.now()}.bak`);
                fs.writeFileSync(networkAssetsDbPath, JSON.stringify([], null, 2), "utf-8");
                return [];
            }
            return jsonData;
        }

        fs.writeFileSync(networkAssetsDbPath, JSON.stringify([], null, 2), "utf-8");
        return [];
    } catch (error) {
        console.error("[ASSET_LOAD_FATAL_ERROR] Gagal menangani file network_assets.json:", error);
        return [];
    }
}

function saveNetworkAssets(assets, globalScope = global) {
    if (!Array.isArray(assets)) {
        throw new Error("Data aset yang akan disimpan harus berupa array.");
    }

    try {
        fs.writeFileSync(networkAssetsDbPath, JSON.stringify(assets, null, 2), "utf-8");
        globalScope.networkAssets = assets;
    } catch (error) {
        console.error("[ASSET_SAVE_ERROR] Gagal menyimpan data aset jaringan:", error);
        throw new Error(`Gagal menyimpan data aset jaringan ke file: ${error.message}`);
    }
}

async function updateNetworkAssetsWithLock(updateFunction, globalScope = global) {
    let release = null;
    try {
        if (!fs.existsSync(networkAssetsDbPath)) {
            fs.writeFileSync(networkAssetsDbPath, JSON.stringify([], null, 2), "utf-8");
        }

        release = await lockfile.lock(networkAssetsDbPath, {
            retries: {
                retries: 10,
                minTimeout: 100,
                maxTimeout: 1000
            },
            stale: 5000
        });

        const assets = loadNetworkAssets();
        const result = await updateFunction(assets);
        saveNetworkAssets(assets, globalScope);
        return result;
    } catch (error) {
        console.error("[LOCK_ERROR] Failed to update network assets with lock:", error);
        throw error;
    } finally {
        if (release) {
            try {
                await release();
            } catch (releaseError) {
                console.error("[LOCK_RELEASE_ERROR]", releaseError);
            }
        }
    }
}

module.exports = {
    loadNetworkAssets,
    saveNetworkAssets,
    updateNetworkAssetsWithLock,
    networkAssetsDbPath
};
