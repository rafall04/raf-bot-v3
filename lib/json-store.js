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

// Pastikan folder induk ada sebelum menulis file. File seperti "user/atm.json"
// berada di subfolder yang di-gitignore, jadi hilang setelah clone -> writeFileSync
// akan gagal ENOENT bila foldernya belum dibuat.
function ensureParentDir(fullPath) {
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
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
        ensureParentDir(fullPath);
        fs.writeFileSync(fullPath, JSON.stringify(emptyState, null, 2), "utf8");
        return emptyState;
    } catch (error) {
        // JANGAN kembalikan state kosong begitu saja. Rantai kehilangan datanya begini:
        // berkas rusak/terpotong → parse gagal → dikembalikan `[]` → penulis berikutnya
        // menyimpan `[]` itu → isi aslinya HILANG PERMANEN dan senyap. Berkas yang lewat sini
        // adalah ledger nyata: reports.json (tiket), requests.json, invoices.json.
        //
        // Berkasnya KARANTINA dulu — jadi datanya masih bisa dipulihkan tangan — lalu baru
        // lanjut dengan state kosong supaya bot tetap hidup. Menjatuhkan bot juga bukan
        // jawaban: satu berkas rusak tak boleh mematikan seluruh layanan.
        console.error(`[JSON_LOAD_ERROR] Gagal memuat atau parse JSON dari ${fullPath}:`, error);
        try {
            if (fs.existsSync(fullPath)) {
                const cap = new Date().toISOString().replace(/[:.]/g, "-");
                const karantina = `${fullPath}.rusak-${cap}`;
                fs.renameSync(fullPath, karantina);
                console.error(
                    `[JSON_LOAD_ERROR] Berkas rusak DIKARANTINA ke ${karantina} — isi lama masih ` +
                    `bisa dipulihkan dari sana. Jangan hapus sebelum diperiksa.`
                );
            }
        } catch (errKarantina) {
            console.error("[JSON_LOAD_ERROR] Gagal mengkarantina berkas rusak:", errKarantina.message);
        }
        return buildEmptyState(filePath);
    }
}

function saveJSON(filePath, data) {
    const fullPath = resolveJsonPath(filePath);
    try {
        ensureParentDir(fullPath);

        // TULIS ATOMIK: tulis ke berkas sementara di direktori yang SAMA lalu `rename`.
        // `rename` dalam satu filesystem bersifat atomik, jadi pembaca hanya pernah melihat
        // isi lama yang utuh ATAU isi baru yang utuh — tak pernah setengah jadi.
        //
        // `writeFileSync` langsung ke berkas tujuan berisiko: bila proses mati di tengah tulis
        // (PM2 mengirim SIGKILL setelah kill_timeout terlampaui — handler SIGTERM di
        // lib/process-lifecycle.js melakukan kerja async — atau listrik padam), berkasnya
        // tertinggal terpotong. Parse berikutnya gagal, `loadJSON` memulangkan kosong, dan
        // penulis berikutnya menyegel kehilangan itu.
        const sementara = `${fullPath}.tmp-${process.pid}`;
        fs.writeFileSync(sementara, JSON.stringify(data, null, 2), "utf8");
        fs.renameSync(sementara, fullPath);
    } catch (error) {
        console.error(`[JSON_SAVE_ERROR] Gagal menyimpan data ke ${fullPath}:`, error);
        // Bersihkan sisa berkas sementara supaya tak menumpuk di direktori database.
        try {
            const sementara = `${fullPath}.tmp-${process.pid}`;
            if (fs.existsSync(sementara)) fs.unlinkSync(sementara);
        } catch (_e) { /* abaikan */ }
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
