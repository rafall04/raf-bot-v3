/**
 * Header Doc
 * Purpose: Kunci #b323 — handleInternetMati TIDAK memvonis modem OFFLINE saat bot cuma BUTA (ACS
 *   timeout/breaker/config-invalid → isDeviceOnline balas online:false/null tanpa _lastInform). OFFLINE
 *   hanya diklaim dgn bukti positif (_lastInform ada tapi basi); sisanya status netral "belum bisa
 *   dipastikan". Pola "cannot observe != observed bad" (#b261), sama seperti guard handleInternetLemot.
 * Caller: Jest.
 * Deps: baca sumber message/handlers/smart-report-text-menu.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'smart-report-text-menu.js'), 'utf8');

describe('handleMati: BUTA != MATI (#b323)', () => {
    test('OFFLINE hanya diklaim dgn bukti positif (online===false DAN lastInform)', () => {
        expect(src).toMatch(/deviceStatus\.online === false && deviceStatus\.lastInform/);
    });
    test('ada cabang status NETRAL "belum bisa dipastikan" untuk read buta', () => {
        expect(src).toMatch(/belum bisa dipastikan/);
    });
    test('tidak lagi vonis OFFLINE hanya dari online===false polos', () => {
        expect(src).not.toMatch(/else if \(deviceStatus\.online === false\)\s*\{/);
    });
});
