/**
 * Header Doc
 * Purpose: Membuat drift antara repo dan direktori bot PRODUKSI terlihat. Prod BUKAN git repo
 *          (deploy = salin file), jadi tanpa alat ini drift tak kelihatan sampai menggigit.
 *          Mengklasifikasikan tiap file runtime: IDENTIK / HANYA-CRLF / TERTINGGAL / DRIFT-ASLI /
 *          HILANG / EKSTRA. "DRIFT-ASLI" = isi yang TIDAK PERNAH ada di riwayat git = editan
 *          langsung di server yang akan hilang pada deploy berikutnya.
 * Caller: dijalankan manual. Dua langkah:
 *   1) di mesin dev:  node scripts/prod-drift-check.js manifest > /tmp/manifest.tsv
 *      (lalu salin manifest + skrip ini ke server)
 *   2) di server   :  node prod-drift-check.js audit /tmp/manifest.tsv /root/bot/<bot>
 *      Tambah `--json` untuk keluaran mesin (dipakai langkah klasifikasi di dev).
 *   3) di mesin dev:  node scripts/prod-drift-check.js classify audit.json
 *      → memisahkan TERTINGGAL (blob ada di riwayat git) dari DRIFT-ASLI (tak pernah ada).
 *      (`classify` hanya menerima audit.json — manifest TIDAK dipakai di langkah ini.)
 * Deps: `child_process` (hanya di mode manifest/classify, memanggil `git`), `crypto`, `fs`, `path`.
 * MainFuncs: `buildManifest`, `auditDir`, `classify`.
 * SideEffects: READ-ONLY. Tidak pernah menulis ke direktori bot.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

// Hanya file yang benar-benar dijalankan di prod. Test/doc/hook agent tak relevan.
const RUNTIME_PREFIXES = [
    "index.js",
    "package.json",
    "ecosystem.config.js",
    "config.example.json",
    "lib/",
    "message/",
    "routes/",
    "services/",
    "repositories/",
    "views/",
    "static/",
    "scripts/"
];
const SKIP = [/^\.github\//, /^\.claude\//, /^\.kiro\//, /^\.worktrees\//, /node_modules/, /^docs\//];
const NON_RUNTIME = [/__tests__/, /\.test\.js$/, /\.module_map\.md$/, /\.gitkeep$/];

function isRuntime(p) {
    if (SKIP.some((re) => re.test(p))) return false;
    return RUNTIME_PREFIXES.some((pre) => (pre.endsWith("/") ? p.startsWith(pre) : p === pre));
}
const isExecutable = (p) => !NON_RUNTIME.some((re) => re.test(p));

/** sha1 gaya git: sha1("blob <len>\0" + isi) — sama dengan `git hash-object`. */
function gitBlobSha(buf) {
    const header = Buffer.from(`blob ${buf.length}\0`, "utf8");
    return crypto.createHash("sha1").update(Buffer.concat([header, buf])).digest("hex");
}
const stripCr = (buf) => Buffer.from(buf.toString("binary").replace(/\r/g, ""), "binary");

function buildManifest(ref = "HEAD") {
    const out = execFileSync("git", ["ls-tree", "-r", ref, "--format=%(objectname)%x09%(path)"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024
    });
    return out
        .split("\n")
        .filter((l) => l.trim() && isRuntime(l.split("\t")[1]))
        .join("\n");
}

function readManifest(file) {
    const map = new Map();
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        const [sha, p] = line.split("\t");
        map.set(p, sha);
    }
    return map;
}

