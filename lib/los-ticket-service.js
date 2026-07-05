/**
 * Header Doc
 * Purpose: Auto-buat TIKET dari insiden LOS (fiber putus) OLT yang sudah TERKONFIRMASI oleh
 *          `olt-los-broadcaster` (bukan tiap kedip). Reuse model tiket kanonik
 *          (`lib/ticket-workflow.createBaseTicket`/`processTicket`) + notifikasi
 *          (`report-notification-service.notifyNewReport`). Auto-assign ke teknisi least-loaded,
 *          dedup 1 tiket per insiden/pelanggan, auto-batal bila ONU pulih sebelum ditangani.
 * Caller: `lib/olt-los-broadcaster.js` (broadcastGroup → create; cancelActiveIncident → cancel).
 * Deps: `lib/ticket-workflow`, `lib/report-notification-service`, `lib/olt-name-resolver`,
 *       `lib/account-classification`, `global.config.oltLosBroadcast.autoTicket`, `global.users`,
 *       `global.accounts`, `global.reports`.
 * MainFuncs: `maybeCreateLosTicket(incident)`, `maybeCancelLosTicket(ticketId, reason)`.
 * SideEffects: Menulis tiket ke `database/reports.json` (via ticket-workflow) & kirim notifikasi
 *              WhatsApp (via delivery boundary). NEVER-THROW & fire-and-forget — kegagalan di sini
 *              TAK boleh menjatuhkan deteksi/broadcast LOS.
 */
"use strict";

const OPEN_STATUSES = new Set(["baru", "process", "otw", "arrived", "working"]);
// Tiket yang belum "berangkat" — aman dibatalkan otomatis saat ONU pulih sendiri.
const CANCELABLE_ON_RECOVERY = new Set(["baru", "process"]);

function cfg() {
    const lb = (global.config && global.config.oltLosBroadcast) || {};
    return lb.autoTicket || {};
}

function isEnabled() {
    return cfg().enabled === true;
}

function normStatus(s) {
    return String(s || "").trim().toLowerCase();
}

// Pelanggan penuh dari global.users (createBaseTicket butuh id/subscription/pppoe); fallback
// ke snapshot incident.customer bila tak ketemu.
function resolveFullUser(customer) {
    if (!customer) return null;
    const users = global.users || [];
    const found = users.find((u) => u && customer.id != null && String(u.id) === String(customer.id));
    if (found) return found;
    return {
        id: customer.id,
        name: customer.name,
        phone_number: customer.phone,
        address: customer.address,
        account_type: customer.account_type,
    };
}

// Pilih teknisi tujuan: forced (config) → least-loaded (tiket terbuka paling sedikit).
function pickTeknisi() {
    const teknisi = (global.accounts || []).filter((a) => a && a.role === "teknisi" && a.phone_number);
    if (!teknisi.length) return null;

    const forced = cfg().assignTeknisi;
    if (forced) {
        const hit = teknisi.find((a) => a.username === forced || String(a.id) === String(forced));
        if (hit) return hit;
    }

    const openByTeknisi = {};
    for (const r of global.reports || []) {
        if (!OPEN_STATUSES.has(normStatus(r.status))) continue;
        const tid = r.teknisiId || r.processedByTeknisiId;
        if (tid) openByTeknisi[String(tid)] = (openByTeknisi[String(tid)] || 0) + 1;
    }
    let best = null;
    let bestN = Infinity;
    for (const a of teknisi) {
        const n = openByTeknisi[String(a.id)] || openByTeknisi[String(a.username)] || 0;
        if (n < bestN) { bestN = n; best = a; }
    }
    return best || teknisi[0];
}

// Sudah ada tiket LOS terbuka untuk pelanggan / MAC ini? (dedup 1 tiket per insiden).
function findOpenLosTicketId(userId, mac) {
    const macNorm = String(mac || "").replace(/[^0-9a-f]/gi, "").toLowerCase();
    for (const r of global.reports || []) {
        if (r.source !== "los") continue;
        if (!OPEN_STATUSES.has(normStatus(r.status))) continue;
        const sameUser = userId != null && r.user_id != null && String(r.user_id) === String(userId);
        const sameMac = macNorm && String(r.losMac || "").replace(/[^0-9a-f]/gi, "").toLowerCase() === macNorm;
        if (sameUser || sameMac) return r.ticketId || r.id;
    }
    return null;
}

function buildLosLaporanText(incident, oltDisplay) {
    const port = (incident.slot != null || incident.onu != null) ? `slot ${incident.slot}/onu ${incident.onu}` : "-";
    const oltStr = oltDisplay && (oltDisplay.name || oltDisplay.ip)
        ? `${oltDisplay.name || ""}${oltDisplay.ip ? ` (${oltDisplay.ip})` : ""}`.trim()
        : (incident.oltId || "-");
    return "🔴 *FIBER PUTUS (LOS)* terdeteksi OTOMATIS dari OLT.\n"
        + `MAC ONU: ${incident.mac || "-"}\n`
        + `Port: ${port}\n`
        + `OLT: ${oltStr}\n\n`
        + "Sinyal optik hilang (bukan mati listrik) — kemungkinan kabel fiber putus. Mohon cek jalur fiber pelanggan.";
}

