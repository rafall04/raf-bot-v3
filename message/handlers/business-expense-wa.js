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
    TRIGGER_RINGKASAN,
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
 * Regex gerbang untuk raf.js: perintah `kas`, permintaan RINGKASAN (`omset`/`omzet`), ATAU
 * balasan konfirmasi biaya rutin.
 * Balasan seperti "ok"/"lewati" bukan perintah `kas`, jadi tanpa ini ia tak pernah sampai
 * ke handler. Aman dilebarkan karena gerbangnya sudah dibatasi grup kas + pemilik, DAN
 * `cobaKonfirmasiRutin` mengembalikan handled:false bila memang tak ada tagihan menunggu.
 */
const GERBANG_RE = new RegExp(
    `^\\s*(?:${TRIGGER_KAS.join("|")}|${TRIGGER_RINGKASAN.join("|")}|${KATA_KONFIRMASI.join("|")}|${KATA_LEWATI.join("|")})\\b`,
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

    // Pemilik yang TERSIMPAN sebagai `@lid`, tapi pesannya tiba sebagai JID nomor biasa.
    // Ini terjadi sungguhan: peserta grup terbaca dalam bentuk `<id>@lid` (itu yang tersimpan
    // saat memilih dari daftar), sedangkan pada pesan masuk Baileys menyerahkan
    // JID nomor kanonik `62xxx@s.whatsapp.net`. Tanpa jembatan ini, pemilik yang SUDAH dicentang
    // tetap ditolak dan bot diam total — persis yang terjadi 2026-08-10.
    // Tetap GAGAL-TERTUTUP: hanya cocok bila pemetaan @lid→nomor memang mengatakan
    // keduanya orang yang sama. Tak ada pemetaan ⇒ tak cocok.
    if (nomor) {
        for (const lid of (cfg.ownerLids || []).map((v) => String(v || "").trim()).filter(Boolean)) {
            try {
                const petaan = require("../../lib/jid-utils").getStoredMappingByLid(lid);
                if (petaan && digitsOf(petaan.phoneNumber) === nomor) return { via: "lid-nomor" };
            } catch (_e) { /* pemetaan tak terbaca → jangan meloloskan */ }
        }
    }
    return null;
}

