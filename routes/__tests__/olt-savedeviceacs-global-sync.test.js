/**
 * Header Doc
 * Purpose: Mengunci #b336 — saveDeviceAcs (routes/olt-provisioning.js) WAJIB memperbarui salinan
 *   in-memory `global.config` setelah menulis config.json. Tanpa itu, penulis config lain yang
 *   menyerialkan global.config apa adanya ke disk (mis. upload logo / simpan invoice) akan
 *   MENGHAPUS field `acs` yang baru ditulis — bahaya 'config.json merge-key' antar-penulis in-proses.
 * Caller: Jest.
 * Deps: baca sumber routes/olt-provisioning.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'olt-provisioning.js'), 'utf8');

describe('saveDeviceAcs sinkron ke global.config (#b336)', () => {
    const i = src.indexOf('function saveDeviceAcs(');
    const blk = i > -1 ? src.slice(i, i + 1200) : '';

    test('menulis config.json (persist)', () => {
        expect(blk).toMatch(/writeFileSync\(configPath/);
    });

    test('JUGA memperbarui global.config.olt.devices in-memory (anti clobber)', () => {
        expect(blk).toMatch(/global\.config[\s\S]*olt[\s\S]*devices/);
        expect(blk).toMatch(/memDev\.acs\s*=/);
    });
});
