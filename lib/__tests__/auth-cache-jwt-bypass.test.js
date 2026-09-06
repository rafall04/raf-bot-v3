/**
 * Header Doc
 * Purpose: Kunci #b328 (P0 KEAMANAN) — AuthCache.getJWTVerification meng-cache verifikasi JWT dengan
 *   kunci sha256 TOKEN PENUH, bukan 50-char prefix. Dulu prefix-key → dua token beda-isi tapi
 *   prefix-sama berbagi entri cache → forge (prefix sama + sampah + tanda tangan INVALID) lolos sebagai
 *   admin tanpa jwt.verify pernah dipanggil (takeover). Uji: forge harus tetap memanggil verify.
 * Caller: Jest.
 * Deps: ../auth-cache.
 * SideEffects: -
 */
'use strict';
const { AuthCache } = require('../auth-cache');

// header JWT konstan (36) + '.' + awal payload (13) = 50 char pertama yang bisa ditebak.
const VALID = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiJ9.VALID_SIGNATURE_AAAAAAA';

describe('AuthCache getJWTVerification — anti JWT-prefix bypass (#b328 P0)', () => {
    let cache;
    beforeEach(() => { cache = new AuthCache(); cache.enabled = true; cache.clearAll(); });

    test('forge dgn 50-char prefix SAMA → tetap panggil verify (TAK dibypass cache), ditolak', () => {
        // prime cache dengan token admin SAH
        cache.getJWTVerification(VALID, () => ({ id: 1, username: 'admin', role: 'admin' }));
        // forge: prefix 50 char identik, sisanya sampah + tanda tangan invalid
        const forged = VALID.slice(0, 50) + 'FORGED_PAYLOAD_XYZ.INVALID_SIGNATURE';
        expect(forged.slice(0, 50)).toBe(VALID.slice(0, 50)); // prefix memang sama
        const verifyForged = jest.fn(() => { throw new Error('invalid signature'); });
        const hasil = cache.getJWTVerification(forged, verifyForged);
        expect(verifyForged).toHaveBeenCalledTimes(1); // verify DIPANGGIL (bukan dilewati cache prefix)
        expect(hasil).toBeNull();                        // forge ditolak
    });

    test('token SAMA persis → cache HIT (verify tak dipanggil lagi) — cache tetap berfungsi', () => {
        cache.getJWTVerification(VALID, () => ({ id: 1, username: 'admin' }));
        const v2 = jest.fn(() => ({ id: 1, username: 'admin' }));
        const hasil = cache.getJWTVerification(VALID, v2);
        expect(v2).not.toHaveBeenCalled();
        expect(hasil).toEqual({ id: 1, username: 'admin' });
    });
});
