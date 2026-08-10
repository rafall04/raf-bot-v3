/**
 * Header Doc
 * Purpose: Merakit RINGKASAN UANG untuk grup kas usaha — pemasukan bulan berjalan, uang masuk
 *          hari ini, perkiraan omset (MRR), tingkat pelunasan, tunggakan, pengeluaran, dan sisa
 *          bersih.
 *          Sengaja TIDAK menghitung apa pun sendiri: seluruh angka diambil dari pemilik yang
 *          sudah ada — `lib/owner-cockpit-service` (kartu Pemasukan) dan `lib/financial-ledger`
 *          (arus kas). Menghitung omset di dua tempat adalah cara paling pasti membuat angka di
 *          grup berbeda dengan angka di halaman, dan yang kalah selalu kepercayaan pemiliknya.
 * Caller: `message/handlers/business-expense-wa.js` (perintah `uang`),
 *         `lib/cron/jobs/money-digest.js` (ringkasan terjadwal).
 * Deps: `./owner-cockpit-service` + `../financial-ledger` (lazy, injectable untuk test),
 *       `../personal-finance-service.formatRupiah`, `../../message/handlers/template-helpers`.
 * MainFuncs: `buildMoneySummary`, `buildMoneySummaryText`.
 * SideEffects: READ-ONLY. Tidak menulis DB dan tidak mengirim pesan.
 */
"use strict";

const { formatRupiah } = require("../personal-finance-service");

/** Periode berjalan (bulan/tahun) — dipakai kalau pemanggil tak menentukan. */
function periodeSekarang(date = new Date()) {
    return { periodMonth: date.getMonth() + 1, periodYear: date.getFullYear() };
}

function bulat(n) {
    const v = Number(n);
    return Number.isFinite(v) ? Math.round(v) : 0;
}

/**
 * Kumpulkan angka uang periode berjalan.
 *
 * BEST-EFFORT PER SUMBER, seperti Owner Cockpit: satu sumber gagal tidak boleh menjatuhkan
 * seluruh ringkasan. Yang gagal dipulangkan `null` — dan `null` HARUS dibedakan dari `0` saat
 * ditampilkan. "Pemasukan Rp0" itu kabar buruk yang menuntut tindakan; "pemasukan tak terbaca"
 * itu bot yang sedang buta. Menyamakan keduanya membuat pemilik panik atau, lebih buruk, tenang
 * padahal tak ada yang tahu keadaannya.
 *
 * @param {Object} [opsi]
 * @param {Object} [opsi.deps] injeksi untuk test: `{ cockpit, ledger }`
 * @returns {Promise<Object>} angka mentah + penanda sumber yang gagal
 */
async function buildMoneySummary(opsi = {}) {
    const { periodMonth, periodYear } = opsi.period || periodeSekarang();
    const deps = opsi.deps || {};
    const gagal = [];

    let pemasukan = null;
    try {
        // `buildIncomeOnly`, BUKAN `buildCockpit`: cockpit penuh ikut memanggil MikroTik
        // (~12 dtk) yang tak dibutuhkan angka uang sama sekali.
        const cockpit = deps.cockpit || require("../owner-cockpit-service");
        const kartu = await cockpit.buildIncomeOnly();
        if (kartu && kartu.ok !== false) pemasukan = kartu;
        else gagal.push("pemasukan");
    } catch (_e) {
        gagal.push("pemasukan");
    }

    let arus = null;
    try {
        const ledger = deps.ledger || require("../financial-ledger");
        // Filternya `{month, year}` — BUKAN dateFrom/dateTo. Nama filter yang tak dikenal
        // diabaikan DIAM-DIAM oleh query builder-nya, dan hasilnya "sisa bersih" yang
        // sebenarnya total sepanjang masa tapi berlabel bulan berjalan.
        const laporan = await ledger.getFinancialLedgerReport({ month: periodMonth, year: periodYear });
        arus = ledger.buildCashflowSummary((laporan && laporan.entries) || []);
    } catch (_e) {
        gagal.push("arus_kas");
    }

    return {
        periode: `${periodMonth}/${periodYear}`,
        // Dari kartu Pemasukan cockpit (null = tak terbaca, BUKAN nol).
        netPaid: pemasukan ? bulat(pemasukan.netPaid) : null,
        todayCount: pemasukan ? bulat(pemasukan.todayCount) : null,
        todayAmount: pemasukan ? bulat(pemasukan.todayAmount) : null,
        mrr: pemasukan ? bulat(pemasukan.mrr) : null,
        totalCustomers: pemasukan ? bulat(pemasukan.totalCustomers) : null,
        lunas: pemasukan ? bulat(pemasukan.lunas) : null,
        collectionRate: pemasukan && pemasukan.collectionRate != null ? bulat(pemasukan.collectionRate) : null,
        arrearsCustomers: pemasukan && pemasukan.arrearsCustomers != null ? bulat(pemasukan.arrearsCustomers) : null,
        arrearsOutstanding: pemasukan && pemasukan.arrearsOutstanding != null ? bulat(pemasukan.arrearsOutstanding) : null,
        trendPct: pemasukan && pemasukan.trendPct != null ? bulat(pemasukan.trendPct) : null,
        // Dari buku besar terpadu.
        totalIncome: arus ? bulat(arus.totalIncome) : null,
        totalExpense: arus ? bulat(arus.totalExpense) : null,
        netTotal: arus ? bulat(arus.netTotal) : null,
        gagal
    };
}

