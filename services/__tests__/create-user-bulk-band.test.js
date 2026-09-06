/**
 * Header Doc
 * Purpose: Kunci #b327 — prepareNewUser mengisi `bulk` dari `ssid_indices` (kapabilitas band terdeteksi)
 *   SEBELUM jatuh ke default SSID tunggal. Modem DUAL-BAND firstRead-sukses dikirim ssid_indices=["1","5"]
 *   tanpa `bulk`; tanpa fallback ini bulk default ["1"] → ganti WiFi cuma sentuh 2.4GHz, 5GHz warisi
 *   WiFi pemilik lama (modem bekas).
 * Caller: Jest.
 * Deps: baca sumber services/api-users/create-user-validate.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api-users', 'create-user-validate.js'), 'utf8');

describe('create-user bulk band fallback (#b327)', () => {
    test('bulk dicoba dari ssid_indices DULU, baru default SSID tunggal', () => {
        const idxSsid = src.indexOf('userData.ssid_indices');
        const idxDefault = src.indexOf('defaultBulkSSID');
        expect(idxSsid).toBeGreaterThan(-1);
        expect(idxDefault).toBeGreaterThan(-1);
        expect(idxSsid).toBeLessThan(idxDefault); // ssid_indices dicek sebelum fallback default
        expect(src).toMatch(/bulkData = userData\.ssid_indices\.map\(String\)/);
    });
});
