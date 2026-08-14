/**
 * Header Doc
 * Purpose: Mengunci perilaku helper escaping bersama dan memastikan pola lama yang cacat
 *          (`textContent -> innerHTML`) tak kembali masuk ke static/js.
 * Caller: Jest test runner.
 * Deps: `../html-escape`, pemindaian berkas `static/js/*.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: pola `div.textContent = t; return div.innerHTML` disalin ke 12 berkas. Ia HANYA
 * meloloskan & < > — TIDAK " maupun '. Dipakai untuk atribut (`value="..."`) atau argumen
 * handler (`onclick="hapus(1,'...')"`), nama ber-apostrof seperti Ma'ruf/Nur'aini memutus
 * string JS: tombolnya DIAM TOTAL tanpa pesan galat, dan varian jahat benar-benar dieksekusi.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { rafEscapeHtml, rafEscapeJsString } = require("../html-escape");

const DIR_JS = path.join(__dirname, "..");

describe("rafEscapeHtml menutup SEMUA karakter berbahaya", () => {
    test.each([
        ["&", "&amp;"],
        ["<", "&lt;"],
        [">", "&gt;"],
        ['"', "&quot;"],
        ["'", "&#39;"],
        ["`", "&#96;"],
    ])("karakter %p di-escape jadi %p", (masukan, harapan) => {
        expect(rafEscapeHtml(masukan)).toBe(harapan);
    });

    test("nama ber-apostrof aman dipakai sebagai nilai atribut", () => {
        const hasil = rafEscapeHtml("Ma'ruf");

        expect(hasil).toBe("Ma&#39;ruf");
        expect(hasil).not.toContain("'");
    });

    test("percobaan keluar dari atribut ber-kutip-ganda ditutup", () => {
        const jahat = 'x" onfocus="alert(1)" autofocus="';
        const hasil = rafEscapeHtml(jahat);

        // Yang penting BUKAN hilangnya teks "onfocus=" — teks itu boleh tetap ada sebagai
        // teks biasa. Yang penting tak ada satu pun kutip yang bisa MENUTUP atribut, sehingga
        // `onfocus` tak pernah menjadi atribut sungguhan.
        expect(hasil).not.toContain('"');
        expect(hasil).not.toContain("'");
        expect(`<input value="${hasil}">`.match(/"/g)).toHaveLength(2);
    });

    test("tag script tidak lolos", () => {
        expect(rafEscapeHtml("<img src=x onerror=alert(1)>")).not.toMatch(/<img/);
    });

    test.each([null, undefined, "", 0, false])("nilai %p jadi string aman", (v) => {
        expect(typeof rafEscapeHtml(v)).toBe("string");
    });
});

describe("rafEscapeJsString aman untuk string literal", () => {
    test("apostrof di-escape, bukan dibiarkan memutus string", () => {
        expect(rafEscapeJsString("Nur'aini")).toBe("Nur\\'aini");
    });

    test("backslash didahulukan agar escape sendiri tak dobel", () => {
        expect(rafEscapeJsString("a\\b")).toBe("a\\\\b");
    });

    test("payload penutup-string-lalu-kode tak lagi bisa menutup string", () => {
        const jahat = "x'); fetch('/api/users/1',{method:'DELETE'}); //";
        const hasil = rafEscapeJsString(jahat);

        // SETIAP apostrof harus didahului backslash. Dievaluasi sungguhan: bila masih ada
        // yang lolos, string di bawah tak akan bisa di-parse dan `Function` melempar.
        expect(hasil).not.toMatch(/(^|[^\\])'/);
        expect(() => Function(`return '${hasil}';`)).not.toThrow();
        expect(Function(`return '${hasil}';`)()).toBe(jahat);
    });
});

describe("pola escaping lama tidak boleh kembali", () => {
    const berkasJs = fs
        .readdirSync(DIR_JS)
        .filter((f) => f.endsWith(".js") && f !== "html-escape.js")
        .filter((f) => fs.statSync(path.join(DIR_JS, f)).isFile());

    test("tak ada lagi `return div.innerHTML` sebagai mesin escaping", () => {
        const pelanggar = berkasJs.filter((f) => {
            const isi = fs.readFileSync(path.join(DIR_JS, f), "utf8");
            return /div\.textContent\s*=\s*[^;]+;\s*\n\s*return div\.innerHTML/.test(isi);
        });

        expect(pelanggar).toEqual([]);
    });

    test("tak ada lagi `.replace(/'/g, ...)` sesudah escaping — trik yang tak pernah cocok", () => {
        // Setelah escape tak ada `'` mentah tersisa, jadi replace-nya no-op; sementara parser
        // HTML men-decode `&#39;` kembali jadi `'` SEBELUM JS di-parse.
        //
        // Diperiksa PER BARIS dan komentar dibuang: pola `[^)]*` pada seluruh isi berkas
        // melintasi baris dan menghasilkan positif palsu (versi pertama tes ini menuduh 3
        // berkas, padahal satu-satunya kemunculan ada di komentar penjelasan).
        const pelanggar = [];
        for (const f of berkasJs) {
            const isi = fs.readFileSync(path.join(DIR_JS, f), "utf8");
            isi.split(/\r?\n/).forEach((baris, i) => {
                const kode = baris.replace(/\/\/.*$/, "");
                if (/esc(?:apeHtml)?\([^)\n]*\)\.replace\(\/'\/g/.test(kode)) {
                    pelanggar.push(`${f}:${i + 1}`);
                }
            });
        }

        expect(pelanggar).toEqual([]);
    });
});

describe("konfirmasi-bayar memakai data-* + delegasi, bukan onclick inline", () => {
    const src = fs.readFileSync(path.join(DIR_JS, "konfirmasi-bayar.js"), "utf8");

    test("tombol aksi tidak lagi menyisipkan nama ke dalam onclick", () => {
        expect(src).not.toMatch(/onclick="konfirmasiBukti/);
        expect(src).not.toMatch(/onclick="tolakBukti/);
        expect(src).not.toMatch(/onclick="hapusBukti/);
    });

    test("nilai dibawa lewat atribut data-*", () => {
        expect(src).toMatch(/data-aksi="konfirmasi"/);
        expect(src).toMatch(/data-nama="/);
    });

    test("ada satu listener terdelegasi di kontainer daftar", () => {
        expect(src).toMatch(/pasangDelegasiAksi/);
        expect(src).toMatch(/addEventListener\("click"/);
        expect(src).toMatch(/closest\("\[data-aksi\]"\)/);
    });
});

describe("helper dimuat untuk semua halaman", () => {
    test("_head.php memuat html-escape.js lewat rafAssetUrl", () => {
        const head = fs.readFileSync(
            path.join(DIR_JS, "..", "..", "views", "sb-admin", "_head.php"),
            "utf8"
        );

        expect(head).toMatch(/rafAssetUrl\('\/js\/html-escape\.js'\)/);
    });
});