/** Rupiah, atau tanda "tak terbaca" — JANGAN pernah menampilkan null sebagai Rp0. */
function nominalAtau(n) {
    return n == null ? "_tak terbaca_" : formatRupiah(n);
}
function angkaAtau(n, akhiran = "") {
    return n == null ? "_tak terbaca_" : `${n}${akhiran}`;
}

/**
 * Rakit teks ringkasan untuk grup kas.
 * Teksnya lewat template (`be_ringkasan_uang`) supaya operator bisa menyuntingnya dari
 * halaman Template tanpa menyentuh kode.
 *
 * @param {Object} data hasil `buildMoneySummary`
 * @param {Object} [opsi] `{ judul }` — mis. "HARI INI" / "REKAP BULAN"
 */
function buildMoneySummaryText(data, opsi = {}) {
    const { renderResponseTemplate } = require("../../message/handlers/template-helpers");

    const tren = data.trendPct == null
        ? ""
        : `\n📈 Tren vs bulan lalu: ${data.trendPct > 0 ? "+" : ""}${data.trendPct}%`;

    const catatanGagal = (data.gagal || []).length
        ? `\n\n⚠️ Sebagian angka tak terbaca (${data.gagal.join(", ")}) — bukan berarti nol.`
        : "";

    return renderResponseTemplate(
        "be_ringkasan_uang",
        "💰 *RINGKASAN UANG* — ${judul}\n" +
            "Periode ${periode}\n\n" +
            "*MASUK*\n" +
            "• Bulan ini      : ${net_paid}\n" +
            "• Hari ini       : ${today_amount} (${today_count} transaksi)\n" +
            "• Perkiraan omset: ${mrr}\n" +
            "• Sudah lunas    : ${lunas}/${total_pelanggan} (${collection_rate}%)\n" +
            "• Tunggakan      : ${tunggakan} dari ${tunggakan_pelanggan} pelanggan${tren}\n\n" +
            "*KELUAR*\n" +
            "• Pengeluaran    : ${total_pengeluaran}\n\n" +
            "*SISA*\n" +
            "• Bersih         : ${sisa_bersih}${catatan}",
        {
            judul: opsi.judul || "BULAN BERJALAN",
            periode: data.periode,
            net_paid: nominalAtau(data.netPaid),
            today_amount: nominalAtau(data.todayAmount),
            today_count: angkaAtau(data.todayCount),
            mrr: nominalAtau(data.mrr),
            lunas: angkaAtau(data.lunas),
            total_pelanggan: angkaAtau(data.totalCustomers),
            collection_rate: angkaAtau(data.collectionRate),
            tunggakan: nominalAtau(data.arrearsOutstanding),
            tunggakan_pelanggan: angkaAtau(data.arrearsCustomers),
            tren,
            total_pengeluaran: nominalAtau(data.totalExpense),
            sisa_bersih: nominalAtau(data.netTotal),
            catatan: catatanGagal
        }
    );
}

module.exports = { buildMoneySummary, buildMoneySummaryText, periodeSekarang };
