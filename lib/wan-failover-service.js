/**
 * Header Doc
 * Purpose: Engine failover WAN otomatis — mengevaluasi tiap siklus probe: bila jalur `sickPath`
 *          sakit ≥ N siklus beruntun DAN jalur `targetPath` sehat, jalankan aksi sesuai mode:
 *          `propose` (kirim saran WA ke admin, TANPA menyentuh router) atau `auto` (eksekusi
 *          switch allowlist via `lib/wan-switch-service` yang sudah plan-verify + audit).
 *          Guard presisi: verifikasi status switch di router sebelum aksi, cooldown per rule,
 *          batas aksi otomatis harian, kunci anti-flapping, auto-revert HANYA berbasis bukti
 *          gateway (probe jauh ikut pindah jalur setelah switch sehingga tidak valid untuk
 *          menilai kepulihan), dan rehidrasi state dari insiden setelah restart.
 * Caller: `lib/upstream-quality-poller.js` (setelah tiap siklus; gate `config.wanFailover.enabled`,
 *         default MATI — deploy gelap).
 * Deps: `repositories/upstream-quality.repository` (deret probe + insiden), `lib/wan-switch-service`
 *       (getStatus/applySwitch/restoreSwitch), `lib/whatsapp-critical-delivery.sendCritical`
 *       (payload WAJIB objek { text }), `lib/admin-recipients.getAdminJids`,
 *       `lib/response-template-helper.renderResponseTemplate`.
 * MainFuncs: `evaluateAfterCycle`, `getFailoverConfig`, `getRuleStates`, `resetForTest`.
 * SideEffects: Mode auto MENULIS route router (via wan-switch-service); kirim WA admin
 *              (never-throw); tulis insiden kind `failover`; state rule in-memory (single-instance).
 */
"use strict";

const LEVELS = { PUTUS: 3, GANGGUAN: 2, DEGRADASI: 1, NORMAL: 0 };
const AUTO_ACTOR_LABEL = "bot:auto-failover";

// State per rule (key = switchId). phase 'IDLE' | 'APPLIED'.
// { phase, appliedByAuto, lastActionAtMs, lastProposeAtMs, lastRevertProposeAtMs,
//   autoEventsMs: number[], lockedUntilMs, lockNotified }
const ruleStates = new Map();
let rehydrated = false;

function defaultDeps() {
    return {
        getRepo: () => require("../repositories/upstream-quality.repository").getUpstreamQualityRepository(),
        switchService: require("./wan-switch-service"),
        send: (jid, payload, opts) => require("./whatsapp-critical-delivery").sendCritical(jid, payload, opts),
        getAdminJids: () => require("./admin-recipients").getAdminJids(),
        renderResponseTemplate: (key, fallback, data) => require("./response-template-helper").renderResponseTemplate(key, fallback, data),
        getFailoverConfig,
        nowMs: () => Date.now()
    };
}

/** Config failover ber-default aman: OFF, mode propose (saran saja), guard konservatif. */
function getFailoverConfig() {
    const cfg = (global.config && global.config.wanFailover) || {};
    const rules = (Array.isArray(cfg.rules) ? cfg.rules : [])
        .filter((r) => r && r.switchId && r.sickPath && r.targetPath)
        .map((r) => ({
            switchId: String(r.switchId),
            sickPath: String(r.sickPath),
            targetPath: String(r.targetPath),
            minLevel: LEVELS[String(r.minLevel || "").toUpperCase()] != null ? String(r.minLevel).toUpperCase() : "GANGGUAN",
            sickCycles: Math.max(2, Number(r.sickCycles) || 3),
            targetHealthyCycles: Math.max(1, Number(r.targetHealthyCycles) || 3),
            cooldownMinutes: Math.max(5, Number(r.cooldownMinutes) || 30),
            proposeCooldownMinutes: Math.max(15, Number(r.proposeCooldownMinutes) || 120),
            mode: ["auto", "propose"].includes(r.mode) ? r.mode : null,
            autoRevert: r.autoRevert === true,
            revertHealthyCycles: Math.max(3, Number(r.revertHealthyCycles) || 10)
        }));
    return {
        enabled: cfg.enabled === true,
        mode: cfg.mode === "auto" ? "auto" : "propose",
        maxAutoActionsPerDay: Math.max(1, Number(cfg.maxAutoActionsPerDay) || 4),
        flapLockCount: Math.max(2, Number(cfg.flapLockCount) || 2),
        flapLockHours: Math.max(1, Number(cfg.flapLockHours) || 24),
        notifyAdmins: cfg.notifyAdmins !== false,
        recipients: Array.isArray(cfg.recipients) ? cfg.recipients : [],
        rules
    };
}

