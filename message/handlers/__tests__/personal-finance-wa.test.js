/**
 * Header Doc
 * Purpose: Mengunci GERBANG KEPEMILIKAN dompet pribadi. Ini bukan tes kenyamanan — kalau gate
 *          ini bocor, catatan keuangan pribadi pemilik bisa dibaca pelanggan atau admin lain
 *          dari nomor bot bisnis. Menegaskan: gagal-tertutup, TIDAK memakai config.ownerNumber,
 *          dan @lid tak pernah lolos tanpa didaftarkan eksplisit.
 * Caller: Jest.
 * Deps: `message/handlers/personal-finance-wa`.
 * MainFuncs: -
 * SideEffects: Tidak ada (repository di-stub).
 */
"use strict";

const { resolvePersonalFinanceOwner, handlePersonalFinanceCommand, TRIGGER_RE } = require("../personal-finance-wa");

const OWNER = "6281234567890@s.whatsapp.net";
const cfgAktif = { personalFinance: { enabled: true, ownerJids: [OWNER] } };

describe("TRIGGER_RE — tanpa prefix", () => {
    test("menangkap perintah dompet di awal pesan", () => {
        for (const t of ["keluar 50rb bensin", "masuk 2jt gaji", "uang", "uang bulan", "  Uang Bantuan", "KELUAR 10rb"]) {
            expect(TRIGGER_RE.test(t)).toBe(true);
        }
    });

    test("kalimat pelanggan biasa TIDAK memicu", () => {
        for (const t of [
            "wifi saya mati",
            "untuk apa ya",
            "bayar tagihan bulan ini",
            "beli voucher 5rb",
            "lapor gangguan dong",
            "minta uang kembali", // kata pemicu di TENGAH kalimat tak boleh menghitung
            "keluarga saya banyak" // "keluar" hanya sebagai awalan kata → \b mencegahnya
        ]) {
            expect(TRIGGER_RE.test(t)).toBe(false);
        }
    });
});

describe("resolvePersonalFinanceOwner — gagal-tertutup", () => {
    test("pemilik terdaftar dikenali lewat JID persis", () => {
        expect(resolvePersonalFinanceOwner({ participant: OWNER, plainPhone: "6281234567890", config: cfgAktif })).toEqual({
            via: "jid"
        });
    });

    test("dikenali lewat nomor walau format JID beda", () => {
        const r = resolvePersonalFinanceOwner({
            participant: "6281234567890@c.us",
            plainPhone: "6281234567890",
            config: cfgAktif
        });
        expect(r).toEqual({ via: "nomor" });
    });

    test("nomor LAIN ditolak", () => {
        expect(
            resolvePersonalFinanceOwner({
                participant: "6289999999999@s.whatsapp.net",
                plainPhone: "6289999999999",
                config: cfgAktif
            })
        ).toBeNull();
    });

    test("daftar pemilik kosong → tak ada yang lolos", () => {
        const cfg = { personalFinance: { enabled: true, ownerJids: [] } };
        expect(resolvePersonalFinanceOwner({ participant: OWNER, plainPhone: "6281234567890", config: cfg })).toBeNull();
    });

    test("config tak ada sama sekali → tak ada yang lolos", () => {
        expect(resolvePersonalFinanceOwner({ participant: OWNER, plainPhone: "6281234567890", config: {} })).toBeNull();
        expect(resolvePersonalFinanceOwner({})).toBeNull();
    });

    test("SENGAJA tidak memakai config.ownerNumber — owner bisnis bukan pemilik dompet pribadi", () => {
        const cfg = { ownerNumber: [OWNER], personalFinance: { enabled: true, ownerJids: [] } };
        expect(resolvePersonalFinanceOwner({ participant: OWNER, plainPhone: "6281234567890", config: cfg })).toBeNull();
    });

    test("@lid ditolak kecuali didaftarkan di ownerLids", () => {
        const lid = "12345678901234@lid";
        // Angka di @lid BUKAN nomor HP — walau mirip, tak boleh dicocokkan ke ownerJids.
        expect(resolvePersonalFinanceOwner({ participant: lid, plainPhone: "6281234567890", config: cfgAktif })).toBeNull();

        const cfgLid = { personalFinance: { enabled: true, ownerJids: [OWNER], ownerLids: [lid] } };
        expect(resolvePersonalFinanceOwner({ participant: lid, plainPhone: "", config: cfgLid })).toEqual({ via: "lid" });
    });
});

