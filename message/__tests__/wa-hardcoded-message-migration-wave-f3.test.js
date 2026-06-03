/**
 * Header Doc
 * Purpose: Guardrail Wave F3 migrasi hardcoded WA messages di billing, package, balance management handler.
 * Caller: Jest test runner (`npm test`).
 * Deps: `fs`, `path`.
 * MainFuncs: Verifikasi handler import template-helpers + key F3 ada di response_templates.
 * SideEffects: Tidak ada; test static.
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
    return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
}

describe('Wave F3 — WA hardcoded message migration (billing + package + balance)', () => {
    const WAVE_F3_KEYS = [
        'billing_lid_not_registered',
        'billing_check_generic_error',
        'billing_change_package_pending',
        'billing_no_other_packages',
        'billing_change_package_list_header',
        'billing_change_package_generic_error',
        'package_lid_not_registered',
        'package_request_pending',
        'package_list_intro',
        'package_upgrade_header',
        'package_downgrade_header',
        'package_no_options',
        'package_list_footer',
        'package_generic_error',
        'sod_lid_not_registered',
        'sod_active_exists',
        'sod_pending_exists',
        'sod_no_options',
        'sod_list_intro',
        'sod_list_footer',
        'sod_generic_error',
        'balance_del_saldo_not_found',
        'balance_transfer_insufficient',
        'balance_topup_generic_error',
        'balance_del_saldo_generic_error',
        'balance_transfer_generic_error'
    ];

    const FILES = [
        'billing-management-handler.js',
        'package-management-handler.js',
        'balance-management-handler.js'
    ];

    test.each(FILES)('handler %s import template-helpers dan pakai renderResponseTemplate', (file) => {
        const content = readHandler(file);
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('billing-management-handler tidak lagi pakai hardcoded reply literal utama', () => {
        const content = readHandler('billing-management-handler.js');
        expect(content).not.toMatch(/return reply\(`\u274c Maaf, nomor Anda tidak terdaftar dalam database\.\\n\\nSilakan hubungi admin/);
        expect(content).not.toMatch(/await reply\('Terjadi kesalahan saat mengecek tagihan\. Silakan coba lagi\.'\)/);
    });

    test('package-management-handler tidak lagi pakai hardcoded reply literal utama', () => {
        const content = readHandler('package-management-handler.js');
        expect(content).not.toMatch(/return reply\(`Anda sudah memiliki permintaan perubahan paket ke/);
        expect(content).not.toMatch(/return reply\(`Anda sudah memiliki Speed on Demand yang aktif/);
        expect(content).not.toMatch(/return reply\(`Anda sudah memiliki permintaan Speed on Demand/);
        expect(content).not.toMatch(/return reply\("Maaf, tidak ada paket speed boost yang tersedia/);
    });

    test('balance-management-handler tidak lagi pakai hardcoded reply literal utama', () => {
        const content = readHandler('balance-management-handler.js');
        expect(content).not.toMatch(/await reply\('Nomor Yang Akan Dihapus Tidak Ditemukan\.'\)/);
        expect(content).not.toMatch(/await reply\('Terjadi kesalahan saat melakukan topup\.'\)/);
        expect(content).not.toMatch(/await reply\('Terjadi kesalahan saat menghapus saldo\.'\)/);
        expect(content).not.toMatch(/await reply\('Terjadi kesalahan saat melakukan transfer\.'\)/);
        expect(content).not.toMatch(/throw `uang mu tidak mencukupi untuk melakukan transfer\.`/);
    });

    test('semua WAVE_F3_KEYS tersedia di response_templates.json dengan template non-empty', () => {
        const templates = loadTemplates();
        const missing = [];
        const empty = [];
        for (const key of WAVE_F3_KEYS) {
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
