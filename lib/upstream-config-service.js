/**
 * Header Doc
 * Purpose: Kustomisasi ARAH monitor jalur dari web admin — view aman + validasi + persist untuk
 *          bagian config yang memang layak diubah leluasa: target ping (arah ICMP), daftar
 *          layanan TCP+TLS (arah layanan: IG/TikTok/Netflix/dll), properti jalur non-struktural
 *          (label/affects/gatewayTarget/capacity), thresholds, dan TAMPILAN report "data <isp>"
 *          (jumlah pelanggan terdampak + on/off tiap seksi). Field WIRING (key/routingTable/
 *          iface/tunnelType/srcIp) SENGAJA read-only — salah ubah = probe mati/vonis palsu.
 *          Perubahan berlaku LIVE tanpa restart (poller/prober membaca config tiap siklus);
 *          intervalSeconds butuh restart (timer dipasang saat start).
 * Caller: `routes/admin-upstream-quality-routes.js` (GET/PUT /api/upstream-quality/config).
 * Deps: `fs` (config.json + backup .bak-webedit), lazy `lib/upstream-quality-poller.getMonitorConfig`
 *       + `lib/service-reachability-prober.getServiceConfig` (view efektif ber-default),
 *       `repositories/upstream-quality.repository.addIncident` (audit, best-effort).
 * MainFuncs: `getEditableUpstreamConfig`, `applyUpstreamConfigPatch`, validator murni di `_internal`.
 * SideEffects: PUT menulis `config.json` (backup `config.json.bak-webedit` dulu) + mutasi
 *              `global.config.upstreamMonitor/serviceMonitor` (live-apply) + insiden kind `config`.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config.json");

// 1.1.1.1 & 8.8.8.8 dipin router untuk recursive gateway-check → ping ke sana MENYESATKAN.
const FORBIDDEN_TARGET_ADDRESSES = new Set(["1.1.1.1", "8.8.8.8"]);
const KEY_RE = /^[a-z0-9][a-z0-9_-]{1,19}$/;
const MAX_TARGETS = 8;
const MAX_SERVICES = 15;

function defaultDeps() {
    return {
        readConfig: () => JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")),
        writeConfig: (cfg) => {
            try { fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak-webedit`); } catch (_e) { /* backup best-effort */ }
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 4), "utf8");
        },
        applyRuntime: (cfg) => {
            if (global.config) {
                global.config.upstreamMonitor = cfg.upstreamMonitor;
                if (cfg.serviceMonitor !== undefined) global.config.serviceMonitor = cfg.serviceMonitor;
            }
        },
        getEffectiveMonitorConfig: () => require("./upstream-quality-poller").getMonitorConfig(),
        getEffectiveServiceConfig: () => require("./service-reachability-prober").getServiceConfig(),
        addIncident: (payload) => require("../repositories/upstream-quality.repository")
            .getUpstreamQualityRepository().addIncident(payload)
    };
}

function isValidIPv4(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || "").trim());
    if (!m) return false;
    return m.slice(1).every((part) => Number(part) <= 255);
}

/** Hostname FQDN (butuh minimal 1 titik + TLD huruf) — tanpa skema/path. */
function isValidHostname(s) {
    const v = String(s || "").trim().toLowerCase();
    if (v.length < 4 || v.length > 253) return false;
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(v)) return false;
    return /[a-z]{2,}$/.test(v); // TLD huruf → membedakan dari IPv4
}

function cleanStr(v, max) {
    return String(v == null ? "" : v).trim().slice(0, max);
}

/** Validasi daftar target ping. @returns {{value?:Array, errors:string[]}} */
function validateTargets(list) {
    const errors = [];
    if (!Array.isArray(list)) return { errors: ["targets harus array"] };
    if (!list.length) return { errors: ["minimal 1 target ping"] };
    if (list.length > MAX_TARGETS) return { errors: [`maksimal ${MAX_TARGETS} target (tiap target menambah beban probe per siklus)`] };
    const seen = new Set();
    const value = [];
    list.forEach((t, i) => {
        const key = cleanStr(t && t.key, 20).toLowerCase();
        const label = cleanStr(t && t.label, 40);
        const address = cleanStr(t && t.address, 253);
        if (!KEY_RE.test(key)) errors.push(`target #${i + 1}: key tidak valid (huruf kecil/angka/-/_, 2-20 char)`);
        else if (seen.has(key)) errors.push(`target #${i + 1}: key "${key}" dobel`);
        seen.add(key);
        if (!isValidIPv4(address) && !isValidHostname(address)) {
            errors.push(`target #${i + 1}: alamat "${address}" bukan IPv4/hostname valid`);
        } else if (FORBIDDEN_TARGET_ADDRESSES.has(address)) {
            errors.push(`target #${i + 1}: ${address} dipakai router untuk recursive gateway-check — hasil ping menyesatkan; pakai mis. 8.8.4.4 / 1.0.0.1`);
        }
        value.push({ key, label: label || key, address });
    });
    return errors.length ? { errors } : { value, errors: [] };
}

