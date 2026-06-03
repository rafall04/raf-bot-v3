/**
 * Header Doc
 * Purpose: Menghasilkan workbook Excel berisi data pelanggan aktif dari snapshot repository users agar admin dapat melakukan export operasional dengan format yang sama seperti template import.
 * Caller: `services/api-users.service.js` melalui method `exportUsersToExcel`.
 * Deps: `./users-excel-schema`, `./users-excel-template`, dan package `xlsx` (lazy-loaded).
 * MainFuncs: `exportUsersToExcel`.
 * SideEffects: Tidak ada; hanya membentuk buffer workbook di memory.
 */
"use strict";

const { USER_EXCEL_CONTENT_TYPE, mapUserToExportRow } = require("./users-excel-schema");
const { createUsersExcelWorkbook } = require("./users-excel-template");

let cachedXlsx = null;

function getXlsx() {
    if (!cachedXlsx) {
        cachedXlsx = require("xlsx");
    }
    return cachedXlsx;
}

function sortUsersForExport(users) {
    return [...users].sort((left, right) => {
        const leftId = Number(left?.id);
        const rightId = Number(right?.id);

        if (!Number.isNaN(leftId) && !Number.isNaN(rightId)) {
            return leftId - rightId;
        }

        return String(left?.id || "").localeCompare(String(right?.id || ""), "id");
    });
}

function exportUsersToExcel(deps) {
    const XLSX = getXlsx();
    const users = deps.repository?.getUsersSnapshot?.() || [];
    const rows = sortUsersForExport(users).map((user) => mapUserToExportRow(user));
    const workbook = createUsersExcelWorkbook(rows);

    return {
        filename: `export-pelanggan-${new Date().toISOString().slice(0, 10)}.xlsx`,
        contentType: USER_EXCEL_CONTENT_TYPE,
        rowCount: rows.length,
        buffer: XLSX.write(workbook, {
            bookType: "xlsx",
            type: "buffer"
        })
    };
}

module.exports = {
    exportUsersToExcel
};
