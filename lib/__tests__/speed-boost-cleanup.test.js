/**
 * Header Doc
 * Purpose: Kunci #b320 — cleanupSpeedBoostRequests TIDAK boleh menstempel request 'active' menjadi
 *   'expired' (dulu memutus jalur revert profil speed-revert → boost gratis permanen). Cleanup hanya
 *   merapikan 'pending' tua & 'reverted' tua.
 * Caller: Jest.
 * Deps: spy `fs` (baca/tulis speed_requests.json).
 * SideEffects: -
 */
'use strict';

const fs = require('fs');
const { cleanupSpeedBoostRequests } = require('../speed-boost-cleanup');

const iso = (ms) => new Date(Date.now() + ms).toISOString();

describe('cleanupSpeedBoostRequests', () => {
    let written;
    beforeEach(() => {
        written = null;
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'writeFileSync').mockImplementation((_p, data) => { written = JSON.parse(data); });
    });
    afterEach(() => jest.restoreAllMocks());

    test('request ACTIVE yang sudah lewat tempo TETAP active (biar speed-revert yang revert profil)', () => {
        jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify([
            { id: 'r1', status: 'active', expirationDate: iso(-60 * 60 * 1000), userId: '5' }, // lewat 1 jam
        ]));
        cleanupSpeedBoostRequests();
        // Tak ada perubahan → tak menulis (cleanedCount 0). Kalaupun menulis, statusnya TETAP active.
        if (written) expect(written[0].status).toBe('active');
        else expect(written).toBeNull();
    });

    test("pending >7 hari → cancelled_auto (fungsi cleanup yang sah tetap jalan)", () => {
        jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify([
            { id: 'r2', status: 'pending', createdAt: iso(-8 * 24 * 60 * 60 * 1000) },
        ]));
        cleanupSpeedBoostRequests();
        expect(written[0].status).toBe('cancelled_auto');
    });
});
