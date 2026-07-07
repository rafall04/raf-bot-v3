/**
 * Header Doc
 * Purpose: Service switch koneksi WAN — mengalihkan trafik antar-ISP instan dengan mengaktif/
 *          nonaktifkan route default via bridge RouterOS. Hanya switch TERDAFTAR di config
 *          (allowlist) yang boleh dijalankan; setiap apply melalui plan-verify (pastikan route
 *          cocok, anti topology-drift), audit, dan notifikasi admin. Reversible (restore).
 * Caller: `routes/admin-wan-switch-routes.js` (panel) dan
 *         `message/handlers/state-domains/wan-switch.state.js` (WhatsApp owner/admin).
 * Deps: `child_process.spawn` (php `views/mikrotik_route_switch.php`), kredensial router dari
 *       `config.upstreamMonitor` (router yang sama), `lib/whatsapp-critical-delivery.sendCritical`,
 *       `lib/admin-recipients.getAdminJids`, `repositories/upstream-quality.repository` (audit incident).
 * MainFuncs: `getSwitchConfig`, `listSwitches`, `getStatus`, `applySwitch`, `restoreSwitch`.
 * SideEffects: Mode apply MENULIS route di router (aktif/nonaktif); tulis audit incident; kirim WA
 *              admin (never-throw). Read (status/plan) tidak menulis apa pun.
 */
"use strict";

const path = require("path");
const { spawn } = require("child_process");

function getRouterCreds() {
    const up = (global.config && global.config.upstreamMonitor) || {};
    const sw = (global.config && global.config.wanSwitch) || {};
    return {
        host: sw.host || up.host || null,
        port: Number(sw.port || up.port) || 8728,
        user: sw.user || up.user || null,
        password: sw.password || up.password || null
    };
}

function getSwitchConfig() {
    const cfg = (global.config && global.config.wanSwitch) || {};
    const creds = getRouterCreds();
    const switches = Array.isArray(cfg.switches)
        ? cfg.switches.filter((s) => s && s.id && Array.isArray(s.operations) && s.operations.length)
        : [];
    return {
        enabled: cfg.enabled === true,
        recipients: Array.isArray(cfg.recipients) ? cfg.recipients : [],
        notifyAdmins: cfg.notifyAdmins !== false,
        switches,
        creds,
        valid: Boolean(creds.host && creds.user && creds.password)
    };
}

function findSwitch(id) {
    return getSwitchConfig().switches.find((s) => s.id === id) || null;
}

function listSwitches() {
    return getSwitchConfig().switches.map((s) => ({
        id: s.id,
        label: s.label || s.id,
        affects: s.affects || null,
        note: s.note || null
    }));
}

/**
 * Bangun ops untuk bridge dari definisi switch + arah.
 * op.apply 'disable' → applyDisabled=true. direction 'apply' pakai applyDisabled;
 * 'restore' membalik (kembalikan ke kondisi normal).
 */
function buildOps(def, direction) {
    return def.operations.map((op) => {
        const applyDisabled = String(op.apply || "disable").toLowerCase() === "disable";
        const disabled = direction === "restore" ? !applyDisabled : applyDisabled;
        return { match: op.match || {}, disabled };
    });
}

function runBridge(spec, creds, timeoutMs = 25000) {
    const scriptPath = path.resolve(__dirname, "..", "views", "mikrotik_route_switch.php");
    return new Promise((resolve) => {
        const childEnv = {
            ...process.env,
            MTIN_UPQ_HOST: String(creds.host),
            MTIN_UPQ_PORT: String(creds.port),
            MTIN_UPQ_USER: String(creds.user),
            MTIN_UPQ_PASS: String(creds.password)
        };
        let child;
        try {
            child = spawn("php", [scriptPath, JSON.stringify(spec)], {
                cwd: path.resolve(__dirname, ".."),
                windowsHide: true,
                env: childEnv
            });
        } catch (err) {
            return resolve({ status: "error", message: `Gagal spawn php: ${err.message}` });
        }
        let stdout = "";
        let stderr = "";
        let finished = false;
        const finalize = (r) => { if (!finished) { finished = true; clearTimeout(timer); resolve(r); } };
        const timer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch (_e) { /* abaikan */ }
            finalize({ status: "error", message: `Bridge switch timeout ${Math.round(timeoutMs / 1000)}s.` });
        }, timeoutMs);
        child.stdout.on("data", (d) => { stdout += d; });
        child.stderr.on("data", (d) => { stderr += d; });
        child.on("error", (err) => finalize({ status: "error", message: `Bridge error: ${err.message}` }));
        child.on("close", () => {
            const trimmed = (stdout || "").trim();
            if (!trimmed) return finalize({ status: "error", message: (stderr || "Bridge tanpa output.").trim().slice(0, 400) });
            try { finalize(JSON.parse(trimmed)); } catch (err) { finalize({ status: "error", message: `Output tidak valid: ${err.message}` }); }
        });
    });
}

