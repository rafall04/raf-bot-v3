/**
 * Header Doc
 * Purpose: Penghitung durable PSB TERPASANG per bulan (via wizard). Sumber angka "PSB bulan ini"
 *          untuk ringkasan grup — user schema tak punya created_at & wizard tak menulis psb_database,
 *          jadi counter ringan JSON ini = sumber paling andal & low-risk. Best-effort, never-throw.
 * Caller: `message/handlers/state-domains/psb.state.js` (provision → recordInstall; ringkasan → getMonthCount).
 * Deps: `fs`, `path`, lazy `./env-config` (getDatabasePath).
 * MainFuncs: `recordInstall(nowMs)`, `getMonthCount(nowMs)`, `monthKey(nowMs)`.
 * SideEffects: Tulis `database/psb_install_stats.json` ({ "YYYY-MM": count }). Gitignored (state runtime).
 */
"use strict";

const fs = require("fs");
const path = require("path");

let _statsPathOverride = null; // hanya utk test via setStatsPathForTest (hindari baca process.env)
function statsPath() {
    if (_statsPathOverride) return _statsPathOverride;
    try {
        return require("./env-config").getDatabasePath("psb_install_stats.json");
    } catch (_e) {
        return path.join(__dirname, "..", "database", "psb_install_stats.json");
    }
}
function setStatsPathForTest(p) { _statsPathOverride = p; }

function monthKey(nowMs = Date.now()) {
    const d = new Date(nowMs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function readStats() {
    try {
        const raw = fs.readFileSync(statsPath(), "utf8");
        const obj = JSON.parse(raw);
        return obj && typeof obj === "object" ? obj : {};
    } catch (_e) {
        return {};
    }
}

// Increment jumlah terpasang bulan berjalan. Return jumlah baru, atau null bila gagal (best-effort).
function recordInstall(nowMs = Date.now()) {
    try {
        const stats = readStats();
        const key = monthKey(nowMs);
        stats[key] = (parseInt(stats[key], 10) || 0) + 1;
        const p = statsPath();
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(stats, null, 2));
        return stats[key];
    } catch (_e) {
        return null;
    }
}

function getMonthCount(nowMs = Date.now()) {
    return parseInt(readStats()[monthKey(nowMs)], 10) || 0;
}

module.exports = { recordInstall, getMonthCount, monthKey, setStatsPathForTest };
