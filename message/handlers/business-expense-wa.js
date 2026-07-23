/**
 * Header Doc
 * Purpose: Permukaan WhatsApp KAS USAHA — perintah `kas` untuk mencatat pengeluaran operasional
 *          dan menariknya kembali sebagai laporan.
 *          PENTING: menulis lewat `lib/expense-manager` (tabel `expense_entries` + buku besar
 *          keuangan) — BUKAN penyimpanan baru. Jadi angka di WhatsApp, halaman `/pengeluaran`,
 *          dan `/rekap-keuangan` selalu satu sumber. Ledger kedua = angka yang tak pernah cocok.
 *          Beda dari dompet PRIBADI (`message/handlers/personal-finance-wa.js`) yang justru
 *          sengaja terpisah dari pembukuan usaha.
 * Caller: Gerbang `kas` di `message/raf.js` (blok grup + jalur fromMe), sama seperti dompet.
 * Deps: `../../lib/business-expense-service`, `../../lib/expense-manager`,
 *       `./template-helpers.renderResponseTemplate`.
 * MainFuncs: `TRIGGER_RE`, `resolveBusinessExpenseOwner`, `handleBusinessExpenseCommand`.
 * SideEffects: Membuat/membatalkan baris `expense_entries` + entri buku besar; membalas via `reply()`.
 */
"use strict";

const { renderResponseTemplate } = require("./template-helpers");
const {
    TRIGGER_KAS,
    KATA_KONFIRMASI,
    KATA_LEWATI,
    parseKonfirmasiRutin,
    parseBusinessExpenseCommand,
    resolveRentangKas,
    buildKasReport
} = require("../../lib/business-expense-service");
const { formatRupiah } = require("../../lib/personal-finance-service");

const TRIGGER_RE = new RegExp(`^\\s*(?:${TRIGGER_KAS.join("|")})\\b`, "i");

/**
 * Regex gerbang untuk raf.js: perintah `kas` ATAU balasan konfirmasi biaya rutin.
 * Balasan seperti "ok"/"lewati" bukan perintah `kas`, jadi tanpa ini ia tak pernah sampai
 * ke handler. Aman dilebarkan karena gerbangnya sudah dibatasi grup kas + pemilik, DAN
 * `cobaKonfirmasiRutin` mengembalikan handled:false bila memang tak ada tagihan menunggu.
 */
const GERBANG_RE = new RegExp(
    `^\\s*(?:${TRIGGER_KAS.join("|")}|${KATA_KONFIRMASI.join("|")}|${KATA_LEWATI.join("|")})\\b`,
    "i"
);

/** Metode bawaan: pengeluaran lapangan lewat WhatsApp hampir selalu tunai. */
const METODE_BAWAAN = "TUNAI";

function digitsOf(v) {
    return String(v || "").replace(/[^0-9]/g, "");
}

/**
 * Pemilik kas usaha. Daftar TERPISAH (`config.businessExpense.ownerJids`) dari dompet pribadi
 * maupun `ownerNumber`, supaya tiap peran bisa diatur sendiri per site. GAGAL-TERTUTUP.
 */
function resolveBusinessExpenseOwner({ participant, plainPhone, config } = {}) {
    const cfg = (config && config.businessExpense) || {};
    const jid = String(participant || "");
    const nomor = digitsOf(plainPhone);

    if (jid.endsWith("@lid")) {
        return (cfg.ownerLids || []).map(String).includes(jid) ? { via: "lid" } : null;
    }
    const daftar = (cfg.ownerJids || []).map((v) => String(v || "").trim()).filter(Boolean);
    for (const entri of daftar) {
        if (entri === jid) return { via: "jid" };
        const n = digitsOf(entri.split("@")[0]);
        if (n && nomor && n === nomor) return { via: "nomor" };
    }
    return null;
}

const HELP_FALLBACK =
    "🏢 *KAS USAHA*\n\n" +
    "Mencatat pengeluaran — langsung ketik:\n" +
    "• *kas 150rb kabel dropcore*\n" +
    "• *kas 50rb bensin survei*\n\n" +
    "Melihat:\n" +
    "• *kas* — hari ini\n" +
    "• *kas kemarin*\n" +
    "• *kas minggu* / *kas minggu lalu*\n" +
    "• *kas bulan* / *kas bulan 2026-06* / *kas bulan lalu*\n\n" +
    "Salah catat:\n" +
    "• *kas batal 12* — batalkan pengeluaran nomor 12\n\n" +
    "Kategori ditebak sendiri. Tercatat di *Pengeluaran* & *Rekap Keuangan* — sumber angkanya sama.";

