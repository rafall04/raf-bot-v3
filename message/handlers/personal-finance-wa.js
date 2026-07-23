/**
 * Header Doc
 * Purpose: Permukaan WhatsApp domain KEUANGAN PRIBADI owner — perintah `#U` (catat cepat,
 *          laporan harian/bulanan, hapus). Dipisah dari domain saldo pelanggan: tidak
 *          menyentuh `lib/saldo`, tidak menulis activity_logs, dan hanya menjawab pemilik.
 * Caller: Gerbang `#U` di `message/raf.js` (pola sama dgn #ODC/#JALUR: config gate + regex +
 *         resolver + NON-THROWING).
 * Deps: `../../lib/personal-finance-service`, `../../repositories/personal-finance.repository`,
 *       `./template-helpers.renderResponseTemplate`.
 * MainFuncs: `TRIGGER_RE`, `resolvePersonalFinanceOwner`, `handlePersonalFinanceCommand`.
 * SideEffects: Menulis/menghapus baris di `personal_finance.sqlite`; membalas via `reply()`.
 */
"use strict";

const { renderResponseTemplate } = require("./template-helpers");
const {
    parsePersonalFinanceCommand,
    formatRupiah,
    monthRange,
    dayRange,
    weekRange,
    previousRange,
    hitungTren,
    buildDailySeries,
    buildReportData,
    TRIGGER_WORDS
} = require("../../lib/personal-finance-service");

/**
 * Terjemahkan aksi `report` hasil parser jadi rentang tanggal + judul.
 * Satu tempat, supaya harian/mingguan/bulanan tak punya jalur berbeda-beda.
 */
function resolveRentangLaporan(perintah) {
    if (perintah.scope === "week") {
        const r = weekRange(perintah.geser || 0);
        return { ...r, scope: "week", judul: `MINGGU INI`.replace("INI", perintah.geser === -1 ? "LALU" : "INI") };
    }
    if (perintah.scope === "month") {
        if (perintah.geser === -1) {
            const d = new Date();
            const lalu = new Date(d.getFullYear(), d.getMonth() - 1, 1);
            const ym = `${lalu.getFullYear()}-${String(lalu.getMonth() + 1).padStart(2, "0")}`;
            const r = monthRange(ym);
            return { ...r, scope: "month", judul: `BULAN ${r.month}` };
        }
        const r = monthRange(perintah.month);
        return { ...r, scope: "month", judul: `BULAN ${r.month}` };
    }
    const r = dayRange(perintah.geser || 0);
    return { ...r, scope: "day", judul: perintah.geser === -1 ? "KEMARIN" : "HARI INI" };
}

