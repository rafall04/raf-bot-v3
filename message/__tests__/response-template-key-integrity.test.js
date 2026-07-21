/**
 * Header Doc
 * Purpose: Guardrail menyeluruh supaya setiap key `renderResponseTemplate('key', ...)` di seluruh repo
 *          benar-benar ada di `database/response_templates.json`. Tanpa ini, key yang hilang lolos diam-diam:
 *          fallback runtime tetap terkirim sehingga tak ada gejala, tapi admin kehilangan kemampuan mengedit
 *          pesan itu di `/api/templates` (pernah terjadi pada 11 key, termasuk seluruh alur transfer saldo).
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, `database/response_templates.json`, dan seluruh source `.js` aktif.
 * MainFuncs: `collectTemplateKeyUsages`, verifikasi key terdaftar + bentuk entry valid.
 * SideEffects: Hanya membaca source dan JSON; tidak menjalankan handler.
 */
"use strict";

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const responseTemplates = require('../../database/response_templates.json');

// Direktori yang tidak mencerminkan kode aktif.
const SKIP_DIRS = new Set([
    'node_modules', '.git', 'coverage', 'tmp', 'dist', '.worktrees', 'backups', 'sessions'
]);

// File yang MEMUAT pola pemanggilan sebagai DATA (regex), bukan memanggilnya. Tanpa dikecualikan,
// scanner menarik potongan regex-nya sebagai "key" palsu.
const SKIP_FILES = new Set([
    'lib/template-usage-scanner.js'
]);

// Key yang dirakit dinamis saat runtime (mis. `speed_status_icon_${status}`) tidak bisa
// diverifikasi statis. Daftar prefix ini sengaja sempit — tambah hanya bila memang dinamis.
const DYNAMIC_KEY_PREFIXES = [
    'speed_boost_payment_method_',
    'speed_boost_payment_label_',
    'speed_boost_confirmation_note_',
    'speed_status_icon_',
    'speed_status_payment_'
];

function isDynamicKey(key) {
    return key.includes('${') || DYNAMIC_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Kumpulkan semua pemakaian `renderResponseTemplate('<key>'` dengan key literal.
 * @returns {Array<{key: string, file: string, line: number}>}
 */
function collectTemplateKeyUsages() {
    const usages = [];

    function walk(dirPath) {
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;

            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (!entry.name.endsWith('.js') || entry.name.endsWith('.test.js')) continue;

            const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
            if (SKIP_FILES.has(relativePath)) continue;
            const source = fs.readFileSync(fullPath, 'utf8');
            if (!source.includes('renderResponseTemplate') && !source.includes('renderTpl(')) continue;

            // Dua bentuk pemanggilan yang dipakai di repo ini:
            //   renderResponseTemplate('key', fallback, data)   — handler & service
            //   renderTpl(context, 'key', fallback, data)       — state domain (`state-domains/*.state.js`)
            // Bentuk kedua sempat luput dari guard ini, sehingga key milik seluruh state domain
            // tidak pernah diperiksa. Jangan mempersempit lagi tanpa mengganti penggantinya.
            const patterns = [
                /renderResponseTemplate(?:OrFallback)?\(\s*(['"`])([^'"`]+)\1/g,
                /renderTpl\(\s*[A-Za-z0-9_.]+\s*,\s*(['"`])([^'"`]+)\1/g
            ];
            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(source)) !== null) {
                    const key = match[2];
                    if (isDynamicKey(key)) continue;
                    usages.push({
                        key,
                        file: relativePath,
                        line: source.slice(0, match.index).split('\n').length
                    });
                }
            }
        }
    }

    walk(repoRoot);
    return usages;
}

describe('response template key integrity', () => {
    const usages = collectTemplateKeyUsages();

    test('memindai jumlah pemakaian yang wajar (deteksi scanner rusak)', () => {
        // Kalau regex/walker rusak, hasilnya nol dan test lain jadi hijau palsu.
        expect(usages.length).toBeGreaterThan(300);
    });

    test('setiap key yang dirujuk kode terdaftar di response_templates.json', () => {
        const missing = usages
            .filter((usage) => !responseTemplates[usage.key])
            .map((usage) => `${usage.key}  <- ${usage.file}:${usage.line}`);

        // Pesan gagal menyebut lokasi persisnya supaya langsung bisa ditambal.
        expect(missing).toEqual([]);
    });

    test('setiap entry template punya bentuk yang valid', () => {
        const malformed = Object.entries(responseTemplates)
            .filter(([, entry]) => !entry
                || typeof entry.name !== 'string' || !entry.name.trim()
                || typeof entry.template !== 'string' || !entry.template.trim()
                || typeof entry.category !== 'string' || !entry.category.trim())
            .map(([key]) => key);

        expect(malformed).toEqual([]);
    });
});
