/**
 * Header Doc
 * Purpose: Perintah WhatsApp assignment papan PSB (Fase B/2) — one-shot (TANPA conversation state):
 *          `ambil PSB-<n>` (teknisi klaim), `tugaskan PSB-<n> ke <teknisi>` (admin), `papan psb`
 *          (list belum kepasang). Pakai core `assignSchedule` + builder DM/notif yang SAMA dgn web
 *          (b129) → seragam. Dipicu inline dari `raf.js` (gated psbIntake.enabled + akun staf).
 * Caller: `message/raf.js` (trigger `^(ambil|tugaskan|papan|daftar)\s+psb`).
 * Deps (inject/patuh [[raf-invariants]]): `lib/psb-schedule-service` (assignSchedule/listSchedules/
 *        buildAssignmentDm/buildAssignmentGroupNotif), `message/handlers/reply-runtime` (sendReply,
 *        DM teknisi + grup), `lib/jid-utils` (normalizePhoneToJid), `template-helpers`
 *        (renderResponseTemplate), `global.accounts` (resolusi teknisi), `global.config` (grup).
 * MainFuncs: `handlePsbAssignCommand({text,staff,reply}, _deps)`.
 * SideEffects: Tulis papan `psb_schedule` (assign) + kirim WA (reply aktor + DM teknisi + notif grup),
 *              semua NEVER-THROW.
 */
"use strict";

const ADMIN_ROLES = ["admin", "owner", "superadmin"];

function withDeps(d = {}) {
    return {
        scheduleService: d.scheduleService || require("../../lib/psb-schedule-service"),
        sendReply: d.sendReply || ((arg) => require("./reply-runtime").sendReply(arg)),
        normalizePhoneToJid: d.normalizePhoneToJid || require("../../lib/jid-utils").normalizePhoneToJid,
        renderTpl: d.renderTpl || defaultRenderTpl,
        accounts: d.accounts || (global.accounts || []),
        config: d.config || (global.config || {})
    };
}

function defaultRenderTpl(key, fallback, data) {
    try {
        const { renderResponseTemplate } = require("./template-helpers");
        const r = renderResponseTemplate(key, fallback, data || {});
        if (r && String(r).trim()) return r;
    } catch (_e) { /* fall through ke fallback */ }
    return fallback;
}

async function safeReply(reply, text) {
    try { if (typeof reply === "function") await reply(text, { skipDuplicateCheck: true }); } catch (_e) { /* NEVER-THROW */ }
}

function parseRef(token) {
    const m = String(token || "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
}
function isAdmin(staff) { return staff && ADMIN_ROLES.includes(String(staff.role || "").toLowerCase()); }
function teknisiAccounts(accounts) { return (accounts || []).filter((a) => a && String(a.role || "").toLowerCase() === "teknisi"); }

// Resolusi teknisi dari teks bebas: username/id eksak dulu, lalu nama/username "contains".
function resolveTeknisi(query, accounts) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    const tek = teknisiAccounts(accounts);
    const exact = tek.filter((a) => String(a.username || "").toLowerCase() === q || String(a.id) === q);
    if (exact.length) return exact;
    return tek.filter((a) => String(a.name || "").toLowerCase().includes(q) || String(a.username || "").toLowerCase().includes(q));
}

function reasonText(reason, ref) {
    const map = {
        already_installed: `${ref} sudah terpasang.`,
        cancelled: `${ref} sudah dibatalkan.`,
        already_assigned: `${ref} sudah dipegang teknisi lain. Minta admin *tugaskan* untuk mengalihkan.`,
        not_found: `Jadwal ${ref} tak ditemukan. Ketik *papan psb* untuk lihat daftar.`,
        no_teknisi: "Teknisi tak valid."
    };
    return map[reason] || `Tak bisa memproses ${ref}.`;
}

// DM teknisi (bila punya nomor) + announce grup. Best-effort, NEVER-THROW. Teks = builder service.
async function notifyGroupAndTeknisi(deps, record, teknisiAccount, { mode, assignedByName }) {
    try {
        if (teknisiAccount && teknisiAccount.phone_number) {
            const jid = deps.normalizePhoneToJid(teknisiAccount.phone_number);
            if (jid) await deps.sendReply({ recipient: jid, text: deps.scheduleService.buildAssignmentDm(record, { assignedByName, mode }) });
        }
        const psbCfg = deps.config.psbIntake || {};
        const groupId = psbCfg.summaryGroupId || psbCfg.groupId;
        if (groupId) await deps.sendReply({ recipient: groupId, text: deps.scheduleService.buildAssignmentGroupNotif(record, { mode, assignedByName }) });
    } catch (e) { console.error("[PSB_ASSIGN_WA_NOTIF_ERROR]", e.message); }
}

// ── ambil PSB-<n> (teknisi/staf klaim sendiri) ──
async function handleAmbil({ text, staff, reply }, deps) {
    const id = parseRef(String(text).replace(/^\s*ambil\s+psb/i, ""));
    if (!id) return safeReply(reply, deps.renderTpl("psb_cmd_format", "⚠️ Format: *ambil PSB-12* · *tugaskan PSB-12 ke <teknisi>* · *papan psb*.", {}));
    const ref = `PSB-${id}`;
    const result = await deps.scheduleService.assignSchedule({
        scheduleId: id, teknisiId: staff.id, teknisiName: staff.name || staff.username,
        assignedById: staff.id, assignedByName: staff.name || staff.username, mode: "claim"
    });
    if (!result.ok) return safeReply(reply, deps.renderTpl("psb_assign_error", `❌ ${reasonText(result.reason, ref)}`, { pesan: reasonText(result.reason, ref) }));
    // Aktor = teknisi → balas detail (DM ke diri sendiri = reply ini); grup diumumkan.
    await safeReply(reply, deps.scheduleService.buildAssignmentDm(result.record, { mode: "claim" }));
    await notifyGroupAndTeknisi(deps, result.record, null, { mode: "claim" });
}

