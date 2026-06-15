"use strict";

/**
 * Header Doc
 * Purpose: Regresi H3 — membuktikan semua mutasi saldo (deduct) di-serialize lewat
 *   withSaldoWriteLock sehingga operasi konkuren TIDAK menyebabkan double-spend.
 * Caller: Jest test runner (`npx jest lib/__tests__/saldo-concurrency-h3.test.js`).
 * Deps: `../saldo-manager` (composer) → `lib/saldo/*` real SQLite (NODE_ENV=test → saldo_test.sqlite).
 * MainFuncs: -
 * SideEffects: Menulis 1 row user_saldo unik (di-cleanup di afterAll) ke saldo_test.sqlite.
 *
 * Catatan: tanpa serialisasi, 10 deduct konkuren di koneksi singleton akan gagal dengan
 * "cannot start a transaction within a transaction" (hanya 1 sukses) ATAU saling baca saldo
 * basi (double-spend). Dengan fix, hasil deterministik: tepat floor(saldo/amount) sukses.
 */

const saldoManager = require('../saldo-manager');

const USER = `h3concurrency_${Date.now()}@s.whatsapp.net`;

describe('H3: serialisasi mutasi saldo konkuren (anti double-spend)', () => {
    afterAll(async () => {
        // Best-effort cleanup: kosongkan saldo user test agar tidak menumpuk di saldo_test.sqlite.
        try {
            const bal = await saldoManager.getUserSaldo(USER);
            if (bal > 0) {
                await saldoManager.deductSaldo(USER, bal, 'cleanup h3 test');
            }
        } catch (_e) {
            /* ignore cleanup error */
        }
    });

    test('10 deduct konkuren dari saldo 10000 @3000 → tepat 3 sukses, sisa 1000 (tanpa double-spend)', async () => {
        await saldoManager.createUserSaldo(USER);
        const seeded = await saldoManager.addSaldo(USER, 10000, 'seed h3 test');
        expect(seeded).toBe(true);
        expect(await saldoManager.getUserSaldo(USER)).toBe(10000);

        // Tembak 10 deduct @3000 SECARA BERSAMAAN.
        const results = await Promise.all(
            Array.from({ length: 10 }, () => saldoManager.deductSaldo(USER, 3000, 'h3 concurrent'))
        );
        const successes = results.filter((r) => r === true).length;

        // Hanya floor(10000/3000) = 3 yang boleh sukses; sisanya ditolak (saldo tidak cukup).
        expect(successes).toBe(3);
        // Saldo akhir HARUS 10000 - (3 * 3000) = 1000 (bukan negatif, bukan double-spend).
        expect(await saldoManager.getUserSaldo(USER)).toBe(1000);
    }, 20000);
});
