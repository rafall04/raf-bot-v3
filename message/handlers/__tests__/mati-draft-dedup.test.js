/**
 * Header Doc
 * Purpose: Kunci #b322 (P1) — promoteMatiDraftOnTimeout IDEMPOTEN: DUA promotor (timer in-memory 15m
 *   + pemindaian disk 5m) tak boleh menjadikan satu laporan mati jadi 2 tiket + 2 blast notif teknisi.
 *   Guard cek tiket auto-promote TERBUKA per-pelanggan sebelum createCustomerReportTicket, dan sukses
 *   promote membersihkan draft + state in-memory (koordinasi kedua promotor).
 * Caller: Jest.
 * Deps: baca sumber message/handlers/smart-report-handler.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'smart-report-handler.js'), 'utf8');
const fn = src.slice(
    src.indexOf('async function promoteMatiDraftOnTimeout'),
    src.indexOf('async function pindaiDraftLaporanTertunda')
);

describe('promoteMatiDraftOnTimeout idempoten (#b322)', () => {
    test('guard anti-dobel cek tiket auto-promote TERBUKA per-pelanggan SEBELUM createCustomerReportTicket', () => {
        expect(fn).toMatch(/autoPromotedFromTimeout\s*===\s*true/);
        expect(fn).toMatch(/pelangganUserId\s*===\s*custId/);
        const idxGuard = fn.indexOf('sudahAda');
        const idxCreate = fn.indexOf('await createCustomerReportTicket'); // panggilan nyata, bukan sebutan di komentar
        expect(idxGuard).toBeGreaterThan(-1);
        expect(idxCreate).toBeGreaterThan(-1);
        expect(idxGuard).toBeLessThan(idxCreate); // guard mendahului pembuatan tiket
    });

    test('sukses promote membersihkan draft DAN state in-memory (koordinasi timer vs scan)', () => {
        expect(fn).toMatch(/hapusDraftLaporan\(userId\)/);
        expect(fn).toMatch(/deleteUserState\(userId\)/);
    });
});