/** Validasi daftar layanan TCP+TLS. Host WAJIB hostname (IP Meta/TikTok arbitrer sering mati). */
function validateServices(list) {
    const errors = [];
    if (!Array.isArray(list)) return { errors: ["services harus array"] };
    if (list.length > MAX_SERVICES) return { errors: [`maksimal ${MAX_SERVICES} layanan`] };
    const seen = new Set();
    const value = [];
    list.forEach((s, i) => {
        const key = cleanStr(s && s.key, 20).toLowerCase();
        const label = cleanStr(s && s.label, 40);
        const host = cleanStr(s && s.host, 253).toLowerCase();
        if (!KEY_RE.test(key)) errors.push(`layanan #${i + 1}: key tidak valid (huruf kecil/angka/-/_, 2-20 char)`);
        else if (seen.has(key)) errors.push(`layanan #${i + 1}: key "${key}" dobel`);
        seen.add(key);
        if (!isValidHostname(host)) {
            errors.push(`layanan #${i + 1}: host "${host}" harus HOSTNAME (mis. www.netflix.com) — IP langsung sering mati/berpindah (CDN)`);
        }
        value.push({ key, label: label || key, host });
    });
    return errors.length ? { errors } : { value, errors: [] };
}

/** Validasi patch properti jalur non-struktural per key. */
function validatePathsPatch(list, currentPaths) {
    const errors = [];
    if (!Array.isArray(list)) return { errors: ["paths harus array"] };
    const byKey = new Map((currentPaths || []).map((p) => [p.key, p]));
    const value = [];
    list.forEach((p, i) => {
        const key = cleanStr(p && p.key, 20).toLowerCase();
        if (!byKey.has(key)) {
            errors.push(`jalur #${i + 1}: key "${key}" tidak dikenal (wiring jalur baru harus lewat config.json)`);
            return;
        }
        const out = { key };
        if (p.label !== undefined) {
            const label = cleanStr(p.label, 48);
            if (!label) errors.push(`jalur ${key}: label tidak boleh kosong`);
            out.label = label;
        }
        if (p.affects !== undefined) out.affects = cleanStr(p.affects, 100); // kosong = hapus
        if (p.gatewayTarget !== undefined) {
            const gw = cleanStr(p.gatewayTarget, 64);
            if (gw && !isValidIPv4(gw)) errors.push(`jalur ${key}: gatewayTarget "${gw}" bukan IPv4 (kosongkan utk tunnel — otomatis dari remote-address)`);
            out.gatewayTarget = gw; // '' = hapus (tunnel pakai remote-address monitor)
        }
        if (p.capacity !== undefined) {
            const dn = Number(p.capacity && p.capacity.downMbps);
            const up = Number(p.capacity && p.capacity.upMbps);
            if (!Number.isFinite(dn) || dn < 0 || dn > 100000 || !Number.isFinite(up) || up < 0 || up > 100000) {
                errors.push(`jalur ${key}: capacity harus angka Mbps 0-100000 (0 = belum diisi)`);
            } else {
                out.capacity = { downMbps: dn, upMbps: up };
            }
        }
        value.push(out);
    });
    return errors.length ? { errors } : { value, errors: [] };
}

function validateThresholds(obj) {
    const errors = [];
    if (typeof obj !== "object" || obj == null) return { errors: ["thresholds harus objek"] };
    const out = {};
    const num = (name, min, max) => {
        if (obj[name] === undefined) return;
        const v = Number(obj[name]);
        if (!Number.isFinite(v) || v < min || v > max) errors.push(`${name} harus angka ${min}-${max}`);
        else out[name] = v;
    };
    num("lossWarnPct", 1, 50);
    num("lossCritPct", 2, 100);
    num("rttWarnFactor", 1.1, 5);
    num("rttCritFactor", 1.2, 10);
    num("saturationPct", 50, 100);
    const warn = out.lossWarnPct;
    const crit = out.lossCritPct;
    if (warn != null && crit != null && crit <= warn) errors.push("lossCritPct harus > lossWarnPct");
    return errors.length ? { errors } : { value: out, errors: [] };
}

