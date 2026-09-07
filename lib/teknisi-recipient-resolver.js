/**
 * Header Doc
 * Purpose: Resolver BERSAMA yang menyaring daftar penerima notif teknisi menurut PREFERENSI pribadi
 *   masing-masing (store #b354). SATU tempat untuk semua choke-point fan-out (LOS broadcaster, auto-
 *   tiket pickTeknisi, notif pasca-perbaikan) supaya aturan "alert hanya yang relevan" tak ditulis
 *   berkali-kali & tak drift. Dibuat di Fase A; DIPASANG ke choke-point pada Fase B.
 *
 *   INVARIAN KESELAMATAN — default = PERILAKU LAMA:
 *     • Gate config.teknisiPrefs.enabled != true  → kembalikan penerima APA ADANYA (applied:false).
 *     • Penerima tanpa accountId (nomor tambahan / grup) → SELALU dipertahankan (tak bisa dipersonalisasi).
 *     • Teknisi tanpa prefs tersimpan → getPrefs = default (semua kelas ON, area kosong=semua) → dipertahankan.
 *     • area alert tak diketahui (null) → JANGAN drop atas dasar area ("tak teramati" ≠ "tak relevan").
 *   Jadi mengaktifkan fitur ini tak pernah diam-diam membungkam alert bagi siapa pun yang belum menyetel.
 * Caller: (Fase B) lib/olt-los-broadcaster, services/los-ticket-service, services/report-notification-service.
 * Deps: ../repositories/teknisi-prefs.repository (default), `global.config` (gate).
 * MainFuncs: filterTeknisiRecipients, customerAreaKeys, teknisiCoversArea, isQuietNow, isSnoozed.
 * SideEffects: Tidak ada (murni; hanya membaca store & config).
 */
"use strict";

const defaultPrefsRepo = require("../repositories/teknisi-prefs.repository");

function gateEnabled(config) {
    const cfg = (config && config.teknisiPrefs) || (typeof global !== "undefined" && global.config && global.config.teknisiPrefs) || {};
    return cfg.enabled === true;
}

/** Menit-sejak-tengah-malam dari "HH:MM" (mengembalikan null bila format salah). */
function hhmmToMinutes(s) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(s || ""));
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
}

