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

    // OMSET TANPA ISOLIR — pertanyaan "kalau semua bayar, dapat berapa" hanya masuk akal
    // untuk pelanggan yang layanannya memang menyala. Yang terisolir tak akan membayar
    // bulan ini justru karena itulah mereka diisolir.
    let omset = null;
    try {
        const cockpit = deps.cockpit || require("../owner-cockpit-service");
        const o = await cockpit.buildOmsetAktif();
        omset = o && o.ok ? o : null;
        if (!omset) gagal.push("omset");
    } catch (_e) {
        gagal.push("omset");
    }

    // PENGELUARAN NYATA bulan ini + rinciannya (bahan grafik halaman).
    let keluar = null;
    let jumlahCatatan = 0;
    const perKategori = {};
    try {
        const em = deps.expenseManager || require("../expense-manager");
        const p = (n) => String(n).padStart(2, "0");
        const from = `${periodYear}-${p(periodMonth)}-01`;
        const to = `${periodYear}-${p(periodMonth)}-${p(new Date(periodYear, periodMonth, 0).getDate())}`;
        const rows = await em.listExpenses({ dateFrom: from, dateTo: to, status: "active" });
        keluar = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
        jumlahCatatan = rows.length;
        for (const e of rows) perKategori[e.category] = (perKategori[e.category] || 0) + Number(e.amount || 0);
    } catch (_e) {
        gagal.push("pengeluaran");
    }

    // TAGIHAN RUTIN yang belum dituntaskan — DIPISAH dari `keluar`. Satu baris pengeluaran
    // adalah pernyataan bahwa uang sudah benar-benar keluar; perkiraan tak boleh masuk ke sana.
    let akanKeluar = null;
    let akanJumlah = 0;
    let akanTerlewat = 0;
    const akanPerKategori = {};
    try {
        const rec = deps.recurring || require("../recurring-expense");
        const semua = await rec.listAll();
        const periode = rec.periodeSekarang();
        const acuan = opsi.now || new Date();
        const hariIni = acuan.getDate();
        const hariTerakhir = new Date(periodYear, periodMonth, 0).getDate();
        akanKeluar = 0;
        for (const r of semua) {
            if (!r.aktif) continue;
            if (r.last_settled_period === periode) continue;
            const n = Number(r.perkiraan) || 0;
            akanKeluar += n;
            akanJumlah += 1;
            akanPerKategori[r.kategori] = (akanPerKategori[r.kategori] || 0) + n;
            if (Math.min(Number(r.tanggal) || 1, hariTerakhir) < hariIni) akanTerlewat += 1;
        }
    } catch (_e) {
        gagal.push("biaya_rutin");
        akanKeluar = null;
    }

    // #b311 (T3/T6): PENGELUARAN kanonik = BUKU BESAR (arus.totalExpense) — sama dengan halaman
    // /rekap-keuangan, dan mencakup gaji dibayar + kasbon + reversal + expense_entries. `keluar`
    // (expense_entries saja) DULU dipakai headline dengan asumsi "sumber sama dengan halaman", tapi
    // halaman memakai buku besar → WA sistematis MENGHILANGKAN gaji (pengeluaran terbesar). `keluar`
    // tetap dikembalikan untuk rincian per-kategori; headline "keluar"/"sisa" kini dari buku besar.
    const keluarTotal = (arus && arus.totalExpense != null) ? bulat(arus.totalExpense) : keluar;

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

        // Omset yang MASIH BISA DITAGIH (terisolir dikeluarkan) + selisihnya, supaya beda
        // dengan `mrr` selalu bisa dijelaskan, bukan jadi dua angka yang saling membantah.
        omsetAktif: omset ? bulat(omset.omsetAktif) : null,
        isolirTerbaca: omset ? omset.isolirTerbaca : false,
        isolirJumlah: omset && omset.isolirJumlah != null ? bulat(omset.isolirJumlah) : null,
        isolirNilai: omset && omset.isolirNilai != null ? bulat(omset.isolirNilai) : null,
        belumMasuk:
            omset && pemasukan ? Math.max(0, bulat(omset.omsetAktif) - bulat(pemasukan.netPaid)) : null,

        // Pengeluaran NYATA vs tagihan yang masih akan jatuh tempo — tak pernah dijumlahkan.
        keluar,
        keluarTotal,
        jumlahCatatan,
        perKategori,
        akanKeluar,
        akanJumlah,
        akanTerlewat,
        akanPerKategori,
        // Sisa sekarang & sesudah tagihan rutin — memakai PENGELUARAN KANONIK buku besar (keluarTotal),
        // bukan expense_entries saja, supaya "sisa" WA konsisten dengan /rekap & tak melebihi kenyataan
        // saat gaji dibayar. Keduanya null bila bahannya tak terbaca — proyeksi dari angka buta lebih
        // buruk daripada tak ada proyeksi.
        sisa: pemasukan && keluarTotal != null ? bulat(pemasukan.netPaid) - keluarTotal : null,
        proyeksiSisa:
            pemasukan && keluarTotal != null && akanKeluar != null
                ? bulat(pemasukan.netPaid) - keluarTotal - akanKeluar
                : null,
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

    // Catatan isolir: kalau statusnya tak terbaca, angka omset BELUM disaring — katakan,
    // jangan biarkan pembaca menyangka sudah.
    const isolirInfo = !data.isolirTerbaca
        ? "\n  _status isolir tak terbaca — belum disaring_"
        : data.isolirJumlah
            ? `\n  _${data.isolirJumlah} terisolir dikeluarkan (${formatRupiah(data.isolirNilai)})_`
            : "";

    const akanInfo = data.akanKeluar == null
        ? ""
        : `\n• Akan jatuh tempo: ${formatRupiah(data.akanKeluar)} (${data.akanJumlah} tagihan)` +
          (data.akanTerlewat ? `\n  _${data.akanTerlewat} sudah lewat tanggalnya_` : "");

    const proyeksiInfo = data.proyeksiSisa == null
        ? ""
        : `\n• Setelah tagihan rutin: ${formatRupiah(data.proyeksiSisa)}` +
          (data.proyeksiSisa < 0 ? " ⚠️ akan minus" : "");

    return renderResponseTemplate(
        "be_ringkasan_uang",
        "💰 *RINGKASAN UANG* — ${judul}\n" +
            "Periode ${periode}\n\n" +
            "*MASUK*\n" +
            "• Bulan ini      : ${net_paid}\n" +
            "• Hari ini       : ${today_amount} (${today_count} transaksi)\n" +
            "• Sudah lunas    : ${lunas}/${total_pelanggan} (${collection_rate}%)\n" +
            "• Tunggakan      : ${tunggakan} dari ${tunggakan_pelanggan} pelanggan${tren}\n\n" +
            "*KALAU SEMUA BAYAR*\n" +
            "• Omset bulan ini : ${omset_aktif}${isolir_info}\n" +
            "• Belum masuk     : ${belum_masuk}\n\n" +
            "*KELUAR*\n" +
            "• Sudah keluar   : ${total_pengeluaran}${akan_info}\n\n" +
            "*SISA*\n" +
            "• Sekarang       : ${sisa_bersih}${proyeksi_info}${catatan}",
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
            // #b311 (T3/T6): pengeluaran & sisa memakai BUKU BESAR (keluarTotal) — SAMA dengan
            // halaman /rekap (buildCashflowSummary), mencakup gaji/kasbon/reversal. Dulu memakai
            // `keluar` (expense_entries saja) → WA menghilangkan gaji & berselisih dengan halaman.
            total_pengeluaran: nominalAtau(data.keluarTotal != null ? data.keluarTotal : data.keluar),
            sisa_bersih: nominalAtau(data.sisa),
            omset_aktif: nominalAtau(data.omsetAktif),
            belum_masuk: nominalAtau(data.belumMasuk),
            isolir_info: isolirInfo,
            akan_info: akanInfo,
            proyeksi_info: proyeksiInfo,
            catatan: catatanGagal
        }
    );
}

module.exports = { buildMoneySummary, buildMoneySummaryText, periodeSekarang };
