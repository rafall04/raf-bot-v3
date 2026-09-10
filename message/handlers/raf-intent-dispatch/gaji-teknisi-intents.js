/**
 * Header Doc
 * Purpose: Intent WhatsApp bagi TEKNISI untuk memeriksa gajinya sendiri — status payroll bulan
 *          berjalan, komisi penarikan, komisi marketing PSB, dan sisa hutang kasbon.
 *
 *          Kenapa perlu: sampai sekarang teknisi hanya menerima SATU pesan, yaitu saat gajinya
 *          dibayar. Ia tak bisa memeriksa komisinya, tak bisa membantah angka, dan tak punya
 *          cara tahu kasbonnya sudah dipotong atau belum. Pihak yang paling dirugikan kalau ada
 *          yang salah justru yang paling sedikit aksesnya.
 * Caller: `message/handlers/raf-intent-dispatch/index.js` (composer dispatcher intent).
 * Deps: `lib/technician-finance-service` (angka gaji), `lib/technician-collection-settlement`
 *        (rekap penarikan `setoran saya` — sumber sama dgn tabel "Pemasukan per Teknisi" panel).
 * MainFuncs: `GAJI_TEKNISI_INTENT_HANDLERS`, `handleGajiSayaIntent`, `handleSetoranSayaIntent`.
 * SideEffects: Tidak ada (baca saja). Tak pernah mengubah payroll/ledger.
 */
"use strict";

function rupiah(n) {
    return "Rp" + (Number(n) || 0).toLocaleString("id-ID");
}

const NAMA_BULAN = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function labelStatus(status) {
    return {
        draft: "🟡 Draft (belum dikunci)",
        finalized: "🔵 Sudah dikunci, menunggu dibayar",
        paid: "🟢 Sudah dibayar"
    }[status] || status || "-";
}

/**
 * `gaji saya` — ringkasan gaji teknisi yang bertanya, untuk bulan berjalan.
 *
 * Angkanya diambil dari service yang SAMA dengan halaman admin, jadi teknisi dan pemilik
 * melihat dasar yang sama. Kalau keduanya membaca sumber berbeda, selisihnya akan jadi
 * perdebatan yang tak bisa diselesaikan siapa pun.
 */