/** Apakah `now` berada dalam rentang jam-diam (mendukung rentang lewat tengah malam, mis. 22:00–06:00). */
function isQuietNow(quietHours, now = new Date()) {
    if (!quietHours || !quietHours.enabled) return false;
    const start = hhmmToMinutes(quietHours.start);
    const end = hhmmToMinutes(quietHours.end);
    if (start === null || end === null) return false;
    // TZ proses dipaksa Asia/Jakarta (index.js) → getHours lokal = waktu Jakarta.
    const cur = now.getHours() * 60 + now.getMinutes();
    if (start === end) return false;            // rentang nol = tak pernah diam
    return start < end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

/** Apakah snooze masih aktif pada `now`. */
function isSnoozed(snoozeUntil, now = new Date()) {
    if (!snoozeUntil) return false;
    const t = Date.parse(snoozeUntil);
    return Number.isFinite(t) && t > now.getTime();
}

/** Normalisasi satu kunci area (case-insensitive, buang spasi tepi). */
function normArea(s) { return String(s == null ? "" : s).trim().toLowerCase(); }

/**
 * Kunci area kandidat milik satu pelanggan — MENGIKUTI model kanonik matchRuleTarget
 * (auto-outage-rule.service): area/zone + connected_odp_id/odp/odp_id. Teknisi berlangganan
 * SALAH SATU-nya di prefs.areas (boleh ketik nama area, zona, atau id ODP).
 * @returns {string[]} kunci ter-normalisasi, unik, tanpa yang kosong.
 */
function customerAreaKeys(user = {}) {
    const raw = [user.area, user.zone, user.connected_odp_id, user.odp, user.odp_id];
    const out = [];
    const seen = new Set();
    for (const v of raw) {
        const k = normArea(v);
        if (k && !seen.has(k)) { seen.add(k); out.push(k); }
    }
    return out;
}

/**
 * Apakah area langganan teknisi mencakup alert ini.
 * FAIL-OPEN: teknisi tak mengisi area (kosong) ⇒ SEMUA area; area alert tak diketahui ⇒ dicakup
 * ("tak teramati" ≠ "tak relevan"). Drop HANYA bila teknisi punya daftar area DAN tak satu pun
 * kunci alert cocok.
 * @param {string[]} prefAreas  prefs.areas teknisi.
 * @param {string|string[]|null} area  kunci area alert (skalar atau daftar kandidat).
 */
function teknisiCoversArea(prefAreas, area) {
    if (!Array.isArray(prefAreas) || prefAreas.length === 0) return true;
    const candidates = (Array.isArray(area) ? area : [area]).map(normArea).filter(Boolean);
    if (candidates.length === 0) return true;                 // area tak diketahui → jangan drop
    const set = new Set(prefAreas.map(normArea).filter(Boolean));
    return candidates.some((c) => set.has(c));
}

/**
 * Saring penerima menurut preferensi per-teknisi.
 *
 * @param {object}  opsi
 * @param {Array}   opsi.recipients  Daftar penerima. Tiap item {accountId?, jid, ...}. accountId absen
 *                                   = tak dipersonalisasi (selalu lolos).
 * @param {string}  [opsi.alertClass]  'los'|'redaman'|'ticket_new'|'post_repair' — dicek ke prefs.alerts.
 * @param {string}  [opsi.area]        areaKey/odpId alert; disaring ke prefs.areas bila teknisi mengisinya.
 * @param {boolean} [opsi.critical]    true = abaikan jam-diam & snooze (mis. LOS mendesak); kelas & master tetap dihormati.
 * @param {Date}    [opsi.now]         waktu acuan (uji).
 * @param {object}  [opsi.config]      default global.config (gate).
 * @param {object}  [opsi.prefsRepo]   default repository teknisi-prefs (uji).
 * @returns {{applied:boolean, recipients:Array, dropped:Array<{recipient:object,reason:string}>}}
 */
function filterTeknisiRecipients(opsi = {}) {
    const { recipients = [], alertClass, area, critical = false, now = new Date() } = opsi;
    const config = opsi.config || (typeof global !== "undefined" ? global.config : null);
    const prefsRepo = opsi.prefsRepo || defaultPrefsRepo;

    if (!gateEnabled(config)) return { applied: false, recipients: recipients.slice(), dropped: [] };

    const kept = [];
    const dropped = [];
    for (const r of recipients) {
        const accountId = r && (r.accountId != null ? r.accountId : r.id);
        if (accountId == null) { kept.push(r); continue; }      // tak bisa dipersonalisasi → lolos

        const p = prefsRepo.getPrefs(accountId);
        if (p.enabled === false) { dropped.push({ recipient: r, reason: "master-off" }); continue; }
        if (alertClass && p.alerts && p.alerts[alertClass] === false) { dropped.push({ recipient: r, reason: "kelas-off:" + alertClass }); continue; }
        if (!teknisiCoversArea(p.areas, area)) { dropped.push({ recipient: r, reason: "luar-area" }); continue; }
        if (!critical) {
            if (isSnoozed(p.snoozeUntil, now)) { dropped.push({ recipient: r, reason: "snooze" }); continue; }
            if (isQuietNow(p.quietHours, now)) { dropped.push({ recipient: r, reason: "jam-diam" }); continue; }
        }
        kept.push(r);
    }
    return { applied: true, recipients: kept, dropped };
}

module.exports = { filterTeknisiRecipients, customerAreaKeys, teknisiCoversArea, isQuietNow, isSnoozed, hhmmToMinutes, normArea };
