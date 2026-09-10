/**
 * Header Doc
 * Purpose: Cron rollover ganti paket TERTUNDA (BAGIAN 1, opsi B). Per JAM: cari request status
 *   'scheduled' yang tanggal-berlaku-nya sudah tiba (awal siklus berikutnya), lalu TERAPKAN paket baru
 *   (profil MikroTik + subscription) via lib/package-change-apply, tandai 'approved'+applied_at, dan
 *   beri tahu pelanggan + teknisi bahwa paket baru kini aktif. GATED config.packageChangeDeferred.enabled
 *   (default OFF → inert). Idempoten: begitu diterapkan status keluar dari 'scheduled'. Gagal MikroTik →
 *   TIDAK ditandai (retry tick berikutnya) + alarm admin (fail-safe, jangan menebak — invarian OLT/ACS).
 * Caller: lib/cron.js (initPackageChangeRolloverTask).
 * Deps: node-cron, ../shared (safeSendMessage), ../../package-change-apply (applyApprovedPackageChange),
 *   ../../package-change-scheduler (isDue), ../../response-template-helper (renderResponseTemplate),
 *   ../../admin-recipients (getAdminJids), ../../../repositories/admin.repository.
 * MainFuncs: initPackageChangeRolloverTask(config), runRolloverTick(deps).
 * SideEffects: Jadwalkan job; ubah profil MikroTik + tulis users.subscription + package_change_requests.json; kirim WA.
 */
"use strict";

const cron = require("node-cron");
const { safeSendMessage } = require("../shared");
const { isDue, formatTanggalWIB } = require("../../package-change-scheduler");
const { applyApprovedPackageChange } = require("../../package-change-apply");
const { renderResponseTemplate } = require("../../response-template-helper");

let cronTaskPkgRollover = null;
let pkgRolloverRunning = false;

function normalizeStaffJid(phoneNumber) {
    let d = String(phoneNumber || "").replace(/@.*$/, "").replace(/\D/g, "");
    if (d.startsWith("0")) d = `62${d.slice(1)}`;
    if (d.length < 10) return "";
    return `${d}@s.whatsapp.net`;
}

async function alertAdmins(text) {
    try {
        const { getAdminJids } = require("../../admin-recipients");
        const jids = getAdminJids() || [];
        for (const jid of jids) await safeSendMessage(jid, { text });
    } catch (e) {
        console.error("[CRON_PKG_ROLLOVER] alertAdmins gagal:", e && e.message);
    }
}

/**
 * Satu tick rollover. NEVER-THROW per item. Diekspos untuk uji (deps di-inject).
 * @returns {Promise<{processed:number, applied:number, failed:number}>}
 */
async function runRolloverTick(deps = {}) {
    const repo = deps.repository || require("../../../repositories/admin.repository").createAdminRepository();
    const apply = deps.applyApprovedPackageChange || applyApprovedPackageChange;
    const send = deps.safeSendMessage || safeSendMessage;
    const now = deps.now ? deps.now() : Date.now();

    const requests = repo.getPackageChangeRequests();
    let processed = 0, applied = 0, failed = 0;

    for (let i = 0; i < requests.length; i++) {
        const r = requests[i];
        if (!r || r.status !== "scheduled" || !isDue(r.effective_date, now)) continue;
        processed += 1;

        const user = repo.getUserById(r.userId);
        const requestedPackage = repo.getPackageByName(r.requestedPackageName);
        if (!user || !requestedPackage || !requestedPackage.profile) {
            // Data hilang (user/paket terhapus) → batalkan jadwal + alarm, jangan gantung selamanya.
            r.status = "cancelled_by_system";
            r.sync_status = "rollover_data_missing";
            r.updatedAt = new Date().toISOString();
            repo.replacePackageChangeRequest(i, r);
            repo.persistPackageChangeRequests();
            failed += 1;
            await alertAdmins(`⚠️ Rollover paket #${r.id} dibatalkan: user/paket (${r.requestedPackageName}) tak ditemukan.`);
            continue;
        }

        try {
            const res = await apply({ user, requestedPackage, caller: "cron.package-change-rollover" });
            r.status = "approved";
            r.apply_mode = "applied";
            r.applied_at = new Date().toISOString();
            r.sync_status = res.mikrotikSync.status;
            r.sync_message = res.mikrotikSync.message;
            repo.replacePackageChangeRequest(i, r);
            repo.persistPackageChangeRequests();
            applied += 1;

            const priceNum = Number(requestedPackage.price) || 0;
            const priceLine = priceNum > 0 ? ` (Rp ${priceNum.toLocaleString("id-ID")}/bulan)` : "";
            // Pelanggan — tanpa detail internal.
            if (user.phone_number) {
                const msg = renderResponseTemplate(
                    "package_change_activated_customer",
                    `✅ Paket baru Anda *${r.requestedPackageName}*${priceLine} kini AKTIF. Terima kasih.`,
                    { customerName: user.name, packageName: r.requestedPackageName, priceLine }
                );
                for (const ph of String(user.phone_number).split("|").map((s) => s.trim()).filter(Boolean)) {
                    await send(normalizeStaffJid(ph), { text: msg });
                }
            }
            // Teknisi pengaju.
            const tech = repo.getAccountById(r.requestedById);
            if (tech && tech.phone_number) {
                const tmsg = renderResponseTemplate(
                    "package_change_activated_technician",
                    `✅ Paket pelanggan *${user.name}* resmi berganti ke *${r.requestedPackageName}* mulai hari ini (${formatTanggalWIB(r.effective_date)}).`,
                    { technicianName: tech.name || tech.username, customerName: user.name, packageName: r.requestedPackageName, effectiveDate: formatTanggalWIB(r.effective_date) }
                );
                await send(normalizeStaffJid(tech.phone_number), { text: tmsg });
            }
        } catch (error) {
            // Gagal MikroTik → biarkan 'scheduled' (retry tick berikutnya) + alarm admin. Jangan menebak.
            failed += 1;
            console.error(`[CRON_PKG_ROLLOVER_ERROR] #${r.id}: ${error.message}`);
            await alertAdmins(`🚨 Rollover paket #${r.id} (${user.name} → ${r.requestedPackageName}) GAGAL: ${error.message}. Akan dicoba lagi.`);
        }
    }

    return { processed, applied, failed };
}

function initPackageChangeRolloverTask(_config) {
    if (cronTaskPkgRollover) cronTaskPkgRollover.stop();

    // Per JAM (durabel thd restart 7-13x/hari): tick pertama setelah rollover awal bulan yang menerapkan.
    cronTaskPkgRollover = cron.schedule("0 * * * *", async () => {
        const cfg = (typeof global !== "undefined" && global.config && global.config.packageChangeDeferred) || {};
        if (cfg.enabled !== true) return; // GATE — inert bila OFF
        if (pkgRolloverRunning) { console.warn("[CRON_PKG_ROLLOVER_SKIPPED] tick sebelumnya masih jalan."); return; }
        pkgRolloverRunning = true;
        try {
            const res = await runRolloverTick();
            if (res.applied || res.failed) {
                console.log(`[CRON_PKG_ROLLOVER] proses=${res.processed} terapkan=${res.applied} gagal=${res.failed}`);
            }
        } catch (error) {
            console.error(`[CRON_PKG_ROLLOVER_ERROR] ${error.message}`);
        } finally {
            pkgRolloverRunning = false;
        }
    }, { scheduled: true, timezone: "Asia/Jakarta" });

    cronTaskPkgRollover.start();
    return { started: true, task: cronTaskPkgRollover };
}

module.exports = { initPackageChangeRolloverTask, runRolloverTick };
