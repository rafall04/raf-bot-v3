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
    const toInt = (n) => Math.max(0, Math.trunc(Number(n) || 0));
    // Kelebihan bayar muncul DUA cara:
    //  (a) PENUH   — periode sudah lunas sebelumnya (no_change/already_fully_paid): seluruh `amount` kelebihan.
    //  (b) SEBAGIAN — pembayaran MELEBIHI sisa tagihan (#b329; mis. cicilan lalu pelunasan penuh via QRIS):
    //      pelunasannya SAH (periode jadi lunas), tapi selisih `droppedExcess` dulu masuk tanpa jejak.
    const kelebihanPenuh = verdict.action === "no_change" && verdict.reason === "already_fully_paid";
    const kelebihanSisa = verdict.action === "paid" && toInt(verdict.droppedExcess) > 0;
    const nominalKelebihan = kelebihanPenuh ? toInt(amount) : (kelebihanSisa ? toInt(verdict.droppedExcess) : 0);

    if (!kelebihanPenuh && !kelebihanSisa) {
        return {
            jenis: "lunas",
            teksPelanggan: buildPaidReceiptText({
                user, amount, periodMonth, periodYear, method, refId,
                reactivation: (settleResult && settleResult.reactivation) || {},
            }),
        };
    }

    // --- Uang masuk yang MELEBIHI kebutuhan periode ---
    // Baris ledger tersendiri (pending_review) supaya uangnya TERLIHAT pemilik & TAK menaikkan angka
    // "sudah dibayar" periode itu.
    const konteks = kelebihanPenuh
        ? `periode ${periodMonth}/${periodYear} sudah lunas sebelumnya`
        : `melebihi sisa tagihan periode ${periodMonth}/${periodYear}`;
    let ledgerDicatat = false;
    try {
        await deps.upsertFinancialLedgerEntry({
            domain: "tagihan",
            referenceType: "kelebihan_bayar",
            referenceId: String(refId || ""),
            userId: user && user.id,
            amount: nominalKelebihan,
            direction: "credit",
            paymentMethod: method || gateway || "-",
            periodMonth,
            periodYear,
            status: "pending_review",
            createdBy: `gateway.${gateway || "unknown"}`,
            notes: `KELEBIHAN BAYAR — ${konteks}. Perlu ditindaklanjuti manual.`,
            source: "system",
            // Kunci idempotensi per-transaksi: callback gateway bisa dikirim ulang, baris ini tak boleh berlipat.
            eventKey: `kelebihan_bayar:${refId}`,
        });
        ledgerDicatat = true;
    } catch (err) {
        deps.logger.error("[AFTERCARE] Gagal mencatat kelebihan bayar ke ledger:", err && err.message);
    }

    let adminDialarmi = false;
    try {
        const pesan = [
            "🚨 *KELEBIHAN BAYAR TERDETEKSI*",
            "",
            `Pelanggan : ${(user && user.name) || "-"}`,
            `Periode   : ${periodMonth}/${periodYear} (${kelebihanPenuh ? "sudah lunas sebelumnya" : "kelebihan di atas sisa"})`,
            `Nominal   : ${formatRupiah(nominalKelebihan)}`,
            `Metode    : ${method || gateway || "-"}`,
            `No. Ref   : ${refId || "-"}`,
            "",
            ledgerDicatat
                ? "Sudah dicatat di Rekap Keuangan sebagai *kelebihan bayar* (menunggu tindak lanjut)."
                : "⚠️ GAGAL dicatat ke pembukuan — catat manual sekarang juga.",
            "",
            "Uang ini SUDAH masuk ke rekening gateway. Hubungi pelanggan: dikembalikan, atau dipakai untuk periode berikutnya.",
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

    // Kelebihan PENUH → pelanggan diberi tahu periode sudah lunas (uang jadi kelebihan). Kelebihan
    // SEBAGIAN → periode BARU lunas: kirim struk lunas NORMAL; selisihnya cukup dicatat + admin dialarmi.
    if (kelebihanPenuh) {
        return {
            jenis: "kelebihan",
            ledgerDicatat,
            adminDialarmi,
            teksPelanggan: buildOverpaymentText({ user, amount, periodMonth, periodYear, method, refId }),
        };
    }
    return {
        jenis: "lunas",
        ledgerDicatat,
        adminDialarmi,
        teksPelanggan: buildPaidReceiptText({
            user, amount, periodMonth, periodYear, method, refId,
            reactivation: (settleResult && settleResult.reactivation) || {},
        }),
    };
}

module.exports = { putuskanTindakanPascaLunas, depsBawaan };
