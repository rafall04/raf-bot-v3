/**
 * Header Doc
 * Purpose: Repository voucher untuk membungkus akses katalog dan inventory voucher dari runtime/cache legacy.
 * Caller: Service atau facade domain voucher selama normalisasi repository.
 * Deps: `global.__appRuntime` dan fallback cache legacy `global.voucher`.
 * MainFuncs: `createVoucherRepository`, `getVoucherCatalog`, dan `findVoucherProfile`.
 * SideEffects: Tidak ada; hanya membaca katalog voucher dari runtime atau cache legacy.
 */
"use strict";

function createVoucherRepository(options = {}) {
    const runtime = options.runtime || global.__appRuntime || null;
    const globalScope = options.globalScope || runtime?.globalScope || global;

    return {
        getVoucherCatalog() {
            return runtime?.repositories?.voucher?.getAll() || globalScope.voucher || [];
        },

        findVoucherProfile(profileName) {
            return this.getVoucherCatalog().find((item) => String(item.prof) === String(profileName)) || null;
        }
    };
}

module.exports = {
    createVoucherRepository
};
