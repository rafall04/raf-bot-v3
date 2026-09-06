/**
 * Header Doc
 * Purpose: API domain KEUANGAN PRIBADI owner — login/logout sesi dompet, daftar catatan, rekap
 *          periode, tambah, dan hapus. Dipakai halaman `/keuangan-pribadi`.
 *          Otentikasinya BERDIRI SENDIRI (`lib/personal-finance-auth`): kredensial + rahasia
 *          sesi terpisah, cookie `pf_session`. Sesi admin TIDAK memberi akses ke sini, dan
 *          sebaliknya. Ini menggantikan gate allowlist-username yang lama, yang masih menumpang
 *          sesi admin sehingga browser admin yang tertinggal terbuka = dompet ikut terbuka.
 * Caller: `routes/admin-router.js`.
 * Deps: `lib/personal-finance-auth`, `lib/error-handler.asyncHandler`,
 *       `repositories/personal-finance.repository`, `lib/personal-finance-service`.
 * MainFuncs: `registerAdminPersonalFinanceRoutes`, `ensurePersonalFinanceSession`.
 * SideEffects: Menulis/menghapus baris di `personal_finance.sqlite`; set/hapus cookie sesi.
 */
"use strict";
const { writeFileAtomicSync } = require('../lib/atomic-file'); // config.json ATOMIK (#b343)

const { asyncHandler } = require("../lib/error-handler");
const {
    parseAmount,
    todayStr,
    monthRange,
    previousRange,
    hitungTren,
    toCsv,
    buildReportData,
    buildDailySeries,
    inferCategory
} = require("../lib/personal-finance-service");
const pfAuth = require("../lib/personal-finance-auth");

let repoSingleton = null;
function getRepo() {
    if (!repoSingleton) {
        const { createPersonalFinanceRepository } = require("../repositories/personal-finance.repository");
        repoSingleton = createPersonalFinanceRepository();
    }
    return repoSingleton;
}

/**
 * Penjaga sesi dompet. GAGAL-TERTUTUP: fitur mati, kredensial belum disiapkan, cookie tak ada,
 * tanda tangan salah, kedaluwarsa, atau token bukan ber-scope dompet ⇒ 401.
 * Token admin yang sah pun ditolak di sini — itu memang tujuannya.
 */
function ensurePersonalFinanceSession(getConfig) {
    return (req, res, next) => {
        const cfg = (getConfig() || {}).personalFinance || {};
        if (cfg.enabled !== true) {
            return res.status(404).json({ success: false, message: "Tidak ditemukan." });
        }
        const sesi = pfAuth.resolveSession(req);
        if (!sesi) {
            return res.status(401).json({ success: false, message: "Sesi tidak sah. Silakan masuk kembali." });
        }
        req.pfUser = sesi;
        return next();
    };
}

