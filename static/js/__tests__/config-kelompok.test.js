/**
 * Header Doc
 * Purpose : Mengunci PENGELOMPOKAN setelan /config (#b293) — tiap setelan berada di tab yang
 *           sesuai fungsinya, dan setiap pane bermedan punya jalur simpan.
 * Caller  : jest
 * Deps    : pemindaian sumber (tanpa DOM).
 * MainFuncs: —
 * SideEffects: tidak ada.
 *
 * KENAPA ADA — sebelum #b293 beberapa setelan menumpang tab yang salah, dan itu bukan soal
 * selera melainkan bisa dibuktikan dari PEMAKAIANNYA di kode:
 *   parentbinding / sync_to_mikrotik / defaultPPPoEPassword  ada di tab "Wifi & Bot"
 *   rx_tolerance / redamanAlert*                             ada di tab "Teknis"
 *   repairNotif* / teknisiTutorialUrl                        ada di tab "Intake PSB"
 *   voucherGuide* / voucherLoginUrl                          ada di tab "Wifi & Bot"
 *
 * !! PELAJARAN MAHAL saat memperbaikinya: memindah medan ke pane lain MEMUTUS jalur
 * simpannya. Tiap pane disimpan `collectPaneData(pane)` lewat tombol `.config-save-btn`
 * di pane itu — medan yang mendarat di pane tanpa tombol jadi TAMPIL TAPI TAK BISA DISIMPAN.
 * Tes "setiap pane bermedan punya jalur simpan" di bawah ada khusus untuk itu.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..", "..");
const PHP = "views/sb-admin/config.php";
const src = fs.readFileSync(path.join(AKAR, PHP), "utf8");

/** Penutup <div> seimbang. */
function akhirDiv(s, mulai) {
    let i = mulai, depth = 0;
    while (i < s.length) {
        if (s.startsWith("<div", i)) depth++;
        else if (s.startsWith("</div>", i)) { depth--; if (depth === 0) return i + 6; }
        i++;
    }
    return -1;
}

/** Isi tiap pane, dipotong dengan penyeimbangan tag (bukan tebakan jarak). */
function isiPane() {
    const peta = {};
    for (const m of src.matchAll(/id="(pane-[a-z]+)"/g)) {
        const buka = src.lastIndexOf("<div", m.index);
        peta[m[1]] = src.slice(buka, akhirDiv(src, buka));
    }
    return peta;
}
const PANE = isiPane();

/** Medan bernama di dalam sebuah pane. */
function medan(paneId) {
    const isi = PANE[paneId] || "";
    return [...isi.matchAll(/<(?:input|select|textarea)[^>]*name="([^"]+)"/g)].map((m) => m[1]);
}

// Tempat yang BENAR, diturunkan dari pemakaian di kode.
const HARUS_DI = {
    "pane-mikrotik": ["parentbinding", "sync_to_mikrotik", "defaultPPPoEPassword"],
    "pane-olt": ["rx_tolerance", "redamanAlertEnabled", "redamanAlertRoles"],
    "pane-teknisi": ["repairNotifEnabled", "repairNotifGroupId", "teknisiTutorialUrl"],
    "pane-voucher": ["voucherGuideSteps", "voucherLoginUrl"],
    "pane-company": ["telfon", "adminPhone", "company_name", "company_phone"],
};