/** Jumlah hari inklusif dalam rentang; dipakai untuk rata-rata harian. */
function hitungHari(from, to) {
    const [fy, fm, fd] = String(from).split("-").map(Number);
    const [ty, tm, td] = String(to).split("-").map(Number);
    const a = new Date(fy, fm - 1, fd);
    const b = new Date(ty, tm - 1, td);
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

// Fallback runtime. CATATAN: template tersimpan di database/response_templates.json
// MENIMPA teks ini — slot baru WAJIB ikut ditambahkan ke sana, kalau tidak bagiannya
// dihitung lalu tak pernah terkirim (pelajaran lama di repo ini).
const BLOK_INTI =
    "⬇️ Masuk: ${masukRp}\n⬆️ Keluar: ${keluarRp}\n💵 Selisih: ${selisihRp}\n" +
    "📊 ${jumlahCatatan} catatan · rata-rata ${rataKeluarRp}/hari\n";

const FALLBACK_LAPORAN = {
    day:
        "📅 *LAPORAN ${judul}* (${rentang})\n\n" + BLOK_INTI +
        "${bandingRingkas}\n\n*Pengeluaran per kategori:*\n${rincianKategoriPagu}\n\n*Catatan:*\n${daftarCatatan}",
    week:
        "🗓️ *LAPORAN ${judul}*\n${rentang}\n\n" + BLOK_INTI +
        "🔥 Terboros: ${hariTerborosTeks}\n${bandingRingkas}\n\n*Pengeluaran per kategori:*\n${rincianKategoriPagu}\n\n*Catatan:*\n${daftarCatatan}",
    month:
        "🗓️ *LAPORAN ${judul}*\n${rentang}\n\n" + BLOK_INTI +
        "🔥 Terboros: ${hariTerborosTeks}\n${bandingRingkas}\n\n*Pengeluaran per kategori:*\n${rincianKategoriPagu}"
};

/**
 * Pemicu TANPA prefix: `keluar …`, `masuk …`, atau kata payung `uang/duit/kas/dompet`.
 * Prefix `#U` DIHAPUS — terlalu ribet untuk dipakai beberapa kali sehari.
 *
 * Boleh telanjang karena gerbang di `message/raf.js` memeriksa IDENTITAS lebih dulu: pesan
 * pelanggan tak pernah sampai ke sini walau kebetulan berbunyi "masuk". Daftar katanya sengaja
 * sempit (lihat TRIGGER_WORDS) supaya percakapan bisnis pemilik sendiri tak ikut tertelan.
 */
const TRIGGER_RE = new RegExp(`^\\s*(?:${TRIGGER_WORDS.join("|")})\\b`, "i");

let repoSingleton = null;
function getRepo(override) {
    if (override) return override;
    if (!repoSingleton) {
        const { createPersonalFinanceRepository } = require("../../repositories/personal-finance.repository");
        repoSingleton = createPersonalFinanceRepository();
    }
    return repoSingleton;
}

/** Sisakan angka saja — "62812-3456" dan "+62 812 3456" harus dianggap sama. */
function digitsOf(value) {
    return String(value || "").replace(/[^0-9]/g, "");
}

/**
 * Tentukan apakah pengirim adalah PEMILIK dompet pribadi ini.
 *
 * Sengaja TIDAK memakai `config.ownerNumber` (kepemilikan bisnis) maupun role akun: kalau
 * nanti ada admin kedua ditambahkan ke bisnis, dia tidak boleh ikut melihat dompet pribadi.
 * Sumber kebenarannya daftar terpisah `config.personalFinance.ownerJids`.
 *
 * Nomor `@lid` tidak bisa dipetakan ke nomor telepon di sini (angkanya BUKAN nomor HP), jadi
 * disediakan daftar `ownerLids` eksplisit. Tak cocok di keduanya ⇒ GAGAL-TERTUTUP (null),
 * dan pemanggil harus diam — jangan bocorkan bahwa fitur ini ada.
 *
 * @returns {{via:string}|null}
 */
function resolvePersonalFinanceOwner({ participant, plainPhone, config } = {}) {
    const cfg = (config && config.personalFinance) || {};
    const jidPengirim = String(participant || "");
    const nomorPengirim = digitsOf(plainPhone);

    const daftarLid = (cfg.ownerLids || []).map((v) => String(v || "").trim()).filter(Boolean);
    if (jidPengirim.endsWith("@lid")) {
        return daftarLid.includes(jidPengirim) ? { via: "lid" } : null;
    }

    const daftarJid = (cfg.ownerJids || []).map((v) => String(v || "").trim()).filter(Boolean);
    if (!daftarJid.length) return null;

    for (const entri of daftarJid) {
        if (entri === jidPengirim) return { via: "jid" };
        const nomorEntri = digitsOf(entri.split("@")[0]);
        if (nomorEntri && nomorPengirim && nomorEntri === nomorPengirim) return { via: "nomor" };
    }
    return null;
}

const HELP_FALLBACK =
    "💰 *CATATAN KEUANGAN PRIBADI*\n\n" +
    "*Mencatat* — langsung ketik, tanpa kode apa pun:\n" +
    "• *keluar 50rb bensin*\n" +
    "• *masuk 2jt gaji*\n\n" +
    "*Melihat* — diawali kata *uang*:\n" +
    "• *uang* — rekap hari ini\n" +
    "• *uang bulan* — rekap bulan ini\n" +
    "• *uang bulan 2026-06* — bulan tertentu\n\n" +
    "*Salah catat:*\n" +
    "• *uang hapus 12* — hapus catatan nomor 12\n\n" +
    "Nominal bebas: *50rb*, *2jt*, *1,5jt*, *50.000*.\n" +
    "Kategori ditebak sendiri dari catatanmu.\n\n" +
    "_Ketik *uang bantuan* untuk membuka panduan ini lagi._";

/**
 * Jalankan satu perintah `#U`. Pemanggil WAJIB sudah memastikan pengirim = pemilik.
 * Semua teks user-facing lewat `renderResponseTemplate` supaya bisa diedit dari /api/templates.
 *
 * @returns {Promise<{handled:boolean}>}
 */
async function handlePersonalFinanceCommand(context = {}) {
    const { chats, reply, config, repository, logger = console } = context;
    const repo = getRepo(repository);
    const cfg = (config && config.personalFinance) || {};
    const perintah = parsePersonalFinanceCommand(chats, { categories: cfg.categories });

    if (perintah.action === "help") {
        await reply(renderResponseTemplate("pf_bantuan", HELP_FALLBACK));
        return { handled: true };
    }

    if (perintah.action === "unknown") {
        const alasan = {
            nominal_tidak_terbaca: "Nominalnya tidak terbaca.",
            jenis_tidak_dikenal: "Awali dengan *keluar* atau *masuk*.",
            id_tidak_valid: "Nomor catatan tidak valid — lihat nomornya di *uang*.",
            kosong: "Perintahnya kosong."
        }[perintah.reason] || "Perintah tidak dikenali.";
        await reply(
            renderResponseTemplate(
                "pf_tidak_dikenali",
                `⚠️ ${alasan}\n\nContoh: *keluar 50rb bensin*\nKetik *uang bantuan* untuk daftar perintah.`,
                { alasan }
            )
        );
        return { handled: true };
    }

    if (perintah.action === "add") {
        const entry = await repo.addEntry({
            kind: perintah.kind,
            amount: perintah.amount,
            category: perintah.category,
            note: perintah.note,
            source: "wa"
        });
        const hari = await repo.summary({ from: entry.tanggal, to: entry.tanggal });
        await reply(
            renderResponseTemplate(
                perintah.kind === "in" ? "pf_catat_masuk" : "pf_catat_keluar",
                `✅ Tercatat *${perintah.kind === "in" ? "masuk" : "keluar"}* ` +
                    `\${nominal}\n📂 Kategori: \${kategori}\n📝 \${catatan}\n\n` +
                    `Hari ini: masuk \${masukRp} · keluar \${keluarRp} · selisih \${selisihRp}\n` +
                    `_Salah? balas *uang hapus \${id}*_`,
                {
                    id: entry.id,
                    nominal: formatRupiah(entry.amount),
                    kategori: entry.category,
                    catatan: entry.note || "(tanpa catatan)",
                    masukRp: formatRupiah(hari.masuk),
                    keluarRp: formatRupiah(hari.keluar),
                    selisihRp: formatRupiah(hari.selisih)
                }
            )
        );
        return { handled: true };
    }

    if (perintah.action === "delete") {
        const sebelum = await repo.getEntry(perintah.id);
        const hasil = await repo.deleteEntry(perintah.id);
        if (!hasil.deleted) {
            await reply(
                renderResponseTemplate("pf_hapus_gagal", `⚠️ Catatan nomor \${id} tidak ditemukan.`, { id: perintah.id })
            );
            return { handled: true };
        }
        await reply(
            renderResponseTemplate("pf_hapus_ok", `🗑️ Catatan \${id} dihapus (\${nominal} — \${catatan}).`, {
                id: perintah.id,
                nominal: formatRupiah(sebelum ? sebelum.amount : 0),
                catatan: (sebelum && (sebelum.note || sebelum.category)) || "-"
            })
        );
        return { handled: true };
    }

    if (perintah.action === "report") {
        const rentang = resolveRentangLaporan(perintah);
        const jumlahHari = hitungHari(rentang.from, rentang.to);

        // Satu pengambilan data untuk SEMUA periode; yang berbeda hanya template & apakah
        // daftar catatan ikut disertakan (hanya masuk akal untuk rentang pendek).
        const sebelum = previousRange(rentang.from, rentang.to);
        const [rekap, rekapSebelum, pagu, harian, catatan] = await Promise.all([
            repo.summary({ from: rentang.from, to: rentang.to }),
            sebelum ? repo.summary({ from: sebelum.from, to: sebelum.to }) : Promise.resolve(null),
            repo.listBudgets(),
            jumlahHari > 1 ? repo.dailyTotals({ from: rentang.from, to: rentang.to }) : Promise.resolve([]),
            jumlahHari <= 7 ? repo.listEntries({ from: rentang.from, to: rentang.to, limit: 50 }) : Promise.resolve([])
        ]);

        const seri = buildDailySeries(harian, rentang.from, rentang.to);
        const puncak = seri.reduce((a, b) => (b.keluar > (a ? a.keluar : -1) ? b : a), null);
        const banding = rekapSebelum
            ? {
                  label: sebelum.label,
                  masuk: hitungTren(rekap.masuk, rekapSebelum.masuk),
                  keluar: hitungTren(rekap.keluar, rekapSebelum.keluar, true)
              }
            : null;

        const data = buildReportData(rekap, catatan, {
            pagu,
            banding,
            hari: jumlahHari,
            hariTerboros: puncak && puncak.keluar > 0 ? puncak : null,
            rentang: rentang.from === rentang.to ? rentang.from : `${rentang.from} s/d ${rentang.to}`
        });

        const kunci = { day: "pf_laporan_harian", week: "pf_laporan_mingguan", month: "pf_laporan_bulanan" }[rentang.scope];
        await reply(renderResponseTemplate(kunci, FALLBACK_LAPORAN[rentang.scope], { ...data, judul: rentang.judul }));
        return { handled: true };
    }

    logger?.warn?.("[PF] aksi tak tertangani:", perintah.action);
    return { handled: false };
}

module.exports = {
    TRIGGER_RE,
    resolvePersonalFinanceOwner,
    handlePersonalFinanceCommand,
    HELP_FALLBACK
};
