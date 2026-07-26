/**
 * Header Doc
 * Purpose: Menguji penilai sukses perubahan WiFi supaya "payload kosong" tak pernah lagi lolos sebagai sukses.
 * Caller: `npm test` (jest).
 * Deps: `lib/wifi-apply-guard`, `lib/genieacs` (parseWifiPayload + updateWifiSettings).
 * MainFuncs: kontrak `isWifiChangeApplied` / `assertWifiChangeApplied` + kontrak empty-payload `updateWifiSettings`.
 * SideEffects: tidak ada (tanpa network; GenieACS tak pernah dihubungi karena payload kosong keluar lebih dulu).
 */
"use strict";

const { isWifiChangeApplied, assertWifiChangeApplied } = require('../wifi-apply-guard');

describe('isWifiChangeApplied', () => {
    test('ok + accepted + applied → sukses', () => {
        expect(isWifiChangeApplied({ ok: true, accepted: true, applied: true })).toBe(true);
    });

    test('applied:null tetap sukses (mode accept_task_only untuk sandi)', () => {
        expect(isWifiChangeApplied({ ok: true, accepted: true, applied: null })).toBe(true);
    });

    test('ok tanpa field accepted (mock/legacy) tetap sukses', () => {
        expect(isWifiChangeApplied({ ok: true })).toBe(true);
    });

    test('INTI REGRESI: ok:true tapi accepted:false = GAGAL, bukan sukses', () => {
        expect(isWifiChangeApplied({ ok: true, accepted: false, applied: null })).toBe(false);
    });

    test('applied:false (readback membuktikan tak mendarat) = gagal', () => {
        expect(isWifiChangeApplied({ ok: true, accepted: true, applied: false })).toBe(false);
    });

    test('ok:false = gagal', () => {
        expect(isWifiChangeApplied({ ok: false, accepted: true, applied: true })).toBe(false);
    });

    test('bentuk legacy {success} dihormati', () => {
        expect(isWifiChangeApplied({ success: true })).toBe(true);
        expect(isWifiChangeApplied({ success: false })).toBe(false);
    });

    test('nilai bukan objek = gagal', () => {
        expect(isWifiChangeApplied(null)).toBe(false);
        expect(isWifiChangeApplied(undefined)).toBe(false);
        expect(isWifiChangeApplied(true)).toBe(false);
    });
});

describe('assertWifiChangeApplied', () => {
    test('melempar dengan pesan dari perangkat saat gagal', () => {
        expect(() => assertWifiChangeApplied({ ok: true, accepted: false, message: 'Tidak ada perubahan yang dikirim karena tidak ada data baru.' }))
            .toThrow('Tidak ada perubahan yang dikirim karena tidak ada data baru.');
    });

    test('tidak melempar saat sukses', () => {
        expect(() => assertWifiChangeApplied({ ok: true, accepted: true, applied: true })).not.toThrow();
    });
});

describe('kontrak updateWifiSettings untuk payload kosong', () => {
    const { parseWifiPayload, updateWifiSettings } = require('../genieacs');

    test('payload kosong tidak menghasilkan perubahan', () => {
        expect(parseWifiPayload({}).hasChanges).toBe(false);
    });

    test('payload kosong balik ok:false — TIDAK boleh ok:true lagi', async () => {
        const result = await updateWifiSettings('DEVICE-KOSONG', {});
        expect(result.ok).toBe(false);
        expect(result.accepted).toBe(false);
        expect(result.errorCode).toBe('PARSE_ERROR');
        expect(isWifiChangeApplied(result)).toBe(false);
    });

    test('payload berisi field sandi kosong juga dianggap tak ada perubahan', async () => {
        const result = await updateWifiSettings('DEVICE-KOSONG', { ssid_password_1: '   ' });
        expect(result.ok).toBe(false);
        expect(isWifiChangeApplied(result)).toBe(false);
    });
});
