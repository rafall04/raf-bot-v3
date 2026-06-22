/**
 * Header Doc
 * Purpose: Menjadi source-of-truth schema Excel pelanggan untuk fitur template, export, dan import agar header, contoh data, normalisasi nilai, dan mapping field tetap konsisten.
 * Caller: `./users-excel-template`, `./export-users-excel`, `./import-users-excel`.
 * Deps: Tidak ada dependency eksternal; hanya helper internal murni.
 * MainFuncs: `getExcelColumnKeys`, `getExcelColumnWidths`, `buildGuideSheetRows`, `buildSampleImportRow`, `validateImportHeaders`, `normalizeImportRow`, `mapUserToExportRow`.
 * SideEffects: Tidak ada.
 */
"use strict";

const USER_EXCEL_SHEET_NAME = "Pelanggan";
const USER_EXCEL_GUIDE_SHEET_NAME = "Petunjuk";
const USER_EXCEL_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const USER_EXCEL_SAMPLE_ROW_MARKER = "__HAPUS_BARIS_CONTOH__";

const USER_EXCEL_COLUMNS = [
    {
        key: "id",
        requiredOnCreate: false,
        description: "Isi ID untuk update pelanggan existing. Kosongkan untuk membuat pelanggan baru.",
        example: "1001"
    },
    {
        key: "name",
        requiredOnCreate: true,
        description: "Nama pelanggan.",
        example: "Budi Santoso"
    },
    {
        key: "phone_number",
        requiredOnCreate: false,
        description: "Nomor telepon pelanggan. Multi nomor dipisahkan dengan karakter |.",
        example: "6281234567890|6289876543210"
    },
    {
        key: "address",
        requiredOnCreate: false,
        description: "Alamat pelanggan.",
        example: "Jl. Contoh No. 123"
    },
    {
        key: "subscription",
        requiredOnCreate: true,
        description: "Nama paket langganan sesuai data paket di sistem.",
        example: "Paket Basic"
    },
    {
        key: "pppoe_username",
        requiredOnCreate: false,
        description: "Username PPPoE di MikroTik. Kunci pencocokan rekonsiliasi/auto-outage/isolir — samakan PERSIS dengan nama secret di router.",
        example: "area@namapelanggan"
    },
    {
        key: "device_id",
        requiredOnCreate: false,
        description: "Device ID ONT/ONU bila sudah tersedia.",
        example: "ONT123456"
    },
    {
        key: "connected_odp_id",
        requiredOnCreate: false,
        description: "ID ODP yang terhubung.",
        example: "ODP-001"
    },
    {
        key: "latitude",
        requiredOnCreate: false,
        description: "Latitude lokasi pelanggan dalam format desimal.",
        example: "-6.200000"
    },
    {
        key: "longitude",
        requiredOnCreate: false,
        description: "Longitude lokasi pelanggan dalam format desimal.",
        example: "106.816666"
    },
    {
        key: "paid",
        requiredOnCreate: false,
        description: "Status pembayaran. Gunakan TRUE/FALSE, YA/TIDAK, atau 1/0.",
        example: "FALSE"
    },
    {
        key: "payment_method",
        requiredOnCreate: false,
        description: "Wajib diisi jika paid=TRUE. Nilai yang valid: CASH atau TRANSFER_BANK.",
        example: "CASH"
    },
    {
        key: "send_invoice",
        requiredOnCreate: false,
        description: "Apakah invoice PDF perlu dikirim. Gunakan TRUE/FALSE.",
        example: "TRUE"
    },
    {
        key: "notify_outage",
        requiredOnCreate: false,
        description: "Terima broadcast info gangguan/GAMAS. TRUE/FALSE (default TRUE bila kosong).",
        example: "TRUE"
    },
    {
        key: "account_type",
        requiredOnCreate: false,
        description: "Jenis akun: 'pelanggan' (default) atau 'infrastruktur' (mis. modem CCTV/monitoring). Akun infrastruktur disembunyikan dari data pelanggan & kebal isolir/tagihan, tetapi tetap terbaca di monitor OLT.",
        example: "pelanggan"
    },
    {
        key: "bulk",
        requiredOnCreate: false,
        description: "SSID target untuk sinkron bulk. Pisahkan dengan |, contoh 1|5.",
        example: "1|5"
    },
    {
        key: "is_corporate",
        requiredOnCreate: false,
        description: "Tandai TRUE jika pelanggan corporate.",
        example: "FALSE"
    },
    {
        key: "corporate_name",
        requiredOnCreate: false,
        description: "Nama badan usaha jika pelanggan corporate.",
        example: "PT Contoh Internet"
    },
    {
        key: "corporate_address",
        requiredOnCreate: false,
        description: "Alamat badan usaha jika pelanggan corporate.",
        example: "Jl. Kantor No. 1"
    },
    {
        key: "corporate_npwp",
        requiredOnCreate: false,
        description: "NPWP badan usaha jika pelanggan corporate.",
        example: "01.234.567.8-999.000"
    },
    {
        key: "corporate_pic_name",
        requiredOnCreate: false,
        description: "Nama PIC corporate.",
        example: "Rina"
    },
    {
        key: "corporate_pic_phone",
        requiredOnCreate: false,
        description: "Nomor telepon PIC corporate.",
        example: "628111111111"
    },
    {
        key: "corporate_pic_email",
        requiredOnCreate: false,
        description: "Email PIC corporate.",
        example: "rina@contoh.id"
    }
];

