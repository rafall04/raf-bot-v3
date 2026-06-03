/**
 * Header Doc
 * Purpose: Guardrail untuk boundary reply runtime agar `message/raf.js` tidak lagi bergantung pada socket WA mentah.
 * Caller: Jest runner tranche hotspot runtime WA.
 * Deps: `../handlers/reply-runtime` dan `../../lib/whatsapp-gateway`.
 * MainFuncs: Tidak ada.
 * SideEffects: Mengubah socket aktif gateway selama pengujian.
 */
"use strict";

describe('message/handlers/reply-runtime', () => {
    let gateway;
    let replyRuntime;

    beforeEach(() => {
        jest.resetModules();
        gateway = require('../../lib/whatsapp-gateway');
        gateway.clearActiveSocket({ nextState: 'close' });
        delete global.conn;
        delete global.raf;
        delete global.whatsappConnectionState;
        replyRuntime = require('../handlers/reply-runtime');
    });

    test('sendReply mengirim teks via gateway dengan quoted payload', async () => {
        const socket = {
            sendMessage: jest.fn(async (jid, payload, options) => ({ jid, payload, options }))
        };
        gateway.setActiveSocket(socket, { state: 'open' });

        await replyRuntime.sendReply({
            recipient: '62812@s.whatsapp.net',
            text: 'halo',
            quoted: { key: { id: 'msg-1' } },
            skipDuplicateCheck: true,
            delayMs: 0
        });

        expect(socket.sendMessage).toHaveBeenCalledWith(
            '62812@s.whatsapp.net',
            { text: 'halo' },
            {
                quoted: { key: { id: 'msg-1' } },
                skipDuplicateCheck: true
            }
        );
    });

    test('sendReply aman saat runtime offline', async () => {
        await expect(
            replyRuntime.sendReply({
                recipient: '62812@s.whatsapp.net',
                text: 'halo',
                delayMs: 0
            })
        ).resolves.toBeUndefined();
    });

    test('sendContactCard mengirim payload contact via gateway', async () => {
        const socket = {
            sendMessage: jest.fn(async (jid, payload, options) => ({ jid, payload, options }))
        };
        gateway.setActiveSocket(socket, { state: 'open' });

        await replyRuntime.sendContactCard({
            recipient: '62812@s.whatsapp.net',
            number: '08123',
            name: 'Budi',
            quoted: { key: { id: 'msg-2' } }
        });

        expect(socket.sendMessage).toHaveBeenCalledWith(
            '62812@s.whatsapp.net',
            expect.objectContaining({
                contacts: expect.objectContaining({
                    displayName: 'Budi'
                })
            }),
            {
                quoted: { key: { id: 'msg-2' } }
            }
        );
    });
});
