/**
 * Header Doc
 * Purpose: Memasukkan titik ODC/ODP yang SUDAH ADA di Google Maps ke bot — sekali jalan, tanpa
 *          mengetik satu per satu. Menerima hasil ekspor KML / GeoJSON / CSV.
 *
 *          DRY-RUN DULU, SELALU. Tanpa `--apply` skrip ini tidak menulis apa pun; ia hanya
 *          mencetak rencana: mana yang akan dibuat, mana yang cuma diperbarui titiknya, mana yang
 *          diabaikan, dan induk ODC mana yang dipilihkan. Impor massal yang langsung menulis =
 *          cara tercepat mengotori peta dengan 30 baris salah sekaligus.
 *
 *          MENULIS LEWAT API BOT YANG SUDAH JALAN (`/api/map/network-assets`, `/api/map/waypoints`),
 *          BUKAN langsung ke file JSON. Dua alasan: (1) validasi + hitung-ulang port + ID aset tetap
 *          dimiliki `lib/network-assets-service` — tak ada jalur tulis kedua; (2) proses bot memegang
 *          `global.networkAssets` di memori, jadi menulis file dari luar hanya akan tertimpa/basi
 *          sampai PM2 di-restart.
 * Caller: dijalankan manual DI DALAM direktori bot:
 *           node scripts/import-map-assets.js <file.kml> [--apply] [--url http://127.0.0.1:3010]
 * Deps: `lib/map-import-parser` (parser murni), `config.json` + `database/accounts.json` (mint JWT
 *       admin lokal), API admin aset jaringan.
 * MainFuncs: `susunRencana`, `main`.
 * SideEffects: TANPA `--apply`: tidak ada. DENGAN `--apply`: POST/PUT aset + POST jalur ke API bot.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { parseMapExport, classifyAssetName } = require("../lib/map-import-parser");

const EARTH_R = 6371000;
function meter(aLat, aLng, bLat, bLng) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(bLat - aLat);
    const dLng = rad(bLng - aLng);
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// Ujung garis dianggap "menempel" ke sebuah boks bila sedekat ini. Longgar sedikit karena titik yang
// digambar tangan di Google Maps jarang persis di atas markernya.
const SNAP_METER = 60;

function argValue(flag, fallback) {
    const i = process.argv.indexOf(flag);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function mintToken(botDir) {
    const config = JSON.parse(fs.readFileSync(path.join(botDir, "config.json"), "utf8"));
    const raw = JSON.parse(fs.readFileSync(path.join(botDir, "database/accounts.json"), "utf8"));
    const akun = (Array.isArray(raw) ? raw : raw.accounts || []).find((a) => ["admin", "owner", "superadmin"].includes(a.role));
    if (!akun) throw new Error("Tak ada akun admin di database/accounts.json.");
    const jwt = require(path.join(botDir, "node_modules/jsonwebtoken"));
    return jwt.sign({ id: akun.id, role: akun.role }, config.jwt, { expiresIn: "30m" });
}

function api(baseUrl, token, method, jalur, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(baseUrl + jalur);
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
            headers: {
                Cookie: `token=${token}`,
                ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {})
            }
        }, (res) => {
            let buf = "";
            res.on("data", (c) => (buf += c));
            res.on("end", () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (_e) { /* biarkan mentah */ }
                resolve({ status: res.statusCode, body: json, raw: buf });
            });
        });
        req.on("error", reject);
        if (data) req.write(data);
        req.end();
    });
}

/**
 * Rencana impor. Aturannya sengaja konservatif:
 *   - nama SUDAH ADA  → PERBARUI titiknya, jangan bikin kembar (duplikat ODP = peta yang berbohong)
 *   - nama ganda      → DILEWATI, dilaporkan; komputer tak boleh menebak yang mana
 *   - induk ODP       → ODC terdekat, dari gabungan yang sudah ada + yang baru diimpor
 */
