/**
 * Header Doc
 * Purpose: Mengunci kunci kecepatan yang dibaca untuk teks PELANGGAN. `database/packages.json`
 *          memakai camelCase `displayProfile` ("Up To 10Mbps"); membaca `display_profile` (snake)
 *          selalu undefined sehingga jatuh ke `pkg.profile` — NAMA PROFIL MIKROTIK. Akibatnya
 *          pelanggan diberi tahu angka yang bukan produk yang dijual, dan konsisten LEBIH TINGGI
 *          (terukur di produksi: "16Mbps" untuk paket "Up To 10Mbps" — over-promise 60%).
 *          Dua jalur terdampak: pesan selamat datang mode import, dan BROADCAST MASSAL.
 * Caller: Jest (`npx jest services/__tests__/display-profile-key.test.js`).
 * Deps: fs/path (scan statis kedua sumber).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const JALUR = [
    ['welcome mode import', ['services', 'api-users', 'create-user-persist.js']],
    ['broadcast massal', ['services', 'admin-broadcast.service.js']]
];

describe('kecepatan yang dibaca pelanggan memakai kunci yang BENAR-BENAR ada di packages.json', () => {
    test('katalog repo memang memakai camelCase (premis temuan)', () => {
        const raw = JSON.parse(baca('database', 'packages.json'));
        const list = Array.isArray(raw) ? raw : raw.packages || [];
        const berbayar = list.filter((p) => Number.parseInt(p.price, 10) > 0);
        expect(berbayar.length).toBeGreaterThan(0);
        // Minimal satu paket berbayar punya displayProfile, dan TIDAK ada yang pakai snake_case.
        expect(berbayar.some((p) => p.displayProfile)).toBe(true);
        expect(berbayar.some((p) => p.display_profile)).toBe(false);
    });

    test.each(JALUR)('%s mendahulukan displayProfile (camelCase)', (_label, segments) => {
        const src = baca(...segments);
        expect(src).toMatch(/pkg\.displayProfile\s*\|\|/);
    });

    test.each(JALUR)('%s tidak lagi membaca snake_case LEBIH DULU', (_label, segments) => {
        const src = baca(...segments);
        // Bentuk lama: `pkg.display_profile || pkg.profile` tanpa camelCase di depannya.
        expect(src).not.toMatch(/(?<!displayProfile\s\|\|\s)pkg\.display_profile\s*\|\|\s*pkg\.profile/);
    });

    test('urutan fallback: camelCase → snake (katalog lama) → profile MikroTik', () => {
        const pilih = (pkg) => pkg.displayProfile || pkg.display_profile || pkg.profile;
        expect(pilih({ displayProfile: 'Up To 10Mbps', profile: '16Mbps' })).toBe('Up To 10Mbps');
        expect(pilih({ display_profile: 'Up To 20Mbps', profile: '22Mbps' })).toBe('Up To 20Mbps');
        expect(pilih({ profile: '35Mbps' })).toBe('35Mbps');
    });
});
