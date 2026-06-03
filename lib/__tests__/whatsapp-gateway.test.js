/**
 * Header Doc
 * Purpose: Guardrail untuk gateway runtime WA agar adapter dan delivery service tetap stabil saat kontrak socket berubah.
 * Caller: Jest runner tranche unifikasi runtime WA.
 * Deps: `../whatsapp-gateway`, `../whatsapp.adapter`, dan `../whatsapp-delivery-service`.
 * MainFuncs: Tidak ada.
 * SideEffects: Menulis/membersihkan mirror global kompatibilitas selama pengujian.
 */
"use strict";

describe('lib/whatsapp-gateway', () => {
    let gateway;

    beforeEach(() => {
        jest.resetModules();
        gateway = require('../whatsapp-gateway');
        gateway.clearActiveSocket({ nextState: 'close' });
        delete global.conn;
        delete global.raf;
        delete global.whatsappConnectionState;
    });

    test('setActiveSocket dan sendPayload mengirim lewat socket aktif', async () => {
        const socket = {
            sendMessage: jest.fn(async (jid, payload, options) => ({ jid, payload, options }))
        };

        gateway.setActiveSocket(socket, { state: 'open' });
        const result = await gateway.sendPayload('6281@s.whatsapp.net', { text: 'halo' }, { quoted: 'msg' });

        expect(gateway.getSocket()).toBe(socket);
        expect(gateway.getConnectionState()).toBe('open');
        expect(gateway.isReady()).toBe(true);
        expect(socket.sendMessage).toHaveBeenCalledWith(
            '6281@s.whatsapp.net',
            { text: 'halo' },
            { quoted: 'msg' }
        );
        expect(result).toEqual({
            jid: '6281@s.whatsapp.net',
            payload: { text: 'halo' },
            options: { quoted: 'msg' }
        });
    });

    test('adapter tetap kompatibel dan throw saat runtime tidak ready', async () => {
        const adapter = require('../whatsapp.adapter');
        await expect(adapter.sendText('6281@s.whatsapp.net', 'halo')).rejects.toThrow(
            'WhatsApp connection not ready'
        );
    });

    test('delivery service menggunakan gateway yang sama', async () => {
        const socket = {
            sendMessage: jest.fn(async (jid, payload) => ({ key: { remoteJid: jid }, payload }))
        };
        gateway.setActiveSocket(socket, { state: 'open' });

        const deliveryService = require('../whatsapp-delivery-service');
        const result = await deliveryService.sendMessage('08123', { text: 'halo' });

        expect(result.sent).toBe(true);
        expect(result.successCount).toBe(1);
        expect(socket.sendMessage).toHaveBeenCalledWith(
            '628123@s.whatsapp.net',
            { text: 'halo' },
            {}
        );
    });

    test('clearActiveSocket mereset mirror global dan state', () => {
        gateway.setActiveSocket({ sendMessage: jest.fn() }, { state: 'open' });

        gateway.clearActiveSocket({ nextState: 'logged_out' });

        expect(gateway.getSocket()).toBe(null);
        expect(gateway.getConnectionState()).toBe('logged_out');
        expect(global.conn).toBe(null);
        expect(global.raf).toBe(null);
        expect(global.whatsappConnectionState).toBe('logged_out');
    });

    test('helper observability memberi shape stabil untuk socket aktif', () => {
        gateway.setActiveSocket(
            {
                sendMessage: jest.fn(),
                user: { id: '6281@s.whatsapp.net' },
                ws: { readyState: 1 }
            },
            { state: 'open' }
        );

        expect(gateway.hasSocket()).toBe(true);
        expect(gateway.hasAuthenticatedSession()).toBe(true);
        expect(gateway.getSocketDiagnostics()).toEqual({
            hasSocket: true,
            hasUser: true,
            wsReadyState: 1,
            connectionState: 'open'
        });
    });

    test('helper observability tetap aman saat socket kosong', () => {
        gateway.clearActiveSocket({ nextState: 'temporary_disconnect' });

        expect(gateway.hasSocket()).toBe(false);
        expect(gateway.hasAuthenticatedSession()).toBe(false);
        expect(gateway.getSocketDiagnostics()).toEqual({
            hasSocket: false,
            hasUser: false,
            wsReadyState: null,
            connectionState: 'temporary_disconnect'
        });
    });
});
