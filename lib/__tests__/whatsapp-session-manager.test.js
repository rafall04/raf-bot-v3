/**
 * Header Doc
 * Purpose: Guardrail untuk memastikan session recovery dapat mengambil socket dari gateway tanpa bergantung pada objek raf mentah.
 * Caller: Jest runner tranche unifikasi runtime WA.
 * Deps: `../whatsapp-session-manager` dan `../whatsapp-gateway`.
 * MainFuncs: Tidak ada.
 * SideEffects: Menyetel/membersihkan socket aktif gateway selama pengujian.
 */
"use strict";

describe('lib/whatsapp-session-manager', () => {
    let gateway;
    let sessionManager;

    beforeEach(() => {
        jest.resetModules();
        gateway = require('../whatsapp-gateway');
        sessionManager = require('../whatsapp-session-manager');
        gateway.clearActiveSocket({ nextState: 'close' });
    });

    afterEach(() => {
        gateway.clearActiveSocket({ nextState: 'close' });
    });

    test('sendMessageWithRecovery memakai socket dari gateway bila accessor tidak diberikan', async () => {
        const socket = {
            sendMessage: jest.fn(async (jid, payload) => ({ key: { remoteJid: jid }, payload }))
        };
        gateway.setActiveSocket(socket, { state: 'open' });

        const result = await sessionManager.sendMessageWithRecovery(null, '6281@s.whatsapp.net', { text: 'halo' });

        expect(socket.sendMessage).toHaveBeenCalledWith('6281@s.whatsapp.net', { text: 'halo' }, {});
        expect(result).toEqual({
            key: { remoteJid: '6281@s.whatsapp.net' },
            payload: { text: 'halo' }
        });
    });
});
