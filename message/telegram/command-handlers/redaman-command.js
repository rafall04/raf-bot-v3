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

const { resolveCustomerOrReply, displayName, firstPart, customerActionsKeyboard } = require("./resolve-helper");
const { b, code, escapeHtml, rxVerdict } = require("../../../lib/telegram/telegram-format");
const { fmtOltLines } = require("./olt-format");

function buildConclusion(modemVerdict, optical) {
    const oltOffline = optical && optical.identifiable && String(optical.status || "").toLowerCase() !== "online";
    if (oltOffline) {
        if (optical.isDyingGasp) return "Kesimpulan: ONU mati (Dying Gasp) — cek catu daya/adaptor di lokasi.";
        if (optical.isLos) return "Kesimpulan: LOS — kemungkinan fiber putus / konektor kotor / redaman parah.";
        return "Kesimpulan: ONU tidak online di OLT — perlu pengecekan fisik.";
    }
    if (modemVerdict && modemVerdict.label === "BURUK") {
        return "Kesimpulan: redaman BURUK — periksa konektor/splicing, jarak, atau bending kabel.";
    }
    if (modemVerdict && modemVerdict.label === "WASPADA") {
        return "Kesimpulan: redaman mendekati ambang — pantau, rapikan konektor bila perlu.";
    }
    if (modemVerdict && modemVerdict.label === "BAIK") {
        return "Kesimpulan: redaman dalam batas wajar. ✅";
    }
    return null;
}

function createRedamanCommand(deps) {
    const getCustomerRedaman = deps.getCustomerRedaman;
    const resolveByCustomer = deps.resolveByCustomer;
    const getOltSnapshot = deps.getOltSnapshot;
    const getConfig = deps.getConfig || (() => global.config || {});

    return async function handleRedaman(ctx) {
        const user = await resolveCustomerOrReply(ctx, deps, { example: "/redaman budi@isp", command: "redaman" });
        if (!user) return;

        const nama = displayName(user);
        const pppoe = firstPart(user.pppoe_username);
        const tolerance = getConfig().rx_tolerance;

        await ctx.reply(`⏳ Cek redaman ${b(nama)} (refresh modem + OLT, mohon tunggu)…`);

        // Sisi modem (force-refresh) & sisi OLT (snapshot ber-cache) paralel & best-effort.
        const [modemR, snapR] = await Promise.allSettled([
            user.device_id ? getCustomerRedaman(user.device_id) : Promise.resolve(null),
            getOltSnapshot(),
        ]);

        // ---- Sisi modem ----
        const modemLines = ["— <b>Sisi Modem (ONU)</b> —"];
        let modemVerdict = null;
        if (!user.device_id) {
            modemLines.push("Tidak ada device ACS (tidak terhubung GenieACS).");
        } else if (modemR.status !== "fulfilled" || !modemR.value) {
            modemLines.push("⚠️ Modem tidak terjangkau via GenieACS (offline / belum inform).");
        } else {
            const redaman = modemR.value.redaman;
            modemVerdict = rxVerdict(redaman, tolerance);
            if (modemVerdict.value === null) {
                modemLines.push("RX: data redaman tidak tersedia.");
            } else {
                modemLines.push(`RX: ${modemVerdict.emoji} <b>${escapeHtml(String(redaman))}</b> dBm — ${modemVerdict.label}`);
            }
        }

        // ---- Sisi OLT ----
        const snapshot = snapR.status === "fulfilled" ? snapR.value : null;
        let optical = null;
        try {
            optical = resolveByCustomer(user, { oltSnapshot: snapshot, pppoeActive: [] });
        } catch (__e) {
            optical = null;
        }
        const oltLines = ["— <b>Sisi OLT</b> —", ...fmtOltLines(optical)];

        // ---- Rakit laporan ----
        const out = [`📶 <b>REDAMAN — ${escapeHtml(nama)}</b>`, `PPPoE: ${code(pppoe || "-")}`, "", ...modemLines, "", ...oltLines];
        const conclusion = buildConclusion(modemVerdict, optical);
        if (conclusion) {
            out.push("", conclusion);
        }
        await ctx.reply(out.join("\n"), { replyMarkup: customerActionsKeyboard(user) });
    };
}

module.exports = { createRedamanCommand, buildConclusion };
