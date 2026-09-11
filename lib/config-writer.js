/**
 * Header Doc
 * Purpose: SATU jalur kanonik tulis config.json untuk endpoint setelan/gate ("deploy gelap"). Dulu
 *   pola read→modify→writeAtomic→sync→reinit disalin ~15× di 10 route dengan 3 varian sync + indent
 *   4↔2 (drift) + satu varian (olt.js `global.config=config`) MENJATUHKAN field ephemeral. Helper ini
 *   membungkus env-config.readConfigFresh + saveConfigAtomic (atomik + strip ephemeral + set global.config
 *   + indent 2 konsisten + merge-key aman) lalu opsional sync runtime holder + reinit cron + resync worker.
 * Caller: routes/admin-config-routes.js & registrar setelan lain (migrasi bertahap).
 * Deps: ./env-config (readConfigFresh/saveConfigAtomic); lazy: ./cron (initializeAllCronTasks), ./feature-flags (resyncWorkerForFlag).
 * MainFuncs: saveConfigGate(mutate, opts).
 * SideEffects: Tulis config.json (atomik) + set global.config; opsional setConfig runtime, reinit cron, resync worker. Efek samping never-throw.
 */
"use strict";

const { readConfigFresh, saveConfigAtomic } = require("./env-config");

/**
 * Read-modify-write config.json kanonik.
 * @param {(cfg:object)=>(object|void)} mutate  Ubah cfg IN-PLACE (atau kembalikan objek config baru).
 *   HANYA sentuh subkey milikmu — subkey lain (hand-edit ops / penulis lain) terjaga karena baca segar.
 * @param {object} [opts]
 * @param {{setConfig:Function}} [opts.runtime]  requireRuntimeConfig() dari route — sync holder repositories.config.
 * @param {boolean} [opts.reinitCron]  panggil initializeAllCronTasks() setelah simpan (gate cron langsung berlaku).
 * @param {string} [opts.resyncWorkerKey]  key feature-flag ber-worker latar (mis. 'bulkApprovalJob').
 * @returns {object} config runtime hasil (global.config).
 */
function saveConfigGate(mutate, opts = {}) {
    if (typeof mutate !== "function") throw new Error("saveConfigGate: mutate harus fungsi");
    const cfg = readConfigFresh();
    const result = mutate(cfg);
    const next = result && typeof result === "object" ? result : cfg;
    // Atomik + strip ephemeral + set global.config + indent 2 (SATU sumber kebenaran format).
    saveConfigAtomic(next);
    // Sync holder runtime kedua (repositories.config yang dibaca getConfig()) bila route menyuntikkannya.
    if (opts.runtime && typeof opts.runtime.setConfig === "function") {
        try { opts.runtime.setConfig(global.config); } catch (e) { console.error("[CONFIG_WRITER] setConfig runtime gagal:", e && e.message); }
    }
    if (opts.reinitCron) {
        try { require("./cron").initializeAllCronTasks(); } catch (e) { console.error("[CONFIG_WRITER] reinit cron gagal:", e && e.message); }
    }
    if (opts.resyncWorkerKey) {
        try { require("./feature-flags").resyncWorkerForFlag(opts.resyncWorkerKey); } catch (e) { console.error("[CONFIG_WRITER] resync worker gagal:", e && e.message); }
    }
    return global.config;
}

module.exports = { saveConfigGate };
