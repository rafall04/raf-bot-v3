/**
 * Header Doc
 * Purpose: Menjaga agar balasan KESTABILAN ke pelanggan (#b255) tidak pernah menyebut nama
 *          ISP/upstream, nama jalur/VLAN, nama target probe, IP, maupun angka mentah
 *          loss/jitter/RTT — sementara pesan ADMIN tetap boleh memuat semuanya.
 * Caller: Jest test runner.
 * Deps: `database/response_templates.json`, sumber `connection-check-handler.js` & `quality-alarm.js`.
 * MainFuncs: —
 * SideEffects: Tidak ada.
 *
 * KENAPA ADA: pola "starvasi data" (#b246-248) menang bukan karena teksnya ditambal, tapi karena
 * datanya TIDAK DIOPER ke perakit pesan. Tes ini menguji kedua sisi: templatenya bersih, DAN
 * perakitnya memang tidak menerima angka untuk dibocorkan.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..");
const templates = require(path.join(repoRoot, "database", "response_templates.json"));

// Nama yang HARAM muncul di layar pelanggan.
const TERLARANG = [
    "gmdp", "mni", "indihome", "indibiz", "vlan", "sf-probe", "routing-mark",
    "garena", "moonton", "akamai", "cloudflare", "google dns", "gateway",
    "pppoe", "odp", "odc", "genieacs", "mikrotik",
];
const POLA_IP = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

// Diturunkan DARI berkas template, bukan didaftar tangan: daftar tangan tak bisa memergoki
// kunci yatim (ada di template, tak pernah dirender kode) — dan kunci yatim itu justru yang
// membuat admin mengedit teks di /api/templates lalu heran kenapa pelanggan tak pernah
// menerimanya. Cacat ini nyata: `conncheck_stabilitas_stabil` sempat ikut terkirim di #b255.
const KEY_KESTABILAN = Object.keys(templates).filter((k) => k.startsWith("conncheck_stabilitas_"));

function bersihkanKomentar(kode) {
    return kode
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .map((b) => b.replace(/(^|[^:])\/\/.*$/, "$1"))
        .join("\n");
}

describe("#b255 — template kestabilan bersih dari identitas jaringan", () => {
    test.each(KEY_KESTABILAN)("%s ada dan tidak menyebut nama terlarang", (key) => {
        expect(templates[key]).toBeDefined();
        const teks = String(templates[key].template || "").toLowerCase();
        const bocor = TERLARANG.filter((k) => teks.includes(k));
        expect(bocor).toEqual([]);
    });

    test.each(KEY_KESTABILAN)("%s tidak memuat alamat IP", (key) => {
        expect(POLA_IP.test(String(templates[key].template || ""))).toBe(false);
    });

    test.each(KEY_KESTABILAN)("%s tidak memuat slot angka mentah (loss/jitter/rtt)", (key) => {
        // Kalau slot angka ada di template, admin bisa MENERBITKANNYA lagi lewat /api/templates
        // tanpa satu baris kode pun berubah — persis lubang yang ditutup pola starvasi data.
        const slot = String(templates[key].template || "").match(/\$\{[^}]+\}/g) || [];
        const berbahaya = slot.filter((s) => /loss|jitter|rtt|ping|ms|persen|pct/i.test(s));
        expect(berbahaya).toEqual([]);
    });

    test("tidak ada kunci YATIM — tiap template kestabilan benar-benar dirender kode", () => {
        // Kunci yatim lebih berbahaya daripada teks jelek: admin mengeditnya, mengira sudah
        // berlaku, padahal pelanggan tak pernah menerimanya. Guard ini menangkapnya sejak awal.
        const sumber = fs.readFileSync(
            path.join(repoRoot, "message", "handlers", "connection-check-handler.js"), "utf8"
        );
        const yatim = KEY_KESTABILAN.filter((k) => !sumber.includes(k));
        expect(yatim).toEqual([]);
    });

    test("daftar kunci tidak kosong (guard atas guard)", () => {
        // Kalau prefiksnya berubah, KEY_KESTABILAN jadi [] dan SEMUA test.each di atas lulus
        // secara hampa. Ini yang mencegah suite hijau-palsu.
        expect(KEY_KESTABILAN.length).toBeGreaterThanOrEqual(2);
    });
});

describe("#b255 — perakit pesan pelanggan tidak MENERIMA angka untuk dibocorkan", () => {
    const sumber = bersihkanKomentar(
        fs.readFileSync(path.join(repoRoot, "message", "handlers", "connection-check-handler.js"), "utf8")
    );

    test("buildStabilitasNote hanya menerima TINGKAT, bukan ringkasan angka", () => {
        expect(sumber).toMatch(/function buildStabilitasNote\(tingkat\)/);
    });

    test("data yang dioper ke renderResponseTemplate kestabilan adalah objek KOSONG", () => {
        const blok = sumber.slice(sumber.indexOf("function buildStabilitasNote"));
        const potong = blok.slice(0, blok.indexOf("function buildHealthNote"));
        // Tiap pemanggilan template di dalamnya berakhir `{}` — tak ada slot data sama sekali.
        expect(potong).toMatch(/conncheck_stabilitas_buruk/);
        expect(potong).toMatch(/conncheck_stabilitas_kurang/);
        expect(potong).not.toMatch(/ringkas\.|lossPct|jitterMs|rttMs/);
    });
});

describe("#b255 — pesan ADMIN justru WAJIB memuat detailnya", () => {
    const alarm = bersihkanKomentar(fs.readFileSync(path.join(repoRoot, "lib", "quality-alarm.js"), "utf8"));

    test("alarm admin memuat angka dan nama jalur", () => {
        expect(alarm).toMatch(/ringkas\.lossPct/);
        expect(alarm).toMatch(/ringkas\.jitterMs/);
        expect(alarm).toMatch(/p\.label/);
    });

    test("alarm admin dikirim lewat jalur admin, bukan reply pelanggan", () => {
        expect(alarm).toMatch(/getAdminJids/);
    });
});

describe("#b255 — gerbang pelanggan (CLAUDE.md #4: perilaku baru default MATI)", () => {
    const sumber = fs.readFileSync(
        path.join(repoRoot, "message", "handlers", "connection-check-handler.js"), "utf8"
    );
    const contoh = JSON.parse(fs.readFileSync(path.join(repoRoot, "config.example.json"), "utf8"));

    test("resolveStabilitas berhenti lebih dulu bila gerbang tidak DINYALAKAN eksplisit", () => {
        const blok = sumber.slice(sumber.indexOf("async function resolveStabilitas"));
        const awal = blok.slice(0, blok.indexOf("upstreamSignalAvailable"));
        // `!== true`, bukan `=== false`: config lama yang belum punya kunci ini harus MATI,
        // bukan menyala karena undefined dibaca sebagai "tidak dimatikan".
        expect(awal).toMatch(/stabilitasPelanggan/);
        expect(awal).toMatch(/enabled !== true/);
    });

    test("gerbang terdokumentasi di config.example.json dan bawaannya MATI", () => {
        expect(contoh.upstreamMonitor.stabilitasPelanggan.enabled).toBe(false);
        expect(contoh.upstreamMonitor.alarmKestabilan.enabled).toBe(false);
    });
});
