/**
 * Header Doc
 * Purpose: Handler WA SELF-SERVICE preferensi teknisi (RONDE 6). Fase A: `setelan saya` (tampil
 *   preferensi aktif). Fase B: `alert area <x>` / `alert on|off` / `alert <kelas> on|off`. Fase C:
 *   `pantau interval <2m>` / `pantau target <-22>`. Semua STAF-ONLY, one-liner (bukan wizard), baca/
 *   tulis store per-teknisi keyed account.id. GATED config.teknisiPrefs.enabled.
 * Caller: message/raf.js (intent SETELAN_SAYA / ALERT_PREF / PANTAU_PREF via wifi-intents wrapper).
 * Deps: ../../repositories/teknisi-prefs.repository, ./template-helpers (renderResponseTemplate).
 * MainFuncs: handleSetelanSaya, handleAlertPref, handlePantauPref.
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

module.exports = { handleSetelanSaya, ensureAccess, ringkasPrefs, gateOn, accountOf };
