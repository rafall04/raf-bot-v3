/**
 * Header Doc
 * Purpose: SATU pemilik langkah "terapkan ganti paket ke pelanggan" (profil MikroTik + putus sesi +
 *   update users.subscription). Diekstrak dari services/admin.service.js agar dipakai ULANG oleh:
 *   (a) approve SEKETIKA (gate defer OFF) dan (b) cron rollover saat tanggal-berlaku tiba (gate ON).
 *   Perilaku identik dengan kode lama: gagal MikroTik => THROW (DB tidak di-update, cegah inkonsistensi).
 * Caller: services/admin.service.js (approvePackageChange immediate), lib/cron/jobs/package-change-rollover.js.
 * Deps: `./mikrotik` (updatePPPoEProfile/deleteActivePPPoEUser/assertMikrotikResult/isMikrotikSyncEnabled),
 *   `../repositories/admin.repository` (updateUserSubscription/syncUserSubscriptionCache/getConfig).
 * MainFuncs: applyApprovedPackageChange.
 * SideEffects: Panggilan MikroTik (ubah profil + disconnect) + tulis users.subscription (via repository).
 */
"use strict";

function defaultDeps() {
    const mt = require("./mikrotik");
    const { createAdminRepository } = require("../repositories/admin.repository");
    return {
        updatePPPoEProfile: mt.updatePPPoEProfile,
        deleteActivePPPoEUser: mt.deleteActivePPPoEUser,
        assertMikrotikResult: mt.assertMikrotikResult,
        isMikrotikSyncEnabled: mt.isMikrotikSyncEnabled,
        repository: createAdminRepository(),
    };
}

/**
 * Terapkan paket baru ke pelanggan. IDENTIK dgn langkah lama di admin.service.approvePackageChange.
 * @param {object} p
 * @param {object} p.user             user (punya id, pppoe_username, subscription).
 * @param {object} p.requestedPackage paket tujuan (punya name/profile/price).
 * @param {string} [p.caller]         label caller MikroTik.
 * @param {object} [p.deps]           override untuk uji.
 * @returns {Promise<{mikrotikSync:{status,message}, oldPackage:string}>}
 * @throws bila update profil MikroTik gagal (DB TIDAK diubah — cegah inconsistent state).
 */
async function applyApprovedPackageChange({ user, requestedPackage, caller = "package-change.apply", deps }) {
    const d = deps || defaultDeps();
    const oldPackage = user.subscription;
    const syncToMikrotik = d.isMikrotikSyncEnabled(d.repository.getConfig());
    let mikrotikSync = { status: "skipped_no_pppoe", message: "Tidak ada sinkronisasi MikroTik yang perlu dijalankan." };

    if (syncToMikrotik) {
        d.assertMikrotikResult(
            await d.updatePPPoEProfile(user.pppoe_username, requestedPackage.profile, { caller })
        );
        mikrotikSync = { status: "applied", message: `Profile MikroTik untuk ${user.pppoe_username} berhasil diperbarui ke ${requestedPackage.profile}.` };
        try {
            const disc = await d.deleteActivePPPoEUser(user.pppoe_username, { caller });
            if (!disc.ok) throw new Error(disc.message);
        } catch (error) {
            console.warn("[PKG_CHANGE_APPLY_WARN]", error.message);
        }
    } else {
        mikrotikSync = { status: "applied_locally_sync_disabled", message: "Sinkronisasi MikroTik dinonaktifkan. Perubahan paket hanya disimpan lokal." };
    }

    await d.repository.updateUserSubscription(user.id, requestedPackage.name);
    d.repository.syncUserSubscriptionCache(user.id, requestedPackage.name);

    return { mikrotikSync, oldPackage };
}

module.exports = { applyApprovedPackageChange, defaultDeps };
