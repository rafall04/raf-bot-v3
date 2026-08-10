"use strict";

/**
 * Header Doc
 * Purpose: Gaji pokok TETAP per teknisi — diisi sekali, lalu draft payroll bulan berjalan
 *   dibuat sendiri tiap bulan. Nilainya nominal yang sama tiap bulan, jadi mengetiknya ulang
 *   12x setahun hanya menciptakan peluang salah ketik dan bulan yang terlewat.
 *
 *   BATAS KERAS: otomatisasi berhenti di DRAFT. Modul ini tak boleh memanggil `finalizePayroll`,
 *   `payPayroll`, atau jalur WhatsApp mana pun — uang berpindah dan struk terkirim hanya lewat
 *   klik manusia di halaman gaji. Draft yang salah masih bisa dihapus; transfer tidak.
 * Caller: `lib/cron/jobs/technician-salary-draft.js`, `routes/gaji.js` (kartu Gaji Pokok Tetap).
 * Deps: `global.db` (sqlite utama), `./technician-finance-service` (createPayrollDraft),
 *   `./env-config` (loadConfig), `./services/kas-group-notifier`.
 * MainFuncs: `listPlans`, `savePlans`, `setAutoDraft`, `createDraftsForPeriod`, `getUnpaidPayrolls`.
 * SideEffects: Menulis `technician_salary_defaults` + membuat baris draft `technician_gaji`;
 *   mengirim kabar ke grup kas saat ada draft baru (never-throw).
 */

const { createPayrollDraft, getPayrollList, getPayrollRecord, updatePayrollDraft } = require("./technician-finance-service");

