/**
 * Header Doc
 * Purpose: Membangun workbook Excel pelanggan yang dipakai bersama oleh fitur download template dan export data agar struktur sheet selalu konsisten.
 * Caller: `./export-users-excel`, `services/api-users.service.js` melalui method `buildUsersExcelTemplate`.
 * Deps: `./users-excel-schema` dan package `xlsx` (lazy-loaded).
 * MainFuncs: `createUsersExcelWorkbook`, `buildUsersExcelTemplate`.
 * SideEffects: Tidak ada; hanya membentuk buffer workbook di memory.
 */
"use strict";

const {
    USER_EXCEL_SHEET_NAME,
    USER_EXCEL_GUIDE_SHEET_NAME,
    USER_EXCEL_CONTENT_TYPE,
    getExcelColumnKeys,
    getExcelColumnWidths,
    buildGuideSheetRows,
    buildSampleImportRow
} = require("./users-excel-schema");

let cachedXlsx = null;

function getXlsx() {
    if (!cachedXlsx) {
        cachedXlsx = require("xlsx");
    }
    return cachedXlsx;
}

function createUsersExcelWorkbook(rows = []) {
    const XLSX = getXlsx();
    const workbook = XLSX.utils.book_new();
    const columnKeys = getExcelColumnKeys();

    const dataSheet = rows.length > 0
        ? XLSX.utils.json_to_sheet(rows, { header: columnKeys })
        : XLSX.utils.aoa_to_sheet([columnKeys]);
    dataSheet["!cols"] = getExcelColumnWidths();

    const guideSheet = XLSX.utils.aoa_to_sheet(buildGuideSheetRows());
    guideSheet["!cols"] = [
        { wch: 24 },
        { wch: 18 },
        { wch: 78 },
        { wch: 28 }
    ];

    XLSX.utils.book_append_sheet(workbook, dataSheet, USER_EXCEL_SHEET_NAME);
    XLSX.utils.book_append_sheet(workbook, guideSheet, USER_EXCEL_GUIDE_SHEET_NAME);

    return workbook;
}

function buildUsersExcelTemplate() {
    const XLSX = getXlsx();
    const workbook = createUsersExcelWorkbook([buildSampleImportRow()]);

    return {
        filename: `template-import-pelanggan-${new Date().toISOString().slice(0, 10)}.xlsx`,
        contentType: USER_EXCEL_CONTENT_TYPE,
        buffer: XLSX.write(workbook, {
            bookType: "xlsx",
            type: "buffer"
        })
    };
}

module.exports = {
    createUsersExcelWorkbook,
    buildUsersExcelTemplate
};
