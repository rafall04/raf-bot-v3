/**
 * Header Doc
 * Purpose: Mengunci #b338b/#b339 — id device OLT baru WAJIB unik. Dulu `olt${length+1}` bentrok
 *   setelah hapus device tengah (splice tanpa renumber) → dua device ber-id sama → lookup first-match
 *   kena OLT fisik SALAH (kredensial ACS/SSH/provisioning nyasar; sebagian OLT milik teman/VANS).
 * Caller: Jest.
 * Deps: routes/olt.js (nextOltDeviceId diekspos di router).
 * SideEffects: -
 */
'use strict';
const { nextOltDeviceId } = require('../olt');

describe('nextOltDeviceId — id unik (#b339)', () => {
    test('kosong → olt1', () => {
        expect(nextOltDeviceId([])).toBe('olt1');
        expect(nextOltDeviceId(null)).toBe('olt1');
    });

    test('berurutan → suffix tertinggi + 1', () => {
        expect(nextOltDeviceId([{ id: 'olt1' }, { id: 'olt2' }, { id: 'olt3' }])).toBe('olt4');
    });

    test('!! hapus device TENGAH → id baru TIDAK bentrok dengan yang tersisa', () => {
        // [olt1, olt3] (olt2 dihapus). length+1 lama = olt3 (BENTROK). Harus olt4.
        expect(nextOltDeviceId([{ id: 'olt1' }, { id: 'olt3' }])).toBe('olt4');
    });

    test('hanya olt tertinggi yang dihitung (gap di bawah tak dipakai ulang)', () => {
        expect(nextOltDeviceId([{ id: 'olt5' }])).toBe('olt6'); // bukan olt1/olt2
    });

    test('abaikan id non-standar + tetap unik', () => {
        expect(nextOltDeviceId([{ id: 'zte-teman' }, { id: 'olt2' }])).toBe('olt3');
    });

    test('tak pernah memulangkan id yang sudah ada (loop anti-tabrak)', () => {
        const devices = [{ id: 'olt1' }, { id: 'olt2' }, { id: 'olt3' }, { id: 'olt4' }];
        const next = nextOltDeviceId(devices);
        expect(devices.map((d) => d.id)).not.toContain(next);
        expect(next).toBe('olt5');
    });
});
