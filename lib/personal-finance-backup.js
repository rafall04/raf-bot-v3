/**
 * Header Doc
 * Purpose: Backup LOKAL berkala untuk data keuangan pribadi (`personal_finance.sqlite` +
 *          `personal_finance_auth.json`). Ada karena dua hal yang saling mengunci:
 *          DB ini SENGAJA dikeluarkan dari backup Telegram (tujuannya grup multi-anggota,
 *          lihat lib/telegram-backup) — akibatnya satu kesalahan bisa menghapusnya PERMANEN.
 *          Terbukti 2026-07-23: catatan pemilik ikut terhapus oleh skrip pembersih data uji,
 *          dan tak ada satu pun salinan untuk memulihkannya.
 *          Salinan TIDAK PERNAH meninggalkan server — itu justru syaratnya.
 * Caller: `lib/cron/*` (dipanggil terjadwal) dan bisa manual lewat `jalankanBackupDompet()`.
 * Deps: `fs`, `path`, `./env-config.getDatabasePath`, `./sqlite-pragmas.hotBackupSqlite`
 *       (salinan aman tanpa menyentuh koneksi DB live).
 * MainFuncs: `jalankanBackupDompet`, `daftarBackup`, `pulihkanDari`.
 * SideEffects: Menulis/memangkas berkas di `backups/keuangan-pribadi/`.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { getDatabasePath } = require("./env-config");
const { hotBackupSqlite } = require("./sqlite-pragmas");

/** Simpan 30 salinan terakhir — cukup untuk sadar & memulihkan, tak membengkakkan disk. */
const SIMPAN_MAKS = 30;

function dirBackup() {
    return path.join(__dirname, "..", "backups", "keuangan-pribadi");
}

function stempel(date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
        `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
    );
}

/** Daftar salinan yang ada, terbaru dulu. */
function daftarBackup() {
    const dir = dirBackup();
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.startsWith("personal_finance_") && f.endsWith(".sqlite"))
        .sort()
        .reverse()
        .map((f) => {
            const p = path.join(dir, f);
            const st = fs.statSync(p);
            return { nama: f, path: p, ukuran: st.size, waktu: st.mtime.toISOString() };
        });
}

function pangkas() {
    const semua = daftarBackup();
    for (const b of semua.slice(SIMPAN_MAKS)) {
        try {
            fs.unlinkSync(b.path);
            // Kredensial pendamping dinamai sama; ikut dibuang supaya tak jadi yatim.
            const auth = b.path.replace(/\.sqlite$/, ".auth.json");
            if (fs.existsSync(auth)) fs.unlinkSync(auth);
        } catch (e) {
            console.warn("[PF_BACKUP] gagal memangkas", b.nama, e.message);
        }
    }
}

/**
 * Jalankan satu siklus backup. NON-THROWING: kegagalan backup tak boleh menjatuhkan cron
 * atau proses bot — cukup dicatat.
 * @returns {Promise<{ok:boolean, berkas?:string, alasan?:string}>}
 */
async function jalankanBackupDompet() {
    try {
        const sumber = getDatabasePath("personal_finance.sqlite");
        if (!fs.existsSync(sumber)) {
            return { ok: false, alasan: "belum ada data dompet" };
        }

        const dir = dirBackup();
        fs.mkdirSync(dir, { recursive: true });

        // Nama WAJIB unik. Stempel hanya beresolusi DETIK, dan `pulihkanDari` mengambil
        // salinan pengaman tepat sebelum menimpa — dua backup dalam detik yang sama akan
        // saling menimpa, sehingga salinan pengaman (DB yang mau ditimpa) menghapus justru
        // backup yang sedang dipulihkan. Terjadi saat pengujian pertama fungsi ini.
        const dasar = `personal_finance_${stempel()}`;
        let nama = `${dasar}.sqlite`;
        let n = 1;
        while (fs.existsSync(path.join(dir, nama))) {
            nama = `${dasar}-${n++}.sqlite`;
        }
        const tujuan = path.join(dir, nama);

        // hotBackupSqlite: salin AMAN saat DB sedang dipakai. Menyalin file mentah dengan
        // fs.copyFile bisa menghasilkan berkas rusak bila ada transaksi berjalan.
        await hotBackupSqlite(sumber, tujuan);

        // Kredensial ikut disalin — memulihkan catatan tapi kehilangan sandi tetap saja
        // membuat pemiliknya terkunci di luar.
        const auth = path.join(path.dirname(sumber), "personal_finance_auth.json");
        if (fs.existsSync(auth)) {
            fs.copyFileSync(auth, tujuan.replace(/\.sqlite$/, ".auth.json"));
        }

        try {
            fs.chmodSync(tujuan, 0o600);
        } catch (_e) {
            /* filesystem tanpa dukungan mode — abaikan */
        }

        pangkas();
        return { ok: true, berkas: nama };
    } catch (e) {
        console.error("[PF_BACKUP] gagal:", e.message);
        return { ok: false, alasan: e.message };
    }
}

/**
 * Pulihkan dari sebuah salinan. Sengaja MEMBACKUP DULU keadaan sekarang sebelum menimpa —
 * memulihkan salinan yang keliru tak boleh menghapus satu-satunya versi yang benar.
 */
async function pulihkanDari(namaBerkas) {
    const asal = path.join(dirBackup(), path.basename(String(namaBerkas || "")));
    if (!fs.existsSync(asal)) throw new Error("Berkas backup tidak ditemukan");

    await jalankanBackupDompet(); // jaring pengaman sebelum menimpa
    const tujuan = getDatabasePath("personal_finance.sqlite");
    fs.copyFileSync(asal, tujuan);
    return { ok: true, dari: path.basename(asal), ke: tujuan };
}

module.exports = { jalankanBackupDompet, daftarBackup, pulihkanDari, SIMPAN_MAKS };
