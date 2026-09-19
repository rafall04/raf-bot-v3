/**
 * Header Doc
 * Purpose: Helper kalender Asia/Jakarta — turunkan tanggal/bulan "hari WIB" dari instant
 *          tersimpan (ISO `…Z` atau SQLite `datetime('now')` yang selalu UTC), dan hasilkan
 *          batas instant ISO untuk filter rentang. Tak bergantung pada TZ mesin.
 * Caller: `expense-manager`, `business-expense-wa`, `owner-cockpit-service`, modul lain yang
 *         membandingkan tanggal kalender WIB dengan timestamp UTC tersimpan.
 * Deps: `Intl` bawaan.
 * MainFuncs: `getJakartaParts`, `jakartaDateStringOf`, `jakartaYearMonthOf`,
 *            `jakartaDayRangeIso`, `jakartaMonthRangeIso`.
 * SideEffects: Tidak ada.
 */
"use strict";

// WIB = UTC+7 stabil (tanpa DST). Ditulis eksplisit supaya hasil identik di mesin
// dengan TZ berapa pun — jangan andalkan `new Date(y, m, d)` yang membaca TZ host.
const JAKARTA_OFFSET = "+07:00";

const _formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
});

/**
 * Pecah instant menjadi field kalender Jakarta.
 * @param {Date} date
 * @returns {{year: string, month: string, day: string, date: string, yearMonth: string}}
 */
function getJakartaParts(date = new Date()) {
    const parts = _formatter.formatToParts(date);
    const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
        year: lookup.year,
        month: lookup.month,
        day: lookup.day,
        date: `${lookup.year}-${lookup.month}-${lookup.day}`,
        yearMonth: `${lookup.year}-${lookup.month}`
    };
}

/**
 * Parse string waktu tersimpan sebagai instant UTC: ISO "…T…Z" langsung dipakai;
 * bentuk SQLite `datetime('now')` ("YYYY-MM-DD HH:MM:SS") adalah UTC — tambahkan Z
 * supaya tak terbaca sebagai waktu lokal mesin.
 */
function parseUtcInstant(value) {
    if (value instanceof Date) return value;
    const s = String(value || "").trim();
    if (!s) return new Date(NaN);
    const iso = s.includes("T") ? s : `${s.replace(" ", "T")}Z`;
    return new Date(iso);
}

/** Tanggal kalender Jakarta ("YYYY-MM-DD") dari instant tersimpan; null bila tak ter-parse. */
function jakartaDateStringOf(value) {
    const instant = parseUtcInstant(value);
    if (!Number.isFinite(instant.getTime())) return null;
    return getJakartaParts(instant).date;
}

/** Bulan kalender Jakarta ("YYYY-MM") dari instant tersimpan; null bila tak ter-parse. */
function jakartaYearMonthOf(value) {
    const instant = parseUtcInstant(value);
    if (!Number.isFinite(instant.getTime())) return null;
    return getJakartaParts(instant).yearMonth;
}

/**
 * Rentang instant ISO [start, end) untuk hari kalender Jakarta `dateStr` ("YYYY-MM-DD").
 * Cocok untuk filter `kolom_iso >= start AND kolom_iso < end`.
 */
function jakartaDayRangeIso(dateStr) {
    const start = new Date(`${dateStr}T00:00:00${JAKARTA_OFFSET}`);
    if (!Number.isFinite(start.getTime())) return [null, null];
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return [start.toISOString(), end.toISOString()];
}

/**
 * Rentang instant ISO [start, end) untuk bulan kalender Jakarta (month 1-12).
 */
function jakartaMonthRangeIso(year, month) {
    const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00${JAKARTA_OFFSET}`);
    if (!Number.isFinite(start.getTime())) return [null, null];
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return [start.toISOString(), end.toISOString()];
}

module.exports = {
    getJakartaParts,
    jakartaDateStringOf,
    jakartaYearMonthOf,
    jakartaDayRangeIso,
    jakartaMonthRangeIso
};