/**
 * Balasan konfirmasi biaya rutin (`ok`, `ok 620rb`, `lewati`). Dipisah dari perintah `kas`
 * karena kata-kata ini HANYA bermakna saat ada tagihan menunggu — di luar itu diabaikan
 * supaya "ok" biasa di grup tak diam-diam mencatat pengeluaran.
 * @returns {Promise<{handled:boolean}>} handled:false → biarkan alur lain menanganinya.
 */
async function cobaKonfirmasiRutin({ chats, reply, actor, deps }) {
    const balasan = parseKonfirmasiRutin(chats);
    if (!balasan) return { handled: false };

    const rec = (deps && deps.recurring) || require("../../lib/recurring-expense");
    const menunggu = await rec.tertunda();
    if (!menunggu.length) return { handled: false }; // tak ada yang ditunggu → bukan urusan kita

    let target = null;
    if (balasan.id) {
        target = menunggu.find((x) => Number(x.id) === Number(balasan.id)) || null;
        if (!target) {
            await reply(
                renderResponseTemplate("be_rutin_id_salah", "⚠️ Tidak ada tagihan tertunda bernomor ${id}.", {
                    id: balasan.id
                })
            );
            return { handled: true };
        }
    } else if (menunggu.length === 1) {
        target = menunggu[0];
    } else {
        // Lebih dari satu menunggu → jangan menebak. Menebak salah berarti mencatat
        // pengeluaran untuk pos yang keliru.
        await reply(
            renderResponseTemplate(
                "be_rutin_pilih",
                "❓ Ada ${jumlah} tagihan menunggu — sebutkan nomornya:\n\n${daftar}\n\nContoh: *ok ${contoh}* atau *ok ${contoh} 620rb*",
                {
                    jumlah: menunggu.length,
                    contoh: menunggu[0].id,
                    daftar: menunggu.map((x) => `${x.id}. ${x.nama} — ${formatRupiah(x.perkiraan)}`).join("\n")
                }
            )
        );
        return { handled: true };
    }

    if (balasan.aksi === "lewati") {
        await rec.lewati(target.id);
        await reply(
            renderResponseTemplate("be_rutin_dilewati", "⏭️ ${nama} dilewati untuk periode ini.", { nama: target.nama })
        );
        return { handled: true };
    }

    const hasil = await rec.konfirmasi(target.id, { nominal: balasan.nominal, actor: actor || "WhatsApp" });
    await reply(
        renderResponseTemplate(
            "be_rutin_dicatat",
            "✅ *${nama}* tercatat ${nominal}${beda}\n📂 ${kategori} · ${metode}\n\n_Nomor pengeluaran: ${expenseId}_",
            {
                nama: target.nama,
                nominal: formatRupiah(hasil.jumlah),
                kategori: target.kategori,
                metode: target.metode || METODE_BAWAAN,
                expenseId: hasil.expense.id,
                beda:
                    hasil.jumlah !== Number(target.perkiraan)
                        ? ` (perkiraan ${formatRupiah(target.perkiraan)})`
                        : ""
            }
        )
    );
    return { handled: true };
}

