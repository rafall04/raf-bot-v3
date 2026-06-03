/**
 * Header Doc
 * Purpose: Menjaga boundary context/pipeline bot baru agar tetap tipis dan kompatibel.
 * Caller: Jest.
 * Deps: `../handlers/bot-context`, `../handlers/bot-pipeline`.
 * MainFuncs: Menguji `buildBotContext`, `routeManagedState`, `runGlobalInterceptors`.
 * SideEffects: Tidak ada.
 */
"use strict";

const { buildBotContext } = require('../handlers/bot-context');
const { routeManagedState, runGlobalInterceptors } = require('../handlers/bot-pipeline');

describe('bot pipeline helpers', () => {
    test('buildBotContext merges runtime and normalized data', () => {
        const runtime = { id: 'runtime-1' };
        const context = buildBotContext({
            raf: { sendMessage: jest.fn() },
            msg: { key: { id: 'abc' } },
            runtime,
            data: { sender: '6281@s.whatsapp.net', chats: 'menu' }
        });

        expect(context.runtime).toBe(runtime);
        expect(context.sender).toBe('6281@s.whatsapp.net');
        expect(context.chats).toBe('menu');
    });

    test('routeManagedState delegates to legacy handler contract', async () => {
        const handleManagedConversationState = jest.fn().mockResolvedValue({ handled: true });
        const result = await routeManagedState({
            handleManagedConversationState,
            stateSender: '6281@s.whatsapp.net'
        });

        expect(handleManagedConversationState).toHaveBeenCalledWith({
            stateSender: '6281@s.whatsapp.net'
        });
        expect(result).toEqual({ handled: true });
    });

    test('runGlobalInterceptors is non-breaking by default', () => {
        expect(runGlobalInterceptors({ sender: '6281@s.whatsapp.net' })).toEqual({
            handled: false,
            context: { sender: '6281@s.whatsapp.net' }
        });
    });
});
