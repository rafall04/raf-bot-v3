/**
 * Header Doc
 * Purpose: Guardrail Wave F4 migrasi hardcoded WA messages di access-management, states (wifi-password, wifi-name), steps (general), dan conversation-state.
 * Caller: Jest test runner (`npm test`).
 * Deps: `fs`, `path`.
 * MainFuncs: Verifikasi handler import renderResponseTemplate + semua key F4 ada di response_templates.
 * SideEffects: Tidak ada; test static.
 */
"use strict";

const fs = require('fs');
const path = require('path');

const HANDLERS_DIR = path.join(__dirname, '..', 'handlers');
const TEMPLATES_FILE = path.join(__dirname, '..', '..', 'database', 'response_templates.json');

function readHandler(relativePath) {
    return fs.readFileSync(path.join(HANDLERS_DIR, relativePath), 'utf8');
}

function loadTemplates() {
    return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
}

describe('Wave F4 — WA hardcoded message migration (access + states + steps + conversation)', () => {
    const WAVE_F4_KEYS = [
        // access
        'access_not_registered_lid',
        'access_not_registered',
        'access_list_single',
        'access_list_many',
        'access_add_format',
        'access_add_invalid_prefix',
        'access_add_invalid_format',
        'access_add_limit_reached',
        'access_add_duplicate',
        'access_add_db_error',
        'access_add_success',
        'access_delete_format',
        'access_delete_not_found',
        'access_delete_primary_blocked',
        'access_delete_success',
        'access_help',
        // wifi state errors
        'wifi_password_change_error',
        'wifi_password_confirm_technical_error',
        'wifi_password_applying_single',
        'wifi_password_applying_bulk',
        'wifi_name_change_error',
        // general step
        'general_step_applying_power',
        // conversation
        'conversation_universal_cancel',
        'conversation_unknown_step_error'
    ];

    test('access-management-handler import template-helpers dan pakai renderResponseTemplate', () => {
        const content = readHandler('access-management-handler.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('conversation-state-handler import template-helpers dan pakai renderResponseTemplate', () => {
        const content = readHandler('conversation-state-handler.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('states/wifi-password-state-handler dan wifi-name-state-handler pakai renderResponseTemplate (helper lokal)', () => {
        const password = readHandler('states/wifi-password-state-handler.js');
        const name = readHandler('states/wifi-name-state-handler.js');
        expect(password).toMatch(/renderResponseTemplate\(/);
        expect(name).toMatch(/renderResponseTemplate\(/);
    });

    test('steps/general-steps.js renderResponseTemplate helper support fallback pattern', () => {
        const content = readHandler('steps/general-steps.js');
        expect(content).toMatch(/fallback !== null/);
        expect(content).toMatch(/general_step_applying_power/);
    });

    test('access-management tidak lagi pakai hardcoded throw/reply literal utama', () => {
        const content = readHandler('access-management-handler.js');
        expect(content).not.toMatch(/throw `\u274c Maaf, nomor Anda tidak terdaftar dalam database/);
        expect(content).not.toMatch(/throw "\u274c Maaf! Nomor Anda tidak terdaftar sebagai pelanggan/);
        expect(content).not.toMatch(/throw "\u274c Format tidak lengkap!/);
        expect(content).not.toMatch(/throw `\u274c Batas maksimal tercapai!/);
        expect(content).not.toMatch(/throw `\u274c Nomor sudah terdaftar!/);
        expect(content).not.toMatch(/throw `\u274c Tidak dapat menghapus nomor utama!/);
        expect(content).not.toMatch(/reply\("\u274c Maaf, terjadi kesalahan sistem saat memperbarui data/);
    });

    test('wifi-password-state-handler tidak lagi pakai hardcoded error literal utama', () => {
        const content = readHandler('states/wifi-password-state-handler.js');
        expect(content).not.toMatch(/return reply\(`\u274c Maaf, gagal mengubah kata sandi WiFi\. Silakan coba lagi atau hubungi admin\.\\n\\nError: \$\{error\.message\}`\)/);
        expect(content).not.toMatch(/return reply\('\u26a0\ufe0f Maaf, ada kendala teknis saat mengubah kata sandi WiFi/);
        expect(content).not.toMatch(/reply\(`\u23f3 Sedang mengubah kata sandi WiFi SSID \$\{ssid_id\}\.\.\.`\)/);
    });

    test('wifi-name-state-handler tidak lagi pakai hardcoded error literal utama', () => {
        const content = readHandler('states/wifi-name-state-handler.js');
        expect(content).not.toMatch(/return reply\(`\u274c Maaf, gagal mengubah nama WiFi\. Silakan coba lagi atau hubungi admin\.\\n\\nError: \$\{error\.message\}`\)/);
    });

    test('conversation-state-handler tidak lagi pakai hardcoded cancel/unknown literal', () => {
        const content = readHandler('conversation-state-handler.js');
        expect(content).not.toMatch(/return reply\("Baik, permintaan sebelumnya telah dibatalkan\. Ada lagi yang bisa saya bantu\?"\)/);
        expect(content).not.toMatch(/return reply\("Maaf, terjadi kesalahan dalam proses\. Silakan coba lagi dari awal\."\)/);
    });

    test('semua WAVE_F4_KEYS tersedia di response_templates.json dengan template non-empty', () => {
        const templates = loadTemplates();
        const missing = [];
        const empty = [];
        for (const key of WAVE_F4_KEYS) {
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
