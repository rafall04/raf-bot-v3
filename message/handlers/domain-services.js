/**
 * Header Doc
 * Purpose: Facade helper domain legacy untuk router bot dengan precedence repository owner pada concern voucher, saldo, dan ticket.
 * Caller: `message/raf.js` dan domain handler prioritas.
 * Deps: `../../lib/voucher`, `../../lib/statik`, `../../lib/saldo`, dan repository owner saldo/ticket/voucher.
 * MainFuncs: Mengekspor helper legacy, `resolveDomainRepositories`, dan helper repo-first untuk voucher/saldo/ticket.
 * SideEffects: Tidak ada; hanya re-export dependency dan delegasi lookup ke repository owner.
 */
"use strict";

const voucher = require("../../lib/voucher");
const statik = require("../../lib/statik");
const saldo = require("../../lib/saldo");
const { createSaldoRepository } = require("../../repositories/saldo.repository");
const { createTicketRepository } = require("../../repositories/ticket.repository");
const { createVoucherRepository } = require("../../repositories/voucher.repository");

function resolveDomainRepositories(runtime) {
    return {
        saldo: runtime?.repositories?.saldo || createSaldoRepository(),
        ticket: runtime?.repositories?.ticket || createTicketRepository(),
        voucher: runtime?.repositories?.voucherRepository || createVoucherRepository({ runtime })
    };
}

function getVoucherCatalogFromRepository(runtime) {
    return resolveDomainRepositories(runtime).voucher.getVoucherCatalog();
}

function findVoucherProfileFromRepository(runtime, profileName) {
    return resolveDomainRepositories(runtime).voucher.findVoucherProfile(profileName);
}

function getSaldoUserFromRepository(runtime, senderId) {
    return resolveDomainRepositories(runtime).saldo.getSaldoUser(senderId);
}

function createSaldoUserFromRepository(runtime, senderId, pushname) {
    return resolveDomainRepositories(runtime).saldo.createSaldoUser(senderId, pushname);
}

function saveReportDraftFromRepository(runtime, reports) {
    return resolveDomainRepositories(runtime).ticket.saveReportDraft(reports);
}

function generateTicketIdFromRepository(runtime) {
    return resolveDomainRepositories(runtime).ticket.generateTicketId();
}

module.exports = {
    ...voucher,
    ...statik,
    ...saldo,
    resolveDomainRepositories,
    getVoucherCatalogFromRepository,
    findVoucherProfileFromRepository,
    getSaldoUserFromRepository,
    createSaldoUserFromRepository,
    saveReportDraftFromRepository,
    generateTicketIdFromRepository
};
