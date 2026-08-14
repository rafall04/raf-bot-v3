/**
 * Header Doc
 * Purpose: Method `deleteUserById` — hapus single user dari DB + in-memory snapshot, putus sesi PPPoE aktif + HAPUS secret PPPoE di MikroTik (best-effort, agar pelanggan yang dihapus tak bisa konek lagi), reset ODP port usage jika user terkait ke ODP, lalu log activity. Audit log dilakukan SEBELUM delete sehingga jika delete gagal, audit tetap menggambarkan intent action.
 * Caller: `services/api-users.service.js` (composer wraps menjadi method `service.deleteUserById(args)`).
 * Deps: `deps.repository.findUserById`/`deleteUserRecord`/`getUsersSnapshot`/`replaceUsersSnapshot`, `deps.logActivity`, `deps.deleteActivePPPoEUser`, `deps.removePPPoESecret` (opsional), `deps.syncPortUsage` (hitung ulang port ODP), `deps.alertSystem` (opsional, fallback `global.alertSystem`), `deps.logger`.
 * MainFuncs: `deleteUserById(deps, { userId, actor, requestMeta })`.
 * SideEffects: Activity log (best-effort) + MikroTik putus-sesi + hapus-secret + DB delete + in-memory snapshot replace + ODP port usage reset + alert admin bila secret tertinggal.
 * KEJUJURAN: respons membawa `langkah{sesi_diputus,secret_dihapus,baris_dihapus,port_odp}` + `perlu_dibersihkan` + `pppoe_tertinggal`. Baris pelanggan TETAP dihapus walau MikroTik gagal (itu disengaja), TAPI kegagalan hapus SECRET tidak boleh dilaporkan sebagai sukses biasa: secret yang tertinggal = modem terus konek atas nama pelanggan yang sudah lenyap (modem hantu) → wizard PSB memvonisnya milik "pelanggan tak dikenal" dan tak seorang pun bisa menutup pelanggan yang tak ada. Pemanggil WAJIB menampilkan `perlu_dibersihkan`.
 */
"use strict";