// Panduan lengkap. SENGAJA identik dengan template tersimpan `be_bantuan`: template tersimpan
// MENIMPA fallback ini, jadi kalau keduanya berbeda, dua instance bisa menampilkan panduan yang
// berbeda — dan itu persis yang pernah terjadi (Dander memakai teks lama, Tanjungharjo yang baru).
const HELP_FALLBACK = "📗 *PANDUAN KAS USAHA*\n_Semua yang bisa dilakukan di grup ini._\n\n━━━━━━━━━━━━━━\n*1. CATAT PENGELUARAN*\nLangsung ketik nominal + untuk apa:\n• *kas 150rb kabel dropcore*\n• *kas 50rb bensin survei*\n• *kas 1,2jt bayar tukang*\n\nNominal bebas ditulis: `150rb`, `1,2jt`, `150000`, `Rp150.000`.\nKategori ditebak sendiri dari katanya.\n\n━━━━━━━━━━━━━━\n*2. TAGIHAN TETAP TIAP BULAN*\nListrik, internet, sewa — cukup didaftar sekali:\n• *kas rutin tambah 850rb listrik tgl 20*\n• *kas rutin* — lihat daftarnya\n• *kas rutin hapus 3* — buang nomor 3\n\n⚠️ Tanggalnya wajib ditulis (*tgl 20*). Kalau tidak, saya menolak — lebih baik begitu daripada salah tanggal tiap bulan.\n\nTiap jatuh tempo saya mengingatkan di sini. Balas:\n• *ok* — catat sesuai perkiraan\n• *ok 920rb* — catat nominal sebenarnya\n• *lewati* — bulan ini tidak ada\n\nSaya TIDAK pernah mencatat sendiri. Selalu menunggu balasanmu.\n\n━━━━━━━━━━━━━━\n*3. LIHAT PENGELUARAN*\n• *kas* — hari ini\n• *kas kemarin*\n• *kas minggu* / *kas minggu lalu*\n• *kas bulan* / *kas bulan lalu*\n• *kas bulan 2026-06* — bulan tertentu\n\n━━━━━━━━━━━━━━\n*4. RINGKASAN UANG*\n• *omset* — atau *kas ringkasan*\n\nIsinya: uang masuk bulan ini & hari ini, perkiraan omset, berapa yang sudah lunas, tunggakan, pengeluaran, dan sisa bersih.\n\nKalau ada angka tertulis _tak terbaca_, artinya sumbernya sedang tak bisa dibaca — BUKAN nol.\n\n━━━━━━━━━━━━━━\n*5. SALAH CATAT*\n• *kas batal 12* — batalkan pengeluaran nomor 12\n\nNomornya muncul di balasan waktu dicatat.\n\n━━━━━━━━━━━━━━\n*YANG PERLU DIKETAHUI*\n• Hanya orang yang terdaftar sebagai pemilik kas yang perintahnya saya jalankan. Yang lain saya diamkan.\n• Semua angka masuk ke halaman *Pengeluaran* & *Rekap Keuangan* — sumbernya sama, tidak ada pembukuan kedua.\n• Gaji teknisi TIDAK dicatat di sini. Sudah ada halaman Gaji Teknisi sendiri; kalau dicatat di sini jadi terhitung dua kali.\n\nKetik *kas bantuan* kapan saja untuk memunculkan panduan ini lagi.";

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
            id_tidak_valid: "Nomor pengeluaran tidak valid.",
            // Biaya rutin: keliru sedikit = tagihan jatuh tempo di hari yang salah tiap bulan,
            // jadi tiap penolakan menyebut PERSIS apa yang kurang, bukan "perintah salah".
            rutin_id_tidak_valid: "Nomor biaya rutin tidak valid. Contoh: *kas rutin hapus 3*.",
            rutin_sub_tak_dikenal: "Setelah *kas rutin* tulis: (kosong untuk melihat daftar), *tambah*, atau *hapus*.",
            rutin_nominal_tidak_terbaca: "Nominalnya tidak terbaca. Contoh: *kas rutin tambah 850rb listrik tgl 20*.",
            rutin_nama_kosong: "Tulis juga nama tagihannya. Contoh: *kas rutin tambah 850rb listrik tgl 20*.",
            rutin_tanggal_wajib: "Tanggal jatuh temponya belum ditulis. Tambahkan *tgl 20* di akhir.",
            rutin_tanggal_tidak_valid: "Tanggal jatuh tempo harus 1–31."
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

    // ── RINGKASAN UANG on-demand ────────────────────────────────────────────────
    // Angkanya DIBACA dari owner-cockpit + buku besar, tak dihitung di sini. Gagal baca
    // dilaporkan sebagai "tak terbaca", bukan Rp0 — nol adalah kabar yang menuntut tindakan.
    if (perintah.action === "ringkasan") {
        const ms = (deps && deps.moneySummary) || require("../../lib/services/money-summary");
        try {
            const data = await ms.buildMoneySummary();
            await reply(ms.buildMoneySummaryText(data, { judul: "SEKARANG" }));
        } catch (e) {
            logger.error("[KAS_RINGKASAN_ERROR]", e && e.message);
            await reply(
                renderResponseTemplate(
                    "be_ringkasan_gagal",
                    "⚠️ Ringkasan uang tak bisa dirakit sekarang. Coba lagi sebentar lagi."
                )
            );
        }
        return { handled: true };
    }

    // ── BIAYA RUTIN dari WhatsApp ────────────────────────────────────────────────
    // Menumpang `lib/recurring-expense` yang SAMA dengan halaman /kas-usaha. Definisi yang
    // dibuat di sini muncul di halaman dan sebaliknya — tak ada daftar tagihan kedua.
    if (perintah.action === "rutin_list" || perintah.action === "rutin_tambah" || perintah.action === "rutin_hapus") {
        const rutin = (deps && deps.recurring) || require("../../lib/recurring-expense");

        if (perintah.action === "rutin_list") {
            const rows = await rutin.listAll();
            const periode = rutin.periodeSekarang();
            const daftar = rows.length
                ? rows.map((r) => {
                    const tanda = !r.aktif ? " (nonaktif)" : r.last_settled_period === periode ? " ✅ bulan ini" : "";
                    return `${r.id}. *${r.nama}* — ${formatRupiah(r.perkiraan)} · tgl ${r.tanggal}${tanda}`;
                }).join("\n")
                : "Belum ada biaya rutin.";
            await reply(
                renderResponseTemplate(
                    "be_rutin_daftar",
                    "🔁 *BIAYA RUTIN*\n\n${daftar}\n\nTambah: *kas rutin tambah 850rb listrik tgl 20*\nHapus: *kas rutin hapus 3*",
                    { daftar }
                )
            );
            return { handled: true };
        }

        if (perintah.action === "rutin_tambah") {
            try {
                const dibuat = await rutin.simpan({
                    nama: perintah.nama,
                    perkiraan: perintah.amount,
                    kategori: perintah.category,
                    tanggal: perintah.tanggal,
                    metode: METODE_BAWAAN
                });
                await reply(
                    renderResponseTemplate(
                        "be_rutin_tambah",
                        "✅ Biaya rutin disimpan\n\n📌 *${nama}*\n💰 ${nominal}\n📅 Tiap tanggal ${tanggal}\n📂 ${kategori}\n\n" +
                            "Saya ingatkan di grup ini tiap jatuh tempo. Pencatatan tetap menunggu balasan *ok* dari kamu.",
                        {
                            nama: dibuat.nama,
                            nominal: formatRupiah(dibuat.perkiraan),
                            tanggal: dibuat.tanggal,
                            kategori: dibuat.kategori
                        }
                    )
                );
            } catch (e) {
                // Validasi recurring-expense (kategori/tanggal/nominal) dilaporkan APA ADANYA —
                // pesan generik membuat orang mengulang kesalahan yang sama.
                await reply(
                    renderResponseTemplate("be_rutin_gagal", "⚠️ Gagal menyimpan biaya rutin: ${alasan}", { alasan: e.message })
                );
            }
            return { handled: true };
        }

        // rutin_hapus — sengaja TIDAK menghapus pengeluaran yang terlanjur tercatat.
        const hasil = await rutin.hapus(perintah.id);
        await reply(
            hasil.dihapus
                ? renderResponseTemplate(
                    "be_rutin_hapus",
                    "🗑️ Biaya rutin #${id} dihapus. Pengeluaran yang sudah tercatat TIDAK ikut terhapus.",
                    { id: perintah.id }
                )
                : renderResponseTemplate("be_rutin_tak_ada", "⚠️ Biaya rutin #${id} tidak ditemukan.", { id: perintah.id })
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
