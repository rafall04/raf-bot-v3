/**
 * Header Doc
 * Purpose: Menangani parsing workbook Excel pelanggan, validasi preview, dan commit import create/update dengan memanfaatkan owner service users yang sudah ada agar tidak membuat write-path baru.
 * Caller: `services/api-users.service.js` melalui method `importUsersFromExcel`.
 * Deps: `../../lib/error-handler`, `./users-excel-schema`, package `xlsx` (lazy-loaded), `deps.repository`, `deps.getPackages`, `deps.validatePhoneNumbers`, `deps.getDb`, `deps.logger`, dan method service owner `upsertUserFromAdminPanel`/`updateUserById`.
 * MainFuncs: `importUsersFromExcel`.
 * SideEffects: Membaca workbook dari memory, memvalidasi row import, lalu saat mode `commit` menulis create/update pelanggan via owner service.
 */
"use strict";

const { createError, ErrorTypes } = require("../../lib/error-handler");
const {
    USER_EXCEL_SHEET_NAME,
    validateImportHeaders,
    normalizeImportRow,
    isImportRowEmpty,
    isSampleRow
} = require("./users-excel-schema");

let cachedXlsx = null;

function getXlsx() {
    if (!cachedXlsx) {
        cachedXlsx = require("xlsx");
    }
    return cachedXlsx;
}