// ── tugaskan PSB-<n> ke <teknisi> (admin) ──
async function handleTugaskan({ text, staff, reply }, deps) {
    if (!isAdmin(staff)) return safeReply(reply, deps.renderTpl("psb_tugaskan_denied", "❌ Hanya admin yang bisa *tugaskan*. Teknisi pakai *ambil PSB-<n>*.", {}));
    const rest = String(text).replace(/^\s*tugaskan\s+psb/i, ""); // mis. "-12 ke davin"
    const id = parseRef(rest.split(/\bke\b/i)[0]);
    const keM = rest.match(/\bke\b\s+(.+)$/i);
    const teknisiQ = keM ? keM[1].trim() : "";
    if (!id || !teknisiQ) return safeReply(reply, deps.renderTpl("psb_cmd_format", "⚠️ Format: *tugaskan PSB-12 ke <nama/username teknisi>*.", {}));
    const matches = resolveTeknisi(teknisiQ, deps.accounts);
    if (matches.length === 0) return safeReply(reply, deps.renderTpl("psb_teknisi_notfound", `❌ Teknisi "${teknisiQ}" tak ditemukan. Coba username-nya.`, { query: teknisiQ }));
    if (matches.length > 1) {
        const daftar = matches.slice(0, 8).map((a) => `• ${a.name || a.username} (${a.username})`).join("\n");
        return safeReply(reply, deps.renderTpl("psb_teknisi_multiple", `❌ Teknisi "${teknisiQ}" cocok lebih dari satu:\n${daftar}\nSebut username-nya.`, { query: teknisiQ, daftar }));
    }
    const teknisi = matches[0];
    const ref = `PSB-${id}`;
    const result = await deps.scheduleService.assignSchedule({
        scheduleId: id, teknisiId: teknisi.id, teknisiName: teknisi.name || teknisi.username,
        assignedById: staff.id, assignedByName: staff.name || staff.username, mode: "assign"
    });
    if (!result.ok) return safeReply(reply, deps.renderTpl("psb_assign_error", `❌ ${reasonText(result.reason, ref)}`, { pesan: reasonText(result.reason, ref) }));
    await notifyGroupAndTeknisi(deps, result.record, teknisi, { mode: "assign", assignedByName: staff.name || staff.username });
    return safeReply(reply, deps.renderTpl("psb_tugaskan_ok", `✅ ${result.record.ref} ditugaskan ke *${teknisi.name || teknisi.username}*. DM terkirim ke teknisi.`, { ref: result.record.ref, teknisi: teknisi.name || teknisi.username }));
}

// ── papan psb / daftar psb (list belum kepasang) ──
async function handlePapan({ staff, reply }, deps) {
    const rows = await deps.scheduleService.listSchedules({});
    const open = (rows || []).filter((r) => r.status === "menunggu" || r.status === "ditugaskan");
    if (!open.length) return safeReply(reply, deps.renderTpl("psb_papan_empty", "📋 Papan PSB kosong — semua sudah kepasang. 🎉", {}));
    const lines = open.slice(0, 30).map((r) => {
        const st = r.status === "menunggu" ? "🟡 menunggu" : `🔵 ditugaskan → ${r.assigned_teknisi_name || "?"}`;
        return `${r.ref} · ${r.name} (Dusun ${r.dusun || "-"}) — ${st}`;
    }).join("\n");
    const hint = isAdmin(staff) ? "\n\n_Admin: *tugaskan PSB-<n> ke <teknisi>*_" : "\n\n_Ketik *ambil PSB-<n>* untuk mengambil._";
    return safeReply(reply, deps.renderTpl("psb_papan_list", `📋 *Papan PSB — belum kepasang* (${open.length})\n\n${lines}${hint}`, { count: open.length, lines, hint }));
}

/**
 * Entry inline dari raf.js. context = { text, staff, reply }. NEVER-THROW.
 * staff = akun aktor (resolveAuthorizedStaff) → {id,name,role,phone_number}.
 */
async function handlePsbAssignCommand(context, _deps) {
    const { text, staff, reply } = context || {};
    const deps = withDeps(_deps);
    const t = String(text || "").trim();
    try {
        if (/^\s*(papan|daftar)\s+psb/i.test(t)) return await handlePapan({ staff, reply }, deps);
        if (/^\s*tugaskan\s+psb/i.test(t)) return await handleTugaskan({ text: t, staff, reply }, deps);
        if (/^\s*ambil\s+psb/i.test(t)) return await handleAmbil({ text: t, staff, reply }, deps);
    } catch (err) {
        console.warn(`[PSB_ASSIGN_CMD] gagal: ${err.message}`);
        try { await reply("Maaf, gagal memproses perintah PSB. Coba lagi ya."); } catch (_e) { /* NEVER-THROW */ }
    }
}

module.exports = {
    handlePsbAssignCommand,
    _internal: { parseRef, resolveTeknisi, isAdmin, reasonText }
};
