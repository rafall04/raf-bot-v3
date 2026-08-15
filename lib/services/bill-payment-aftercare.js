/**
 * Header Doc
 * Purpose: SATU pemilik keputusan "apa yang terjadi SESUDAH pelunasan tagihan dicatat" —
 *          menentukan pesan mana yang dikirim ke pelanggan, dan menangani uang yang MASUK
 *          untuk periode yang ternyata sudah lunas (kelebihan bayar).
 * Caller: `routes/bill-payment.js` (callback Tripay & Mayar) dan `routes/public.js`
 *          (callback iPaymu).
 * Deps: `lib/services/paid-receipt` (teks pelanggan), `lib/financial-ledger`
 *          (baris kelebihan bayar), `lib/admin-recipients` + `lib/whatsapp-critical-delivery`
 *          (alarm admin).
 * MainFuncs: `putuskanTindakanPascaLunas`.
 * SideEffects: Menulis satu baris `financial_ledger` saat kelebihan bayar, dan mengirim
 *          alarm WhatsApp ke admin. TIDAK melempar — kegagalan notifikasi/ledger dilaporkan
 *          lewat nilai balik, tak boleh menjatuhkan callback gateway.
 *
 * KENAPA ADA — `applyPaymentStatusChange` memulangkan
 * `{action:'no_change', reason:'already_fully_paid'}` TANPA menulis satu baris pun ke ledger,
 * tetapi tetap `ok:true`. Ketiga callback gateway hanya membaca `settleResult.reactivation`
 * dan mengabaikan verdict itu, sehingga pembayaran KEDUA untuk periode yang sama menghasilkan:
 * uang benar-benar masuk rekening gateway, NOL baris di pembukuan, dan pelanggan tetap
 * menerima struk "tagihan Anda sudah LUNAS" seolah normal. Pemilik usaha tak punya cara
 * melihatnya sama sekali.
 *
 * Pencegahan utamanya ada di hulu (`findPendingPayment` — satu tagihan hidup per periode).
 * Modul ini jaring pengaman untuk yang tetap lolos (mis. dua tab dibuka bersamaan).
 */
"use strict";

const { buildPaidReceiptText, buildOverpaymentText } = require("./paid-receipt");

function depsBawaan() {
    return {
        upsertFinancialLedgerEntry: (...a) => require("../financial-ledger").upsertFinancialLedgerEntry(...a),
        getAdminJids: (...a) => require("../admin-recipients").getAdminJids(...a),
        sendCritical: (...a) => require("../whatsapp-critical-delivery").sendCritical(...a),
        logger: console,
    };
}

function formatRupiah(n) {
    return `Rp ${Number(n || 0).toLocaleString("id-ID")}`;
}

/**
 * Menentukan tindakan pasca-pelunasan berdasarkan VERDICT ledger, bukan asumsi.
 *
 * @returns {Promise<{jenis:'lunas'|'kelebihan', teksPelanggan:string, ledgerDicatat?:boolean, adminDialarmi?:boolean}>}
 */
async function putuskanTindakanPascaLunas(input, depsTimpaan) {
    const deps = Object.assign(depsBawaan(), depsTimpaan || {});
    const {
        user, settleResult, amount, periodMonth, periodYear, method, refId, gateway,
    } = input || {};

    const verdict = (settleResult && settleResult.ledger) || {};
    const kelebihan = verdict.action === "no_change" && verdict.reason === "already_fully_paid";

    if (!kelebihan) {
        return {
            jenis: "lunas",
            teksPelanggan: buildPaidReceiptText({
                user, amount, periodMonth, periodYear, method, refId,
                reactivation: (settleResult && settleResult.reactivation) || {},
            }),
        };
    }

    // --- Uang masuk untuk periode yang SUDAH lunas ---
    // Dicatat sebagai baris ledger tersendiri supaya uangnya TERLIHAT pemilik. Statusnya
    // sengaja `pending_review`: ia BUKAN pelunasan (periodenya sudah lunas) dan belum
    // diputuskan nasibnya, jadi tak boleh ikut menaikkan angka "sudah dibayar" periode itu.
    let ledgerDicatat = false;
    try {
        await deps.upsertFinancialLedgerEntry({
            domain: "tagihan",
            referenceType: "kelebihan_bayar",
            referenceId: String(refId || ""),
            userId: user && user.id,
            amount,
            direction: "credit",
            paymentMethod: method || gateway || "-",
            periodMonth,
            periodYear,
            status: "pending_review",
            createdBy: `gateway.${gateway || "unknown"}`,
            notes: `KELEBIHAN BAYAR — periode ${periodMonth}/${periodYear} sudah lunas sebelumnya. Perlu ditindaklanjuti manual.`,
            source: "system",
            // Kunci idempotensi per-transaksi: callback gateway bisa dikirim ulang, dan
            // baris ini tak boleh berlipat karenanya.
            eventKey: `kelebihan_bayar:${refId}`,
        });
        ledgerDicatat = true;
    } catch (err) {
        // Gagal mencatat TIDAK boleh menjatuhkan callback — tapi juga tak boleh senyap,
        // karena inilah satu-satunya jejak uang tersebut.
        deps.logger.error("[AFTERCARE] Gagal mencatat kelebihan bayar ke ledger:", err && err.message);
    }

    let adminDialarmi = false;
    try {
        const pesan = [
            "🚨 *KELEBIHAN BAYAR TERDETEKSI*",
            "",
            `Pelanggan : ${(user && user.name) || "-"}`,
            `Periode   : ${periodMonth}/${periodYear} (sudah lunas sebelumnya)`,
            `Nominal   : ${formatRupiah(amount)}`,
            `Metode    : ${method || gateway || "-"}`,
            `No. Ref   : ${refId || "-"}`,
            "",
            ledgerDicatat
                ? "Sudah dicatat di Rekap Keuangan sebagai *kelebihan bayar* (menunggu tindak lanjut)."
                : "⚠️ GAGAL dicatat ke pembukuan — catat manual sekarang juga.",
            "",
            "Uang ini SUDAH masuk ke rekening gateway. Hubungi pelanggan untuk menentukan: dikembalikan, atau dipakai untuk periode berikutnya.",
        ].join("\n");

        for (const jid of deps.getAdminJids() || []) {
            // sendCritical menerima string; dibungkus agar satu admin gagal tak menghentikan sisanya.
            try {
                await deps.sendCritical(jid, pesan);
                adminDialarmi = true;
            } catch (e1) {
                deps.logger.error("[AFTERCARE] Alarm ke admin gagal:", jid, e1 && e1.message);
            }
        }
    } catch (err) {
        deps.logger.error("[AFTERCARE] Alarm kelebihan bayar gagal total:", err && err.message);
    }

    return {
        jenis: "kelebihan",
        ledgerDicatat,
        adminDialarmi,
        teksPelanggan: buildOverpaymentText({ user, amount, periodMonth, periodYear, method, refId }),
    };
}

module.exports = { putuskanTindakanPascaLunas, depsBawaan };