function susunRencana(parsed, assetsLama, opts = {}) {
    const maxIndukMeter = opts.maxIndukMeter || 2000;
    const buat = [];
    const perbarui = [];
    const lewati = [];

    const lamaByName = new Map(assetsLama.map((a) => [String(a.name || "").trim().toLowerCase(), a]));
    const hitungNama = new Map();
    assetsLama.forEach((a) => {
        const k = String(a.name || "").trim().toLowerCase();
        hitungNama.set(k, (hitungNama.get(k) || 0) + 1);
    });

    parsed.points.forEach((p) => {
        const tipe = classifyAssetName(p.name);
        if (!tipe) { lewati.push({ ...p, alasan: "bukan ODC/ODP (nama tak berawalan)" }); return; }

        const kunci = String(p.name).trim().toLowerCase();
        if ((hitungNama.get(kunci) || 0) > 1) { lewati.push({ ...p, alasan: "nama ganda di data bot — rapikan dulu" }); return; }

        const lama = lamaByName.get(kunci);
        if (lama) {
            const geser = Math.round(meter(Number(lama.latitude) || p.lat, Number(lama.longitude) || p.lng, p.lat, p.lng));
            perbarui.push({ ...p, tipe, id: lama.id, geser });
            return;
        }
        buat.push({ ...p, tipe });
    });

    // Induk ODC dipilih dari SEMUA ODC yang akan ada sesudah impor (lama + baru).
    const semuaOdc = [
        ...assetsLama.filter((a) => a && a.type === "ODC").map((a) => ({ id: a.id, name: a.name, lat: Number(a.latitude), lng: Number(a.longitude) })),
        ...buat.filter((b) => b.tipe === "ODC").map((b) => ({ id: null, name: b.name, lat: b.lat, lng: b.lng }))
    ].filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lng) && o.lat !== 0);

    buat.filter((b) => b.tipe === "ODP").forEach((b) => {
        let terdekat = null;
        semuaOdc.forEach((o) => {
            const d = meter(b.lat, b.lng, o.lat, o.lng);
            if (d <= maxIndukMeter && (!terdekat || d < terdekat.meter)) terdekat = { ...o, meter: Math.round(d) };
        });
        b.induk = terdekat;
    });

    // Garis → jalur ODC→ODP bila KEDUA ujungnya menempel ke boks. Kalau tidak, dilaporkan apa adanya:
    // menebak ujung jalur sama saja menggambar kabel yang tak pernah ada.
    const semuaTitik = [
        ...assetsLama.map((a) => ({ nama: a.name, tipe: a.type, id: a.id, lat: Number(a.latitude), lng: Number(a.longitude) })),
        ...buat.map((b) => ({ nama: b.name, tipe: b.tipe, id: null, lat: b.lat, lng: b.lng }))
    ].filter((t) => Number.isFinite(t.lat) && t.lat !== 0);

    const cocokUjung = (titik) => {
        let hit = null;
        semuaTitik.forEach((t) => {
            const d = meter(titik[0], titik[1], t.lat, t.lng);
            if (d <= SNAP_METER && (!hit || d < hit.meter)) hit = { ...t, meter: Math.round(d) };
        });
        return hit;
    };

    const jalur = [];
    (parsed.lines || []).forEach((l) => {
        const a = cocokUjung(l.points[0]);
        const b = cocokUjung(l.points[l.points.length - 1]);
        const odc = [a, b].find((x) => x && x.tipe === "ODC");
        const odp = [a, b].find((x) => x && x.tipe === "ODP");
        if (!odc || !odp) { lewati.push({ name: l.name || "(garis tanpa nama)", alasan: "ujung garis tak menempel ke ODC & ODP" }); return; }
        // Jalur selalu disimpan searah ODC → ODP supaya sisi klien tak perlu menebak arah.
        const titik = (a && a.tipe === "ODC") ? l.points : [...l.points].reverse();
        jalur.push({ name: l.name, odc, odp, points: titik });
    });

    return { buat, perbarui, lewati, jalur };
}

function cetakRencana(r, apply) {
    const label = apply ? "MENJALANKAN" : "RENCANA (dry-run — tidak ada yang ditulis)";
    console.log(`\n=== ${label} ===\n`);

    console.log(`BUAT BARU (${r.buat.length}):`);
    r.buat.forEach((b) => {
        const induk = b.tipe === "ODP" ? (b.induk ? ` → induk ${b.induk.name} (${b.induk.meter} m)` : " → TANPA induk (tak ada ODC di radius)") : "";
        console.log(`  + ${b.tipe} ${b.name}  ${b.lat.toFixed(6)},${b.lng.toFixed(6)}${induk}`);
    });

    console.log(`\nPERBARUI TITIK (${r.perbarui.length}) — nama sudah ada, TIDAK dibuat kembar:`);
    r.perbarui.forEach((p) => console.log(`  ~ ${p.tipe} ${p.name}  bergeser ${p.geser} m`));

    console.log(`\nJALUR dari garis (${r.jalur.length}):`);
    r.jalur.forEach((j) => console.log(`  → ${j.odc.nama} ke ${j.odp.nama}  (${j.points.length} titik)`));

    console.log(`\nDIABAIKAN (${r.lewati.length}):`);
    r.lewati.forEach((l) => console.log(`  - ${l.name || "(tanpa nama)"} — ${l.alasan}`));
    console.log("");
}

