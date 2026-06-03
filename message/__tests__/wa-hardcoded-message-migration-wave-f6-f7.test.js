/**
 * Header Doc
 * Purpose: Guardrail Wave F6+F7 migrasi hardcoded WA messages di saldo-handler, wifi-history, photo-queue, photo-workflow, wifi-name-state, approval-logic, device-status, raf-intent-dispatch.
 * Caller: Jest test runner (`npm test`).
 * Deps: `fs`, `path`.
 * MainFuncs: Verifikasi handler import renderResponseTemplate + semua key F6/F7 + dispatch_* ada di response_templates.
 * SideEffects: Tidak ada; test static.
 */
"use strict";

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TEMPLATES_FILE = path.join(ROOT, 'database', 'response_templates.json');

function readFile(relative) {
    return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function readRafIntentDispatchSources() {
    const rootFile = readFile('message/handlers/raf-intent-dispatch.js');
    const splitDir = path.join(ROOT, 'message', 'handlers', 'raf-intent-dispatch');
    const splitSources = fs.readdirSync(splitDir)
        .filter((file) => file.endsWith('.js'))
        .map((file) => fs.readFileSync(path.join(splitDir, file), 'utf8'));

    return [rootFile, ...splitSources].join('\n');
}

function loadTemplates() {
    return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
}

describe('Wave F6 — WA hardcoded message migration (saldo + wifi-history + minor files)', () => {
    const WAVE_F6_KEYS = [
        'saldo_sender_verification_failed',
        'saldo_cek_error',
        'saldo_topup_init_error',
        'saldo_topup_cancel_not_found',
        'saldo_topup_cancel_failed',
        'saldo_topup_cancel_error',
        'saldo_voucher_insufficient',
        'saldo_voucher_no_available',
        'saldo_voucher_buy_error',
        'saldo_transfer_format_invalid',
        'saldo_transfer_amount_invalid',
        'saldo_transfer_insufficient',
        'saldo_transfer_success',
        'saldo_transfer_failed',
        'saldo_transfer_error',
        'wifi_history_lid_not_registered',
        'wifi_history_not_registered',
        'wifi_history_empty',
        'wifi_history_error',
        'photo_queue_process_error',
        'photo_idle_reminder',
        'wifi_name_bulk_target_missing'
    ];

    test('saldo-handler import template-helpers dan pakai renderResponseTemplate', () => {
        const content = readFile('message/handlers/saldo-handler.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('wifi-history-handler pakai renderResponseTemplate dan UTF-8 valid (bukan mojibake)', () => {
        const content = readFile('message/handlers/wifi-history-handler.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
        // Pastikan tidak lagi mojibake (pattern seperti `â`, `ðŸ“‹`)
        expect(content).not.toMatch(/ðŸ|â\W|â€|Â«/);
    });

    test('photo-upload-queue + photo-workflow-handler + states/wifi-name-state-handler migrated', () => {
        const photoQueue = readFile('message/handlers/photo-upload-queue.js');
        const photoWorkflow = readFile('message/handlers/photo-workflow-handler.js');
        const wifiNameState = readFile('message/handlers/states/wifi-name-state-handler.js');
        expect(photoQueue).toMatch(/photo_queue_process_error/);
        expect(photoWorkflow).toMatch(/photo_idle_reminder/);
        expect(wifiNameState).toMatch(/wifi_name_bulk_target_missing/);
    });

    test('saldo-handler tidak lagi pakai hardcoded error literal utama', () => {
        const content = readFile('message/handlers/saldo-handler.js');
        expect(content).not.toMatch(/await reply\('\u274c Nomor WhatsApp Anda belum bisa diverifikasi otomatis/);
        expect(content).not.toMatch(/await reply\('\u274c Maaf, terjadi kesalahan saat mengecek saldo/);
        expect(content).not.toMatch(/await reply\('\u274c Terjadi kesalahan saat transfer/);
    });

    test('semua WAVE_F6_KEYS tersedia di response_templates.json dengan template non-empty', () => {
        const templates = loadTemplates();
        const missing = [];
        const empty = [];
        for (const key of WAVE_F6_KEYS) {
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

describe('Wave F7 — WA hardcoded message migration (lib outbound notification)', () => {
    const WAVE_F7_KEYS = [
        'approval_teknisi_status_notification',
        'approval_teknisi_payment_confirmation',
        'device_offline_message'
    ];

    test('lib/response-template-helper.js ada dan export renderResponseTemplate', () => {
        const content = readFile('lib/response-template-helper.js');
        expect(content).toMatch(/function renderResponseTemplate/);
        expect(content).toMatch(/module\.exports\s*=\s*\{[\s\S]*renderResponseTemplate/);
    });

    test('lib/approval-logic.js import response-template-helper dan pakai renderResponseTemplate', () => {
        const content = readFile('lib/approval-logic.js');
        expect(content).toMatch(/require\(['"]\.\/response-template-helper['"]\)/);
        expect(content).toMatch(/approval_teknisi_status_notification/);
        expect(content).toMatch(/approval_teknisi_payment_confirmation/);
    });

    test('lib/device-status.js migrate getDeviceOfflineMessage ke renderResponseTemplate', () => {
        const content = readFile('lib/device-status.js');
        expect(content).toMatch(/require\(['"]\.\/response-template-helper['"]\)/);
        expect(content).toMatch(/device_offline_message/);
    });

    test('semua WAVE_F7_KEYS tersedia di response_templates.json dengan template non-empty', () => {
        const templates = loadTemplates();
        const missing = [];
        const empty = [];
        for (const key of WAVE_F7_KEYS) {
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

describe('Refactor dispatch — raf-intent-dispatch.js safe migration', () => {
    const DISPATCH_KEYS = [
        'dispatch_tiketdone_missing_id',
        'dispatch_tiketdone_not_found',
        'dispatch_tiketdone_already_done',
        'dispatch_tiketdone_upload_prompt',
        'dispatch_button_menu',
        'dispatch_agent_detail_missing_id',
        'dispatch_cari_pelanggan_format',
        'dispatch_list_tiket_empty',
        'dispatch_done_upload_categories_missing',
        'dispatch_done_upload_not_enough',
        'dispatch_done_upload_complete',
        'dispatch_lid_only_command'
    ];

    test('raf-intent-dispatch.js import template-helpers dan pakai renderResponseTemplate', () => {
        const content = readFile('message/handlers/raf-intent-dispatch.js');
        expect(content).toMatch(/require\(['"]\.\/template-helpers['"]\)/);
        expect(content).toMatch(/renderResponseTemplate\(/);
    });

    test('raf-intent-dispatch.js 12 dispatch_* keys dipakai di switch cases', () => {
        const content = readRafIntentDispatchSources();
        for (const key of DISPATCH_KEYS) {
            expect(content).toMatch(new RegExp(`'${key}'`));
        }
    });

    test('raf-intent-dispatch.js tidak lagi punya hardcoded plain literal di top-level reply()', () => {
        const content = readRafIntentDispatchSources();
        // Pastikan pola hardcoded utama yang dipindahkan sudah hilang
        expect(content).not.toMatch(/return reply\("Mohon sertakan nomor tiket yang ingin diselesaikan/);
        expect(content).not.toMatch(/return reply\(`\u274c Tiket dengan ID \*\$\{ticketIdToResolve\}\* tidak ditemukan\.\\n\\nPastikan ID tiket benar\.`\)/);
        expect(content).not.toMatch(/return reply\(`\u26a0\ufe0f Tiket \*\$\{ticketIdToResolve\}\* sudah selesai sebelumnya\.`\)/);
        expect(content).not.toMatch(/await reply\('\u274c Masukkan ID agent\./);
        expect(content).not.toMatch(/return reply\('\u26a0\ufe0f Perintah ini hanya untuk pengguna dengan format @lid'\)/);
    });

    test('semua DISPATCH_KEYS tersedia di response_templates.json dengan template non-empty', () => {
        const templates = loadTemplates();
        const missing = [];
        const empty = [];
        for (const key of DISPATCH_KEYS) {
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
