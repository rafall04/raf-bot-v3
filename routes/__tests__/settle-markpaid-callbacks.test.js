/**
 * Header Doc
 * Purpose: Mengunci #b344 — KETIGA callback gateway (iPaymu/Tripay/Mayar) mengoper `markPaid` ke
 *   settleTagihanPayment supaya transaksi ditandai LUNAS sebelum reaktivasi lambat (>30s). Tanpa ini
 *   webhook retry yang lolos lock (cleanup 30s) salah-vonis 'kelebihan bayar' + pesan ganda ke
 *   pelanggan bayar-sekali. Cegah drift jalur saudara (satu callback lupa markPaid).
 * Caller: Jest.
 * Deps: baca sumber routes/public.js (iPaymu), routes/bill-payment.js (Tripay & Mayar).
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

describe('settle markPaid dioper semua callback gateway (#b344)', () => {
    test('iPaymu (public.js) mengoper markPaid → updateStatusPayment', () => {
        const src = read('routes/public.js');
        const i = src.indexOf('settleTagihanPayment({');
        expect(i).toBeGreaterThan(-1);
        const blk = src.slice(i, i + 500);
        expect(blk).toMatch(/markPaid:\s*\(\)\s*=>\s*updateStatusPayment\(/);
    });

    test('Tripay & Mayar (bill-payment.js) sama-sama mengoper markPaid', () => {
        const src = read('routes/bill-payment.js');
        const hits = src.match(/markPaid:\s*\(\)\s*=>\s*updateStatusPayment\(/g) || [];
        expect(hits.length).toBeGreaterThanOrEqual(2); // Tripay + Mayar
    });

    test('settle memanggil markPaid sebelum reaktivasi (bukti di sumber settlement)', () => {
        const src = read('lib/services/bill-payment-settlement.js');
        const iMark = src.indexOf('markPaid()');
        const iReact = src.indexOf('await maybeReactivate(user)'); // CALL site (bukan definisi fungsi)
        expect(iMark).toBeGreaterThan(-1);
        expect(iReact).toBeGreaterThan(iMark); // markPaid di ATAS reaktivasi
    });
});