/** Level sakit satu siklus dari rata-rata loss (semantik sama dengan alerter). */
function levelForLoss(lossAvg, thresholds) {
    if (lossAvg == null) return "PUTUS"; // tanpa sampel = tidak bisa dipercaya sehat
    if (lossAvg >= 99) return "PUTUS";
    if (lossAvg >= (thresholds.lossCritPct || 20)) return "GANGGUAN";
    if (lossAvg >= (thresholds.lossWarnPct || 5)) return "DEGRADASI";
    return "NORMAL";
}

/**
 * Kelompokkan baris probe → per jalur deret siklus terurut naik, DIPISAH far vs gateway.
 * Gateway dipisah karena setelah switch, probe jauh ikut route backup (tidak lagi mengukur
 * jalur sakit), sedangkan ping gateway/remote-address tunnel tetap mengukur last-mile jalur itu.
 */
function buildSeries(rows) {
    const byKey = new Map();
    for (const r of rows || []) {
        const isGw = String(r.target_key || "") === "gateway";
        const key = `${r.path}|${isGw ? "gw" : "far"}|${r.probed_at}`;
        if (!byKey.has(key)) byKey.set(key, { path: r.path, isGw, at: r.probed_at, losses: [] });
        if (r.loss_pct != null) byKey.get(key).losses.push(Number(r.loss_pct));
    }
    const perPath = new Map();
    for (const c of byKey.values()) {
        if (!perPath.has(c.path)) perPath.set(c.path, { far: [], gw: [] });
        perPath.get(c.path)[c.isGw ? "gw" : "far"].push({
            at: c.at,
            lossAvg: c.losses.length ? c.losses.reduce((a, b) => a + b, 0) / c.losses.length : null
        });
    }
    for (const p of perPath.values()) {
        p.far.sort((a, b) => a.at.localeCompare(b.at));
        p.gw.sort((a, b) => a.at.localeCompare(b.at));
    }
    return perPath;
}

/** True bila deret punya ≥ n siklus terakhir dan SEMUANYA lolos predicate. */
function tailAll(series, n, predicate) {
    if (!Array.isArray(series) || series.length < n) return false;
    return series.slice(-n).every(predicate);
}

function fmt(n, digits = 0) {
    return n == null ? "-" : Number(n).toFixed(digits);
}

function getRuleState(switchId) {
    if (!ruleStates.has(switchId)) {
        ruleStates.set(switchId, {
            phase: "IDLE",
            appliedByAuto: false,
            lastActionAtMs: 0,
            lastProposeAtMs: 0,
            lastRevertProposeAtMs: 0,
            autoEventsMs: [],
            lockedUntilMs: 0,
            lockNotified: false
        });
    }
    return ruleStates.get(switchId);
}

function parseDetail(raw) {
    if (raw == null) return null;
    if (typeof raw === "object") return raw;
    try { return JSON.parse(raw); } catch (_e) { return null; }
}

/**
 * Rehidrasi state dari insiden tersimpan (sekali per proses) — supaya restart bot tidak
 * membuat engine "lupa" bahwa switch sedang dialihkan otomatis / kuota harian sudah terpakai.
 */
