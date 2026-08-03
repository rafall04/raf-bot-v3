/**
 * Header Doc
 * Purpose: Guardrail agar pola "buka koneksi sqlite BARU ke `users.sqlite` yang LIVE lalu tutup"
 *   tidak pernah kembali. Pola itu me-yatimkan file `-wal`/`-shm` (ter-unlink saat koneksi tulis
 *   app masih memegangnya) sehingga tulis pembayaran gagal `SQLITE_IOERR: disk I/O error` secara
 *   acak dan SENYAP sampai `pm2 restart` — insiden prod 03-08-2026 (pembayaran pelanggan tercatat
 *   separuh: payment_history masuk, users.paid & financial_ledger tidak).
 * Caller: Jest test runner.
 * Deps: `fs`, `path`.
 * MainFuncs: - (suite test).
 * SideEffects: Hanya membaca source.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const SCAN_DIRS = ["lib", "routes", "services", "repositories", "message"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".git", "coverage", "tmp", "dist", ".worktrees"]);

// Modul yang MEMANG berhak membuka users.sqlite sendiri:
// - database.js            : pembuat koneksi app persisten (`global.db`) itu sendiri
// - error-recovery.js      : membuka ulang koneksi saat pemulihan (koneksi lama sudah ditutup)
// - database-migration-manager.js : migrasi saat startup, sebelum app melayani trafik
// - sqlite-shared-reader.js: pemilik baru koneksi baca bersama
const ALLOWED = new Set([
    path.join("lib", "database.js"),
    path.join("lib", "error-recovery.js"),
    path.join("lib", "database-migration-manager.js"),
    path.join("lib", "sqlite-shared-reader.js")
]);

// Modul yang dulu memakai pola terlarang dan sudah dibersihkan — dikunci agar tak kembali.
const PREVIOUSLY_OFFENDING = [
    path.join("lib", "payment-finance-service.js"),
    path.join("lib", "financial-ledger.js"),
    path.join("lib", "database-reload.js"),
    path.join("routes", "discount.js"),
    path.join("routes", "change-package.js")
];

function collectSourceFiles() {
    const files = [];

    function walk(dirPath) {
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
                files.push(fullPath);
            }
        }
    }

    for (const dir of SCAN_DIRS) {
        const full = path.join(repoRoot, dir);
        if (fs.existsSync(full)) walk(full);
    }
    return files;
}

// `new sqlite3.Database(...)` / `new (require("sqlite3").verbose().Database)(...)` yang argumennya
// menyebut users.sqlite pada baris yang sama.
// CATATAN: kelas karakter WAJIB memuat digit — tanpa `0-9` pola ini tak pernah cocok dengan
// `new sqlite3.Database(` (angka "3" pada "sqlite3"), yaitu justru bentuk yang paling mungkin
// muncul lagi. Cacat itu sempat ada saat guard ini ditulis; jangan dihapus lagi.
const OPEN_PATTERN = /new\s+(?:\(?\s*require\(["']sqlite3["']\)[^)]*\)?\.)?[A-Za-z0-9_$.()\s]*Database\s*\)?\s*\(/;

describe("kebijakan koneksi users.sqlite", () => {
    test("tidak ada modul (di luar allowlist) yang membuka koneksi baru ke users.sqlite", () => {
        const pelanggaran = [];

        for (const file of collectSourceFiles()) {
            const relative = path.relative(repoRoot, file);
            if (ALLOWED.has(relative)) continue;

            const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
            lines.forEach((line, index) => {
                if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
                if (!line.includes("users.sqlite")) return;
                if (!OPEN_PATTERN.test(line)) return;
                // Koneksi READ-ONLY tidak bisa checkpoint maupun meng-unlink `-wal`/`-shm`
                // (butuh izin tulis), jadi ia TIDAK bisa menyebabkan bug yatim ini. Mode-nya
                // sering ditulis di baris tetangga (mis. default parameter), makanya dicek
                // dalam jendela beberapa baris.
                const konteks = lines.slice(Math.max(0, index - 3), index + 2).join("\n");
                if (konteks.includes("OPEN_READONLY")) return;
                pelanggaran.push(`${relative}:${index + 1} → ${line.trim()}`);
            });
        }

        expect(pelanggaran).toEqual([]);
    });

    test("modul yang sudah dibersihkan tidak membuka koneksi sqlite sendiri lagi", () => {
        const pelanggaran = [];

        for (const relative of PREVIOUSLY_OFFENDING) {
            const full = path.join(repoRoot, relative);
            if (!fs.existsSync(full)) continue;

            const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
            lines.forEach((line, index) => {
                if (line.trim().startsWith("*") || line.trim().startsWith("//")) return;
                if (!OPEN_PATTERN.test(line)) return;
                pelanggaran.push(`${relative}:${index + 1} → ${line.trim()}`);
            });
        }

        expect(pelanggaran).toEqual([]);
    });

    test("jalur baca pembayaran memakai koneksi bersama, bukan buka-tutup per operasi", () => {
        const financeSource = fs.readFileSync(
            path.join(repoRoot, "lib", "payment-finance-service.js"), "utf8"
        );
        const ledgerSource = fs.readFileSync(
            path.join(repoRoot, "lib", "financial-ledger.js"), "utf8"
        );

        expect(financeSource).toContain("getSharedReader");
        expect(ledgerSource).toContain("getSharedReader");
        // `readerAll` financial-ledger dulu memanggil db.close() tiap query.
        expect(ledgerSource).not.toContain("db.close()");
    });
});