const BOOLEAN_TRUE_VALUES = new Set(["TRUE", "YA", "YES", "Y", "1"]);
const BOOLEAN_FALSE_VALUES = new Set(["FALSE", "TIDAK", "NO", "N", "0"]);
const ALLOWED_PAYMENT_METHODS = new Set(["CASH", "TRANSFER_BANK"]);

function normalizeString(value) {
    if (value === null || typeof value === "undefined") {
        return "";
    }
    return String(value).trim();
}

function normalizeNullableString(value) {
    const normalized = normalizeString(value);
    return normalized === "" ? null : normalized;
}

function fieldHasValue(value) {
    if (typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return !Number.isNaN(value);
    }
    return normalizeString(value) !== "";
}

function normalizeBooleanCell(value, fieldName) {
    if (!fieldHasValue(value)) {
        return { value: null, error: null };
    }

    if (typeof value === "boolean") {
        return { value, error: null };
    }

    if (typeof value === "number") {
        if (value === 1) {
            return { value: true, error: null };
        }
        if (value === 0) {
            return { value: false, error: null };
        }
    }

    const normalized = normalizeString(value).toUpperCase();
    if (BOOLEAN_TRUE_VALUES.has(normalized)) {
        return { value: true, error: null };
    }
    if (BOOLEAN_FALSE_VALUES.has(normalized)) {
        return { value: false, error: null };
    }

    return {
        value: null,
        error: `${fieldName} harus bernilai TRUE/FALSE, YA/TIDAK, atau 1/0.`
    };
}

function normalizePaymentMethodCell(value) {
    if (!fieldHasValue(value)) {
        return { value: null, error: null };
    }

    const normalized = normalizeString(value)
        .toUpperCase()
        .replace(/\s+/g, "_");

    if (normalized === "TRANSFER" || normalized === "TRANSFERBANK") {
        return { value: "TRANSFER_BANK", error: null };
    }

    if (ALLOWED_PAYMENT_METHODS.has(normalized)) {
        return { value: normalized, error: null };
    }

    return {
        value: null,
        error: "payment_method hanya boleh CASH atau TRANSFER_BANK."
    };
}

function normalizeNumericCell(value, fieldName) {
    if (!fieldHasValue(value)) {
        return { value: null, error: null };
    }

    const numericValue = Number(value);
    if (Number.isNaN(numericValue)) {
        return {
            value: null,
            error: `${fieldName} harus berupa angka desimal yang valid.`
        };
    }

    return { value: numericValue, error: null };
}

function normalizePipeList(value) {
    if (!fieldHasValue(value)) {
        return [];
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => normalizeString(item))
            .filter(Boolean);
    }

    const normalized = normalizeString(value);
    if (!normalized) {
        return [];
    }

    return normalized
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeBulkValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeString(item)).filter(Boolean);
    }

    const normalized = normalizeString(value);
    if (!normalized) {
        return [];
    }

    if (normalized.startsWith("[") && normalized.endsWith("]")) {
        try {
            const parsed = JSON.parse(normalized);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => normalizeString(item)).filter(Boolean);
            }
        } catch (_error) {
            return normalizePipeList(normalized);
        }
    }

    return normalizePipeList(normalized);
}

