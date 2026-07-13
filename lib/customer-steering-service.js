/**
 * Header Doc
 * Purpose: Steering pelanggan per-ISP — visibilitas + kendali: (1) OVERVIEW live "pelanggan X
 *          sedang lewat ISP mana" (join PPP active × users DB × address-list router LIVE ×
 *          route-state) — bukan dari config statis yang bisa basi; (2) STEER per-pelanggan:
 *          /32 IP pelanggan dimasukkan ke list override RAF-STEER-<isp> (rule mangle prioritas
 *          teratas, dipasang idempoten via mode setup bridge), intent disimpan & RECONCILER
 *          menjaga entri mengikuti IP PPPoE yang berubah saat reconnect; (3) kelola entri
 *          POOL (freedns/lokaldns) — enable/disable/tambah/hapus subnet (aksi pindah SATU POOL).
 *          Semantik efektif mangle DANDER (recon 2026-07-08, semua passthrough=no first-match):
 *          freedns → DNS/8.8.8.8/dst-lokal=GMDP-main, WA/GAME/ICMP=FREE(IH), sisanya=MNI;
 *          lokaldns → main(GMDP) dgn VOD/DLOAD=KE-TIKTOK; tanpa list = main(GMDP).
 * Caller: `routes/admin-customer-steering-routes.js` (overview/steer/pool/setup) dan
 *         `lib/app-runtime.js` (start reconciler; gate `config.customerSteering.enabled`).
 * Deps: `child_process.spawn` (php `views/mikrotik_addrlist_steer.php`), kredensial router dari
 *       `config.customerSteering`/`wanSwitch`/`upstreamMonitor`, `lib/mikrotik.getActivePPPoEUsers`,
 *       `lib/upstream-path-resolver.ipInCidr`, lazy `lib/upstream-quality-poller.buildStatusReport`
 *       (route-state), `repositories/upstream-quality.repository.addIncident` (audit),
 *       `database/customer_steering.json` (intent steering per pelanggan).
 * MainFuncs: `buildSteeringOverview`, `buildSegmentMap`, `previewSegmentMove`, `applySegmentMove`
 *            (kendali per-SEGMEN: read/dry-run/apply+verify+rollback), `steerCustomer`,
 *            `poolEntryAction`, `setupSteeringRules`, `reconcileOnce`,
 *            `startCustomerSteeringReconciler`, `getSteeringConfig`.
 * SideEffects: Mode tulis mengubah address-list router + rule mangle RAF-CUSTSTEER; tulis file
 *              intent JSON; interval reconciler (unref). Semua non-throw ke caller.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ipInCidr } = require("./upstream-path-resolver");

const INTENT_FILE = path.join(__dirname, "..", "database", "customer_steering.json");
const STEER_COMMENT_PREFIX = "RAF-STEER uid=";

let reconcilerTimer = null;
let isReconciling = false;

function defaultDeps() {
    return {
        runBridge,
        getUsers: () => (Array.isArray(global.users) ? global.users : []),
        getActives: async () => {
            const { getActivePPPoEUsers } = require("./mikrotik");
            return getActivePPPoEUsers({ router_id: "default" });
        },
        getStatusReport: () => require("./upstream-quality-poller").buildStatusReport(),
        readIntents,
        writeIntents,
        addIncident: (payload) => require("../repositories/upstream-quality.repository")
            .getUpstreamQualityRepository().addIncident(payload),
        nowMs: () => Date.now()
    };
}

/** Config steering ber-default sesuai recon router DANDER; kredensial waris upstreamMonitor. */
function getSteeringConfig() {
    const cfg = (global.config && global.config.customerSteering) || {};
    const up = (global.config && global.config.upstreamMonitor) || {};
    const sw = (global.config && global.config.wanSwitch) || {};
    return {
        enabled: cfg.enabled === true,
        host: cfg.host || sw.host || up.host || null,
        port: Number(cfg.port || sw.port || up.port) || 8728,
        user: cfg.user || sw.user || up.user || null,
        password: cfg.password || sw.password || up.password || null,
        poolLists: Array.isArray(cfg.poolLists) && cfg.poolLists.length ? cfg.poolLists : ["freedns", "lokaldns"],
        steerLists: {
            gmdp: "RAF-STEER-GMDP",
            ih: "RAF-STEER-IH",
            mni: "RAF-STEER-MNI",
            sf: "RAF-STEER-SF",
            ...(cfg.steerLists || {})
        },
        // Mark tabel routing per tujuan steering (gmdp = accept → jatuh ke main table).
        pathMarks: { ih: "FREE", mni: "MNI", sf: "SF-PROBE", ...(cfg.pathMarks || {}) },
        gatewayPathMap: {
            "Tunnel-MNI": "mni",
            "SF": "sf",
            "192.168.102.1": "ih",
            "195.168.62.1": "gmdp",
            "1.1.1.1": "gmdp",
            ...(cfg.gatewayPathMap || {})
        },
        reconcileIntervalMs: Math.max(30, Number(cfg.reconcileIntervalSeconds) || 60) * 1000,
        valid: Boolean((cfg.host || sw.host || up.host) && (cfg.user || sw.user || up.user) && (cfg.password || sw.password || up.password))
    };
}

