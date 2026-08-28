/**
 * Header Doc
 * Purpose : GUARD medan formulir harus berada di modal yang MEMAKAINYA (#b294). Menguji
 *           views/sb-admin/users.php: tiap modal punya pasangan lengkap paid + metode bayar,
 *           dan tak ada medan `name="payment_method"` kembar dalam satu formulir.
 * Caller  : jest
 * Deps    : pemindaian sumber + pencocokan <div> berimbang (tanpa DOM/jsdom).
 * MainFuncs: modalYangMembungkus()
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — bug yang sudah terjadi dan TERBUKTI di peramban:
 *   `#create_payment_method` (medan untuk formulir TAMBAH) secara fisik berada di dalam
 *   `#editModal`. `static/js/users.js` membacanya lewat `$('#create_payment_method').val()`
 *   saat menambah pelanggan, sehingga selalu "" — medannya ada di modal yang tidak dibuka.
 *   Admin yang mencentang "Sudah membayar" ditolak dengan "Metode Pembayaran Wajib Dipilih"
 *   sambil tak punya medan untuk mengisinya. Mendaftarkan pelanggan lunas jadi BUNTU TOTAL.
 *
 *   Efek samping yang ikut terperbaiki: kedua <select> tadinya sama-sama di #editModal dan
 *   sama-sama `name="payment_method"`, jadi FormData formulir Ubah mengirim kunci itu DUA KALI.
 *
 * !! Pencocokan pakai <div> BERIMBANG, bukan "id terdekat sebelumnya". Waktu menelusuri bug ini
 * heuristik id-terdekat sempat menjawab `edit_device_id_modal` — tetangga, bukan pembungkus.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");
const BERKAS = "views/sb-admin/users.php";
const src = fs.readFileSync(path.join(AKAR, BERKAS), "utf8");

/** Indeks tepat setelah </div> penutup yang seimbang dengan <div> di `mulai`. */
function akhirDiv(s, mulai) {
    let i = mulai, depth = 0;
    while (i < s.length) {
        if (s.startsWith("<div", i)) depth++;
        else if (s.startsWith("</div>", i)) { depth--; if (depth === 0) return i + 6; }
        i++;
    }
    return -1;
}

/** id modal yang BENAR-BENAR membungkus elemen ber-id `idElemen` (null bila tak ada). */
function modalYangMembungkus(idElemen) {
    const target = src.indexOf('id="' + idElemen + '"');
    if (target < 0) return { ada: false, modal: null };
    for (const m of src.matchAll(/<div[^>]*id="([A-Za-z0-9_-]+)"[^>]*>/g)) {
        const akhir = akhirDiv(src, m.index);
        if (m.index < target && akhir > target && /modal/i.test(m[1])) {
            return { ada: true, modal: m[1] };
        }
    }
    return { ada: true, modal: null };
}

/** Isi utuh sebuah modal. */
function isiModal(id) {
    const i = src.indexOf('id="' + id + '"');
    if (i < 0) return "";
    const buka = src.lastIndexOf("<div", i);
    return src.slice(buka, akhirDiv(src, buka));
}

describe("#b294 — medan berada di modal yang memakainya", () => {
    test("!! #create_payment_method ada di #createModal, BUKAN #editModal", () => {
        expect(modalYangMembungkus("create_payment_method")).toEqual({ ada: true, modal: "createModal" });
    });

    test("#edit_payment_method ada di #editModal", () => {
        expect(modalYangMembungkus("edit_payment_method")).toEqual({ ada: true, modal: "editModal" });
    });

    test("centang 'sudah membayar' dan medan metodenya selalu satu modal", () => {
        // Inilah invariannya: users.js memvalidasi keduanya bersamaan, jadi kalau terpisah
        // modal, validasinya menuntut medan yang tak ada di layar.
        for (const [paid, metode] of [["create_paid", "create_payment_method"], ["edit_paid", "edit_payment_method"]]) {
            expect({ paid, modal: modalYangMembungkus(paid).modal })
                .toEqual({ paid, modal: modalYangMembungkus(metode).modal });
        }
    });
});

describe("#b294 — tak ada medan payment_method kembar dalam satu modal", () => {
    for (const id of ["createModal", "editModal"]) {
        test(id + " punya tepat satu name=\"payment_method\"", () => {
            const n = (isiModal(id).match(/name="payment_method"/g) || []).length;
            expect({ modal: id, jumlah: n }).toEqual({ modal: id, jumlah: 1 });
        });
    }
});

describe("#b294 — jalur baca di users.js tetap sesuai", () => {
    const js = fs.readFileSync(path.join(AKAR, "static/js/users.js"), "utf8");

    test("users.js masih membaca #create_payment_method untuk formulir tambah", () => {
        // Kalau id-nya diganti tanpa memindah medannya, tes di atas lolos tapi bug-nya balik.
        expect(js).toMatch(/isEditForm\s*\?\s*\$\('#edit_payment_method'\)\s*:\s*\$\('#create_payment_method'\)/);
    });

    test("rem 'metode wajib dipilih' TIDAK ikut hilang", () => {
        // Perbaikannya memindah medan, bukan melonggarkan validasi.
        expect(js).toContain("Metode Pembayaran Wajib Dipilih");
    });
});
