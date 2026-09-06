/**
 * Header Doc
 * Purpose: Kunci #b326 — (1) adminOnly terima admin/owner/superadmin (bukan === 'admin' persis, yang
 *   mengunci kelola-akun untuk owner/superadmin); (2) create dibungkus withLock + tolak id kembar
 *   (anti akun ter-shadow); (3) UPDATE role punya guard admin-TERAKHIR (mirror DELETE) supaya demote
 *   satu-satunya admin tak mengunci seluruh panel.
 * Caller: Jest.
 * Deps: baca sumber routes/accounts.js.
 * SideEffects: -
 */
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'accounts.js'), 'utf8');

describe('accounts route hardening (#b326)', () => {
    test('adminOnly terima owner/superadmin, bukan === "admin" persis', () => {
        expect(src).toMatch(/ADMIN_ROLES\s*=\s*\[[^\]]*'owner'[^\]]*'superadmin'/);
        expect(src).not.toMatch(/req\.user\.role !== 'admin'/);
    });

    test('create dibungkus withLock + tolak id kembar', () => {
        expect(src).toMatch(/withLock\('create-account'/);
        expect(src).toMatch(/Konflik ID akun/);
    });

    test('UPDATE role punya guard admin-TERAKHIR (mirror DELETE)', () => {
        const upIdx = src.indexOf("router.post('/accounts/:id'");
        const blk = src.slice(upIdx, src.indexOf('// Update fields', upIdx));
        expect(blk).toMatch(/Tidak dapat menurunkan role admin terakhir/);
    });
});
