#!/usr/bin/env node
/**
 * Header Doc
 * Purpose: Merge aman file JSON data (database/*.json) saat deploy — menambahkan entri/key
 *          dari versi repo ke file prod TANPA mengubah bentuk file. Dibuat setelah insiden
 *          b403 (21 Sep 2026): merge ad-hoc `{...array}` menulis wifi_templates.json sebagai
 *          object ber-key numerik -> wifiTemplates.map TypeError -> kedua bot bisu ~2 hari.
 *          Aturan keras: array tetap array, object tetap object; bentuk berubah = abort.
 * Caller: proses deploy di mesin dev (bukan runtime app). Contoh:
 *           node scripts/merge-data-json.js merge <prod.json> <repo.json> <out.json> [--key=intent]
 *           node scripts/merge-data-json.js verify-shapes <prod_database_dir> <repo_database_dir>
 * Deps: `fs`, `path` saja.
 * MainFuncs: `mergeJsonData`, `verifyShapes`, `main`.
 * SideEffects: mode `merge` menulis <out.json> (atau <prod.json> dengan --in-place);
 *              exit code non-zero bila bentuk berubah/input tidak sah. `verify-shapes` read-only.
 */
"use strict";

const fs = require("fs");
const path = require("path");

// Field kunci yang dicoba berurutan untuk merge file array (wifi_templates.json pakai `intent`).
const ARRAY_KEY_CANDIDATES = ["intent", "key", "id", "name"];

function parseJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const shapeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/** Deteksi field kunci bersama untuk dua array objek. */
function detectArrayKey(prod, repo, explicit) {
    if (explicit) return explicit;
    return (
        ARRAY_KEY_CANDIDATES.find(
            (k) =>
                prod.length > 0 &&
                repo.length > 0 &&
                prod.every((e) => e && typeof e === "object" && !Array.isArray(e) && k in e) &&
                repo.every((e) => e && typeof e === "object" && !Array.isArray(e) && k in e)
        ) || null
    );
}

/**
 * Merge: hasil = isi prod + entri/key yang hanya ada di repo.
 * Prod tidak pernah diubah/diurut ulang; bentuk hasil selalu sama dengan bentuk prod.
 */
function mergeJsonData(prod, repo, keyField) {
    if (shapeOf(prod) !== shapeOf(repo)) {
        throw new Error(
            `Bentuk tidak cocok: prod=${shapeOf(prod)} repo=${shapeOf(repo)}. ` +
                `Jangan pernah menyeragamkan lewat spread — perbaiki file sumbernya.`
        );
    }

    if (Array.isArray(prod)) {
        const field = detectArrayKey(prod, repo, keyField);
        if (!field) {
            throw new Error(
                "Kedua array tidak punya field kunci bersama " +
                    `(${ARRAY_KEY_CANDIDATES.join("/")}). Merge manual, jangan ditulis otomatis.`
            );
        }
        const have = new Set(prod.map((e) => e[field]));
        const added = repo.filter((e) => e && typeof e === "object" && !have.has(e[field]));
        return { merged: [...prod, ...added], addedCount: added.length, keyField: field };
    }

    if (shapeOf(prod) === "object") {
        const missing = Object.keys(repo).filter((k) => !(k in prod));
        const merged = { ...prod };
        for (const k of missing) merged[k] = repo[k];
        return { merged, addedCount: missing.length, keyField: null, addedKeys: missing };
    }

    throw new Error(`Tipe ${shapeOf(prod)} tidak bisa di-merge — hanya array/object yang didukung.`);
}

/** Bandingkan bentuk file JSON senama di dua direktori database. Exit non-zero bila ada beda. */
function verifyShapes(prodDir, repoDir) {
    const repoFiles = fs.readdirSync(repoDir).filter((f) => f.endsWith(".json"));
    let bad = 0;
    for (const f of repoFiles.sort()) {
        const prodPath = path.join(prodDir, f);
        if (!fs.existsSync(prodPath)) {
            console.log(`HILANG di prod : ${f}`);
            continue;
        }
        let prodShape, repoShape;
        try {
            prodShape = shapeOf(parseJsonFile(prodPath));
            repoShape = shapeOf(parseJsonFile(path.join(repoDir, f)));
        } catch (e) {
            console.log(`PARSE GAGAL  : ${f} — ${e.message}`);
            bad++;
            continue;
        }
        if (prodShape !== repoShape) {
            console.log(`BENTUK BEDA  : ${f} prod=${prodShape} repo=${repoShape}  <-- BUG KELAS b403`);
            bad++;
        }
    }
    console.log(bad === 0 ? `OK — ${repoFiles.length} file, semua bentuk cocok.` : `${bad} file bermasalah.`);
    return bad;
}

function main() {
    const [mode, a, b, c] = process.argv.slice(2);
    const keyArg = process.argv.find((x) => x.startsWith("--key="));
    const keyField = keyArg ? keyArg.slice(6) : null;
    const inPlace = process.argv.includes("--in-place");

    if (mode === "merge") {
        if (!a || !b || !(c || inPlace)) {
            console.error("pakai: merge <prod.json> <repo.json> <out.json> | merge <prod.json> <repo.json> --in-place [--key=intent]");
            process.exit(1);
        }
        const { merged, addedCount, keyField: usedKey, addedKeys } = mergeJsonData(parseJsonFile(a), parseJsonFile(b), keyField);
        const target = inPlace ? a : c;
        if (addedCount === 0) {
            console.log(`NO_CHANGE ${path.basename(a)}`);
        } else {
            fs.writeFileSync(target, JSON.stringify(merged, null, 2) + "\n", "utf8");
            console.log(
                `ADDED=${addedCount} ${path.basename(a)}` +
                    (usedKey ? ` key=${usedKey}` : ` keys=${(addedKeys || []).join(",")}`)
            );
        }
        return;
    }

    if (mode === "verify-shapes") {
        if (!a || !b) {
            console.error("pakai: verify-shapes <prod_database_dir> <repo_database_dir>");
            process.exit(1);
        }
        process.exit(verifyShapes(a, b) === 0 ? 0 : 1);
    }

    console.error("mode: merge | verify-shapes");
    process.exit(1);
}

module.exports = { mergeJsonData, verifyShapes, detectArrayKey, shapeOf };

if (require.main === module) main();