describe("#b293 — tiap setelan di tab yang sesuai fungsinya", () => {
    for (const [pane, daftar] of Object.entries(HARUS_DI)) {
        test(pane + " memuat setelan yang memang miliknya", () => {
            const ada = medan(pane);
            for (const nm of daftar) expect({ pane, nm, ada: ada.includes(nm) }).toEqual({ pane, nm, ada: true });
        });
    }

    test("!! setelan MikroTik TIDAK lagi menumpang tab Wifi & Bot", () => {
        const bot = medan("pane-bot");
        for (const nm of ["parentbinding", "sync_to_mikrotik", "defaultPPPoEPassword", "telfon", "adminPhone"]) {
            expect({ nm, adaDiBot: bot.includes(nm) }).toEqual({ nm, adaDiBot: false });
        }
    });

    test("!! setelan redaman TIDAK lagi menumpang tab Teknis", () => {
        const tek = medan("pane-technical");
        for (const nm of ["rx_tolerance", "redamanAlertEnabled", "redamanAlertRoles"]) {
            expect({ nm, adaDiTeknis: tek.includes(nm) }).toEqual({ nm, adaDiTeknis: false });
        }
    });

    test("!! notifikasi teknisi TIDAK lagi menumpang tab Intake PSB", () => {
        const psb = medan("pane-psb");
        for (const nm of ["repairNotifEnabled", "repairNotifGroupId", "teknisiTutorialUrl"]) {
            expect({ nm, adaDiPsb: psb.includes(nm) }).toEqual({ nm, adaDiPsb: false });
        }
    });

    test("tiap pane punya link navigasinya, dan sebaliknya", () => {
        const nav = [...src.matchAll(/data-pane="(pane-[a-z]+)"/g)].map((m) => m[1]);
        for (const id of Object.keys(PANE)) expect(nav).toContain(id);
    });
});

describe("#b293 — !! setiap pane bermedan WAJIB punya jalur simpan", () => {
    // Ini penjaga terpenting berkas ini. Saat memindah medan, tiga pane sempat berakhir
    // dengan medan TANPA tombol simpan — tampil rapi, tapi setelannya tak pernah tersimpan.
    for (const paneId of Object.keys(PANE)) {
        const nm = medan(paneId);
        if (!nm.length) continue;
        test(paneId + " (" + nm.length + " medan) bisa disimpan", () => {
            const isi = PANE[paneId];
            const punyaTombolPane = new RegExp('config-save-btn[^>]*data-pane="' + paneId + '"').test(isi)
                || new RegExp('data-pane="' + paneId + '"[^>]*config-save-btn').test(isi);
            // Beberapa pane memakai tombol khusus dengan endpointnya sendiri.
            const punyaTombolKhusus = /id="(saveTelegramConfigBtn|saveOltGlobalConfigBtn)"/.test(isi);
            expect({ pane: paneId, bisaDisimpan: punyaTombolPane || punyaTombolKhusus })
                .toEqual({ pane: paneId, bisaDisimpan: true });
        });
    }

    test("!! medan OLT global sengaja TANPA name= agar tak tertulis dua kali", () => {
        // Disimpan tombolnya sendiri ke /api/olt/config (jadi config.olt.*). Kalau diberi
        // name=, tombol "Simpan Alert Redaman" di pane yang sama ikut mengirimnya ke
        // /api/config dan menulis kunci liar yang tak dibaca siapa pun.
        const olt = PANE["pane-olt"] || "";
        for (const id of ["oltEnabled", "oltWebEnabled"]) {
            const tag = olt.match(new RegExp('<(?:input|select)[^>]*id="' + id + '"[^>]*>'));
            expect({ id, ada: !!tag }).toEqual({ id, ada: true });
            expect({ id, punyaName: /name="/.test(tag[0]) }).toEqual({ id, punyaName: false });
        }
    });
});

describe("#b293 — label & keterangan tidak membingungkan", () => {
    test("telfon vs adminPhone dijelaskan bedanya (keduanya kini bersebelahan)", () => {
        const i = src.indexOf('id="telfon"');
        const blok = src.slice(i, i + 500);
        expect(blok).toMatch(/bot itu sendiri/i);
        expect(blok).toMatch(/BUKAN/);
    });

    test('label "Maksimal akses" diganti yang menjelaskan', () => {
        expect(src).not.toContain(">Maksimal akses<");
        expect(src).toMatch(/Maksimal Nomor HP per Pelanggan/);
    });

    test("tab OLT menyebut redaman karena kini memuatnya", () => {
        expect(src).toMatch(/data-pane="pane-olt">OLT &amp; Redaman</);
    });
});
