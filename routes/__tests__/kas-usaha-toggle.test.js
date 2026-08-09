"use strict";

/**
 * Header Doc
 * Purpose: Mengunci "kas usaha bisa dinyalakan dari HALAMAN, bukan dari config.json". Sebelumnya
 *   halaman hanya MEMBERI TAHU "Fitur kas usaha masih OFF di config (businessExpense.enabled)"
 *   tanpa memberi cara menyalakannya — operator terpaksa menyunting `config.json` di server,
 *   berkas paling berbahaya untuk disentuh tangan (memuat kredensial gateway).
 *   Ikut dikunci: penulisan config HANYA menyentuh satu key, dan status di layar JUJUR soal syarat
 *   (aktif tanpa grup = pengingat tetap tak terkirim).
 * Caller: Jest (`npx jest routes/__tests__/kas-usaha-toggle.test.js`).
 * Deps: fs/path (scan statis route + view + js halaman).
 * MainFuncs: -
 * SideEffects: Tidak ada.
 */

const fs = require("fs");
const path = require("path");

const REPO = path.join(__dirname, "..", "..");
const baca = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");

const route = baca("routes", "admin-kas-usaha-routes.js");
const halaman = baca("views", "sb-admin", "kas-usaha.php");
const js = baca("static", "js", "kas-usaha.js");