async function handleBusinessExpenseCommand(context = {}) {
    const { chats, reply, actor, logger = console, deps } = context;
    const em = (deps && deps.expenseManager) || require("../../lib/expense-manager");

    // Balasan konfirmasi diperiksa DULU: "ok"/"lewati" bukan perintah `kas`, jadi parser
    // di bawah akan menolaknya sebagai "bukan_perintah_kas".
    const konfirmasi = await cobaKonfirmasiRutin({ chats, reply, actor, deps });
    if (konfirmasi.handled) return { handled: true };

    const perintah = parseBusinessExpenseCommand(chats);

    if (perintah.action === "help") {
        await reply(renderResponseTemplate("be_bantuan", HELP_FALLBACK));
        return { handled: true };
    }

    // Bukan perintah kas sama sekali (mis. "ok" tanpa tagihan menunggu, atau obrolan biasa)
    // → DIAM. Membalas "perintah tidak dikenali" di grup yang juga dipakai bicara biasa
    // membuat bot menyahut setiap kalimat.
    if (perintah.action === "unknown" && perintah.reason === "bukan_perintah_kas") {
        return { handled: false };
    }

    if (perintah.action === "unknown") {
        const alasan = {
            nominal_tidak_terbaca: "Nominalnya tidak terbaca.",
            judul_kosong: "Tulis juga untuk apa pengeluarannya.",
            id_tidak_valid: "Nomor pengeluaran tidak valid."
        }[perintah.reason] || "Perintah tidak dikenali.";
        await reply(
            renderResponseTemplate(
                "be_tidak_dikenali",
                `⚠️ \${alasan}\n\nContoh: *kas 150rb kabel dropcore*\nKetik *kas bantuan* untuk daftar perintah.`,
                { alasan }
            )
        );
        return { handled: true };
    }

    if (perintah.action === "add") {
        // Lewat expense-manager, BUKAN INSERT langsung: di sanalah validasi kategori dan
        // pencatatan buku besar dijaga tetap sinkron.
        const dibuat = await em.createExpense(
            {
                title: perintah.title,
                category: perintah.category,
                amount: perintah.amount,
                payment_method: METODE_BAWAAN,
                notes: "Dicatat via WhatsApp"
            },
            { name: actor || "WhatsApp" }
        );

        const hariIni = new Date().toISOString().slice(0, 10);
        const hari = await em.listExpenses({ dateFrom: hariIni, dateTo: hariIni, status: "active" });
        const totalHari = hari.reduce((s, e) => s + Number(e.amount || 0), 0);

        await reply(
            renderResponseTemplate(
                "be_catat",
                "✅ Tercatat *\${nominal}*\n📌 \${judul}\n📂 \${kategori} · \${metode}\n\n" +
                    "Total hari ini: *\${totalHari}* (\${jumlahHari} catatan)\n" +
                    "_Salah? balas *kas batal \${id}*_",
                {
                    id: dibuat.id,
                    nominal: formatRupiah(dibuat.amount),
                    judul: dibuat.title,
                    kategori: dibuat.category,
                    metode: dibuat.payment_method || METODE_BAWAAN,
                    totalHari: formatRupiah(totalHari),
                    jumlahHari: hari.length
                }
            )
        );
        return { handled: true };
    }

    if (perintah.action === "cancel") {
        try {
            const dibatalkan = await em.cancelExpense(perintah.id, { name: actor || "WhatsApp" }, "Dibatalkan via WhatsApp");
            await reply(
                renderResponseTemplate("be_batal_ok", "🗑️ Pengeluaran \${id} dibatalkan (\${nominal} — \${judul}).", {
                    id: perintah.id,
                    nominal: formatRupiah((dibatalkan && dibatalkan.amount) || 0),
                    judul: (dibatalkan && dibatalkan.title) || "-"
                })
            );
        } catch (e) {
            // Pesan dari expense-manager sudah manusiawi ("tidak ditemukan"/"sudah tidak aktif").
            await reply(renderResponseTemplate("be_batal_gagal", "⚠️ \${pesan}", { pesan: e.message }));
        }
        return { handled: true };
    }

    if (perintah.action === "report") {
        const rentang = resolveRentangKas(perintah);
        const rows = await em.listExpenses({ dateFrom: rentang.from, dateTo: rentang.to, status: "active" });
        const data = buildKasReport(rows, rentang);

        await reply(
            renderResponseTemplate(
                "be_laporan",
                "🏢 *KAS USAHA — \${judul}*\n\${rentang}\n\n" +
                    "💸 Total keluar: *\${totalRp}*\n📊 \${jumlah} catatan\n\n" +
                    "*Per kategori:*\n\${rincianKategori}\n\n*Terbesar:*\n\${terbesar}\n\n*Catatan:*\n\${daftar}",
                data
            )
        );
        return { handled: true };
    }

    logger?.warn?.("[KAS] aksi tak tertangani:", perintah.action);
    return { handled: false };
}

module.exports = {
    TRIGGER_RE,
    GERBANG_RE,
    METODE_BAWAAN,
    resolveBusinessExpenseOwner,
    handleBusinessExpenseCommand,
    HELP_FALLBACK
};