function auditDir(manifestFile, botDir) {
    const manifest = readManifest(manifestFile);
    const result = { botDir, identical: 0, crlfOnly: [], differs: [], missing: [], extra: [] };

    for (const [p, sha] of manifest) {
        const full = path.join(botDir, p);
        if (!fs.existsSync(full)) {
            result.missing.push(p);
            continue;
        }
        const buf = fs.readFileSync(full);
        const raw = gitBlobSha(buf);
        if (raw === sha) {
            result.identical += 1;
            continue;
        }
        if (gitBlobSha(stripCr(buf)) === sha) {
            result.crlfOnly.push(p);
            continue;
        }
        result.differs.push({ path: p, prodSha: raw, prodShaLf: gitBlobSha(stripCr(buf)) });
    }

    const skipDir = /^(node_modules|\.git|database|sessions|backups|tmp|temp|uploads|logs)$/;
    (function walk(rel) {
        let entries;
        try {
            entries = fs.readdirSync(path.join(botDir, rel), { withFileTypes: true });
        } catch (_e) {
            return;
        }
        for (const e of entries) {
            if (skipDir.test(e.name)) continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) walk(r);
            else if (isRuntime(r) && !manifest.has(r) && !/\.bak-/.test(r)) result.extra.push(r);
        }
    })("");

    return result;
}

/** Pisahkan TERTINGGAL (blob prod ADA di riwayat git) dari DRIFT-ASLI (tak pernah ada). */
function classify(auditFile) {
    const audit = JSON.parse(fs.readFileSync(auditFile, "utf8"));
    const shas = audit.differs.flatMap((d) => [d.prodSha, d.prodShaLf]);
    const known = new Set();
    if (shas.length) {
        const out = execFileSync("git", ["cat-file", "--batch-check"], {
            input: shas.join("\n"),
            encoding: "utf8"
        });
        out.split("\n").forEach((l) => {
            const [sha, type] = l.split(" ");
            if (type && type !== "missing") known.add(sha);
        });
    }
    const behind = [];
    const realDrift = [];
    for (const d of audit.differs) {
        (known.has(d.prodSha) || known.has(d.prodShaLf) ? behind : realDrift).push(d.path);
    }
    return { ...audit, behind, realDrift };
}

function report(r) {
    const exec = (arr) => arr.filter(isExecutable);
    console.log(`\n########## ${path.basename(r.botDir)} ##########`);
    console.log(`  IDENTIK                                   : ${r.identical}`);
    console.log(`  HANYA CRLF (isi sama)                     : ${r.crlfOnly.length}`);
    if (r.behind) console.log(`  TERTINGGAL (versi lama, ada di git)        : ${r.behind.length}  (runtime: ${exec(r.behind).length})`);
    if (r.realDrift) console.log(`  ⚠️  DRIFT ASLI (tak pernah ada di git)     : ${r.realDrift.length}`);
    console.log(`  HILANG di prod                            : ${r.missing.length}  (runtime: ${exec(r.missing).length})`);
    console.log(`  EKSTRA di prod                            : ${r.extra.length}`);

    const show = (title, arr) => {
        const list = exec(arr || []);
        if (!list.length) return;
        console.log(`\n--- ${title} (${list.length}) ---`);
        list.forEach((p) => console.log("  " + p));
    };
    show("⚠️ DRIFT ASLI — editan server yang belum di-commit", r.realDrift);
    show("TERTINGGAL — belum dideploy", r.behind);
    show("HILANG di prod", r.missing);
    show("EKSTRA di prod", r.extra);
}

function main() {
    const [mode, a, b] = process.argv.slice(2);
    if (mode === "manifest") {
        process.stdout.write(buildManifest(a || "HEAD") + "\n");
        return;
    }
    if (mode === "audit") {
        if (!a || !b) throw new Error("pakai: audit <manifest.tsv> <botDir> [--json]");
        const r = auditDir(a, b);
        if (process.argv.includes("--json")) process.stdout.write(JSON.stringify(r));
        else report(r);
        return;
    }
    if (mode === "classify") {
        if (!a) throw new Error("pakai: classify <audit.json>");
        report(classify(a));
        return;
    }
    console.error("mode: manifest | audit <manifest> <botDir> [--json] | classify <audit.json>");
    process.exit(1);
}

module.exports = { buildManifest, auditDir, classify, gitBlobSha, isRuntime };

if (require.main === module) main();
