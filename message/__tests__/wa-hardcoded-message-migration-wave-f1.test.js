/**
 * Header Doc
 * Purpose: Guardrail Wave F1 migrasi hardcoded WA messages agar voucher-management-handler dan network-management-handler benar-benar memakai `renderResponseTemplate` dan semua key baru ada di `response_templates.json`.
 * Caller: Jest test runner (`npm test`).
 * Deps: `fs`, `path`, `lib/template-service`.
 * MainFuncs: Struktur check file handler + existence check key response template.
 * SideEffects: Tidak ada; test murni static + cache check.
 */
"use strict";

const fs = require('fs');
const path = require('path');

const HANDLERS_DIR = path.join(__dirname, '..', 'handlers');
const TEMPLATES_FILE = path.join(__dirname, '..', '..', 'database', 'response_templates.json');

function readHandler(file) {
    return fs.readFileSync(path.join(HANDLERS_DIR, file), 'utf8');
}

function loadTemplates() {
    const raw = fs.readFileSync(TEMPLATES_FILE, 'utf8');
    return JSON.parse(raw);
}

describe('Wave F1 — WA hardcoded message migration (voucher + network)', () => {
    const WAVE_F1_KEYS = [
        // Voucher
        'voucher_profile_exists',
        'voucher_profile_create_success',
        'voucher_profile_not_found',
        'voucher_profile_delete_success',
        'voucher_generic_error',
        // Statik
        'statik_profile_exists',
        'statik_profile_create_success',
        'statik_profile_not_found',
        'statik_profile_delete_success',
        'statik_generic_error',
        // Network binding
        'network_binding_mac_exists',
        'network_binding_invalid_mac',
        'network_binding_range_ip',
        'network_binding_technical_error',
        'network_binding_success',
        // Network queue
        'network_queue_parent_not_found',
        'network_queue_already_exists',
        'network_queue_limitat_exceed_download',
        'network_queue_limitat_exceed_upload',
        'network_queue_technical_error',
        'network_queue_success',
        // Network PPP
        'network_ppp_profile_error',
        'network_ppp_already_exists',
        'network_ppp_technical_error',
        'network_ppp_success',
        // Generic
        'network_generic_error'
    ];

    test('voucher-management-handler memakai renderResponseTemplate dan import template-helpers', () => {
        const content = readHandler('voucher-management-handler.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('network-management-handler memakai renderResponseTemplate dan import template-helpers', () => {
        const content = readHandler('network-management-handler.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('voucher-management-handler tidak lagi mengandung hardcoded literal utama', () => {
        const content = readHandler('voucher-management-handler.js');
        // Raw hardcoded string tanpa pembungkus renderResponseTemplate akan menghasilkan
        // pola `await reply(\`...\`)` langsung. Setelah migrasi, semua raw reply dibungkus renderResponseTemplate.
        const rawHardcoded = /await reply\(`Mohon Maaf Profil Yang Akan Ditambahkan Sudah Ada/;
        expect(content).not.toMatch(rawHardcoded);
    });

    test('network-management-handler tidak lagi mengandung hardcoded reply binding/queue/ppp literal utama', () => {
        const content = readHandler('network-management-handler.js');
        expect(content).not.toMatch(/await reply\(`Mohon Maaf Kak Mac Atau Ip Sudah Terdaftar/);
        expect(content).not.toMatch(/await reply\(`Pembuatan Ip Binding Telah Selesai\. Dengan Data Berikut/);
        expect(content).not.toMatch(/await reply\(`Pembuatan Simple Queue Telah Selesai/);
        expect(content).not.toMatch(/await reply\(`Pembuatan Akun PPPOE Berhasil/);
    });

    test('semua WAVE_F1_KEYS tersedia di response_templates.json dengan template non-empty', () => {
        const templates = loadTemplates();
        const missing = [];
        const empty = [];
        for (const key of WAVE_F1_KEYS) {
            const entry = templates[key];
            if (!entry) {
                missing.push(key);
                continue;
            }
            const tmpl = typeof entry === 'string' ? entry : entry.template;
            if (!tmpl || !String(tmpl).trim()) {
                empty.push(key);
            }
        }
        expect({ missing, empty }).toEqual({ missing: [], empty: [] });
    });
});
