/**
 * Header Doc
 * Purpose: Handler WA SELF-SERVICE preferensi teknisi (RONDE 6). Fase A: `setelan saya` (tampil
 *   preferensi aktif). Fase B: `alert on|off` / `alert <kelas> on|off` / `alert area <x>` /
 *   `alert kanal dm|grup|both`. Semua STAF-ONLY, one-liner (bukan wizard), baca/tulis store per-
 *   teknisi keyed account.id. GATED config.teknisiPrefs.enabled.
 * Caller: message/raf.js (intent SETELAN_SAYA / ALERT_PREF via wifi-intents wrapper).
 * Deps: ../../repositories/teknisi-prefs.repository, ./template-helpers (renderResponseTemplate).
 * MainFuncs: handleSetelanSaya, handleAlertPref.
 * SideEffects: Menulis database/teknisi_prefs.json (via repository, atomik); balas WA via reply.
 */
"use strict";

const prefsRepo = require("../../repositories/teknisi-prefs.repository");
const { renderResponseTemplate } = require("./template-helpers");

function gateOn(globalScope) {
    const cfg = (globalScope && globalScope.config) || (typeof global !== "undefined" && global.config) || {};
    return !!(cfg.teknisiPrefs && cfg.teknisiPrefs.enabled === true);
}
function accountOf(p) {
    // isTeknisi = OBJEK akun (raf-context) bila teknisi/admin/owner ber-akun; punya .id.
    return p.isTeknisi && p.isTeknisi.id != null ? p.isTeknisi : null;
}
function ensureAccess(p) {
    const { isOwner, isTeknisi, reply, mess } = p;
    if (!isTeknisi && !isOwner) { reply((mess && mess.teknisiOrOwnerOnly) || "⛔ Fitur ini khusus teknisi/admin."); return null; }
    if (!gateOn(p.global)) { reply(renderResponseTemplate("teknisi_prefs_disabled", "ℹ️ Fitur setelan teknisi belum diaktifkan (config.teknisiPrefs.enabled).", {})); return null; }
    const acc = accountOf(p);
    if (!acc) { reply(renderResponseTemplate("teknisi_prefs_no_account", "⚠️ Setelan ini untuk akun teknisi. Akunmu belum terhubung — hubungi admin.", {})); return null; }
    return acc;
}

function ringkasPrefs(prefs) {
    const on = (b) => (b ? "✅" : "❌");
    const kelas = prefs.alerts;
    const area = (prefs.areas && prefs.areas.length) ? prefs.areas.join(", ") : "SEMUA area";
    const snooze = prefs.snoozeUntil ? ` (snooze s/d ${prefs.snoozeUntil})` : "";
    const qh = prefs.quietHours && prefs.quietHours.enabled ? `${prefs.quietHours.start}–${prefs.quietHours.end}` : "off";
    const lines = [
        "⚙️ *Setelan Saya (teknisi)*",
        `Alert aktif: ${prefs.enabled ? "YA" : "TIDAK"}${snooze}`,
        `Area langganan: ${area}`,
        `Kelas alert: LOS ${on(kelas.los)} · Redaman ${on(kelas.redaman)} · Tiket-baru ${on(kelas.ticket_new)} · Pasca-perbaikan ${on(kelas.post_repair)}`,
        `Kanal: ${prefs.channel}  |  Jam-diam: ${qh}`,
    ];
    if (prefs.pantau && (prefs.pantau.intervalMs || prefs.pantau.targetDbm)) {
        const it = prefs.pantau.intervalMs ? `${Math.round(prefs.pantau.intervalMs / 60000)}mnt` : "default";
        lines.push(`Pantau pribadi: interval ${it}${prefs.pantau.targetDbm ? `, target ${prefs.pantau.targetDbm} dBm` : ""}`);
    }
    lines.push("", "_Ubah: `alert off` · `alert area <nama>` · `alert los off` · `pantau interval 2m`_");
    return lines.join("\n");
}

