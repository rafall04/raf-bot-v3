/**
 * Header Doc
 * Purpose: Mengunci perbaikan "wizard PSB bisa mendaratkan pelanggan berbayar ke paket Rp0".
 *          `resolvePackage` dulu memakai fuzzy dua arah (`v.includes(n) || n.includes(v)`), sehingga
 *          `30Mbps` — displayProfile paket Rp165.000, angka yang paling sering diucapkan pelanggan —
 *          mendarat di PAKET-KHUSUS-30Mbps berharga Rp0 yang whitelist (kebal reminder & isolir).
 *          Pelanggan itu lalu tak pernah tertagih, tiap bulan, tanpa satu pun alarm.
 * Caller: Jest (`npx jest message/handlers/__tests__/psb-package-zero-billing.test.js`).
 * Deps: `../psb-caption-parser` (resolvePackage) + `database/packages.json` NYATA (terlacak git).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const { resolvePackage } = require('../psb-caption-parser');
const packagesRaw = require('../../../database/packages.json');

const PACKAGES = Array.isArray(packagesRaw) ? packagesRaw : packagesRaw.packages || [];

function cari(nama) {
    return PACKAGES.find((p) => p.name === nama) || null;
}
function berbayar(nama) {
    const p = cari(nama);
    return !!p && p.whitelist !== true && Number.parseInt(p.price, 10) > 0;
}

describe('resolvePackage: tebakan tidak boleh mendarat di paket tanpa tagihan', () => {
    test('katalog uji memang memuat paket Rp0 (kalau tidak, test ini tak membuktikan apa-apa)', () => {
        const gratis = PACKAGES.filter((p) => p.whitelist === true || Number.parseInt(p.price, 10) <= 0);
        expect(gratis.length).toBeGreaterThan(0);
    });

    test.each([['10Mbps'], ['30Mbps'], ['12Mbps']])(
        'angka kecepatan "%s" mendarat di paket BERBAYAR, bukan paket gratis',
        (input) => {
            const hasil = resolvePackage(input, PACKAGES);
            expect(hasil).not.toBeNull();
            expect(berbayar(hasil)).toBe(true);
        }
    );

    test('"30Mbps" spesifik → paket Rp165.000 (dulu ke PAKET-KHUSUS-30Mbps Rp0)', () => {
        const hasil = resolvePackage('30Mbps', PACKAGES);
        expect(cari(hasil).price).toBe(165000);
    });

    test('kata yang hanya cocok ke paket gratis lewat FUZZY ditolak — wizard menagih ulang', () => {
        expect(resolvePackage('voucher', PACKAGES)).toBeNull();
        expect(resolvePackage('free', PACKAGES)).toBeNull();
    });

    test('pendaftaran gratis yang DISENGAJA tetap bisa — lewat nama paket persis', () => {
        const gratis = PACKAGES.find((p) => p.whitelist === true || Number.parseInt(p.price, 10) <= 0);
        expect(resolvePackage(gratis.name, PACKAGES)).toBe(gratis.name);
        expect(resolvePackage(gratis.name.toLowerCase(), PACKAGES)).toBe(gratis.name);
    });

    test('nama paket berbayar & displayProfile tetap dikenali (tidak ada yang rusak)', () => {
        expect(resolvePackage('PAKET-110K', PACKAGES)).toBe('PAKET-110K');
        expect(resolvePackage('paket-110k', PACKAGES)).toBe('PAKET-110K');
        expect(berbayar(resolvePackage('110k', PACKAGES))).toBe(true);
        expect(berbayar(resolvePackage('Up To 10Mbps', PACKAGES))).toBe(true);
    });

    test('input kosong tetap null', () => {
        expect(resolvePackage('', PACKAGES)).toBeNull();
        expect(resolvePackage(null, PACKAGES)).toBeNull();
    });

    test('hasil AMBIGU tidak ditebak — lebih baik minta teknisi memperjelas', () => {
        const katalog = [
            { name: 'PAKET-A-20Mbps', price: 100000, profile: 'A20' },
            { name: 'PAKET-B-20Mbps', price: 200000, profile: 'B20' }
        ];
        expect(resolvePackage('20Mbps', katalog)).toBeNull();
    });
});
