/**
 * Header Doc
 * Purpose: Mengunci perbaikan "wizard mati senyap". Dulu pemutusan conversation state memakai
 *          `resolveGlobalCommandStatus`, yang bernilai true untuk keyword APA PUN. Akibatnya
 *          jawaban wajar di tengah wizard meledakkan sesi — termasuk `cari <SN>` dan `lokasi <nama>`
 *          yang justru DIAJARKAN bot sendiri, serta "internet mati" sebagai isi keluhan. Sekarang
 *          hanya perintah global EKSPLISIT (`menu`/`bantuan`/`lapor`/…) yang boleh memutus state.
 * Caller: Jest (`npx jest message/handlers/__tests__/state-breaking-command.test.js`).
 * Deps: `../raf-interceptors`, sumber `message/raf.js` (scan statis pemakaian).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const {
    GLOBAL_COMMANDS,
    isStateBreakingCommand,
    isDataCollectingState,
    shouldBreakState,
    resolveGlobalCommandStatus
} = require('../raf-interceptors');

const rafSource = fs.readFileSync(path.join(__dirname, '..', '..', 'raf.js'), 'utf8');

describe('isStateBreakingCommand: hanya perintah global eksplisit yang memutus wizard', () => {
    test('perintah global eksplisit TETAP bisa keluar dari wizard (pemakai tak boleh terjebak)', () => {
        for (const cmd of GLOBAL_COMMANDS) {
            expect(isStateBreakingCommand(cmd)).toBe(true);
        }
        expect(isStateBreakingCommand('MENU')).toBe(true);
        expect(isStateBreakingCommand('  menu  ')).toBe(true);
    });

    test('jawaban yang DIAJARKAN bot di tengah wizard tidak lagi membunuh sesi', () => {
        // Persis kalimat yang dicetak bot sendiri di alur PSB dan alur titik-lokasi.
        expect(isStateBreakingCommand('cari HWTC49B734AD')).toBe(false);
        expect(isStateBreakingCommand('lokasi budi')).toBe(false);
    });

    test('isi keluhan/jawaban pelanggan yang kebetulan cocok keyword tetap aman', () => {
        expect(isStateBreakingCommand('internet mati dari kemarin sore')).toBe(false);
        expect(isStateBreakingCommand('bayar sudah saya transfer')).toBe(false);
        expect(isStateBreakingCommand('Paket: 110k')).toBe(false);
    });

    test('perintah global harus KATA PERTAMA — tidak terpicu bila hanya disebut di tengah kalimat', () => {
        expect(isStateBreakingCommand('tolong buka menu dong')).toBe(false);
        expect(isStateBreakingCommand('menu dong')).toBe(true);
    });

    test('input kosong/aneh tidak pernah dianggap perintah global', () => {
        expect(isStateBreakingCommand('')).toBe(false);
        expect(isStateBreakingCommand(null)).toBe(false);
        expect(isStateBreakingCommand(undefined)).toBe(false);
    });

    test('resolveGlobalCommandStatus SENGAJA tetap longgar — maknanya untuk hilir tidak diubah', () => {
        // Hilir memakainya dengan arti "pesan ini kelihatan seperti perintah, bukan jawaban state"
        // (mis. state-domains/payment-proof-admin). Mempersempitnya akan mengubah perilaku lain.
        const status = resolveGlobalCommandStatus({
            chats: 'cari HWTC49B734AD',
            isInProtectedState: false,
            getIntentFromKeywords: () => ({ intent: 'CARI_PELANGGAN' })
        });
        expect(status).toBe(true);
    });
});

describe('shouldBreakState: sempit HANYA di wizard pengumpul data', () => {
    test('wizard pengumpul data KEBAL keyword — ini bug aslinya', () => {
        // `cari <SN>` & `lokasi <nama>` justru diajarkan bot sendiri di alur ini.
        expect(shouldBreakState({ chats: 'cari HWTC49B734AD', step: 'PSB_CONFIRM_MODEM', isGlobalCommand: true })).toBe(false);
        expect(shouldBreakState({ chats: 'lokasi budi', step: 'CUSTLOC_PICK', isGlobalCommand: true })).toBe(false);
        expect(shouldBreakState({ chats: 'internet mati dari kemarin', step: 'AWAITING_COMPLAINT', isGlobalCommand: true })).toBe(false);
        expect(shouldBreakState({ chats: 'internet mati', step: 'AUTO_OUTAGE_TRIAGE', isGlobalCommand: true })).toBe(false);
    });

    test('state PILIHAN BERNOMOR tetap berperilaku seperti semula — mengetik ulang perintah memulai ulang wizard', () => {
        // Regresi yang sempat saya perkenalkan: menahan state di sini membuat perintah yang SAH
        // dijawab "Pilihan tidak valid" dan wizard tak pernah dimulai ulang.
        expect(shouldBreakState({ chats: 'ganti nama wifi', step: 'SELECT_CHANGE_MODE', isGlobalCommand: true })).toBe(true);
        expect(shouldBreakState({ chats: 'cek tagihan', step: 'REPORT_MENU', isGlobalCommand: true })).toBe(true);
    });

    test('perintah global eksplisit memutus di MANA PUN, termasuk di wizard data', () => {
        expect(shouldBreakState({ chats: 'menu', step: 'PSB_COLLECT_DOCS', isGlobalCommand: false })).toBe(true);
        expect(shouldBreakState({ chats: 'menuwifi', step: 'PSB_CONFIRM_MODEM', isGlobalCommand: false })).toBe(true);
        expect(shouldBreakState({ chats: 'bantuan', step: 'CUSTLOC_PICK', isGlobalCommand: false })).toBe(true);
    });

    test('bukan perintah & bukan keyword → tak pernah memutus', () => {
        expect(shouldBreakState({ chats: 'Krajan', step: 'PSB_COLLECT_DOCS', isGlobalCommand: false })).toBe(false);
        expect(shouldBreakState({ chats: '2', step: 'SELECT_CHANGE_MODE', isGlobalCommand: false })).toBe(false);
    });

    test('isDataCollectingState mengenali prefix wizard, bukan state pilihan', () => {
        expect(isDataCollectingState('PSB_PICK_MODEM')).toBe(true);
        expect(isDataCollectingState('PSBJADWAL_COLLECT')).toBe(true);
        expect(isDataCollectingState('ASSET_ODP_NAMA')).toBe(true);
        expect(isDataCollectingState('AWAITING_COMPLAINT')).toBe(true);
        expect(isDataCollectingState('SELECT_CHANGE_MODE')).toBe(false);
        expect(isDataCollectingState('REPORT_MENU')).toBe(false);
        expect(isDataCollectingState(undefined)).toBe(false);
    });
});

describe('message/raf.js memakai gerbang shouldBreakState di ketiga titik', () => {
    test('tidak ada lagi penghapusan state yang dipicu isGlobalCommand longgar secara langsung', () => {
        expect(rafSource).not.toMatch(/if\s*\(\s*smartReportState\s*&&\s*isGlobalCommand\s*&&/);
        expect(rafSource).not.toMatch(/if\s*\(\s*userState\?\.step\s*&&\s*isGlobalCommand\s*&&/);
    });

    test('ketiga titik memakai shouldBreakState dengan step yang relevan', () => {
        const pakai = rafSource.match(/shouldBreakState\(\{/g) || [];
        expect(pakai.length).toBe(3);
        expect(rafSource).toMatch(/shouldBreakState\(\{\s*chats,\s*step:\s*smartReportState\.step/);
        expect(rafSource).toMatch(/shouldBreakState\(\{\s*chats,\s*step:\s*userState\.step/);
    });

    test('routeManagedState memakai gerbang yang SAMA — kalau tidak, state bertahan tapi handler-nya dilewati', () => {
        const idx = rafSource.indexOf('routeManagedState({');
        expect(idx).toBeGreaterThan(-1);
        const blok = rafSource.slice(idx, idx + 900);
        expect(blok).toMatch(/isGlobalCommand:\s*shouldBreakState\(\{/);
    });

    test('varian perintah MENU dari katalog live ikut memutus state', () => {
        // `menuwifi`/`menuteknisi`/`menuowner` adalah keyword nyata; pemakai yang mengetiknya
        // jelas minta keluar, jadi tak boleh tersangkut di wizard.
        expect(isStateBreakingCommand('menuwifi')).toBe(true);
        expect(isStateBreakingCommand('menuteknisi')).toBe(true);
        expect(isStateBreakingCommand('menuowner')).toBe(true);
        expect(isStateBreakingCommand('menu wifi')).toBe(true);
        // Tapi kata biasa yang kebetulan berawalan sama tetap tidak boleh ikut.
        expect(isStateBreakingCommand('mati total')).toBe(false);
    });

    test('pemutusan sengaja TIDAK menambah ack — pemakai tak menerima dua pesan untuk satu perintah', () => {
        const idxHapus = rafSource.indexOf('broke out of state with command');
        expect(idxHapus).toBeGreaterThan(-1);
        const cuplikan = rafSource.slice(idxHapus, idxHapus + 400);
        expect(cuplikan).toContain('deleteUserState');
        // Perintah yang memutus state selalu punya jawabannya sendiri (menu/bantuan/saldo…).
        expect(cuplikan).not.toMatch(/await\s+reply\(/);
    });

    test('kegagalan senyap ditutup di PEMILIK state: sesi PSB hilang wajib dibalas', () => {
        // Ini keluhan aslinya — teknisi kehilangan sesi PSB dan bot bisu total.
        const psbSrc = fs.readFileSync(
            path.join(__dirname, '..', 'state-domains', 'psb.state.js'),
            'utf8'
        );
        const idx = psbSrc.indexOf('if (!ctx || !ctx.data)');
        expect(idx).toBeGreaterThan(-1);
        const blok = psbSrc.slice(idx, idx + 700);
        expect(blok).toMatch(/safeReply\(/);
        expect(blok).toMatch(/#PSB/);
        // Tidak boleh kembali ke bentuk lama: handled:true tanpa balasan apa pun.
        expect(blok).not.toMatch(/if\s*\(!ctx\s*\|\|\s*!ctx\.data\)\s*\{\s*deleteUserState\([^)]*\);\s*return\s*\{\s*handled:\s*true\s*\};\s*\}/);
    });
});
