/**
 * Header Doc
 * Purpose: Facade source-of-truth ledger pembayaran periodik — re-export API publik; implementasi kini di `lib/payment-finance/`.
 * Caller: Route payment, approval service, billing service, cron, dan diagnostics pembayaran.
 * Deps: `lib/payment-finance/ledger` (infra DB/reader + schema + ledger ops), `waivers` (payment_waivers/GRATIS),
 *       `read-model` (timeline, report, diagnostics).
 * MainFuncs: `applyPaymentStatusChange`, `applyFreeMonth`, `getPaymentPositionForPeriod`, `syncUserPaidStatusForCurrentPeriod`,
 *   `listPaymentHistoryUserIdsForPeriod`, `getPaymentDiagnostics`, `withPaymentReadContext`.
 * SideEffects: tidak ada logika di sini — pemecahan murni (#b394); `initializationPromise`, koneksi reader bersama,
 *   dan self-heal skema tetap singleton karena semua submodul berbagi `./ledger` (cache require Node).
 */
"use strict";

const ledger = require("./payment-finance/ledger");
const waivers = require("./payment-finance/waivers");
const readModel = require("./payment-finance/read-model");

module.exports = {
    ensurePaymentFinanceTables: ledger.ensurePaymentFinanceTables,
    getCurrentBillingPeriod: ledger.getCurrentBillingPeriod,
    getPackagePrice: ledger.getPackagePrice,
    getEffectivePrice: ledger.getEffectivePrice,
    resolveBillingAmount: ledger.resolveBillingAmount,
    normalizeUserPaymentMethod: ledger.normalizeUserPaymentMethod,
    normalizePaymentRequestScope: ledger.normalizePaymentRequestScope,
    isSamePaymentRequestScope: ledger.isSamePaymentRequestScope,
    getPaymentPositionForPeriod: ledger.getPaymentPositionForPeriod,
    listPaymentHistoryUserIdsForPeriod: ledger.listPaymentHistoryUserIdsForPeriod,
    syncUserPaidStatusForPeriod: ledger.syncUserPaidStatusForPeriod,
    syncUserPaidStatusForCurrentPeriod: ledger.syncUserPaidStatusForCurrentPeriod,
    getPaymentTimelineForPeriod: readModel.getPaymentTimelineForPeriod,
    getPaymentReportForPeriod: readModel.getPaymentReportForPeriod,
    applyPaymentStatusChange: ledger.applyPaymentStatusChange,
    applyFreeMonth: waivers.applyFreeMonth,
    getPaymentDiagnostics: readModel.getPaymentDiagnostics,
    withPaymentReadContext: ledger.withPaymentReadContext
};
