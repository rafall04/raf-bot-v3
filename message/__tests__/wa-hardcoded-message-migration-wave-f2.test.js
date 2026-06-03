/**
 * Header Doc
 * Purpose: Guardrail Wave F2 migrasi hardcoded WA messages di wifi-power, reboot-modem, wifi-check, dan legacy-wifi-state.
 * Caller: Jest test runner (`npm test`).
 * Deps: `fs`, `path`.
 * MainFuncs: Check file handler import `template-helpers` + verifikasi keys F2 ada di `response_templates.json`.
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

describe('Wave F2 — WA hardcoded message migration (wifi-power + reboot + wifi-check + legacy-wifi-state)', () => {
    const WAVE_F2_KEYS = [
        'wifi_power_admin_id_not_found',
        'wifi_power_admin_prompt_id',
        'wifi_power_voucher_only_monthly',
        'wifi_power_device_missing',
        'wifi_power_format_prompt',
        'wifi_power_format_error',
        'wifi_power_success',
        'wifi_power_technical_error',
        'wifi_power_generic_error',
        'reboot_admin_id_not_found',
        'reboot_admin_prompt_id',
        'reboot_voucher_only_monthly',
        'reboot_device_missing',
        'reboot_confirm_prompt',
        'wifi_check_lid_not_registered',
        'wifi_check_device_missing',
        'wifi_check_loading',
        'wifi_confirm_name_success',
        'wifi_confirm_name_failed',
        'wifi_confirm_name_cancelled',
        'wifi_confirm_password_success',
        'wifi_confirm_password_failed',
        'wifi_confirm_password_cancelled'
    ];

    const FILES = [
        'wifi-power-handler.js',
        'reboot-modem-handler.js',
        'wifi-check-handler.js'
    ];

    test.each(FILES)('handler %s import template-helpers dan pakai renderResponseTemplate', (file) => {
        const content = readHandler(file);
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('wifi-power-handler tidak lagi pakai hardcoded reply literal utama', () => {
        const content = readHandler('wifi-power-handler.js');
        expect(content).not.toMatch(/reply\(`Maaf Kak, fitur ganti power WiFi/);
        expect(content).not.toMatch(/reply\(`Power Wifi Berhasil Dirubah Ke/);
    });

    test('reboot-modem-handler tidak lagi pakai hardcoded reply literal utama', () => {
        const content = readHandler('reboot-modem-handler.js');
        expect(content).not.toMatch(/reply\(`Maaf Kak [^,]+, fitur reboot modem/);
        expect(content).not.toMatch(/reply\(`Tentu, saya bisa me-reboot modem/);
    });

    test('wifi-check-handler tidak lagi pakai hardcoded lid_not_registered + loading literal', () => {
        const content = readHandler('wifi-check-handler.js');
        expect(content).not.toMatch(/return reply\(`\u274c Maaf, nomor Anda tidak terdaftar dalam database/);
        expect(content).not.toMatch(/await reply\("\u23f3 Sedang mengambil informasi WiFi dan modem/);
    });

    test('semua WAVE_F2_KEYS tersedia di response_templates.json dengan template non-empty', () => {
        const templates = loadTemplates();
        const missing = [];
        const empty = [];
        for (const key of WAVE_F2_KEYS) {
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
