/**
 * Header Doc
 * Purpose: Memusatkan import dan mount seluruh router HTTP agar urutan route konsisten dan mudah diuji.
 * Caller: `index.js`.
 * Deps: Seluruh modul router pada `routes/`.
 * MainFuncs: `registerRoutes`.
 * SideEffects: Mendaftarkan route ke instance Express sesuai urutan legacy.
 */
"use strict";

const { createAdminRouter } = require("../routes/admin-router");

function registerRoutes(app, runtime) {
    const publicApiRouter = require("../routes/public");
    const publicAnonymousRouter = require("../routes/public-anonymous");
    const billPaymentRouter = require("../routes/bill-payment");
    const legalPagesRouter = require("../routes/legal-pages");
    const adminApiRouter = createAdminRouter({ runtime });
    const apiRouter = require("../routes/api");
    const ticketsRouter = require("../routes/tickets");
    const invoiceRouter = require("../routes/invoice");
    const paymentStatusRouter = require("../routes/payment-status");
    const requestsRouter = require("../routes/requests");
    const compensationRouter = require("../routes/compensation");
    const speedRequestsRouter = require("../routes/speed-requests");
    const statsRouter = require("../routes/stats");
    const usersRouter = require("../routes/users");
    const accountsRouter = require("../routes/accounts");
    const packagesRouter = require("../routes/packages");
    const saldoRouter = require("../routes/saldo");
    const agentsRouter = require("../routes/agents");
    const pagesRouter = require("../routes/pages");
    const monitoringApiRouter = require("../routes/monitoring-api");
    const kasbonRouter = require("../routes/kasbon");
    const partialPaymentRouter = require("../routes/partial-payment");
    const discountRouter = require("../routes/discount");
    const changePackageRouter = require("../routes/change-package");
    const messageTemplatesRouter = require("../routes/message-templates");
    const rekapKeuanganRouter = require("../routes/rekap-keuangan");
    const expensesRouter = require("../routes/expenses");
    const gajiRouter = require("../routes/gaji");
    const oltRouter = require("../routes/olt");
    const oltProvisioningRouter = require("../routes/olt-provisioning");
    const oltStateRouter = require("../routes/olt-state");
    const cctvRouter = require("../routes/cctv");
    const technicianSettlementRouter = require("../routes/technician-settlement");
    const agenRouter = require("../routes/agen");

    app.use("/", publicApiRouter);
    // Surface anonim beli voucher (/voucher, /app/*) — owner tunggal, di-mount juga di
    // app publik (lib/public-site-app) pada port terpisah. Di app utama demi kompat link lama.
    app.use("/", publicAnonymousRouter);
    app.use("/", billPaymentRouter);
    app.use("/", legalPagesRouter);
    app.use("/api/payment-status", paymentStatusRouter);
    app.use("/api/requests", requestsRouter);
    app.use("/", adminApiRouter);
    app.use("/api/users", usersRouter);
    app.use("/api/saldo", saldoRouter);
    app.use("/api/agents", agentsRouter);
    app.use("/api/kasbon", kasbonRouter);
    app.use("/api/gaji", gajiRouter);
    app.use("/api/partial-payment", partialPaymentRouter);
    app.use("/api/discount", discountRouter);
    app.use("/api/change-package", changePackageRouter);
    app.use("/api/message-templates", messageTemplatesRouter);
    app.use("/api/rekap-keuangan", rekapKeuanganRouter);
    app.use("/api/expenses", expensesRouter);
    app.use("/api/olt", oltRouter);
    app.use("/api/olt", oltProvisioningRouter); // provisioning ONU + backup via SSH (path /api/olt/provision/*)
    app.use("/api/olt", oltStateRouter); // read API state modem OLT (path /api/olt/modem-state|diagnosis|incidents)
    app.use("/api/cctv", cctvRouter);
    app.use("/api/technician-settlement", technicianSettlementRouter);
    app.use("/api/agen", agenRouter);
    app.use("/api/monitoring", monitoringApiRouter);
    app.use("/", packagesRouter);
    app.use("/api", accountsRouter);
    app.use("/api", apiRouter);
    app.use("/api", ticketsRouter);
    app.use("/api", invoiceRouter);
    app.use("/api", compensationRouter);
    app.use("/api", speedRequestsRouter);
    app.use("/api", statsRouter);
    app.use("/", pagesRouter);

    return app;
}

module.exports = {
    registerRoutes
};