// Seksi report "data <isp>" yang boleh di-toggle (harus sinkron dgn DEFAULT_REPORT.sections di poller).
const REPORT_SECTION_KEYS = ["rincianArah", "layananPopuler", "polaLossPerJam", "perArah24jam", "gangguanTercatat", "tujuhHari", "insidenTerakhir"];

/** Validasi patch tampilan report {affectedListMax?, alertAffectedListMax?, sections?}. */
function validateReport(obj) {
    const errors = [];
    if (typeof obj !== "object" || obj == null) return { errors: ["report harus objek"] };
    const out = {};
    const intField = (name, min, max) => {
        if (obj[name] === undefined) return;
        const v = Number(obj[name]);
        if (!Number.isInteger(v) || v < min || v > max) errors.push(`${name} harus bilangan bulat ${min}-${max} (0 = tampilkan semua)`);
        else out[name] = v;
    };
    intField("affectedListMax", 0, 1000);
    intField("alertAffectedListMax", 0, 200);
    if (obj.sections !== undefined) {
        if (typeof obj.sections !== "object" || obj.sections == null) {
            errors.push("sections harus objek {namaSeksi: boolean}");
        } else {
            const sec = {};
            for (const [k, v] of Object.entries(obj.sections)) {
                if (!REPORT_SECTION_KEYS.includes(k)) { errors.push(`sections: seksi "${k}" tidak dikenal`); continue; }
                // Apa pun selain truthy eksplisit dianggap OFF (checkbox mati) — tak pernah lempar.
                sec[k] = v === true || v === "true" || v === 1 || v === "1" || v === "on";
            }
            if (Object.keys(sec).length) out.sections = sec;
        }
    }
    return errors.length ? { errors } : { value: out, errors: [] };
}

/** View aman utk halaman web: konfigurasi EFEKTIF (default ter-merge) + penanda wiring readonly. */
function getEditableUpstreamConfig(depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const mon = deps.getEffectiveMonitorConfig();
    let svc = null;
    try { svc = deps.getEffectiveServiceConfig(); } catch (_e) { svc = null; }
    return {
        monitorEnabled: mon.enabled === true,
        intervalSeconds: Math.round((mon.intervalMs || 60000) / 1000),
        statusWindowMinutes: mon.statusWindowMinutes,
        targets: (mon.targets || []).map((t) => ({ key: t.key || t.address, label: t.label || t.key || t.address, address: t.address })),
        thresholds: {
            lossWarnPct: mon.thresholds.lossWarnPct,
            lossCritPct: mon.thresholds.lossCritPct,
            rttWarnFactor: mon.thresholds.rttWarnFactor,
            rttCritFactor: mon.thresholds.rttCritFactor,
            saturationPct: mon.thresholds.saturationPct
        },
        report: (() => {
            // mon.report SELALU dinormalisasi getMonitorConfig; guard normalizeReport() utk dep test parsial.
            const rep = mon.report || require("./upstream-quality-poller")._internal.normalizeReport();
            return {
                affectedListMax: rep.affectedListMax,
                alertAffectedListMax: rep.alertAffectedListMax,
                sections: { ...rep.sections }
            };
        })(),
        paths: (mon.paths || []).map((p) => ({
            key: p.key,
            label: p.label || p.key,
            affects: p.affects || "",
            gatewayTarget: p.gatewayTarget || "",
            capacity: {
                downMbps: Number(p.capacity && p.capacity.downMbps) || 0,
                upMbps: Number(p.capacity && p.capacity.upMbps) || 0
            },
            wiring: {
                routingTable: p.routingTable || "main",
                iface: p.iface || null,
                tunnelType: p.tunnelType || null
            }
        })),
        serviceEnabled: Boolean(svc && svc.enabled === true),
        services: svc ? (svc.services || []).map((s) => ({ key: s.key, label: s.label || s.key, host: s.host })) : [],
        servicePaths: svc ? (svc.paths || []).map((p) => ({ key: p.key, label: p.label || p.key, srcIp: p.srcIp })) : []
    };
}

