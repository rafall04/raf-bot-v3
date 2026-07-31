/**
 * Header Doc
 * Purpose: Handler /cek (alias /diagnosa) — DIAGNOSA LENGKAP one-shot untuk teknisi. Mengumpulkan
 *          status PPPoE (+deteksi gangguan area), redaman modem (GenieACS force-refresh) & OLT
 *          (SNMP, LOS/Dying-Gasp), lalu menyajikan VONIS berperingkat (🟢/🟡/🔴) + penyebab +
 *          saran tindakan dalam satu pesan ringkas. READ-ONLY: tidak mengeksekusi aksi apa pun.
 * Caller: peta perintah di `index.js`; tombol "🩺 Cek Lengkap" (callback do:cek:<id>).
 * Deps: `./resolve-helper`, `./diagnosis-verdict`, `lib/telegram/telegram-format`,
 *       `lib/area-outage-gate` (verdict gangguan area — satu pemilik rumus ambang),
 *       getActivePPPoEUsers (mikrotik), getCustomerRedaman (wifi), resolveByCustomer & getOltSnapshot
 *       (olt-optical-resolver), getUsers/getConfig — semua diinjeksi.
 * MainFuncs: `createCekCommand(deps)` → handler(ctx).
 * SideEffects: query MikroTik + GenieACS (refresh) + snapshot OLT; kirim balasan via ctx.reply.
 */
"use strict";

const { resolveCustomerOrReply, displayName, firstPart, customerActionsKeyboard } = require("./resolve-helper");
const { buildVerdict } = require("./diagnosis-verdict");
const { b, code, escapeHtml, statusBadge, rxVerdict } = require("../../../lib/telegram/telegram-format");
const { evaluateAreaOutage } = require("../../../lib/area-outage-gate");

function unwrapList(res) {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    if (res && res.data && Array.isArray(res.data.data)) return res.data.data;
    return [];
}

