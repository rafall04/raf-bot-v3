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
    todayStr,
    monthRange,
    buildReportData
} = require("../../lib/personal-finance-service");

// `#` wajib, sama seperti #PSB/#ODP — supaya huruf "u" dalam kalimat biasa tak pernah memicu.
const TRIGGER_RE = /^\s*#u\b/i;

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
    "Catat cepat:\n" +
    "• *#U keluar 50rb bensin*\n" +
    "• *#U masuk 2jt gaji*\n\n" +
    "Lihat rekap:\n" +
    "• *#U lapor* — hari ini\n" +
    "• *#U bulan* — bulan ini\n" +
    "• *#U bulan 2026-06* — bulan tertentu\n\n" +
    "Salah catat:\n" +
    "• *#U hapus 12* — hapus catatan nomor 12\n\n" +
    "Nominal bebas: 50rb, 2jt, 1,5jt, 50.000.";

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
            id_tidak_valid: "Nomor catatan tidak valid."
        }[perintah.reason] || "Perintah tidak dikenali.";
        await reply(
            renderResponseTemplate(
                "pf_tidak_dikenali",
                `⚠️ ${alasan}\n\nContoh: *#U keluar 50rb bensin*\nKetik *#U* untuk daftar perintah.`,
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
                    `_Salah? balas *#U hapus \${id}*_`,
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
        if (perintah.scope === "day") {
            const tgl = todayStr();
            const [rekap, catatan] = await Promise.all([
                repo.summary({ from: tgl, to: tgl }),
                repo.listEntries({ from: tgl, to: tgl, limit: 30 })
            ]);
            const data = buildReportData(rekap, catatan);
            await reply(
                renderResponseTemplate(
                    "pf_laporan_harian",
                    `📅 *LAPORAN HARI INI* (\${tanggal})\n\n` +
                        `⬇️ Masuk: \${masukRp}\n⬆️ Keluar: \${keluarRp}\n💵 Selisih: \${selisihRp}\n\n` +
                        `*Catatan:*\n\${daftarCatatan}`,
                    { ...data, tanggal: tgl }
                )
            );
            return { handled: true };
        }

        const rentang = monthRange(perintah.month);
        const rekap = await repo.summary({ from: rentang.from, to: rentang.to });
        const data = buildReportData(rekap, []);
        await reply(
            renderResponseTemplate(
                "pf_laporan_bulanan",
                `🗓️ *LAPORAN BULAN \${bulan}*\n\n` +
                    `⬇️ Masuk: \${masukRp}\n⬆️ Keluar: \${keluarRp}\n💵 Selisih: \${selisihRp}\n` +
                    `📊 \${jumlahCatatan} catatan\n\n*Pengeluaran per kategori:*\n\${rincianKategori}`,
                { ...data, bulan: rentang.month }
            )
        );
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