describe("handlePersonalFinanceCommand", () => {
    function buatRepo() {
        return {
            entries: [],
            addEntry: jest.fn(async function (e) {
                const row = { id: 1, tanggal: "2026-07-23", ...e };
                this.entries.push(row);
                return row;
            }),
            summary: jest.fn(async () => ({ masuk: 0, keluar: 50000, selisih: -50000, jumlahCatatan: 1, perKategori: [] })),
            listEntries: jest.fn(async () => []),
            getEntry: jest.fn(async () => ({ id: 1, amount: 50000, note: "bensin", category: "transport" })),
            deleteEntry: jest.fn(async () => ({ deleted: true }))
        };
    }

    test("catat pengeluaran → simpan + balas", async () => {
        const repo = buatRepo();
        const reply = jest.fn();
        const hasil = await handlePersonalFinanceCommand({
            chats: "keluar 50rb bensin",
            reply,
            config: cfgAktif,
            repository: repo
        });

        expect(hasil).toEqual({ handled: true });
        expect(repo.addEntry).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "out", amount: 50000, category: "transport", note: "bensin", source: "wa" })
        );
        expect(reply).toHaveBeenCalledTimes(1);
        expect(String(reply.mock.calls[0][0])).toMatch(/50\.000/);
    });

    test("nominal ngawur TIDAK pernah tersimpan", async () => {
        const repo = buatRepo();
        const reply = jest.fn();
        await handlePersonalFinanceCommand({ chats: "keluar banyak", reply, config: cfgAktif, repository: repo });

        expect(repo.addEntry).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledTimes(1);
    });

    test("`uang bantuan` → kartu bantuan, tanpa menulis apa pun", async () => {
        const repo = buatRepo();
        const reply = jest.fn();
        await handlePersonalFinanceCommand({ chats: "uang bantuan", reply, config: cfgAktif, repository: repo });

        expect(repo.addEntry).not.toHaveBeenCalled();
        const teks = String(reply.mock.calls[0][0]);
        expect(teks).toMatch(/keluar 50rb bensin/i);
        expect(teks).not.toMatch(/#U/); // prefix lama tak boleh muncul lagi di panduan
    });

    test("hapus catatan memanggil repository dan mengonfirmasi", async () => {
        const repo = buatRepo();
        const reply = jest.fn();
        await handlePersonalFinanceCommand({ chats: "uang hapus 1", reply, config: cfgAktif, repository: repo });

        expect(repo.deleteEntry).toHaveBeenCalledWith(1);
        expect(String(reply.mock.calls[0][0])).toMatch(/1/);
    });

    test("laporan bulanan tidak menulis apa pun", async () => {
        const repo = buatRepo();
        const reply = jest.fn();
        await handlePersonalFinanceCommand({ chats: "uang bulan 2026-06", reply, config: cfgAktif, repository: repo });

        expect(repo.addEntry).not.toHaveBeenCalled();
        expect(repo.summary).toHaveBeenCalledWith({ from: "2026-06-01", to: "2026-06-30" });
    });

    test("rekap hari ini lewat `uang` polos", async () => {
        const repo = buatRepo();
        const reply = jest.fn();
        await handlePersonalFinanceCommand({ chats: "uang", reply, config: cfgAktif, repository: repo });

        expect(repo.addEntry).not.toHaveBeenCalled();
        expect(repo.listEntries).toHaveBeenCalled();
    });
});
