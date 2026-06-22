/**
 * Header Doc
 * Purpose: Helper murni penyusun baris status modem infrastruktur (account_type='infrastruktur')
 *          untuk halaman Monitor Infrastruktur. Menggabungkan sinyal PPPoE online/offline (MikroTik,
 *          sinyal utama "internet hidup/mati") dengan enrichment OLT (redaman/LOS/dying-gasp).
 *          Prioritas status: PPPoE online menang; kalau offline, OLT menjelaskan SEBABNYA (LOS=fiber putus,
 *          dying-gasp=mati listrik). Dipisah dari I/O agar deterministik & mudah dites.
 * Caller: `routes/olt.js` (endpoint GET /api/olt/infra-status).
 * Deps: tidak ada (pure, tanpa I/O).
 * MainFuncs: classifyInfraStatus, buildInfraRow.
 * SideEffects: Tidak ada.
 */
"use strict";

/**
 * Klasifikasi status efektif modem infra untuk badge/sort/filter.
 * Prioritas: pppoeOnline > LOS > Dying Gasp > Offline generik.
 * @param {{pppoeOnline?: boolean, isLos?: boolean, isDyingGasp?: boolean}} input
 * @returns {{key: string, label: string, badge: string}}
 */
function classifyInfraStatus({ pppoeOnline, isLos, isDyingGasp } = {}) {
    if (pppoeOnline) return { key: "online", label: "Online", badge: "badge-success" };
    if (isLos) return { key: "los", label: "LOS", badge: "badge-danger" };
    if (isDyingGasp) return { key: "dying", label: "Dying Gasp", badge: "badge-warning" };
    return { key: "offline", label: "Offline", badge: "badge-secondary" };
}

/**
 * Susun satu baris status infra dari record user + konteks PPPoE/OLT yang sudah di-resolve.
 * Best-effort: `onu` boleh null (modem infra tetap muncul dengan status PPPoE saja).
 * @param {object} user - record pelanggan (akun infra)
 * @param {{pppoeOnline?: boolean, ip?: string|null, onu?: object|null}} ctx
 * @returns {object} baris siap dikirim ke klien
 */
function buildInfraRow(user = {}, ctx = {}) {
    const onu = ctx.onu || null;
    const pppoeOnline = Boolean(ctx.pppoeOnline);
    const isLos = onu ? Boolean(onu.isLos) : false;
    const isDyingGasp = onu ? Boolean(onu.isDyingGasp) : false;
    const status = classifyInfraStatus({ pppoeOnline, isLos, isDyingGasp });

    return {
        user_id: user.id != null ? user.id : null,
        name: user.name || null,
        pppoe_username: user.pppoe_username || null,
        address: user.address || user.alamat || null,
        pppoe_status: pppoeOnline ? "online" : "offline",
        ip: pppoeOnline ? (ctx.ip || null) : null,
        status_key: status.key, // online | los | dying | offline (untuk badge/sort/filter klien)
        in_olt: Boolean(onu),
        olt_status: onu ? (onu.status || null) : null,
        rx_power: onu && onu.rxPower != null ? onu.rxPower : null,
        is_los: isLos,
        is_dying_gasp: isDyingGasp,
        pon_name: onu ? (onu.ponName || null) : null,
        olt_name: onu ? (onu.olt_name || null) : null,
        last_down_cause: onu ? (onu.lastDownCause || null) : null
    };
}

module.exports = { classifyInfraStatus, buildInfraRow };
