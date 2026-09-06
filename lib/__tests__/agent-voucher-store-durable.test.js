/**
 * Header Doc
 * Purpose: Mengunci #b341 — store finansial voucher-agent (inventory/purchases/sales) WAJIB dimuat
 *   TERPISAH lewat json-store (karantina berkas rusak, bukan []) & ditulis ATOMIK (tmp+rename).
 *   Dulu: 1 try/catch bungkus 3 JSON.parse mentah → inventory rusak → purchases/sales tak dimuat
 *   (tetap []) → penulisan berikutnya menimpa file valid dgn [] → 1 file korup = kehilangan 3 domain
 *   (saldo agent terpotong + kode voucher + komisi hilang permanen saat restart/OOM).
 * Caller: Jest.
 * Deps: baca sumber lib/agent-voucher-manager.js.
 * SideEffects: - (guard sumber; jaminan perilaku ada di json-store-tahan-korupsi.test.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'agent-voucher-manager.js'), 'utf8');

describe('store voucher-agent tahan korupsi & atomik (#b341)', () => {
    test('memuat KETIGA store lewat json-store.loadJSON (per-file, karantina)', () => {
        expect(src).toMatch(/loadJSON\(\s*['"]agent_voucher_inventory\.json['"]\s*\)/);
        expect(src).toMatch(/loadJSON\(\s*['"]agent_voucher_purchases\.json['"]\s*\)/);
        expect(src).toMatch(/loadJSON\(\s*['"]agent_voucher_sales\.json['"]\s*\)/);
    });

    test('menulis ATOMIK lewat json-store.saveJSON (bukan writeFileSync mentah)', () => {
        expect(src).toMatch(/saveJSON\(\s*['"]agent_voucher_inventory\.json['"]/);
        expect(src).toMatch(/saveJSON\(\s*['"]agent_voucher_purchases\.json['"]/);
        expect(src).toMatch(/saveJSON\(\s*['"]agent_voucher_sales\.json['"]/);
        // Tak ada lagi writeFileSync langsung ke store (jendela torn-write).
        expect(src).not.toMatch(/fs\.writeFileSync\(\s*(INVENTORY_DB|PURCHASES_DB|SALES_DB)/);
        expect(src).not.toMatch(/writeFileSync\([^)]*agent_voucher_/);
    });

    test('initDatabase TIDAK lagi membungkus 3 JSON.parse dalam SATU try/catch (anti kaskade)', () => {
        const i = src.indexOf('function initDatabase(');
        const j = src.indexOf('\nfunction ', i + 1);
        const blk = src.slice(i, j === -1 ? undefined : j);
        // Tak boleh ada JSON.parse mentah di init (semua lewat loadJSON yang never-throw + karantina).
        expect(blk).not.toMatch(/JSON\.parse\(/);
    });
});
