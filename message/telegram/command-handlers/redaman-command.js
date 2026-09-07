/**
 * Header Doc
 * Purpose: Handler /redaman — laporan redaman DUA ARAH "selayaknya Telkom": sisi modem/ONU
 *          (GenieACS/TR-069, FORCE-REFRESH agar live & tidak basi) + sisi OLT (SNMP, snapshot
 *          ber-cache) + alasan putus terakhir (LOS vs Dying Gasp). Memberi vonis kualitas RX
 *          terhadap toleransi (config.rx_tolerance) dan kesimpulan singkat. READ-ONLY.
 * Caller: peta perintah di `index.js`.
 * Deps: `./resolve-helper`, `./olt-format`, `lib/telegram/telegram-format`,
 *       getCustomerRedaman (wifi), resolveByCustomer & getOltSnapshot (olt-optical-resolver) — diinjeksi.
 * MainFuncs: `createRedamanCommand(deps)` → handler(ctx).
 * SideEffects: refresh+query GenieACS + snapshot OLT, kirim balasan via ctx.reply.
 */
"use strict";

const { resolveCustomerOrReply, displayName, customerActionsKeyboard } = require("./resolve-helper");
const { b, code, escapeHtml } = require("../../../lib/telegram/telegram-format");
const { fmtOltLines } = require("./olt-format");
const { createRedamanDiagnosisService, buildKesimpulan } = require("../../../services/redaman-diagnosis.service");

// #b350: orkestrasi dua-sumber (ACS force-refresh + OLT snapshot + pppoeActive → resolveByCustomer →
// verdict) DIANGKAT ke services/redaman-diagnosis.service (dipakai bersama WA/panel/batch). Handler ini
// kini TIPIS: resolve pelanggan (khas Telegram) → service.diagnoseCustomer → rakit HTML Telegram.
// buildConclusion di-alias ke service.buildKesimpulan (logika kesimpulan tunggal).
function buildConclusion(modemVerdict, optical) {
    return buildKesimpulan(modemVerdict, optical);
}

function createRedamanCommand(deps) {
    // Service dibangun dari deps yang SAMA (getCustomerRedaman/resolveByCustomer/getOltSnapshot/
    // getActivePPPoEUsers/getConfig) → perilaku identik, tetap testable via injeksi.
    const diagnosis = createRedamanDiagnosisService(deps);

    return async function handleRedaman(ctx) {
        const user = await resolveCustomerOrReply(ctx, deps, { example: "/redaman budi@isp", command: "redaman" });
        if (!user) return;

        await ctx.reply(`⏳ Cek redaman ${b(displayName(user))} (refresh modem + OLT, mohon tunggu)…`);

        // Sisi modem (force-refresh) + OLT (snapshot) + sesi PPPoE aktif (SUMBER MAC utama match EPON)
        // — semua di dalam service, paralel & best-effort, never-throw.
        const d = await diagnosis.diagnoseCustomer(user, { caller: "telegram.redaman" });

        // ---- Sisi modem (HTML Telegram) ----
        const modemLines = ["— <b>Sisi Modem (ONU)</b> —"];
        if (!d.modem.hasDevice) {
            modemLines.push("Tidak ada device ACS (tidak terhubung GenieACS).");
        } else if (!d.modem.reachable) {
            modemLines.push("⚠️ Modem tidak terjangkau via GenieACS (offline / belum inform).");
        } else if (!d.modem.verdict || d.modem.verdict.value === null) {
            modemLines.push("RX: data redaman tidak tersedia.");
        } else {
            modemLines.push(`RX: ${d.modem.verdict.emoji} <b>${escapeHtml(String(d.modem.rxRaw))}</b> dBm — ${d.modem.verdict.label}`);
        }

        // ---- Sisi OLT (format Telegram yang sudah ada) ----
        const oltLines = ["— <b>Sisi OLT</b> —", ...fmtOltLines(d.olt)];

        const out = [`📶 <b>REDAMAN — ${escapeHtml(d.nama)}</b>`, `PPPoE: ${code(d.pppoe || "-")}`, "", ...modemLines, "", ...oltLines];
        if (d.kesimpulan) out.push("", d.kesimpulan);
        await ctx.reply(out.join("\n"), { replyMarkup: customerActionsKeyboard(user) });
    };
}

module.exports = { createRedamanCommand, buildConclusion };
