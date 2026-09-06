/**
 * Header Doc
 * Purpose: Mengunci #b343 — (a) SEMUA penulis config.json menulis ATOMIK (writeFileAtomicSync),
 *   bukan fs.writeFileSync langsung (torn-write → config.json terpotong → bot gagal boot total);
 *   (b) invoice.js membaca config SEGAR dari disk + saveConfigAtomic (bukan menyerialkan global.config
 *   boot yang basi → menghapus subkey hand-edit/penulis lain pasca-boot; sisi PENULIS landmine #b336).
 * Caller: Jest.
 * Deps: baca sumber routes/lib penulis config.json.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Semua penulis config.json (config.json = berkas config utama boot-critical; speed_boost_matrix &
// commands.json TIDAK termasuk — berkas terpisah, tak menjatuhkan boot).
const CONFIG_WRITERS = [
    'routes/admin-config-routes.js',
    'routes/admin-los-broadcast-routes.js',
    'routes/admin-personal-finance-routes.js',
    'routes/admin-telegram-teknisi-routes.js',
    'routes/admin-wifi-ops-routes.js',
    'routes/admin-kas-usaha-routes.js',
    'routes/admin-csat-routes.js',
    'routes/cctv.js',
    'routes/olt-provisioning.js',
    'routes/olt.js',
    'routes/invoice.js',
    'lib/olt-backup.js',
    'lib/upstream-config-service.js',
];

describe('penulis config.json tulis ATOMIK (#b343)', () => {
    for (const f of CONFIG_WRITERS) {
        test(`${f}: tak ada fs.writeFileSync langsung ke config.json`, () => {
            const src = read(f);
            // Cari fs.writeFileSync yang menyasar path config utama (bukan speed_boost/commands/DB lain).
            const re = /fs\.writeFileSync\(\s*([A-Za-z0-9_.]+)\s*,/g;
            let m;
            const offenders = [];
            while ((m = re.exec(src)) !== null) {
                const target = m[1];
                if (/config[Pp]ath|CONFIG_PATH|MAIN_CONFIG_PATH|cfgPath|^p$/.test(target)) offenders.push(target);
            }
            expect(offenders).toEqual([]);
        });
    }

    test('invoice.js: baca config SEGAR (readConfigFresh) + tulis saveConfigAtomic, TIDAK serialkan global.config', () => {
        const src = read('routes/invoice.js');
        expect(src).toMatch(/readConfigFresh\(\)/);
        expect(src).toMatch(/saveConfigAtomic\(/);
        // Pola lama yang menghapus subkey lain: menyerialkan global.config apa adanya ke config.json.
        expect(src).not.toMatch(/writeFileSync\(\s*['"]\.\/config\.json['"]/);
        expect(src).not.toMatch(/JSON\.stringify\(\s*global\.config/);
    });
});
