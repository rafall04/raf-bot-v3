/**
 * Header Doc
 * Purpose: Guardrail test untuk memastikan surface `createScopedStateProxy(...)` hanya tersisa di boundary compatibility yang diizinkan.
 * Caller: Jest test runner.
 * Deps: `fs`, `path`, dan source file state/bot boundary.
 * MainFuncs: Memverifikasi caller proxy hanya ada di `conversation-handler.js` dan test compatibility eksplisit.
 * SideEffects: Membaca source file lokal tanpa mengubah state runtime.
 */
"use strict";

const fs = require('fs');
const path = require('path');

describe('conversation handler compatibility boundary', () => {
    test('createScopedStateProxy callers are isolated to compatibility boundary', () => {
        const repoRoot = path.join(__dirname, '..', '..');
        const allowedCallers = new Set([
            'message/handlers/conversation-handler.js',
            'message/__tests__/bot-hardening.test.js',
            'message/__tests__/conversation-handler-state-store.test.js',
            'message/__tests__/conversation-state-boundary.test.js',
            'message/__tests__/raf-router-boundary.test.js',
            'message/__tests__/conversation-handler-compatibility-boundary.test.js'
        ]);
        const callerHits = [];

        function walk(dirPath) {
            for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
                if (entry.name === 'node_modules' || entry.name === 'coverage' || entry.name === '.git') {
                    continue;
                }

                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                    continue;
                }

                if (!fullPath.endsWith('.js')) {
                    continue;
                }

                const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
                const source = fs.readFileSync(fullPath, 'utf8');
                if (!source.includes('createScopedStateProxy(')) {
                    continue;
                }

                const lines = source.split(/\r?\n/);
                lines.forEach((line, index) => {
                    if (!line.includes('createScopedStateProxy(')) {
                        return;
                    }
                    callerHits.push(`${relativePath}:${index + 1}:${line.trim()}`);
                });
            }
        }

        walk(path.join(repoRoot, 'message'));

        const unexpected = callerHits.filter((entry) => {
            const relativePath = entry.split(':', 1)[0];
            return !allowedCallers.has(relativePath);
        });

        expect(unexpected).toEqual([]);
        expect(callerHits).toEqual(expect.arrayContaining([
            expect.stringContaining('message/handlers/conversation-handler.js'),
            expect.stringContaining('message/__tests__/bot-hardening.test.js'),
            expect.stringContaining('message/__tests__/conversation-handler-state-store.test.js')
        ]));
    });
});
