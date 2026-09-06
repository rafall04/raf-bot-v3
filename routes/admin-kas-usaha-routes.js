/**
 * Header Doc
 * Purpose: API halaman `/kas-usaha` — setelan kas usaha (sakelar aktif, grup WhatsApp,
 *          daftar pemilik), CRUD biaya rutin, dan ringkasan kas periode berjalan.
 *          SEMUA setelan bisa diubah dari halaman; tak ada lagi yang mengharuskan operator
 *          menyunting `config.json` di server.
 *          BEDA dari dompet pribadi: ini setelan BISNIS, jadi memang di-gate akun staf
 *          (admin/owner) seperti halaman keuangan usaha lainnya — bukan sesi dompet.
 * Caller: `routes/admin-router.js`.
 * Deps: `ensureAuthenticatedStaff` (dari deps), `lib/error-handler.asyncHandler`,
 *       `lib/recurring-expense`, `lib/expense-manager`, `lib/whatsapp.adapter` (grup + anggota),
 *       `lib/cron/jobs/recurring-expense-reminder` (penjadwalan ulang saat sakelar diubah).
 * MainFuncs: `registerAdminKasUsahaRoutes`, `tulisSetelan`.
 * SideEffects: Menulis `config.json` (hanya key di bawah `businessExpense`) + tabel
 *              `recurring_expenses`; menjadwalkan ulang cron pengingat; tak pernah menyentuh
 *              `expense_entries` secara langsung.
 */
"use strict";
const { writeFileAtomicSync } = require('../lib/atomic-file'); // config.json ATOMIK (#b343)

const { asyncHandler } = require("../lib/error-handler");
const recurring = require("../lib/recurring-expense");
const { EXPENSE_CATEGORIES, listExpenses } = require("../lib/expense-manager");

const PERAN = ["owner", "admin", "superadmin"];

/**
 * SATU-SATUNYA penulis setelan kas usaha ke `config.json`.
 * Baca-ubah-tulis, HANYA menyentuh key yang diberikan: berkas ini memuat kredensial gateway
 * dan puluhan setelan lain, jadi menulis ulang objeknya dari nol pernah = kehilangan config.
 * Config in-memory ikut disegarkan supaya perubahan berlaku tanpa restart.
 * @param {Object} tambalan key `businessExpense` yang diubah.
 * @returns {Object|null} config in-memory setelah disegarkan.
 */
function tulisSetelan(tambalan, getConfig) {
    const fs = require("fs");
    const path = require("path");
    const p = path.join(__dirname, "..", "config.json");

    const isi = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!isi.businessExpense) isi.businessExpense = {};
    Object.assign(isi.businessExpense, tambalan);
    writeFileAtomicSync(p, JSON.stringify(isi, null, 2));

    const cfg = getConfig();
    if (cfg) {
        if (!cfg.businessExpense) cfg.businessExpense = {};
        Object.assign(cfg.businessExpense, tambalan);
    }
    return cfg;
}

