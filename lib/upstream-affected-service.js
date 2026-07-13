/**
 * Header Doc
 * Purpose: Hitung himpunan pelanggan yang jalur upstream LIVE-nya berada di `path` (gmdp/mni/ih/sf)
 *          — SATU sumber kebenaran "pelanggan terdampak" untuk baris alert down/pulih (dan bisa
 *          dipakai panel/komplain). Menggantikan string statis `upstreamMonitor.paths[].affects`
 *          yang terbukti 46% meleset dari realita saat owner memindah pool via freedns/lokaldns.
 *          Resolusi per-pelanggan lewat `lib/customer-path-resolver.resolveCustomerPath`
 *          (live 3-lapis: RAF-STEER → profil pool → jaring pengaman), FAIL-CLOSED: bila router
 *          tak terbaca → `confidence:'unknown'` + `count:null` (jangan karang angka).
 * Caller: `lib/upstream-quality-alerter` (baris "Terdampak" pada alert down + rekap pulih).
 * Deps: lazy `lib/mikrotik.getActivePPPoEUsers` (sesi PPPoE aktif live),
 *       lazy `lib/customer-path-resolver` (`getSteeringSnapshot` utk deteksi router terbaca +
 *       `resolveCustomerPath` per-IP; keduanya berbagi cache snapshot ~60s).
 * MainFuncs: `getAffectedSet`.
 * SideEffects: Baca PPPoE aktif + address-list via bridge PHP (READ-ONLY). TIDAK PERNAH throw.
 */
"use strict";

// Jalur valid yang membawa/menerima pelanggan. `getAffectedSet` hanya bermakna untuk ini.
const VALID_PATHS = new Set(["gmdp", "mni", "ih", "sf"]);

function defaultDeps() {
    return {
        getActivePPPoEUsers: (args) => require("./mikrotik").getActivePPPoEUsers(args),
        getSteeringSnapshot: () => require("./customer-path-resolver").getSteeringSnapshot(),
        resolveCustomerPath: (ip) => require("./customer-path-resolver").resolveCustomerPath(ip)
    };
}

/**
 * Ekstrak array sesi dari beragam bentuk balikan bridge MikroTik. `null` = kegagalan eksplisit
 * (mis. `{ok:false}` atau bentuk tak dikenal) supaya pemanggil bisa fail-closed, BUKAN "0 sesi".
 */
function activeListFrom(res) {
    if (res && res.ok === false) return null;
    if (Array.isArray(res)) return res;
    if (Array.isArray(res && res.data)) return res.data;
    if (Array.isArray(res && res.data && res.data.data)) return res.data.data;
    if (Array.isArray(res && res.items)) return res.items;
    return null;
}

/**
 * Himpunan pelanggan aktif yang jalur LIVE-nya = `path`.
 * @param {'gmdp'|'mni'|'ih'|'sf'} path
 * @param {{sample?:number}} [opts]  sample = maksimal nama contoh yang disertakan (default semua).
 * @param {object} [depsOverride]     untuk unit test.
 * @returns {Promise<{path:string, count:number|null, customers:Array<{name:string,ip:string}>, confidence:'live'|'unknown'}>}
 */
async function getAffectedSet(path, opts = {}, depsOverride = {}) {
    const deps = { ...defaultDeps(), ...depsOverride };
    const out = { path, count: null, customers: [], confidence: "unknown" };
    if (!VALID_PATHS.has(path)) return out;

    // 1) FAIL-CLOSED: pastikan address-list steering terbaca. Snapshot ini juga menghangatkan cache
    //    resolver (~60s) → resolveCustomerPath di bawah tak menembak router berulang.
    try {
        await deps.getSteeringSnapshot();
    } catch (_e) {
        return out; // router tak terbaca → confidence 'unknown'
    }

    // 2) Sesi PPPoE aktif live.
    let list;
    try {
        list = activeListFrom(await deps.getActivePPPoEUsers({ router_id: "default" }));
    } catch (_e) {
        list = null;
    }
    if (!Array.isArray(list)) return out; // gagal baca sesi → 'unknown', bukan 0

    // 3) Resolusi per-pelanggan; kumpulkan yang jalur LIVE-nya = path.
    const customers = [];
    for (const item of list) {
        const ip = String((item && (item.address || item.ip)) || "").split("/")[0];
        if (!ip) continue;
        let resolved = null;
        try {
            resolved = await deps.resolveCustomerPath(ip);
        } catch (_e) {
            resolved = null;
        }
        if (resolved === path) {
            customers.push({ name: String((item.name || item.user || item.username || ip)), ip });
        }
    }

    const limit = Number.isFinite(opts.sample) && opts.sample >= 0 ? opts.sample : customers.length;
    out.count = customers.length;
    out.customers = customers.slice(0, limit);
    out.confidence = "live";
    return out;
}

module.exports = { getAffectedSet, _internal: { activeListFrom, VALID_PATHS } };
