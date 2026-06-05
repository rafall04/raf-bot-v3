/**
 * Guardrail null-safety untuk jid-utils — audit #4 (anti-crash sender/@lid).
 *
 * Crash null phone_number/@lid berulang di riwayat (fix 9e8fa52, bd287bc).
 * Test ini mengunci kontrak: leaf helper resolusi sender TIDAK BOLEH throw saat
 * diberi input null/undefined/malformed — harus return nilai aman (null/[]/shape valid).
 * Kalau ada yang menghapus guard, test merah sebelum sampai produksi.
 */
"use strict";

const jid = require('../jid-utils');

describe('jid-utils null-safety (anti-crash)', () => {
    describe('normalizePhoneNumber', () => {
        test('null/undefined/empty → null, tidak throw', () => {
            expect(() => jid.normalizePhoneNumber(null)).not.toThrow();
            expect(jid.normalizePhoneNumber(null)).toBeNull();
            expect(jid.normalizePhoneNumber(undefined)).toBeNull();
            expect(jid.normalizePhoneNumber('')).toBeNull();
        });
        test('format valid dinormalisasi ke 62', () => {
            expect(jid.normalizePhoneNumber('08123456789')).toBe('628123456789');
            expect(jid.normalizePhoneNumber('628123456789')).toBe('628123456789');
        });
    });

    describe('extractPhoneFromJid', () => {
        test('null/undefined → null, tidak throw', () => {
            expect(() => jid.extractPhoneFromJid(null)).not.toThrow();
            expect(jid.extractPhoneFromJid(null)).toBeNull();
            expect(jid.extractPhoneFromJid(undefined)).toBeNull();
        });
        test('JID standar & @lid → bagian sebelum @/: ', () => {
            expect(jid.extractPhoneFromJid('628123@s.whatsapp.net')).toBe('628123');
            expect(jid.extractPhoneFromJid('12345@lid')).toBe('12345');
            expect(jid.extractPhoneFromJid('628123:0@s.whatsapp.net')).toBe('628123');
        });
    });

    describe('normalizePhoneToJid', () => {
        test('null/undefined → null, tidak throw', () => {
            expect(() => jid.normalizePhoneToJid(null)).not.toThrow();
            expect(jid.normalizePhoneToJid(null)).toBeNull();
            expect(jid.normalizePhoneToJid('')).toBeNull();
        });
    });

    describe('maskPhoneNumber', () => {
        test('null/undefined tidak throw', () => {
            expect(() => jid.maskPhoneNumber(null)).not.toThrow();
            expect(() => jid.maskPhoneNumber(undefined)).not.toThrow();
        });
    });

    describe('isLidJid', () => {
        test('null/undefined/non-lid tidak throw', () => {
            expect(() => jid.isLidJid(null)).not.toThrow();
            expect(jid.isLidJid(null)).toBe(false);
            expect(jid.isLidJid('12345@lid')).toBe(true);
            expect(jid.isLidJid('628@s.whatsapp.net')).toBe(false);
        });
    });

    describe('extractSenderInfo', () => {
        test('msg null/tanpa key → shape valid, method=invalid, tidak throw', () => {
            expect(() => jid.extractSenderInfo(null)).not.toThrow();
            expect(() => jid.extractSenderInfo({})).not.toThrow();
            const r = jid.extractSenderInfo({});
            expect(r).toMatchObject({ originalSender: null, isLid: false, phoneNumber: null, method: 'invalid' });
        });
        test('msg standar → originalSender = remoteJid', () => {
            const r = jid.extractSenderInfo({ key: { remoteJid: '628123@s.whatsapp.net' }, pushName: 'Budi' });
            expect(r.originalSender).toBe('628123@s.whatsapp.net');
            expect(r.isLid).toBe(false);
            expect(r.pushname).toBe('Budi');
        });
        test('msg @lid dengan remoteJidAlt → resolve phoneNumber', () => {
            const r = jid.extractSenderInfo({
                key: { remoteJid: '12345@lid', remoteJidAlt: '628999@s.whatsapp.net' }
            });
            expect(r.isLid).toBe(true);
            expect(r.phoneNumber).toBe('628999');
            expect(r.method).toBe('remoteJidAlt');
        });
    });
});
