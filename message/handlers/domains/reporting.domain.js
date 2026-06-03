/**
 * Header Doc
 * Purpose: Facade owner intent reporting/ticket prioritas untuk flow laporan gangguan pelanggan.
 * Caller: `message/handlers/domain-handlers.js` dan `message/handlers/raf-intent-dispatch.js`.
 * Deps: `../smart-report-text-menu`, `../../../lib/template-service`.
 * MainFuncs: `handleReportingIntent`.
 * SideEffects: Memulai flow laporan dan mengirim balasan awal ke pelanggan.
 */
"use strict";

const { deleteUserState } = require("../conversation-handler");
const { startReportFlow, handleMenuSelection } = require("../smart-report-text-menu");
const { renderCategoryTemplate } = require("../../../lib/template-service");

function renderResponseTemplate(key, data = {}) {
    const result = renderCategoryTemplate("responseTemplates", key, data);
    return result.found ? result.text : key;
}

async function handleReportingIntent(context) {
    const { intent, sender, stateSender, pushname, reply, msg, raf } = context;

    if (intent !== "LAPOR_GANGGUAN" && intent !== "LAPOR_GANGGUAN_MATI") {
        return { handled: false };
    }

    deleteUserState(stateSender);

    if (intent === "LAPOR_GANGGUAN_MATI") {
        await reply(renderResponseTemplate("reporting_domain_checking_device"));
    }

    const result = await startReportFlow({
        sender,
        stateKey: stateSender,
        pushname,
        reply,
        msg,
        raf
    });

    if (intent === "LAPOR_GANGGUAN_MATI") {
        const followUp = await handleMenuSelection({
            sender,
            stateKey: stateSender,
            choice: "1",
            reply,
            msg,
            raf
        });
        // Saat MATI, flow langsung maju ke menu troubleshoot. Cukup kirim pesan
        // troubleshoot itu saja; JANGAN kirim ulang menu utama (result.message)
        // karena akan tampil setelah troubleshoot dan bertentangan dengan state
        // aktif REPORT_MATI_TROUBLESHOOT (konsisten dengan path LEMOT).
        if (followUp && followUp.message) {
            await reply(followUp.message);
            return { handled: true, result };
        }
    }

    if (result && result.message) {
        await reply(result.message);
    }

    return { handled: true, result };
}

module.exports = {
    handleReportingIntent
};
