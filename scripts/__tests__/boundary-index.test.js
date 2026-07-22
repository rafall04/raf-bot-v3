/**
 * Header Doc
 * Purpose: Test guard integritas indeks boundary — anchor unik/ber-heading di docs/boundary-log.md,
 *          link indeks SYSTEM_MAP.md valid dua arah, baris indeks tetap satu baris ringkas.
 * Caller: Jest (`npm test` / `npx jest scripts/__tests__/boundary-index.test.js`).
 * Deps: scripts/check-boundary-index.js.
 * MainFuncs: -
 * SideEffects: Tidak ada; read-only terhadap dua file dokumentasi.
 */
'use strict';

const { checkBoundaryIndex } = require('../check-boundary-index');

describe('integritas indeks boundary (SYSTEM_MAP ↔ docs/boundary-log)', () => {
    test('anchor unik, link indeks valid dua arah, baris indeks ringkas', () => {
        const { errors, stats } = checkBoundaryIndex();
        expect(errors).toEqual([]);
        expect(stats.anchors).toBeGreaterThan(0);
        expect(stats.indexLinks).toBeGreaterThanOrEqual(stats.anchors);
    });
});