function normalizeMode(value) {
    return String(value || "validate").toLowerCase() === "commit" ? "commit" : "validate";
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function buildCreatePayload(data, explicitFields) {
    const payload = {
        registration_mode: "import",
        add_to_mikrotik: false,
        skip_mikrotik: true,
        paid: explicitFields.paid ? Boolean(data.paid) : false,
        send_invoice: explicitFields.send_invoice ? Boolean(data.send_invoice) : false,
        is_corporate: explicitFields.is_corporate ? Boolean(data.is_corporate) : false
    };

    [
        "name",
        "phone_number",
        "address",
        "subscription",
        "pppoe_username",
        "device_id",
        "connected_odp_id",
        "latitude",
        "longitude",
        "payment_method",
        "corporate_name",
        "corporate_address",
        "corporate_npwp",
        "corporate_pic_name",
        "corporate_pic_phone",
        "corporate_pic_email",
        "account_type"
    ].forEach((field) => {
        if (!explicitFields[field]) {
            return;
        }
        if (data[field] === null || typeof data[field] === "undefined") {
            return;
        }
        payload[field] = data[field];
    });

    if (explicitFields.bulk && Array.isArray(data.bulk) && data.bulk.length > 0) {
        payload.bulk = data.bulk;
    }

    return payload;
}

function buildUpdatePayload(data, explicitFields) {
    const payload = {};

    [
        "name",
        "phone_number",
        "address",
        "subscription",
        "pppoe_username",
        "device_id",
        "connected_odp_id",
        "latitude",
        "longitude",
        "paid",
        "payment_method",
        "send_invoice",
        "bulk",
        "is_corporate",
        "corporate_name",
        "corporate_address",
        "corporate_npwp",
        "corporate_pic_name",
        "corporate_pic_phone",
        "corporate_pic_email",
        "account_type"
    ].forEach((field) => {
        if (!explicitFields[field]) {
            return;
        }
        if (data[field] === null || typeof data[field] === "undefined") {
            return;
        }
        payload[field] = data[field];
    });

    return payload;
}

async function validatePreparedRow(deps, preparedRow) {
    const errors = [...preparedRow.errors];
    const packages = typeof deps.getPackages === "function" ? safeArray(deps.getPackages()) : [];
    const { data, explicitFields, action } = preparedRow;

    if (data.id && !preparedRow.existingUser) {
        errors.push(`User dengan id \"${data.id}\" tidak ditemukan.`);
    }

    if (action === "create") {
        if (!data.name) {
            errors.push("name wajib diisi untuk create pelanggan baru.");
        }
        if (!data.subscription) {
            errors.push("subscription wajib diisi untuk create pelanggan baru.");
        }
    }

    if (explicitFields.subscription && data.subscription && packages.length > 0) {
        const packageExists = packages.some((pkg) => String(pkg?.name || "").trim() === data.subscription);
        if (!packageExists) {
            errors.push(`Paket \"${data.subscription}\" tidak ditemukan di sistem.`);
        }
    }

    if (explicitFields.phone_number && data.phone_number && typeof deps.validatePhoneNumbers === "function") {
        const phoneValidation = await deps.validatePhoneNumbers(
            typeof deps.getDb === "function" ? deps.getDb() : null,
            data.phone_number,
            action === "update" ? data.id : null,
            "ID"
        );

        if (!phoneValidation.valid) {
            errors.push(phoneValidation.message || "phone_number tidak valid.");
        }
    }

    const commitPayload = action === "create"
        ? buildCreatePayload(data, explicitFields)
        : buildUpdatePayload(data, explicitFields);

    if (action === "update" && Object.keys(commitPayload).length === 0) {
        errors.push("Tidak ada field yang diisi untuk update pada baris ini.");
    }

    return {
        ...preparedRow,
        commitPayload,
        errors
    };
}

async function prepareImportRows(deps, buffer) {
    const XLSX = getXlsx();
    const workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true
    });

    if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
        throw createError(ErrorTypes.VALIDATION_ERROR, "Workbook Excel tidak memiliki sheet yang dapat dibaca.", 400);
    }

    const targetSheetName = workbook.SheetNames.includes(USER_EXCEL_SHEET_NAME)
        ? USER_EXCEL_SHEET_NAME
        : workbook.SheetNames[0];
    const sheet = workbook.Sheets[targetSheetName];

    if (!sheet) {
        throw createError(ErrorTypes.VALIDATION_ERROR, "Sheet data pelanggan tidak ditemukan di workbook Excel.", 400);
    }

    const headerMatrix = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        blankrows: false
    });
    const headerValidation = validateImportHeaders(headerMatrix[0] || []);

    if (headerValidation.missingRequiredHeaders.length > 0) {
        throw createError(
            ErrorTypes.VALIDATION_ERROR,
            `Header wajib tidak lengkap: ${headerValidation.missingRequiredHeaders.join(", ")}`,
            400,
            { missingHeaders: headerValidation.missingRequiredHeaders }
        );
    }

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
        defval: "",
        raw: false,
        blankrows: false
    });

    const preparedRows = [];

    for (let index = 0; index < rawRows.length; index += 1) {
        const rawRow = rawRows[index];
        if (isImportRowEmpty(rawRow)) {
            continue;
        }

        const normalizedRow = normalizeImportRow(rawRow);
        if (isSampleRow(normalizedRow.data)) {
            continue;
        }

        const existingUser = normalizedRow.data.id && deps.repository?.findUserById
            ? deps.repository.findUserById(normalizedRow.data.id)
            : null;
        const action = normalizedRow.data.id ? "update" : "create";

        const validatedRow = await validatePreparedRow(deps, {
            rowNumber: index + 2,
            action,
            existingUser,
            ...normalizedRow
        });

        preparedRows.push(validatedRow);
    }

    if (preparedRows.length === 0) {
        throw createError(ErrorTypes.VALIDATION_ERROR, "Tidak ada baris data pelanggan yang dapat diproses di file Excel.", 400);
    }

    return {
        headerValidation,
        preparedRows,
        sheetName: targetSheetName
    };
}

function buildSummary(rows) {
    const validRows = rows.filter((row) => row.errors.length === 0);
    return {
        totalRows: rows.length,
        validRows: validRows.length,
        invalidRows: rows.length - validRows.length,
        createRows: rows.filter((row) => row.action === "create").length,
        updateRows: rows.filter((row) => row.action === "update").length
    };
}

function toPreviewRow(row) {
    return {
        rowNumber: row.rowNumber,
        action: row.action,
        status: row.errors.length === 0 ? "valid" : "invalid",
        targetId: row.data.id || row.existingUser?.id || null,
        targetName: row.data.name || row.existingUser?.name || "-",
        fields: Object.keys(row.commitPayload || {}),
        messages: row.errors.length > 0 ? row.errors : ["Siap diproses."]
    };
}

