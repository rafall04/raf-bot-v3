const { resolveWhatsAppRuntimeState, buildWhatsAppSocketPayload } = require('../whatsapp-runtime');

describe('whatsapp-runtime', () => {
    test('marks logged out as action-required state', () => {
        expect(resolveWhatsAppRuntimeState({
            connection: 'close',
            reason: 'logged_out',
            currentState: 'open',
            hasActiveSession: false
        })).toBe('logged_out');
    });

    test('keeps transient close as temporary disconnect', () => {
        expect(resolveWhatsAppRuntimeState({
            connection: 'close',
            currentState: 'open',
            hasActiveSession: true
        })).toBe('temporary_disconnect');
    });

    test('builds payload with reauth flag for logged out', () => {
        expect(buildWhatsAppSocketPayload('logged_out')).toEqual({
            service: 'whatsapp',
            state: 'logged_out',
            requiresReauth: true
        });
    });
});
