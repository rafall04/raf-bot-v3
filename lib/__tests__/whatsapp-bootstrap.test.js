/**
 * Header Doc
 * Purpose: Guardrail untuk boundary lifecycle WhatsApp bootstrap agar reconnect memakai starter terdaftar yang stabil.
 * Caller: Jest runner tranche final WA runtime cleanup.
 * Deps: `../whatsapp-bootstrap`.
 * MainFuncs: Tidak ada.
 * SideEffects: Menyimpan starter/runtime terdaftar hanya di scope modul bootstrap saat test.
 */
"use strict";

describe('lib/whatsapp-bootstrap', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    test('triggerWhatsAppReconnect memakai starter yang sudah didaftarkan', async () => {
        const bootstrap = require('../whatsapp-bootstrap');
        const runtime = { id: 'runtime-test' };
        const starter = jest.fn(async (providedRuntime) => ({ runtime: providedRuntime.id }));

        bootstrap.registerWhatsAppStarter(runtime, starter);
        const result = await bootstrap.triggerWhatsAppReconnect();

        expect(starter).toHaveBeenCalledWith(runtime);
        expect(result).toEqual({ runtime: 'runtime-test' });
    });

    test('triggerWhatsAppReconnect melempar error jika starter belum terdaftar', async () => {
        const bootstrap = require('../whatsapp-bootstrap');

        await expect(bootstrap.triggerWhatsAppReconnect()).rejects.toThrow(
            'WhatsApp starter belum terdaftar'
        );
    });
});
