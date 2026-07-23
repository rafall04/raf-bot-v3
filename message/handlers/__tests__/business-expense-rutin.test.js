/**
 * Header Doc
 * Purpose: Menguji alur KONFIRMASI biaya rutin lewat WhatsApp dari ujung ke ujung: pengingat
 *          terkirim → balasan `ok` / `ok 620rb` / `lewati` → pengeluaran benar-benar tercatat
 *          (atau sengaja tidak).
 *          Sifat yang paling penting dijaga: kata "ok" TIDAK boleh mencatat apa pun kalau tak
 *          ada tagihan yang menunggu — grup ini juga dipakai bicara biasa.
 * Caller: Jest.
 * Deps: `message/handlers/business-expense-wa`, `lib/recurring-expense`, `lib/expense-manager`,
 *       `sqlite3` (DB sementara di memori).
 * SideEffects: Membuat `global.db` sementara; tidak menyentuh data nyata.
 */
"use strict";

const sqlite3 = require("sqlite3").verbose();
const be = require("../business-expense-wa");
const recurring = require("../../../lib/recurring-expense");
const em = require("../../../lib/expense-manager");

const TGL = new Date().getDate();

async function buatDanIngatkan(lebih = {}) {
    const it = await recurring.simpan({
        nama: "Listrik Dander",
        perkiraan: 500000,
        kategori: "internet_utilities",
        tanggal: TGL,
        metode: "TRANSFER",
        ...lebih
    });
    await recurring.tandaiDiingatkan(it.id);
    return it;
}

async function kirim(teks) {
    let balasan = null;
    const r = await be.handleBusinessExpenseCommand({
        chats: teks,
        reply: (t) => {
            balasan = t;
        },
        actor: "Uji"
    });
    return { balasan: String(balasan || ""), handled: r.handled };
}

describe("konfirmasi biaya rutin via WhatsApp", () => {
    beforeAll(async () => {
        global.db = new sqlite3.Database(":memory:");
        await recurring.ensureTable();
        await em.ensureExpenseTables();
    });

    afterAll(() => {
        if (global.db) global.db.close();
        global.db = null;
    });

    beforeEach(async () => {
        const kosongkan = (t) => new Promise((res, rej) => global.db.run(`DELETE FROM ${t}`, (e) => (e ? rej(e) : res())));
        await kosongkan("recurring_expenses");
        await kosongkan("expense_entries");
    });

    // INTI. Grup kas juga dipakai bicara biasa; "ok" yang diam-diam mencatat pengeluaran
    // akan mengotori pembukuan tanpa ada yang sadar.
    test("`ok` TIDAK mencatat apa pun bila tak ada tagihan menunggu", async () => {
        const r = await kirim("ok");
        expect(r.handled).toBe(false);
        expect(await em.listExpenses({ status: "active" })).toHaveLength(0);
    });

    test("`ok` mencatat sejumlah perkiraan bila tepat satu tagihan menunggu", async () => {
        await buatDanIngatkan();
        const r = await kirim("ok");

        expect(r.handled).toBe(true);
        expect(r.balasan).toMatch(/Listrik Dander/);
        const rows = await em.listExpenses({ status: "active" });
        expect(rows).toHaveLength(1);
        expect(rows[0].amount).toBe(500000);
    });

    test("`ok 620rb` memakai nominal sebenarnya dan menyebut selisihnya", async () => {
        await buatDanIngatkan();
        const r = await kirim("ok 620rb");

        expect((await em.listExpenses({ status: "active" }))[0].amount).toBe(620000);
        expect(r.balasan).toMatch(/620\.000/);
        expect(r.balasan).toMatch(/perkiraan/i); // memberi tahu bahwa nominalnya beda
    });

    test("`lewati` menuntaskan tanpa membuat pengeluaran", async () => {
        await buatDanIngatkan();
        const r = await kirim("lewati");

        expect(r.balasan).toMatch(/dilewati/i);
        expect(await em.listExpenses({ status: "active" })).toHaveLength(0);
        expect(await recurring.tertunda()).toHaveLength(0);
    });

    // Menebak salah = mencatat pengeluaran untuk pos yang keliru. Lebih baik bertanya.
    test("dua tagihan menunggu → bot MEMINTA nomor, tidak menebak", async () => {
        await buatDanIngatkan();
        await buatDanIngatkan({ nama: "Internet Upstream", kategori: "internet_utilities" });

        const r = await kirim("ok");
        expect(r.balasan).toMatch(/sebutkan nomornya/i);
        expect(r.balasan).toMatch(/Listrik Dander/);
        expect(r.balasan).toMatch(/Internet Upstream/);
        expect(await em.listExpenses({ status: "active" })).toHaveLength(0);
    });

    test("`ok <id> <nominal>` memilih tagihan yang tepat", async () => {
        await buatDanIngatkan();
        const kedua = await buatDanIngatkan({ nama: "Internet Upstream" });

        await kirim(`ok ${kedua.id} 1jt`);
        const rows = await em.listExpenses({ status: "active" });
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe("Internet Upstream");
        expect(rows[0].amount).toBe(1000000);
    });

    test("nomor yang tak menunggu ditolak jelas", async () => {
        await buatDanIngatkan();
        const r = await kirim("ok 999");
        expect(r.balasan).toMatch(/tidak ada tagihan tertunda/i);
        expect(await em.listExpenses({ status: "active" })).toHaveLength(0);
    });

    test("konfirmasi dua kali tak menghasilkan entri ganda", async () => {
        await buatDanIngatkan();
        await kirim("ok");
        const r2 = await kirim("ok");

        // Sesudah tuntas tak ada lagi yang menunggu → "ok" kedua bukan urusan modul ini.
        expect(r2.handled).toBe(false);
        expect(await em.listExpenses({ status: "active" })).toHaveLength(1);
    });

    test("perintah `kas` biasa tetap jalan berdampingan", async () => {
        await buatDanIngatkan();
        const r = await kirim("kas 75rb konektor");

        expect(r.handled).toBe(true);
        const rows = await em.listExpenses({ status: "active" });
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe("konektor");
        // Tagihan rutin TETAP menunggu — mencatat pengeluaran lain tak menuntaskannya.
        expect(await recurring.tertunda()).toHaveLength(1);
    });

    test("gerbang raf.js melewatkan balasan konfirmasi, bukan hanya perintah kas", () => {
        for (const t of ["kas 50rb bensin", "ok", "ok 620rb", "lewati", "skip"]) {
            expect(be.GERBANG_RE.test(t)).toBe(true);
        }
        for (const t of ["halo pak", "besok ya", "sudah dibayar"]) {
            expect(be.GERBANG_RE.test(t)).toBe(false);
        }
    });
});
