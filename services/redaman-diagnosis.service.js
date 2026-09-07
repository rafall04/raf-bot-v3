/**
 * Header Doc
 * Purpose: SATU sumber diagnosa redaman 1 pelanggan DUA-SISI (fondasi #b350) — dipakai SEMUA
 *   permukaan teknisi (WA intent, panel tiket web, Telegram, batch-terdampak). Menyatukan pola yang
 *   dulu terduplikasi di 4 tempat (Telegram redaman-command, post-repair, cron redaman-check,
 *   network-ops ACS-only). Ambil PARALEL & best-effort: sisi Modem (GenieACS/TR-069 force-refresh,
 *   live) + sisi OLT (snapshot web ber-cache 30s, resolveByCustomer) + sesi PPPoE aktif (SUMBER MAC
 *   utama match ONU EPON/Hioso). Vonis LEWAT rxVerdict + config.rx_tolerance (JANGAN lahirkan ambang
 *   baru). READ-ONLY, murni (deps diinjeksi), NEVER-THROW — cocok dipanggil dari jalur WA berguard.
 *   KEJUJURAN: angka OLT hanya dipakai bila isRxPowerValid (ONU non-Online pamer RX basi #b283);
 *   ACS inform ~12mnt bisa basi (#b257). Buta != buruk — tak menyimpulkan/eskalasi dari bacaan buta.
 * Caller: message/handlers/raf-intent-dispatch/* (WA), routes/teknisi diagnosa, message/telegram
 *   redaman-command (dialihkan ke sini), lib batch-terdampak.
 * Deps (inject): getCustomerRedaman (lib/wifi), resolveByCustomer+getOltSnapshot (lib/olt-optical-resolver),
 *   getActivePPPoEUsers (lib/mikrotik), getConfig. Verdict: lib/telegram/telegram-format.rxVerdict;
 *   gabungan: lib/redaman-sumber-silang.ringkasDuaSumber.
 * MainFuncs: createRedamanDiagnosisService, getRedamanDiagnosisService (default terwire),
 *   formatDetailLines, buildKesimpulan.
 * SideEffects: via deps — refresh+query GenieACS, snapshot OLT (ber-cache), baca sesi PPPoE MikroTik.
 */
"use strict";

const { rxVerdict } = require("../lib/telegram/telegram-format");
const { ringkasDuaSumber } = require("../lib/redaman-sumber-silang");

function displayName(user) {
    return String((user && user.name) || "").split("|")[0].trim() || "(tanpa nama)";
}
function firstPart(value) {
    return String(value == null ? "" : value).split("|")[0].trim();
}
function unwrapPppoeList(res) {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.data)) return res.data;
    if (res && res.data && Array.isArray(res.data.data)) return res.data.data;
    return [];
}

/**
 * Kesimpulan singkat berbasis status ONU + vonis modem. Diangkat dari Telegram redaman-command
 * (SATU logika kesimpulan). Status OLT (LOS/Dying-Gasp/offline) tak bergantung rxPowerValid —
 * itu fakta dari phaseState/log, bukan angka RX.
 */
function buildKesimpulan(modemVerdict, optical) {
    const oltOffline = optical && optical.identifiable && String(optical.status || "").toLowerCase() !== "online";
    if (oltOffline) {
        if (optical.isDyingGasp) return "Kesimpulan: ONU mati (Dying Gasp) — cek catu daya/adaptor di lokasi.";
        if (optical.isLos) return "Kesimpulan: LOS — kemungkinan fiber putus / konektor kotor / redaman parah.";
        return "Kesimpulan: ONU tidak online di OLT — perlu pengecekan fisik.";
    }
    if (modemVerdict && modemVerdict.label === "BURUK") return "Kesimpulan: redaman BURUK — periksa konektor/splicing, jarak, atau bending kabel.";
    if (modemVerdict && modemVerdict.label === "WASPADA") return "Kesimpulan: redaman mendekati ambang — pantau, rapikan konektor bila perlu.";
    if (modemVerdict && modemVerdict.label === "BAIK") return "Kesimpulan: redaman dalam batas wajar. ✅";
    return null;
}

/**
 * Rangkai baris DETAIL plain-text (tanpa HTML) dari objek diagnosa — dipakai permukaan WA/panel
 * (Telegram punya format HTML sendiri). Menampilkan freshness/validitas jujur.
 */
function formatDetailLines(diag) {
    const lines = [];
    // Sisi modem
    lines.push("— Sisi Modem (ONU) —");
    if (!diag.modem.hasDevice) {
        lines.push("Tidak terhubung GenieACS (tanpa device ACS).");
    } else if (!diag.modem.reachable) {
        lines.push("⚠️ Modem tidak terjangkau via GenieACS (offline / belum inform).");
    } else if (!diag.modem.verdict || diag.modem.verdict.value === null) {
        lines.push("RX: data redaman tidak tersedia.");
    } else {
        lines.push(`RX: ${diag.modem.verdict.emoji} ${diag.modem.rxRaw} dBm — ${diag.modem.verdict.label}`);
    }
    // Sisi OLT
    lines.push("", "— Sisi OLT —");
    const o = diag.olt;
    if (!o || !o.matched) {
        lines.push(o && o.macInfo ? "ONU tak ditemukan di OLT (MAC ada, belum terpetakan)." : "Tidak terpetakan ke ONU di OLT.");
    } else {
        const st = o.status || "?";
        if (o.rxPowerValid && diag.oltVerdict && diag.oltVerdict.value !== null) {
            lines.push(`RX: ${diag.oltVerdict.emoji} ${o.rxPower} dBm — ${diag.oltVerdict.label} (status ONU: ${st})`);
        } else {
            // Angka RX ONU non-Online = bacaan TERAKHIR yang basi → JANGAN dipamerkan sebagai kondisi kini.
            lines.push(`Status ONU: ${st}${o.isLos ? " (LOS)" : o.isDyingGasp ? " (Dying Gasp)" : ""} — RX belum valid (ONU tidak Online).`);
        }
        const loc = [o.oltName, o.ponName, o.onuId != null ? `ONU ${o.onuId}` : null].filter(Boolean).join(" / ");
        if (loc) lines.push(`Lokasi OLT: ${loc}`);
    }
    return lines;
}