async function deleteUserById(deps, { userId, actor, requestMeta }) {
    const user = deps.repository.findUserById(userId);
    if (!user) {
        return {
            status: 404,
            body: {
                status: 404,
                message: "User tidak ditemukan"
            }
        };
    }

    if (deps.logActivity) {
        try {
            await deps.logActivity({
                userId: actor?.id,
                username: actor?.username,
                role: actor?.role,
                actionType: "DELETE",
                resourceType: "user",
                resourceId: String(user.id),
                resourceName: user.name,
                description: `Deleted user ${user.name}`,
                oldValue: {
                    name: user.name,
                    phone_number: user.phone_number,
                    subscription: user.subscription,
                    paid: user.paid,
                    pppoe_username: user.pppoe_username
                },
                newValue: null,
                ipAddress: requestMeta?.ipAddress,
                userAgent: requestMeta?.userAgent
            });
        } catch (logErr) {
            deps.logger.error?.("[ACTIVITY_LOG_ERROR] Failed to log user delete:", logErr);
        }
    }

    // Hasil PER LANGKAH. Dulu semua kegagalan MikroTik hanya di-log lalu request tetap menjawab
    // "User berhasil dihapus" — padahal bila penghapusan SECRET gagal, modem pelanggan itu terus
    // bisa konek atas nama orang yang barisnya sudah tidak ada. Modem itu lalu tampak "milik
    // pelanggan tak dikenal" di wizard PSB dan tak seorang pun bisa menutup pelanggan yang sudah
    // lenyap — modem hantu. Kegagalannya tetap tidak menggagalkan penghapusan (baris HARUS hilang),
    // tapi ia WAJIB dilaporkan apa adanya ke pemanggil.
    const langkah = {
        sesi_diputus: { dijalankan: false, ok: false, pesan: null },
        secret_dihapus: { dijalankan: false, ok: false, pesan: null },
        baris_dihapus: { dijalankan: false, ok: false, pesan: null },
        port_odp: { dijalankan: false, ok: false, pesan: null }
    };

    if (user.pppoe_username) {
        langkah.sesi_diputus.dijalankan = true;
        try {
            const disconnectResult = await deps.deleteActivePPPoEUser(user.pppoe_username, { caller: "api.user-delete" });
            if (!disconnectResult || disconnectResult.ok === false) {
                throw new Error((disconnectResult && disconnectResult.message) || "router tak merespons");
            }
            langkah.sesi_diputus.ok = true;
        } catch (err) {
            langkah.sesi_diputus.pesan = err.message;
            deps.logger.error?.("[DELETE_USER] Gagal memutus sesi PPPoE:", err);
        }

        // Hapus SECRET PPPoE di MikroTik supaya pelanggan yang di-hapus tak bisa konek lagi
        // (kick sesi di atas hanya memutus sekarang; tanpa hapus secret dia bisa reconnect).
        if (typeof deps.removePPPoESecret === "function") {
            langkah.secret_dihapus.dijalankan = true;
            try {
                const removeResult = await deps.removePPPoESecret(user.pppoe_username, { caller: "api.user-delete" });
                if (removeResult && removeResult.ok === false) {
                    throw new Error(removeResult.message || "router menolak");
                }
                langkah.secret_dihapus.ok = true;
            } catch (err) {
                langkah.secret_dihapus.pesan = err.message;
                deps.logger.error?.("[DELETE_USER] Gagal hapus PPPoE secret di MikroTik:", err);
            }
        }
    }

    await deps.repository.deleteUserRecord(userId);
    langkah.baris_dihapus.dijalankan = true;
    langkah.baris_dihapus.ok = true;
    const nextUsers = deps.repository.getUsersSnapshot().filter((currentUser) => String(currentUser.id) !== String(userId));
    deps.repository.replaceUsersSnapshot(nextUsers);

    // Pemakaian port ODP DITURUNKAN dari data pelanggan → hitung ulang setelah user hilang.
    // Best-effort & NEVER-THROW: user sudah terhapus; gagal menyegarkan angka port tak boleh
    // menggagalkan request (boot juga menghitung ulang).
    // DULU di sini: `deps.updateOdpPortUsage?.(user.odp_id, user.odp_port, false)` — MATI TOTAL:
    // kolomnya `connected_odp_id` (bukan `odp_id`) dan `odp_port` TAK PERNAH ADA, jadi penjaganya
    // tak pernah lolos. Argumennya pun keliru (signature: odpId, increment, assetsArray → `3` masuk
    // ke `increment`, `false` ke `assetsArray`). Test lama justru MENGUNCI panggilan cacat itu.
    if (typeof deps.syncPortUsage === "function") {
        langkah.port_odp.dijalankan = true;
        try {
            deps.syncPortUsage({ getUsers: () => nextUsers });
            langkah.port_odp.ok = true;
        } catch (err) {
            langkah.port_odp.pesan = err.message;
            deps.logger?.error?.("[DELETE_USER] Gagal hitung ulang pemakaian port ODP:", err);
        }
    }

    // AKAR MODEM HANTU: secret yang gagal dihapus membuat modem terus konek atas nama pelanggan
    // yang barisnya sudah lenyap. Jangan pernah dilaporkan sebagai sukses biasa — sebutkan
    // kredensial yang tertinggal supaya ada yang bisa dikerjakan, dan bangunkan admin sekarang
    // juga (kalau menunggu ketahuan sendiri, ketahuannya baru saat teknisi buntu di lapangan).
    const secretTertinggal = langkah.secret_dihapus.dijalankan && !langkah.secret_dihapus.ok;
    if (secretTertinggal) {
        try {
            const alertSystem = deps.alertSystem || global.alertSystem;
            await alertSystem?.sendAlert?.("warning", "PPPOE_SECRET_TERTINGGAL", {
                pelanggan: user.name,
                pppoe: user.pppoe_username,
                alasan: langkah.secret_dihapus.pesan || "-",
                action: `Hapus manual secret PPPoE \`${user.pppoe_username}\` di MikroTik, atau pakai alat Sisa PPPoE di panel.`
            });
        } catch (err) {
            deps.logger?.error?.("[DELETE_USER] Gagal mengirim alert secret tertinggal:", err.message);
        }
    }

    return {
        status: 200,
        body: {
            status: 200,
            message: secretTertinggal
                ? `Data ${user.name} dihapus, TAPI secret PPPoE "${user.pppoe_username}" masih tertinggal di MikroTik — modemnya masih bisa konek. Hapus manual atau lewat alat Sisa PPPoE.`
                : "User berhasil dihapus",
            langkah,
            perlu_dibersihkan: secretTertinggal,
            pppoe_tertinggal: secretTertinggal ? user.pppoe_username : null
        }
    };
}

module.exports = {
    deleteUserById
};
