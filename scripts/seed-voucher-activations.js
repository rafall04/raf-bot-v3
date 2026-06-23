/**
 * Header Doc
 * Purpose: Seed one-off voucher.sqlite dari arsip nama log-script Mikhmon (mis. hasil cleanup 40k). Idempotent (UNIQUE username+login_at), jadi aman dijalankan berulang.
 * Caller: Operator CLI — `node scripts/seed-voucher-activations.js <path-arsip.txt>`.
 * Deps: `fs`, `path`, `../repositories/voucher-tracking.repository`.
 * MainFuncs: IIFE async.
 * SideEffects: Menulis ke database/voucher.sqlite.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { createVoucherTrackingRepository } = require("../repositories/voucher-tracking.repository");

(async () => {
    const file = process.argv[2];
    if (!file || !fs.existsSync(file)) {
        console.error("Usage: node scripts/seed-voucher-activations.js <archive.txt>");
        process.exit(1);
    }
    const names = fs.readFileSync(file, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    console.log("lines:", names.length);

    const repo = createVoucherTrackingRepository({
        dbPath: path.join(__dirname, "..", "database", "voucher.sqlite")
    });

    const CHUNK = 2000;
    let ingested = 0;
    let skipped = 0;
    for (let i = 0; i < names.length; i += CHUNK) {
        const r = await repo.ingestLogNames(names.slice(i, i + CHUNK));
        ingested += r.ingested;
        skipped += r.skipped;
        process.stdout.write(`\r  ${Math.min(i + CHUNK, names.length)}/${names.length} (ingested ${ingested})`);
    }
    console.log(`\nDONE ingested: ${ingested} | skipped: ${skipped}`);

    const rep = await repo.getReport({});
    console.log("report aktivasi:", rep.aktivasi, "| revenue:", rep.revenue);
    console.log("top profiles:", rep.byProfile.slice(0, 8).map((p) => `${p.profile}: ${p.aktivasi} aktivasi / Rp${p.revenue}`).join(" | "));
    await repo.close();
    process.exit(0);
})();