function createRedamanDiagnosisService(deps = {}) {
    const getCustomerRedaman = deps.getCustomerRedaman;
    const resolveByCustomer = deps.resolveByCustomer;
    const getOltSnapshot = deps.getOltSnapshot;
    const getActivePPPoEUsers = deps.getActivePPPoEUsers;
    const getConfig = deps.getConfig || (() => (typeof global !== "undefined" && global.config) || {});

    /**
     * Diagnosa redaman 1 pelanggan (dua-sisi). NEVER-THROW: tiap sumber best-effort.
     * @param {object} user - butuh pppoe_username; device_id opsional (untuk sisi ACS).
     * @param {object} [opts] - { pppoeActive?:Array (share utk batch), caller?:string, skipModemRefresh?:bool }
     * @returns {Promise<object>} diagnosa ternormalisasi (lihat bentuk di akhir fungsi).
     */
    async function diagnoseCustomer(user, opts = {}) {
        const nama = displayName(user);
        const pppoe = firstPart(user && user.pppoe_username);
        const cfg = getConfig() || {};
        const tolerance = cfg.rx_tolerance;
        const hasDevice = !!(user && user.device_id);

        const [modemR, snapR, pppoeR] = await Promise.allSettled([
            hasDevice && typeof getCustomerRedaman === "function" ? getCustomerRedaman(user.device_id) : Promise.resolve(null),
            typeof getOltSnapshot === "function" ? getOltSnapshot() : Promise.resolve(null),
            opts.pppoeActive
                ? Promise.resolve(opts.pppoeActive)
                : (typeof getActivePPPoEUsers === "function" ? getActivePPPoEUsers({ caller: opts.caller || "redaman-diagnosis" }) : Promise.resolve([])),
        ]);

        // ---- Sisi modem (ACS) ----
        const modem = { hasDevice, reachable: false, rxRaw: null, verdict: null };
        if (hasDevice && modemR.status === "fulfilled" && modemR.value) {
            modem.reachable = true;
            modem.rxRaw = modemR.value.redaman;
            modem.verdict = rxVerdict(modem.rxRaw, tolerance);
        }

        // ---- Sisi OLT ----
        const snapshot = snapR.status === "fulfilled" ? snapR.value : null;
        const pppoeActive = opts.pppoeActive || (pppoeR.status === "fulfilled" ? unwrapPppoeList(pppoeR.value) : []);
        let optical = null;
        try {
            optical = typeof resolveByCustomer === "function" ? resolveByCustomer(user, { oltSnapshot: snapshot, pppoeActive }) : null;
        } catch (_e) {
            optical = null;
        }
        // Vonis OLT HANYA bila RX valid (ONU Online) — jangan vonis dari angka basi (#b283).
        const oltVerdict = optical && optical.matched && optical.rxPowerValid ? rxVerdict(optical.rxPower, tolerance) : null;

        // ---- Gabungan dua sumber (untuk 'terburuk' + layak-alert) ----
        const combined = ringkasDuaSumber({
            acs: modem.verdict ? modem.verdict.value : null,
            olt: optical && optical.rxPowerValid ? optical.rxPower : null,
            ambangAlert: tolerance,
        });

        const kesimpulan = buildKesimpulan(modem.verdict, optical);

        return {
            nama,
            pppoe,
            tolerance,
            modem,
            olt: optical,
            oltVerdict,
            combined,
            kesimpulan,
            sources: { modem: modem.reachable, olt: !!(optical && optical.matched) },
            // Baris detail plain-text siap pakai (WA/panel); Telegram merakit HTML sendiri.
            detailLines: null, // diisi lazy oleh formatDetailLines bila permukaan mau
        };
    }

    return { diagnoseCustomer };
}

let _default = null;
/** Instance default terwire ke modul produksi (lazy — hindari require berat saat import). */
function getRedamanDiagnosisService() {
    if (!_default) {
        const { getCustomerRedaman } = require("../lib/wifi");
        const { resolveByCustomer, getOltSnapshot } = require("../lib/olt-optical-resolver");
        const { getActivePPPoEUsers } = require("../lib/mikrotik");
        _default = createRedamanDiagnosisService({ getCustomerRedaman, resolveByCustomer, getOltSnapshot, getActivePPPoEUsers });
    }
    return _default;
}

module.exports = {
    createRedamanDiagnosisService,
    getRedamanDiagnosisService,
    formatDetailLines,
    buildKesimpulan,
};