describe("kas usaha: seluruh setelan bisa diubah dari halaman admin", () => {
    test("endpoint sakelar aktif tersedia", () => {
        expect(route).toMatch(/["']\/api\/kas-usaha\/aktif["']/);
    });

    test("SEMUA setelan punya endpointnya — tak ada yang tersisa hanya di config.json", () => {
        for (const jalur of [
            "/api/kas-usaha/aktif",
            "/api/kas-usaha/grup",
            "/api/kas-usaha/pemilik",
            "/api/kas-usaha/rutin",
            "/api/kas-usaha/rutin/:id"
        ]) {
            expect(route).toContain(jalur);
        }
    });

    test("penulisan config lewat SATU penulis, menambal key — bukan menimpa berkas", () => {
        expect(route).toMatch(/function tulisSetelan\(/);
        expect(route).toMatch(/Object\.assign\(isi\.businessExpense, tambalan\)/);
        // Tak boleh menulis ulang objek config dari nol.
        expect(route).not.toMatch(/writeFileSync\([^)]*JSON\.stringify\(\s*\{/);
        // Hanya satu tempat yang boleh menulis config di berkas ini.
        expect(route.match(/writeFileSync\(/g) || []).toHaveLength(1);
    });

    test("config in-memory ikut disegarkan — berlaku tanpa restart", () => {
        expect(route).toMatch(/Object\.assign\(cfg\.businessExpense, tambalan\)/);
    });

    test("balasan JUJUR: aktif tanpa grup/pemilik berarti bot belum bekerja", () => {
        const idx = route.indexOf("/api/kas-usaha/aktif");
        const blok = route.slice(idx, idx + 2000);
        expect(blok).toMatch(/grup kas belum dipilih/i);
        expect(blok).toMatch(/pemilik belum ditentukan/i);
    });

    test("SUKSES SEMU dicegah: menyalakan dari halaman menjadwalkan ulang cron pengingat", () => {
        // `initRecurringExpenseReminderTask` membaca `enabled` saat DIJADWALKAN, bukan saat
        // berbunyi. Tanpa panggilan ini layar bilang "aktif" tapi tak ada pengingat sampai restart.
        const idx = route.indexOf("/api/kas-usaha/aktif");
        const blok = route.slice(idx, idx + 2000);
        expect(blok).toMatch(/initRecurringExpenseReminderTask\(\)/);
        // Gagal menjadwalkan tak boleh menjatuhkan penyimpanan setelan.
        expect(blok).toMatch(/catch\s*\(/);
    });

    test("premis penjadwalan: cron memang membaca enabled saat init", () => {
        const cronSrc = baca("lib", "cron", "jobs", "recurring-expense-reminder.js");
        const idx = cronSrc.indexOf("function initRecurringExpenseReminderTask");
        const blok = cronSrc.slice(idx, idx + 700);
        expect(blok).toMatch(/cfg\.enabled !== true/);
        // Idempoten: aman dipanggil ulang dari endpoint.
        expect(blok).toMatch(/task\.stop\(\)/);
    });
});

describe("pemilik kas: dipilih dari halaman, @lid tak dikarang jadi nomor", () => {
    test("@lid disimpan apa adanya ke ownerLids — BUKAN diubah jadi 62<lid>", () => {
        const idx = route.indexOf("/api/kas-usaha/pemilik");
        const blok = route.slice(idx, idx + 2200);
        expect(blok).toMatch(/@lid\$\/i\.test\(v\)/);
        expect(blok).toMatch(/lids\.push\(v\)/);
    });

    test("nomor 08… dinormalkan ke 62… lalu jadi JID kanonik", () => {
        const idx = route.indexOf("/api/kas-usaha/pemilik");
        const blok = route.slice(idx, idx + 2200);
        expect(blok).toMatch(/startsWith\("0"\)/);
        expect(blok).toMatch(/@s\.whatsapp\.net/);
    });

    test("nomor tak masuk akal DITOLAK, bukan disimpan diam-diam", () => {
        // Gerbang pemilik gagal-tertutup: nomor salah = perintah diabaikan tanpa pesan error,
        // jadi kesalahannya harus ketahuan di halaman, bukan nanti di grup.
        const idx = route.indexOf("/api/kas-usaha/pemilik");
        const blok = route.slice(idx, idx + 2200);
        expect(blok).toMatch(/ditolak\.push/);
        expect(blok).toMatch(/status\(400\)/);
    });

    test("setelan memulangkan anggota grup supaya pemilik dipilih dari daftar", () => {
        expect(route).toMatch(/getGroupParticipants\(cfg\.groupId\)/);
        expect(route).toMatch(/peserta,?\n/);
        const adapter = baca("lib", "whatsapp.adapter.js");
        expect(adapter).toMatch(/async getGroupParticipants\(groupId\)/);
    });

    test("WA putus tak mematikan halaman — setelan tersimpan tetap terlihat", () => {
        const idx = route.indexOf("/api/kas-usaha/setelan");
        const blok = route.slice(idx, idx + 1400);
        expect(blok).toMatch(/waSiap = false/);
    });

    test("halaman & JS menyediakan daftar centang + kolom nomor manual", () => {
        expect(halaman).toMatch(/id="ku-pemilik"/);
        expect(halaman).toMatch(/id="ku-pemilik-manual"/);
        expect(js).toMatch(/\/api\/kas-usaha\/pemilik/);
        expect(js).toMatch(/ku-pemilik__cek:checked/);
    });

    test("pemilik di luar grup tetap tampil tercentang — pilihan lama tak hilang senyap", () => {
        expect(js).toMatch(/luarGrup/);
        expect(js).toMatch(/di luar grup/);
    });

    test("halaman TERJANGKAU dari sidebar — bukan cuma kalau URL-nya diketik", () => {
        // Halaman ini sempat yatim: rutenya terdaftar tapi tak ada satu pun tautan menu,
        // jadi operator tak punya cara menemukannya.
        const navbar = baca("views", "sb-admin", "_navbar.php");
        expect(navbar).toContain('href="/kas-usaha"');
        expect(navbar).toMatch(/Kas Usaha/);
        // Ikut disorot saat halamannya terbuka (induk menu Keuangan ikut membuka).
        expect(navbar).toMatch(/isActive\('\/kas-usaha', \$current_page\)/);
        expect(navbar).toMatch(/'\/pengeluaran', '\/kas-usaha'/);
    });

    test("halaman punya sakelarnya", () => {
        expect(halaman).toMatch(/id="ku-aktif"/);
        expect(halaman).toMatch(/Aktifkan kas usaha/i);
    });

    test("JS mengirim status sakelar & memulihkan posisinya saat gagal simpan", () => {
        expect(js).toMatch(/\/api\/kas-usaha\/aktif/);
        expect(js).toMatch(/JSON\.stringify\(\{\s*enabled:\s*mau\s*\}\)/);
        // Layar tak boleh berbohong: gagal simpan → sakelar dikembalikan.
        expect(js).toMatch(/sakelar\.checked\s*=\s*!mau/);
    });

    test("status di layar membedakan OFF, aktif-tanpa-grup, dan WA terputus", () => {
        expect(js).toMatch(/Kas usaha OFF/i);
        expect(js).toMatch(/grup kas belum dipilih/i);
        expect(js).toMatch(/WhatsApp belum terkoneksi/i);
    });
});
