/**
 * Header Doc
 * Purpose: Scheduler auto outage check untuk menjalankan scan rule aktif setelah fitur manual scan tervalidasi.
 * Caller: `lib/cron.js`.
 * Deps: `node-cron`, `services/auto-outage-detection.service.js`.
 * MainFuncs: `initAutoOutageCheckTask`.
 * SideEffects: Menjadwalkan background scan jika config auto outage aktif.
 */
"use strict";

let autoOutageTask = null;

function initAutoOutageCheckTask(config = {}, deps = {}) {
    return {
        started: false,
        reason: config?.autoOutage?.enabled ? "AUTO_OUTAGE_CRON_NOT_IMPLEMENTED" : "AUTO_OUTAGE_DISABLED",
        task: autoOutageTask,
        deps
    };
}

module.exports = { initAutoOutageCheckTask };