/**
 * Buat tiket dari insiden LOS terkonfirmasi. NEVER-THROW. Return ticketId|null.
 * incident: { incidentId, mac, slot, onu, oltId, customer:{id,name,phone,address,account_type} }
 */
function maybeCreateLosTicket(incident) {
    try {
        if (!isEnabled() || !incident || !incident.customer) return null;

        const isInfra = (() => {
            try { return require("./account-classification").isInfrastructure(incident.customer); }
            catch (_e) { return false; }
        })();
        if (isInfra) return null; // akun infrastruktur (CCTV/monitoring) tak perlu tiket

        const user = resolveFullUser(incident.customer);
        if (!user || user.id == null) return null;

        // Dedup: sudah ada tiket LOS terbuka utk pelanggan/MAC ini.
        const existing = findOpenLosTicketId(user.id, incident.mac);
        if (existing) return existing;

        const ticketWorkflow = require("./ticket-workflow");
        let oltDisplay = null;
        try { oltDisplay = require("./olt-name-resolver").resolveOltDisplay(incident.oltId); } catch (_e) { /* ignore */ }

        const ticket = ticketWorkflow.createBaseTicket({
            user,
            laporanText: buildLosLaporanText(incident, oltDisplay),
            issueType: "LOS_FIBER",
            priority: cfg().priority || "HIGH",
            createdBy: "auto-los",
            createdByRole: "system",
        });

        // Tandai asal LOS + konteks OLT (utk dedup + tampilan). Additive; ensureTicketShape
        // tak menghapus field custom. Persist ulang.
        ticket.source = "los";
        ticket.losMac = incident.mac || null;
        ticket.losIncidentId = incident.incidentId || null;
        ticket.oltId = incident.oltId || null;
        ticket.oltName = oltDisplay ? oltDisplay.name : null;
        ticket.oltIp = oltDisplay ? oltDisplay.ip : null;
        try { require("./database").saveReports(); } catch (_e) { /* best-effort */ }

        // Auto-assign ke teknisi (least-loaded) → status process + OTP (pelanggan TIDAK dinotif di
        // sini; sesuai keputusan "tahan dulu" — pelanggan dikabari saat teknisi OTW).
        const teknisi = pickTeknisi();
        if (teknisi) {
            try {
                ticketWorkflow.processTicket({
                    ticketId: ticket.ticketId,
                    actor: { id: teknisi.id, name: teknisi.name || teknisi.username, username: teknisi.username, phoneNumber: teknisi.phone_number },
                });
            } catch (assignErr) {
                console.error("[LOS-TICKET] auto-assign gagal:", assignErr && assignErr.message);
            }
        }

        // Notifikasi teknisi + admin + grup perbaikan (BUKAN pelanggan). Fire-and-forget.
        try {
            require("./report-notification-service").notifyNewReport(ticket, { notifyAdmins: true }).catch((e) => {
                console.error("[LOS-TICKET] notifyNewReport error:", e && e.message);
            });
        } catch (e) {
            console.error("[LOS-TICKET] notifyNewReport gagal dispatch:", e && e.message);
        }

        console.log(`[LOS-TICKET] Tiket ${ticket.ticketId} dibuat dari LOS ${incident.mac} → ${user.name}${teknisi ? ` (assign ${teknisi.username})` : " (pool)"}.`);
        return ticket.ticketId;
    } catch (err) {
        console.error("[LOS-TICKET] maybeCreateLosTicket error:", err && err.message);
        return null;
    }
}

/**
 * Batalkan tiket LOS otomatis bila ONU pulih SEBELUM teknisi berangkat (status baru/process).
 * Kalau sudah otw/arrived/working, biarkan (teknisi sudah bergerak). NEVER-THROW.
 */
function maybeCancelLosTicket(ticketId, reason) {
    try {
        if (!ticketId) return false;
        const ticketWorkflow = require("./ticket-workflow");
        const idx = ticketWorkflow.findTicketIndex(ticketId);
        if (idx === -1) return false;
        const ticket = (global.reports || [])[idx];
        if (!ticket || ticket.source !== "los") return false;
        if (!CANCELABLE_ON_RECOVERY.has(normStatus(ticket.status))) return false; // sudah berangkat

        const { ticket: cancelled } = ticketWorkflow.cancelTicket({
            ticketId,
            actor: { id: "auto-los", name: "Sistem (pulih otomatis)", username: "auto-los" },
            reason: reason || "ONU pulih otomatis sebelum ditangani (kemungkinan kedip, bukan putus).",
            cancelledByType: "system",
        });

        // Beri tahu teknisi + grup bahwa tiket dibatalkan (pelanggan tak perlu — belum dikabari).
        try {
            require("./report-notification-service").notifyTicketCancelled(cancelled,
                { name: "Sistem", username: "auto-los" },
                { cancellationReason: cancelled.cancellationReason }).catch(() => {});
        } catch (_e) { /* never-throw */ }

        console.log(`[LOS-TICKET] Tiket ${ticketId} auto-batal — ONU pulih sebelum ditangani.`);
        return true;
    } catch (err) {
        console.error("[LOS-TICKET] maybeCancelLosTicket error:", err && err.message);
        return false;
    }
}

module.exports = { maybeCreateLosTicket, maybeCancelLosTicket, _pickTeknisi: pickTeknisi, _findOpenLosTicketId: findOpenLosTicketId };
