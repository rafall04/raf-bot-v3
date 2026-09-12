/**
 * Header Doc
 * Purpose: Hook post-lunas BERSAMA untuk kirim invoice PDF / struk teks ke pelanggan — diekstrak dari
 *   lib/approval-logic.handlePaidStatusChange supaya jalur pelunasan LAIN (settleTagihanPayment: bukti
 *   foto WA, portal konfirmasi, callback iPaymu/Tripay/Mayar) bisa memanggilnya juga. Dulu invoice
 *   HANYA hidup di handlePaidStatusChange sehingga jalur ledger-only tak pernah kirim invoice.
 *   3 perbaikan vs versi lama: (1) DECOUPLE dari gate notif-teks (invoice terkirim bila send_invoice ON
 *   walau `status_message_paid_notification` OFF); (2) ANTI SILENT-DROP (createInvoice null → tetap
 *   kirim struk teks, bukan nol pesan); (3) normalisasi flag send_invoice (true/1/"1"/"true").
 * Caller: lib/approval-logic.handlePaidStatusChange, lib/services/bill-payment-settlement (gated).
 * Deps (di-inject supaya teruji): deliver({jid,payload}), waitForWhatsAppDelay, normalizePhoneNumber,
 *   renderTemplate, invoice-generator, pdf-invoice-generator (di-require lazy).
 * MainFuncs: isSendInvoiceEnabled(v), sendPaidInvoiceOrReceipt(user, opts).
 * SideEffects: Kirim WhatsApp (dokumen/teks) + tulis database/invoice_errors.json saat gagal. NEVER-THROW.
 */
"use strict";

/** Normalisasi flag send_invoice: terima boolean true / 1 / "1" / "true" (tahan payload non-boolean). */
function isSendInvoiceEnabled(v) {
    return v === true || v === 1 || v === "1" || v === "true";
}

async function _sendTextToAllPhones(user, text, deps) {
    const { deliver, waitForWhatsAppDelay, normalizePhoneNumber } = deps;
    let sent = 0;
    for (const number of String(user.phone_number || "").split("|")) {
        if (!number || number.trim() === "") continue;
        const norm = normalizePhoneNumber(number);
        if (norm && norm.length > 8) {
            await waitForWhatsAppDelay(1000);
            await deliver(norm + "@s.whatsapp.net", { text });
            sent += 1;
        }
    }
    return sent;
}

/**
 * Kirim invoice PDF (bila send_invoice ON) atau struk teks. NEVER-THROW.
 * @param {object} user  wajib punya phone_number + send_invoice.
 * @param {object} opts
 * @param {string} opts.messageText  struk teks (jadi caption PDF / body teks).
 * @param {object} [opts.paymentDetails]
 * @param {object} [opts.config]  utk kustomisasi invoice (default global.config).
 * @param {boolean} [opts.notifEnabled]  gate struk TEKS (invoice PDF TIDAK di-gate ini — decoupled).
 * @param {object} opts.deps  { deliver, waitForWhatsAppDelay, normalizePhoneNumber, renderTemplate }.
 * @returns {Promise<{mode:string, sent:number}>}
 */