/** `setelan saya` — tampilkan preferensi aktif (read-only). */
async function handleSetelanSaya(p) {
    const acc = ensureAccess(p);
    if (!acc) return;
    return p.reply(ringkasPrefs(prefsRepo.getPrefs(acc.id)));
}

// Kelas alert & alias bahasa yang diterima dari WA.
const KELAS_ALIAS = {
    los: "los", fiber: "los",
    redaman: "redaman", optik: "redaman", rx: "redaman",
    tiket: "ticket_new", "tiket-baru": "ticket_new", ticket: "ticket_new",
    perbaikan: "post_repair", "pasca-perbaikan": "post_repair", pasca: "post_repair",
};
const NYALA = new Set(["on", "aktif", "nyala", "hidup", "ya"]);
const MATI = new Set(["off", "mati", "nonaktif", "matikan", "tidak"]);
function parseOnOff(tok) {
    if (NYALA.has(tok)) return true;
    if (MATI.has(tok)) return false;
    return null;
}
const ALERT_HELP =
    "⚙️ *Atur Alert (teknisi)*\n" +
    "• `alert on` / `alert off` — hidup/matikan SEMUA alert\n" +
    "• `alert los off` · `alert redaman on` · `alert tiket off` · `alert perbaikan on`\n" +
    "• `alert area Krajan, ODP-01` — hanya area itu (kosongkan: `alert area semua`)\n" +
    "• `alert kanal dm|grup|both`\n" +
    "Lihat setelan: `setelan saya`";

/** `alert ...` — ubah preferensi alert (on/off, per-kelas, area, kanal). STAF-ONLY, gated. */
async function handleAlertPref(p) {
    const acc = ensureAccess(p);
    if (!acc) return;
    const q = String(p.qAfterKeyword || "").trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return p.reply(renderResponseTemplate("teknisi_alert_help", ALERT_HELP, {}));

    const head = tokens[0].toLowerCase();
    let patch = null;
    let catatan = "";

    if (head === "area") {
        const rest = q.slice(tokens[0].length).trim();
        const kosong = !rest || ["semua", "all", "kosong", "clear", "reset"].includes(rest.toLowerCase());
        const areas = kosong ? [] : rest.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
        patch = { areas };
        catatan = kosong ? "Area langganan dikosongkan → terima alert SEMUA area." : `Area langganan: ${areas.join(", ")}.`;
    } else if (head === "kanal" || head === "channel") {
        const val = (tokens[1] || "").toLowerCase();
        const kanal = val === "grup" ? "group" : val;
        if (!["dm", "group", "both"].includes(kanal)) return p.reply("Kanal harus: dm / grup / both.");
        patch = { channel: kanal };
        catatan = `Kanal alert: ${kanal}.`;
    } else if (KELAS_ALIAS[head]) {
        const kelas = KELAS_ALIAS[head];
        const val = parseOnOff((tokens[1] || "").toLowerCase());
        if (val === null) return p.reply(`Format: \`alert ${head} on\` atau \`alert ${head} off\`.`);
        patch = { alerts: { [kelas]: val } };
        catatan = `Alert ${head}: ${val ? "AKTIF ✅" : "NONAKTIF ❌"}.`;
    } else {
        const val = parseOnOff(head);
        if (val === null) return p.reply(renderResponseTemplate("teknisi_alert_help", ALERT_HELP, {}));
        patch = { enabled: val };
        catatan = val ? "Alert DIHIDUPKAN ✅." : "Semua alert DIMATIKAN ❌ (kamu tak akan diganggu).";
    }

    const prefs = prefsRepo.setPrefs(acc.id, patch);
    return p.reply(`✅ ${catatan}\n\n${ringkasPrefs(prefs)}`);
}

module.exports = { handleSetelanSaya, handleAlertPref, ensureAccess, ringkasPrefs, gateOn, accountOf };
