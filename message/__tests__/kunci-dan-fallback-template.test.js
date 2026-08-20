/**
 * Header Doc
 * Purpose: Dua guardrail dari #b251.
 *          (1) Kunci anti-kerja-dobel di `message/raf.js` hanya boleh dilepas oleh pemanggilan
 *              yang BENAR-BENAR mengambilnya. Cacat lama: penolakan duplikat ber-`return` dari
 *              DALAM `try`, sedangkan `finally` memanggil `clearProcessing` tanpa syarat — jadi
 *              pesan kembar yang ditolak justru MEMBUKA kunci pesan yang masih berjalan.
 *          (2) Fallback `renderResponseTemplate` yang memuat `${slot}` WAJIB template literal
 *              (backtick). Fallback dipulangkan APA ADANYA saat key absen / slot basi, jadi
 *              fallback berkutip biasa akan mengirim `${nama}` MENTAH ke pengguna.
 * Caller: Jest test runner.
 * Deps: `fs`, `path` — memindai source, tidak menjalankan handler.
 * MainFuncs: `bersihkanKomentar`, `kumpulkanFallbackBermasalah`.
 * SideEffects: Hanya membaca berkas.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "tmp", "dist", ".worktrees", "backups", "sessions", "__tests__"]);

// PELAJARAN LAMA: tes pemindai source pernah merah gara-gara pola yang disebut di dalam KOMENTAR
// penjelas (termasuk komentar tes ini sendiri). Buang komentar sebelum mencocokkan.
function bersihkanKomentar(kode) {
    return kode
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((baris) => baris.replace(/(^|[^:])\/\/.*$/, "$1"))
        .join("\n");
}

function telusuriJs(dir, hasil = []) {
    for (const entri of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entri.name.startsWith(".") && entri.name !== ".claude") continue;
        const penuh = path.join(dir, entri.name);
        if (entri.isDirectory()) {
            if (SKIP_DIRS.has(entri.name)) continue;
            telusuriJs(penuh, hasil);
        } else if (entri.name.endsWith(".js") && !entri.name.endsWith(".test.js")) {
            hasil.push(penuh);
        }
    }
    return hasil;
}

describe("#b251 — kunci pemrosesan pesan", () => {
    const sumber = bersihkanKomentar(fs.readFileSync(path.join(repoRoot, "message", "raf.js"), "utf8"));

    test("clearProcessing di blok finally DIJAGA — tidak melepas kunci milik pesan lain", () => {
        // Bentuk yang benar: `if (<penanda>) clearProcessing(...)` di dalam finally.
        expect(sumber).toMatch(/finally\s*\{[\s\S]{0,200}?if\s*\([A-Za-z_$][\w$]*\)\s*clearProcessing\(/);
    });

    test("tidak ada clearProcessing TANPA syarat langsung setelah finally", () => {
        const tanpaSyarat = /finally\s*\{\s*clearProcessing\(/.test(sumber);
        expect(tanpaSyarat).toBe(false);
    });

    test("penanda kepemilikan kunci disetel tepat setelah setProcessing berhasil", () => {
        expect(sumber).toMatch(/setProcessing\(stateSender\);\s*\n\s*[A-Za-z_$][\w$]*\s*=\s*true;/);
    });
});

describe("#b251 — fallback template wajib self-consistent", () => {
    // Fallback berkutip biasa (' atau ") yang memuat `${` = akan terkirim MENTAH.
    // Backtick aman karena diinterpolasi di tempat pemanggilan.
    // Literal string JS TIDAK boleh memuat baris-baru mentah, jadi isi fallback dibatasi
    // ke non-newline (+ escape). Tanpa batas ini `[\s\S]*` melompati batas pernyataan dan
    // menuduh pemanggilan lain yang fallback-nya bersih — penjaga yang salah tuduh lebih
    // berbahaya daripada tidak ada penjaga, karena orang akan mematikannya.
    const POLA_BURUK = /renderResponseTemplate\(\s*['"][^'"\n]*['"]\s*,\s*(['"])(?:(?!\1)[^\n\\]|\\.)*\$\{/g;

    function kumpulkanFallbackBermasalah() {
        const temuan = [];
        for (const berkas of telusuriJs(repoRoot)) {
            let kode;
            try {
                kode = bersihkanKomentar(fs.readFileSync(berkas, "utf8"));
            } catch (_e) {
                continue;
            }
            if (!kode.includes("renderResponseTemplate(")) continue;
            POLA_BURUK.lastIndex = 0;
            let m;
            while ((m = POLA_BURUK.exec(kode)) !== null) {
                const baris = kode.slice(0, m.index).split("\n").length;
                temuan.push(`${path.relative(repoRoot, berkas)}:${baris}`);
            }
        }
        return temuan;
    }

    // UTANG TERKUNCI (pola yang sama dipakai `scripts/check-theme-tokens.js`).
    // 51 pemanggilan lama sudah memakai fallback berkutip ber-`${slot}`; itu MELUBANGI jaring
    // pengaman #b249 — template basi memang jatuh ke fallback kode, tapi fallback-nya pun bocor
    // `${slot}` mentah. Membetulkan semuanya sekaligus terlalu besar untuk satu perubahan, jadi
    // utangnya dikunci di sini: berkas lama boleh punya SEBANYAK INI, tidak boleh bertambah, dan
    // berkas BARU tidak boleh muncul sama sekali. Turunkan angkanya setiap kali dicicil.
    const UTANG_TERKUNCI = {
        "message/handlers/payment-proof-admin-handler.js": 14,
        "message/handlers/package-request-admin-handler.js": 12,
        "message/handlers/smart-report-text-menu.js": 9,
        "message/handlers/business-expense-wa.js": 9,
        "message/handlers/state-domains/payment-proof-admin.state.js": 2,
        "message/handlers/state-domains/package-request-admin.state.js": 2,
        "message/handlers/states/reboot-followup-state-handler.js": 1,
        "message/handlers/raf-intent-dispatch/owner-admin-intents.js": 1,
        "lib/services/money-summary.js": 1,
    };

    test("tidak ada fallback berkutip ber-slot BARU (utang lama terkunci, tak boleh tumbuh)", () => {
        const perBerkas = {};
        kumpulkanFallbackBermasalah().forEach((lokasi) => {
            const berkas = lokasi.replace(/:\d+$/, "").split(path.sep).join("/");
            perBerkas[berkas] = (perBerkas[berkas] || 0) + 1;
        });

        const pelanggaran = [];
        Object.entries(perBerkas).forEach(([berkas, jumlah]) => {
            const batas = UTANG_TERKUNCI[berkas];
            if (batas === undefined) {
                pelanggaran.push(`BERKAS BARU ${berkas} (${jumlah}) — fallback WAJIB backtick`);
            } else if (jumlah > batas) {
                pelanggaran.push(`${berkas} naik ${batas} → ${jumlah}`);
            }
        });
        expect(pelanggaran).toEqual([]);
    });

    test("utang yang sudah dicicil harus diturunkan angkanya (jangan tinggalkan batas basi)", () => {
        const perBerkas = {};
        kumpulkanFallbackBermasalah().forEach((lokasi) => {
            const berkas = lokasi.replace(/:\d+$/, "").split(path.sep).join("/");
            perBerkas[berkas] = (perBerkas[berkas] || 0) + 1;
        });
        const basi = Object.entries(UTANG_TERKUNCI)
            .filter(([berkas, batas]) => (perBerkas[berkas] || 0) < batas)
            .map(([berkas, batas]) => `${berkas}: batas ${batas}, nyatanya ${perBerkas[berkas] || 0}`);
        expect(basi).toEqual([]);
    });

    test("pola pendeteksinya sendiri memang menangkap bentuk yang salah", () => {
        // Uji-diri: tanpa ini, regex yang rusak akan lolos sebagai "0 temuan" selamanya.
        const contohSalah = `renderResponseTemplate("psb_x", "Halo \${nama} apa kabar", { nama });`;
        const contohBenar = "renderResponseTemplate(\"psb_x\", `Halo ${nama} apa kabar`, { nama });";
        POLA_BURUK.lastIndex = 0;
        expect(POLA_BURUK.test(contohSalah)).toBe(true);
        POLA_BURUK.lastIndex = 0;
        expect(POLA_BURUK.test(contohBenar)).toBe(false);
    });
});