function formatBooleanForExcel(value) {
    return value ? "TRUE" : "FALSE";
}

function normalizeHeaderCell(value) {
    return normalizeString(value);
}

function getExcelColumnKeys() {
    return USER_EXCEL_COLUMNS.map((column) => column.key);
}

function getExcelColumnWidths() {
    return USER_EXCEL_COLUMNS.map((column) => ({
        wch: Math.max(column.key.length + 4, 18)
    }));
}

function buildSampleImportRow() {
    return {
        id: "",
        name: USER_EXCEL_SAMPLE_ROW_MARKER,
        phone_number: "6281234567890|6289876543210",
        address: "Jl. Contoh No. 123",
        subscription: "Paket Basic",
        pppoe_username: "area@namapelanggan",
        device_id: "ONT123456",
        connected_odp_id: "ODP-001",
        latitude: -6.2,
        longitude: 106.816666,
        paid: "FALSE",
        payment_method: "",
        send_invoice: "TRUE",
        notify_outage: "TRUE",
        account_type: "pelanggan",
        bulk: "1|5",
        is_corporate: "FALSE",
        corporate_name: "",
        corporate_address: "",
        corporate_npwp: "",
        corporate_pic_name: "",
        corporate_pic_phone: "",
        corporate_pic_email: ""
    };
}

function buildGuideSheetRows() {
    const rows = [
        ["Bagian", "Wajib", "Deskripsi", "Contoh"],
        [
            "Petunjuk Umum",
            "-",
            "Hapus baris contoh dengan name=__HAPUS_BARIS_CONTOH__ sebelum import. Baris dengan ID terisi akan dianggap update. Baris tanpa ID akan dianggap create baru via mode import aman.",
            "-"
        ],
        [
            "Aturan Update",
            "-",
            "Untuk update, hanya field yang diisi eksplisit yang akan diubah. Field kosong tidak akan menimpa data lama.",
            "Kosongkan address jika tidak ingin mengubah address existing"
        ],
        [
            "Boolean",
            "-",
            "Nilai boolean yang valid: TRUE/FALSE, YA/TIDAK, atau 1/0.",
            "TRUE"
        ],
        [
            "Multi Nomor",
            "-",
            "Gunakan karakter | untuk memisahkan beberapa nomor telepon.",
            "62812xxx|62813xxx"
        ],
        [
            "Metode Pembayaran",
            "Jika paid=TRUE",
            "Nilai yang diizinkan: CASH atau TRANSFER_BANK.",
            "TRANSFER_BANK"
        ],
        ["", "", "", ""],
        ["Kolom", "Wajib saat Create", "Deskripsi", "Contoh"]
    ];

    USER_EXCEL_COLUMNS.forEach((column) => {
        rows.push([
            column.key,
            column.requiredOnCreate ? "YA" : "TIDAK",
            column.description,
            column.example
        ]);
    });

    return rows;
}

function validateImportHeaders(headerRow) {
    const normalizedHeaders = (headerRow || []).map(normalizeHeaderCell).filter(Boolean);
    const knownHeaders = new Set(getExcelColumnKeys());
    const unknownHeaders = normalizedHeaders.filter((header) => !knownHeaders.has(header));
    const missingRequiredHeaders = ["name", "subscription"].filter((header) => !normalizedHeaders.includes(header));

    return {
        normalizedHeaders,
        unknownHeaders,
        missingRequiredHeaders
    };
}

function isSampleRow(rowData) {
    return normalizeString(rowData?.name) === USER_EXCEL_SAMPLE_ROW_MARKER;
}

function isImportRowEmpty(rawRow) {
    return getExcelColumnKeys().every((key) => !fieldHasValue(rawRow?.[key]));
}

