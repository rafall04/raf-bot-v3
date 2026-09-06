/**
 * Header Doc
 * Purpose: Uji #b321 — (1) processAgentConfirmation IDEMPOTEN: topup yang sudah diverifikasi admin
 *   tak dikredit ulang saat agen konfirmasi (anti double-credit saldo); (2) tulis ATOMIK (tmp+rename)
 *   & KARANTINA berkas rusak (topup pending tak hilang senyap saat SIGKILL di tengah tulis).
 * Caller: Jest (`npx jest lib/saldo/__tests__/topup-store-safety.test.js`).
 * Deps: mock ../shared (path store ke tmp), ../../agent-transaction-manager, ../balance-operations.
 * SideEffects: tulis berkas sementara di OS tmpdir (dibersihkan).
 */
'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

const TMP = path.join(os.tmpdir(), `topup-test-${process.pid}.json`);

jest.mock('../shared', () => ({ TOPUP_REQUESTS_DB: require('path').join(require('os').tmpdir(), `topup-test-${process.pid}.json`) }));
jest.mock('../../agent-transaction-manager', () => ({ getTransactionById: jest.fn(), completeTransaction: jest.fn(() => true) }));
jest.mock('../balance-operations', () => ({ addSaldo: jest.fn(async () => true), getUserSaldo: jest.fn(async () => 5000) }));

const store = require('../topup-store');
const atm = require('../../agent-transaction-manager');
const bal = require('../balance-operations');

afterAll(() => { try { fs.unlinkSync(TMP); } catch (_e) { /* noop */ } });

describe('processAgentConfirmation idempoten (#b321 — anti double-credit)', () => {
    beforeEach(() => {
        bal.addSaldo.mockClear();
        atm.completeTransaction.mockClear();
    });

    test('topup SUDAH diverifikasi admin → agen konfirmasi TIDAK kredit ulang', async () => {
        fs.writeFileSync(TMP, JSON.stringify([{ id: 't1', userId: 'c1', amount: 1000, status: 'verified', agentTransactionId: 'at1' }]));
        store.reloadTopupRequests();
        atm.getTransactionById.mockReturnValue({ id: 'at1', status: 'confirmed', topupRequestId: 't1', customerId: 'c1', amount: 1000, agentId: 'a1', agentName: 'X' });
        const res = await store.processAgentConfirmation('at1');
        expect(bal.addSaldo).not.toHaveBeenCalled();       // TIDAK kredit ulang
        expect(res.alreadyProcessed).toBe(true);
        expect(atm.completeTransaction).toHaveBeenCalledWith('at1'); // agent transaction tetap dituntaskan
    });

    test('topup masih pending → agen konfirmasi kredit SEKALI (jalur normal)', async () => {
        fs.writeFileSync(TMP, JSON.stringify([{ id: 't2', userId: 'c2', amount: 2000, status: 'pending', agentTransactionId: 'at2' }]));
        store.reloadTopupRequests();
        atm.getTransactionById.mockReturnValue({ id: 'at2', status: 'confirmed', topupRequestId: 't2', customerId: 'c2', amount: 2000, agentId: 'a2', agentName: 'Y' });
        const res = await store.processAgentConfirmation('at2');
        expect(bal.addSaldo).toHaveBeenCalledTimes(1);
        expect(res.success).toBe(true);
    });
});

describe('durabilitas topup_requests.json (#b321)', () => {
    test('tulis ATOMIK: ke .tmp lalu rename (bukan langsung ke berkas tujuan)', () => {
        fs.writeFileSync(TMP, '[]');
        store.reloadTopupRequests();
        const writeSpy = jest.spyOn(fs, 'writeFileSync');
        const renameSpy = jest.spyOn(fs, 'renameSync');
        store.saveTopupRequests();
        expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('.tmp-'), expect.any(String));
        expect(renameSpy).toHaveBeenCalledWith(expect.stringContaining('.tmp-'), TMP);
        writeSpy.mockRestore(); renameSpy.mockRestore();
    });

    test('berkas RUSAK → dikarantina (.rusak-*) + state kosong, BUKAN hilang senyap lalu tertimpa', () => {
        fs.writeFileSync(TMP, '{ ini json rusak');
        const renameSpy = jest.spyOn(fs, 'renameSync');
        store.loadTopupRequests();
        expect(store.getAllTopupRequests()).toEqual([]);
        expect(renameSpy).toHaveBeenCalledWith(TMP, expect.stringContaining('.rusak-'));
        renameSpy.mockRestore();
    });
});
