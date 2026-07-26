/**
 * Header Doc
 * Purpose: Guard statis — setiap mutasi WiFi ke perangkat WAJIB dinilai lewat `assertWifiChangeApplied`, bukan `if (!x.ok)`, supaya sukses-semu tak bisa kambuh.
 * Caller: `npm test` (jest).
 * Deps: `fs` (memindai repo — bukan daftar manual).
 * MainFuncs: pemindaian file owner mutasi WiFi.
 * SideEffects: tidak ada (hanya baca file).
 */
"use strict";

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

// File yang MENGUBAH konfigurasi WiFi perangkat lalu melapor hasilnya ke pelanggan/staf.
// Kalau nanti ada owner baru, tambahkan di sini — atau lebih baik: pakai pola yang sama.
const OWNER_FILES = [
    'message/handlers/states/wifi-password-state-handler.js',
    'message/handlers/states/wifi-name-state-handler.js',
    'message/handlers/wifi-power-handler.js',
    'services/wifi-management.service.js',
];

// Pemanggilan adapter yang mengubah perangkat. `updateWifiSettings` adalah yang
// pernah bocor: payload kosong balik `ok:true` sehingga `if (!x.ok)` lolos.
const MUTATION_CALL = /\b(?:await\s+)?(?:deps\.)?(updateWifiSettings|setPassword|setSSIDName|setTransmitPower)\s*\(/g;

function readOwner(relPath) {
    return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('penilaian sukses mutasi WiFi', () => {
    test.each(OWNER_FILES)('%s memakai assertWifiChangeApplied, bukan cek .ok/.success longgar', (relPath) => {
        const source = readOwner(relPath);
        const lines = source.split('\n');

        // Cari cek longgar terhadap hasil mutasi: `if (!x.ok)` / `if (!x.success)`.
        const looseChecks = [];
        lines.forEach((line, index) => {
            if (/if\s*\(\s*!\s*\w+\.(ok|success)\s*\)/.test(line)) {
                looseChecks.push(`${relPath}:${index + 1} → ${line.trim()}`);
            }
        });

        expect(looseChecks).toEqual([]);
    });

    test.each(OWNER_FILES)('%s: setiap pemanggilan mutasi diikuti assertWifiChangeApplied', (relPath) => {
        const source = readOwner(relPath);
        const lines = source.split('\n');

        const unguarded = [];
        lines.forEach((line, index) => {
            MUTATION_CALL.lastIndex = 0;
            if (!MUTATION_CALL.test(line)) return;
            // Abaikan baris import/destructuring dan definisi fungsi lokal.
            if (/require\(|^\s*(async\s+)?function|:\s*(jest|null)/.test(line)) return;
            // Penjaga harus muncul tak jauh setelah pemanggilan. Jendela 10 baris
            // memberi ruang untuk argumen options yang ditulis multi-baris.
            const window = lines.slice(index, index + 11).join('\n');
            if (!window.includes('assertWifiChangeApplied')) {
                unguarded.push(`${relPath}:${index + 1} → ${line.trim()}`);
            }
        });

        expect(unguarded).toEqual([]);
    });

    test('semua owner mengimpor penjaga bersama dari lib/wifi-apply-guard', () => {
        const tanpaImport = OWNER_FILES.filter((relPath) => !readOwner(relPath).includes("wifi-apply-guard"));
        expect(tanpaImport).toEqual([]);
    });
});

// Catatan: kontrak "payload kosong = ok:false" dipagari secara PERILAKU di
// `lib/__tests__/wifi-apply-guard.test.js`, bukan dengan mencocokkan teks sumber
// di sini — satu aturan cukup dijaga di satu tempat.
