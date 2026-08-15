/**
 * Header Doc
 * Purpose: Mengagregasi read model rekap tunggakan pelanggan berbasis periode untuk tab operasional dan manajerial.
 * Caller: `routes/arrears.js`.
 * Deps: `../repositories/arrears.repository`.
 * MainFuncs: `createArrearsService`, `getArrearsReadModel`, `getCustomerArrearsDetail`.
 * SideEffects: Tidak ada; read-model only.
 */
"use strict";

const { createArrearsRepository } = require("../repositories/arrears.repository");

function createArrearsService(overrides = {}) {
    const repository = overrides.repository || createArrearsRepository();

    /**
     * Harga yang WAJIB dipakai untuk menghitung tunggakan.
     *
     * Dulu layanan ini memakai `customer.subscription_price` MENTAH. Terukur di produksi
     * 2026-08-10: kolom itu 0/kosong untuk 52 dari 55 pelanggan (Dander) dan 98 dari 98
     * (Tanjungharjo) — harga sebenarnya tinggal di katalog paket. Akibatnya `amount_due`
     * jadi 0, `outstanding` jadi 0, dan setiap orang tampak LUNAS.
     *
     * `getEffectivePrice` adalah SATU pemilik harga di aplikasi ini (subscription_price bila
     * ada → harga paket → dikurangi diskon yang masih berlaku). Ledger pembayaran memakainya,
     * jadi rekap tunggakan wajib memakainya juga — kalau tidak, angka yang ditagih berbeda
     * dari angka yang dicatat.
     */
    const getEffectivePrice =
        overrides.getEffectivePrice ||
        ((customer) => require("../lib/payment-finance-service").getEffectivePrice(customer));

    function hargaEfektif(customer) {
        const n = Number(getEffectivePrice(customer));
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function formatPeriodKey(periodMonth, periodYear) {
        return `${periodYear}-${String(periodMonth).padStart(2, "0")}`;
    }

    function getBucketFromCount(count) {
        if (count >= 3) {
            return "3_PLUS_PERIODE";
        }
        if (count === 2) {
            return "2_PERIODE";
        }
        if (count === 1) {
            return "1_PERIODE";
        }
        return null;
    }

    function buildLedgerMaps(ledger) {
        const paymentMap = new Map();
        const reversalMap = new Map();
        // Periode yang tagihannya DIBEBASKAN. Bukan "sudah dibayar" melainkan "tak ada yang
        // perlu ditagih" — karena itu diperlakukan sebagai outstanding nol, bukan sebagai
        // pembayaran (kalau dihitung sebagai pembayaran ia akan muncul sebagai pemasukan).
        const waiverSet = new Set();
        for (const w of ledger.waivers || []) {
            waiverSet.add(`${w.user_id}:${formatPeriodKey(w.period_month, w.period_year)}`);
        }

        for (const payment of ledger.payments || []) {
            const key = `${payment.user_id}:${formatPeriodKey(payment.period_month, payment.period_year)}`;
            const current = paymentMap.get(key) || {
                gross_paid: 0,
                amount_due: Number(payment.amount_due || 0)
            };
            current.gross_paid += Number(payment.amount_paid || 0);
            current.amount_due = Number(payment.amount_due || current.amount_due || 0);
            paymentMap.set(key, current);
        }

        for (const reversal of ledger.reversals || []) {
            const key = `${reversal.user_id}:${formatPeriodKey(reversal.period_month, reversal.period_year)}`;
            reversalMap.set(key, (reversalMap.get(key) || 0) + Number(reversal.amount_reversed || 0));
        }

        return { paymentMap, reversalMap, waiverSet };
    }

    // ── Enumerasi periode dari KALENDER, bukan dari kunci ledger ────────────────────────────
    //
    // `buildCustomerPeriods` dulu membangun daftar periode HANYA dari kunci `paymentMap`
    // (plus periode acuan). Artinya periode yang TAK punya baris pembayaran tidak pernah
    // muncul — padahal justru periode itulah yang menunggak. Tak ada kode non-test yang
    // membuat baris `payment_history` kosong per periode, jadi lubang di tengah riwayat
    // (bayar Juni, bolos Juli, bayar Agustus) hilang sepenuhnya dari rekap: Juli tak dihitung
    // menunggak, `unpaid_period_count` kurang, dan aging bucket-nya terlalu ringan —
    // membalik prioritas penagihan.
    //
    // BATASNYA BUKTI, BUKAN TEBAKAN. Terukur di produksi 2026-08-14: `registration_date`
    // kosong pada 59 dari 60 pelanggan dan `created_at` kosong pada 56 — jadi "sejak kapan
    // pelanggan ini ditagih" TIDAK bisa dijawab untuk hampir semua orang. Mengarang titik
    // awal akan memunculkan tunggakan yang tak pernah ditagihkan. Karena itu enumerasi
    // dimulai dari bukti paling awal yang benar-benar ada, dan periode acuan dipakai bila
    // tak ada bukti sama sekali.
    const MAKS_PERIODE_DIENUMERASI = 24;

    function keyKePeriodeAngka(periodKey) {
        const [tahun, bulan] = String(periodKey).split("-").map((x) => parseInt(x, 10));
        return { tahun, bulan };
    }

    function periodeBerikutnya({ tahun, bulan }) {
        return bulan >= 12 ? { tahun: tahun + 1, bulan: 1 } : { tahun, bulan: bulan + 1 };
    }

    function urutanBulan({ tahun, bulan }) {
        return tahun * 12 + bulan;
    }

    /**
     * Seluruh periode dari `dari` s/d `sampai` (inklusif), dibatasi MAKS_PERIODE_DIENUMERASI
     * periode TERBARU.
     *
     * Versi pertama memotong dari DEPAN: loop `while` berhenti setelah 24 item terhitung dari
     * periode TERTUA, lalu `slice(-24)` pada array 24-elemen tak berefek apa pun. Untuk
     * pelanggan yang bukti ledger paling awalnya lebih dari 24 bulan sebelum periode laporan,
     * yang terdaftar justru 24 bulan TERTUA — periode berjalan dan bulan-bulan terbaru,
     * yaitu yang justru ditagih, hilang sepenuhnya dari rekap. Komentar lamanya bahkan
     * menyatakan kebalikan dari yang dilakukan kodenya.
     *
     * Kini titik AWAL yang digeser maju, bukan hasilnya yang dipotong belakangan.
     */
    function rentangPeriode(dariKey, sampaiKey) {
        const hasil = [];
        let kursor = keyKePeriodeAngka(dariKey);
        const akhir = keyKePeriodeAngka(sampaiKey);

        if (!kursor.tahun || !akhir.tahun || urutanBulan(kursor) > urutanBulan(akhir)) {
            return [sampaiKey];
        }

        // Geser awal supaya jendelanya BERAKHIR di `sampaiKey`, bukan bermula di `dariKey`.
        const awalPalingLama = urutanBulan(akhir) - (MAKS_PERIODE_DIENUMERASI - 1);
        while (urutanBulan(kursor) < awalPalingLama) {
            kursor = periodeBerikutnya(kursor);
        }

        while (urutanBulan(kursor) <= urutanBulan(akhir)) {
            hasil.push(formatPeriodKey(kursor.bulan, kursor.tahun));
            kursor = periodeBerikutnya(kursor);
        }

        return hasil;
    }

    /** Periode paling awal yang PUNYA bukti (pembayaran/pembalikan/pembebasan) untuk pelanggan ini. */
    function periodeBuktiPalingAwal(customerId, paymentMap, reversalMap, waiverSet) {
        const prefiks = `${customerId}:`;
        let paling = null;

        for (const sumber of [paymentMap.keys(), reversalMap.keys(), waiverSet.values()]) {
            for (const key of sumber) {
                if (!String(key).startsWith(prefiks)) continue;
                const periode = String(key).split(":")[1];
                if (!paling || periode < paling) paling = periode;
            }
        }

        return paling;
    }

    function buildCustomerPeriods(customer, paymentMap, reversalMap, currentPeriodKey, waiverSet = new Set()) {
        const periods = [];
        const sudahDibuat = new Set();

        for (const [key, entry] of paymentMap.entries()) {
            if (!key.startsWith(`${customer.id}:`)) {
                continue;
            }
            const period = key.split(":")[1];
            sudahDibuat.add(period);
            const reversal = reversalMap.get(key) || 0;
            const netPaid = entry.gross_paid - reversal;
            // `amount_due` dari ledger adalah kebenaran untuk periode yang PUNYA baris pembayaran
            // (nominal yang benar-benar ditagih saat itu). Selebihnya jatuh ke harga efektif.
            const amountDue = Number(entry.amount_due) > 0 ? Number(entry.amount_due) : hargaEfektif(customer);
            const dibebaskan = waiverSet.has(key);
            const outstanding = dibebaskan ? 0 : Math.max(amountDue - netPaid, 0);
            periods.push({
                period,
                amount_due: amountDue,
                gross_paid: entry.gross_paid,
                total_reversal: reversal,
                net_paid: netPaid,
                outstanding,
                dibebaskan,
                status: dibebaskan ? "DIBEBASKAN" : outstanding > 0 ? "MENUNGGAK" : "LUNAS"
            });
        }

        // Periode TANPA baris pembayaran: dari bukti paling awal s/d periode acuan.
        // Tanpa ini, periode yang dibolos di tengah riwayat (bayar Juni, bolos Juli, bayar
        // Agustus) tak pernah muncul sama sekali — bukan "lunas", melainkan tak terhitung.
        const buktiAwal = periodeBuktiPalingAwal(customer.id, paymentMap, reversalMap, waiverSet);
        const mulaiDari = buktiAwal && buktiAwal < currentPeriodKey ? buktiAwal : currentPeriodKey;

        for (const period of rentangPeriode(mulaiDari, currentPeriodKey)) {
            if (sudahDibuat.has(period)) {
                continue;
            }

            const key = `${customer.id}:${period}`;
            const amountDue = hargaEfektif(customer);
            const reversal = reversalMap.get(key) || 0;
            // Pembebasan berlaku juga untuk periode yang belum punya baris pembayaran —
            // justru itu bentuk yang paling umum: "Bebaskan tagihan bulan ini" saat mendaftar.
            const dibebaskan = waiverSet.has(key);
            const netPaid = -reversal;
            periods.push({
                period,
                amount_due: amountDue,
                gross_paid: 0,
                total_reversal: reversal,
                net_paid: netPaid,
                outstanding: dibebaskan ? 0 : Math.max(amountDue - netPaid, 0),
                dibebaskan,
                status: dibebaskan ? "DIBEBASKAN" : amountDue > 0 ? "MENUNGGAK" : "LUNAS"
            });
        }

        periods.sort((left, right) => left.period.localeCompare(right.period));
        return periods;
    }

    async function getArrearsReadModel({ periodMonth, periodYear }) {
        const customers = await repository.listBillableCustomers();
        const ledger = await repository.getLedgerEntriesUpToPeriod({ periodMonth, periodYear });
        const { paymentMap, reversalMap, waiverSet } = buildLedgerMaps(ledger);

        const currentPeriodKey = formatPeriodKey(periodMonth, periodYear);
        const rows = [];
        let fullyPaidCustomers = 0;
        let collectedAmount = 0;
        let totalBilledAmount = 0;

        for (const customer of customers) {
            const periods = buildCustomerPeriods(customer, paymentMap, reversalMap, currentPeriodKey, waiverSet);
            const currentPeriod = periods.find((period) => period.period === currentPeriodKey) || {
                amount_due: hargaEfektif(customer),
                net_paid: 0,
                outstanding: hargaEfektif(customer)
            };
            const currentOutstanding = currentPeriod.outstanding;

            totalBilledAmount += Number(currentPeriod.amount_due) || hargaEfektif(customer);
            collectedAmount += Math.max(currentPeriod.net_paid || 0, 0);
            if (currentOutstanding === 0) {
                fullyPaidCustomers += 1;
            }

            const unpaidPeriods = periods.filter((period) => period.outstanding > 0)
                .map((period) => ({ period: period.period, outstanding: period.outstanding }));

            if (unpaidPeriods.length === 0) {
                continue;
            }

            unpaidPeriods.sort((left, right) => left.period.localeCompare(right.period));
            rows.push({
                user_id: customer.id,
                name: customer.name,
                phone_number: customer.phone_number || null,
                subscription: customer.subscription || null,
                area: customer.area || null,
                status: customer.status || null,
                unpaid_period_count: unpaidPeriods.length,
                oldest_unpaid_period: unpaidPeriods[0].period,
                latest_unpaid_period: unpaidPeriods[unpaidPeriods.length - 1].period,
                current_period_outstanding: currentOutstanding,
                total_outstanding: unpaidPeriods.reduce((sum, period) => sum + period.outstanding, 0),
                aging_bucket: getBucketFromCount(unpaidPeriods.length)
            });
        }

        return {
            rows,
            summary: {
                total_customers_in_arrears: rows.length,
                total_outstanding: rows.reduce((sum, row) => sum + row.total_outstanding, 0),
                current_period_outstanding: rows.reduce((sum, row) => sum + row.current_period_outstanding, 0),
                bucket_1_period: rows.filter((row) => row.aging_bucket === "1_PERIODE").length,
                bucket_2_period: rows.filter((row) => row.aging_bucket === "2_PERIODE").length,
                bucket_3_plus_period: rows.filter((row) => row.aging_bucket === "3_PLUS_PERIODE").length,
                collection_rate_by_customer: customers.length > 0 ? fullyPaidCustomers / customers.length : 0,
                collection_rate_by_amount: totalBilledAmount > 0 ? collectedAmount / totalBilledAmount : 0
            }
        };
    }

    async function getCustomerArrearsDetail({ userId, periodMonth, periodYear }) {
        const customers = await repository.listBillableCustomers();
        const customerSource = customers.find((row) => String(row.id) === String(userId)) || null;
        if (!customerSource) {
            return {
                customer: null,
                unpaid_periods: [],
                payment_timeline: [],
                total_outstanding: 0
            };
        }

        const ledger = await repository.getLedgerEntriesUpToPeriod({ periodMonth, periodYear });
        const { paymentMap, reversalMap, waiverSet } = buildLedgerMaps(ledger);
        const currentPeriodKey = formatPeriodKey(periodMonth, periodYear);
        const periods = buildCustomerPeriods(customerSource, paymentMap, reversalMap, currentPeriodKey, waiverSet);
        const unpaidPeriods = periods.filter((period) => period.outstanding > 0);
        const readModel = await getArrearsReadModel({ periodMonth, periodYear });
        const customer = readModel.rows.find((row) => String(row.user_id) === String(userId)) || null;

        return {
            customer,
            unpaid_periods: unpaidPeriods,
            payment_timeline: periods,
            total_outstanding: customer ? customer.total_outstanding : 0
        };
    }

    return {
        deps: { repository },
        getArrearsReadModel,
        getCustomerArrearsDetail
    };
}

module.exports = { createArrearsService };
