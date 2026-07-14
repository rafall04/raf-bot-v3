/**
 * Header Doc
 * Purpose: API papan PSB terjadwal untuk WEB — paritas dengan WA `#jadwal` (kontrak SAMA:
 *          identitas + 3 BUKTI wajib). Create (menunggu) + list + summary + ASSIGNMENT (Fase B:
 *          admin TUGASKAN / teknisi AMBIL). Notif grup + DM teknisi pakai builder yang SAMA dgn
 *          WA (`buildScheduleGroupNotif`/`buildAssignmentDm`/`buildAssignmentGroupNotif`) → seragam.
 *          MARKETING (komisi PSB): create terima pemberi lead opsional; `POST /:id/marketing` (ADMIN)
 *          set/koreksi pemberi lead + nominal; `POST /:id/marketing/pay` (ADMIN, Fase 2a) BAYAR komisi
 *          LUAR via kas → expense-manager (createExpense di-inject). Teknisi→payroll = Fase 2b.
 * Caller: `routes/api.js` (mount `router.use(createPsbScheduleRouter())`).
 * Deps: Express, `lib/psb-schedule-service`, `message/handlers/psb-caption-parser` (resolvePackage),
 *        `lib/jid-utils` (normalizePhoneToJid), `message/handlers/reply-runtime` (sendReply, lazy),
 *        `global.accounts` (resolusi teknisi).
 * MainFuncs: `createPsbScheduleRouter()`; helper `loadTeknisiAccounts`/`resolveTeknisiById`/`sendAssignmentNotifs`.
 * SideEffects: Tulis papan `psb_schedule` + kirim WA notif grup & DM teknisi (best-effort, never-throw).
 */
"use strict";

const express = require("express");
const scheduleService = require("../lib/psb-schedule-service");
const { resolvePackage } = require("../message/handlers/psb-caption-parser");
const { normalizePhoneToJid } = require("../lib/jid-utils");

const ADMIN_ROLES = ["admin", "owner", "superadmin"];
function isAdminRole(role) { return ADMIN_ROLES.includes(String(role || "").toLowerCase()); }

// Akun teknisi dari global.accounts (untuk dropdown assign + resolusi + DM).
function loadTeknisiAccounts() {
    return (global.accounts || [])
        .filter((a) => a && String(a.role || "").toLowerCase() === "teknisi")
        .map((a) => ({ id: a.id, name: a.name || a.username, username: a.username, phone_number: a.phone_number }));
}
function resolveTeknisiById(id) {
    const wanted = String(id);
    return loadTeknisiAccounts().find((a) => String(a.id) === wanted) || null;
}
function assignErrorMessage(reason) {
    switch (reason) {
        case "not_found": return "Jadwal tak ditemukan.";
        case "already_installed": return "Jadwal sudah terpasang.";
        case "cancelled": return "Jadwal sudah dibatalkan.";
        case "already_assigned": return "Jadwal sudah dipegang teknisi lain (minta admin untuk mengalihkan).";
        case "no_teknisi": return "Teknisi tak valid.";
        default: return "Tak bisa menugaskan jadwal ini.";
    }
}

// Bangun payload marketing dari body web → { type, refId, refName, refPhone, fee }. Bila type=teknisi,
// resolve nama/HP dari akun (biar nama konsisten & HP kontak terisi). Normalisasi akhir di service.
function resolveMarketingPayload(body = {}) {
    const type = body.marketing_type || null;
    let refId = body.marketing_ref_id || null;
    let refName = body.marketing_ref_name || null;
    let refPhone = body.marketing_ref_phone || null;
    if (String(type).toLowerCase() === "teknisi" && refId) {
        const tk = resolveTeknisiById(refId);
        if (tk) { refName = tk.name; refPhone = refPhone || tk.phone_number || null; }
    }
    return { type, refId, refName, refPhone, fee: body.marketing_fee };
}

