/**
 * Header Doc
 * Purpose: Guardrail untuk memastikan fast sender memakai gateway runtime WA dengan signature lama tetap kompatibel.
 * Caller: Jest runner tranche hotspot runtime WA.
 * Deps: `../fast-whatsapp-sender` dan `../whatsapp-gateway`.
 * MainFuncs: Tidak ada.
 * SideEffects: Mengubah mirror global runtime WA selama pengujian.
 */
"use strict";

describe('lib/fast-whatsapp-sender', () => {
    let gateway;
    let fastSender;

    beforeEach(() => {
        jest.resetModules();
        gateway = require('../whatsapp-gateway');
        gateway.clearActiveSocket({ nextState: 'close' });
        delete global.conn;
        delete global.raf;
        delete global.whatsappConnectionState;
        fastSender = require('../fast-whatsapp-sender');
    });

    test('fastSend sukses lewat gateway saat runtime aktif', async () => {
        const socket = {
            sendMessage: jest.fn(async (jid, payload) => ({ key: { remoteJid: jid }, payload }))
        };
        gateway.setActiveSocket(socket, { state: 'open' });

        const result = await fastSender.fastSend(null, '62812@s.whatsapp.net', 'halo');

        expect(result.success).toBe(true);
        expect(result.phoneJid).toBe('62812@s.whatsapp.net');
        expect(socket.sendMessage).toHaveBeenCalledWith(
            '62812@s.whatsapp.net',
            { text: 'halo' },
            {}
        );
    });

    test('fastSend gagal saat runtime offline', async () => {
        const result = await fastSender.fastSend(null, '62812@s.whatsapp.net', 'halo');

        expect(result.success).toBe(false);
        expect(result.error).toBe('WhatsApp connection not ready (state: close)');
    });

    test('fastSendMultiple menjaga result shape dan mengirim semua nomor via gateway', async () => {
        const socket = {
            sendMessage: jest.fn(async (jid, payload) => ({ key: { remoteJid: jid }, payload }))
        };
        gateway.setActiveSocket(socket, { state: 'open' });

        const result = await fastSender.fastSendMultiple(
            null,
            ['0812', '0813'],
            'pesan',
            { delay: 0 }
        );

        expect(result.totalCount).toBe(2);
        expect(result.successCount).toBe(2);
        expect(result.results.filter((entry) => !entry.success)).toHaveLength(0);
        expect(socket.sendMessage).toHaveBeenCalledTimes(2);
    });

    test('fastSend menerima argumen raf lama tetapi tetap mengirim lewat gateway', async () => {
        const socket = {
            sendMessage: jest.fn(async (jid, payload) => ({ key: { remoteJid: jid }, payload }))
        };
        const legacySocket = {
            sendMessage: jest.fn(async (jid, payload) => ({ key: { remoteJid: jid }, payload }))
        };
        gateway.setActiveSocket(socket, { state: 'open' });

        const result = await fastSender.fastSend(legacySocket, '62812@s.whatsapp.net', 'halo');

        expect(result.success).toBe(true);
        expect(socket.sendMessage).toHaveBeenCalledWith(
            '62812@s.whatsapp.net',
            { text: 'halo' },
            {}
        );
        expect(legacySocket.sendMessage).not.toHaveBeenCalled();
    });
});
