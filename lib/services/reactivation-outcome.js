/**
 * Header Doc
 * Purpose: SATU sumber keputusan "apakah reaktivasi pasca-lunas perlu perhatian admin" + alarm
 *          admin-nya, dipakai SEMUA permukaan settlement (WA konfirmasi bukti, web konfirmasi-bayar,
 *          callback iPaymu/Tripay/Mayar). Sebelumnya tiap permukaan menilai sendiri: WA menyuarakan
 *          profile_read_failed, iPaymu cuma attempted&&!ok, Tripay/Mayar cuma catatan, web
 *          hardcoded "diaktifkan" — pelanggan bisa bayar tapi MASIH terisolir tanpa ada yang tahu.
 * Caller: message/handlers/payment-proof-admin-handler.js, routes/admin-konfirmasi-bayar-routes.js,
 *          routes/public.js (iPaymu), routes/bill-payment.js (Tripay & Mayar).
 * Deps: lazy — lib/admin-recipients (getAdminJids), lib/whatsapp-critical-delivery (sendCritical),
 *          lib/templating (renderTemplate). Semua bisa di-inject utk uji.
 * MainFuncs: reactivationNeedsAttention, describeReactivation, alertReaktivasiGagal.
 * SideEffects: alertReaktivasiGagal mengirim WA ke admin (never-throw).
 */
"use strict";

/**
 * True bila hasil reaktivasi INI perlu dicek admin manual: pelanggan mungkin MASIH terisolir
 * walau tagihannya sudah tercatat lunas. Dua kondisi (dari envelope maybeReactivate):
 *  - attempted && ok===false            → profil dicoba diubah tapi GAGAL.
 *  - attempted===false && profile_read_failed → router tak terbaca saat cek → BUTA (bisa masih terisolir).
 * Sisanya (no_pppoe/no_isolir_profile_config/not_isolated) benign — memang tak ada yang perlu dibuka.
 */
function reactivationNeedsAttention(reactivation) {
    if (!reactivation) return false;
    if (reactivation.attempted) return reactivation.ok === false;
    return reactivation.reason === "profile_read_failed";
}

/** Catatan singkat status reaktivasi utk pesan admin (mis. konfirmasi bukti di WA/web). */
function describeReactivation(reactivation) {
    if (!reactivation) return "";
    if (reactivation.attempted) {
        return reactivation.ok
            ? "\n🔌 Pelanggan terisolir → sudah diaktifkan kembali."
            : "\n⚠️ Reaktivasi MikroTik GAGAL — cek profil PPPoE-nya manual ya.";
    }
    // Tak dicoba: mayoritas benign (pelanggan MEMANG tidak terisolir → tak ada yang perlu dibuka).
    // TAPI kalau profil live tak terbaca (router tak terjangkau), kita BUTA: pelanggan yang barusan
    // bayar bisa MASIH terisolir tanpa ada yang tahu. Jangan diam — suarakan agar admin cek manual.
    if (reactivation.reason === "profile_read_failed") {
        return "\n⚠️ Router tak terbaca saat cek isolir — pastikan manual pelanggan sudah bisa online (mungkin masih terisolir).";
    }
    return "";
}

/**
 * Alarm admin "pelanggan bayar tapi reaktivasi gagal/tak terbaca". Never-throw (best-effort):
 * kegagalan kirim TIDAK boleh menjatuhkan callback gateway. @returns {Promise<boolean>} terkirim?
 */
async function alertReaktivasiGagal({ user, refId }, deps = {}) {
    try {
        const getAdminJids = deps.getAdminJids || require("../admin-recipients").getAdminJids;
        const sendCritical = deps.sendCritical || require("../whatsapp-critical-delivery").sendCritical;
        const renderTemplate = deps.renderTemplate || require("../templating").renderTemplate;

        const text = renderTemplate("tagihan_reaktivasi_gagal_admin", {
            nama_pelanggan: (user && user.name) || "-",
            pppoe: (user && user.pppoe_username) || "-",
            reference_id: refId || "-",
        });

        const jids = getAdminJids() || [];
        if (!jids.length) {
            console.error("[REAKTIVASI_GAGAL] Tak ada JID admin untuk alarm reaktivasi gagal.");
            return false;
        }
        let sent = false;
        for (const jid of jids) {
            try {
                await sendCritical(jid, { text }, { label: "tagihan-reaktivasi-gagal" });
                sent = true;
            } catch (e) {
                console.error("[REAKTIVASI_GAGAL] Gagal kirim ke", jid, e && e.message);
            }
        }
        return sent;
    } catch (e) {
        console.error("[REAKTIVASI_GAGAL] Alarm reaktivasi gagal total:", e && e.message);
        return false;
    }
}

module.exports = { reactivationNeedsAttention, describeReactivation, alertReaktivasiGagal };