function runBridge(spec, creds, timeoutMs = 20000) {
    const scriptPath = path.resolve(__dirname, "..", "views", "mikrotik_addrlist_steer.php");
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
            finalize({ status: "error", message: `Bridge steering timeout ${Math.round(timeoutMs / 1000)}s.` });
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

function readIntents() {
    try {
        if (fs.existsSync(INTENT_FILE)) {
            const parsed = JSON.parse(fs.readFileSync(INTENT_FILE, "utf8"));
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (err) {
        console.warn(`[CustSteer] Gagal baca intent: ${err.message}`);
    }
    return [];
}

function writeIntents(list) {
    try {
        fs.writeFileSync(INTENT_FILE, JSON.stringify(list, null, 2), "utf8");
    } catch (err) {
        console.warn(`[CustSteer] Gagal tulis intent: ${err.message}`);
    }
}

function unwrapList(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result && result.data)) return result.data;
    if (Array.isArray(result && result.data && result.data.data)) return result.data.data;
    if (Array.isArray(result && result.items)) return result.items;
    return [];
}

function normalizeUsername(v) {
    return String(v || "").trim().toLowerCase();
}

/** Cocokkan IP ke entri address-list (entri '1.2.3.4' polos = /32). Hanya entri aktif statis. */
function ipInEntry(ip, entry) {
    if (!entry || entry.disabled || entry.dynamic) return false;
    const addr = String(entry.address || "");
    const cidr = addr.includes("/") ? addr : `${addr}/32`;
    return ipInCidr(ip, cidr);
}

/**
 * Jalur EFEKTIF satu IP dari state list live (semantik mangle DANDER — lihat Header Doc).
 * @returns {{intended:string, source:string, catatan:string}}
 */
function resolveIntendedPath(ip, lists, steerCfg) {
    // 1) Override steering per-pelanggan menang mutlak (rule paling atas, passthrough=no).
    for (const [pathKey, listName] of Object.entries(steerCfg.steerLists)) {
        const entries = lists[listName] || [];
        if (entries.some((e) => ipInEntry(ip, e))) {
            return { intended: pathKey, source: `steer:${listName}`, catatan: "override steering — SEMUA trafik via jalur ini (prioritas WA/game dilewati)" };
        }
    }
    // 2) Pool: rule freedns lebih dulu dari lokaldns di mangle.
    const freedns = (lists.freedns || []).some((e) => ipInEntry(ip, e));
    if (freedns) {
        return { intended: "mni", source: "pool:freedns", catatan: "WA/game/ICMP→IH · DNS & 8.8.8.8→GMDP" };
    }
    const lokaldns = (lists.lokaldns || []).some((e) => ipInEntry(ip, e));
    if (lokaldns) {
        return { intended: "gmdp", source: "pool:lokaldns", catatan: "VOD/DLOAD→tabel KE-TIKTOK" };
    }
    return { intended: "gmdp", source: "default", catatan: "tanpa list — default tabel main" };
}

/** Jalur AKTUAL: intended + kenyataan route (mis. mark MNI sedang menumpang SF). */
function resolveActualPath(intended, routeSnapshot, steerCfg) {
    try {
        const markOf = { gmdp: "main", ih: steerCfg.pathMarks.ih, mni: steerCfg.pathMarks.mni, sf: steerCfg.pathMarks.sf };
        const mark = markOf[intended] || "main";
        const rows = (routeSnapshot || []).filter((r) => (r.mark || "main") === mark);
        const active = rows.find((r) => r.active && !r.disabled);
        if (!active || !active.gateway) return { actual: intended, via: null };
        const mapped = steerCfg.gatewayPathMap[active.gateway];
        return { actual: mapped || intended, via: active.gateway };
    } catch (_e) {
        return { actual: intended, via: null };
    }
}

/** Ambil peta list live via bridge (pool + steer lists sekali jalan). */
async function fetchLists(deps, cfg) {
    const names = [...cfg.poolLists, ...Object.values(cfg.steerLists)];
    const envelope = await deps.runBridge({ mode: "list", lists: names }, cfg);
    if (!envelope || envelope.status !== "success" || !envelope.data) {
        throw new Error((envelope && envelope.message) || "gagal baca address-list");
    }
    return envelope.data.lists || {};
}

/**
 * OVERVIEW: pelanggan online + jalur intended/actual per pelanggan + entri list + intent.
 * Tidak pernah throw — { ok:false, error } saat gagal total.
 */
async function buildSteeringOverview(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cfg = getSteeringConfig();
    if (!cfg.valid) return { ok: false, error: "Kredensial router belum dikonfigurasi (upstreamMonitor/wanSwitch/customerSteering)." };
    try {
        const [lists, activesRaw] = await Promise.all([
            fetchLists(deps, cfg),
            deps.getActives().catch(() => [])
        ]);
        let routeSnapshot = [];
        try {
            const report = await deps.getStatusReport();
            routeSnapshot = (report && report.route_snapshot) || [];
        } catch (_e) { /* route-state best-effort */ }

        const users = deps.getUsers();
        const byPppoe = new Map();
        users.forEach((u) => {
            const key = normalizeUsername(u.pppoe_username);
            if (key) byPppoe.set(key, u);
        });

        const intents = deps.readIntents();
        const intentByUser = new Map(intents.map((i) => [String(i.userId), i]));

        const counts = {};
        const customers = [];
        for (const item of unwrapList(activesRaw)) {
            const uname = normalizeUsername(item.name || item.user || item.username);
            const ip = String(item.address || item.ip || "").split("/")[0];
            if (!uname || !ip) continue;
            const u = byPppoe.get(uname) || null;
            const { intended, source, catatan } = resolveIntendedPath(ip, lists, cfg);
            const { actual, via } = resolveActualPath(intended, routeSnapshot, cfg);
            counts[actual] = (counts[actual] || 0) + 1;
            const intent = u && intentByUser.get(String(u.id));
            customers.push({
                userId: u ? u.id : null,
                name: (u && u.name) || uname,
                paket: (u && (u.subscription || u.paket)) || "-",
                pppoe: uname,
                ip,
                intended,
                actual,
                via,
                source,
                catatan,
                steerTarget: intent ? intent.path : null
            });
        }
        customers.sort((a, b) => String(a.name).localeCompare(String(b.name)));

        return {
            ok: true,
            enabled: cfg.enabled,
            counts,
            total_online: customers.length,
            customers,
            poolEntries: Object.fromEntries(cfg.poolLists.map((n) => [n, lists[n] || []])),
            steerEntries: Object.fromEntries(Object.entries(cfg.steerLists).map(([p, n]) => [p, lists[n] || []])),
            intents
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/** Rencana rule setup (dipakai setup + test). gmdp=accept (jatuh ke main), lainnya mark-routing. */
function buildSetupRules(cfg) {
    return [
        { comment: "RAF-CUSTSTEER-GMDP", srcList: cfg.steerLists.gmdp, kind: "accept" },
        { comment: "RAF-CUSTSTEER-IH", srcList: cfg.steerLists.ih, kind: "mark", mark: cfg.pathMarks.ih },
        { comment: "RAF-CUSTSTEER-MNI", srcList: cfg.steerLists.mni, kind: "mark", mark: cfg.pathMarks.mni },
        { comment: "RAF-CUSTSTEER-SF", srcList: cfg.steerLists.sf, kind: "mark", mark: cfg.pathMarks.sf }
    ];
}

/** Pasang/cek 4 rule override RAF-CUSTSTEER (idempoten; check=true read-only). */
async function setupSteeringRules({ check = false, actor = "-" } = {}, depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cfg = getSteeringConfig();
    if (!cfg.valid) return { ok: false, error: "Kredensial router belum dikonfigurasi." };
    const envelope = await deps.runBridge({ mode: "setup", check, rules: buildSetupRules(cfg) }, cfg, 25000);
    if (!envelope || envelope.status !== "success" || !envelope.data) {
        return { ok: false, error: (envelope && envelope.message) || "setup gagal" };
    }
    const dibuat = (envelope.data.rules || []).filter((r) => r.status === "dibuat").map((r) => r.comment);
    if (!check && dibuat.length) {
        try {
            await deps.addIncident({ path: "config", kind: "steer_setup", detail: { actor, dibuat } });
        } catch (_e) { /* audit best-effort */ }
    }
    return { ok: true, rules: envelope.data.rules, anchor: envelope.data.anchor };
}

/** Hapus entri steering ber-tag uid tertentu dari semua steer list (berdasarkan snapshot lists). */
async function removeUidEntries(deps, cfg, lists, userId) {
    const tag = `${STEER_COMMENT_PREFIX}${userId}`;
    for (const listName of Object.values(cfg.steerLists)) {
        for (const e of lists[listName] || []) {
            if (!e.dynamic && String(e.comment || "").startsWith(tag)) {
                await deps.runBridge({ mode: "entry-remove", list: listName, id: e.id }, cfg);
            }
        }
    }
}

/**
 * Satu putaran rekonsiliasi: pastikan tiap intent punya TEPAT SATU entri /32 di list tujuan
 * dengan IP PPPoE terkini; entri ber-tag uid tanpa intent → dibersihkan. Tidak pernah throw.
 */
async function reconcileOnce(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cfg = getSteeringConfig();
    if (!cfg.enabled || !cfg.valid) return { skipped: true };
    if (isReconciling) return { skipped: true, reason: "in-flight" };
    isReconciling = true;
    try {
        const intents = deps.readIntents();
        const lists = await fetchLists(deps, cfg);
        const actives = unwrapList(await deps.getActives().catch(() => []));
        const ipByUname = new Map();
        for (const a of actives) {
            const uname = normalizeUsername(a.name || a.user || a.username);
            const ip = String(a.address || a.ip || "").split("/")[0];
            if (uname && ip) ipByUname.set(uname, ip);
        }

        const actions = [];
        const intentUids = new Set(intents.map((i) => String(i.userId)));

        for (const intent of intents) {
            const listName = cfg.steerLists[intent.path];
            if (!listName) continue;
            const currentIp = ipByUname.get(normalizeUsername(intent.pppoe));
            if (!currentIp) continue; // offline — biarkan entri lama (tidak berbahaya)
            const tag = `${STEER_COMMENT_PREFIX}${intent.userId}`;
            const inDesired = (lists[listName] || []).find((e) => !e.dynamic && String(e.comment || "").startsWith(tag));
            const salahTempat = Object.values(cfg.steerLists)
                .filter((n) => n !== listName)
                .some((n) => (lists[n] || []).some((e) => String(e.comment || "").startsWith(tag)));
            const ipCocok = inDesired && (inDesired.address === currentIp || inDesired.address === `${currentIp}/32`);
            if (ipCocok && !salahTempat) continue;
            // Drift → bersihkan semua entri uid lalu pasang ulang dengan IP terkini.
            await removeUidEntries(deps, cfg, lists, intent.userId);
            const add = await deps.runBridge({
                mode: "entry-add",
                list: listName,
                address: currentIp,
                comment: `${tag} ${intent.pppoe}`
            }, cfg);
            actions.push({ userId: intent.userId, ip: currentIp, list: listName, ok: add && add.status === "success" });
            intent.addedIp = currentIp;
            intent.updatedAt = new Date(deps.nowMs()).toISOString();
        }

        // Bersihkan entri ber-tag uid yang intent-nya sudah dihapus.
        for (const listName of Object.values(cfg.steerLists)) {
            for (const e of lists[listName] || []) {
                const cm = String(e.comment || "");
                if (!cm.startsWith(STEER_COMMENT_PREFIX)) continue;
                const uid = cm.slice(STEER_COMMENT_PREFIX.length).split(/\s+/)[0];
                if (!intentUids.has(uid)) {
                    await deps.runBridge({ mode: "entry-remove", list: listName, id: e.id }, cfg);
                    actions.push({ userId: uid, removed: true, list: listName });
                }
            }
        }

        if (actions.length) deps.writeIntents(intents);
        return { skipped: false, actions };
    } catch (err) {
        console.warn(`[CustSteer] Rekonsiliasi gagal: ${err.message}`);
        return { skipped: true, reason: "error", error: err.message };
    } finally {
        isReconciling = false;
    }
}

/**
 * Steer satu pelanggan ke jalur tertentu (path null = kembalikan ke default pool-nya).
 * Intent disimpan → reconcile langsung (berlaku bila online; bila offline diterapkan otomatis
 * saat pelanggan tersambung). Tidak pernah throw.
 */
async function steerCustomer({ userId, path: targetPath = null, actor = "-" }, depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cfg = getSteeringConfig();
    if (!cfg.enabled) return { ok: false, error: "Steering nonaktif (config.customerSteering.enabled=false)." };
    if (!cfg.valid) return { ok: false, error: "Kredensial router belum dikonfigurasi." };
    const user = deps.getUsers().find((u) => String(u.id) === String(userId));
    if (!user) return { ok: false, error: `Pelanggan id ${userId} tidak ditemukan.` };
    if (!user.pppoe_username) return { ok: false, error: "Pelanggan tanpa pppoe_username — tidak bisa disteer." };
    if (targetPath && !cfg.steerLists[targetPath]) {
        return { ok: false, error: `Jalur tidak dikenal: ${targetPath}. Pilihan: ${Object.keys(cfg.steerLists).join(", ")}` };
    }
    try {
        const intents = deps.readIntents().filter((i) => String(i.userId) !== String(userId));
        if (targetPath) {
            intents.push({
                userId: user.id,
                pppoe: normalizeUsername(user.pppoe_username),
                name: user.name || null,
                path: targetPath,
                addedIp: null,
                actor,
                updatedAt: new Date(deps.nowMs()).toISOString()
            });
        }
        deps.writeIntents(intents);
        const hasil = await reconcileOnce(depsOverride);
        try {
            await deps.addIncident({
                path: targetPath || "default",
                kind: "steer",
                detail: { userId: user.id, name: user.name, pppoe: user.pppoe_username, path: targetPath, actor }
            });
        } catch (_e) { /* audit best-effort */ }
        const applied = hasil && Array.isArray(hasil.actions)
            ? hasil.actions.find((a) => String(a.userId) === String(user.id))
            : null;
        return {
            ok: true,
            message: targetPath
                ? (applied && applied.ok
                    ? `${user.name || user.pppoe_username} diarahkan via ${targetPath.toUpperCase()} (IP ${applied.ip}).`
                    : `${user.name || user.pppoe_username} dijadwalkan via ${targetPath.toUpperCase()} — diterapkan saat pelanggan online.`)
                : `${user.name || user.pppoe_username} dikembalikan ke jalur default pool-nya.`,
            appliedNow: Boolean(applied && applied.ok)
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/** Aksi entri POOL (freedns/lokaldns): toggle/add/remove — allowlist poolLists saja. */
async function poolEntryAction({ action, list, id = null, address = null, disabled = null, actor = "-" }, depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cfg = getSteeringConfig();
    if (!cfg.valid) return { ok: false, error: "Kredensial router belum dikonfigurasi." };
    if (!cfg.poolLists.includes(list)) {
        return { ok: false, error: `List "${list}" tidak diizinkan. Allowlist: ${cfg.poolLists.join(", ")}` };
    }
    let spec = null;
    if (action === "toggle") {
        if (!id) return { ok: false, error: "id entri wajib." };
        spec = { mode: "entry-toggle", list, id, disabled: disabled === true };
    } else if (action === "add") {
        const addr = String(address || "").trim();
        const cidrOk = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(addr);
        if (!cidrOk) return { ok: false, error: `Alamat "${addr}" bukan IP/CIDR valid.` };
        spec = { mode: "entry-add", list, address: addr, comment: `RAF-WEB ${actor}` };
    } else if (action === "remove") {
        if (!id) return { ok: false, error: "id entri wajib." };
        spec = { mode: "entry-remove", list, id };
    } else {
        return { ok: false, error: `Aksi tidak dikenal: ${action}` };
    }
    const envelope = await deps.runBridge(spec, cfg);
    if (!envelope || envelope.status !== "success") {
        return { ok: false, error: (envelope && envelope.message) || "gagal" };
    }
    try {
        await deps.addIncident({ path: list, kind: "steer_pool", detail: { action, list, id, address, disabled, actor } });
    } catch (_e) { /* audit best-effort */ }
    return { ok: true, entries: envelope.data.entries || [] };
}

// ── SEGMEN (pool/subnet) — kendali UTAMA "oper koneksi per segmen" ──────────────────────────
// Segmen = subnet pool (stabil; IP pelanggan dinamis di dalamnya). Base path via freedns(mni)/
// lokaldns(gmdp). Definisi default = recon router DANDER; override via config.customerSteering.segments.
const DEFAULT_SEGMENTS = [
    { id: "reguler", label: "Reguler", subnet: "192.168.70.0/24", defaultPath: "gmdp" },
    { id: "110k", label: "110K", subnet: "192.168.61.0/24", defaultPath: "mni" },
    { id: "125k", label: "125K", subnet: "192.168.62.0/24", defaultPath: "mni" },
    { id: "free", label: "FREE", subnet: "192.168.71.0/24", defaultPath: "mni" },
];
const POOL_PATH = { freedns: "mni", lokaldns: "gmdp" }; // list pool → jalur base
const SEGMENT_TARGETS = Object.values(POOL_PATH); // v1: mni/gmdp (IH/SF per-segmen = v2)

function getSegments() {
    const s = global.config && global.config.customerSteering && global.config.customerSteering.segments;
    return Array.isArray(s) && s.length ? s : DEFAULT_SEGMENTS;
}

/** Entri pool yang address-nya PERSIS subnet segmen (prefer yang aktif). */
function findSegmentEntry(entries, subnet) {
    const matches = (entries || []).filter((e) => String(e.address || "").trim() === subnet && !e.dynamic);
    const enabled = matches.find((e) => !e.disabled);
    return { enabled: Boolean(enabled), entry: enabled || matches[0] || null };
}

/** Jalur base segmen saat ini dari state list live + basisnya. */
function segmentCurrentPath(seg, lists, cfg) {
    // Override segmen: subnet ada di RAF-STEER-<jalur> (CIDR) — menang.
    for (const [p, ln] of Object.entries(cfg.steerLists)) {
        const m = (lists[ln] || []).find((e) => !e.disabled && !e.dynamic && String(e.address || "").trim() === seg.subnet);
        if (m) return { path: p, basis: `override:${ln}` };
    }
    const fre = findSegmentEntry(lists.freedns, seg.subnet);
    const lok = findSegmentEntry(lists.lokaldns, seg.subnet);
    if (fre.enabled) return { path: "mni", basis: "pool:freedns", ambiguous: lok.enabled };
    if (lok.enabled) return { path: "gmdp", basis: "pool:lokaldns" };
    return { path: seg.defaultPath || "gmdp", basis: "default" };
}

/**
 * PETA SEGMEN: tiap segmen → jalur base sekarang + jumlah pelanggan aktif + entri pool (id/disabled).
 * READ-ONLY (butuh cfg.valid saja, jalan walau steering masih dorman). Tidak pernah throw.
 */
async function buildSegmentMap(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cfg = getSteeringConfig();
    if (!cfg.valid) return { ok: false, error: "Kredensial router belum dikonfigurasi (upstreamMonitor/wanSwitch/customerSteering)." };
    try {
        const lists = await fetchLists(deps, cfg);
        const actives = unwrapList(await deps.getActives().catch(() => []));
        const segments = getSegments().map((seg) => {
            const fre = findSegmentEntry(lists.freedns, seg.subnet);
            const lok = findSegmentEntry(lists.lokaldns, seg.subnet);
            const cur = segmentCurrentPath(seg, lists, cfg);
            const activeCount = actives.filter((a) => {
                const ip = String(a.address || a.ip || "").split("/")[0];
                return ip && ipInCidr(ip, seg.subnet);
            }).length;
            return {
                id: seg.id, label: seg.label, subnet: seg.subnet,
                currentPath: cur.path, basis: cur.basis, ambiguous: Boolean(cur.ambiguous),
                activeCount,
                entries: {
                    freedns: fre.entry ? { id: fre.entry.id, disabled: Boolean(fre.entry.disabled) } : null,
                    lokaldns: lok.entry ? { id: lok.entry.id, disabled: Boolean(lok.entry.disabled) } : null,
                },
            };
        });
        return { ok: true, segments, targets: SEGMENT_TARGETS };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * PRATINJAU (DRY-RUN) pindah SATU segmen ke jalur target — TIDAK menulis router.
 * Mengembalikan daftar operasi address-list PERSIS yang akan dijalankan B2 (toggle/add), supaya
 * bisa ditinjau dulu. v1: target mni/gmdp (freedns/lokaldns). Tidak pernah throw.
 */
async function previewSegmentMove({ segment, path: targetPath }, depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cfg = getSteeringConfig();
    if (!cfg.valid) return { ok: false, error: "Kredensial router belum dikonfigurasi." };
    const seg = getSegments().find((s) => s.id === segment || s.subnet === segment);
    if (!seg) return { ok: false, error: `Segmen tidak dikenal: ${segment}. Pilihan: ${getSegments().map((s) => s.id).join(", ")}` };
    if (!SEGMENT_TARGETS.includes(targetPath)) {
        return { ok: false, error: `Jalur segmen v1 hanya ${SEGMENT_TARGETS.join("/")}. Untuk ${targetPath || "?"} pakai override per-pelanggan.` };
    }
    try {
        const lists = await fetchLists(deps, cfg);
        const fre = findSegmentEntry(lists.freedns, seg.subnet);
        const lok = findSegmentEntry(lists.lokaldns, seg.subnet);
        const from = segmentCurrentPath(seg, lists, cfg).path;
        const wantEnabled = targetPath === "mni" ? "freedns" : "lokaldns";
        const wantDisabled = targetPath === "mni" ? "lokaldns" : "freedns";
        const wantEntry = wantEnabled === "freedns" ? fre : lok;
        const otherEntry = wantDisabled === "freedns" ? fre : lok;
        const ops = [];
        if (!wantEntry.entry) {
            ops.push({ action: "add", list: wantEnabled, address: seg.subnet, desc: `tambah ${seg.subnet} ke ${wantEnabled} (aktif)` });
        } else if (wantEntry.entry.disabled) {
            ops.push({ action: "toggle", list: wantEnabled, id: wantEntry.entry.id, disabled: false, desc: `aktifkan ${seg.subnet} di ${wantEnabled}` });
        }
        if (otherEntry.entry && !otherEntry.entry.disabled) {
            ops.push({ action: "toggle", list: wantDisabled, id: otherEntry.entry.id, disabled: true, desc: `nonaktifkan ${seg.subnet} di ${wantDisabled}` });
        }
        return { ok: true, segment: seg.id, label: seg.label, subnet: seg.subnet, from, to: targetPath, noop: ops.length === 0, ops, note: "DRY-RUN — belum ada perubahan router." };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/** Balikkan operasi segmen yang SUDAH sukses (urutan mundur) — best-effort saat apply/verify gagal. */
async function rollbackSegmentOps(deps, cfg, applied) {
    for (const op of [...applied].reverse()) {
        if (!op.ok) continue;
        try {
            if (op.action === "add") {
                const env = await deps.runBridge({ mode: "list", lists: [op.list] }, cfg);
                const entries = (env && env.data && env.data.lists && env.data.lists[op.list]) || [];
                const mine = entries.find((e) => !e.dynamic && String(e.address || "").trim() === op.address);
                if (mine) await deps.runBridge({ mode: "entry-remove", list: op.list, id: mine.id }, cfg);
            } else if (op.action === "toggle") {
                await deps.runBridge({ mode: "entry-toggle", list: op.list, id: op.id, disabled: !op.disabled }, cfg);
            }
        } catch (_e) { /* rollback best-effort */ }
    }
}

/**
 * TERAPKAN pindah SATU segmen ke jalur target (MENULIS address-list router). Alur AMAN:
 * preview → butuh `confirm:true` → jalankan ops → VERIFY (baca ulang peta, pastikan jalur = target)
 * → bila gagal ROLLBACK otomatis. Butuh `cfg.valid` (kredensial) + confirm eksplisit; TIDAK
 * di-gate `enabled` (itu utk reconciler /32; segmen pakai subnet stabil, tak perlu reconciler).
 * Tidak pernah throw.
 */
async function applySegmentMove({ segment, path: targetPath, actor = "-", confirm = false }, depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const cfg = getSteeringConfig();
    if (!cfg.valid) return { ok: false, error: "Kredensial router belum dikonfigurasi." };
    const preview = await previewSegmentMove({ segment, path: targetPath }, depsOverride);
    if (!preview.ok) return preview;
    if (preview.noop) {
        return { ok: true, noop: true, segment: preview.segment, from: preview.from, to: targetPath, applied: [], message: `Segmen ${preview.label} sudah di ${String(targetPath).toUpperCase()}.` };
    }
    if (confirm !== true) {
        return { ok: false, needConfirm: true, preview, error: "Butuh confirm=true untuk menulis router." };
    }
    const applied = [];
    for (const op of preview.ops) {
        let r;
        if (op.action === "add") {
            r = await deps.runBridge({ mode: "entry-add", list: op.list, address: op.address, comment: `RAF-SEG ${actor}` }, cfg);
        } else {
            r = await deps.runBridge({ mode: "entry-toggle", list: op.list, id: op.id, disabled: op.disabled }, cfg);
        }
        const okOp = Boolean(r && r.status === "success");
        applied.push({ ...op, ok: okOp });
        if (!okOp) {
            await rollbackSegmentOps(deps, cfg, applied);
            return { ok: false, error: `Operasi gagal (${op.desc}): ${(r && r.message) || "?"} — sudah di-rollback.`, applied };
        }
    }
    // VERIFY: baca ulang peta, pastikan segmen benar-benar di target.
    const after = await buildSegmentMap(depsOverride);
    const segAfter = after.ok ? after.segments.find((s) => s.id === preview.segment) : null;
    const verified = Boolean(segAfter && segAfter.currentPath === targetPath);
    if (!verified) {
        await rollbackSegmentOps(deps, cfg, applied);
        return { ok: false, error: `Verify gagal (segmen ${preview.label} bukan ${String(targetPath).toUpperCase()} setelah tulis) — sudah di-rollback.`, applied, actualAfter: segAfter && segAfter.currentPath };
    }
    try {
        await deps.addIncident({ path: targetPath, kind: "steer_segment", detail: { segment: preview.segment, subnet: preview.subnet, from: preview.from, to: targetPath, ops: preview.ops, actor } });
    } catch (_e) { /* audit best-effort */ }
    return { ok: true, segment: preview.segment, label: preview.label, subnet: preview.subnet, from: preview.from, to: targetPath, verified: true, applied, message: `Segmen ${preview.label} dipindah ${String(preview.from).toUpperCase()} → ${String(targetPath).toUpperCase()} (terverifikasi).` };
}

/** Reconciler berkala — menjaga entri steering mengikuti IP PPPoE terkini. */
function startCustomerSteeringReconciler() {
    const cfg = getSteeringConfig();
    if (!cfg.enabled) {
        console.log("[CustSteer] Nonaktif (set config.customerSteering.enabled=true untuk mengaktifkan)");
        return;
    }
    if (!cfg.valid) {
        console.warn("[CustSteer] Aktif tapi kredensial router kosong — reconciler tidak dijalankan.");
        return;
    }
    if (reconcilerTimer) return;
    console.log(`[CustSteer] Reconciler start (interval ${Math.round(cfg.reconcileIntervalMs / 1000)}s)`);
    reconcilerTimer = setInterval(() => { reconcileOnce().catch(() => {}); }, cfg.reconcileIntervalMs);
    if (reconcilerTimer.unref) reconcilerTimer.unref();
}

function stopCustomerSteeringReconciler() {
    if (reconcilerTimer) clearInterval(reconcilerTimer);
    reconcilerTimer = null;
}

module.exports = {
    getSteeringConfig,
    buildSteeringOverview,
    buildSegmentMap,
    previewSegmentMove,
    applySegmentMove,
    steerCustomer,
    poolEntryAction,
    setupSteeringRules,
    reconcileOnce,
    startCustomerSteeringReconciler,
    stopCustomerSteeringReconciler,
    _internal: {
        resolveIntendedPath,
        resolveActualPath,
        buildSetupRules,
        ipInEntry,
        getSegments,
        findSegmentEntry,
        segmentCurrentPath,
        DEFAULT_SEGMENTS,
        STEER_COMMENT_PREFIX
    }
};