function registerAdminKasUsahaRoutes(router, deps = {}) {
    const ensureAuthenticatedStaff = deps.ensureAuthenticatedStaff || ((_req, _res, next) => next());
    const getConfig = deps.getConfig || (() => global.config);

    function gate(req, res, next) {
        const peran = req.user && String(req.user.role || "").toLowerCase();
        if (req.user && !PERAN.includes(peran)) {
            return res.status(403).json({ success: false, message: "Halaman kas usaha khusus admin/owner." });
        }
        return next();
    }

    const jaga = [ensureAuthenticatedStaff, gate];

    // ── Setelan + daftar grup ───────────────────────────────────────────────────
    router.get(
        "/api/kas-usaha/setelan",
        jaga,
        asyncHandler(async (_req, res) => {
            const cfg = (getConfig() || {}).businessExpense || {};
            let grup = [];
            let peserta = [];
            let waSiap = true;
            try {
                const wa = require("../lib/whatsapp.adapter");
                grup = await wa.getGroups();
                // Anggota grup terpilih — supaya pemilik dipilih dari daftar, bukan diketik.
                if (cfg.groupId) peserta = await wa.getGroupParticipants(cfg.groupId);
            } catch (_e) {
                // WA putus bukan kegagalan endpoint — setelan tersimpan tetap harus terlihat.
                waSiap = false;
            }
            res.json({
                success: true,
                data: {
                    enabled: cfg.enabled === true,
                    digest: cfg.digest === true,
                    groupId: cfg.groupId || "",
                    ownerJids: cfg.ownerJids || [],
                    ownerLids: cfg.ownerLids || [],
                    kategori: EXPENSE_CATEGORIES,
                    grup,
                    peserta,
                    waSiap
                }
            });
        })
    );

    router.put(
        "/api/kas-usaha/grup",
        jaga,
        asyncHandler(async (req, res) => {
            const groupId = String((req.body || {}).groupId || "").trim();
            if (groupId && !/@g\.us$/.test(groupId)) {
                return res.status(400).json({ success: false, message: "JID grup harus berakhiran @g.us." });
            }

            tulisSetelan({ groupId }, getConfig);
            res.json({
                success: true,
                message: groupId ? "Grup kas disimpan." : "Grup kas dikosongkan — pengingat tidak akan terkirim."
            });
        })
    );

    // Sakelar AKTIF fitur kas usaha. Sebelum ini halaman hanya MEMBERI TAHU "masih OFF di config"
    // tanpa memberi cara menyalakannya — operator tetap harus membuka config.json di server, yang
    // justru berkas paling berbahaya untuk disunting tangan (memuat kredensial gateway).
    router.put(
        "/api/kas-usaha/aktif",
        jaga,
        asyncHandler(async (req, res) => {
            const body = req.body || {};
            const aktif = body.enabled === true;
            const tambalan = { enabled: aktif };
            // Ringkasan uang harian: opt-in TERPISAH. Sebagian pemilik mau mencatat kas di grup
            // tapi tak mau menerima laporan tiap pagi.
            if (body.digest !== undefined) tambalan.digest = body.digest === true;
            const cfg = tulisSetelan(tambalan, getConfig);

            // Cron membaca setelannya SAAT DIJADWALKAN, bukan saat berbunyi. Tanpa penjadwalan
            // ulang di sini, menyalakan dari halaman menghasilkan sukses semu: layar bilang
            // aktif, tapi tak satu pun pesan terkirim sampai proses direstart.
            let jadwalAktif = false;
            try {
                require("../lib/cron/jobs/recurring-expense-reminder").initRecurringExpenseReminderTask();
                require("../lib/cron/jobs/money-digest").initMoneyDigestTask();
                jadwalAktif = aktif;
            } catch (e) {
                console.error("[KAS_AKTIF] Gagal menjadwalkan ulang job kas:", e && e.message);
            }

            // Jujur soal syarat: "aktif" tanpa grup/pemilik tak menghasilkan apa pun.
            const be = (cfg && cfg.businessExpense) || {};
            const kurang = [];
            if (!be.groupId) kurang.push("grup kas belum dipilih");
            if (!((be.ownerJids || []).length + (be.ownerLids || []).length)) kurang.push("pemilik belum ditentukan");

            // Kirim PANDUAN ke grup begitu fitur benar-benar siap dipakai. Tanpa ini orang di
            // grup harus lebih dulu menebak bahwa ada perintah bernama `kas bantuan` — fitur
            // yang cara pakainya tak pernah diberitahukan sama saja dengan tidak ada.
            if (aktif && !kurang.length) {
                require("../lib/services/kas-group-notifier")
                    .kabarkanKeGrupKas("be_bantuan", { fallback: "" })
                    .catch((e) => console.error("[KAS_AKTIF] Panduan gagal dikirim:", e && e.message));
            }

            res.json({
                success: true,
                enabled: aktif,
                jadwalAktif,
                message: !aktif
                    ? "Kas usaha dimatikan."
                    : (kurang.length
                        ? `Kas usaha diaktifkan — tapi ${kurang.join(" & ")}, jadi bot belum akan bekerja.`
                        : "Kas usaha diaktifkan.")
            });
        })
    );

    // Pemilik kas — siapa yang boleh mengetik `kas …` dan membalas `ok`/`lewati` di grup.
    // Gerbangnya GAGAL-TERTUTUP, jadi selama daftar ini kosong fitur diam total meski sudah
    // aktif dan grupnya benar; dulu satu-satunya cara mengisinya adalah menyunting config.json.
    router.put(
        "/api/kas-usaha/pemilik",
        jaga,
        asyncHandler(async (req, res) => {
            const masuk = Array.isArray((req.body || {}).pemilik) ? req.body.pemilik : [];
            const jids = [];
            const lids = [];
            const ditolak = [];

            for (const mentah of masuk) {
                const v = String(mentah || "").trim();
                if (!v) continue;
                if (/@lid$/i.test(v)) {
                    // `@lid` disimpan APA ADANYA. Angkanya BUKAN nomor telepon — mengubahnya
                    // jadi `62<lid>` menghasilkan pemilik palsu yang tak pernah cocok.
                    if (!lids.includes(v)) lids.push(v);

                    // TAPI simpan juga bentuk NOMOR-nya bila pemetaannya diketahui. Alasannya
                    // terbukti di produksi: daftar peserta grup memberi `@lid`, sedangkan pesan
                    // masuk tiba sebagai `62xxx@s.whatsapp.net`. Menyimpan satu bentuk saja
                    // membuat pemilik yang SUDAH dicentang tetap ditolak dan bot diam total.
                    // Ini BUKAN mengarang nomor dari angka @lid — hanya dipakai bila pemetaan
                    // yang tersimpan memang menyebutkan nomornya.
                    try {
                        const petaan = require("../lib/jid-utils").getStoredMappingByLid(v);
                        const digitLid = String((petaan && petaan.phoneNumber) || "").replace(/[^0-9]/g, "");
                        if (digitLid.length >= 9 && digitLid.length <= 15) {
                            const jidLid = `${digitLid}@s.whatsapp.net`;
                            if (!jids.includes(jidLid)) jids.push(jidLid);
                        }
                    } catch (_e) { /* pemetaan tak terbaca → cukup simpan @lid-nya */ }
                    continue;
                }
                const digit = v.replace(/@.*$/, "").replace(/[^0-9]/g, "");
                const nomor = digit.startsWith("0") ? `62${digit.slice(1)}` : digit;
                if (nomor.length < 9 || nomor.length > 15) {
                    ditolak.push(v);
                    continue;
                }
                const jid = `${nomor}@s.whatsapp.net`;
                if (!jids.includes(jid)) jids.push(jid);
            }

            if (ditolak.length) {
                return res.status(400).json({
                    success: false,
                    message: `Nomor tidak dikenali: ${ditolak.join(", ")}. Pakai format 08… atau 62….`
                });
            }

            tulisSetelan({ ownerJids: jids, ownerLids: lids }, getConfig);
            res.json({
                success: true,
                data: { ownerJids: jids, ownerLids: lids },
                message: jids.length + lids.length
                    ? `${jids.length + lids.length} pemilik kas disimpan.`
                    : "Daftar pemilik dikosongkan — perintah kas di grup akan diabaikan."
            });
        })
    );

    // ── Biaya rutin ─────────────────────────────────────────────────────────────
    router.get(
        "/api/kas-usaha/rutin",
        jaga,
        asyncHandler(async (_req, res) => {
            res.json({
                success: true,
                data: await recurring.listAll(),
                periode: recurring.periodeSekarang(),
                tertunda: (await recurring.tertunda()).map((x) => x.id)
            });
        })
    );

    router.put(
        "/api/kas-usaha/rutin",
        jaga,
        asyncHandler(async (req, res) => {
            try {
                res.json({ success: true, data: await recurring.simpan(req.body || {}) });
            } catch (e) {
                res.status(400).json({ success: false, message: e.message });
            }
        })
    );

    router.delete(
        "/api/kas-usaha/rutin/:id",
        jaga,
        asyncHandler(async (req, res) => {
            const r = await recurring.hapus(req.params.id);
            if (!r.dihapus) return res.status(404).json({ success: false, message: "Biaya rutin tidak ditemukan." });
            res.json({ success: true });
        })
    );

    // Catat manual dari web (mis. tagihan sudah dibayar sebelum pengingat sempat terkirim).
    router.post(
        "/api/kas-usaha/rutin/:id/catat",
        jaga,
        asyncHandler(async (req, res) => {
            try {
                const hasil = await recurring.konfirmasi(req.params.id, {
                    nominal: (req.body || {}).nominal,
                    actor: (req.user && req.user.username) || "web"
                });
                res.json({ success: true, data: { expenseId: hasil.expense.id, jumlah: hasil.jumlah } });
            } catch (e) {
                res.status(400).json({ success: false, message: e.message });
            }
        })
    );

    // ── ARUS KAS bulan berjalan ─────────────────────────────────────────────────
    // Satu tempat untuk pertanyaan "uang saya bagaimana bulan ini": berapa yang bisa ditagih,
    // berapa sudah masuk, berapa keluar, sisa berapa — plus rincian pengeluaran per kategori
    // untuk grafiknya. Angka MASUK & KELUAR dibaca dari pemilik masing-masing
    // (owner-cockpit + expense-manager); tak ada yang dihitung ulang di sini.
    router.get(
        "/api/kas-usaha/cashflow",
        jaga,
        asyncHandler(async (_req, res) => {
            // SELURUH hitungannya milik lib/services/money-summary — sama persis dengan yang
            // dipakai perintah `omset` di WhatsApp. Dulu halaman menghitung sendiri, dan
            // akibatnya nyata: WA melaporkan omset Rp7.125.000 (termasuk terisolir) sementara
            // halaman Rp6.905.000. Dua angka bernama sama yang berselisih membuat pemiliknya
            // berhenti percaya keduanya.
            const ms = require("../lib/services/money-summary");
            const d = await ms.buildMoneySummary();
            res.json({ success: true, data: d });
        })
    );

    // ── Ringkasan kas bulan berjalan ────────────────────────────────────────────
    router.get(
        "/api/kas-usaha/ringkasan",
        jaga,
        asyncHandler(async (_req, res) => {
            const now = new Date();
            const p = (n) => String(n).padStart(2, "0");
            const from = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
            const to = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())}`;

            const rows = await listExpenses({ dateFrom: from, dateTo: to, status: "active" });
            const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
            const perKategori = {};
            for (const e of rows) {
                perKategori[e.category] = (perKategori[e.category] || 0) + Number(e.amount || 0);
            }
            res.json({ success: true, data: { periode: recurring.periodeSekarang(), total, jumlah: rows.length, perKategori, terbaru: rows.slice(0, 10) } });
        })
    );
}

module.exports = { registerAdminKasUsahaRoutes };
