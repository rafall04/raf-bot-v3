/**
 * Header Doc
 * Purpose: Kunci #b329 — /bulk-update ("Tandai Lunas", jalur kredit LIVE) menserialisasi tiap user
 *   dgn withLock(`payment-status-${userId}`), sama pola advance/partial (#b321). Dulu tak dikunci →
 *   dua request interleaved double-credit (pemasukan hantu #b254). Cegah regresi drift jalur saudara.
 * Caller: Jest.
 * Deps: baca sumber routes/payment-status.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'payment-status.js'), 'utf8');

describe('bulk-update per-user lock (#b329)', () => {
    test('/bulk-update kredit tiap user dibungkus withLock(payment-status-<userId>)', () => {
        const i = src.indexOf("router.post('/bulk-update'");
        const j = src.indexOf("router.get('/read-model'", i);
        expect(i).toBeGreaterThan(-1);
        expect(j).toBeGreaterThan(i);
        const blk = src.slice(i, j);
        expect(blk).toMatch(/withLock\(`payment-status-\$\{userId\}`/);
        expect(blk).toMatch(/applyPaymentStatusChange/);
    });
});
