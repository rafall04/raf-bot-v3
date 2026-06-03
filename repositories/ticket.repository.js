/**
 * Header Doc
 * Purpose: Repository ticket untuk meng-own persistence draft laporan dan ticket id boundary legacy.
 * Caller: Service/facade reporting dan compatibility handler ticket selama normalisasi repository.
 * Deps: `fs`, `path`, dan `lib/ticket-id`.
 * MainFuncs: `createTicketRepository`, `saveReportDraft`, dan `generateTicketId`.
 * SideEffects: Menulis file `database/reports.json` melalui owner repository tunggal.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { generateTicketId } = require("../lib/ticket-id");

const reportsDbPath = path.join(__dirname, "../database/reports.json");

function createTicketRepository(options = {}) {
    const writeFileSync = options.writeFileSync || fs.writeFileSync;
    const repositoryReportsPath = options.reportsDbPath || reportsDbPath;
    const generateTicketIdImpl = options.generateTicketId || generateTicketId;

    return {
        saveReportDraft(reports) {
            writeFileSync(repositoryReportsPath, JSON.stringify(reports, null, 2), "utf8");
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