function normalizeImportRow(rawRow) {
    const errors = [];
    const explicitFields = {};

    getExcelColumnKeys().forEach((key) => {
        explicitFields[key] = fieldHasValue(rawRow?.[key]);
    });

    const latitudeResult = normalizeNumericCell(rawRow?.latitude, "latitude");
    const longitudeResult = normalizeNumericCell(rawRow?.longitude, "longitude");
    const paidResult = normalizeBooleanCell(rawRow?.paid, "paid");
    const sendInvoiceResult = normalizeBooleanCell(rawRow?.send_invoice, "send_invoice");
    const corporateResult = normalizeBooleanCell(rawRow?.is_corporate, "is_corporate");
    const notifyOutageResult = normalizeBooleanCell(rawRow?.notify_outage, "notify_outage");
    const paymentMethodResult = normalizePaymentMethodCell(rawRow?.payment_method);

    [
        latitudeResult.error,
        longitudeResult.error,
        paidResult.error,
        sendInvoiceResult.error,
        corporateResult.error,
        notifyOutageResult.error,
        paymentMethodResult.error
    ].filter(Boolean).forEach((message) => errors.push(message));

    const data = {
        id: normalizeNullableString(rawRow?.id),
        name: normalizeNullableString(rawRow?.name),
        phone_number: explicitFields.phone_number ? normalizePipeList(rawRow?.phone_number).join("|") : null,
        address: normalizeNullableString(rawRow?.address),
        subscription: normalizeNullableString(rawRow?.subscription),
        pppoe_username: normalizeNullableString(rawRow?.pppoe_username),
        device_id: normalizeNullableString(rawRow?.device_id),
        connected_odp_id: normalizeNullableString(rawRow?.connected_odp_id),
        latitude: latitudeResult.value,
        longitude: longitudeResult.value,
        paid: paidResult.value,
        payment_method: paymentMethodResult.value,
        send_invoice: sendInvoiceResult.value,
        notify_outage: notifyOutageResult.value,
        account_type: explicitFields.account_type
            ? (String(rawRow?.account_type || "").trim().toLowerCase() === "infrastruktur" ? "infrastruktur" : "pelanggan")
            : null,
        bulk: explicitFields.bulk ? normalizeBulkValue(rawRow?.bulk) : [],
        is_corporate: corporateResult.value,
        corporate_name: normalizeNullableString(rawRow?.corporate_name),
        corporate_address: normalizeNullableString(rawRow?.corporate_address),
        corporate_npwp: normalizeNullableString(rawRow?.corporate_npwp),
        corporate_pic_name: normalizeNullableString(rawRow?.corporate_pic_name),
        corporate_pic_phone: normalizeNullableString(rawRow?.corporate_pic_phone),
        corporate_pic_email: normalizeNullableString(rawRow?.corporate_pic_email)
    };

    if (explicitFields.paid && data.paid === true && !data.payment_method) {
        errors.push("payment_method wajib diisi jika paid=TRUE.");
    }

    return {
        data,
        explicitFields,
        errors
    };
}

function mapUserToExportRow(user) {
    return {
        id: user?.id ?? "",
        name: user?.name || "",
        phone_number: user?.phone_number || user?.phone || "",
        address: user?.address || "",
        subscription: user?.subscription || user?.package || "",
        pppoe_username: user?.pppoe_username || "",
        device_id: user?.device_id || "",
        connected_odp_id: user?.connected_odp_id || user?.odp_id || "",
        latitude: user?.latitude ?? "",
        longitude: user?.longitude ?? "",
        paid: formatBooleanForExcel(Boolean(user?.paid)),
        payment_method: user?.payment_method || "",
        send_invoice: formatBooleanForExcel(Boolean(user?.send_invoice)),
        notify_outage: formatBooleanForExcel(user?.notify_outage !== false && user?.notify_outage !== 0),
        account_type: String(user?.account_type || "").trim().toLowerCase() === "infrastruktur" ? "infrastruktur" : "pelanggan",
        bulk: normalizeBulkValue(user?.bulk).join("|"),
        is_corporate: formatBooleanForExcel(Boolean(user?.is_corporate)),
        corporate_name: user?.corporate_name || "",
        corporate_address: user?.corporate_address || "",
        corporate_npwp: user?.corporate_npwp || "",
        corporate_pic_name: user?.corporate_pic_name || "",
        corporate_pic_phone: user?.corporate_pic_phone || "",
        corporate_pic_email: user?.corporate_pic_email || ""
    };
}

module.exports = {
    USER_EXCEL_SHEET_NAME,
    USER_EXCEL_GUIDE_SHEET_NAME,
    USER_EXCEL_CONTENT_TYPE,
    USER_EXCEL_SAMPLE_ROW_MARKER,
    USER_EXCEL_COLUMNS,
    getExcelColumnKeys,
    getExcelColumnWidths,
    buildGuideSheetRows,
    buildSampleImportRow,
    validateImportHeaders,
    normalizeImportRow,
    mapUserToExportRow,
    isImportRowEmpty,
    isSampleRow
};
