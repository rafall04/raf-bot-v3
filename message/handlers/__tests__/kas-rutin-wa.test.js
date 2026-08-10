"use strict";

/**
 * Header Doc
 * Purpose: Mengunci perintah BIAYA RUTIN + RINGKASAN UANG di WhatsApp. Sebelumnya biaya rutin
 *   hanya bisa dibuat dari halaman — pemilik yang sedang di lapangan tak punya jalan.
 *   Yang paling mahal kalau salah: TANGGAL. `kas rutin tambah 850rb listrik 20` ambigu
 *   ("tanggal 20" vs judul "listrik 20"), dan salah tebak menghasilkan tagihan yang jatuh
 *   tempo di hari yang keliru SETIAP BULAN, diam-diam. Karena itu tanggal wajib eksplisit.
 * Caller: Jest (`npx jest message/handlers/__tests__/kas-rutin-wa.test.js`).
 * Deps: `lib/business-expense-service` (parser murni), `message/handlers/business-expense-wa`
 *       dengan dependensi disuntik (tak menyentuh DB/WA).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

const { parseBusinessExpenseCommand } = require("../../../lib/business-expense-service");
const { handleBusinessExpenseCommand, GERBANG_RE } = require("../business-expense-wa");

describe("parser `kas rutin`", () => {
    test("melihat daftar", () => {
        expect(parseBusinessExpenseCommand("kas rutin")).toEqual({ action: "rutin_list" });
        expect(parseBusinessExpenseCommand("kas rutin lihat")).toEqual({ action: "rutin_list" });
    });

    test("menambah dengan tanggal eksplisit — termasuk nominal gaya Indonesia", () => {
        expect(parseBusinessExpenseCommand("kas rutin tambah 850rb listrik dander tgl 20")).toMatchObject({
            action: "rutin_tambah", amount: 850000, nama: "listrik dander", tanggal: 20
        });
        expect(parseBusinessExpenseCommand("kas rutin tambah 2,5jt internet upstream tanggal 5")).toMatchObject({
            action: "rutin_tambah", amount: 2500000, tanggal: 5
        });
    });

    test("kategori ditebak dari namanya, memakai daftar TETAP expense-manager", () => {
        expect(parseBusinessExpenseCommand("kas rutin tambah 850rb listrik tgl 20").category).toBe("internet_utilities");
        expect(parseBusinessExpenseCommand("kas rutin tambah 500rb sewa tower tgl 1").category).toBe("operasional");
    });

    test("TANGGAL WAJIB — tanpa penanda, ditolak (bukan ditebak)", () => {
        expect(parseBusinessExpenseCommand("kas rutin tambah 850rb listrik")).toEqual({
            action: "unknown", reason: "rutin_tanggal_wajib"
        });
        // Angka bebas di akhir TIDAK boleh diam-diam jadi tanggal.
        expect(parseBusinessExpenseCommand("kas rutin tambah 850rb listrik 20")).toEqual({
            action: "unknown", reason: "rutin_tanggal_wajib"
        });
    });

    test("masukan tak masuk akal ditolak dengan alasan spesifik", () => {
        expect(parseBusinessExpenseCommand("kas rutin tambah abc listrik tgl 20").reason).toBe("rutin_nominal_tidak_terbaca");
        expect(parseBusinessExpenseCommand("kas rutin tambah 850rb tgl 20").reason).toBe("rutin_nama_kosong");
        expect(parseBusinessExpenseCommand("kas rutin tambah 850rb listrik tgl 99").reason).toBe("rutin_tanggal_tidak_valid");
        expect(parseBusinessExpenseCommand("kas rutin hapus").reason).toBe("rutin_id_tidak_valid");
    });

    test("menghapus", () => {
        expect(parseBusinessExpenseCommand("kas rutin hapus 3")).toEqual({ action: "rutin_hapus", id: 3 });
    });

    test("perintah kas lama TIDAK berubah", () => {
        expect(parseBusinessExpenseCommand("kas 150rb kabel dropcore")).toMatchObject({ action: "add", amount: 150000 });
        expect(parseBusinessExpenseCommand("kas bulan")).toMatchObject({ action: "report", scope: "month" });
        expect(parseBusinessExpenseCommand("kas batal 12")).toEqual({ action: "cancel", id: 12 });
    });
});

describe("perintah ringkasan `uang`", () => {
    test("berdiri sendiri (`omset`) maupun berprefiks (`kas ringkasan`)", () => {
        expect(parseBusinessExpenseCommand("omset")).toEqual({ action: "ringkasan" });
        expect(parseBusinessExpenseCommand("kas ringkasan")).toEqual({ action: "ringkasan" });
        expect(parseBusinessExpenseCommand("kas uang")).toEqual({ action: "ringkasan" });
    });

    test("`uang` TELANJANG tetap milik dompet pribadi — pemisahan yang disengaja", () => {
        // Satu kata yang berarti dua hal tergantung grup adalah kebingungan paling mahal
        // di jalur uang. Bentuk berprefiks `kas uang` tetap tersedia dan tak mungkin ambigu.
        expect(parseBusinessExpenseCommand("uang").reason).toBe("bukan_perintah_kas");
        expect(parseBusinessExpenseCommand("dompet").reason).toBe("bukan_perintah_kas");
    });

    test("`rekap` TIDAK berubah arti — tetap laporan pengeluaran hari ini", () => {
        expect(parseBusinessExpenseCommand("kas rekap")).toMatchObject({ action: "report", scope: "day" });
    });

    test("gerbang raf.js melewatkannya", () => {
        expect(GERBANG_RE.test("omset")).toBe(true);
        expect(GERBANG_RE.test("kas ringkasan")).toBe(true);
        // Obrolan biasa tetap tidak lolos.
        expect(GERBANG_RE.test("besok jadi ke lokasi?")).toBe(false);
    });
});

describe("handler biaya rutin — menumpang penyimpanan yang SAMA dengan halaman", () => {
    function rutinPalsu(state = []) {
        return {
            listAll: async () => state,
            periodeSekarang: () => "2026-08",
            tertunda: async () => [],
            simpan: async (d) => {
                const row = { id: state.length + 1, ...d, kategori: d.kategori, perkiraan: d.perkiraan };
                state.push(row);
                return row;
            },
            hapus: async (id) => {
                const i = state.findIndex((r) => Number(r.id) === Number(id));
                if (i === -1) return { dihapus: false };
                state.splice(i, 1);
                return { dihapus: true };
            }
        };
    }

    test("tambah memanggil recurring-expense, bukan menulis sendiri", async () => {
        const state = [];
        const rutin = rutinPalsu(state);
        let balasan = "";
        const hasil = await handleBusinessExpenseCommand({
            chats: "kas rutin tambah 850rb listrik tgl 20",
            reply: async (t) => { balasan = String(t); },
            actor: "Uji",
            deps: { recurring: rutin }
        });

        expect(hasil.handled).toBe(true);
        expect(state).toHaveLength(1);
        expect(state[0]).toMatchObject({ nama: "listrik", perkiraan: 850000, tanggal: 20 });
        expect(balasan).toMatch(/850/);
        expect(balasan).not.toMatch(/\$\{[a-zA-Z0-9_]+\}/);
    });

    test("gagal validasi dilaporkan APA ADANYA, bukan pesan generik", async () => {
        let balasan = "";
        const rutin = rutinPalsu();
        rutin.simpan = async () => { throw new Error("Kategori tidak valid"); };
        await handleBusinessExpenseCommand({
            chats: "kas rutin tambah 850rb listrik tgl 20",
            reply: async (t) => { balasan = String(t); },
            deps: { recurring: rutin }
        });
        expect(balasan).toMatch(/Kategori tidak valid/);
    });

    test("hapus tidak menghapus pengeluaran yang sudah tercatat (dikatakan ke pengguna)", async () => {
        const state = [{ id: 3, nama: "Listrik", perkiraan: 850000, tanggal: 20, kategori: "internet_utilities", aktif: 1 }];
        let balasan = "";
        await handleBusinessExpenseCommand({
            chats: "kas rutin hapus 3",
            reply: async (t) => { balasan = String(t); },
            deps: { recurring: rutinPalsu(state) }
        });
        expect(state).toHaveLength(0);
        expect(balasan).toMatch(/TIDAK ikut terhapus/i);
    });

    test("tanggal yang belum ditulis dijawab dengan cara memperbaikinya", async () => {
        let balasan = "";
        await handleBusinessExpenseCommand({
            chats: "kas rutin tambah 850rb listrik",
            reply: async (t) => { balasan = String(t); },
            deps: { recurring: rutinPalsu() }
        });
        expect(balasan).toMatch(/tgl 20/);
    });
});

describe("bantuan menyebut perintah baru — fitur yang tak disebut = tak ada", () => {
    test("teks bantuan memuat kas rutin dan perintah ringkasan", () => {
        const src = baca("message", "handlers", "business-expense-wa.js");
        expect(src).toMatch(/kas rutin tambah/);
        expect(src).toMatch(/\*omset\*/);
        expect(src).toMatch(/kas ringkasan/);
    });
});
