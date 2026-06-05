/**
 * Guardrail: setiap handler privileged WAJIB menolak caller tanpa hak akses.
 *
 * Audit #3 menemukan gating sudah konsisten, TAPI bug `alluser` dulu lolos karena
 * tidak ada test yang menangkap gate hilang. Test ini mengunci invariant:
 *
 *   "Caller unprivileged (isOwner=false, isTeknisi=false) TIDAK BOLEH memicu
 *    efek samping privileged (dependency destruktif / disclosure data)."
 *
 * Kalau ada yang menambah/mengubah handler privileged tanpa gate, test ini merah.
 * Pendekatan: panggil handler dengan caller tanpa hak, bungkus try/catch (gate
 * boleh signal via throw string ATAU reply denial), lalu assert efek privileged
 * TIDAK terjadi.
 */
"use strict";

jest.mock('../handlers/template-helpers', () => ({
    renderResponseTemplate: jest.fn((key) => key)
}));
jest.mock('../../lib/templating', () => ({
    renderTemplate: jest.fn(() => 'RENDERED')
}));
jest.mock('../../lib/whatsapp-gateway', () => ({ getSocket: jest.fn(() => ({})), isReady: jest.fn(() => true) }));
jest.mock('../../lib/whatsapp-delivery-service', () => ({ sendMessage: jest.fn() }));

const network = require('../handlers/network-management-handler');
const voucherMgmt = require('../handlers/voucher-management-handler');
const balance = require('../handlers/balance-management-handler');
const monitoring = require('../handlers/monitoring-handler');

const mess = {
    owner: 'OWNER_ONLY',
    teknisiOrOwnerOnly: 'TEKNISI_OR_OWNER_ONLY',
    wrongFormat: 'WRONG',
    mustNumber: 'MUST_NUMBER'
};

// Absorb throw-string gate signal supaya kita bisa assert invariant efek samping.
async function callIgnoringGateThrow(fn) {
    try {
        await fn();
    } catch (err) {
        // Gate boleh throw string (mess.owner). Itu sinyal penolakan yang valid.
        if (typeof err !== 'string') throw err;
    }
}

