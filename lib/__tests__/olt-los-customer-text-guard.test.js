/**
 * Header Doc
 * Purpose: Mengunci bahwa pesan gangguan/pulih OLT yang dibaca PELANGGAN tak pernah memuat
 *          alamat perangkat di jaringan (MAC / slot / ONU) maupun identitas internal lain.
 * Caller: Jest test runner.
 * Deps: `lib/customer-text-guard.js`, sumber `lib/olt-los-broadcaster.js`,
 *       `routes/admin-los-broadcast-routes.js`, `views/sb-admin/los-broadcast.php`.
 * MainFuncs: —
 * SideEffects: Tidak ada (hanya membaca sumber + memanggil fungsi murni).
 *
 * KENAPA ADA — perakit pesan PELANGGAN dulu mengisi slot `{mac}` / `{slot}` / `{onu}`, dan
 * halaman /los-broadcast MENGIKLANKANNYA ("Placeholder: … {mac}, {slot}, {onu} …"). Terukur di
 * produksi 2026-08-16: jalur notifikasi pelanggan ini SUDAH HIDUP di RAF-TANJUNGHARJO
 * (`notifyCustomer.enabled = true`), sedangkan template saat itu kebetulan masih bersih. Jadi
 * kebocoran hanya berjarak SATU EDIT ADMIN — edit yang justru disarankan halaman itu sendiri.
 * Dan karena config produksi di-merge-key (tak pernah ditimpa deploy), template yang terlanjur
 * memuatnya akan bertahan selamanya.
 *
 * Penjaganya (`lib/customer-text-guard.js`) sudah lama ada dan komentarnya bahkan menyebut
 * `{mac}`/`{slot}`/`{onu}` — tapi satu-satunya pemakainya adalah broadcast admin.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { findCustomerTextLeaks } = require("../customer-text-guard");

const AKAR = path.join(__dirname, "..", "..");
const srcBroadcaster = fs.readFileSync(path.join(AKAR, "lib", "olt-los-broadcaster.js"), "utf8");
const srcRoute = fs.readFileSync(path.join(AKAR, "routes", "admin-los-broadcast-routes.js"), "utf8");
const srcHalaman = fs.readFileSync(path.join(AKAR, "views", "sb-admin", "los-broadcast.php"), "utf8");

describe("penjaga dipasang di jalur pesan PELANGGAN", () => {
    test("broadcaster memuat penjaga teks pelanggan", () => {
        expect(srcBroadcaster).toMatch(/require\(["']\.\/customer-text-guard["']\)/);
        expect(srcBroadcaster).toMatch(/amankanTeksPelanggan/);
    });

    test("pesan GANGGUAN ke pelanggan dilewatkan penjaga sebelum dikirim", () => {
        expect(srcBroadcaster).toMatch(/amankanTeksPelanggan\(buildCustomerMessage\(/);
    });

    test("pesan PULIH ke pelanggan juga dilewatkan penjaga", () => {
        expect(srcBroadcaster).toMatch(/amankanTeksPelanggan\(buildCustomerRecoveryMessage\(/);
    });
});

describe("fallback amankanTeksPelanggan sadar-konteks (#b319)", () => {
    const blok = srcBroadcaster.slice(
        srcBroadcaster.indexOf("function amankanTeksPelanggan"),
        srcBroadcaster.indexOf("function amankanTeksPelanggan") + 1600
    );
    test("fallback GANGGUAN mengisi {penanganan} (tak kirim slot mentah ke pelanggan)", () => {
        expect(blok).toMatch(/\{penanganan\\?\}\/g,\s*buildPenangananNote/);
    });
    test("fallback membedakan recovery vs gangguan (recovery pakai template PULIH, bukan GANGGUAN)", () => {
        expect(blok).toMatch(/opts\.isRecovery/);
        expect(blok).toMatch(/DEFAULT_CUSTOMER_RECOVERY_TEMPLATE/);
    });
    test("call site PULIH menandai isRecovery:true (agar fallback tak jadi pesan gangguan)", () => {
        const i = srcBroadcaster.indexOf("amankanTeksPelanggan(buildCustomerRecoveryMessage(");
        expect(i).toBeGreaterThan(-1);
        expect(srcBroadcaster.slice(i, i + 170)).toMatch(/isRecovery:\s*true/);
    });
});

describe("slot alamat perangkat tak lagi diisi untuk pelanggan", () => {
    test("{mac}/{slot}/{onu} dikosongkan, bukan diisi nilainya", () => {
        const blok = srcBroadcaster.slice(
            srcBroadcaster.indexOf("function buildCustomerMessage"),
            srcBroadcaster.indexOf("function amankanTeksPelanggan")
        );
        expect(blok).toMatch(/\{mac\\?\}\/g,\s*""/);
        expect(blok).toMatch(/\{slot\\?\}\/g,\s*""/);
        expect(blok).toMatch(/\{onu\\?\}\/g,\s*""/);
        // Bentuk lama yang membocorkan nilainya tak boleh kembali.
        expect(blok).not.toMatch(/incident\.mac \|\| portStr/);
    });

    test("halaman admin tak lagi mengiklankan slot berbahaya", () => {
        const blokPelanggan = srcHalaman.slice(
            srcHalaman.indexOf("Template Pesan ke Pelanggan"),
            srcHalaman.indexOf("Simpan Notifikasi Pelanggan")
        );
        expect(blokPelanggan).toMatch(/\{customer_name\}/);
        expect(blokPelanggan).not.toMatch(/<code>\{mac\}<\/code>/);
        expect(blokPelanggan).not.toMatch(/<code>\{slot\}<\/code>/);
        expect(blokPelanggan).not.toMatch(/<code>\{onu\}<\/code>/);
    });
});

describe("template berbahaya ditolak saat DISIMPAN, bukan hanya saat dikirim", () => {
    // Menjaga hanya saat kirim tidak cukup: config produksi di-merge-key, jadi template
    // berbahaya yang terlanjur tersimpan bertahan selamanya dan tiap kirim cuma menghasilkan
    // peringatan berulang tanpa ada yang memperbaikinya.
    test("rute simpan memanggil penjaga untuk kedua template pelanggan", () => {
        expect(srcRoute).toMatch(/require\(["']\.\.\/lib\/customer-text-guard["']\)/);
        expect(srcRoute).toMatch(/messageTemplate/);
        expect(srcRoute).toMatch(/recoveryMessageTemplate/);
        expect(srcRoute).toMatch(/status:\s*400/);
    });
});

describe("penjaga benar-benar menjaring yang dimaksud", () => {
    const BOCOR = [
        "Koneksi terganggu di perangkat {mac}",
        "ONU Anda di slot {slot}/onu {onu} bermasalah",
        "Gangguan pada ODP MAWAR-03",
        "Ada 96 pelanggan terdampak",
        "{jumlah} pelanggan terdampak gangguan ini",
        "Akun {username_pppoe} sedang terganggu",
    ];
    test.each(BOCOR)("terjaring: %p", (teks) => {
        expect(findCustomerTextLeaks(teks).length).toBeGreaterThan(0);
    });

    const AMAN = [
        "Halo Kak Budi, koneksi internet di lokasi Kakak lagi terganggu. Tim kami sudah cek ya.",
        "Halo Kak {customer_name}, koneksi sudah normal kembali. Terima kasih sudah menunggu.",
        "Alamat {address} sedang kami tangani.",
        "— {company_name}",
    ];
    test.each(AMAN)("lolos (memang aman): %p", (teks) => {
        expect(findCustomerTextLeaks(teks)).toHaveLength(0);
    });

    test("template bawaan pesan pelanggan & pesan pulih bersih", () => {
        const ambil = (nama) => {
            const i = srcBroadcaster.indexOf(`const ${nama} =`);
            return srcBroadcaster.slice(i, srcBroadcaster.indexOf(";", i));
        };
        for (const nama of ["DEFAULT_CUSTOMER_TEMPLATE", "DEFAULT_CUSTOMER_RECOVERY_TEMPLATE"]) {
            expect(findCustomerTextLeaks(ambil(nama))).toHaveLength(0);
        }
    });
});
