/**
 * Header Doc
 * Purpose: Mengunci penjaga upload bersama — segmen path dari request tak bisa keluar dari
 *          `uploads/`, dan ekstensi berkas tak bisa ditentukan pengunggah. Sekaligus menjaga
 *          agar KETIGA jalur upload benar-benar memakainya.
 * Caller: Jest test runner.
 * Deps: `../upload-guard`, pemindaian `routes/api-psb-routes.js`, `routes/tickets-shared.js`,
 *       `routes/public.js`.
 * MainFuncs: `jalankanDestination`.
 * SideEffects: Membuat direktori upload untuk kasus yang SAH (di bawah uploads/), lalu dibiarkan
 *              — sama seperti perilaku produksi.
 *
 * KENAPA ADA: #b229 menutup traversal `ticketId` pada SATU jalur upload dengan menambal di
 * tempat. Audit ulang menemukan cacat yang PERSIS SAMA masih terbuka di jalur PSB (tanpa penjaga
 * sama sekali), di storage KEDUA berkas yang sama (helper dipanggil tanpa try/catch), dan di
 * jalur laporan pelanggan. Menambal instans, bukan kelasnya, membuat lubang yang sama muncul
 * lagi tiga kali.
 *
 * DAMPAK: peran STAF TERENDAH (teknisi) bisa menimpa `static/js/html-escape.js` — dimuat
 * `views/sb-admin/_head.php` di SETIAP halaman — sehingga skripnya berjalan di sesi admin.
 * Varian `.php` menimpa `views/sb-admin/404.php` yang dieksekusi PHP CLI lewat `res.render`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { ekstensiGambarAman, buatDestinationAman } = require("../upload-guard");

const AKAR = path.resolve(__dirname, "..", "..");

// Menjalankan fungsi destination buatan penjaga, mengembalikan {error, dir}.
function jalankanDestination(segmen, namespace = "psb") {
    const destination = buatDestinationAman({
        namespace,
        currentDir: path.join(AKAR, "routes"),
        ambilSegmen: () => segmen,
    });

    return new Promise((resolve) => {
        destination({}, { originalname: "x.png" }, (error, dir) =>
            resolve({ error: error || null, dir: dir || null })
        );
    });
}

const MUATAN_TRAVERSAL = [
    "../../../../static/js",
    "../../../../views/sb-admin",
    "..",
    "../",
    "a/../../b",
    "..\\..\\windows",
    "/etc/passwd",
    "C:\\Windows\\Temp",
    "tiket/../../keluar",
];

describe("segmen traversal ditolak, bukan dibersihkan diam-diam", () => {
    test.each(MUATAN_TRAVERSAL)("segmen %p ditolak", async (jahat) => {
        const { error, dir } = await jalankanDestination(jahat);

        expect(error).toBeTruthy();
        expect(dir).toBeNull();
    });

    test.each([null, undefined, "", "a b", "a.php"])("segmen %p ditolak", async (jahat) => {
        const { error } = await jalankanDestination(jahat);
        expect(error).toBeTruthy();
    });

    test("tak ada direktori di luar uploads/ yang terbuat", async () => {
        const sasaran = [
            path.join(AKAR, "static", "js"),
            path.join(AKAR, "views", "sb-admin"),
        ];
        const sebelum = sasaran.map((p) => fs.existsSync(p));

        for (const jahat of MUATAN_TRAVERSAL) {
            await jalankanDestination(jahat);
        }

        // Direktori itu memang sudah ada; yang penting penjaga TAK PERNAH mengembalikannya
        // sebagai tujuan tulis (diuji di kasus-kasus di atas: error != null, dir == null).
        expect(sasaran.map((p) => fs.existsSync(p))).toEqual(sebelum);
    });

    test("segmen sah diterima dan tetap DI DALAM uploads/", async () => {
        const { error, dir } = await jalankanDestination("TEMP1755000000000");

        expect(error).toBeNull();
        const akarUploads = path.join(AKAR, "uploads", "psb");
        expect(path.resolve(dir).startsWith(path.resolve(akarUploads) + path.sep)).toBe(true);
    });
});

describe("ekstensi berkas tidak boleh ditentukan pengunggah", () => {
    test.each([
        ["pwn.php", ".jpg"],
        ["x.js", ".jpg"],
        ["a.html", ".jpg"],
        ["b.svg", ".jpg"],
        ["c.phtml", ".jpg"],
        ["tanpa-ekstensi", ".jpg"],
        ["", ".jpg"],
    ])("nama %p -> %p", (nama, harapan) => {
        expect(ekstensiGambarAman(nama)).toBe(harapan);
    });

    test.each([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic"])(
        "ekstensi gambar %p dipertahankan",
        (ext) => {
            expect(ekstensiGambarAman(`foto${ext}`)).toBe(ext);
        }
    );

    test("huruf besar dinormalkan", () => {
        expect(ekstensiGambarAman("FOTO.PNG")).toBe(".png");
    });
});

describe("ketiga jalur upload benar-benar memakai penjaga bersama", () => {
    const baca = (f) => fs.readFileSync(path.join(AKAR, f), "utf8");

    test.each([
        ["routes/api-psb-routes.js", "psbStorage"],
        ["routes/tickets-shared.js", "createTicketPhotoStorage"],
        ["routes/public.js", "reportPhotoStorage"],
    ])("%s (%s)", (berkas) => {
        const src = baca(berkas);

        expect(src).toMatch(/require\('\.\.\/lib\/upload-guard'\)/);
        expect(src).toMatch(/buatDestinationAman\(/);
        expect(src).toMatch(/ekstensiGambarAman\(/);
    });

    test("tak ada lagi path.join dengan segmen request mentah di jalur upload PSB", () => {
        const src = baca("routes/api-psb-routes.js");

        // Pola lama: path.join(__dirname, '../uploads/psb', year, month, tempId)
        expect(src).not.toMatch(/path\.join\([^)]*uploads\/psb[^)]*tempId/);
    });

    test("nama berkas PSB dari allowlist, bukan dari fieldname mentah", () => {
        const src = baca("routes/api-psb-routes.js");
        const blok = src.slice(src.indexOf("filename: function"), src.indexOf("const psbUpload"));

        expect(blok).toMatch(/FIELD_SAH/);
        expect(blok).toMatch(/ktp_photo/);
        expect(blok).not.toMatch(/path\.extname\(file\.originalname\)/);
    });
});
