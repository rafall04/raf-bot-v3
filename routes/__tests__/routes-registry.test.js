/**
 * Header Doc
 * Purpose: Menjaga urutan mount route hasil ekstraksi registry agar kontrak path publik tidak bergeser.
 * Caller: Jest.
 * Deps: `../../lib/routes-registry`.
 * MainFuncs: Menguji `registerRoutes`.
 * SideEffects: Tidak ada selain mocking require router.
 */
"use strict";

function mockCreateRouter(name) {
    return { __routerName: name };
}

jest.mock('../public', () => mockCreateRouter('public'));
jest.mock('../api', () => mockCreateRouter('api'));
jest.mock('../tickets', () => mockCreateRouter('tickets'));
jest.mock('../invoice', () => mockCreateRouter('invoice'));
jest.mock('../payment-status', () => mockCreateRouter('payment-status'));
jest.mock('../requests', () => mockCreateRouter('requests'));
jest.mock('../compensation', () => mockCreateRouter('compensation'));
jest.mock('../speed-requests', () => mockCreateRouter('speed-requests'));
jest.mock('../stats', () => mockCreateRouter('stats'));
jest.mock('../users', () => mockCreateRouter('users'));
jest.mock('../accounts', () => mockCreateRouter('accounts'));
jest.mock('../packages', () => mockCreateRouter('packages'));
jest.mock('../saldo', () => mockCreateRouter('saldo'));
jest.mock('../agents', () => mockCreateRouter('agents'));
jest.mock('../pages', () => mockCreateRouter('pages'));
jest.mock('../monitoring-api', () => mockCreateRouter('monitoring-api'));
jest.mock('../kasbon', () => mockCreateRouter('kasbon'));
jest.mock('../partial-payment', () => mockCreateRouter('partial-payment'));
jest.mock('../discount', () => mockCreateRouter('discount'));
jest.mock('../change-package', () => mockCreateRouter('change-package'));
jest.mock('../message-templates', () => mockCreateRouter('message-templates'));
jest.mock('../rekap-keuangan', () => mockCreateRouter('rekap-keuangan'));
jest.mock('../expenses', () => mockCreateRouter('expenses'));
jest.mock('../gaji', () => mockCreateRouter('gaji'));
jest.mock('../olt', () => mockCreateRouter('olt'));
jest.mock('../technician-settlement', () => mockCreateRouter('technician-settlement'));
jest.mock('../admin-router', () => ({
    createAdminRouter: jest.fn(() => mockCreateRouter('admin'))
}));

const { createAdminRouter } = require('../admin-router');
const { registerRoutes } = require('../../lib/routes-registry');

describe('routes-registry', () => {
    test('registerRoutes preserves legacy mount order', () => {
        const app = {
            use: jest.fn()
        };

        registerRoutes(app, { id: 'runtime-1' });

        expect(createAdminRouter).toHaveBeenCalledWith({ runtime: { id: 'runtime-1' } });
        expect(app.use.mock.calls.slice(0, 6)).toEqual([
            ['/', expect.objectContaining({ __routerName: 'public' })],
            ['/api/payment-status', expect.objectContaining({ __routerName: 'payment-status' })],
            ['/api/requests', expect.objectContaining({ __routerName: 'requests' })],
            ['/', expect.objectContaining({ __routerName: 'admin' })],
            ['/api/users', expect.objectContaining({ __routerName: 'users' })],
            ['/api/saldo', expect.objectContaining({ __routerName: 'saldo' })]
        ]);
        expect(app.use.mock.calls[app.use.mock.calls.length - 1]).toEqual([
            '/',
            expect.objectContaining({ __routerName: 'pages' })
        ]);
    });
});
