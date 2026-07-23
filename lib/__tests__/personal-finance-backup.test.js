/**
 * Header Doc
 * Purpose: Mengunci backup LOKAL dompet keuangan pribadi. Modul ini lahir karena kehilangan
 *          data NYATA (23-07-2026): DB dompet sengaja di luar backup Telegram, lalu satu skrip
 *          pembersih menghapus catatan pemilik dan tak ada apa pun untuk memulihkannya.
 *          Tes terpenting di sini: memulihkan tidak boleh MENGHANCURKAN salinan yang sedang
 *          dipulihkan — bug yang benar-benar terjadi pada percobaan pertama fungsi ini.
 * Caller: Jest.
 * Deps: `lib/personal-finance-backup`, `repositories/personal-finance.repository`, `fs`.
 * SideEffects: Membuat/menghapus DB + folder backup di direktori test.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const B = require("../personal-finance-backup");
const { createPersonalFinanceRepository } = require("../../repositories/personal-finance.repository");
const { getDatabasePath } = require("../env-config");

const dbPath = () => getDatabasePath("personal_finance.sqlite");
const backupDir = () => path.join(__dirname, "..", "..", "backups", "keuangan-pribadi");

function bersihkan() {
    try {
        fs.rmSync(backupDir(), { recursive: true, force: true });
    } catch (_e) {
        /* abaikan */
    }
    for (const s of ["", "-wal", "-shm"]) {
        try {
            fs.unlinkSync(dbPath() + s);
        } catch (_e) {
            /* abaikan */
        }
    }
}

describe("backup lokal dompet", () => {
    beforeEach(bersihkan);
    afterEach(bersihkan);

    test("tanpa DB → dilewati dengan alasan, bukan melempar", async () => {
        const r = await B.jalankanBackupDompet();
        expect(r.ok).toBe(false);
        expect(String(r.alasan)).toMatch(/belum ada data/i);
    });

    test("membuat salinan yang berisi data", async () => {
        const repo = createPersonalFinanceRepository();
        await repo.addEntry({ kind: "out", amount: 13000, category: "makan", note: "makan siang" });

        const hasil = await B.jalankanBackupDompet();
        expect(hasil.ok).toBe(true);
        expect(fs.existsSync(path.join(backupDir(), hasil.berkas))).toBe(true);
        expect(B.daftarBackup()).toHaveLength(1);
    });

    // INTI: bug nyata pada percobaan pertama. `pulihkanDari` mengambil salinan pengaman
    // lebih dulu; karena stempel hanya beresolusi DETIK, salinan pengaman (DB kosong)
    // MENIMPA backup yang sedang dipulihkan, lalu yang dikembalikan justru DB kosong itu.
    test("memulihkan TIDAK menghancurkan salinan sumbernya", async () => {
        const repo = createPersonalFinanceRepository();
        await repo.addEntry({ kind: "out", amount: 13000, category: "makan", note: "makan siang" });
        await repo.addEntry({ kind: "in", amount: 2000000, category: "gaji", note: "gaji" });

        const b = await B.jalankanBackupDompet();

        // Simulasikan penghapusan tak sengaja — persis yang terjadi di produksi.
        for (const e of await repo.listEntries({ limit: 500 })) {
            await repo.deleteEntry(e.id);
        }
        expect(await createPersonalFinanceRepository().listEntries({ limit: 500 })).toHaveLength(0);

        await B.pulihkanDari(b.berkas);

        const pulih = await createPersonalFinanceRepository().listEntries({ limit: 500 });
        expect(pulih).toHaveLength(2);
        expect(pulih.map((x) => x.note).sort()).toEqual(["gaji", "makan siang"]);
    });

    test("dua backup dalam detik yang sama tetap jadi dua berkas berbeda", async () => {
        const repo = createPersonalFinanceRepository();
        await repo.addEntry({ kind: "out", amount: 1000, category: "lain", note: "a" });

        const a = await B.jalankanBackupDompet();
        const c = await B.jalankanBackupDompet();
        expect(a.berkas).not.toBe(c.berkas);
        expect(B.daftarBackup()).toHaveLength(2);
    });

    test("memulihkan berkas yang tak ada ditolak jelas", async () => {
        await expect(B.pulihkanDari("tidak-ada.sqlite")).rejects.toThrow(/tidak ditemukan/i);
    });

    test("nama berkas dari luar tak bisa keluar folder backup", async () => {
        // basename() dipakai supaya "../../config.json" tak pernah jadi sumber pemulihan.
        await expect(B.pulihkanDari("../../config.json")).rejects.toThrow(/tidak ditemukan/i);
    });
});
