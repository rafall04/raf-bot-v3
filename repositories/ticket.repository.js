/**
 * Header Doc
 * Purpose: Repository ticket untuk meng-own persistence draft laporan dan ticket id boundary legacy.
 * Caller: Service/facade reporting dan compatibility handler ticket selama normalisasi repository.
 * Deps: `fs`, `path`, `lib/ticket-id`, dan `lib/atomic-file` (tulis atomik).
 * MainFuncs: `createTicketRepository`, `saveReportDraft`, dan `generateTicketId`.
 * SideEffects: Menulis file `database/reports.json` (ATOMIK tmp+rename) melalui owner repository tunggal.
 */
"use strict";

const path = require("path");
const { generateTicketId } = require("../lib/ticket-id");
const { writeFileAtomicSync } = require("../lib/atomic-file");

const reportsDbPath = path.join(__dirname, "../database/reports.json");

function createTicketRepository(options = {}) {
    const repositoryReportsPath = options.reportsDbPath || reportsDbPath;
    const generateTicketIdImpl = options.generateTicketId || generateTicketId;
    // reports.json = ledger tiket (SEMUA tiket terbuka). Tulis LANGSUNG (writeFileSync) berisiko:
    // proses mati di tengah tulis (PM2 SIGKILL / listrik padam, prod restart 7-13x/hari) → berkas
    // terpotong → loadJSON mengkarantina → global.reports=[] → SEMUA tiket lenyap senyap. #b345:
    // tulis ATOMIK (tmp+rename). options.writeFileSync dipertahankan untuk uji (spy penulis),
    // tapi default produksi = writeFileAtomicSync.
    const writeDraft = options.writeFileSync
        ? (p, c) => options.writeFileSync(p, c, "utf8")
        : (p, c) => writeFileAtomicSync(p, c);

    return {
        saveReportDraft(reports) {
            writeDraft(repositoryReportsPath, JSON.stringify(reports, null, 2));
            return reports;
        },

        generateTicketId() {
            return generateTicketIdImpl();
        }
    };
}

module.exports = {
    createTicketRepository
};
