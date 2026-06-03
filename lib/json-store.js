/**
 * Header Doc
 * Purpose: Menyediakan helper JSON store terpusat untuk load/save/sync koleksi berbasis file.
 * Caller: `lib/database.js`, helper persistence admin legacy, dan modul baru yang perlu sinkronisasi JSON.
 * Deps: `fs`, `path`, dan state global legacy.
 * MainFuncs: `loadJSON`, `saveJSON`, `syncJsonCollection`, `resolveJsonPath`.
 * SideEffects: Membaca/menulis file JSON pada folder `database/` dan dapat menyinkronkan nilai ke `global.*`.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const dbBasePath = path.join(__dirname, "..", "database");

function resolveJsonPath(filePath) {
    return path.join(dbBasePath, String(filePath || "").replace("database/", ""));
}

function buildEmptyState(filePath) {
    return String(filePath || "").endsWith(".json") && !String(filePath || "").includes("config") ? [] : {};
}

function loadJSON(filePath) {
    const fullPath = resolveJsonPath(filePath);
    try {
        if (fs.existsSync(fullPath)) {
            const fileData = fs.readFileSync(fullPath, "utf8");
            if (fileData.trim() === "") {
                return buildEmptyState(filePath);
            }
            return JSON.parse(fileData);
        }

        const emptyState = buildEmptyState(filePath);
        console.warn(`[JSON_LOAD_WARN] File tidak ditemukan: ${fullPath}, membuat file baru.`);
        fs.writeFileSync(fullPath, JSON.stringify(emptyState, null, 2), "utf8");
        return emptyState;
    } catch (error) {
        console.error(`[JSON_LOAD_ERROR] Gagal memuat atau parse JSON dari ${fullPath}:`, error);
        return buildEmptyState(filePath);
    }
}

function saveJSON(filePath, data) {
    const fullPath = resolveJsonPath(filePath);
    try {
        fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
        console.error(`[JSON_SAVE_ERROR] Gagal menyimpan data ke ${fullPath}:`, error);
    }
}

function syncJsonCollection(filePath, nextValue, options = {}) {
    const globalScope = options.globalScope || global;
    if (options.globalKey) {
        globalScope[options.globalKey] = nextValue;
    }
    saveJSON(filePath, nextValue);
    return nextValue;
}

module.exports = {
    dbBasePath,
    resolveJsonPath,
    loadJSON,
    saveJSON,
    syncJsonCollection
};