async function main() {
    const berkas = process.argv[2];
    if (!berkas || berkas.startsWith("--")) {
        console.error("pakai: node scripts/import-map-assets.js <file.kml|.geojson|.csv> [--apply] [--url http://127.0.0.1:3010]");
        process.exit(1);
    }
    const apply = process.argv.includes("--apply");
    const baseUrl = argValue("--url", "http://127.0.0.1:3010").replace(/\/$/, "");
    const botDir = process.cwd();

    const isi = fs.readFileSync(berkas, "utf8");
    const parsed = parseMapExport(isi, berkas);
    console.log(`Format terbaca: ${parsed.format} — ${parsed.points.length} titik, ${parsed.lines.length} garis.`);

    const token = mintToken(botDir);
    const daftar = await api(baseUrl, token, "GET", "/api/map/network-assets");
    if (daftar.status !== 200) throw new Error(`Gagal membaca aset dari bot (HTTP ${daftar.status}). Bot jalan di ${baseUrl}?`);
    const assetsLama = Array.isArray(daftar.body && daftar.body.data) ? daftar.body.data : [];
    console.log(`Aset di bot sekarang: ${assetsLama.length}.`);

    const rencana = susunRencana(parsed, assetsLama);
    cetakRencana(rencana, apply);

    if (!apply) {
        console.log("Tidak ada yang ditulis. Jalankan ulang dengan --apply kalau rencananya sudah benar.\n");
        return;
    }

    // ODC dulu, baru ODP — supaya induk sudah punya ID saat ODP dibuat.
    const idBaru = new Map();
    for (const b of rencana.buat.filter((x) => x.tipe === "ODC")) {
        const res = await api(baseUrl, token, "POST", "/api/map/network-assets", {
            type: "ODC", name: b.name, latitude: b.lat, longitude: b.lng, capacity_ports: 0, notes: "impor Google Maps"
        });
        if (res.status === 201) { idBaru.set(b.name.toLowerCase(), res.body.data.id); console.log(`  ✓ ODC ${b.name} → ${res.body.data.id}`); }
        else console.log(`  ✗ ODC ${b.name}: ${(res.body && res.body.message) || res.status}`);
    }

    for (const b of rencana.buat.filter((x) => x.tipe === "ODP")) {
        const indukId = b.induk ? (b.induk.id || idBaru.get(String(b.induk.name).toLowerCase()) || null) : null;
        const res = await api(baseUrl, token, "POST", "/api/map/network-assets", {
            type: "ODP", name: b.name, latitude: b.lat, longitude: b.lng, parent_odc_id: indukId, notes: "impor Google Maps"
        });
        if (res.status === 201) { idBaru.set(b.name.toLowerCase(), res.body.data.id); console.log(`  ✓ ODP ${b.name} → ${res.body.data.id}`); }
        else console.log(`  ✗ ODP ${b.name}: ${(res.body && res.body.message) || res.status}`);
    }

    for (const p of rencana.perbarui) {
        const lama = assetsLama.find((a) => String(a.id) === String(p.id));
        const res = await api(baseUrl, token, "PUT", `/api/map/network-assets/${p.id}`, {
            type: p.tipe, name: p.name, latitude: p.lat, longitude: p.lng,
            capacity_ports: lama ? lama.capacity_ports : 0,
            parent_odc_id: lama ? lama.parent_odc_id : null,
            address: lama ? lama.address : "", notes: lama ? lama.notes : ""
        });
        console.log(res.status === 200 ? `  ✓ perbarui ${p.name}` : `  ✗ ${p.name}: ${(res.body && res.body.message) || res.status}`);
    }

    for (const j of rencana.jalur) {
        const odcId = j.odc.id || idBaru.get(String(j.odc.nama).toLowerCase());
        const odpId = j.odp.id || idBaru.get(String(j.odp.nama).toLowerCase());
        if (!odcId || !odpId) { console.log(`  ✗ jalur ${j.odc.nama}→${j.odp.nama}: ID belum ada`); continue; }
        const res = await api(baseUrl, token, "POST", "/api/map/waypoints", {
            connectionType: "odc-odp", sourceId: odcId, targetId: odpId, waypoints: j.points
        });
        console.log(res.status === 200 ? `  ✓ jalur ${j.odc.nama} → ${j.odp.nama}` : `  ✗ jalur: ${(res.body && res.body.message) || res.status}`);
    }

    console.log("\nSelesai. Buka /map-viewer untuk melihat hasilnya (bot tak perlu di-restart).\n");
}

if (require.main === module) {
    main().catch((e) => { console.error("GAGAL:", e.message); process.exit(1); });
}

module.exports = { susunRencana, meter };