/**
 * Terapkan patch {targets?, services?, paths?, thresholds?, report?} — validasi dulu SEMUA bagian,
 * satu pun error → TIDAK ada yang ditulis. Sukses → tulis config.json + live-apply + audit.
 */
function applyUpstreamConfigPatch(patch = {}, actorLabel = "-", depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    try {
        const disk = deps.readConfig();
        const errors = [];
        const changes = [];

        if (!disk.upstreamMonitor || typeof disk.upstreamMonitor !== "object") disk.upstreamMonitor = {};

        if (patch.targets !== undefined) {
            const r = validateTargets(patch.targets);
            if (r.errors.length) errors.push(...r.errors);
            else { disk.upstreamMonitor.targets = r.value; changes.push("targets"); }
        }

        if (patch.services !== undefined) {
            const r = validateServices(patch.services);
            if (r.errors.length) errors.push(...r.errors);
            else {
                if (!disk.serviceMonitor || typeof disk.serviceMonitor !== "object") disk.serviceMonitor = {};
                disk.serviceMonitor.services = r.value;
                changes.push("services");
            }
        }

        if (patch.paths !== undefined) {
            // Materialisasi daftar paths efektif bila config belum punya array paths (masih default).
            if (!Array.isArray(disk.upstreamMonitor.paths) || !disk.upstreamMonitor.paths.length) {
                disk.upstreamMonitor.paths = deps.getEffectiveMonitorConfig().paths.map((p) => ({ ...p }));
            }
            const r = validatePathsPatch(patch.paths, disk.upstreamMonitor.paths);
            if (r.errors.length) errors.push(...r.errors);
            else {
                for (const edit of r.value) {
                    const target = disk.upstreamMonitor.paths.find((p) => p.key === edit.key);
                    if (!target) continue;
                    if (edit.label !== undefined) target.label = edit.label;
                    if (edit.affects !== undefined) {
                        if (edit.affects) target.affects = edit.affects;
                        else delete target.affects;
                    }
                    if (edit.gatewayTarget !== undefined) {
                        if (edit.gatewayTarget) target.gatewayTarget = edit.gatewayTarget;
                        else delete target.gatewayTarget;
                    }
                    if (edit.capacity !== undefined) target.capacity = edit.capacity;
                }
                changes.push("paths");
            }
        }

        if (patch.thresholds !== undefined) {
            const r = validateThresholds(patch.thresholds);
            if (r.errors.length) errors.push(...r.errors);
            else {
                disk.upstreamMonitor.thresholds = { ...(disk.upstreamMonitor.thresholds || {}), ...r.value };
                changes.push("thresholds");
            }
        }

        if (patch.report !== undefined) {
            const r = validateReport(patch.report);
            if (r.errors.length) errors.push(...r.errors);
            else {
                // Deep-merge sections supaya patch parsial (mis. 1 checkbox) tak menghapus toggle lain.
                const prev = (disk.upstreamMonitor.report && typeof disk.upstreamMonitor.report === "object") ? disk.upstreamMonitor.report : {};
                const merged = { ...prev, ...r.value };
                if (r.value.sections) merged.sections = { ...(prev.sections || {}), ...r.value.sections };
                disk.upstreamMonitor.report = merged;
                changes.push("report");
            }
        }

        if (errors.length) return { ok: false, errors };
        if (!changes.length) return { ok: false, errors: ["tidak ada bagian yang diubah"] };

        deps.writeConfig(disk);
        deps.applyRuntime(disk);
        try {
            deps.addIncident({
                path: "config",
                kind: "config",
                detail: { actor: actorLabel, changes }
            });
        } catch (_e) { /* audit best-effort */ }
        console.log(`[UPQ-Config] ${actorLabel} mengubah: ${changes.join(", ")} (live tanpa restart)`);
        return { ok: true, changes, appliedLive: true };
    } catch (err) {
        console.error(`[UPQ-Config] Gagal menerapkan patch: ${err.message}`);
        return { ok: false, errors: [`gagal menyimpan: ${err.message}`] };
    }
}

module.exports = {
    getEditableUpstreamConfig,
    applyUpstreamConfigPatch,
    _internal: {
        validateTargets,
        validateServices,
        validatePathsPatch,
        validateThresholds,
        validateReport,
        isValidIPv4,
        isValidHostname,
        FORBIDDEN_TARGET_ADDRESSES
    }
};
