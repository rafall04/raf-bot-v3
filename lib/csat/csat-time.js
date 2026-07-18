/**
 * Header Doc
 * Purpose: Util waktu MURNI khusus CSAT — format tanggal SQL string 'YYYY-MM-DD HH:MM:SS'
 *   (sortable & konsisten dg kolom csat_surveys sehingga perbandingan `expires_at > now`
 *   secara leksikografis = kronologis), plus periode 'YYYY-MM', parse, dan aritmetika hari/menit.
 *   Dipisah agar cron & service memakai format tanggal IDENTIK (kalau beda, jendela balasan &
 *   kedaluwarsa jadi salah). Timezone mengikuti proses (app dipaksa Asia/Jakarta).
 * Caller: lib/csat/csat-survey-service.js, lib/cron/jobs/rating-survey.js.
 * Deps: tidak ada (pure).
 * MainFuncs: sqlDate, sqlNow, periodOf, parseSql, addDays, diffMinutes.
 * SideEffects: tidak ada.
 */
"use strict";

function pad2(v) { return String(v).padStart(2, "0"); }

function sqlDate(d) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())} ${pad2(x.getHours())}:${pad2(x.getMinutes())}:${pad2(x.getSeconds())}`;
}

function sqlNow() { return sqlDate(new Date()); }

function periodOf(d) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}`;
}

function parseSql(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ""));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

function addDays(d, n) {
    const base = d instanceof Date ? d.getTime() : new Date(d).getTime();
    const x = new Date(base);
    x.setDate(x.getDate() + n);
    return x;
}

function diffMinutes(aIso, bIso) {
    const a = parseSql(aIso);
    const b = parseSql(bIso);
    if (!a || !b) return Infinity;
    return Math.abs(b.getTime() - a.getTime()) / 60000;
}

module.exports = { sqlDate, sqlNow, periodOf, parseSql, addDays, diffMinutes, pad2 };