// Sebuah switch dianggap "applied" bila SEMUA operasinya sudah pada kondisi disabled target-apply.
function isApplied(def, planOperations) {
    const ops = buildOps(def, "apply");
    return ops.every((op, i) => {
        const res = planOperations[i];
        if (!res || !Array.isArray(res.matched) || !res.matched.length) return false;
        return res.matched.every((r) => Boolean(r.disabled) === Boolean(op.disabled));
    });
}

/**
 * Status semua switch (read-only). Tidak pernah throw — kembalikan { ok, switches } atau { ok:false }.
 */
async function getStatus(deps = {}) {
    const cfg = getSwitchConfig();
    if (!cfg.enabled) return { ok: true, enabled: false, switches: [] };
    if (!cfg.valid) return { ok: false, enabled: true, error: "Kredensial router tidak lengkap.", switches: [] };
    const bridge = deps.runBridge || runBridge;

    const out = [];
    for (const def of cfg.switches) {
        try {
            const ops = buildOps(def, "apply");
            const envelope = await bridge({ mode: "status", ops }, cfg.creds);
            if (!envelope || envelope.status !== "success" || !envelope.data) {
                out.push({ id: def.id, label: def.label || def.id, affects: def.affects || null, note: def.note || null, applied: null, error: (envelope && envelope.message) || "status gagal", operations: [] });
                continue;
            }
            const planOps = envelope.data.operations || [];
            out.push({
                id: def.id,
                label: def.label || def.id,
                affects: def.affects || null,
                note: def.note || null,
                applied: isApplied(def, planOps),
                operations: planOps.map((o) => ({ match: o.match, matched: o.matched, matched_count: o.matched_count }))
            });
        } catch (err) {
            out.push({ id: def.id, label: def.label || def.id, applied: null, error: err.message, operations: [] });
        }
    }
    return { ok: true, enabled: true, switches: out };
}

function normalizeRecipients(list) {
    const out = [];
    (Array.isArray(list) ? list : []).forEach((raw) => {
        const s = String(raw || "").trim();
        if (!s) return;
        if (s.endsWith("@s.whatsapp.net") || s.endsWith("@g.us")) { out.push(s); return; }
        let digits = s.replace(/\D/g, "");
        if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
        if (digits.length >= 10 && digits.startsWith("62")) out.push(`${digits}@s.whatsapp.net`);
    });
    return out;
}

async function notifyAndAudit(def, direction, actor, resultSummary, deps) {
    const cfg = getSwitchConfig();
    // Audit incident (tampil di timeline panel).
    try {
        const repo = deps.repo || require("../repositories/upstream-quality.repository").getUpstreamQualityRepository();
        if (repo && typeof repo.addIncident === "function") {
            await repo.addIncident({
                path: def.affectsPath || "switch",
                kind: "switch",
                detail: { id: def.id, label: def.label, direction, actor: actor && actor.label, summary: resultSummary }
            });
        }
    } catch (_e) { /* audit best-effort */ }

    // Notifikasi admin.
    try {
        const send = deps.send || require("./whatsapp-critical-delivery").sendCritical;
        const getAdminJids = deps.getAdminJids || require("./admin-recipients").getAdminJids;
        const recipients = new Set();
        if (cfg.notifyAdmins) (getAdminJids() || []).forEach((j) => recipients.add(j));
        normalizeRecipients(cfg.recipients).forEach((j) => recipients.add(j));
        if (recipients.size) {
            const namaLayanan = (global.config && global.config.nama) || "RAF NET";
            const aksiLabel = direction === "restore" ? "DIKEMBALIKAN" : "DIALIHKAN";
            const text = `🔀 *SWITCH KONEKSI ${aksiLabel} — ${namaLayanan}*\n\n` +
                `• Aksi: *${def.label || def.id}*\n` +
                (def.affects ? `• Terdampak: ${def.affects}\n` : "") +
                `• Oleh: ${actor && actor.label ? actor.label : "-"}\n` +
                `• Hasil: ${resultSummary}\n\n` +
                (direction === "restore" ? "Jalur sudah kembali ke kondisi normal." : "Untuk mengembalikan: balas *switch koneksi* lalu pilih Kembalikan, atau lewat panel.");
            for (const jid of recipients) {
                try { await send(jid, { text }, { label: "wan-switch", waitForReadyMs: 8000 }); } catch (_e) { /* lanjut */ }
            }
        }
    } catch (_e) { /* notify best-effort */ }
}

