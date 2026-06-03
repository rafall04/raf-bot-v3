/**
 * Header Doc
 * Purpose: Guardrail untuk memastikan whatsappOperation memakai gateway readiness, bukan global connection mentah.
 * Caller: Jest runner tranche cleanup final WA runtime.
 * Deps: `../error-handler` dan `../whatsapp-gateway`.
 * MainFuncs: Tidak ada.
 * SideEffects: Mengubah state gateway selama pengujian.
 */
"use strict";

describe('lib/error-handler whatsappOperation', () => {
    let gateway;
    let errorHandler;

    beforeEach(() => {
        jest.resetModules();
        gateway = require('../whatsapp-gateway');
        gateway.clearActiveSocket({ nextState: 'close' });
        delete global.conn;
        delete global.raf;
        delete global.whatsappConnectionState;
        errorHandler = require('../error-handler');
    });

    test('melempar error WA saat runtime offline', async () => {
        await expect(
            errorHandler.whatsappOperation(async () => ({ ok: true }))
        ).rejects.toMatchObject({
            message: 'WhatsApp bot is offline',
            statusCode: 503,
            errorCode: errorHandler.ErrorTypes.WHATSAPP_ERROR
        });
    });

    test('menjalankan operasi saat runtime ready', async () => {
        gateway.setActiveSocket({ sendMessage: jest.fn() }, { state: 'open' });

        const result = await errorHandler.whatsappOperation(async () => 'ok');

        expect(result).toBe('ok');
    });
});