async function sendPaidInvoiceOrReceipt(user, opts = {}) {
    const { messageText, paymentDetails = {}, config = (typeof global !== "undefined" ? global.config : {}), notifEnabled = false, deps = {} } = opts;
    try {
        if (!user || !user.phone_number || typeof deps.deliver !== "function") return { mode: "skip-no-target", sent: 0 };
        const wantInvoice = isSendInvoiceEnabled(user.send_invoice);

        // send_invoice OFF: cuma struk teks, dan itu pun HANYA bila notif-teks aktif (perilaku lama).
        if (!wantInvoice) {
            if (!notifEnabled) return { mode: "skip-notif-off", sent: 0 };
            const sent = await _sendTextToAllPhones(user, messageText, deps);
            return { mode: "text", sent };
        }

        // send_invoice ON: invoice PDF SELALU (decoupled dari notifEnabled).
        const { createInvoice, buatCustomizationInvoice } = require("./invoice-generator");
        const { createInvoicePDF } = require("./pdf-invoice-generator");
        const invoiceData = createInvoice(user, {
            paidDate: paymentDetails.paidDate || new Date().toISOString(),
            method: paymentDetails.method || "CASH",
            approvedBy: paymentDetails.approvedBy || "Admin",
            notes: paymentDetails.notes || "Pembayaran telah disetujui dan diverifikasi.",
        });
        // ANTI SILENT-DROP: createInvoice null (autoSend off / invoices.json gagal) → tetap kirim teks.
        if (!invoiceData) {
            console.warn(`[INVOICE_ON_PAID] createInvoice null utk ${user.name} — fallback struk teks (bukan nol pesan).`);
            const sent = await _sendTextToAllPhones(user, messageText, deps);
            return { mode: "text-null-invoice", sent };
        }

        // Generate PDF dgn retry (perilaku lama: 3x, jeda 2s antar-coba).
        let pdfResult = null;
        let retry = 0;
        const maxRetries = 3;
        while (retry < maxRetries && !pdfResult) {
            try {
                if (retry > 0) await deps.waitForWhatsAppDelay(2000);
                pdfResult = await createInvoicePDF(invoiceData, buatCustomizationInvoice(config));
            } catch (pdfError) {
                retry += 1;
                console.error(`[INVOICE_ON_PAID] generate PDF gagal (attempt ${retry}):`, pdfError.message);
                if (retry >= maxRetries) throw pdfError;
            }
        }

        let sent = 0;
        for (const number of String(user.phone_number).split("|")) {
            if (!number || number.trim() === "") continue;
            const norm = deps.normalizePhoneNumber(number);
            if (norm && norm.length > 8) {
                await deps.waitForWhatsAppDelay(1000);
                await deps.deliver(norm + "@s.whatsapp.net", {
                    document: pdfResult.buffer,
                    fileName: `Invoice_${invoiceData.invoiceNumber}.pdf`,
                    mimetype: "application/pdf",
                    caption: messageText,
                });
                sent += 1;
            }
        }
        try { const fs = require("fs"); if (pdfResult.path && fs.existsSync(pdfResult.path)) fs.unlinkSync(pdfResult.path); } catch (_e) { /* cleanup best-effort */ }
        return { mode: "pdf", sent, invoiceNumber: invoiceData.invoiceNumber };
    } catch (invoiceError) {
        // Generate/kirim PDF gagal → log + fallback struk teks (+ pesan invoice_fallback).
        console.error(`[INVOICE_ON_PAID_ERROR] invoice gagal utk ${user && user.name}:`, invoiceError && invoiceError.message);
        try {
            const fs = require("fs");
            const path = require("path");
            const p = path.join(__dirname, "..", "database", "invoice_errors.json");
            let errs = [];
            if (fs.existsSync(p)) errs = JSON.parse(fs.readFileSync(p, "utf8"));
            errs.push({ timestamp: new Date().toISOString(), userId: user && user.id, userName: user && user.name, error: invoiceError && invoiceError.message, type: "PDF_GENERATION_FAILED" });
            fs.writeFileSync(p, JSON.stringify(errs, null, 2));
        } catch (_logErr) { /* log best-effort */ }
        try {
            const fb = typeof deps.renderTemplate === "function"
                ? deps.renderTemplate("invoice_fallback", { nama_pelanggan: user.name, nama_paket: user.subscription || "N/A", tanggal: new Date().toLocaleDateString("id-ID") })
                : "";
            const combined = fb ? `${messageText}\n\n${fb}` : messageText;
            const sent = await _sendTextToAllPhones(user, combined, deps);
            return { mode: "text-fallback", sent };
        } catch (_e) {
            return { mode: "error", sent: 0 };
        }
    }
}

module.exports = { isSendInvoiceEnabled, sendPaidInvoiceOrReceipt };
