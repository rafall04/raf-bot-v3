/**
 * Header Doc
 * Purpose: Cron reconcile voucher — ingest log-login Mikhmon (/system/script "-|-") ke database/voucher.sqlite lalu PRUNE dari router (ingest dulu, baru hapus). Membuat bot jadi sumber laporan voucher + menjaga router tetap bersih. Expiry tetap milik Mikhmon (tak disentuh).
 * Caller: `lib/cron.js` via `initVoucherReconcileTask`.
 * Deps: `node-cron`, `../shared` (isValidCron, loadCronConfig), `../../mikrotik` (getHotspotLogScripts, removeScriptsByIds), `../../../repositories/voucher-tracking.repository`.
 * MainFuncs: `initVoucherReconcileTask(config)`, `runReconcileOnce(deps)` (deps injectable utk test).
 * SideEffects: Tulis voucher.sqlite + hapus /system/script di MikroTik (hanya yang sudah ter-ingest).
 */
"use strict";

const cron = require("node-cron");
const { isValidCron, loadCronConfig } = require("../shared");
const { getHotspotLogScripts, removeScriptsByIds } = require("../../mikrotik");
const { createVoucherTrackingRepository } = require("../../../repositories/voucher-tracking.repository");

let task = null;
let running = false;
let sharedRepo = null;

function getRepo() {
    if (!sharedRepo) sharedRepo = createVoucherTrackingRepository();
    return sharedRepo;
}

async function runReconcileOnce(deps = {}) {
    const getLogs = deps.getHotspotLogScripts || getHotspotLogScripts;
    const removeIds = deps.removeScriptsByIds || removeScriptsByIds;
    const repository = deps.repository || getRepo();

    const res = await getLogs({ caller: "cron.voucher-reconcile" });
    if (!res || res.ok !== true) {
        return { ok: false, message: (res && res.message) || "Gagal mengambil log scripts" };
    }
    const scripts = (res.data && res.data.scripts) || [];
    if (scripts.length === 0) return { ok: true, found: 0, ingested: 0, pruned: 0 };

    const names = scripts.map((s) => s.name);

    // Ingest DULU (idempotent). Hanya prune setelah ingest sukses — hard rule: jangan hapus log
    // yang belum tercatat. #b325: prune HANYA id untuk nama yang AMAN (ter-record / sudah ada);
    // nama yang GAGAL di-parse DIBIARKAN di router — kalau ikut dihapus, record login/revenue voucher
    // itu hilang permanen & laporan under-report tanpa jejak (langgar hard-rule modul ini sendiri).
    const ing = await repository.ingestLogNames(names);
    const prunableSet = new Set(Array.isArray(ing.prunable) ? ing.prunable : names); // fallback: perilaku lama
    const idsToPrune = scripts.filter((s) => prunableSet.has(s.name)).map((s) => s.id);
    const keptUnparsed = scripts.length - idsToPrune.length;
    if (keptUnparsed > 0) {
        console.warn(`[CRON_VOUCHER_RECONCILE] ${keptUnparsed} log gagal di-parse DIBIARKAN di router (tak dipangkas) — perbaiki parser lalu ingest ulang.`);
    }
    const rm = idsToPrune.length ? await removeIds(idsToPrune, { caller: "cron.voucher-reconcile" }) : { ok: true, data: { removed: 0 } };
    const pruned = (rm && rm.ok && rm.data) ? rm.data.removed : 0;

    return { ok: true, found: scripts.length, ingested: ing.ingested, skipped: ing.skipped, pruned, keptUnparsed };
}

function initVoucherReconcileTask(config) {
    if (task) task.stop();
    if (config.status_voucher_reconcile === true && isValidCron(config.voucher_reconcile_schedule)) {
        console.log("[CRON_VOUCHER_RECONCILE] Starting schedule:", config.voucher_reconcile_schedule);
        task = cron.schedule(config.voucher_reconcile_schedule, async () => {
            if (running) {
                console.warn("[CRON_VOUCHER_RECONCILE_SKIP] Previous cycle still running, skipping.");
                return;
            }
            const current = loadCronConfig();
            if (current.status_voucher_reconcile !== true) return;
            running = true;
            try {
                const r = await runReconcileOnce();
                if (r.ok && r.found > 0) {
                    console.log(`[CRON_VOUCHER_RECONCILE] found:${r.found} ingested:${r.ingested} skipped:${r.skipped} pruned:${r.pruned}`);
                } else if (!r.ok) {
                    console.warn("[CRON_VOUCHER_RECONCILE] gagal:", r.message);
                }
            } catch (error) {
                console.error("[CRON_VOUCHER_RECONCILE_ERROR]", error.message);
            } finally {
                running = false;
            }
        });
    }
}

module.exports = { initVoucherReconcileTask, runReconcileOnce };