async function rehydrateFromIncidents(deps, cfgF) {
    if (rehydrated) return;
    rehydrated = true;
    try {
        const repo = deps.getRepo();
        const incidents = await repo.getIncidents({ limit: 200 });
        const nowMs = deps.nowMs();
        const dayMs = 24 * 60 * 60 * 1000;
        for (const rule of cfgF.rules) {
            const state = getRuleState(rule.switchId);
            // Kejadian auto (apply/restore) 24 jam terakhir → kuota harian + deteksi flapping.
            for (const inc of incidents) {
                if (inc.kind !== "failover") continue;
                const d = parseDetail(inc.detail);
                if (!d || d.switchId !== rule.switchId) continue;
                const atMs = Date.parse(inc.created_at);
                if (!Number.isFinite(atMs)) continue;
                if (["auto_apply", "auto_restore"].includes(d.action) && nowMs - atMs < dayMs) {
                    state.autoEventsMs.push(atMs);
                }
                if (d.action === "propose" && atMs > state.lastProposeAtMs) state.lastProposeAtMs = atMs;
                if (["auto_apply", "auto_restore"].includes(d.action) && atMs > state.lastActionAtMs) {
                    state.lastActionAtMs = atMs;
                }
            }
            // Fase APPLIED bila insiden switch TERAKHIR utk id ini adalah apply oleh auto-pilot.
            const lastSwitch = incidents.find((inc) => {
                if (inc.kind !== "switch") return false;
                const d = parseDetail(inc.detail);
                return d && d.id === rule.switchId;
            });
            if (lastSwitch) {
                const d = parseDetail(lastSwitch.detail);
                if (d && d.direction === "apply") {
                    state.phase = "APPLIED";
                    state.appliedByAuto = String(d.actor || "").startsWith(AUTO_ACTOR_LABEL);
                }
            }
        }
    } catch (err) {
        console.warn(`[WAN-Failover] Rehidrasi state gagal (lanjut dengan state kosong): ${err.message}`);
    }
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

async function deliver(deps, cfgF, text) {
    const recipients = new Set();
    if (cfgF.notifyAdmins !== false) {
        try { (deps.getAdminJids() || []).forEach((j) => recipients.add(j)); } catch (_e) { /* best-effort */ }
    }
    normalizeRecipients(cfgF.recipients).forEach((j) => recipients.add(j));
    let delivered = 0;
    for (const jid of recipients) {
        try {
            // Kontrak sendCritical: payload WAJIB objek { text } — string polos = crash diam-diam.
            const result = await deps.send(jid, { text }, { label: "wan-failover", waitForReadyMs: 8000 });
            if (!result || result.delivered !== false) delivered += 1;
        } catch (err) {
            console.warn(`[WAN-Failover] Gagal kirim ke ${jid}: ${err.message}`);
        }
    }
    return delivered;
}

async function addFailoverIncident(deps, rule, action, extra = {}) {
    try {
        const repo = deps.getRepo();
        if (repo && typeof repo.addIncident === "function") {
            await repo.addIncident({
                path: rule.sickPath,
                kind: "failover",
                detail: { switchId: rule.switchId, action, ...extra }
            });
        }
    } catch (_e) { /* insiden best-effort */ }
}

/** Baca status applied switch di router. null = tak terbaca (jangan ambil aksi tulis). */
async function readAppliedStatus(deps, switchId) {
    try {
        const st = await deps.switchService.getStatus();
        if (!st || st.ok !== true) return null;
        const found = (st.switches || []).find((s) => s.id === switchId);
        return found ? found.applied : null;
    } catch (_e) {
        return null;
    }
}

function switchLabelOf(deps, switchId) {
    try {
        const sw = deps.switchService.getSwitchConfig().switches.find((s) => s.id === switchId);
        return (sw && (sw.label || sw.id)) || switchId;
    } catch (_e) {
        return switchId;
    }
}

function pathLabel(monitorCfg, key) {
    const p = ((monitorCfg && monitorCfg.paths) || []).find((x) => x.key === key);
    return (p && p.label) || key;
}

/**
 * Evaluasi failover setelah satu siklus probe. Gate: config.wanFailover.enabled === true dan
 * wanSwitch.enabled === true. `depsOverride` untuk test. Tidak pernah throw.
 * @param {object} monitorCfg hasil getMonitorConfig() poller (thresholds, intervalMs, paths).
 */
async function evaluateAfterCycle(monitorCfg, depsOverride = {}) {
    try {
        const deps = { ...defaultDeps(), ...depsOverride };
        const cfgF = deps.getFailoverConfig();
        if (!cfgF.enabled || !cfgF.rules.length) return { skipped: true, reason: "disabled" };

        let swCfg;
        try { swCfg = deps.switchService.getSwitchConfig(); } catch (_e) { swCfg = null; }
        if (!swCfg || swCfg.enabled !== true) return { skipped: true, reason: "switch-disabled" };
        const knownSwitchIds = new Set((swCfg.switches || []).map((s) => s.id));

        await rehydrateFromIncidents(deps, cfgF);

        const thresholds = (monitorCfg && monitorCfg.thresholds) || {};
        const intervalMs = (monitorCfg && monitorCfg.intervalMs) || 60000;
        const maxCycles = cfgF.rules.reduce(
            (m, r) => Math.max(m, r.sickCycles, r.targetHealthyCycles, r.revertHealthyCycles),
            3
        );
        const lookbackMs = maxCycles * intervalMs * 2 + 5 * 60 * 1000;
        const nowMs = deps.nowMs();
        const repo = deps.getRepo();
        const rows = await repo.getRecentProbes({
            sinceIso: new Date(nowMs - lookbackMs).toISOString(),
            limit: 5000
        });
        const series = buildSeries(rows);
        const namaLayanan = (global.config && global.config.nama) || "RAF NET";
        const dayMs = 24 * 60 * 60 * 1000;
        const flapWindowMs = cfgF.flapLockHours * 60 * 60 * 1000;
        const actions = [];

        for (const rule of cfgF.rules) {
            if (!knownSwitchIds.has(rule.switchId)) {
                actions.push({ switchId: rule.switchId, action: "skip", reason: "switch-unknown" });
                continue;
            }
            const state = getRuleState(rule.switchId);

            // Kunci anti-flapping masih aktif → jangan lakukan apa pun untuk rule ini.
            if (state.lockedUntilMs > nowMs) {
                actions.push({ switchId: rule.switchId, action: "skip", reason: "locked" });
                continue;
            }
            state.lockNotified = false;

            const sick = series.get(rule.sickPath) || { far: [], gw: [] };
            const target = series.get(rule.targetPath) || { far: [], gw: [] };
            const effectiveMode = rule.mode || cfgF.mode;
            const latestSick = sick.far[sick.far.length - 1] || null;
            const latestTarget = target.far[target.far.length - 1] || null;

            state.autoEventsMs = state.autoEventsMs.filter((t) => nowMs - t < Math.max(dayMs, flapWindowMs));

            if (state.phase === "IDLE") {
                const sickStreak = tailAll(sick.far, rule.sickCycles,
                    (c) => LEVELS[levelForLoss(c.lossAvg, thresholds)] >= LEVELS[rule.minLevel]);
                const targetHealthy = tailAll(target.far, rule.targetHealthyCycles,
                    (c) => levelForLoss(c.lossAvg, thresholds) === "NORMAL");
                if (!sickStreak) continue;
                if (!targetHealthy) {
                    actions.push({ switchId: rule.switchId, action: "skip", reason: "target-unhealthy" });
                    continue;
                }

                const dataText = {
                    nama_layanan: namaLayanan,
                    jalur_sakit: pathLabel(monitorCfg, rule.sickPath),
                    jalur_target: pathLabel(monitorCfg, rule.targetPath),
                    level: levelForLoss(latestSick && latestSick.lossAvg, thresholds),
                    siklus: rule.sickCycles,
                    loss: fmt(latestSick && latestSick.lossAvg),
                    loss_target: fmt(latestTarget && latestTarget.lossAvg),
                    switch_label: switchLabelOf(deps, rule.switchId)
                };

                if (effectiveMode === "propose") {
                    if (nowMs - state.lastProposeAtMs < rule.proposeCooldownMinutes * 60 * 1000) continue;
                    const applied = await readAppliedStatus(deps, rule.switchId);
                    if (applied === true) {
                        // Sudah dialihkan (manual/panel) — tidak perlu saran, ikuti fase applied.
                        state.phase = "APPLIED";
                        state.appliedByAuto = false;
                        continue;
                    }
                    const teks = deps.renderResponseTemplate(
                        "wanfail_propose",
                        `🤖 *SARAN FAILOVER — ${dataText.nama_layanan}*\n\n` +
                        `Jalur *${dataText.jalur_sakit}* ${dataText.level} ${dataText.siklus} siklus beruntun (loss ${dataText.loss}%), ` +
                        `sedangkan *${dataText.jalur_target}* sehat (loss ${dataText.loss_target}%).\n\n` +
                        `Saran: alihkan lewat switch *${dataText.switch_label}*.\n` +
                        `➡️ Balas *switch koneksi* lalu pilih nomornya, atau buka panel */upstream-quality*.\n\n` +
                        `(Mode saat ini: saran saja — bot tidak mengubah router. Set \`wanFailover.rules[].mode="auto"\` bila ingin otomatis.)`,
                        dataText
                    );
                    await deliver(deps, cfgF, teks);
                    state.lastProposeAtMs = nowMs;
                    await addFailoverIncident(deps, rule, "propose", { loss: latestSick && latestSick.lossAvg });
                    actions.push({ switchId: rule.switchId, action: "propose" });
                    continue;
                }

                // ===== MODE AUTO =====
                if (nowMs - state.lastActionAtMs < rule.cooldownMinutes * 60 * 1000) {
                    actions.push({ switchId: rule.switchId, action: "skip", reason: "cooldown" });
                    continue;
                }
                const autoApplies = state.autoEventsMs.filter((t) => nowMs - t < flapWindowMs).length;
                if (autoApplies >= cfgF.flapLockCount * 2) {
                    // apply+restore dihitung berpasangan → 2 pasang = flapping. Kunci rule.
                    state.lockedUntilMs = nowMs + flapWindowMs;
                    if (!state.lockNotified) {
                        state.lockNotified = true;
                        const teks = deps.renderResponseTemplate(
                            "wanfail_lock",
                            `⛔ *AUTO-FAILOVER DIKUNCI — ${namaLayanan}*\n\n` +
                            `Switch *${dataText.switch_label}* sudah bolak-balik ${cfgF.flapLockCount}× dalam ${cfgF.flapLockHours} jam (indikasi flapping / gangguan ISP berulang).\n` +
                            `Bot BERHENTI mengalihkan otomatis untuk switch ini selama ${cfgF.flapLockHours} jam ke depan.\n\n` +
                            `Tangani manual bila perlu: balas *switch koneksi* atau buka panel */upstream-quality*.`,
                            { ...dataText, kali: cfgF.flapLockCount, jam: cfgF.flapLockHours }
                        );
                        await deliver(deps, cfgF, teks);
                        await addFailoverIncident(deps, rule, "lock", { autoApplies });
                    }
                    actions.push({ switchId: rule.switchId, action: "lock" });
                    continue;
                }
                if (state.autoEventsMs.filter((t) => nowMs - t < dayMs).length >= cfgF.maxAutoActionsPerDay) {
                    actions.push({ switchId: rule.switchId, action: "skip", reason: "daily-cap" });
                    continue;
                }
                const applied = await readAppliedStatus(deps, rule.switchId);
                if (applied === true) {
                    state.phase = "APPLIED";
                    state.appliedByAuto = false;
                    continue;
                }
                if (applied === null) {
                    // Status router tak terbaca → JANGAN menulis (presisi > kecepatan). Coba siklus depan.
                    actions.push({ switchId: rule.switchId, action: "skip", reason: "status-unreadable" });
                    continue;
                }

                const teksMulai = deps.renderResponseTemplate(
                    "wanfail_auto_start",
                    `🤖 *AUTO-FAILOVER — ${dataText.nama_layanan}*\n\n` +
                    `Jalur *${dataText.jalur_sakit}* ${dataText.level} ${dataText.siklus} siklus beruntun (loss ${dataText.loss}%); ` +
                    `backup *${dataText.jalur_target}* sehat (loss ${dataText.loss_target}%).\n\n` +
                    `Bot mengalihkan OTOMATIS sekarang via switch *${dataText.switch_label}*. Konfirmasi hasil menyusul.`,
                    dataText
                );
                await deliver(deps, cfgF, teksMulai);
                const result = await deps.switchService.applySwitch(rule.switchId, "apply", { label: AUTO_ACTOR_LABEL });
                if (result && result.ok) {
                    state.phase = "APPLIED";
                    state.appliedByAuto = true;
                    state.lastActionAtMs = nowMs;
                    state.autoEventsMs.push(nowMs);
                    await addFailoverIncident(deps, rule, "auto_apply", { loss: latestSick && latestSick.lossAvg });
                    actions.push({ switchId: rule.switchId, action: "auto_apply" });
                } else {
                    state.lastActionAtMs = nowMs; // cooldown juga saat gagal — jangan menghajar router tiap siklus
                    const teksGagal = deps.renderResponseTemplate(
                        "wanfail_auto_fail",
                        `⚠️ *AUTO-FAILOVER GAGAL — ${namaLayanan}*\n\n` +
                        `Percobaan mengalihkan via *${dataText.switch_label}* gagal:\n${(result && result.message) || "tanpa pesan"}\n\n` +
                        `Silakan alihkan manual: balas *switch koneksi* atau lewat panel */upstream-quality*.`,
                        { ...dataText, pesan: (result && result.message) || "-" }
                    );
                    await deliver(deps, cfgF, teksGagal);
                    await addFailoverIncident(deps, rule, "error", { message: (result && result.message) || null });
                    actions.push({ switchId: rule.switchId, action: "error" });
                }
                continue;
            }

            // ===== PHASE APPLIED — pantau kepulihan jalur sakit via GATEWAY =====
            const gwHealthy = tailAll(sick.gw, rule.revertHealthyCycles,
                (c) => c.lossAvg != null && c.lossAvg <= (thresholds.lossWarnPct || 5));
            if (!gwHealthy) continue;
            const latestGw = sick.gw[sick.gw.length - 1] || null;
            const dataRevert = {
                nama_layanan: namaLayanan,
                jalur_sakit: pathLabel(monitorCfg, rule.sickPath),
                siklus: rule.revertHealthyCycles,
                loss_gw: fmt(latestGw && latestGw.lossAvg, 1),
                switch_label: switchLabelOf(deps, rule.switchId)
            };

            const canAutoRevert = rule.autoRevert && state.appliedByAuto && (rule.mode || cfgF.mode) === "auto";
            if (!canAutoRevert) {
                if (nowMs - state.lastRevertProposeAtMs < rule.proposeCooldownMinutes * 60 * 1000) continue;
                const applied = await readAppliedStatus(deps, rule.switchId);
                if (applied === false) { state.phase = "IDLE"; state.appliedByAuto = false; continue; }
                const teks = deps.renderResponseTemplate(
                    "wanfail_revert_propose",
                    `✅ *JALUR PULIH — SARAN KEMBALIKAN (${dataRevert.nama_layanan})*\n\n` +
                    `Jalur *${dataRevert.jalur_sakit}* terpantau pulih di sisi gateway ${dataRevert.siklus} siklus beruntun (loss ${dataRevert.loss_gw}%), ` +
                    `sementara trafik masih dialihkan via switch *${dataRevert.switch_label}*.\n\n` +
                    `➡️ Balas *switch koneksi* lalu pilih *Kembalikan*, atau lewat panel */upstream-quality*.`,
                    dataRevert
                );
                await deliver(deps, cfgF, teks);
                state.lastRevertProposeAtMs = nowMs;
                await addFailoverIncident(deps, rule, "revert_propose", { loss_gw: latestGw && latestGw.lossAvg });
                actions.push({ switchId: rule.switchId, action: "revert_propose" });
                continue;
            }

            if (nowMs - state.lastActionAtMs < rule.cooldownMinutes * 60 * 1000) continue;
            if (state.autoEventsMs.filter((t) => nowMs - t < dayMs).length >= cfgF.maxAutoActionsPerDay) {
                actions.push({ switchId: rule.switchId, action: "skip", reason: "daily-cap" });
                continue;
            }
            const appliedNow = await readAppliedStatus(deps, rule.switchId);
            if (appliedNow === false) { state.phase = "IDLE"; state.appliedByAuto = false; continue; }
            if (appliedNow === null) {
                actions.push({ switchId: rule.switchId, action: "skip", reason: "status-unreadable" });
                continue;
            }
            const teksRevert = deps.renderResponseTemplate(
                "wanfail_auto_revert_start",
                `🤖 *AUTO-FAILOVER: KEMBALI NORMAL — ${dataRevert.nama_layanan}*\n\n` +
                `Jalur *${dataRevert.jalur_sakit}* pulih di sisi gateway ${dataRevert.siklus} siklus beruntun (loss ${dataRevert.loss_gw}%).\n` +
                `Bot mengembalikan trafik ke jalur normal sekarang (switch *${dataRevert.switch_label}*).`,
                dataRevert
            );
            await deliver(deps, cfgF, teksRevert);
            const revertResult = await deps.switchService.restoreSwitch(rule.switchId, { label: AUTO_ACTOR_LABEL });
            if (revertResult && revertResult.ok) {
                state.phase = "IDLE";
                state.appliedByAuto = false;
                state.lastActionAtMs = nowMs;
                state.autoEventsMs.push(nowMs);
                await addFailoverIncident(deps, rule, "auto_restore", { loss_gw: latestGw && latestGw.lossAvg });
                actions.push({ switchId: rule.switchId, action: "auto_restore" });
            } else {
                state.lastActionAtMs = nowMs;
                const teksGagal = deps.renderResponseTemplate(
                    "wanfail_auto_fail",
                    `⚠️ *AUTO-FAILOVER GAGAL — ${namaLayanan}*\n\n` +
                    `Percobaan MENGEMBALIKAN via *${dataRevert.switch_label}* gagal:\n${(revertResult && revertResult.message) || "tanpa pesan"}\n\n` +
                    `Silakan kembalikan manual: balas *switch koneksi* (pilih Kembalikan) atau lewat panel.`,
                    { ...dataRevert, pesan: (revertResult && revertResult.message) || "-" }
                );
                await deliver(deps, cfgF, teksGagal);
                await addFailoverIncident(deps, rule, "error", { message: (revertResult && revertResult.message) || null, direction: "restore" });
                actions.push({ switchId: rule.switchId, action: "error" });
            }
        }

        return { skipped: false, actions };
    } catch (err) {
        console.warn(`[WAN-Failover] Evaluasi gagal: ${err.message}`);
        return { skipped: true, reason: "error", error: err.message };
    }
}

function getRuleStates() {
    const out = {};
    for (const [k, v] of ruleStates.entries()) out[k] = { ...v, autoEventsMs: [...v.autoEventsMs] };
    return out;
}

function resetForTest() {
    ruleStates.clear();
    rehydrated = false;
}

module.exports = {
    evaluateAfterCycle,
    getFailoverConfig,
    getRuleStates,
    resetForTest,
    _internal: { levelForLoss, buildSeries, tailAll, normalizeRecipients, LEVELS, AUTO_ACTOR_LABEL }
};