function registerAdminPersonalFinanceRoutes(router, deps = {}) {
    const getConfig = deps.getConfig || (() => global.config);
    const gate = ensurePersonalFinanceSession(getConfig);

    // ── Otentikasi dompet (TANPA gate — ini pintunya) ───────────────────────────
    router.get(
        "/api/keuangan-pribadi/sesi",
        asyncHandler(async (req, res) => {
            const cfg = (getConfig() || {}).personalFinance || {};
            if (cfg.enabled !== true) return res.status(404).json({ success: false });
            const sesi = pfAuth.resolveSession(req);
            res.json({
                success: true,
                data: { masuk: Boolean(sesi), username: sesi ? sesi.username : null, siap: pfAuth.hasCredential() }
            });
        })
    );

    router.post(
        "/api/keuangan-pribadi/login",
        asyncHandler(async (req, res) => {
            const cfg = (getConfig() || {}).personalFinance || {};
            if (cfg.enabled !== true) return res.status(404).json({ success: false, message: "Tidak ditemukan." });

            if (!pfAuth.hasCredential()) {
                return res.status(503).json({
                    success: false,
                    message: "Kredensial dompet belum disiapkan. Jalankan scripts/set-keuangan-pribadi-password.js."
                });
            }

            const { username, password } = req.body || {};
            const sah = await pfAuth.verifyCredential(username, password);
            if (!sah) {
                // Pesan seragam — jangan bocorkan mana yang salah, username atau sandi.
                return res.status(401).json({ success: false, message: "Nama pengguna atau sandi salah." });
            }

            const token = pfAuth.issueSessionToken(String(username).trim().toLowerCase());
            res.cookie(pfAuth.COOKIE_NAME, token, {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                maxAge: 8 * 60 * 60 * 1000
            });
            res.json({ success: true });
        })
    );

    router.post("/api/keuangan-pribadi/logout", (req, res) => {
        res.cookie(pfAuth.COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
        res.json({ success: true });
    });

    // ── Penjaga MENYELURUH untuk sisa endpoint dompet ───────────────────────────
    // Dipasang di level PREFIX, sesudah route login/logout/sesi di atas dan sebelum semua
    // route data di bawah. Tujuannya: endpoint dompet yang ditambahkan nanti ikut terjaga
    // walau penulisnya lupa menyisipkan `gate` — karena seluruh `/api/keuangan-pribadi/*`
    // sudah "publik" bagi middleware admin (PUBLIC_PATHS), lupa satu gate = data pribadi
    // terbuka tanpa login. Gate per-route di bawah tetap dipertahankan (berlapis).
    router.use("/api/keuangan-pribadi", gate);

    // Rentang default = bulan berjalan; `?from=&to=` (YYYY-MM-DD) atau `?month=YYYY-MM`.
    function resolveRange(query = {}) {
        if (query.month) return monthRange(String(query.month));
        const from = /^\d{4}-\d{2}-\d{2}$/.test(String(query.from || "")) ? String(query.from) : null;
        const to = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to || "")) ? String(query.to) : null;
        if (from || to) return { month: null, from: from || "0000-01-01", to: to || "9999-12-31" };
        return monthRange(null);
    }

    router.get(
        "/api/keuangan-pribadi/ringkasan",
        gate,
        asyncHandler(async (req, res) => {
            const rentang = resolveRange(req.query);
            const hariIni = todayStr();
            // Deret harian ikut di sini (bukan endpoint terpisah) supaya halaman tetap
            // 2 permintaan, bukan 3 — periodenya sama persis dengan ringkasan.
            const [rekap, rekapHari, harian] = await Promise.all([
                getRepo().summary({ from: rentang.from, to: rentang.to }),
                getRepo().summary({ from: hariIni, to: hariIni }),
                getRepo().dailyTotals({ from: rentang.from, to: rentang.to })
            ]);
            const perHari = buildDailySeries(harian, rentang.from, rentang.to);
            const puncak = perHari.reduce((a, b) => (b.keluar > (a ? a.keluar : -1) ? b : a), null);

            // Periode pembanding + pagu kategori (dua-duanya opsional bagi UI).
            const sebelum = previousRange(rentang.from, rentang.to);
            const [rekapSebelum, pagu] = await Promise.all([
                sebelum ? getRepo().summary({ from: sebelum.from, to: sebelum.to }) : Promise.resolve(null),
                getRepo().listBudgets()
            ]);

            const dasar = buildReportData(rekap, []);
            // Sisipkan pagu ke rincian kategori pengeluaran supaya UI tak perlu menjodohkan sendiri.
            const perKategoriKeluar = dasar.perKategoriKeluar.map((r) => {
                const batas = Number(pagu[r.category] || 0);
                return {
                    ...r,
                    pagu: batas,
                    persenPagu: batas > 0 ? Math.round((r.total / batas) * 100) : null,
                    lewatPagu: batas > 0 && r.total > batas
                };
            });
            // Kategori yang DIANGGARKAN tapi belum ada pengeluarannya tetap ditampilkan —
            // pagu yang tak pernah terlihat sama saja dengan tak ada.
            for (const [kat, batas] of Object.entries(pagu)) {
                if (!perKategoriKeluar.some((r) => r.category === kat)) {
                    perKategoriKeluar.push({ category: kat, total: 0, jumlah: 0, pagu: batas, persenPagu: 0, lewatPagu: false });
                }
            }

            res.json({
                success: true,
                data: {
                    ...dasar,
                    perKategoriKeluar,
                    periode: rentang,
                    hariIni: {
                        tanggal: hariIni,
                        masuk: rekapHari.masuk,
                        keluar: rekapHari.keluar,
                        selisih: rekapHari.selisih
                    },
                    perHari,
                    hariTerboros: puncak && puncak.keluar > 0 ? puncak : null,
                    rataKeluarPerHari: perHari.length ? Math.round(rekap.keluar / perHari.length) : 0,
                    pagu,
                    banding: sebelum
                        ? {
                              periode: sebelum,
                              masuk: hitungTren(rekap.masuk, rekapSebelum.masuk),
                              // Pengeluaran NAIK = memburuk — arah nilainya dibalik di sini,
                              // bukan di UI, supaya WA/web/ekspor menafsirkannya sama.
                              keluar: hitungTren(rekap.keluar, rekapSebelum.keluar, true),
                              selisih: hitungTren(rekap.selisih, rekapSebelum.selisih)
                          }
                        : null
                }
            });
        })
    );

    router.get(
        "/api/keuangan-pribadi/catatan",
        gate,
        asyncHandler(async (req, res) => {
            const rentang = resolveRange(req.query);
            const filter = {
                from: rentang.from,
                to: rentang.to,
                kind: req.query.kind,
                category: req.query.category,
                search: req.query.search
            };
            const [rows, semuaPeriode] = await Promise.all([
                getRepo().listEntries({ ...filter, limit: req.query.limit || 200, offset: req.query.offset }),
                // Daftar kategori untuk mengisi dropdown filter diambil dari SELURUH periode,
                // bukan dari hasil terfilter — kalau tidak, memilih satu kategori akan
                // menghapus semua pilihan lain dan pemakai terjebak (tak bisa ganti pilihan).
                getRepo().summary({ from: rentang.from, to: rentang.to })
            ]);

            const subtotal = rows.reduce(
                (a, r) => {
                    if (r.kind === "in") a.masuk += Number(r.amount || 0);
                    else a.keluar += Number(r.amount || 0);
                    return a;
                },
                { masuk: 0, keluar: 0 }
            );

            res.json({
                success: true,
                data: rows,
                periode: rentang,
                terfilter: {
                    aktif: Boolean(filter.kind || filter.category || String(filter.search || "").trim()),
                    jumlah: rows.length,
                    masuk: subtotal.masuk,
                    keluar: subtotal.keluar,
                    selisih: subtotal.masuk - subtotal.keluar
                },
                kategoriTersedia: [...new Set((semuaPeriode.perKategori || []).map((r) => r.category))].sort()
            });
        })
    );

    router.post(
        "/api/keuangan-pribadi/catatan",
        gate,
        asyncHandler(async (req, res) => {
            const body = req.body || {};
            const kind = body.kind === "in" ? "in" : body.kind === "out" ? "out" : null;
            if (!kind) {
                return res.status(400).json({ success: false, message: "Jenis wajib 'in' (masuk) atau 'out' (keluar)." });
            }

            // Terima "50rb"/"2jt" dari form persis seperti di WhatsApp — satu penerjemah untuk dua permukaan.
            const amount = typeof body.amount === "number" ? Math.round(body.amount) : parseAmount(body.amount);
            if (!amount || amount <= 0) {
                return res.status(400).json({ success: false, message: "Nominal tidak terbaca (contoh: 50rb, 2jt, 50000)." });
            }

            const ts = /^\d{4}-\d{2}-\d{2}$/.test(String(body.tanggal || "")) ? `${body.tanggal} 12:00:00` : undefined;
            // Kategori ditebak dari catatan bila form tak mengirimnya — halaman memang menjanjikan
            // "kategori ditebak otomatis", dan tanpa ini SEMUA catatan web jatuh ke "lain".
            const category =
                String(body.category || "").trim() ||
                inferCategory(body.note, ((getConfig() || {}).personalFinance || {}).categories);
            const entry = await getRepo().addEntry({
                kind,
                amount,
                category,
                note: body.note,
                source: "web",
                ts
            });
            res.json({ success: true, data: entry });
        })
    );

    // ── Pemilih grup WhatsApp ───────────────────────────────────────────────────
    // Sengaja DI SINI, bukan di halaman /config admin. Seluruh desain dompet ini memisahkan
    // diri dari panel admin; kalau setelannya ikut di /config, admin lain bisa memindahkan
    // grup dan mematikan fitur ini tanpa pemiliknya tahu. (Ia tak bisa MEMBACA data —
    // gerbang pemilik tetap menutup — tapi bisa membuatnya diam.)
    router.get(
        "/api/keuangan-pribadi/grup",
        gate,
        asyncHandler(async (_req, res) => {
            const adapter = require("../lib/whatsapp.adapter");
            const terpilih = ((getConfig() || {}).personalFinance || {}).groupId || "";
            try {
                res.json({ success: true, data: await adapter.getGroups(), terpilih, waSiap: true });
            } catch (e) {
                // WA belum tersambung BUKAN kegagalan endpoint ini: pilihan yang tersimpan
                // tetap harus terlihat. Membalas 503 polos membuat halaman tak bisa
                // menampilkan grup yang sedang aktif justru saat bot sedang bermasalah —
                // persis saat orang ingin memeriksanya.
                res.json({
                    success: true,
                    data: [],
                    terpilih,
                    waSiap: false,
                    message: e.message || "WhatsApp belum terkoneksi — daftar grup tak bisa dimuat."
                });
            }
        })
    );

    router.put(
        "/api/keuangan-pribadi/grup",
        gate,
        asyncHandler(async (req, res) => {
            const groupId = String((req.body || {}).groupId || "").trim();
            if (groupId && !/@g\.us$/.test(groupId)) {
                return res.status(400).json({ success: false, message: "JID grup harus berakhiran @g.us." });
            }

            const fs = require("fs");
            const path = require("path");
            const configPath = path.join(__dirname, "..", "config.json");

            // Baca-ubah-tulis: HANYA menyentuh personalFinance.groupId. config.json memuat
            // kredensial gateway, template, dan puluhan setelan lain — menulis ulang dari
            // objek in-memory berisiko menjatuhkan key yang tak dikenal kode ini.
            const isi = JSON.parse(fs.readFileSync(configPath, "utf8"));
            if (!isi.personalFinance) isi.personalFinance = {};
            isi.personalFinance.groupId = groupId;
            writeFileAtomicSync(configPath, JSON.stringify(isi, null, 2));

            // Terapkan ke runtime supaya berlaku TANPA restart bot.
            const cfg = getConfig();
            if (cfg) {
                if (!cfg.personalFinance) cfg.personalFinance = {};
                cfg.personalFinance.groupId = groupId;
            }

            res.json({
                success: true,
                data: { groupId },
                message: groupId
                    ? "Grup disimpan. Perintah dompet kini dilayani di grup itu (DM dimatikan)."
                    : "Grup dikosongkan. Perintah dompet kembali dilayani lewat DM."
            });
        })
    );

    // ── Ganti sandi dompet (butuh sesi AKTIF + sandi lama) ──────────────────────
    router.post(
        "/api/keuangan-pribadi/ganti-sandi",
        gate,
        asyncHandler(async (req, res) => {
            const { sandiLama, sandiBaru } = req.body || {};
            const username = req.pfUser.username;

            // Sesi yang sah saja TIDAK cukup: kalau browser tertinggal terbuka, siapa pun
            // bisa mengunci pemilik keluar dari dompetnya sendiri. Sandi lama wajib.
            // 403, BUKAN 401. Di sini sesinya SAH — yang salah cuma sandi yang diketik.
            // Frontend memperlakukan 401 sebagai "sesi habis" dan melempar ke halaman masuk,
            // jadi memakai 401 akan menendang pemilik keluar hanya karena salah ketik.
            if (!(await pfAuth.verifyCredential(username, sandiLama))) {
                return res.status(403).json({ success: false, message: "Sandi sekarang salah." });
            }
            if (String(sandiBaru || "").length < 8) {
                return res.status(400).json({ success: false, message: "Sandi baru minimal 8 karakter." });
            }
            if (String(sandiBaru) === String(sandiLama)) {
                return res.status(400).json({ success: false, message: "Sandi baru sama dengan yang lama." });
            }

            // Rotasi rahasia sesi → SEMUA sesi lain (perangkat lain) langsung logout, karena
            // ganti sandi biasanya dilakukan justru saat curiga sandi lama bocor. Perangkat
            // yang sedang dipakai diberi cookie baru supaya tak ikut terlempar keluar.
            await pfAuth.setCredential(username, sandiBaru, { rotateSecret: true });
            res.cookie(pfAuth.COOKIE_NAME, pfAuth.issueSessionToken(username), {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                maxAge: 8 * 60 * 60 * 1000
            });
            res.json({ success: true, message: "Sandi diganti. Perangkat lain otomatis keluar." });
        })
    );

    // ── Pagu (anggaran) per kategori ────────────────────────────────────────────
    router.get(
        "/api/keuangan-pribadi/pagu",
        gate,
        asyncHandler(async (_req, res) => {
            res.json({ success: true, data: await getRepo().listBudgets() });
        })
    );

    router.put(
        "/api/keuangan-pribadi/pagu",
        gate,
        asyncHandler(async (req, res) => {
            const body = req.body || {};
            const kategori = String(body.category || "").trim();
            if (!kategori) {
                return res.status(400).json({ success: false, message: "Kategori wajib diisi." });
            }
            // Terima "500rb" persis seperti nominal di tempat lain — satu penerjemah, semua permukaan.
            const nominal =
                body.amount === "" || body.amount == null
                    ? 0
                    : typeof body.amount === "number"
                      ? Math.round(body.amount)
                      : parseAmount(body.amount) || 0;

            const hasil = await getRepo().setBudget(kategori, nominal);
            res.json({ success: true, data: hasil });
        })
    );

    // ── Ekspor CSV (menghormati filter yang sedang aktif) ───────────────────────
    router.get(
        "/api/keuangan-pribadi/ekspor",
        gate,
        asyncHandler(async (req, res) => {
            const rentang = resolveRange(req.query);
            const rows = await getRepo().listEntries({
                from: rentang.from,
                to: rentang.to,
                kind: req.query.kind,
                category: req.query.category,
                search: req.query.search,
                limit: 500
            });

            const namaBerkas = `keuangan-pribadi_${rentang.from}_sd_${rentang.to}.csv`;
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${namaBerkas}"`);
            // Berkas ini isinya data keuangan pribadi — jangan sampai tersimpan di cache
            // perantara mana pun.
            res.setHeader("Cache-Control", "no-store");
            res.send(toCsv(rows));
        })
    );

    router.delete(
        "/api/keuangan-pribadi/catatan/:id",
        gate,
        asyncHandler(async (req, res) => {
            const hasil = await getRepo().deleteEntry(req.params.id);
            if (!hasil.deleted) {
                return res.status(404).json({ success: false, message: "Catatan tidak ditemukan." });
            }
            res.json({ success: true });
        })
    );
}

module.exports = { registerAdminPersonalFinanceRoutes, ensurePersonalFinanceSession };
