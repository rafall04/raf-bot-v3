/**
 * Header Doc
 * Purpose: API papan PSB terjadwal untuk WEB — paritas dengan WA `#jadwal` (kontrak SAMA:
 *          identitas + 3 BUKTI wajib). Create (menunggu) + list + summary. Notif grup pakai
 *          builder yang SAMA dgn WA (`buildScheduleGroupNotif`) → seragam. Bagian S2 standarisasi.
 * Caller: `routes/api.js` (mount `router.use(createPsbScheduleRouter())`).
 * Deps: Express, `lib/psb-schedule-service`, `message/handlers/psb-caption-parser` (resolvePackage),
 *        `message/handlers/reply-runtime` (sendReply, lazy) untuk notif grup.
 * MainFuncs: `createPsbScheduleRouter()`.
 * SideEffects: Tulis papan `psb_schedule` + kirim WA notif grup (best-effort, never-throw).
 */
"use strict";

const express = require("express");
const scheduleService = require("../lib/psb-schedule-service");
const { resolvePackage } = require("../message/handlers/psb-caption-parser");

function createPsbScheduleRouter() {
    const router = express.Router();

    function ensureStaff(req, res, next) {
        if (!req.user || !["admin", "owner", "superadmin", "teknisi"].includes(String(req.user.role || "").toLowerCase())) {
            return res.status(403).json({ status: 403, message: "Akses ditolak (khusus staf)." });
        }
        return next();
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
                area: (global.config && global.config.nama) || null
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

    return router;
}

module.exports = createPsbScheduleRouter;