function createPsbScheduleRouter() {
    const router = express.Router();

    function ensureStaff(req, res, next) {
        if (!req.user || !["admin", "owner", "superadmin", "teknisi"].includes(String(req.user.role || "").toLowerCase())) {
            return res.status(403).json({ status: 403, message: "Akses ditolak (khusus staf)." });
        }
        return next();
    }

    // DM teknisi + announce grup saat assign/claim (best-effort, NEVER-THROW). TEKS = builder service (seragam WA/web).
    async function sendAssignmentNotifs(record, teknisiAccount, { mode, assignedByName }) {
        try {
            const { sendReply } = require("../message/handlers/reply-runtime");
            if (teknisiAccount && teknisiAccount.phone_number) {
                const jid = normalizePhoneToJid(teknisiAccount.phone_number);
                if (jid) await sendReply({ recipient: jid, text: scheduleService.buildAssignmentDm(record, { assignedByName, mode }) });
            }
            const psbCfg = (global.config && global.config.psbIntake) || {};
            const groupId = psbCfg.summaryGroupId || psbCfg.groupId;
            if (groupId) await sendReply({ recipient: groupId, text: scheduleService.buildAssignmentGroupNotif(record, { mode, assignedByName }) });
        } catch (e) { console.error("[PSB_SCHEDULE_ASSIGN_NOTIF_ERROR]", e.message); }
    }

    // Notif grup (best-effort, never-throw) via delivery boundary — TEKS sama dgn jalur WA.
    async function notifyGroup(record, requestedByName) {
        try {
            const psbCfg = (global.config && global.config.psbIntake) || {};
            const groupId = psbCfg.summaryGroupId || psbCfg.groupId;
            if (!groupId) return;
            const { sendReply } = require("../message/handlers/reply-runtime");
            await sendReply({ recipient: groupId, text: scheduleService.buildScheduleGroupNotif(record, { requestedByName }) });
        } catch (e) { console.error("[PSB_SCHEDULE_NOTIF_ERROR]", e.message); }
    }

    // POST /api/psb-schedule — DAFTAR PSB (menunggu). Wajib identitas + 3 bukti (path foto via upload-photo + koordinat).
    router.post("/psb-schedule", ensureStaff, async (req, res) => {
        try {
            const { nama, hp, dusun, paket, latitude, longitude, catatan, ktp_photo_path, house_photo_path } = req.body || {};
            const errors = [];
            if (!nama) errors.push("Nama wajib");
            if (!hp) errors.push("HP wajib");
            else {
                const parts = String(hp).split("|").map((s) => s.trim()).filter(Boolean);
                const bad = parts.filter((p) => { const d = p.replace(/[^0-9]/g, ""); return d.length < 9 || d.length > 15; });
                if (!parts.length || bad.length) errors.push("HP tidak valid");
            }
            if (!dusun) errors.push("Dusun wajib");
            const packages = global.packages || [];
            const resolvedPaket = paket ? resolvePackage(paket, packages) : null;
            if (!paket) errors.push("Paket wajib");
            else if (!resolvedPaket) errors.push(`Paket "${paket}" tak dikenal`);
            if (!ktp_photo_path) errors.push("Foto KTP wajib");
            if (!house_photo_path) errors.push("Foto rumah wajib");
            const lat = (latitude != null && latitude !== "") ? parseFloat(latitude) : null;
            const lng = (longitude != null && longitude !== "") ? parseFloat(longitude) : null;
            if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) errors.push("Share lokasi (koordinat) wajib");
            if (errors.length) return res.status(400).json({ status: 400, message: errors.join(", "), errors });

            const record = await scheduleService.createRequest({
                nama,
                hp: String(hp).split("|").map((s) => s.trim()).filter(Boolean).join("|"),
                dusun,
                paket: resolvedPaket,
                latitude: lat,
                longitude: lng,
                catatan: catatan || "",
                ktpPhotoPath: ktp_photo_path,
                housePhotoPath: house_photo_path,
                requestedById: req.user.id,
                requestedByName: req.user.name || req.user.username,
                area: (global.config && global.config.nama) || null,
                // Pemberi lead OPSIONAL saat daftar (marketing_* di body). Nominal biasanya diisi saat tutup.
                marketing: resolveMarketingPayload(req.body || {})
            });
            await notifyGroup(record, req.user.name || req.user.username || "-");
            return res.status(201).json({ status: 201, message: `Terjadwal ${record.ref}`, data: record });
        } catch (e) {
            console.error("[PSB_SCHEDULE_CREATE_ERROR]", e.message);
            return res.status(500).json({ status: 500, message: "Gagal menyimpan jadwal: " + e.message });
        }
    });

    // GET /api/psb-schedule/summary — rangkuman papan (belum kepasang + terpasang bln ini).
    router.get("/psb-schedule/summary", ensureStaff, async (req, res) => {
        try {
            const summary = await scheduleService.getScheduleSummary({ nowMs: Date.now() });
            return res.json({ status: 200, data: summary });
        } catch (e) { return res.status(500).json({ status: 500, message: e.message }); }
    });

    // GET /api/psb-schedule — list papan (opsional ?status=menunggu|ditugaskan|terpasang|batal).
    router.get("/psb-schedule", ensureStaff, async (req, res) => {
        try {
            const rows = await scheduleService.listSchedules({ status: req.query.status || null });
            return res.json({ status: 200, data: rows });
        } catch (e) { return res.status(500).json({ status: 500, message: e.message }); }
    });

    // GET /api/psb-schedule/teknisi — daftar teknisi untuk dropdown TUGASKAN (staf).
    router.get("/psb-schedule/teknisi", ensureStaff, (req, res) => {
        return res.json({ status: 200, data: loadTeknisiAccounts().map((t) => ({ id: t.id, name: t.name })) });
    });

    // POST /api/psb-schedule/:id/assign — admin TUGASKAN ke teknisi tertentu. Body { teknisiId }.
    router.post("/psb-schedule/:id/assign", ensureStaff, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) return res.status(403).json({ status: 403, message: "Hanya admin yang boleh menugaskan (teknisi pakai Ambil)." });
            const teknisi = resolveTeknisiById((req.body || {}).teknisiId);
            if (!teknisi) return res.status(400).json({ status: 400, message: "Teknisi tak ditemukan." });
            const result = await scheduleService.assignSchedule({
                scheduleId: req.params.id, teknisiId: teknisi.id, teknisiName: teknisi.name,
                assignedById: req.user.id, assignedByName: req.user.name || req.user.username, mode: "assign"
            });
            if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 409).json({ status: result.reason === "not_found" ? 404 : 409, message: assignErrorMessage(result.reason) });
            await sendAssignmentNotifs(result.record, teknisi, { mode: "assign", assignedByName: req.user.name || req.user.username });
            return res.json({ status: 200, message: `Ditugaskan ke ${teknisi.name}`, data: result.record });
        } catch (e) {
            console.error("[PSB_SCHEDULE_ASSIGN_ERROR]", e.message);
            return res.status(500).json({ status: 500, message: "Gagal menugaskan: " + e.message });
        }
    });

    // POST /api/psb-schedule/:id/claim — teknisi (atau staf) AMBIL sendiri (self-assign).
    router.post("/psb-schedule/:id/claim", ensureStaff, async (req, res) => {
        try {
            const meAcc = resolveTeknisiById(req.user.id) || { id: req.user.id, name: req.user.name || req.user.username, phone_number: null };
            const result = await scheduleService.assignSchedule({
                scheduleId: req.params.id, teknisiId: req.user.id, teknisiName: req.user.name || req.user.username,
                assignedById: req.user.id, assignedByName: req.user.name || req.user.username, mode: "claim"
            });
            if (!result.ok) return res.status(result.reason === "not_found" ? 404 : 409).json({ status: result.reason === "not_found" ? 404 : 409, message: assignErrorMessage(result.reason) });
            await sendAssignmentNotifs(result.record, meAcc, { mode: "claim", assignedByName: req.user.name || req.user.username });
            return res.json({ status: 200, message: `Kamu mengambil ${result.record.ref}`, data: result.record });
        } catch (e) {
            console.error("[PSB_SCHEDULE_CLAIM_ERROR]", e.message);
            return res.status(500).json({ status: 500, message: "Gagal mengambil: " + e.message });
        }
    });

    // POST /api/psb-schedule/:id/marketing — set/koreksi PEMBERI LEAD + nominal komisi (ADMIN saja — ini uang).
    // Body: { marketing_type: teknisi|luar|none, marketing_ref_id?, marketing_ref_name?, marketing_ref_phone?, marketing_fee? }.
    // Fase 1: HANYA mencatat (belum ada uang bergerak); pembayaran teknisi→gaji / luar→kas menyusul Fase 2.
    router.post("/psb-schedule/:id/marketing", ensureStaff, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) return res.status(403).json({ status: 403, message: "Hanya admin yang boleh mengatur komisi marketing." });
            const body = req.body || {};
            const type = String(body.marketing_type || "").toLowerCase();
            if (!["teknisi", "luar", "none"].includes(type)) {
                return res.status(400).json({ status: 400, message: "marketing_type wajib: teknisi | luar | none." });
            }
            if (type === "teknisi" && !resolveTeknisiById(body.marketing_ref_id)) {
                return res.status(400).json({ status: 400, message: "Teknisi pemberi lead tak ditemukan (marketing_ref_id)." });
            }
            if (type === "luar" && !String(body.marketing_ref_name || "").trim()) {
                return res.status(400).json({ status: 400, message: "Nama pemberi lead (marketing_ref_name) wajib untuk tipe luar." });
            }
            const fee = body.marketing_fee;
            if (fee != null && String(fee).trim() !== "" && !(Number.isFinite(parseInt(fee, 10)) && parseInt(fee, 10) >= 0)) {
                return res.status(400).json({ status: 400, message: "Nominal komisi (marketing_fee) harus angka ≥ 0." });
            }
            const result = await scheduleService.setMarketing(req.params.id, resolveMarketingPayload(body));
            if (!result.ok) {
                const code = result.reason === "not_found" ? 404 : 409;
                const msg = result.reason === "already_paid" ? "Komisi sudah dibayar — terkunci." : result.reason === "cancelled" ? "Jadwal sudah dibatalkan." : "Jadwal tak ditemukan.";
                return res.status(code).json({ status: code, message: msg });
            }
            return res.json({ status: 200, message: "Pemberi lead & komisi disimpan.", data: result.record });
        } catch (e) {
            console.error("[PSB_SCHEDULE_MARKETING_ERROR]", e.message);
            return res.status(500).json({ status: 500, message: "Gagal menyimpan komisi: " + e.message });
        }
    });

    // POST /api/psb-schedule/:id/marketing/pay — BAYAR komisi pemberi lead LUAR (makelar) via KAS (Fase 2a).
    // ADMIN saja. Catat pengeluaran (expense-manager, kategori "marketing") + kunci row jadi `paid`. Teknisi
    // TIDAK lewat sini (masuk payroll — Fase 2b). Body opsional { payment_method }. createExpense DI-INJECT
    // ke service (bukan hard-require) agar service tak terikat expense-manager & tetap testable.
    router.post("/psb-schedule/:id/marketing/pay", ensureStaff, async (req, res) => {
        try {
            if (!isAdminRole(req.user.role)) return res.status(403).json({ status: 403, message: "Hanya admin yang boleh membayar komisi." });
            const { createExpense } = require("../lib/expense-manager");
            const result = await scheduleService.payMarketingExternal(req.params.id, {
                actor: { id: req.user.id, username: req.user.username, name: req.user.name || req.user.username, role: req.user.role },
                paymentMethod: (req.body && req.body.payment_method) || "CASH",
                createExpense
            });
            if (!result.ok) {
                const map = {
                    not_found: [404, "Jadwal tak ditemukan."],
                    cancelled: [409, "Jadwal sudah dibatalkan."],
                    not_external: [400, "Hanya komisi pemberi lead LUAR yang dibayar via kas (teknisi lewat gaji)."],
                    already_paid: [409, "Komisi sudah dibayar."],
                    no_pending: [409, "Tak ada komisi terutang untuk dibayar."],
                    no_fee: [400, "Nominal komisi belum diisi."],
                    race: [409, "Komisi sedang/br saja diproses. Muat ulang."],
                    expense_failed: [500, "Gagal mencatat pengeluaran: " + (result.error || "")]
                };
                const [code, msg] = map[result.reason] || [500, "Gagal membayar komisi."];
                return res.status(code).json({ status: code, message: msg });
            }
            return res.json({ status: 200, message: "Komisi dibayar (kas) & tercatat sebagai pengeluaran.", data: result.record });
        } catch (e) {
            console.error("[PSB_SCHEDULE_MARKETING_PAY_ERROR]", e.message);
            return res.status(500).json({ status: 500, message: "Gagal membayar komisi: " + e.message });
        }
    });

    return router;
}

module.exports = createPsbScheduleRouter;
