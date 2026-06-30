/**
 * Header Doc
 * Purpose: Selector multi-gateway pembayaran. Memilih adapter AKTIF via config `paymentGateway`
 *   ('ipaymu' default | 'tripay') dan menyeragamkan ke interface tipis yang dipakai alur bayar
 *   tagihan: `chargeRedirect()` (buat transaksi → URL redirect ke halaman gateway yang auto-settle)
 *   + `verify()` (S2S cek status, dipakai callback). Adapter membungkus klien gateway masing-masing.
 * Caller: routes/bill-payment.js (GET /bayar/:token mode redirect + callback Tripay).
 * Deps: ./ipaymu (payHosted, checkTransaction), ./tripay (createCharge, checkTransaction).
 * MainFuncs: getActiveName, getGateway, getActive.
 * SideEffects: Tidak ada (delegasi HTTP ke klien gateway).
 */
"use strict";

const ipaymu = require("./ipaymu");
const tripay = require("./tripay");

function cfg() {
    return global.config || {};
}

// Adapter interface seragam:
//   name
//   chargeRedirect(props) → { url, reference, gateway }   // props: {amount, reffId, name, phone, email, comment, returnUrl, cancelUrl, sandbox}
//   verify(reference, opts) → { ok, paid, referenceId, amount, ... }
const ADAPTERS = {
    ipaymu: {
        name: "ipaymu",
        async chargeRedirect(p) {
            const r = await ipaymu.payHosted(p);
            // iPaymu hosted: TransactionId belum ada saat buat sesi → callback pakai payload trx_id.
            return { url: r.url, reference: null, sessionId: r.sessionId, gateway: "ipaymu" };
        },
        verify: (ref, opts) => ipaymu.checkTransaction(ref, opts),
    },
    tripay: {
        name: "tripay",
        async chargeRedirect(p) {
            // Tripay = closed payment butuh 1 metode. Default QRIS (universal e-wallet+m-banking),
            // bisa di-override config.tripayDefaultMethod. checkout_url = halaman Tripay auto-settle.
            const method = cfg().tripayDefaultMethod || "QRIS";
            const r = await tripay.createCharge({ ...p, method });
            return { url: r.url, reference: r.reference, gateway: "tripay" };
        },
        verify: (ref, opts) => tripay.checkTransaction(ref, opts),
    },
};

function getActiveName() {
    const name = String(cfg().paymentGateway || "ipaymu").toLowerCase();
    return ADAPTERS[name] ? name : "ipaymu";
}

function getGateway(name) {
    return ADAPTERS[String(name || "").toLowerCase()] || ADAPTERS.ipaymu;
}

function getActive() {
    return ADAPTERS[getActiveName()];
}

module.exports = { getActiveName, getGateway, getActive, ADAPTERS };
