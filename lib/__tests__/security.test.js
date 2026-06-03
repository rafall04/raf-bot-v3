/**
 * Header Doc
 * Purpose: Guardrail test untuk `lib/security.js` — memastikan top-level `setInterval(cleanupRateLimits, ...)` di-`unref()` agar tidak menahan event loop di test/CLI script. Mencegah regresi yang menyebabkan `node -e require('./lib/security')` hang ~10 menit.
 * Caller: jest.
 * Deps: `../security.js`.
 * MainFuncs: assertion bahwa `setInterval` cleanup dipanggil dengan `.unref()` pada saat module load.
 */
"use strict";

describe('lib/security.js — event loop unref guardrail', () => {
    let originalSetInterval;
    let capturedTimerHandle;
    let unrefCalledOnHandle;

    beforeAll(() => {
        // Hapus require cache supaya security.js dieksekusi ulang dengan setInterval mock
        const securityPath = require.resolve('../security');
        delete require.cache[securityPath];

        // Patch setInterval untuk capture timer handle yang dibuat saat module load
        originalSetInterval = global.setInterval;
        capturedTimerHandle = null;
        unrefCalledOnHandle = false;

        global.setInterval = function patchedSetInterval(...args) {
            const handle = originalSetInterval.apply(this, args);
            // Capture handle pertama yang dibuat oleh security.js (cleanupRateLimits)
            if (capturedTimerHandle === null) {
                capturedTimerHandle = handle;
                const originalUnref = handle.unref ? handle.unref.bind(handle) : null;
                if (originalUnref) {
                    handle.unref = function patchedUnref(...unrefArgs) {
                        unrefCalledOnHandle = true;
                        return originalUnref(...unrefArgs);
                    };
                }
            }
            return handle;
        };

        // Trigger module load
        require('../security');
    });

    afterAll(() => {
        global.setInterval = originalSetInterval;
        // Cleanup: clear interval yang ter-capture supaya tidak bocor antar test file
        if (capturedTimerHandle && typeof capturedTimerHandle === 'object') {
            try { clearInterval(capturedTimerHandle); } catch (_) { /* noop */ }
        }
    });

    test('setInterval pertama yang dibuat security.js memanggil .unref() pada handle-nya', () => {
        // Arrange/Act: sudah dijalankan di beforeAll
        // Assert: pastikan handle ter-capture (artinya setInterval memang dipanggil)
        expect(capturedTimerHandle).not.toBeNull();
        // Assert: pastikan .unref() dipanggil pada handle (mencegah block event loop)
        expect(unrefCalledOnHandle).toBe(true);
    });

    test('module exports cleanupRateLimits agar bisa di-trigger manual oleh test/jobs', () => {
        const security = require('../security');
        expect(typeof security.cleanupRateLimits).toBe('function');
    });
});
