/**
 * Header Doc
 * Purpose: Guardrail contract test untuk repository voucher.
 * Caller: Jest test runner.
 * Deps: `../voucher.repository`.
 * MainFuncs: Memverifikasi repository voucher mengekspose katalog dan lookup profil voucher.
 * SideEffects: Tidak ada.
 */
"use strict";

const { createVoucherRepository } = require("../voucher.repository");

describe("voucher repository contract", () => {
    test("voucher repository exposes catalog and profile lookup reads", () => {
        const voucherCatalog = [{ prof: "VC-1" }];
        const repository = createVoucherRepository({
            runtime: {
                repositories: {
                    voucher: {
                        getAll: () => voucherCatalog
                    }
                }
            }
        });

        expect(repository.getVoucherCatalog).toEqual(expect.any(Function));
        expect(repository.findVoucherProfile).toEqual(expect.any(Function));
        expect(repository.getVoucherCatalog()).toBe(voucherCatalog);
        expect(repository.findVoucherProfile("VC-1")).toEqual({ prof: "VC-1" });
    });
});