describe('auth gating guardrail — privileged handler menolak unprivileged caller', () => {
    describe('network mutations (owner-only)', () => {
        test('handleAddPPP: !isOwner → addpppoe TIDAK dipanggil', async () => {
            const addpppoe = jest.fn();
            await callIgnoringGateThrow(() => network.handleAddPPP({
                q: 'user|pass|profile', isOwner: false, reply: jest.fn(), mess, addpppoe
            }));
            expect(addpppoe).not.toHaveBeenCalled();
        });

        test('handleAddBinding: !isOwner → addbinding & addqueue TIDAK dipanggil', async () => {
            const addbinding = jest.fn();
            const addqueue = jest.fn();
            await callIgnoringGateThrow(() => network.handleAddBinding({
                q: 'x|y|z', isOwner: false, reply: jest.fn(), mess, global: { config: {} },
                checkStatik: jest.fn(() => ({})), checkLimitAt: jest.fn(), checkMaxLimit: jest.fn(),
                addbinding, addqueue
            }));
            expect(addbinding).not.toHaveBeenCalled();
            expect(addqueue).not.toHaveBeenCalled();
        });
    });

    describe('voucher/static profile mutations (owner-only)', () => {
        test('handleAddProfVoucher: !isOwner → addvoucher TIDAK dipanggil', async () => {
            const addvoucher = jest.fn();
            await callIgnoringGateThrow(() => voucherMgmt.handleAddProfVoucher({
                q: '1|nama|1jam|1000', isOwner: false, reply: jest.fn(), mess,
                checkprofvoucher: jest.fn(() => false), addvoucher
            }));
            expect(addvoucher).not.toHaveBeenCalled();
        });

        test('handleDelProfVoucher: !isOwner → array voucher TIDAK dimutasi', async () => {
            const voucher = [{ namavc: 'A' }, { namavc: 'B' }];
            await callIgnoringGateThrow(() => voucherMgmt.handleDelProfVoucher({
                q: '0', isOwner: false, reply: jest.fn(), mess,
                checkprofvoucher: jest.fn(() => true), voucher
            }));
            expect(voucher).toHaveLength(2); // tidak ada splice
        });

        test('handleAddProfStatik: !isOwner → addStatik TIDAK dipanggil', async () => {
            const addStatik = jest.fn();
            await callIgnoringGateThrow(() => voucherMgmt.handleAddProfStatik({
                q: 'prof|1M|2M', isOwner: false, reply: jest.fn(), mess,
                checkStatik: jest.fn(() => false), addStatik
            }));
            expect(addStatik).not.toHaveBeenCalled();
        });

        test('handleDelProfStatik: !isOwner → array statik TIDAK dimutasi', async () => {
            const statik = [{ name: 'A' }, { name: 'B' }];
            await callIgnoringGateThrow(() => voucherMgmt.handleDelProfStatik({
                q: '0', isOwner: false, reply: jest.fn(), mess,
                checkStatik: jest.fn(() => true), statik
            }));
            expect(statik).toHaveLength(2);
        });
    });

    describe('balance mutations (owner-only)', () => {
        test('handleTopup: !isOwner → addATM/addKoinUser TIDAK dipanggil', async () => {
            const addATM = jest.fn();
            const addKoinUser = jest.fn();
            await callIgnoringGateThrow(() => balance.handleTopup({
                q: '628123|1000', isOwner: false, sender: '628999@s.whatsapp.net',
                reply: jest.fn(), msg: {}, mess, raf: {},
                checkATMuser: jest.fn().mockResolvedValue(0), addATM, addKoinUser
            }));
            expect(addATM).not.toHaveBeenCalled();
            expect(addKoinUser).not.toHaveBeenCalled();
        });

        test('handleDelSaldo: !isOwner → delSaldo TIDAK dipanggil', async () => {
            const delSaldo = jest.fn();
            await callIgnoringGateThrow(() => balance.handleDelSaldo({
                q: '628123', isOwner: false, reply: jest.fn(), mess,
                checkATMuser: jest.fn().mockResolvedValue(0),
                checkRegisteredATM: jest.fn().mockResolvedValue(true), delSaldo
            }));
            expect(delSaldo).not.toHaveBeenCalled();
        });
    });

    describe('data disclosure (owner-only)', () => {
        test('handleAllSaldo: !isOwner → tidak disclose (reply tidak dipanggil)', async () => {
            const reply = jest.fn();
            await callIgnoringGateThrow(() => monitoring.handleAllSaldo(
                false, reply, mess, { nama: 'X' }, [{ id: '1', saldo: 999 }]
            ));
            // reply hanya boleh denial, BUKAN data saldo. Gate sync throw → reply tak terpanggil.
            const disclosed = reply.mock.calls.some((c) => String(c[0]).includes('999'));
            expect(disclosed).toBe(false);
        });

        test('handleAllUser: !isOwner → tidak disclose data pelanggan', async () => {
            const reply = jest.fn();
            await callIgnoringGateThrow(() => monitoring.handleAllUser(
                false, reply, mess, [{ name: 'RAHASIA', phone_number: '628111' }]
            ));
            const disclosed = reply.mock.calls.some((c) => String(c[0]).includes('RAHASIA'));
            expect(disclosed).toBe(false);
        });

        test('handleStatusPpp: bukan owner/teknisi → reply denial teknisiOrOwnerOnly', async () => {
            const reply = jest.fn();
            await callIgnoringGateThrow(() => monitoring.handleStatusPpp(
                false, false, reply, mess, {}
            ));
            expect(reply).toHaveBeenCalledWith('TEKNISI_OR_OWNER_ONLY');
        });

        test('handleMonitorWifi: bukan owner/teknisi → reply denial teknisiOrOwnerOnly', async () => {
            const reply = jest.fn();
            await callIgnoringGateThrow(() => monitoring.handleMonitorWifi(
                false, false, reply, mess
            ));
            expect(reply).toHaveBeenCalledWith('TEKNISI_OR_OWNER_ONLY');
        });
    });

    describe('sanity — privileged caller DIIZINKAN (gate bukan false-positive)', () => {
        test('handleAddPPP: isOwner=true → addpppoe DIPANGGIL', async () => {
            const addpppoe = jest.fn().mockResolvedValue({ ok: true, message: '' });
            await callIgnoringGateThrow(() => network.handleAddPPP({
                q: 'user|pass|profile', isOwner: true, reply: jest.fn(), mess, addpppoe
            }));
            expect(addpppoe).toHaveBeenCalled();
        });
    });
});