async function commitPreparedRows(service, deps, preparedRows, actor, requestMeta) {
    const rows = [];
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    for (const preparedRow of preparedRows) {
        try {
            let result;
            if (preparedRow.action === "create") {
                result = await service.upsertUserFromAdminPanel({
                    userData: preparedRow.commitPayload,
                    actor,
                    requestMeta
                });
            } else {
                result = await service.updateUserById({
                    id: preparedRow.data.id,
                    userData: preparedRow.commitPayload,
                    actor,
                    requestMeta
                });
            }

            if (!result || result.status >= 400) {
                throw new Error(result?.body?.message || result?.message || "Operasi import gagal diproses.");
            }

            if (preparedRow.action === "create") {
                createdCount += 1;
            } else {
                updatedCount += 1;
            }

            rows.push({
                rowNumber: preparedRow.rowNumber,
                action: preparedRow.action,
                status: "success",
                targetId: result?.body?.data?.id || preparedRow.data.id || null,
                targetName: result?.body?.data?.name || preparedRow.data.name || preparedRow.existingUser?.name || "-",
                message: result?.body?.message || "Berhasil diproses."
            });
        } catch (error) {
            failedCount += 1;
            deps.logger?.error?.(`[USERS_EXCEL_IMPORT] Commit gagal di baris ${preparedRow.rowNumber}:`, error.message || error);
            rows.push({
                rowNumber: preparedRow.rowNumber,
                action: preparedRow.action,
                status: "failed",
                targetId: preparedRow.data.id || null,
                targetName: preparedRow.data.name || preparedRow.existingUser?.name || "-",
                message: error.message || "Terjadi kesalahan saat memproses baris import."
            });
        }
    }

    return {
        createdCount,
        updatedCount,
        failedCount,
        rows
    };
}

async function importUsersFromExcel(deps, service, { buffer, mode, actor, requestMeta, originalName }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw createError(ErrorTypes.VALIDATION_ERROR, "File Excel wajib diunggah sebelum preview/import.", 400);
    }

    const normalizedMode = normalizeMode(mode);
    const prepared = await prepareImportRows(deps, buffer);
    const summary = buildSummary(prepared.preparedRows);
    const previewRows = prepared.preparedRows.map((row) => toPreviewRow(row));

    if (normalizedMode === "validate") {
        return {
            status: 200,
            body: {
                status: 200,
                mode: "validate",
                message: summary.invalidRows > 0
                    ? `Preview selesai dengan ${summary.invalidRows} baris bermasalah.`
                    : "Preview selesai. Semua baris valid dan siap diimport.",
                sourceFile: originalName || null,
                sheetName: prepared.sheetName,
                summary,
                warnings: prepared.headerValidation.unknownHeaders,
                rows: previewRows
            }
        };
    }

    if (summary.invalidRows > 0) {
        return {
            status: 400,
            body: {
                status: 400,
                mode: "commit",
                message: "Masih ada baris yang tidak valid. Jalankan preview, perbaiki file, lalu commit ulang.",
                sourceFile: originalName || null,
                sheetName: prepared.sheetName,
                summary,
                warnings: prepared.headerValidation.unknownHeaders,
                rows: previewRows
            }
        };
    }

    const commitResult = await commitPreparedRows(service, deps, prepared.preparedRows, actor, requestMeta);

    return {
        status: 200,
        body: {
            status: 200,
            mode: "commit",
            message: commitResult.failedCount > 0
                ? `Import selesai: ${commitResult.createdCount} create, ${commitResult.updatedCount} update, ${commitResult.failedCount} gagal.`
                : `Import berhasil: ${commitResult.createdCount} create dan ${commitResult.updatedCount} update.`,
            sourceFile: originalName || null,
            sheetName: prepared.sheetName,
            summary: {
                ...summary,
                createdCount: commitResult.createdCount,
                updatedCount: commitResult.updatedCount,
                failedCount: commitResult.failedCount
            },
            warnings: prepared.headerValidation.unknownHeaders,
            rows: commitResult.rows
        }
    };
}

module.exports = {
    importUsersFromExcel
};
