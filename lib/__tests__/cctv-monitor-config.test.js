/**
 * Header Doc
 * Purpose: Test helper pengaturan monitor CCTV — validasi/merge patch config + tampilan publik.
 * Caller: jest.
 * Deps: ../cctv-monitor-config.
 */
'use strict';

const { buildCctvConfigPatch, toPublicView } = require('../cctv-monitor-config');

describe('cctv-monitor-config', () => {
    test('coerce enabled & notifyRecovery dari string/boolean', () => {
        expect(buildCctvConfigPatch({}, { enabled: 'true' }).enabled).toBe(true);
        expect(buildCctvConfigPatch({}, { enabled: false }).enabled).toBe(false);
        expect(buildCctvConfigPatch({}, { notifyRecovery: 'true' }).notifyRecovery).toBe(true);
        expect(buildCctvConfigPatch({}, { notifyRecovery: false }).notifyRecovery).toBe(false);
    });

    test('confirmationMinutes valid di-parse jadi integer', () => {
        expect(buildCctvConfigPatch({}, { confirmationMinutes: '20' }).confirmationMinutes).toBe(20);
        expect(buildCctvConfigPatch({}, { confirmationMinutes: 5 }).confirmationMinutes).toBe(5);
    });

    test('confirmationMinutes di luar 1..1440 → throw', () => {
        expect(() => buildCctvConfigPatch({}, { confirmationMinutes: 0 })).toThrow(/Window konfirmasi/);
        expect(() => buildCctvConfigPatch({}, { confirmationMinutes: 2000 })).toThrow(/Window konfirmasi/);
        expect(() => buildCctvConfigPatch({}, { confirmationMinutes: 'abc' })).toThrow(/Window konfirmasi/);
    });

    test('field yang tidak dikirim dipertahankan (partial update)', () => {
        const cur = { enabled: true, confirmationMinutes: 15, notifyRecovery: true, pollIntervalMs: 60000 };
        const next = buildCctvConfigPatch(cur, { enabled: false });
        expect(next.enabled).toBe(false);
        expect(next.confirmationMinutes).toBe(15);
        expect(next.notifyRecovery).toBe(true);
        expect(next.pollIntervalMs).toBe(60000); // field non-esensial tak hilang
    });

    test('confirmationMinutes kosong/undefined tidak mengubah nilai lama', () => {
        const cur = { confirmationMinutes: 30 };
        expect(buildCctvConfigPatch(cur, { confirmationMinutes: '' }).confirmationMinutes).toBe(30);
        expect(buildCctvConfigPatch(cur, {}).confirmationMinutes).toBe(30);
    });

    test('toPublicView menerapkan default (enabled false, notifyRecovery true)', () => {
        const v = toPublicView({});
        expect(v.enabled).toBe(false);
        expect(v.notifyRecovery).toBe(true);
        expect(typeof v.confirmationMinutes).toBe('number');
    });

    test('toPublicView mencerminkan nilai yang diset', () => {
        const v = toPublicView({ enabled: true, confirmationMinutes: 10, notifyRecovery: false });
        expect(v.enabled).toBe(true);
        expect(v.confirmationMinutes).toBe(10);
        expect(v.notifyRecovery).toBe(false);
    });

    test('buildCctvConfigPatch menyimpan template pesan down/up', () => {
        const next = buildCctvConfigPatch({}, { messageDown: 'CCTV {cctv_name} mati', messageUp: 'CCTV {cctv_name} pulih' });
        expect(next.messageDown).toBe('CCTV {cctv_name} mati');
        expect(next.messageUp).toBe('CCTV {cctv_name} pulih');
    });

    test('toPublicView: pesan kosong → default bawaan, pesan kustom → dipakai', () => {
        const def = toPublicView({});
        expect(typeof def.messageDown).toBe('string');
        expect(def.messageDown.length).toBeGreaterThan(0); // default bawaan non-kosong
        const custom = toPublicView({ messageDown: 'X', messageUp: '   ' });
        expect(custom.messageDown).toBe('X');
        expect(custom.messageUp).toBe(def.messageUp); // whitespace-only → fallback default
    });

    test('buildCctvConfigPatch merge sub-config netwatch (partial, pertahankan field lain)', () => {
        const cur = { enabled: true, netwatch: { botToken: 'T', chatId: 'C', interval: '5s' } };
        const next = buildCctvConfigPatch(cur, { netwatch: { chatId: '-99' } });
        expect(next.netwatch.botToken).toBe('T');   // dipertahankan
        expect(next.netwatch.chatId).toBe('-99');    // diupdate
        expect(next.netwatch.interval).toBe('5s');
        expect(next.enabled).toBe(true);             // field flat lain tak terganggu
    });

    test('toPublicView netwatch terisi default bila belum di-set', () => {
        const v = toPublicView({});
        expect(v.netwatch).toBeDefined();
        expect(v.netwatch.interval).toBe('5s');
        expect(v.netwatch.botToken).toBe('');
        expect(typeof v.netwatch.msgUp).toBe('string');
        expect(v.netwatch.msgUp.length).toBeGreaterThan(0);
    });

    test('mass-outage: threshold valid di-parse, kosong→0, di luar range throw', () => {
        expect(buildCctvConfigPatch({}, { massOutageThreshold: '5' }).massOutageThreshold).toBe(5);
        expect(buildCctvConfigPatch({ massOutageThreshold: 5 }, { massOutageThreshold: '' }).massOutageThreshold).toBe(0);
        expect(() => buildCctvConfigPatch({}, { massOutageThreshold: 9999 })).toThrow(/gangguan massal/i);
        expect(buildCctvConfigPatch({}, { massOutageAdminPhone: ' 628999 ' }).massOutageAdminPhone).toBe('628999');
    });

    test('toPublicView memuat field mass-outage (default 0 + template bawaan)', () => {
        const v = toPublicView({});
        expect(v.massOutageThreshold).toBe(0);
        expect(v.massOutageAdminPhone).toBe('');
        expect(typeof v.messageMassOutage).toBe('string');
        expect(v.messageMassOutage.length).toBeGreaterThan(0);
    });
});
