/**
 * Header Doc
 * Purpose : GUARD struktur menu admin (#b300) — tak ada halaman jatuh dari menu, dan daftar
 *           `isParentActive` tiap sub-menu selalu cocok dengan item yang benar-benar ada
 *           di dalamnya.
 * Caller  : jest
 * Deps    : pemindaian views/sb-admin/_navbar.php (tanpa DOM).
 * MainFuncs: bacaMenu()
 * SideEffects: tidak ada.
 *
 * !! TEMUAN "MENU BERCAMPUR" DI LAPORAN AUDIT SAYA OVERSTATED. Saya menulis grup
 * "Operasional memuat 23 halaman dan isinya bercampur". Setelah strukturnya dibaca benar:
 * menunya sudah DUA TINGKAT dengan 13 sub-menu bernama jelas, dan ke-23 halaman itu
 * terpisah rapi di [Pelanggan] · [Pembayaran] · [Layanan]. Bukan grab bag.
 * Yang benar-benar salah kamar hanya DUA, dan itulah yang dipindah — bukan merombak
 * 13 sub-menu yang sudah bekerja.
 *
 * !! JEBAKAN YANG DIJAGA TES INI: `isParentActive([...])` muncul TIGA KALI per sub-menu
 * (pada <li>, <a>, dan <div>). Memindahkan item tanpa memperbarui ketiganya membuat menu
 * berhenti menyoroti halaman yang sedang dibuka — regresi yang tak terlihat sampai
 * seseorang mengeluh "menunya tidak menandai saya di mana".
 */
"use strict";

const fs = require("fs");
const path = require("path");

const AKAR = path.join(__dirname, "..", "..");
const NAV = fs.readFileSync(path.join(AKAR, "views/sb-admin/_navbar.php"), "utf8");

/**
 * Rute yang ditulis sebagai VARIABEL PHP, bukan literal.
 *
 * !! Menu Tiket dirender `href="<?php echo $ticketPagePath; ?>"`. Pembaca yang hanya
 * mencari `href="/..."` literal akan menyimpulkan halaman itu TIDAK ADA di menu — dan
 * saya sempat menyimpulkan persis itu, lalu hampir melaporkannya sebagai halaman tak
 * terjangkau. Nilainya diresolusi dari deklarasinya di berkas yang sama.
 */
const VAR_RUTE = {};
for (const m of NAV.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*'(\/[a-z0-9/_.:-]+)'\s*;/g)) {
    VAR_RUTE["$" + m[1]] = m[2];
}

/** Sub-menu: {id, label, item[]} + item tingkat atas. */
function bacaMenu() {
    const baris = NAV.split("\n");
    const sub = [];
    const atas = [];
    let s = null;
    for (let i = 0; i < baris.length; i++) {
        if (/sidebar-heading/.test(baris[i])) { s = null; continue; }
        const c = baris[i].match(/data-target="#(collapse[A-Za-z0-9]+)"/);
        if (c) {
            let label = "";
            for (let j = i; j < Math.min(i + 5, baris.length); j++) {
                const m = baris[j].match(/<span>([^<]+)<\/span>/);
                if (m) { label = m[1].replace(/&amp;/g, "&").trim(); break; }
            }
            s = { id: c[1], label, item: [] };
            sub.push(s);
            continue;
        }
        // href pada baris ber-collapse-item (PHP di tengah atribut memutus [^>]*).
        // Literal ATAU variabel PHP — lihat catatan VAR_RUTE di atas.
        if (/collapse-item/.test(baris[i]) && s) {
            const a = baris[i].match(/href="(\/[a-z0-9/_.:-]+)"/);
            // Bentuk nyatanya dibungkus htmlspecialchars():
            //   href="<?php echo htmlspecialchars($ticketPagePath, ENT_QUOTES, 'UTF-8'); ?>"
            // jadi variabelnya dicari di mana pun di dalam blok <?php … ?> milik href itu.
            const v = baris[i].match(/href="<\?[^"]*?(\$[A-Za-z_][A-Za-z0-9_]*)/);
            const rute = a ? a[1] : (v ? VAR_RUTE[v[1]] : null);
            if (rute && !s.item.includes(rute)) s.item.push(rute);
            continue;
        }
        if (/nav-link/.test(baris[i]) && !/data-toggle/.test(baris[i])) {
            const d = baris[i].match(/href="(\/[a-z0-9/_.:-]+)"/);
            if (d && !atas.includes(d[1])) atas.push(d[1]);
        }
    }
    return { sub, atas, semua: [...atas, ...sub.flatMap((x) => x.item)] };
}
const MENU = bacaMenu();

/** Semua daftar isParentActive beserta isinya. */
function daftarAktif() {
    return [...NAV.matchAll(/isParentActive\(\[([^\]]*)\]/g)]
        .map((m) => m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, "")).filter(Boolean));
}

