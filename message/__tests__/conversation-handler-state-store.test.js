/**
 * Header Doc
 * Purpose: Guardrail test untuk backing store state percakapan agar proxy legacy tetap berbagi managed store yang sama.
 * Caller: Jest test runner.
 * Deps: `../handlers/conversation-handler`.
 * MainFuncs: Memverifikasi proxy scoped menulis ke store managed dan membersihkan timer state sesudah test.
 * SideEffects: Membuat lalu membersihkan state/timer percakapan selama test.
 */
"use strict";

describe('conversation-handler backing store', () => {
    beforeEach(() => {
        jest.resetModules();
    });

    afterEach(() => {
        const { clearAllStates } = require('../handlers/conversation-handler');
        clearAllStates();
    });

    test('scoped proxies share managed store without exposing temp as source of truth', () => {
        const {
            setUserState,
            getUserState,
            deleteUserState,
            createScopedStateProxy
        } = require('../handlers/conversation-handler');

        const legacyProxy = createScopedStateProxy('legacy-temp');
        const teknisiProxy = createScopedStateProxy('teknisi');

        legacyProxy['user-a'] = { step: 'ASK_NEW_PASSWORD' };
        teknisiProxy['user-b'] = { step: 'TECH_WAIT_OTP' };

        expect(getUserState('user-a').step).toBe('ASK_NEW_PASSWORD');
        expect(getUserState('user-b').step).toBe('TECH_WAIT_OTP');

        setUserState('user-c', { step: 'REPORT_MENU' });
        expect(getUserState('user-c').step).toBe('REPORT_MENU');

        deleteUserState('user-a');
        expect(getUserState('user-a')).toBeNull();
    });
});
