/**
 * Header Doc
 * Purpose : Menjamin setiap simbol yang diimpor dari modul PENGIRIM WhatsApp benar-benar
 *           diekspor. Cacat ini nyata: `whatsapp-notification-wrapper.sendNotification`
 *           tidak pernah ada, sehingga alarm kestabilan & pelaporan kegagalan WiFi gagal
 *           diam-diam (tertelan never-throw) — terbukti di log produksi.
 * Caller  : jest
 * Deps    : memindai lib/ + services/ (bukan daftar manual), memuat modul pengirim saja.
 * MainFuncs: -
 * SideEffects: tidak ada (modul pengirim murni pembungkus, tak membuka koneksi saat dimuat)
 */
const fs = require("fs");
const path = require("path");

const akar = path.join(__dirname, "..", "..");

// Modul pengirim: satu-satunya yang dimuat di tes ini.
const MODUL_PENGIRIM = ["whatsapp-critical-delivery", "whatsapp-notification-wrapper", "whatsapp-delivery-service", "whatsapp-gateway"];

function berkasJs(dir, keluar = []) {
    if (!fs.existsSync(dir)) return keluar;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".git", "__tests__", "tmp", "dist", ".worktrees"].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) berkasJs(p, keluar);
        else if (e.name.endsWith(".js")) keluar.push(p);
    }
    return keluar;
}

function kumpulkanPemakaian() {
    const pakai = [];
    const identOK = (s) => s.length > 0 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
    const berkas = [...berkasJs(path.join(akar, 'lib')), ...berkasJs(path.join(akar, 'services')), ...berkasJs(path.join(akar, 'message'))];
    for (const f of berkas) {
        const rel = path.relative(akar, f);
        for (const l of fs.readFileSync(f, 'utf8').split(String.fromCharCode(10))) {
            for (const modul of MODUL_PENGIRIM) {
                for (const kutip of ['"', "'"]) {
                    const jejak = kutip + ')';
                    const i = l.indexOf('/' + modul + jejak);
                    if (i < 0) continue;
                    // bentuk A: require("./modul").simbol
                    const sesudah = l.slice(i + ('/' + modul + jejak).length);
                    if (sesudah.startsWith('.')) {
                        let s = '';
                        for (const c of sesudah.slice(1)) { if (identOK(s + c)) s += c; else break; }
                        if (identOK(s)) pakai.push({ file: rel, modul, simbol: s });
                    }
                    // bentuk B: const { a, b } = require("./modul")
                    const buka = l.indexOf('{'), tutup = l.indexOf('}');
                    if (buka >= 0 && tutup > buka && tutup < i) {
                        for (const bagian of l.slice(buka + 1, tutup).split(',')) {
                            const s = bagian.split(':')[0].trim();
                            if (identOK(s)) pakai.push({ file: rel, modul, simbol: s });
                        }
                    }
                }
            }
        }
    }
    return pakai;
}

describe("#b269 — simbol pengirim WhatsApp yang diimpor harus benar-benar ada", () => {
    const pakai = kumpulkanPemakaian();

    test("pemindaian menemukan pemakaian (kalau 0, penjaganya sendiri yang rusak)", () => {
        expect(pakai.length).toBeGreaterThan(0);
    });

    test("setiap simbol yang diimpor diekspor oleh modulnya", () => {
        const rusak = [];
        for (const p of pakai) {
            const modul = require(path.join(akar, "lib", p.modul));
            if (typeof modul[p.simbol] !== "function") {
                rusak.push(`${p.file}: require("${p.modul}").${p.simbol} → ${typeof modul[p.simbol]}`);
            }
        }
        // Pesannya sengaja memuat daftar lengkap: kegagalan kirim selalu tertelan try-catch,
        // jadi tes ini satu-satunya tempat cacatnya terlihat.
        expect(rusak).toEqual([]);
    });
});