describe("#b300 — tak ada halaman jatuh dari menu", () => {
    test("menu memuat jumlah halaman yang diharapkan", () => {
        // Angka tetap: kalau berubah, seseorang menambah/menghapus item dan harus sadar.
        expect(MENU.semua.length).toBe(72);
    });

    test("tak ada rute kembar di seluruh menu", () => {
        const hitung = {};
        MENU.semua.forEach((r) => { hitung[r] = (hitung[r] || 0) + 1; });
        expect(Object.entries(hitung).filter(([, n]) => n > 1)).toEqual([]);
    });

    test("tiap sub-menu punya id collapse yang unik", () => {
        const id = MENU.sub.map((s) => s.id);
        expect(id.length).toBe(new Set(id).size);
    });
});

describe("#b300 — dua halaman pindah ke sub-menu yang sesuai fungsinya", () => {
    const cari = (rute) => (MENU.sub.find((s) => s.item.includes(rute)) || {}).id;

    test("/saldo-management ada di [Agen & Reseller], bukan [Keuangan]", () => {
        // Endpoint-nya: /api/saldo/agents, /api/saldo/agent-topup, /api/agents/list —
        // seluruhnya saldo AGEN, bukan pembukuan usaha.
        expect(cari("/saldo-management")).toBe("collapseAgen");
    });

    test("/sisa-pppoe ada di [Pelanggan], bukan [Pengaturan]", () => {
        // GET /api/users/orphan-pppoe = "secret PPPoE yang tak lagi punya baris pelanggan".
        // Rekonsiliasi data pelanggan, bukan setelan sistem.
        expect(cari("/sisa-pppoe")).toBe("collapsePelanggan");
    });
});

describe("#b300 — daftar isParentActive cocok dengan isi sub-menunya", () => {
    test("!! tiap sub-menu punya TIGA daftar identik (li, a, div)", () => {
        // Kalau salah satu tertinggal saat item dipindah, menu berhenti menyoroti
        // halaman yang sedang dibuka — regresi senyap.
        const semua = daftarAktif();
        for (const s of MENU.sub) {
            if (!s.item.length) continue;
            const cocok = semua.filter((d) => d.length === s.item.length && s.item.every((r) => d.includes(r)));
            expect({ submenu: s.id, jumlahDaftarCocok: cocok.length }).toEqual({ submenu: s.id, jumlahDaftarCocok: 3 });
        }
    });

    test("!! [Infrastruktur] menyebut /rapikan-odp", () => {
        // Cacat yang SUDAH ADA sebelum pekerjaan ini, ditemukan justru oleh tes di atas:
        // sub-menunya berisi 5 item tapi daftar sorotannya cuma menyebut 4.
        const semua = daftarAktif();
        expect(semua.some((d) => d.includes("/rapikan-odp"))).toBe(true);
    });

    test("!! tak ada daftar isParentActive yang menyebut rute di luar sub-menunya", () => {
        // Sisa rute lama setelah pemindahan akan membuat DUA menu tersorot sekaligus.
        const semua = daftarAktif();
        const sah = new Set(MENU.semua);
        const nakal = [];
        for (const d of semua) {
            for (const r of d) if (!sah.has(r)) nakal.push(r);
        }
        expect([...new Set(nakal)]).toEqual([]);
    });
});

describe("#b300 — nama berkas yang beda dari rutenya dipetakan balik", () => {
    /*
     * !! JEBAKAN php-express: halaman dirender lewat PHP CLI tanpa $_SERVER['REQUEST_URI'],
     * jadi `$current_page` diturunkan dari NAMA BERKAS (argv). Untuk rute yang nama
     * berkasnya berbeda, menunya TIDAK PERNAH tersorot — admin kehilangan jejak posisinya.
     * TERUKUR di peramban sebelum perbaikan: ketiganya item menu ADA tapi active=false
     * dan sub-menunya tidak terbuka.
     */
    const WAJIB = {
        "/tiket": "/admin/daftar-tiket",
        "/owner-cockpit": "/owner",
        "/bulk-ssid-diff": "/penyesuaian-bulk",
    };

    test("tabel alias ada di _navbar.php", () => {
        expect(NAV).toMatch(/\$ALIAS_BERKAS_KE_RUTE\s*=\s*\[/);
    });

    for (const [berkas, rute] of Object.entries(WAJIB)) {
        test("alias " + berkas + " -> " + rute, () => {
            const re = new RegExp("'" + berkas + "'\\s*=>\\s*'" + rute + "'");
            expect({ berkas, ada: re.test(NAV) }).toEqual({ berkas, ada: true });
        });
    }

    test("!! tiap rute alias benar-benar ada di menu", () => {
        // Alias yang menunjuk rute yang tak ada di menu = salah ketik yang tak terlihat.
        for (const rute of Object.values(WAJIB)) {
            expect({ rute, adaDiMenu: MENU.semua.includes(rute) }).toEqual({ rute, adaDiMenu: true });
        }
    });
});