async function handleGajiSayaIntent(context) {
    const { isTeknisi, reply, renderResponseTemplate } = context;

    if (!isTeknisi) {
        return reply(renderResponseTemplate(
            "gaji_saya_bukan_teknisi",
            "Perintah ini khusus untuk teknisi terdaftar."
        ));
    }

    // `isTeknisi` bisa berupa object akun (sudah LID-aware dari raf-context) atau sekadar true.
    const akun = typeof isTeknisi === "object" && isTeknisi ? isTeknisi : null;
    const teknisiId = akun && akun.id;
    if (!teknisiId) {
        return reply(renderResponseTemplate(
            "gaji_saya_akun_tak_dikenali",
            "Akun teknisi Anda belum bisa dikenali dari nomor ini. Minta admin memeriksa nomor WhatsApp di akun Anda."
        ));
    }

    let finance;
    try {
        finance = require("../../../lib/technician-finance-service");
    } catch (error) {
        console.error("[GAJI_SAYA_MODUL_ERROR]", error.message);
        return reply(renderResponseTemplate("gaji_saya_gagal", "Maaf, data gaji sedang tidak bisa dibaca. Coba lagi nanti."));
    }

    const sekarang = new Date();
    const bulan = sekarang.getMonth() + 1;
    const tahun = sekarang.getFullYear();

    try {
        const [daftar, kasbon, komisi, marketing] = await Promise.all([
            finance.getPayrollList({ teknisiId, month: bulan, year: tahun }).catch(() => []),
            finance.getKasbonSummary({ teknisiId }).catch(() => ({ total_outstanding: 0 })),
            finance.getCollectionPayableSummary({ teknisiId, periodMonth: bulan, periodYear: tahun }).catch(() => ({ net_total: 0 })),
            finance.getMarketingPayableSummary({ teknisiId, periodMonth: bulan, periodYear: tahun }).catch(() => ({ net_total: 0 }))
        ]);

        const payroll = (daftar || [])[0] || null;
        const sisaHutang = Number(kasbon && kasbon.total_outstanding) || 0;

        // Kalau payroll-nya sudah ada, angka DI PAYROLL yang berlaku — itulah yang akan dibayar.
        // Kalau belum, tampilkan yang sedang terkumpul supaya teknisi tetap bisa memantau.
        const baris = [];
        baris.push(`💼 *GAJI SAYA — ${NAMA_BULAN[bulan]} ${tahun}*`);
        baris.push("");

        if (payroll) {
            baris.push(`Status: ${labelStatus(payroll.status)}`);
            baris.push("");
            baris.push(`• Gaji pokok      : ${rupiah(payroll.gaji_pokok)}`);
            if (Number(payroll.komisi_collection) > 0) baris.push(`• Komisi penarikan: ${rupiah(payroll.komisi_collection)}`);
            if (Number(payroll.komisi_marketing) > 0) baris.push(`• Komisi marketing: ${rupiah(payroll.komisi_marketing)}`);
            if (Number(payroll.bonus_manual) > 0) baris.push(`• Bonus           : ${rupiah(payroll.bonus_manual)}`);
            if (Number(payroll.potongan_kasbon) > 0) baris.push(`• Potongan kasbon : -${rupiah(payroll.potongan_kasbon)}`);
            if (Number(payroll.potongan_lain) > 0) baris.push(`• Potongan lain   : -${rupiah(payroll.potongan_lain)}`);
            baris.push("");
            baris.push(`*Gaji bersih: ${rupiah(payroll.net_amount)}*`);
        } else {
            baris.push("Status: ⚪ Belum dibuatkan payroll bulan ini");
            baris.push("");
            baris.push("Yang sudah terkumpul:");
            baris.push(`• Komisi penarikan: ${rupiah(komisi && komisi.net_total)}`);
            if (Number(marketing && marketing.net_total) > 0) baris.push(`• Komisi marketing: ${rupiah(marketing.net_total)}`);
            baris.push("");
            baris.push("_Gaji pokok dan potongan dihitung saat payroll dibuat._");
        }

        if (sisaHutang > 0) {
            baris.push("");
            baris.push(`💳 Sisa kasbon: ${rupiah(sisaHutang)}`);
            if (payroll && Number(payroll.potongan_kasbon) <= 0) {
                baris.push("_Belum dipotong dari gaji bulan ini._");
            }
        }

        baris.push("");
        baris.push("_Kalau ada angka yang menurut Anda keliru, sampaikan ke admin._");

        return reply(renderResponseTemplate("gaji_saya_ringkasan", baris.join("\n"), {
            periode: `${NAMA_BULAN[bulan]} ${tahun}`,
            rincian: baris.slice(2).join("\n")
        }));
    } catch (error) {
        console.error("[GAJI_SAYA_ERROR]", error.message);
        return reply(renderResponseTemplate("gaji_saya_gagal", "Maaf, data gaji sedang tidak bisa dibaca. Coba lagi nanti."));
    }
}

/**
 * `setoran saya` / `rekap saya` — rekap UANG penarikan teknisi (BAGIAN 3). READ-ONLY, reuse
 * getSettlementReport (technician_collection_ledger) — sumber yang sama dengan tabel "Pemasukan per
 * Teknisi" di panel admin. Menampilkan: uang tertagih, jumlah tarikan, fee, dan SISA SETORAN =
 * tertagih − fee (kebijakan owner: fee dipotong saat setor). Default periode = bulan berjalan;
 * `setoran saya hari ini` = hari ini; `setoran saya bulan lalu` = bulan sebelumnya.
 */