let siap = null;

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        global.db.run(sql, params, function onRun(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        global.db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
}

async function ensureTable() {
    if (!siap) {
        siap = (async () => {
            await run(`
                CREATE TABLE IF NOT EXISTS technician_salary_defaults (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teknisi_id INTEGER NOT NULL UNIQUE,
                    teknisi_name TEXT,
                    -- CHECK > 0 disengaja: normalizeMoney memulangkan 0 untuk masukan tak
                    -- terbaca, jadi tanpa penolakan di skema satu salah ketik menghasilkan
                    -- draft Rp0 yang tampak sah sampai hari pembayaran.
                    gaji_pokok INTEGER NOT NULL CHECK (gaji_pokok > 0),
                    aktif INTEGER NOT NULL DEFAULT 1,
                    -- Periode 'YYYY-MM', bukan boolean/timestamp: prod restart 7-13x/hari, dan
                    -- hanya penanda per-periode yang membuat pembuatan draft idempoten tanpa
                    -- bergantung pada state di memori. Juga mencegah draft yang SENGAJA dihapus
                    -- operator hidup lagi besok paginya.
                    last_drafted_period TEXT,
                    catatan TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                )
            `);
            await run("CREATE INDEX IF NOT EXISTS idx_salary_defaults_aktif ON technician_salary_defaults(aktif)");
        })().catch((e) => {
            siap = null;
            throw e;
        });
    }
    return siap;
}

function periodeDari(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function setelan() {
    const cfg = (global.config && global.config.technicianSalary) || {};
    return {
        autoDraft: cfg.autoDraft === true,
        draftDay: Number(cfg.draftDay) > 0 ? Math.min(31, Number(cfg.draftDay)) : 28,
        draftSchedule: typeof cfg.draftSchedule === "string" && cfg.draftSchedule.trim() ? cfg.draftSchedule.trim() : "20 7 * * *"
    };
}

async function listPlans() {
    await ensureTable();
    return all("SELECT * FROM technician_salary_defaults ORDER BY teknisi_id ASC");
}

/** Akun teknisi yang sah — nama otoritatif selalu dari akun, bukan snapshot di tabel. */
function akunTeknisi() {
    return (global.accounts || []).filter((a) => String(a.role || "").toLowerCase() === "teknisi");
}

/**
 * Menyimpan gaji tetap untuk beberapa teknisi sekaligus. SELURUH item divalidasi lebih dulu:
 * separuh tersimpan lebih buruk daripada tak tersimpan, karena operator melihat "berhasil".
 */
async function savePlans(items = [], { date = new Date() } = {}) {
    await ensureTable();
    if (!Array.isArray(items) || items.length === 0) {
        return { ok: false, reason: "kosong" };
    }

    const sah = akunTeknisi();
    const bersih = [];
    for (const item of items) {
        const teknisiId = Number(item.teknisi_id);
        const gajiPokok = Number(item.gaji_pokok);
        const akun = sah.find((a) => Number(a.id) === teknisiId);
        if (!akun) return { ok: false, reason: `teknisi_id ${item.teknisi_id} bukan akun teknisi` };
        if (!Number.isFinite(gajiPokok) || gajiPokok <= 0) {
            return { ok: false, reason: `gaji pokok untuk ${akun.name || akun.username} harus lebih dari 0` };
        }
        bersih.push({ teknisiId, gajiPokok: Math.round(gajiPokok), nama: akun.name || akun.username, aktif: item.aktif === false ? 0 : 1 });
    }

    for (const b of bersih) {
        await run(
            `INSERT INTO technician_salary_defaults (teknisi_id, teknisi_name, gaji_pokok, aktif, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(teknisi_id) DO UPDATE SET
                teknisi_name = excluded.teknisi_name,
                gaji_pokok   = excluded.gaji_pokok,
                aktif        = excluded.aktif,
                updated_at   = datetime('now')`,
            [b.teknisiId, b.nama, b.gajiPokok, b.aktif]
        );
    }

    const draftDiselaraskan = await selaraskanDraftPeriodeBerjalan(bersih, date);
    return { ok: true, tersimpan: bersih.length, items: bersih, draftDiselaraskan };
}

/**
 * Menyelaraskan DRAFT periode berjalan dengan gaji pokok tetap yang baru disimpan.
 *
 * Tanpa ini, mengubah nominal setelah draft bulan ini terlanjur dibuat menghasilkan jebakan
 * senyap: layar bilang "Rp600.000 tersimpan", draft bulan ini tetap Rp250.000, dan yang
 * benar-benar dibayarkan adalah angka lama. Terukur di produksi 2026-08-10.
 *
 * HANYA menyentuh status `draft` (belum ada uang berpindah) dan HANYA periode berjalan —
 * bulan lampau memakai gaji yang berlaku saat itu dan tak boleh ditulis ulang surut.
 */
async function selaraskanDraftPeriodeBerjalan(items, date = new Date()) {
    const periodMonth = date.getMonth() + 1;
    const periodYear = date.getFullYear();
    const hasil = [];

    for (const item of items) {
        try {
            const daftar = await getPayrollList({ teknisiId: item.teknisiId, month: periodMonth, year: periodYear });
            const draft = (daftar || []).find((r) => String(r.status) === "draft");
            if (!draft) continue;
            if (Number(draft.gaji_pokok) === Number(item.gajiPokok)) continue;

            const sebelum = Number(draft.gaji_pokok);
            const penuh = await getPayrollRecord(draft.id);
            const r = await updatePayrollDraft(draft.id, {
                gaji_pokok: item.gajiPokok,
                bonus_manual: penuh.bonus_manual,
                potongan_kasbon: penuh.potongan_kasbon,
                potongan_lain: penuh.potongan_lain,
                potongan_lain_keterangan: penuh.potongan_lain_keterangan,
                notes: penuh.notes
            });
            if (r.updated) {
                hasil.push({ nama: item.nama, periode: `${periodMonth}/${periodYear}`, sebelum, sesudah: item.gajiPokok });
            }
        } catch (error) {
            console.error("[GAJI_TETAP_SELARAS_ERROR]", item.teknisiId, error.message);
        }
    }
    return hasil;
}

/** SATU-SATUNYA penulis key `technicianSalary` di config.json (baca-ubah-tulis, bukan timpa). */
async function setAutoDraft({ enabled, draftDay }) {
    const fs = require("fs");
    const path = require("path");
    const berkas = path.join(__dirname, "..", "config.json");
    const isi = JSON.parse(fs.readFileSync(berkas, "utf8"));
    const sebelum = isi.technicianSalary || {};
    const sesudah = { ...sebelum };
    if (enabled !== undefined) sesudah.autoDraft = enabled === true;
    if (draftDay !== undefined && Number(draftDay) >= 1 && Number(draftDay) <= 31) {
        sesudah.draftDay = Number(draftDay);
    }
    isi.technicianSalary = sesudah;
    fs.writeFileSync(berkas, JSON.stringify(isi, null, 2), "utf8");
    // Config in-memory ikut disegarkan supaya sakelarnya berlaku tanpa restart.
    if (global.config) global.config.technicianSalary = { ...sesudah };
    return sesudah;
}

/**
 * Payroll yang BELUM dibayar, lintas bulan.
 *
 * Kenapa lintas bulan: halaman gaji default menyaring ke bulan berjalan, jadi draft yang dibuat
 * otomatis bulan lalu tak muncul di satu pixel pun begitu bulannya berganti — dan peringatan
 * komisi juga bungkam untuk periode yang sudah punya baris payroll. Tanpa daftar ini,
 * otomatisasi justru menciptakan uang tak terlihat, persis masalah yang mau dihindari.
 */
async function getUnpaidPayrolls() {
    const draft = await getPayrollList({ status: "draft" });
    const finalized = await getPayrollList({ status: "finalized" });
    return [...draft, ...finalized]
        .map((r) => ({
            id: r.id,
            teknisi_name: r.teknisi_name,
            period_month: Number(r.period_month),
            period_year: Number(r.period_year),
            net_amount: Number(r.net_amount || r.total_gaji || 0),
            status: r.status
        }))
        .sort((a, b) => a.period_year - b.period_year || a.period_month - b.period_month);
}

/**
 * Membuat draft payroll bulan berjalan untuk tiap teknisi yang punya gaji tetap aktif.
 *
 * @param {Date} [opts.date] Disuntikkan oleh tes; jangan mengandalkan jam mesin.
 * @param {boolean} [opts.ignoreDayGate] Jalur tombol manual — abaikan gerbang tanggal & penanda.
 */
async function createDraftsForPeriod({ date = new Date(), ignoreDayGate = false, actor = { name: "otomatis" } } = {}) {
    await ensureTable();
    const cfg = setelan();

    if (!ignoreDayGate && !cfg.autoDraft) {
        return { dijalankan: false, alasan: "auto_draft_mati", dibuat: 0, sudahAda: 0, dilewati: 0, hasil: [] };
    }

    const periodMonth = date.getMonth() + 1;
    const periodYear = date.getFullYear();
    const periode = periodeDari(date);

    if (!ignoreDayGate) {
        // Clamp ke hari terakhir bulan supaya tanggal 29-31 tetap menyala di Februari, dan
        // pakai ">=" bukan "===" supaya satu restart tepat di menitnya tak menghilangkan
        // satu bulan penuh — node-cron tidak mengejar tick yang terlewat.
        const hariTerakhir = new Date(periodYear, periodMonth, 0).getDate();
        const pemicu = Math.min(cfg.draftDay, hariTerakhir);
        if (date.getDate() < pemicu) {
            return { dijalankan: false, alasan: "belum_tanggalnya", pemicu, dibuat: 0, sudahAda: 0, dilewati: 0, hasil: [] };
        }
    }

    const plans = (await listPlans()).filter((p) => Number(p.aktif) === 1);
    const akun = akunTeknisi();
    const hasil = [];
    let dibuat = 0;
    let sudahAda = 0;
    let dilewati = 0;

    for (const plan of plans) {
        if (!ignoreDayGate && plan.last_drafted_period === periode) {
            dilewati += 1;
            hasil.push({ teknisi_id: plan.teknisi_id, nama: plan.teknisi_name, hasil: "dilewati", alasan: "sudah_ditandai_periode_ini" });
            continue;
        }
        const a = akun.find((x) => Number(x.id) === Number(plan.teknisi_id));
        if (!a) {
            // Akun hilang / berganti peran. Barisnya TIDAK dihapus (bisa aktif lagi), dan
            // draft tak dibuat atas nama "Teknisi <id>" yang tak jelas milik siapa.
            dilewati += 1;
            hasil.push({ teknisi_id: plan.teknisi_id, nama: plan.teknisi_name, hasil: "dilewati", alasan: "akun_teknisi_tidak_ditemukan" });
            continue;
        }

        try {
            const r = await createPayrollDraft(
                {
                    teknisiId: plan.teknisi_id,
                    teknisiName: a.name || a.username,
                    periodMonth,
                    periodYear,
                    gajiPokok: plan.gaji_pokok,
                    bonusManual: 0,
                    // Potongan kasbon SENGAJA 0 — memotong hutang orang adalah keputusan
                    // manusia, bukan efek samping cron.
                    potonganKasbon: 0,
                    potonganLain: 0,
                    notes: "Draft otomatis dari Gaji Pokok Tetap"
                },
                { id: actor.id || null, name: actor.name || "otomatis" }
            );

            if (r.created) {
                dibuat += 1;
                hasil.push({ teknisi_id: plan.teknisi_id, nama: a.name || a.username, hasil: "dibuat", payrollId: r.id });
            } else {
                // Conflict = "draft periode ini memang sudah ada" = SUKSES, bukan kegagalan.
                // Kalau dihitung gagal, cron memicu alarm palsu tiap bulan setelah operator
                // membuat draftnya lebih dulu.
                sudahAda += 1;
                hasil.push({ teknisi_id: plan.teknisi_id, nama: a.name || a.username, hasil: "sudah_ada" });
            }
            await run("UPDATE technician_salary_defaults SET last_drafted_period = ?, updated_at = datetime('now') WHERE teknisi_id = ?", [periode, plan.teknisi_id]);
        } catch (error) {
            dilewati += 1;
            hasil.push({ teknisi_id: plan.teknisi_id, nama: a.name || a.username, hasil: "gagal", alasan: error.message });
            console.error("[GAJI_TETAP_DRAFT_ERROR]", plan.teknisi_id, error.message);
        }
    }

    if (dibuat > 0) {
        await kabarkanDraftBaru({ periode, dibuat, hasil, plans });
    }

    return { dijalankan: true, periode, dibuat, sudahAda, dilewati, hasil };
}

/**
 * Kabar ke grup kas saat draft dibuat.
 *
 * Yang selama ini MENYERET pemilik ke halaman gaji adalah keharusan mengetik nominalnya.
 * Otomatisasi menghapus pemicu itu, jadi ia harus diganti — kalau tidak, draft bisa menumpuk
 * berbulan-bulan tanpa satu pun tanda. Never-throw: gagal kirim tak boleh menjatuhkan cron.
 */
async function kabarkanDraftBaru({ periode, dibuat, hasil, plans }) {
    try {
        const { kabarkanKeGrupKas } = require("./services/kas-group-notifier");
        const nama = hasil.filter((h) => h.hasil === "dibuat").map((h) => h.nama);
        const total = plans
            .filter((p) => nama.includes(p.teknisi_name))
            .reduce((s, p) => s + Number(p.gaji_pokok || 0), 0);
        await kabarkanKeGrupKas("kas_notif_draft_gaji", {
            data: {
                periode,
                jumlah: String(dibuat),
                daftar: nama.join(", "),
                total: `Rp ${total.toLocaleString("id-ID")}`
            },
            fallback: [
                "🧾 *Draft Gaji Dibuat Otomatis*",
                "",
                "Periode: ${periode}",
                "Teknisi: ${daftar} (${jumlah} orang)",
                "Total gaji pokok: ${total}",
                "",
                "Ini BARU DRAFT — belum ada uang keluar dan belum ada struk terkirim.",
                "Buka halaman Gaji Teknisi untuk finalisasi lalu tandai dibayar."
            ].join("\n")
        });
    } catch (error) {
        console.error("[GAJI_TETAP_NOTIF_ERROR]", error.message);
    }
}

module.exports = {
    ensureTable,
    listPlans,
    savePlans,
    setAutoDraft,
    setelan,
    createDraftsForPeriod,
    getUnpaidPayrolls,
    periodeDari
};
