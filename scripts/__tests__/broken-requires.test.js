"use strict";

/**
 * Header Doc
 * Purpose: Guard repo — setiap `require("./…")` relatif di KODE PRODUKSI harus resolve ke file yang
 *   benar-benar ada. Lahir dari bug nyata: `message/handlers/steps/general-steps.js` memanggil
 *   `require("../report-handler")` padahal modulnya bernama `ticket-creation-handler`. Akibatnya jalur
 *   tutup tiket teknisi melempar MODULE_NOT_FOUND SETELAH status tiket diubah di memori — tiket tak
 *   pernah tersimpan ke disk dan pelanggan tak pernah dinotifikasi, dan hilang saat restart.
 *   Kesalahan ketik semacam ini tak terlihat oleh lint dan hanya meledak saat cabang itu dijalankan,
 *   jadi ia harus dijaring statis.
 * Caller: Jest (`npm test`, atau `npx jest scripts/__tests__/broken-requires.test.js`).
 * Deps: fs, path (memindai repo; tidak mengeksekusi modul apa pun).
 * MainFuncs: -
 * SideEffects: Tidak ada — read-only.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");

// Layer kode produksi. `scripts/` ikut karena dipakai operasi produksi (migrasi, backup, drift-check).
const SCAN_ROOTS = ["message", "lib", "routes", "services", "repositories", "scripts"];
const SKIP_DIRS = new Set([
    "node_modules", ".git", "tmp", "dist", ".worktrees", "backups", "uploads", "sessions", "__tests__"
]);

// `database/` di-gitignore (SQLite + JSON operasional dibuat saat runtime), jadi require ke sana
// WAJAR tidak resolve di clone bersih — bukan salah ketik. Lihat "First-time setup" di CLAUDE.md.
const RUNTIME_DATA_PREFIX = /(^|\/)database\//;

function collectJsFiles(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectJsFiles(full, out);
        else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) out.push(full);
    }
}

function toRepoPath(fullPath) {
    return path.relative(REPO_ROOT, fullPath).split(path.sep).join("/");
}

function resolvesToRealFile(fromDir, spec) {
    const candidates = [spec, `${spec}.js`, `${spec}.json`, path.join(spec, "index.js")];
    return candidates.some((candidate) => {
        try {
            return fs.existsSync(path.resolve(fromDir, candidate));
        } catch (_e) {
            return false;
        }
    });
}

function findBrokenRequires() {
    const files = [];
    for (const root of SCAN_ROOTS) {
        const dir = path.join(REPO_ROOT, root);
        if (fs.existsSync(dir)) collectJsFiles(dir, files);
    }

    const broken = [];
    for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        const pattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
        let match;
        while ((match = pattern.exec(source))) {
            const spec = match[1];
            if (RUNTIME_DATA_PREFIX.test(spec)) continue;
            if (resolvesToRealFile(path.dirname(file), spec)) continue;
            const line = source.slice(0, match.index).split("\n").length;
            broken.push(`${toRepoPath(file)}:${line} → require("${spec}")`);
        }
    }
    return broken;
}

describe("guard: require relatif di kode produksi harus resolve", () => {
    test("tidak ada modul yang di-require tapi tak ada filenya", () => {
        const broken = findBrokenRequires();
        expect({ jumlah: broken.length, daftar: broken }).toEqual({ jumlah: 0, daftar: [] });
    });

    test("pemindai benar-benar memeriksa sesuatu (anti guard yang diam-diam kosong)", () => {
        const files = [];
        for (const root of SCAN_ROOTS) {
            const dir = path.join(REPO_ROOT, root);
            if (fs.existsSync(dir)) collectJsFiles(dir, files);
        }
        expect(files.length).toBeGreaterThan(300);
    });

    test("modul yang dulu hilang kini benar ada dan mengekspor saveReportsToFile", () => {
        const owner = require(path.join(REPO_ROOT, "message", "handlers", "ticket-creation-handler.js"));
        expect(typeof owner.saveReportsToFile).toBe("function");
    });
});