function nowWib() {
    return new Date().toLocaleTimeString("id-ID", {
        timeZone: "Asia/Jakarta",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

async function collect(user, deps) {
    const pppoe = firstPart(user.pppoe_username).toLowerCase();
    const users = (deps.getUsers ? deps.getUsers() : global.users) || [];

    // 1) PPPoE aktif + heuristik gangguan area.
    let activeList = [];
    let mikrotikOk = false;
    try {
        const res = await deps.getActivePPPoEUsers({ caller: "telegram.cek" });
        if (!(res && res.ok === false)) {
            activeList = unwrapList(res);
            mikrotikOk = true;
        }
    } catch (__e) {
        mikrotikOk = false;
    }
    const activeSet = new Set(activeList.map((s) => String(s.name || "").trim().toLowerCase()).filter(Boolean));

    let lineStatus = "unknown";
    let areaOutage = false;
    let offlineCount = 0;
    if (mikrotikOk && pppoe) {
        lineStatus = activeSet.has(pppoe) ? "online" : "offline";
        if (lineStatus === "offline") {
            const withPppoe = users.filter((u) => u.pppoe_username);
            offlineCount = withPppoe.filter((u) => !activeSet.has(firstPart(u.pppoe_username).toLowerCase())).length;
            // Rumus ambangnya milik `lib/area-outage-gate` — dulu disalin di sini dan di handler
            // cek koneksi pelanggan, jadi keduanya bisa memberi verdict berbeda untuk momen sama.
            areaOutage = evaluateAreaOutage({
                offlineCount,
                totalWithPppoe: withPppoe.length,
                config: deps.getConfig ? deps.getConfig() : global.config,
            }).areaOutage;
        }
    }

    // 2) Redaman modem (force-refresh, best-effort).
    let modemRx = null;
    if (user.device_id) {
        try {
            const r = await deps.getCustomerRedaman(user.device_id);
            modemRx = r ? r.redaman : null;
        } catch (__e) {
            modemRx = null;
        }
    }

    // 3) Sisi OLT (snapshot ber-cache).
    let optical = null;
    try {
        const snapshot = await deps.getOltSnapshot();
        optical = deps.resolveByCustomer(user, { oltSnapshot: snapshot, pppoeActive: activeList });
    } catch (__e) {
        optical = null;
    }

    return { pppoe, lineStatus, areaOutage, offlineCount, modemRx, optical, mikrotikOk, hasDevice: !!user.device_id };
}

function fmtKoneksiLine(d) {
    if (!d.mikrotikOk) return "🔌 Koneksi: ⚪ tak bisa dicek (MikroTik tak terjangkau)";
    if (d.lineStatus === "online") return "🔌 Koneksi: 🟢 Online";
    if (d.lineStatus === "offline" && d.areaOutage) return `🔌 Koneksi: 🔴 Terputus (gangguan area ~${d.offlineCount})`;
    if (d.lineStatus === "offline") return "🔌 Koneksi: 🔴 Terputus";
    return "🔌 Koneksi: ⚪ -";
}

function fmtModemLine(d, tolerance) {
    if (!d.hasDevice) return "📶 Redaman modem: — (tak ada device ACS)";
    if (d.modemRx == null) return "📶 Redaman modem: ⚠️ modem tak terjangkau";
    const v = rxVerdict(d.modemRx, tolerance);
    if (v.value == null) return "📶 Redaman modem: data tidak tersedia";
    return `📶 Redaman modem: ${v.emoji} <b>${escapeHtml(String(d.modemRx))}</b> dBm — ${v.label}`;
}

function fmtOltLineCompact(optical) {
    if (!optical || !optical.identifiable) return "🛰️ OLT: ❔ tak terpetakan ke ONU";
    let line = `🛰️ OLT: ${statusBadge(optical.status)} ${escapeHtml(optical.status)}`;
    if (optical.rxPower != null && optical.rxPower !== "N/A") line += ` · RX <b>${escapeHtml(String(optical.rxPower))}</b> dBm`;
    if (optical.ponName) line += ` · PON ${escapeHtml(String(optical.ponName))}`;
    return line;
}

function createCekCommand(deps) {
    const getConfig = deps.getConfig || (() => global.config || {});

    return async function handleCek(ctx) {
        const user = await resolveCustomerOrReply(ctx, deps, { example: "/cek budi@isp", command: "cek" });
        if (!user) return;

        const nama = displayName(user);
        const pppoe = firstPart(user.pppoe_username);
        const tolerance = getConfig().rx_tolerance;

        await ctx.reply(`⏳ Diagnosa lengkap ${b(nama)}… (cek koneksi, redaman modem & OLT)`);

        const d = await collect(user, deps);
        const verdict = buildVerdict({
            lineStatus: d.lineStatus,
            areaOutage: d.areaOutage,
            offlineCount: d.offlineCount,
            oltStatus: d.optical ? d.optical.status : null,
            isLos: d.optical ? d.optical.isLos : false,
            isDyingGasp: d.optical ? d.optical.isDyingGasp : false,
            modemRxRaw: d.modemRx,
            oltRxRaw: d.optical ? d.optical.rxPower : null,
            tolerance,
        });

        const out = [
            `🩺 <b>DIAGNOSA — ${escapeHtml(nama)}</b>`,
            `PPPoE: ${code(pppoe || "-")}`,
            "",
            `${verdict.emoji} <b>${escapeHtml(verdict.headline)}</b>`,
            escapeHtml(verdict.penyebab),
            "",
            "— Rincian —",
            fmtKoneksiLine(d),
            fmtModemLine(d, tolerance),
            fmtOltLineCompact(d.optical),
        ];
        if (verdict.saran) out.push("", `💡 ${escapeHtml(verdict.saran)}`);
        out.push("", `🕒 diperbarui ${nowWib()} WIB`);

        await ctx.reply(out.join("\n"), { replyMarkup: customerActionsKeyboard(user) });
    };
}

module.exports = { createCekCommand, collect, fmtKoneksiLine, fmtModemLine, fmtOltLineCompact };
