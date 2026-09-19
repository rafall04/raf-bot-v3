/**
 * Header Doc
 * Purpose: Membangun workbook Excel pelanggan yang dipakai bersama oleh fitur download template dan export data agar struktur sheet selalu konsisten.
 * Caller: `./export-users-excel`, `services/api-users.service.js` melalui method `buildUsersExcelTemplate`.
 * Deps: `./users-excel-schema` dan package `exceljs` (lazy-loaded).
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

let cachedExcelJs = null;

function getExcelJs() {
    if (!cachedExcelJs) {
        cachedExcelJs = require("exceljs");
    }
    return cachedExcelJs;
}

async function createUsersExcelWorkbook(rows = []) {
    const ExcelJS = getExcelJs();
    const workbook = new ExcelJS.Workbook();
    const columnKeys = getExcelColumnKeys();
    const columnWidths = getExcelColumnWidths();

    const dataSheet = workbook.addWorksheet(USER_EXCEL_SHEET_NAME);
    dataSheet.columns = columnKeys.map((key, index) => ({
        header: key,
        key,
        width: columnWidths[index]?.wch || 18
    }));
    rows.forEach((row) => dataSheet.addRow(row));

    const guideSheet = workbook.addWorksheet(USER_EXCEL_GUIDE_SHEET_NAME);
    guideSheet.columns = [
        { width: 24 },
        { width: 18 },
        { width: 78 },
        { width: 28 }
    ];
    buildGuideSheetRows().forEach((row) => guideSheet.addRow(row));

    return workbook;
}

async function writeWorkbookToBuffer(workbook) {
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}

async function buildUsersExcelTemplate() {
    const workbook = await createUsersExcelWorkbook([buildSampleImportRow()]);

    return {
        filename: `template-import-pelanggan-${new Date().toISOString().slice(0, 10)}.xlsx`,
        contentType: USER_EXCEL_CONTENT_TYPE,
        buffer: await writeWorkbookToBuffer(workbook)
    };
}

module.exports = {
    createUsersExcelWorkbook,
    writeWorkbookToBuffer,
    buildUsersExcelTemplate
};
