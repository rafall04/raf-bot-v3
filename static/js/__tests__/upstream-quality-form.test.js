/**
 * Header Doc
 * Purpose: Mengunci bahwa kendali BARU di halaman /upstream-quality benar-benar tersambung ke API
 *          (#b267) — bukan sekadar ada di markup. Kontrol yang terlihat tapi tak mengirim apa pun
 *          lebih buruk daripada tak ada: operator mengira setelannya tersimpan.
 * Caller: Jest test runner.
 * Deps: sumber `static/js/upstream-quality.js` + `views/sb-admin/upstream-quality.php`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const repoRoot = path.join(__dirname, "..", "..", "..");
const js = fs.readFileSync(path.join(repoRoot, "static", "js", "upstream-quality.js"), "utf8");
const php = fs.readFileSync(path.join(repoRoot, "views", "sb-admin", "upstream-quality.php"), "utf8");

describe("#b267 — target: nama awam & multi-alamat bisa diatur", () => {
    test("markup punya kolom Nama awam dan menjelaskan alamat dipisah koma", () => {
        expect(php).toMatch(/Nama awam/);
        expect(php).toMatch(/pisahkan koma/i);
    });

    test("form mengirim `addresses` (array), bukan satu `address`", () => {
        // Server menerima `addresses`; mengirim string tunggal akan membuang IP tambahan.
        expect(js).toMatch(/addresses: String\(t\.address \|\| ""\)\.split\(","\)/);
        expect(js).toMatch(/simpanKonfig\(\{ targets: barisTarget \}/);
    });

    test("nilai lama ditampilkan sebagai daftar, bukan hanya alamat pertama", () => {
        expect(js).toMatch(/Array\.isArray\(t\.addresses\) && t\.addresses\.length \? t\.addresses : \[t\.address\]/);
    });

    test("namaAwam ikut dirender & dikirim", () => {
        expect(js).toMatch(/\{ name: "namaAwam", value: t\.namaAwam \|\| "" \}/);
        expect(js).toMatch(/namaAwam: t\.namaAwam/);
    });
});

describe("#b267 — blok kestabilan tersambung", () => {
    test("semua 12 setelan punya kendali di markup", () => {
        ["kabariPelanggan", "alarmAdmin", "lossPeringatanPct", "lossBurukPct",
            "jitterPeringatanMs", "jitterBurukMs", "windowMinutes", "minSampel",
            "siklusBeruntun", "cooldownMinutes", "minTargetSepakat", "traceCount"].forEach((f) => {
            expect(php).toContain(`data-f="${f}"`);
        });
    });

    test("form diisi dari server dan dikirim balik sebagai patch `stabilitas`", () => {
        expect(js).toMatch(/function isiFormStabilitas\(d\)/);
        expect(js).toMatch(/simpanKonfig\(\{ stabilitas: patch \}/);
    });

    test("checkbox dikirim sebagai boolean, angka sebagai Number", () => {
        // Mengirim "on"/"" akan lolos validator sebagai truthy dan menyalakan gerbang yang salah.
        expect(js).toMatch(/if \(el\.type === "checkbox"\) patch\[f\] = el\.checked;/);
        expect(js).toMatch(/patch\[f\] = Number\(el\.value\)/);
    });
});

describe("#b267 — pemilih jalur alarm memakai daftar jalur NYATA", () => {
    test("kotak centang dibuat dari d.paths, bukan teks bebas", () => {
        // Teks bebas berarti salah ketik nama jalur diam-diam mematikan alarm untuk jalur itu.
        expect(js).toMatch(/\(d\.paths \|\| \[\]\)\.map\(function \(p\)/);
        expect(js).toMatch(/pilihJalur\("upq-cfg-alertpaths-list", d\.alertPaths\)/);
        expect(js).toMatch(/pilihJalur\("upq-cfg-alarmpaths-list", d\.alarmKestabilanPaths\)/);
    });

    test("keduanya dikirim terpisah — alert jalur-sakit ≠ alarm kestabilan", () => {
        expect(js).toMatch(/alertPaths: kumpulkanJalur\("upq-cfg-alertpaths-list"\)/);
        expect(js).toMatch(/alarmKestabilanPaths: kumpulkanJalur\("upq-cfg-alarmpaths-list"\)/);
    });
});

describe("#b267 — kartu jalur MENJELASKAN vonisnya", () => {
    test("target bermasalah ditandai, dan disebut berapa yang dibutuhkan", () => {
        // Tanpa ini admin melihat "NORMAL" sementara satu target merah, dan tak tahu apakah itu
        // diabaikan dengan benar atau justru terlewat.
        expect(js).toMatch(/report\.minTargetSepakat/);
        expect(js).toMatch(/masalah <b>tujuan itu<\/b>, bukan jalur ini/);
        expect(js).toMatch(/target sepakat bermasalah/);
    });

    test("layanan ber-banyak-alamat ditampilkan jumlah alamatnya", () => {
        expect(js).toContain("Array.isArray(t.alamat) && t.alamat.length > 1");
        expect(js).toContain('" alamat)</span>"');
    });
});
