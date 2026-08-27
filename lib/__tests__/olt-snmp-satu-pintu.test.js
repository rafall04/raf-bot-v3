/**
 * Header Doc
 * Purpose : Menjaga agar SNMP ke OLT hanya bisa dipanggil lewat SATU pintu (#b275):
 *           `lib/olt-optical-resolver.ambilDataOlt`. SNMP membuat OLT hang, dan pemanggilan
 *           langsung yang menyelinap kembali tidak akan terlihat sampai OLT-nya diam.
 *           Penjaga ini MEMINDAI repo — bukan daftar manual yang ikut basi.
 * Caller  : jest
 * Deps    : pemindaian berkas
 * MainFuncs: -
 * SideEffects: tidak ada
 */
const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");

// Satu-satunya berkas yang BOLEH memanggil SNMP langsung:
//  - olt-hioso.js          : implementasinya sendiri
//  - olt-optical-resolver.js: pintu tunggal (ambilDataOlt) yang memilih web/snmp
//  - olt-drivers/*         : adaptor merk yang didelegasikan olt-hioso
const DIIZINKAN = [
    path.join("lib", "olt-hioso.js"),
    path.join("lib", "olt-optical-resolver.js"),
    path.join("lib", "olt-drivers"),
    path.join("lib", "olt-snmp-los-poller.js"),   // khusus ZTE (losViaSnmp), tak start di Hioso
    path.join("lib", "olt-rxpower-poller.js"),    // gate sendiri, DIMATIKAN di produksi (#b274)
    path.join("lib", "olt-snmp-health.js"),      // OID ZTE enterprise; pemanggilnya kini dikunci merk=zte
];

function berkasJs(dir, keluar = []) {
    if (!fs.existsSync(dir)) return keluar;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".git", "__tests__", "tmp", "dist", ".worktrees", "backups"].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) berkasJs(p, keluar);
        else if (e.name.endsWith(".js")) keluar.push(p);
    }
    return keluar;
}

function pelanggar(pola) {
    const hasil = [];
    const daftar = [
        ...berkasJs(path.join(AKAR, "lib")),
        ...berkasJs(path.join(AKAR, "routes")),
        ...berkasJs(path.join(AKAR, "services")),
        ...berkasJs(path.join(AKAR, "message")),
    ];
    for (const f of daftar) {
        const rel = path.relative(AKAR, f);
        if (DIIZINKAN.some((izin) => rel === izin || rel.startsWith(izin + path.sep))) continue;
        const src = fs.readFileSync(f, "utf8");
        for (const baris of src.split(String.fromCharCode(10))) {
            const bersih = baris.trim();
            if (bersih.startsWith("*") || bersih.startsWith("//")) continue;   // komentar bukan panggilan
            if (pola.test(bersih)) { hasil.push(rel + ": " + bersih.slice(0, 90)); break; }
        }
    }
    return hasil;
}

describe("#b275 — SNMP ke OLT hanya lewat satu pintu", () => {
    test("tak ada pemanggilan getMultipleOltData di luar pintu tunggal", () => {
        // Kalau tes ini merah: salurkan lewat `ambilDataOlt` (lib/olt-optical-resolver),
        // jangan menambah nama ke daftar izin — daftarnya untuk implementasi, bukan pemakai.
        expect(pelanggar(/getMultipleOltData\s*\(/)).toEqual([]);
    });

    test("tak ada require('net-snmp') di luar pintu tunggal", () => {
        expect(pelanggar(/require\(['"]net-snmp['"]\)/)).toEqual([]);
    });

    test("penjaganya sendiri memang memindai sesuatu (bukan hijau palsu)", () => {
        // Pola yang PASTI ada di banyak berkas — kalau ini kosong, pemindainya yang rusak.
        expect(pelanggar(/require\(/).length).toBeGreaterThan(10);
    });
});
