/**
 * Header Doc
 * Purpose: Repository saldo untuk membungkus lookup saldo user dan topup request dari helper persistence existing.
 * Caller: Service/facade domain saldo selama normalisasi repository.
 * Deps: `lib/saldo-manager`.
 * MainFuncs: `createSaldoRepository`, `getSaldoUser`, dan `createSaldoUser`.
 * SideEffects: Membaca/menulis SQLite saldo melalui `saldo-manager`.
 */
"use strict";

const saldoManager = require("../lib/saldo-manager");

function createSaldoRepository() {
    return {
        getSaldoUser(senderId) {
            return saldoManager.getUserSaldo(senderId);
        },

        createSaldoUser(senderId, pushname) {
            return saldoManager.createUserSaldo(senderId, pushname);
        }
    };
}

module.exports = {
    createSaldoRepository
};