function summarizeAfter(def, routesAfter) {
    // Ringkas gateway aktif per routing-mark yang tersentuh operasi.
    const marks = new Set();
    def.operations.forEach((op) => {
        const m = op.match || {};
        marks.add(m.routingMark || (m.table === "main" ? "main" : (m.table || "main")));
    });
    const parts = [];
    marks.forEach((mark) => {
        const active = (routesAfter || []).filter((r) => (r.routing_mark || "main") === mark && r.active && !r.disabled);
        const gw = active.map((r) => r.gateway).join(", ");
        parts.push(`${mark} → ${gw || "(tidak ada route aktif!)"}`);
    });
    return parts.join(" · ") || "kondisi diperbarui";
}

/**
 * Terapkan switch (direction 'apply') atau kembalikan ('restore'). Allowlist + plan-verify + audit.
 * @returns {Promise<{ok:boolean, message:string, summary?:string}>}
 */
async function applySwitch(id, direction = "apply", actor = null, deps = {}) {
    const cfg = getSwitchConfig();
    if (!cfg.enabled) return { ok: false, message: "Fitur switch koneksi nonaktif (config.wanSwitch.enabled=false)." };
    if (!cfg.valid) return { ok: false, message: "Kredensial router tidak lengkap." };
    const def = findSwitch(id);
    if (!def) return { ok: false, message: `Switch tidak dikenal: ${id}` };
    const dir = direction === "restore" ? "restore" : "apply";
    const ops = buildOps(def, dir);
    const bridge = deps.runBridge || runBridge;

    // 1. PLAN — pastikan setiap operasi cocok ke ≥1 route (anti topology-drift: kalau router
    //    berubah dan matcher tak menemukan route, JANGAN menulis apa pun).
    const plan = await bridge({ mode: "plan", ops }, cfg.creds);
    if (!plan || plan.status !== "success" || !plan.data) {
        return { ok: false, message: `Gagal menghitung rencana: ${(plan && plan.message) || "tidak diketahui"}` };
    }
    const planOps = plan.data.operations || [];
    const emptyOps = planOps.filter((o) => !o.matched_count);
    if (emptyOps.length) {
        return { ok: false, message: "Rencana dibatalkan: ada operasi yang tidak menemukan route (kemungkinan konfigurasi router berubah). Tidak ada perubahan dilakukan." };
    }

    // 2. APPLY.
    const applied = await bridge({ mode: "apply", ops }, cfg.creds);
    if (!applied || applied.status !== "success" || !applied.data) {
        return { ok: false, message: `Gagal menerapkan: ${(applied && applied.message) || "tidak diketahui"}` };
    }
    const rowErr = (applied.data.applied || []).find((a) => a.error);
    if (rowErr) {
        return { ok: false, message: `Router menolak perubahan: ${rowErr.error}` };
    }

    const summary = summarizeAfter(def, applied.data.routes_after || []);
    await notifyAndAudit(def, dir, actor, summary, deps);
    return {
        ok: true,
        message: dir === "restore"
            ? `Jalur "${def.label || def.id}" dikembalikan ke normal.`
            : `Switch "${def.label || def.id}" diterapkan.`,
        summary
    };
}

function restoreSwitch(id, actor = null, deps = {}) {
    return applySwitch(id, "restore", actor, deps);
}

module.exports = {
    getSwitchConfig,
    listSwitches,
    getStatus,
    applySwitch,
    restoreSwitch,
    _internal: { buildOps, isApplied, normalizeRecipients, summarizeAfter }
};
