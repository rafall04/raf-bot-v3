/**
 * Header Doc
 * Purpose: Guardrail Wave F5 migrasi hardcoded WA messages di utility-handler dan monitoring-handler cleanup.
 * Caller: Jest test runner (`npm test`).
 * Deps: `fs`, `path`.
 * MainFuncs: Verifikasi handler import template-helpers + semua key F5 ada di response_templates.
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

describe('Wave F5 — WA hardcoded message migration (utility + monitoring)', () => {
    const WAVE_F5_KEYS = [
        'utility_admin_contact_missing',
        'utility_cek_tiket_not_owned',
        'utility_bantuan_fallback',
        'monitoring_ppp_stats_header',
        'monitoring_ppp_inactive_list_header',
        'monitoring_ppp_inactive_detail_missing',
        'monitoring_ppp_all_active',
        'monitoring_ppp_stats_footer',
        'monitoring_hotspot_stats_wrapper',
        'monitoring_allsaldo_wrapper',
        'monitoring_allusers_wrapper',
        'monitoring_list_profstatik_wrapper',
        'monitoring_list_profvoucher_wrapper'
    ];

    test('utility-handler import template-helpers dan pakai renderResponseTemplate', () => {
        const content = readHandler('utility-handler.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('monitoring-handler import template-helpers dan pakai renderResponseTemplate dari helper terpusat', () => {
        const content = readHandler('monitoring-handler.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
    });

    test('utility-handler tidak lagi pakai hardcoded admin contact / cek tiket not owned literal', () => {
        const content = readHandler('utility-handler.js');
        expect(content).not.toMatch(/return reply\('\u274c Nomor admin tidak tersedia\. Silakan hubungi support\.'\)/);
        expect(content).not.toMatch(/return reply\(`\ud83d\udeab Maaf Kak \$\{pushname\}, Anda hanya dapat memeriksa tiket laporan milik Anda sendiri/);
    });

    test('monitoring-handler.js statistik PPPoE tidak lagi pakai hardcoded header concatenation', () => {
        const content = readHandler('monitoring-handler.js');
        // Header sekarang lewat renderResponseTemplate('monitoring_ppp_stats_header', ...)
        expect(content).toMatch(/monitoring_ppp_stats_header/);
        expect(content).toMatch(/monitoring_ppp_stats_footer/);
        // Pastikan tidak ada pattern lama `let replyText = \`📊 *Statistik PPPoE` di luar fallback renderResponseTemplate
        expect(content).not.toMatch(/let replyText = `\ud83d\udcca \*Statistik PPPoE Saat Ini/);
    });

    test('monitoring-handler.js allsaldo/allusers/list-prof* pakai wrapper responseTemplate', () => {
        const content = readHandler('monitoring-handler.js');
        expect(content).toMatch(/monitoring_allsaldo_wrapper/);
        expect(content).toMatch(/monitoring_allusers_wrapper/);
        expect(content).toMatch(/monitoring_list_profstatik_wrapper/);
        expect(content).toMatch(/monitoring_list_profvoucher_wrapper/);
        expect(content).not.toMatch(/let txtx = `\u300c \*\$\{config\.nama\}\* \u300d/);
    });

    test('semua WAVE_F5_KEYS tersedia di response_templates.json dengan template non-empty', () => {
        const templates = loadTemplates();
        const missing = [];
        const empty = [];
        for (const key of WAVE_F5_KEYS) {
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
