/**
 * Header Doc
 * Purpose: Test guard sinkron docs↔kode — path yang disebut dokumen keadaan-sekarang harus ada,
 *          tiap DB `getDatabasePath` literal terdokumentasi di SYSTEM_MAP, tiap gate langsung
 *          `config.<key>.enabled` ter-contoh di config.example.json.
 * Caller: Jest (`npm test` / `npx jest scripts/__tests__/docs-sync.test.js`).
 * Deps: scripts/check-docs-sync.js.
 * MainFuncs: -
 * SideEffects: Tidak ada; read-only.
 */
'use strict';

const { checkDocsSync } = require('../check-docs-sync');

describe('sinkron dokumen ↔ kode (path/DB/gate)', () => {
    test('path dokumen ada, DB terdokumentasi, gate ter-contoh', () => {
        const { errors, stats } = checkDocsSync();
        expect(errors).toEqual([]);
        expect(stats.docPaths).toBeGreaterThan(50);
        expect(stats.dbNames).toBeGreaterThan(5);
        expect(stats.gateKeys).toBeGreaterThan(10);
    });
});