async function handleSetoranSayaIntent(context) {
    const { isTeknisi, reply, renderResponseTemplate, qAfterKeyword } = context;

    if (!isTeknisi) {
        return reply(renderResponseTemplate("setoran_saya_bukan_teknisi", "Perintah ini khusus untuk teknisi terdaftar."));
    }
    const akun = typeof isTeknisi === "object" && isTeknisi ? isTeknisi : null;
    const teknisiId = akun && akun.id;
    if (!teknisiId) {
        return reply(renderResponseTemplate("setoran_saya_akun_tak_dikenali",
            "Akun teknisi Anda belum bisa dikenali dari nomor ini. Minta admin memeriksa nomor WhatsApp di akun Anda."));
    }

    let settlement;
    try {
        settlement = require("../../../lib/technician-collection-settlement");
    } catch (error) {
        console.error("[SETORAN_SAYA_MODUL_ERROR]", error.message);
        return reply(renderResponseTemplate("setoran_saya_gagal", "Maaf, data setoran sedang tidak bisa dibaca. Coba lagi nanti."));
    }

    const cfg = settlement.getCommissionConfig();
    if (!cfg.enabled) {
        return reply(renderResponseTemplate("setoran_saya_fitur_off",
            "ℹ️ Fitur rekap penarikan (fee teknisi) belum diaktifkan admin. Hubungi admin bila mestinya aktif."));
    }

    // Periode: bulan berjalan (default), "hari ini", atau "bulan lalu".
    const arg = String(qAfterKeyword || "").toLowerCase();
    const now = new Date();
    let query;
    let periodeLabel;
    if (/hari ini|hariini|today/.test(arg)) {
        const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
        const from = new Date(y, m, d, 0, 0, 0).toISOString();
        const to = new Date(y, m, d, 23, 59, 59).toISOString();
        query = { teknisiId, dateFrom: from, dateTo: to };
        periodeLabel = `Hari ini (${now.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" })})`;
    } else if (/bulan lalu|bln lalu/.test(arg)) {
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        query = { teknisiId, month: prev.getMonth() + 1, year: prev.getFullYear() };
        periodeLabel = `${NAMA_BULAN[prev.getMonth() + 1]} ${prev.getFullYear()}`;
    } else {
        query = { teknisiId, month: now.getMonth() + 1, year: now.getFullYear() };
        periodeLabel = `${NAMA_BULAN[now.getMonth() + 1]} ${now.getFullYear()}`;
    }

    try {
        const report = await settlement.getSettlementReport(query);
        const totals = report.totals || {};
        const bucket = (report.summary || [])[0] || {};
        const tertagih = Number(totals.total_collected) || 0;
        const fee = Number(totals.net_total) || 0;
        const sisaSetor = tertagih - fee; // kebijakan: fee dipotong saat setor
        const jumlahTarikan = Number(bucket.collected_count) || 0;
        const pelanggan = bucket.unique_paid_customers != null ? Number(bucket.unique_paid_customers) : jumlahTarikan;

        const baris = [
            `📊 *SETORAN SAYA — ${periodeLabel}*`,
            "",
            `• Uang tertagih   : ${rupiah(tertagih)}  (${jumlahTarikan} tarikan)`,
            `• Fee kamu        : ${rupiah(fee)}  (Rp${(Number(cfg.amount) || 0).toLocaleString("id-ID")}/tarikan)`,
            "━━━━━━━━━━━━━━",
            `💰 *Sisa setor ke kantor: ${rupiah(sisaSetor)}*`,
            `   (uang tertagih − fee kamu)`,
        ];
        if (pelanggan && pelanggan !== jumlahTarikan) baris.push(`\n_${pelanggan} pelanggan lunas._`);
        baris.push("", "_Fee dipotong saat setor. Kalau ada angka keliru, lapor admin._");

        return reply(renderResponseTemplate("setoran_saya_ringkasan", baris.join("\n"), {
            periode: periodeLabel,
            tertagih: rupiah(tertagih),
            fee: rupiah(fee),
            sisa: rupiah(sisaSetor),
            tarikan: jumlahTarikan
        }));
    } catch (error) {
        console.error("[SETORAN_SAYA_ERROR]", error.message);
        return reply(renderResponseTemplate("setoran_saya_gagal", "Maaf, data setoran sedang tidak bisa dibaca. Coba lagi nanti."));
    }
}

const GAJI_TEKNISI_INTENT_HANDLERS = Object.freeze({
    GAJI_SAYA: handleGajiSayaIntent,
    SETORAN_SAYA: handleSetoranSayaIntent
});

module.exports = {
    GAJI_TEKNISI_INTENT_HANDLERS,
    handleGajiSayaIntent,
    handleSetoranSayaIntent
};
