/**
 * Header Doc
 * Purpose: Ekspor isi logger pesan masuk (`database/message_logs.sqlite`) ke JSON + CSV untuk
 *          review manual gaya bahasa pelanggan. Read-only; anotasi intent keyword bersifat best-effort.
 * Caller: dijalankan manual — `node scripts/export-message-logs.js [outDir]` (default outDir: `tmp/`).
 * Deps: `repositories/message-log.repository`, opsional `lib/wifi_template_handler.getIntentFromKeywords`.
 * MainFuncs: `main`.
 * SideEffects: Membaca message_logs.sqlite, menulis file ekspor JSON+CSV ke folder output.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { getMessageLogRepository } = require("../repositories/message-log.repository");

function csvEscape(value) {
    if (value === null || value === undefined) return "";
    const s = String(value).replace(/"/g, '""');
    return `"${s}"`;
}

// Best-effort: kembalikan fungsi klasifikasi intent keyword, atau null bila handler tak tersedia
// di konteks skrip standalone (mis. template/config belum dimuat).
function tryKeywordIntent() {
    try {
        const { getIntentFromKeywords } = require("../lib/wifi_template_handler");
        if (typeof getIntentFromKeywords !== "function") return null;
        return (text) => {
            try {
                return getIntentFromKeywords(text) || null;
            } catch (_e) {
                return null;
            }
        };
    } catch (_e) {
        return null;
    }
}

async function main() {
    const outDir = process.argv[2] || path.join(__dirname, "..", "tmp");
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    const repo = getMessageLogRepository();
    const stats = await repo.getStats();
    const rows = await repo.getRecent({ limit: 5000 });
    const classify = tryKeywordIntent();

    const annotated = rows.map((r) => ({
        ...r,
        keyword_intent: classify ? classify(r.body || "") : null
    }));

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = path.join(outDir, `message-logs-${stamp}.json`);
    const csvPath = path.join(outDir, `message-logs-${stamp}.csv`);

    fs.writeFileSync(jsonPath, JSON.stringify({ stats, rows: annotated }, null, 2));

    const header = ["received_at", "role", "is_customer", "pushname", "phone_number", "message_type", "keyword_intent", "body"];
    const lines = [header.join(",")];
    for (const r of annotated) {
        lines.push([
            csvEscape(r.received_at),
            csvEscape(r.role),
            csvEscape(r.is_customer),
            csvEscape(r.pushname),
            csvEscape(r.phone_number),
            csvEscape(r.message_type),
            csvEscape(r.keyword_intent),
            csvEscape(r.body)
        ].join(","));
    }
    fs.writeFileSync(csvPath, lines.join("\n"));

    const unmatchedCustomer = annotated.filter((r) => r.is_customer === 1 && !r.keyword_intent).length;

    console.log("=== EKSPOR LOG PESAN MASUK ===");
    console.log(`Total pesan        : ${stats.total}`);
    console.log(`Pengirim unik      : ${stats.distinct_senders}`);
    console.log(`Rentang waktu      : ${stats.first_at || "-"}  ->  ${stats.last_at || "-"}`);
    console.log(`Per peran          : ${stats.by_role.map((r) => `${r.role}=${r.count}`).join(", ")}`);
    if (classify) {
        console.log(`Pelanggan tanpa intent keyword (kandidat AI): ${unmatchedCustomer}`);
    } else {
        console.log("(anotasi intent keyword dilewati — handler tak tersedia di skrip standalone)");
    }
    console.log(`JSON : ${jsonPath}`);
    console.log(`CSV  : ${csvPath}`);

    await repo.close();
}

main().catch((err) => {
    console.error("[EXPORT_MSG_LOG] gagal:", err.message);
    process.exit(1);
});
