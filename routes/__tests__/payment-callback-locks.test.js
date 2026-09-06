/**
 * Header Doc
 * Purpose: Kunci #b321 — jalur uang check-then-act kini SERIALISASI per-key: /advance (prabayar)
 *   withLock('advance-payment-...'), callback Tripay & Mayar acquireLock('bill-callback-...') +
 *   re-check checkStatusPayment DALAM lock + release di finally (anti double-credit dari klik ganda /
 *   webhook duplikat). Mencegah regresi ke pola "tambal iPaymu saja, lupa jalur paralel".
 * Caller: Jest.
 * Deps: baca sumber routes/payment-status.js + routes/bill-payment.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const AKAR = path.join(__dirname, '..', '..');
const ps = fs.readFileSync(path.join(AKAR, 'routes', 'payment-status.js'), 'utf8');
const bp = fs.readFileSync(path.join(AKAR, 'routes', 'bill-payment.js'), 'utf8');

describe('serialisasi jalur uang (#b321)', () => {
    test('/advance dibungkus withLock per-user (mirror partial-payment)', () => {
        expect(ps).toMatch(/withLock\(`advance-payment-\$\{user\.id\}`/);
    });

    test('callback Tripay: acquireLock bill-callback + re-check dalam lock + release', () => {
        const blk = bp.slice(bp.indexOf('router.post("/callback/tripay"'), bp.indexOf('router.post("/callback/mayar"'));
        expect(blk).toMatch(/acquireLock\(`bill-callback-\$\{merchantRef\}`/);
        // checkStatusPayment dipanggil >=2x: cepat di awal + re-check SETELAH memegang lock.
        expect((blk.match(/checkStatusPayment\(merchantRef\)/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(blk).toMatch(/releaseLock\(`bill-callback-/);
    });

    test('callback Mayar: acquireLock bill-callback + re-check + release', () => {
        const blk = bp.slice(bp.indexOf('router.post("/callback/mayar"'));
        expect(blk).toMatch(/acquireLock\(`bill-callback-\$\{pay\.reffId\}`/);
        expect((blk.match(/checkStatusPayment\(pay\.reffId\)/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(blk).toMatch(/releaseLock\(`bill-callback-/);
    });
});
